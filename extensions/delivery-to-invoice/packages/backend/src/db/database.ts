import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  AuditLogRecord,
  AutomationSettings,
  ConversionItemStatus,
  ConversionRecord,
  GroupingMode,
  PdfSourceMode,
  SentEmailPreview,
  TriggerSource,
} from '@b1-d2i/shared';
import type { AppConfig } from '../config/env.js';
import { currentCompany } from '../company/context.js';

const COMPANY_SETTINGS_COLUMNS = 'scheduler_enabled, interval_minutes, grouping_mode, only_auto_invoice_customers, min_delivery_age_days, send_email_automatically, default_eml_grp_code, check_price_match_last_invoice, check_minimum_margin, minimum_margin_percent, email_subject_template, email_body_template, email_body_is_html, cc_addresses, reply_to_address, smtp_host, smtp_port, smtp_secure, smtp_user, smtp_password, smtp_from, pdf_source, gateway_url, invoice_doc_code, gateway_fallback_builtin, last_run_at, next_run_at';

export interface SaveConversionInput {
  id: string;
  runId: string;
  triggerSource: TriggerSource;
  groupingMode: GroupingMode;
  cardCode: string;
  cardName: string;
  deliveryDocEntries: number[];
  deliveryDocNums: number[];
  invoiceDocEntry: number | null;
  invoiceDocNum: number | null;
  invoiceDate: string | null;
  currency: string;
  totalAmount: number;
  recipientEmail: string | null;
  recipientName?: string | null;
  emailSubject: string | null;
  emailSentAt: string | null;
  status: ConversionItemStatus;
  errorMessage: string | null;
  createdBy: string;
  createdAt: string;
}

export class ExtensionDatabase {
  public readonly db: DatabaseSync;
  /** Company that owns rows created before multi-company support (single-tenant installs). */
  private readonly legacyCompanyDb: string;
  private readonly config?: Partial<AppConfig>;

