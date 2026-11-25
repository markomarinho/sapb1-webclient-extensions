import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  AuditLogRecord,
  BankCode,
  DashboardSummary,
  GlMatchingRule,
  HouseBankAccount,
  MovementDirection,
  ParsedBankStatement,
  ReconciliationStatus,
  StagedBankLine,
  StatementFormat,
} from '@b1-recon/shared';

export class ReconciliationDatabase {
  public readonly db: DatabaseSync;

  constructor(dbFilePath: string) {
    if (dbFilePath !== ':memory:') {
      fs.mkdirSync(path.dirname(dbFilePath), { recursive: true });
    }
    this.db = new DatabaseSync(dbFilePath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.initSchema();
    this.seedDefaultPortugueseHouseBanks();
    this.seedDefaultGlRules();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS house_banks (
        id TEXT PRIMARY KEY,
        bank_code TEXT NOT NULL,
        bank_name TEXT NOT NULL,
        account_label TEXT NOT NULL,
        iban TEXT NOT NULL,
        account_number TEXT NOT NULL,
        gl_account_code TEXT NOT NULL,
        gl_account_name TEXT NOT NULL,
        currency TEXT NOT NULL DEFAULT 'EUR',
        default_format TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS encrypted_secrets (
        secret_key TEXT PRIMARY KEY,
        ciphertext TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS bank_statements (
        id TEXT PRIMARY KEY,
        house_bank_id TEXT NOT NULL REFERENCES house_banks(id),
        format TEXT NOT NULL,
        bank_code TEXT NOT NULL,
        statement_ref TEXT NOT NULL,
        currency TEXT NOT NULL,
        period_start TEXT NOT NULL,
        period_end TEXT NOT NULL,
        opening_balance REAL NOT NULL,
        closing_balance REAL NOT NULL,
        balance_verified INTEGER NOT NULL,
        imported_by TEXT NOT NULL,
        imported_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS bank_statement_lines (
        id TEXT PRIMARY KEY,
        statement_id TEXT NOT NULL REFERENCES bank_statements(id),
        house_bank_id TEXT NOT NULL REFERENCES house_banks(id),
        bank_code TEXT NOT NULL,
        gl_account_code TEXT NOT NULL,
        line_number INTEGER NOT NULL,
        booking_date TEXT NOT NULL,
        value_date TEXT NOT NULL,
        direction TEXT NOT NULL,
        amount REAL NOT NULL,
        signed_amount REAL NOT NULL,
        currency TEXT NOT NULL,
        is_reversal INTEGER NOT NULL DEFAULT 0,
        transaction_code TEXT NOT NULL,
        bank_reference TEXT NOT NULL,
        customer_reference TEXT NOT NULL,
        description TEXT NOT NULL,
        raw_narrative TEXT NOT NULL,
        extracted_json TEXT NOT NULL,
        fingerprint TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'UNMATCHED',
        top_confidence INTEGER NOT NULL DEFAULT 0,
        b1_payment_doc_entry INTEGER,
        b1_trans_id INTEGER,
        b1_trans_line_id INTEGER,
        b1_bank_page_seq INTEGER,
        error_message TEXT,
        reconciled_at TEXT,
        reconciled_by TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_lines_house_bank_status
        ON bank_statement_lines(house_bank_id, status);

      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL,
        b1_user TEXT NOT NULL,
        action TEXT NOT NULL,
        bank_line_id TEXT,
        statement_id TEXT,
        details_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS gl_matching_rules (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        direction TEXT NOT NULL,
        keywords_pattern TEXT NOT NULL,
        gl_account_code TEXT NOT NULL,
        gl_account_name TEXT NOT NULL,
        confidence INTEGER NOT NULL DEFAULT 92
      );
    `);
  }

  private seedDefaultPortugueseHouseBanks(): void {
    const countRow = this.db.prepare('SELECT COUNT(*) as cnt FROM house_banks').get() as { cnt: number };
    if (countRow.cnt > 0) return;

    const insert = this.db.prepare(`
      INSERT INTO house_banks (
        id, bank_code, bank_name, account_label, iban, account_number,
        gl_account_code, gl_account_name, currency, default_format
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insert.run(
      'hb-mt940-main',
      '0035',
      'Conta Bancária Principal',
      'Conta DO Principal (EUR)',
      'PT50003506510008432190079',
      '0651000843219',
      '120101',
      'Depósitos à Ordem - Conta Principal EUR',
      'EUR',
      'MT940'
    );

    insert.run(
      'hb-norma43-main',
      '0033',
      'Conta Bancária Tesouraria',
      'Conta DO Tesouraria (EUR)',
      'PT50003300004561234567862',
      '4561234567',
      '120102',
      'Depósitos à Ordem - Tesouraria EUR',
      'EUR',
      'NORMA43'
    );
  }

  private seedDefaultGlRules(): void {
    const countRow = this.db
      .prepare('SELECT COUNT(*) as cnt FROM gl_matching_rules')
      .get() as { cnt: number };
    if (countRow.cnt > 0) return;

    const insert = this.db.prepare(`
      INSERT INTO gl_matching_rules (
        id, name, direction, keywords_pattern, gl_account_code, gl_account_name, confidence
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    insert.run(
      'rule-bank-fee',
      'Comissões e Serviços Bancários',
      'DEBIT',
      'COMISSAO,COMISSÃO,MANUTENCAO,DESPESA BANCARIA,PORTES,ANUIDADE',
      '622701',
      'Serviços Bancários',
      94
    );

    insert.run(
      'rule-stamp-duty',
      'Imposto do Selo Bancário',
      'DEBIT',
      'IMPOSTO DO SELO,IMP SELO,I.SELO,IS ART',
      '681201',
      'Imposto do Selo',
      95
    );

    insert.run(
      'rule-interest-exp',
      'Juros Suportados',
      'DEBIT',
      'JUROS DEVEDORES,JUROS SUPORTADOS',
      '691101',
      'Juros Suportados - Financiamentos',
      92
    );

    insert.run(
      'rule-interest-inc',
      'Juros Obtidos de Depósitos',
      'CREDIT',
      'JUROS CREDORES,JUROS DEPOSITO,JUROS OBTIDOS',
      '791101',
      'Juros Obtidos - Depósitos Bancários',
      92
    );
  }

  setEncryptedSecret(key: string, ciphertext: string): void {
    this.db
      .prepare(
        `INSERT INTO encrypted_secrets (secret_key, ciphertext, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(secret_key) DO UPDATE SET
           ciphertext = excluded.ciphertext,
           updated_at = excluded.updated_at`
      )
      .run(key, ciphertext, new Date().toISOString());
  }

  getEncryptedSecret(key: string): string | undefined {
    const row = this.db
      .prepare('SELECT ciphertext FROM encrypted_secrets WHERE secret_key = ?')
      .get(key) as { ciphertext: string } | undefined;
    return row?.ciphertext;
  }

  listGlRules(): GlMatchingRule[] {
    const rows = this.db
      .prepare('SELECT * FROM gl_matching_rules ORDER BY name ASC')
      .all() as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      direction: r.direction as MovementDirection,
      keywordsPattern: String(r.keywords_pattern),
      glAccountCode: String(r.gl_account_code),
      glAccountName: String(r.gl_account_name),
      confidence: Number(r.confidence),
    }));
  }

  upsertGlRule(rule: GlMatchingRule): GlMatchingRule {
    this.db
      .prepare(
        `INSERT INTO gl_matching_rules (
          id, name, direction, keywords_pattern, gl_account_code, gl_account_name, confidence
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          direction = excluded.direction,
          keywords_pattern = excluded.keywords_pattern,
          gl_account_code = excluded.gl_account_code,
          gl_account_name = excluded.gl_account_name,
          confidence = excluded.confidence`
      )
      .run(
        rule.id,
        rule.name,
        rule.direction,
        rule.keywordsPattern,
        rule.glAccountCode,
        rule.glAccountName,
        rule.confidence
      );
    return rule;
  }

  deleteGlRule(id: string): void {
    this.db.prepare('DELETE FROM gl_matching_rules WHERE id = ?').run(id);
  }

  listHouseBanks(): HouseBankAccount[] {
    const rows = this.db.prepare('SELECT * FROM house_banks ORDER BY bank_code ASC').all() as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      bankCode: r.bank_code as BankCode,
      bankName: String(r.bank_name),
      accountLabel: String(r.account_label),
      iban: String(r.iban),
      accountNumber: String(r.account_number),
      glAccountCode: String(r.gl_account_code),
      glAccountName: String(r.gl_account_name),
      currency: String(r.currency),
      defaultFormat: r.default_format as StatementFormat,
    }));
  }

  upsertHouseBanks(accounts: HouseBankAccount[]): void {
    const stmt = this.db.prepare(`
      INSERT INTO house_banks (
        id, bank_code, bank_name, account_label, iban, account_number,
        gl_account_code, gl_account_name, currency, default_format
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        account_label = excluded.account_label,
        iban = excluded.iban,
        account_number = excluded.account_number,
        gl_account_code = excluded.gl_account_code,
        gl_account_name = excluded.gl_account_name
    `);
    for (const acc of accounts) {
      stmt.run(
        acc.id,
        acc.bankCode,
        acc.bankName,
        acc.accountLabel,
        acc.iban,
        acc.accountNumber,
        acc.glAccountCode,
        acc.glAccountName,
        acc.currency,
        acc.defaultFormat
      );
    }
  }

  findHouseBankForStatement(parsed: ParsedBankStatement): HouseBankAccount | undefined {
    const banks = this.listHouseBanks();
    const cleanTargetIban = (parsed.normalizedIban ?? '').replace(/\s+/g, '').toUpperCase();
    const cleanTargetAcct = parsed.normalizedAccountNumber.replace(/\D/g, '');

    for (const hb of banks) {
      const hbIban = hb.iban.replace(/\s+/g, '').toUpperCase();
      const hbAcct = hb.accountNumber.replace(/\D/g, '');
      if (cleanTargetIban && hbIban === cleanTargetIban) {
        return hb;
      }
      if (cleanTargetAcct && (hbIban.includes(cleanTargetAcct) || hbAcct.includes(cleanTargetAcct) || cleanTargetAcct.includes(hbAcct))) {
        return hb;
      }
    }
    return (
      banks.find((b) => b.bankCode === parsed.bankCode) ??
      banks.find((b) => b.defaultFormat === parsed.format)
    );
  }

  countExistingFingerprints(fingerprints: string[]): Set<string> {
    const existing = new Set<string>();
    const checkStmt = this.db.prepare('SELECT 1 FROM bank_statement_lines WHERE fingerprint = ?');
    for (const fp of fingerprints) {
      if (checkStmt.get(fp)) {
        existing.add(fp);
      }
    }
    return existing;
  }

  importStatement(
    parsed: ParsedBankStatement,
    houseBank: HouseBankAccount,
    b1User: string
  ): { statementDbId: string; importedIds: string[]; skippedDuplicates: number } {
    const now = new Date().toISOString();
    const statementDbId = `stmt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const existingSet = this.countExistingFingerprints(parsed.lines.map((l) => l.fingerprint));

    this.db.exec('BEGIN TRANSACTION');
    try {
      this.db
        .prepare(
          `INSERT INTO bank_statements (
            id, house_bank_id, format, bank_code, statement_ref, currency,
            period_start, period_end, opening_balance, closing_balance,
            balance_verified, imported_by, imported_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          statementDbId,
          houseBank.id,
          parsed.format,
          houseBank.bankCode,
          parsed.statementId,
          parsed.currency,
          parsed.periodStart,
          parsed.periodEnd,
          parsed.openingBalance,
          parsed.closingBalance,
          parsed.balanceVerified ? 1 : 0,
          b1User,
          now
        );

      const insertLine = this.db.prepare(`
        INSERT INTO bank_statement_lines (
          id, statement_id, house_bank_id, bank_code, gl_account_code, line_number,
          booking_date, value_date, direction, amount, signed_amount, currency,
          is_reversal, transaction_code, bank_reference, customer_reference,
          description, raw_narrative, extracted_json, fingerprint, status, top_confidence
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'UNMATCHED', 0)
      `);

      const importedIds: string[] = [];
      let skippedDuplicates = 0;

      for (const line of parsed.lines) {
        if (existingSet.has(line.fingerprint)) {
          skippedDuplicates++;
          continue;
        }
        const lineId = `line-${statementDbId}-${line.lineNumber}`;
        insertLine.run(
          lineId,
          statementDbId,
          houseBank.id,
          houseBank.bankCode,
          houseBank.glAccountCode,
          line.lineNumber,
          line.bookingDate,
          line.valueDate,
          line.direction,
          line.amount,
          line.signedAmount,
          line.currency,
          line.isReversal ? 1 : 0,
          line.transactionCode,
          line.bankReference,
          line.customerReference,
          line.description,
          line.rawNarrative,
          JSON.stringify(line.extracted),
          line.fingerprint
        );
        importedIds.push(lineId);
      }

      this.recordAudit(b1User, 'STATEMENT_IMPORTED', {
        statementId: statementDbId,
        details: {
          format: parsed.format,
          bankCode: parsed.bankCode,
          houseBankId: houseBank.id,
          importedCount: importedIds.length,
          skippedDuplicates,
          openingBalance: parsed.openingBalance,
          closingBalance: parsed.closingBalance,
        },
      });

      this.db.exec('COMMIT');
      return { statementDbId, importedIds, skippedDuplicates };
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  listLines(filters?: {
    houseBankId?: string;
    statusGroup?: 'PENDING' | 'RECONCILED' | 'IGNORED' | 'ALL';
    search?: string;
  }): StagedBankLine[] {
    const clauses: string[] = [];
    const params: Array<string | number> = [];

    if (filters?.houseBankId && filters.houseBankId !== 'ALL') {
      clauses.push('house_bank_id = ?');
      params.push(filters.houseBankId);
    }

    if (filters?.statusGroup === 'PENDING') {
      clauses.push("status IN ('UNMATCHED', 'SUGGESTED', 'PAYMENT_CREATED', 'BANKPAGE_CREATED', 'ERROR')");
    } else if (filters?.statusGroup === 'RECONCILED') {
      clauses.push("status = 'RECONCILED'");
    } else if (filters?.statusGroup === 'IGNORED') {
      clauses.push("status = 'IGNORED'");
    }

    if (filters?.search && filters.search.trim()) {
      const q = `%${filters.search.trim()}%`;
      clauses.push('(description LIKE ? OR bank_reference LIKE ? OR customer_reference LIKE ? OR extracted_json LIKE ? OR CAST(amount AS TEXT) LIKE ?)');
      params.push(q, q, q, q, q);
    }

    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db
      .prepare(`SELECT * FROM bank_statement_lines ${whereSql} ORDER BY booking_date DESC, line_number ASC`)
      .all(...params) as Array<Record<string, unknown>>;

    return rows.map((r) => this.mapLineRow(r));
  }

  getLineById(id: string): StagedBankLine | undefined {
    const row = this.db.prepare('SELECT * FROM bank_statement_lines WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.mapLineRow(row) : undefined;
  }

  updateLineConfidence(id: string, topConfidence: number): void {
    const line = this.getLineById(id);
    if (!line) return;
    if (line.status === 'UNMATCHED' || line.status === 'SUGGESTED') {
      const nextStatus: ReconciliationStatus = topConfidence >= 50 ? 'SUGGESTED' : 'UNMATCHED';
      this.db
        .prepare('UPDATE bank_statement_lines SET top_confidence = ?, status = ? WHERE id = ?')
        .run(topConfidence, nextStatus, id);
    }
  }

  updateLineProgress(
    id: string,
    patch: {
      status: ReconciliationStatus;
      b1PaymentDocEntry?: number;
      b1TransId?: number;
      b1TransLineId?: number;
      b1BankPageSequence?: number;
      errorMessage?: string | null;
      reconciledAt?: string;
      reconciledBy?: string;
    }
  ): void {
    const current = this.getLineById(id);
    if (!current) throw new Error(`Bank statement line not found: ${id}`);

    this.db
      .prepare(
        `UPDATE bank_statement_lines SET
          status = ?,
          b1_payment_doc_entry = ?,
          b1_trans_id = ?,
          b1_trans_line_id = ?,
          b1_bank_page_seq = ?,
          error_message = ?,
          reconciled_at = ?,
          reconciled_by = ?
        WHERE id = ?`
      )
      .run(
        patch.status,
        patch.b1PaymentDocEntry ?? current.b1PaymentDocEntry ?? null,
        patch.b1TransId ?? current.b1TransId ?? null,
        patch.b1TransLineId ?? current.b1TransLineId ?? null,
        patch.b1BankPageSequence ?? current.b1BankPageSequence ?? null,
        patch.errorMessage === undefined ? current.errorMessage ?? null : patch.errorMessage,
        patch.reconciledAt ?? current.reconciledAt ?? null,
        patch.reconciledBy ?? current.reconciledBy ?? null,
        id
      );
  }

  getDashboardSummary(mode: 'mock' | 'live', houseBankId?: string): DashboardSummary {
    const lines = this.listLines({ houseBankId, statusGroup: 'ALL' });
    let totalUnreconciled = 0;
    let highConfidenceReady = 0;
    let needsReview = 0;
    let reconciledCount = 0;
    let unreconciledInflowEur = 0;
    let unreconciledOutflowEur = 0;

    for (const l of lines) {
      if (l.status === 'RECONCILED') {
        reconciledCount++;
      } else if (l.status !== 'IGNORED') {
        totalUnreconciled++;
        if (l.direction === 'CREDIT') unreconciledInflowEur += l.amount;
        else unreconciledOutflowEur += l.amount;

        if (l.topConfidence >= 85) highConfidenceReady++;
        else needsReview++;
      }
    }

    return {
      mode,
      totalUnreconciled,
      highConfidenceReady,
      needsReview,
      reconciledCount,
      unreconciledInflowEur: Math.round(unreconciledInflowEur * 100) / 100,
      unreconciledOutflowEur: Math.round(unreconciledOutflowEur * 100) / 100,
    };
  }

  recordAudit(
    b1User: string,
    action: string,
    opts: { bankLineId?: string; statementId?: string; details: Record<string, unknown> }
  ): void {
    this.db
      .prepare(
        `INSERT INTO audit_logs (created_at, b1_user, action, bank_line_id, statement_id, details_json)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        new Date().toISOString(),
        b1User,
        action,
        opts.bankLineId ?? null,
        opts.statementId ?? null,
        JSON.stringify(opts.details)
      );
  }

  listAuditLogs(limit = 100): AuditLogRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?')
      .all(limit) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: Number(r.id),
      createdAt: String(r.created_at),
      b1User: String(r.b1_user),
      action: String(r.action),
      bankLineId: r.bank_line_id ? String(r.bank_line_id) : undefined,
      statementId: r.statement_id ? String(r.statement_id) : undefined,
      detailsJson: String(r.details_json),
    }));
  }

  reopenLine(id: string, b1User: string): StagedBankLine {
    const current = this.getLineById(id);
    if (!current) throw new Error(`Bank statement line not found: ${id}`);
    if (current.status === 'RECONCILED') {
      throw new Error('Cannot reopen an already reconciled statement line.');
    }
    const nextStatus: ReconciliationStatus = current.topConfidence >= 50 ? 'SUGGESTED' : 'UNMATCHED';
    this.db
      .prepare('UPDATE bank_statement_lines SET status = ?, error_message = NULL WHERE id = ?')
      .run(nextStatus, id);

    this.recordAudit(b1User, 'LINE_REOPENED', {
      bankLineId: id,
      statementId: current.statementId,
      details: { previousStatus: current.status, newStatus: nextStatus },
    });
    return this.getLineById(id)!;
  }

  private mapLineRow(r: Record<string, unknown>): StagedBankLine {
    return {
      id: String(r.id),
      statementId: String(r.statement_id),
      houseBankId: String(r.house_bank_id),
      bankCode: r.bank_code as BankCode,
      glAccountCode: String(r.gl_account_code),
      lineNumber: Number(r.line_number),
      bookingDate: String(r.booking_date),
      valueDate: String(r.value_date),
      direction: r.direction as 'CREDIT' | 'DEBIT',
      amount: Number(r.amount),
      signedAmount: Number(r.signed_amount),
      currency: String(r.currency),
      isReversal: Number(r.is_reversal) === 1,
      transactionCode: String(r.transaction_code),
      bankReference: String(r.bank_reference),
      customerReference: String(r.customer_reference),
      description: String(r.description),
      rawNarrative: r.raw_narrative != null ? String(r.raw_narrative) : undefined,
      extracted: JSON.parse(String(r.extracted_json || '{}')),
      fingerprint: String(r.fingerprint),
      status: r.status as ReconciliationStatus,
      topConfidence: Number(r.top_confidence ?? 0),
      b1PaymentDocEntry: r.b1_payment_doc_entry != null ? Number(r.b1_payment_doc_entry) : undefined,
      b1TransId: r.b1_trans_id != null ? Number(r.b1_trans_id) : undefined,
      b1TransLineId: r.b1_trans_line_id != null ? Number(r.b1_trans_line_id) : undefined,
      b1BankPageSequence: r.b1_bank_page_seq != null ? Number(r.b1_bank_page_seq) : undefined,
      errorMessage: r.error_message != null ? String(r.error_message) : undefined,
      reconciledAt: r.reconciled_at != null ? String(r.reconciled_at) : undefined,
      reconciledBy: r.reconciled_by != null ? String(r.reconciled_by) : undefined,
    };
  }
}