  constructor(dbFilePath: string, config?: Partial<AppConfig>) {
    this.config = config;
    this.legacyCompanyDb =
      config?.B1_LEGACY_COMPANY_DB || config?.B1_COMPANY_DB || 'SBO_COMPANY_PT';
    if (dbFilePath !== ':memory:') {
      fs.mkdirSync(path.dirname(dbFilePath), { recursive: true });
    }
    this.db = new DatabaseSync(dbFilePath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS company_settings (
        company_db TEXT PRIMARY KEY,
        scheduler_enabled INTEGER NOT NULL DEFAULT 0,
        interval_minutes INTEGER NOT NULL DEFAULT 60,
        grouping_mode TEXT NOT NULL DEFAULT 'PER_DELIVERY',
        only_auto_invoice_customers INTEGER NOT NULL DEFAULT 1,
        min_delivery_age_days INTEGER NOT NULL DEFAULT 0,
        send_email_automatically INTEGER NOT NULL DEFAULT 1,
        default_eml_grp_code TEXT NOT NULL DEFAULT '',
        check_price_match_last_invoice INTEGER NOT NULL DEFAULT 1,
        check_minimum_margin INTEGER NOT NULL DEFAULT 1,
        minimum_margin_percent REAL NOT NULL DEFAULT 30,
        email_subject_template TEXT NOT NULL,
        email_body_template TEXT NOT NULL,
        email_body_is_html INTEGER NOT NULL DEFAULT 0,
        cc_addresses TEXT NOT NULL DEFAULT '',
        reply_to_address TEXT NOT NULL DEFAULT '',
        smtp_host TEXT NOT NULL DEFAULT '',
        smtp_port INTEGER NOT NULL DEFAULT 587,
        smtp_secure INTEGER NOT NULL DEFAULT 0,
        smtp_user TEXT NOT NULL DEFAULT '',
        smtp_password TEXT NOT NULL DEFAULT '',
        smtp_from TEXT NOT NULL DEFAULT '',
        pdf_source TEXT NOT NULL DEFAULT 'builtin',
        gateway_url TEXT NOT NULL DEFAULT '',
        invoice_doc_code TEXT NOT NULL DEFAULT 'INV20004',
        gateway_fallback_builtin INTEGER NOT NULL DEFAULT 0,
        last_run_at TEXT,
        next_run_at TEXT
      );

      CREATE TABLE IF NOT EXISTS conversion_records (
        id TEXT PRIMARY KEY,
        company_db TEXT NOT NULL DEFAULT '',
        run_id TEXT NOT NULL,
        trigger_source TEXT NOT NULL,
        grouping_mode TEXT NOT NULL,
        card_code TEXT NOT NULL,
        card_name TEXT NOT NULL,
        delivery_doc_entries_json TEXT NOT NULL,
        delivery_doc_nums_json TEXT NOT NULL,
        invoice_doc_entry INTEGER,
        invoice_doc_num INTEGER,
        invoice_date TEXT,
        currency TEXT NOT NULL,
        total_amount REAL NOT NULL,
        recipient_email TEXT,
        recipient_name TEXT,
        email_subject TEXT,
        email_sent_at TEXT,
        status TEXT NOT NULL,
        error_message TEXT,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS processed_deliveries (
        company_db TEXT NOT NULL DEFAULT '',
        delivery_doc_entry INTEGER NOT NULL,
        conversion_id TEXT NOT NULL REFERENCES conversion_records(id),
        invoice_doc_entry INTEGER NOT NULL,
        invoice_doc_num INTEGER NOT NULL,
        processed_at TEXT NOT NULL,
        PRIMARY KEY (company_db, delivery_doc_entry)
      );

      CREATE TABLE IF NOT EXISTS sent_emails (
        id TEXT PRIMARY KEY,
        company_db TEXT NOT NULL DEFAULT '',
        conversion_id TEXT NOT NULL REFERENCES conversion_records(id),
        recipient_to TEXT NOT NULL,
        recipient_name TEXT NOT NULL DEFAULT '',
        recipient_cc TEXT NOT NULL DEFAULT '',
        subject TEXT NOT NULL,
        html_body TEXT NOT NULL,
        attachment_filename TEXT NOT NULL,
        attachment_bytes INTEGER NOT NULL,
        sent_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_db TEXT NOT NULL DEFAULT '',
        timestamp TEXT NOT NULL,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        details TEXT NOT NULL
      );
    `);

    // Forward-compatible column migrations for existing local SQLite databases
    this.migrateLegacySettings();

    const convCols = new Set(
      (this.db.prepare('PRAGMA table_info(conversion_records)').all() as Array<{ name: string }>).map(
        (c) => c.name
      )
    );
    if (!convCols.has('recipient_name')) {
      this.db.exec('ALTER TABLE conversion_records ADD COLUMN recipient_name TEXT;');
    }

    const emailCols = new Set(
      (this.db.prepare('PRAGMA table_info(sent_emails)').all() as Array<{ name: string }>).map(
        (c) => c.name
      )
    );
    if (!emailCols.has('recipient_name')) {
      this.db.exec("ALTER TABLE sent_emails ADD COLUMN recipient_name TEXT NOT NULL DEFAULT '';");
    }

    this.migrateToMultiCompany();
  }

  /** Brings a pre-multi-company `settings` table (singleton row) up to the latest columns. */
  private legacySettingsAlters(): void {
    const settingsCols = new Set(
      (this.db.prepare('PRAGMA table_info(settings)').all() as Array<{ name: string }>).map(
        (c) => c.name
      )
    );
    if (!settingsCols.has('pdf_source')) {
      this.db.exec("ALTER TABLE settings ADD COLUMN pdf_source TEXT NOT NULL DEFAULT 'builtin';");
    }
    if (!settingsCols.has('gateway_url')) {
      this.db.exec("ALTER TABLE settings ADD COLUMN gateway_url TEXT NOT NULL DEFAULT '';");
    }
    if (!settingsCols.has('invoice_doc_code')) {
      this.db.exec(
        "ALTER TABLE settings ADD COLUMN invoice_doc_code TEXT NOT NULL DEFAULT 'INV20004';"
      );
    }
    if (!settingsCols.has('gateway_fallback_builtin')) {
      this.db.exec(
        'ALTER TABLE settings ADD COLUMN gateway_fallback_builtin INTEGER NOT NULL DEFAULT 0;'
      );
    }
    if (!settingsCols.has('default_eml_grp_code')) {
      this.db.exec(
        "ALTER TABLE settings ADD COLUMN default_eml_grp_code TEXT NOT NULL DEFAULT '';"
      );
    }
    if (!settingsCols.has('email_body_is_html')) {
      this.db.exec(
        'ALTER TABLE settings ADD COLUMN email_body_is_html INTEGER NOT NULL DEFAULT 0;'
      );
    }
    if (!settingsCols.has('check_price_match_last_invoice')) {
      this.db.exec(
        'ALTER TABLE settings ADD COLUMN check_price_match_last_invoice INTEGER NOT NULL DEFAULT 1;'
      );
    }
    if (!settingsCols.has('check_minimum_margin')) {
      this.db.exec(
        'ALTER TABLE settings ADD COLUMN check_minimum_margin INTEGER NOT NULL DEFAULT 1;'
      );
    }
    if (!settingsCols.has('minimum_margin_percent')) {
      this.db.exec(
        'ALTER TABLE settings ADD COLUMN minimum_margin_percent REAL NOT NULL DEFAULT 30;'
      );
    }
  }

  private tableColumns(table: string): Set<string> {
    return new Set(
      (this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name)
    );
  }

  private migrateLegacySettings(): void {
    const legacy = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'settings'")
      .get();
    if (!legacy) return;
    this.legacySettingsAlters();
    const already = this.db.prepare('SELECT COUNT(*) AS c FROM company_settings').get() as { c: number };
    if (Number(already.c) > 0) return;
    const cols = COMPANY_SETTINGS_COLUMNS;
    this.db
      .prepare(
        `INSERT INTO company_settings (company_db, ${cols}) SELECT ?, ${cols} FROM settings WHERE id = 1`
      )
      .run(this.legacyCompanyDb);
  }

  /** Tags pre-existing rows with the legacy company and makes processed_deliveries unique per company. */
  private migrateToMultiCompany(): void {
    for (const table of ['conversion_records', 'sent_emails', 'audit_logs']) {
      if (!this.tableColumns(table).has('company_db')) {
        this.db.exec(`ALTER TABLE ${table} ADD COLUMN company_db TEXT NOT NULL DEFAULT '';`);
      }
      this.db.prepare(`UPDATE ${table} SET company_db = ? WHERE company_db = ''`).run(this.legacyCompanyDb);
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_${table}_company ON ${table}(company_db);`);
    }

    if (!this.tableColumns('processed_deliveries').has('company_db')) {
      // Old primary key was delivery_doc_entry alone: DocEntry values collide across companies.
      this.db.exec('PRAGMA foreign_keys = OFF;');
      this.db.exec(`
        ALTER TABLE processed_deliveries RENAME TO processed_deliveries_old;
        CREATE TABLE processed_deliveries (
          company_db TEXT NOT NULL DEFAULT '',
          delivery_doc_entry INTEGER NOT NULL,
          conversion_id TEXT NOT NULL REFERENCES conversion_records(id),
          invoice_doc_entry INTEGER NOT NULL,
          invoice_doc_num INTEGER NOT NULL,
          processed_at TEXT NOT NULL,
          PRIMARY KEY (company_db, delivery_doc_entry)
        );
      `);
      this.db
        .prepare(
          `INSERT INTO processed_deliveries
             (company_db, delivery_doc_entry, conversion_id, invoice_doc_entry, invoice_doc_num, processed_at)
           SELECT ?, delivery_doc_entry, conversion_id, invoice_doc_entry, invoice_doc_num, processed_at
           FROM processed_deliveries_old`
        )
        .run(this.legacyCompanyDb);
      this.db.exec('DROP TABLE processed_deliveries_old; PRAGMA foreign_keys = ON;');
    }
  }

  /** Creates the default settings row for a company the first time it is seen. */
  private ensureSettings(companyDb: string): void {
    const config = this.config;
    const row = this.db
      .prepare('SELECT company_db FROM company_settings WHERE company_db = ?')
      .get(companyDb);
    if (row) return;

    const defaultSubject = 'Fatura {{InvoiceDocNum}} — {{CardName}}';
    const defaultBody = [
      'Exmo.(a) Cliente {{CardName}},',
      '',
      'Enviamos em anexo a Fatura nº {{InvoiceDocNum}} (data {{InvoiceDate}}), referente à(s) Guia(s) de Remessa {{DeliveryRefs}}.',
      '',
      'Valor Total: {{DocTotal}} {{Currency}}',
      '',
      'Com os melhores cumprimentos,',
      'Departamento de Faturação',
    ].join('\n');

    this.db
      .prepare(
        `INSERT INTO company_settings (
          company_db, scheduler_enabled, interval_minutes, grouping_mode,
          only_auto_invoice_customers, min_delivery_age_days, send_email_automatically,
          default_eml_grp_code,
          email_subject_template, email_body_template, cc_addresses, reply_to_address,
          smtp_host, smtp_port, smtp_secure, smtp_user, smtp_password, smtp_from,
          pdf_source, gateway_url, invoice_doc_code, gateway_fallback_builtin
        ) VALUES (?, 0, 60, 'PER_DELIVERY', 1, 0, 1, ?, ?, ?, '', '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        companyDb,
        config?.B1_DEFAULT_EML_GRP_CODE ?? '',
        defaultSubject,
        defaultBody,
        config?.SMTP_HOST ?? '',
        config?.SMTP_PORT ?? 587,
        config?.SMTP_SECURE ? 1 : 0,
        config?.SMTP_USER ?? '',
        config?.SMTP_PASSWORD ?? '',
        config?.SMTP_FROM ?? 'faturacao@empresa.local',
        config?.PDF_SOURCE ?? 'builtin',
        config?.B1_GATEWAY_URL ?? '',
        config?.B1_INVOICE_DOC_CODE ?? 'INV20004',
        config?.B1_GATEWAY_FALLBACK_BUILTIN ? 1 : 0
      );
  }

  public getSettings(): AutomationSettings {
    const company = currentCompany();
    this.ensureSettings(company);
    const row = this.db
      .prepare('SELECT * FROM company_settings WHERE company_db = ?')
      .get(company) as Record<string, unknown>;
    return {
      schedulerEnabled: Boolean(row.scheduler_enabled),
      intervalMinutes: Number(row.interval_minutes),
      groupingMode: row.grouping_mode as GroupingMode,
      onlyAutoInvoiceCustomers: Boolean(row.only_auto_invoice_customers),
      minDeliveryAgeDays: Number(row.min_delivery_age_days),
      sendEmailAutomatically: Boolean(row.send_email_automatically),
      defaultEmlGrpCode: String(row.default_eml_grp_code ?? ''),
      checkPriceMatchLastInvoice:
        row.check_price_match_last_invoice !== undefined
          ? Boolean(row.check_price_match_last_invoice)
          : true,
      checkMinimumMargin:
        row.check_minimum_margin !== undefined ? Boolean(row.check_minimum_margin) : true,
      minimumMarginPercent:
        row.minimum_margin_percent !== undefined ? Number(row.minimum_margin_percent) : 30,
      emailSubjectTemplate: String(row.email_subject_template),
      emailBodyTemplate: String(row.email_body_template),
      emailBodyIsHtml: Boolean(row.email_body_is_html),
      ccAddresses: String(row.cc_addresses ?? ''),
      replyToAddress: String(row.reply_to_address ?? ''),
      smtpHost: String(row.smtp_host ?? ''),
      smtpPort: Number(row.smtp_port ?? 587),
      smtpSecure: Boolean(row.smtp_secure),
      smtpUser: String(row.smtp_user ?? ''),
      smtpFrom: String(row.smtp_from ?? ''),
      hasSmtpPassword: Boolean(row.smtp_password && String(row.smtp_password).length > 0),
      pdfSource: (row.pdf_source === 'gateway' ? 'gateway' : 'builtin') as PdfSourceMode,
      gatewayUrl: String(row.gateway_url ?? ''),
      invoiceDocCode: String(row.invoice_doc_code ?? 'INV20004'),
      gatewayFallbackToBuiltin: Boolean(row.gateway_fallback_builtin),
      lastRunAt: row.last_run_at ? String(row.last_run_at) : null,
      nextRunAt: row.next_run_at ? String(row.next_run_at) : null,
    };
  }

  public getSmtpPassword(): string {
    const row = this.db
      .prepare('SELECT smtp_password FROM company_settings WHERE company_db = ?')
      .get(currentCompany()) as { smtp_password?: string } | undefined;
    return row?.smtp_password ?? '';
  }

  public updateSettings(
    patch: Partial<AutomationSettings> & { smtpPassword?: string }
  ): AutomationSettings {
    const current = this.getSettings();
    const nextPassword =
      patch.smtpPassword !== undefined ? patch.smtpPassword : this.getSmtpPassword();

    this.db
      .prepare(
        `UPDATE company_settings SET
          scheduler_enabled = ?,
          interval_minutes = ?,
          grouping_mode = ?,
          only_auto_invoice_customers = ?,
          min_delivery_age_days = ?,
          send_email_automatically = ?,
          default_eml_grp_code = ?,
          check_price_match_last_invoice = ?,
          check_minimum_margin = ?,
          minimum_margin_percent = ?,
          email_subject_template = ?,
          email_body_template = ?,
          email_body_is_html = ?,
          cc_addresses = ?,
          reply_to_address = ?,
          smtp_host = ?,
          smtp_port = ?,
          smtp_secure = ?,
          smtp_user = ?,
          smtp_password = ?,
          smtp_from = ?,
          pdf_source = ?,
          gateway_url = ?,
          invoice_doc_code = ?,
          gateway_fallback_builtin = ?
        WHERE company_db = ?`
      )
      .run(
        (patch.schedulerEnabled ?? current.schedulerEnabled) ? 1 : 0,
        Math.max(1, patch.intervalMinutes ?? current.intervalMinutes),
        patch.groupingMode ?? current.groupingMode,
        (patch.onlyAutoInvoiceCustomers ?? current.onlyAutoInvoiceCustomers) ? 1 : 0,
        Math.max(0, patch.minDeliveryAgeDays ?? current.minDeliveryAgeDays),
        (patch.sendEmailAutomatically ?? current.sendEmailAutomatically) ? 1 : 0,
        (patch.defaultEmlGrpCode ?? current.defaultEmlGrpCode).trim(),
        (patch.checkPriceMatchLastInvoice ?? current.checkPriceMatchLastInvoice) ? 1 : 0,
        (patch.checkMinimumMargin ?? current.checkMinimumMargin) ? 1 : 0,
        patch.minimumMarginPercent ?? current.minimumMarginPercent,
        patch.emailSubjectTemplate ?? current.emailSubjectTemplate,
        patch.emailBodyTemplate ?? current.emailBodyTemplate,
        (patch.emailBodyIsHtml ?? current.emailBodyIsHtml) ? 1 : 0,
        patch.ccAddresses ?? current.ccAddresses,
        patch.replyToAddress ?? current.replyToAddress,
        patch.smtpHost ?? current.smtpHost,
        patch.smtpPort ?? current.smtpPort,
        (patch.smtpSecure ?? current.smtpSecure) ? 1 : 0,
        patch.smtpUser ?? current.smtpUser,
        nextPassword,
        patch.smtpFrom ?? current.smtpFrom,
        patch.pdfSource ?? current.pdfSource,
        patch.gatewayUrl ?? current.gatewayUrl,
        patch.invoiceDocCode ?? current.invoiceDocCode,
        (patch.gatewayFallbackToBuiltin ?? current.gatewayFallbackToBuiltin) ? 1 : 0,
        currentCompany()
      );

    return this.getSettings();
  }

  public updateSchedulerTimestamps(lastRunAt: string | null, nextRunAt: string | null): void {
    this.db
      .prepare(
        'UPDATE company_settings SET last_run_at = COALESCE(?, last_run_at), next_run_at = ? WHERE company_db = ?'
      )
      .run(lastRunAt, nextRunAt, currentCompany());
  }

  /** Companies that have the scheduler enabled (used to start one timer per company). */
  public listSchedulerCompanies(): string[] {
    const rows = this.db
      .prepare('SELECT company_db FROM company_settings WHERE scheduler_enabled = 1')
      .all() as Array<{ company_db: string }>;
    return rows.map((r) => String(r.company_db));
  }

  public isDeliveryProcessed(docEntry: number): boolean {
    const row = this.db
      .prepare(
        'SELECT delivery_doc_entry FROM processed_deliveries WHERE company_db = ? AND delivery_doc_entry = ?'
      )
      .get(currentCompany(), docEntry);
    return Boolean(row);
  }

  public getProcessedDeliveryEntries(): Set<number> {
    const rows = this.db
      .prepare('SELECT delivery_doc_entry FROM processed_deliveries WHERE company_db = ?')
      .all(currentCompany()) as Array<{ delivery_doc_entry: number }>;
    return new Set(rows.map((r) => Number(r.delivery_doc_entry)));
  }

  public saveConversion(rec: SaveConversionInput): void {
    this.db
      .prepare(
        `INSERT INTO conversion_records (
          id, company_db, run_id, trigger_source, grouping_mode, card_code, card_name,
          delivery_doc_entries_json, delivery_doc_nums_json,
          invoice_doc_entry, invoice_doc_num, invoice_date,
          currency, total_amount, recipient_email, recipient_name, email_subject, email_sent_at,
          status, error_message, created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        rec.id,
        currentCompany(),
        rec.runId,
        rec.triggerSource,
        rec.groupingMode,
        rec.cardCode,
        rec.cardName,
        JSON.stringify(rec.deliveryDocEntries),
        JSON.stringify(rec.deliveryDocNums),
        rec.invoiceDocEntry,
        rec.invoiceDocNum,
        rec.invoiceDate,
        rec.currency,
        rec.totalAmount,
        rec.recipientEmail,
        rec.recipientName ?? null,
        rec.emailSubject,
        rec.emailSentAt,
        rec.status,
        rec.errorMessage,
        rec.createdBy,
        rec.createdAt
      );

    if (rec.invoiceDocEntry !== null && rec.invoiceDocNum !== null) {
      const stmt = this.db.prepare(
        `INSERT OR IGNORE INTO processed_deliveries (
          company_db, delivery_doc_entry, conversion_id, invoice_doc_entry, invoice_doc_num, processed_at
        ) VALUES (?, ?, ?, ?, ?, ?)`
      );
      for (const entry of rec.deliveryDocEntries) {
        stmt.run(currentCompany(), entry, rec.id, rec.invoiceDocEntry, rec.invoiceDocNum, rec.createdAt);
      }
    }
  }

  public updateConversionEmailStatus(
    id: string,
    patch: {
      status: ConversionItemStatus;
      recipientEmail?: string | null;
      recipientName?: string | null;
      emailSubject?: string | null;
      emailSentAt?: string | null;
      errorMessage?: string | null;
    }
  ): void {
    this.db
      .prepare(
        `UPDATE conversion_records SET
          status = ?,
          recipient_email = COALESCE(?, recipient_email),
          recipient_name = ?,
          email_subject = COALESCE(?, email_subject),
          email_sent_at = COALESCE(?, email_sent_at),
          error_message = ?
        WHERE id = ? AND company_db = ?`
      )
      .run(
        patch.status,
        patch.recipientEmail ?? null,
        patch.recipientName !== undefined ? patch.recipientName : null,
        patch.emailSubject ?? null,
        patch.emailSentAt ?? null,
        patch.errorMessage ?? null,
        id,
        currentCompany()
      );
  }

  public getConversionById(id: string): ConversionRecord | null {
    const row = this.db
      .prepare('SELECT * FROM conversion_records WHERE id = ? AND company_db = ?')
      .get(id, currentCompany()) as Record<string, unknown> | undefined;
    return row ? this.mapConversionRow(row) : null;
  }

  public listConversions(limit = 100): ConversionRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM conversion_records WHERE company_db = ? ORDER BY created_at DESC LIMIT ?')
      .all(currentCompany(), limit) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapConversionRow(r));
  }

  private mapConversionRow(row: Record<string, unknown>): ConversionRecord {
    return {
      id: String(row.id),
      runId: String(row.run_id),
      triggerSource: row.trigger_source as TriggerSource,
      groupingMode: row.grouping_mode as GroupingMode,
      cardCode: String(row.card_code),
      cardName: String(row.card_name),
      deliveryDocEntries: JSON.parse(String(row.delivery_doc_entries_json)) as number[],
      deliveryDocNums: JSON.parse(String(row.delivery_doc_nums_json)) as number[],
      invoiceDocEntry: row.invoice_doc_entry !== null ? Number(row.invoice_doc_entry) : null,
      invoiceDocNum: row.invoice_doc_num !== null ? Number(row.invoice_doc_num) : null,
      invoiceDate: row.invoice_date ? String(row.invoice_date) : null,
      currency: String(row.currency),
      totalAmount: Number(row.total_amount),
      recipientEmail: row.recipient_email ? String(row.recipient_email) : null,
      recipientName: row.recipient_name ? String(row.recipient_name) : null,
      emailSubject: row.email_subject ? String(row.email_subject) : null,
      emailSentAt: row.email_sent_at ? String(row.email_sent_at) : null,
      status: row.status as ConversionItemStatus,
      errorMessage: row.error_message ? String(row.error_message) : null,
      createdBy: String(row.created_by),
      createdAt: String(row.created_at),
    };
  }

  public saveSentEmail(email: SentEmailPreview): void {
    this.db
      .prepare(
        `INSERT INTO sent_emails (
          id, company_db, conversion_id, recipient_to, recipient_name, recipient_cc, subject,
          html_body, attachment_filename, attachment_bytes, sent_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        email.id,
        currentCompany(),
        email.conversionId,
        email.to,
        email.recipientName ?? '',
        email.cc ?? '',
        email.subject,
        email.htmlBody,
        email.attachmentFilename,
        email.attachmentBytes,
        email.sentAt
      );
  }

  public listSentEmails(limit = 100): SentEmailPreview[] {
    const rows = this.db
      .prepare('SELECT * FROM sent_emails WHERE company_db = ? ORDER BY sent_at DESC LIMIT ?')
      .all(currentCompany(), limit) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      conversionId: String(r.conversion_id),
      to: String(r.recipient_to),
      recipientName: r.recipient_name ? String(r.recipient_name) : undefined,
      cc: r.recipient_cc ? String(r.recipient_cc) : undefined,
      subject: String(r.subject),
      htmlBody: String(r.html_body),
      attachmentFilename: String(r.attachment_filename),
      attachmentBytes: Number(r.attachment_bytes),
      sentAt: String(r.sent_at),
    }));
  }

  public addAuditLog(actor: string, action: string, details: string): void {
    this.db
      .prepare(
        'INSERT INTO audit_logs (company_db, timestamp, actor, action, details) VALUES (?, ?, ?, ?, ?)'
      )
      .run(currentCompany(), new Date().toISOString(), actor, action, details);
  }

  public listAuditLogs(limit = 100): AuditLogRecord[] {
    const rows = this.db
      .prepare(
        'SELECT id, timestamp, actor, action, details FROM audit_logs WHERE company_db = ? ORDER BY id DESC LIMIT ?'
      )
      .all(currentCompany(), limit) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: Number(r.id),
      timestamp: String(r.timestamp),
      actor: String(r.actor),
      action: String(r.action),
      details: String(r.details),
    }));
  }

  public getStatsToday(): {
    invoicedTodayCount: number;
    emailsSentCount: number;
    emailFailedCount: number;
  } {
    const company = currentCompany();
    const todayPrefix = new Date().toISOString().slice(0, 10);
    const invoicedToday = this.db
      .prepare(
        "SELECT COUNT(*) as cnt FROM conversion_records WHERE company_db = ? AND invoice_doc_entry IS NOT NULL AND created_at LIKE ?"
      )
      .get(company, `${todayPrefix}%`) as { cnt: number };

    const emailsSent = this.db
      .prepare(
        "SELECT COUNT(*) as cnt FROM conversion_records WHERE company_db = ? AND status = 'INVOICED_AND_EMAILED'"
      )
      .get(company) as { cnt: number };

    const emailFailed = this.db
      .prepare(
        "SELECT COUNT(*) as cnt FROM conversion_records WHERE company_db = ? AND status IN ('INVOICED_EMAIL_FAILED', 'INVOICED_NO_EMAIL', 'FAILED')"
      )
      .get(company) as { cnt: number };

    return {
      invoicedTodayCount: Number(invoicedToday?.cnt ?? 0),
      emailsSentCount: Number(emailsSent?.cnt ?? 0),
      emailFailedCount: Number(emailFailed?.cnt ?? 0),
    };
  }
}
