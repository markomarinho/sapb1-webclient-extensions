import type {
  B1DocumentType,
  B1OpenDocument,
  B1UnreconciledJournalLine,
  BankCode,
  HouseBankAccount,
} from '@b1-recon/shared';
import type { AppConfig } from '../config/env.js';

export interface IB1ReadRepository {
  testConnection(): Promise<{
    ok: boolean;
    latencyMs: number;
    schema: string;
    houseBanksCount: number;
    openDocumentsCount: number;
  }>;
  getHouseBanks(): Promise<HouseBankAccount[]>;
  getOpenDocuments(direction: 'CREDIT' | 'DEBIT'): Promise<B1OpenDocument[]>;
  getUnreconciledJournalLines(glAccountCode: string): Promise<B1UnreconciledJournalLine[]>;
  getAllOpenDocuments(): Promise<B1OpenDocument[]>;
}

function assertSafeSqlIdentifier(ident: string, label: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(ident)) {
    throw new Error(`Unsafe SQL identifier rejected for ${label}: "${ident}"`);
  }
  return ident;
}

/**
 * Direct Read-Only SAP HANA Repository (@sap/hana-client).
 * Executes strictly SELECT queries using the restricted B1_RECON_RO user.
 * NEVER executes INSERT/UPDATE/DELETE against SAP Business One tables.
 */
export class LiveHanaReadRepository implements IB1ReadRepository {
  private readonly schema: string;
  private readonly udfMbEntity?: string;
  private readonly udfMbRef?: string;

  constructor(private readonly config: AppConfig) {
    this.schema = assertSafeSqlIdentifier(config.HANA_SCHEMA, 'HANA_SCHEMA');
    if (config.HANA_UDF_MB_ENTITY?.trim()) {
      this.udfMbEntity = assertSafeSqlIdentifier(config.HANA_UDF_MB_ENTITY.trim(), 'HANA_UDF_MB_ENTITY');
    }
    if (config.HANA_UDF_MB_REF?.trim()) {
      this.udfMbRef = assertSafeSqlIdentifier(config.HANA_UDF_MB_REF.trim(), 'HANA_UDF_MB_REF');
    }
  }

  private async queryHana<T>(sql: string, params: Array<string | number> = []): Promise<T[]> {
    const hanaModule = await import('@sap/hana-client').catch(() => {
      throw new Error(
        '@sap/hana-client is not installed. Run "npm install @sap/hana-client" on the SAP B1 host before enabling B1_MODE=live.'
      );
    });
    const hana = hanaModule.default ?? hanaModule;
    const conn = hana.createConnection();

    return new Promise<T[]>((resolve, reject) => {
      conn.connect(
        {
          serverNode: `${this.config.HANA_HOST}:${this.config.HANA_PORT}`,
          uid: this.config.HANA_READONLY_USER,
          pwd: this.config.HANA_READONLY_PASSWORD,
          encrypt: this.config.HANA_ENCRYPT ? 'true' : 'false',
          sslValidateCertificate: this.config.HANA_SSL_VALIDATE_CERT ? 'true' : 'false',
          currentSchema: this.schema,
        },
        (connErr: Error | null) => {
          if (connErr) {
            return reject(new Error(`SAP HANA Read-Only connection failed: ${connErr.message}`));
          }
          conn.exec(sql, params, (execErr: Error | null, rows: unknown) => {
            try {
              conn.disconnect();
            } catch {
              // Ignore disconnect cleanup errors
            }
            if (execErr) return reject(new Error(`SAP HANA SELECT query failed: ${execErr.message}`));
            resolve((rows as T[]) ?? []);
          });
        }
      );
    });
  }

  async testConnection(): Promise<{
    ok: boolean;
    latencyMs: number;
    schema: string;
    houseBanksCount: number;
    openDocumentsCount: number;
  }> {
    const start = Date.now();
    const [banks, docs] = await Promise.all([
      this.getHouseBanks(),
      this.getAllOpenDocuments(),
    ]);
    return {
      ok: true,
      latencyMs: Date.now() - start,
      schema: this.schema,
      houseBanksCount: banks.length,
      openDocumentsCount: docs.length,
    };
  }

  async getHouseBanks(): Promise<HouseBankAccount[]> {
    const sql = `
      SELECT
        T0."AbsEntry" AS "Id",
        T0."BankCode" AS "BankCode",
        COALESCE(T1."BankName", T0."BankCode") AS "BankName",
        COALESCE(T0."AcctName", T0."Account") AS "AccountLabel",
        COALESCE(T0."IBAN", '') AS "Iban",
        T0."Account" AS "AccountNumber",
        T0."GLAccount" AS "GlAccountCode",
        COALESCE(T2."AcctName", T0."GLAccount") AS "GlAccountName"
      FROM "${this.schema}"."DSC1" T0
      LEFT JOIN "${this.schema}"."ODSC" T1 ON T0."BankCode" = T1."BankCode"
      LEFT JOIN "${this.schema}"."OACT" T2 ON T0."GLAccount" = T2."AcctCode"
      WHERE T0."GLAccount" IS NOT NULL
    `;
    const rows = await this.queryHana<Record<string, unknown>>(sql);
    return rows.map((r) => {
      const bankCode: BankCode = String(r.BankCode ?? 'BANK').trim();
      const iban = String(r.Iban ?? '').replace(/\s+/g, '');
      return {
        id: `hb-${r.Id}`,
        bankCode,
        bankName: String(r.BankName ?? bankCode),
        accountLabel: String(r.AccountLabel),
        iban,
        accountNumber: String(r.AccountNumber),
        glAccountCode: String(r.GlAccountCode),
        glAccountName: String(r.GlAccountName),
        currency: 'EUR',
        defaultFormat: 'MT940',
      };
    });
  }

  async getOpenDocuments(direction: 'CREDIT' | 'DEBIT'): Promise<B1OpenDocument[]> {
    const isAr = direction === 'CREDIT';
    const invTable = isAr ? 'OINV' : 'OPCH';
    const cmTable = isAr ? 'ORIN' : 'ORPC';
    const invType: B1DocumentType = isAr ? 'AR_INVOICE' : 'AP_INVOICE';
    const cmType: B1DocumentType = isAr ? 'AR_CREDIT_MEMO' : 'AP_CREDIT_MEMO';

    const mbEntCol = this.udfMbEntity ? `T0."${this.udfMbEntity}"` : `''`;
    const mbRefCol = this.udfMbRef ? `T0."${this.udfMbRef}"` : `''`;

    const sql = `
      WITH bp_ibans AS (
        SELECT
          "CardCode",
          STRING_AGG(REPLACE("IBAN", ' ', ''), ',') AS "IbansCsv"
        FROM "${this.schema}"."OCRB"
        WHERE "IBAN" IS NOT NULL AND LENGTH(TRIM("IBAN")) > 0
        GROUP BY "CardCode"
      )
      SELECT
        '${invType}' AS "DocType",
        T0."DocEntry",
        T0."DocNum",
        T0."Series" AS "SeriesCode",
        COALESCE(SR."SeriesName", CAST(T0."Series" AS NVARCHAR(30)), '') AS "SeriesName",
        COALESCE(T0."NumAtCard", '') AS "AtDocNumber",
        T0."CardCode",
        T0."CardName",
        COALESCE(BP."LicTradNum", T0."LicTradNum", '') AS "Nif",
        COALESCE(IB."IbansCsv", '') AS "IbansCsv",
        TO_VARCHAR(T0."DocDate", 'YYYY-MM-DD') AS "DocDate",
        TO_VARCHAR(T0."DocDueDate", 'YYYY-MM-DD') AS "DueDate",
        T0."DocCur" AS "Currency",
        CAST(T0."DocTotal" AS DOUBLE) AS "DocTotal",
        CAST((T0."DocTotal" - T0."PaidToDate") AS DOUBLE) AS "OpenAmount",
        COALESCE( CAST(${mbEntCol} AS NVARCHAR(50)), '' ) AS "MbEntity",
        COALESCE( CAST(${mbRefCol} AS NVARCHAR(50)), '' ) AS "MbRef",
        COALESCE(T0."Comments", '') AS "Comments"
      FROM "${this.schema}"."${invTable}" T0
      LEFT JOIN "${this.schema}"."NNM1" SR ON T0."Series" = SR."Series"
      LEFT JOIN "${this.schema}"."OCRD" BP ON T0."CardCode" = BP."CardCode"
      LEFT JOIN bp_ibans IB ON T0."CardCode" = IB."CardCode"
      WHERE T0."DocStatus" = 'O'
        AND T0."CANCELED" = 'N'
        AND (T0."DocTotal" - T0."PaidToDate") > 0.009

      UNION ALL

      SELECT
        '${cmType}' AS "DocType",
        T0."DocEntry",
        T0."DocNum",
        T0."Series" AS "SeriesCode",
        COALESCE(SR."SeriesName", CAST(T0."Series" AS NVARCHAR(30)), '') AS "SeriesName",
        COALESCE(T0."NumAtCard", '') AS "AtDocNumber",
        T0."CardCode",
        T0."CardName",
        COALESCE(BP."LicTradNum", T0."LicTradNum", '') AS "Nif",
        COALESCE(IB."IbansCsv", '') AS "IbansCsv",
        TO_VARCHAR(T0."DocDate", 'YYYY-MM-DD') AS "DocDate",
        TO_VARCHAR(T0."DocDueDate", 'YYYY-MM-DD') AS "DueDate",
        T0."DocCur" AS "Currency",
        -CAST(T0."DocTotal" AS DOUBLE) AS "DocTotal",
        -CAST((T0."DocTotal" - T0."PaidToDate") AS DOUBLE) AS "OpenAmount",
        '' AS "MbEntity",
        '' AS "MbRef",
        COALESCE(T0."Comments", '') AS "Comments"
      FROM "${this.schema}"."${cmTable}" T0
      LEFT JOIN "${this.schema}"."NNM1" SR ON T0."Series" = SR."Series"
      LEFT JOIN "${this.schema}"."OCRD" BP ON T0."CardCode" = BP."CardCode"
      LEFT JOIN bp_ibans IB ON T0."CardCode" = IB."CardCode"
      WHERE T0."DocStatus" = 'O'
        AND T0."CANCELED" = 'N'
        AND (T0."DocTotal" - T0."PaidToDate") > 0.009

      ORDER BY "DueDate" ASC
    `;

    const rows = await this.queryHana<Record<string, unknown>>(sql);
    return rows.map((r) => {
      const rawNif = String(r.Nif ?? '').replace(/^PT/i, '').trim();
      const ibans = String(r.IbansCsv ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const seriesName = r.SeriesName ? String(r.SeriesName).trim() : undefined;

      return {
        docType: (r.DocType as B1DocumentType) || invType,
        docEntry: Number(r.DocEntry),
        docNum: Number(r.DocNum),
        seriesCode: r.SeriesCode != null ? Number(r.SeriesCode) : undefined,
        seriesName: seriesName || undefined,
        atDocNumber: r.AtDocNumber ? String(r.AtDocNumber) : undefined,
        cardCode: String(r.CardCode),
        cardName: String(r.CardName),
        nif: rawNif || undefined,
        bpIbans: ibans,
        docDate: String(r.DocDate),
        dueDate: String(r.DueDate),
        currency: String(r.Currency || 'EUR'),
        docTotal: Number(r.DocTotal),
        openAmount: Math.round(Number(r.OpenAmount) * 100) / 100,
        multibancoEntity: r.MbEntity ? String(r.MbEntity).trim() : undefined,
        multibancoRef: r.MbRef ? String(r.MbRef).replace(/\s+/g, '') : undefined,
        comments: r.Comments ? String(r.Comments) : undefined,
      };
    });
  }

  async getAllOpenDocuments(): Promise<B1OpenDocument[]> {
    const [ar, ap] = await Promise.all([
      this.getOpenDocuments('CREDIT'),
      this.getOpenDocuments('DEBIT'),
    ]);
    return [...ar, ...ap];
  }

  async getUnreconciledJournalLines(glAccountCode: string): Promise<B1UnreconciledJournalLine[]> {
    const sql = `
      SELECT
        J1."TransId",
        J1."Line_ID" AS "LineId",
        TO_VARCHAR(J1."RefDate", 'YYYY-MM-DD') AS "RefDate",
        TO_VARCHAR(COALESCE(J1."DueDate", J1."RefDate"), 'YYYY-MM-DD') AS "DueDate",
        J1."Account" AS "GlAccountCode",
        CAST(J1."Debit" AS DOUBLE) AS "Debit",
        CAST(J1."Credit" AS DOUBLE) AS "Credit",
        COALESCE(J1."Ref1", J0."Ref1", '') AS "Ref1",
        COALESCE(J1."Ref2", J0."Ref2", '') AS "Ref2",
        COALESCE(J1."LineMemo", J0."Memo", '') AS "Memo",
        COALESCE(J1."ContraAct", '') AS "ContraAct",
        COALESCE(BP."CardCode", '') AS "CardCode",
        COALESCE(BP."CardName", '') AS "CardName",
        COALESCE(BP."LicTradNum", '') AS "Nif",
        CAST(J0."TransType" AS NVARCHAR(20)) AS "SourceType",
        J0."BaseRef" AS "SourceDocNum"
      FROM "${this.schema}"."JDT1" J1
      INNER JOIN "${this.schema}"."OJDT" J0 ON J1."TransId" = J0."TransId"
      LEFT JOIN "${this.schema}"."OCRD" BP ON J1."ContraAct" = BP."CardCode"
      WHERE J1."Account" = ?
        AND COALESCE(J1."ExtrMatch", 0) = 0
      ORDER BY J1."RefDate" DESC
    `;

    const rows = await this.queryHana<Record<string, unknown>>(sql, [glAccountCode]);
    return rows.map((r) => {
      const debit = Number(r.Debit ?? 0);
      const credit = Number(r.Credit ?? 0);
      // In SAP B1 G/L accounting: Debit on a House Bank asset account = Inflow (+), Credit = Outflow (-)
      const signedAmount = Math.round((debit - credit) * 100) / 100;
      return {
        transId: Number(r.TransId),
        lineId: Number(r.LineId),
        refDate: String(r.RefDate),
        dueDate: String(r.DueDate),
        glAccountCode: String(r.GlAccountCode),
        debit,
        credit,
        signedAmount,
        ref1: r.Ref1 ? String(r.Ref1) : undefined,
        ref2: r.Ref2 ? String(r.Ref2) : undefined,
        memo: r.Memo ? String(r.Memo) : undefined,
        contraAct: r.ContraAct ? String(r.ContraAct) : undefined,
        cardCode: r.CardCode ? String(r.CardCode) : undefined,
        cardName: r.CardName ? String(r.CardName) : undefined,
        nif: r.Nif ? String(r.Nif).replace(/^PT/i, '').trim() : undefined,
        sourceType: r.SourceType ? String(r.SourceType) : undefined,
        sourceDocNum: r.SourceDocNum ? Number(r.SourceDocNum) : undefined,
      };
    });
  }
}

/**
 * Realistic Portuguese SAP B1 HANA Mock Repository for immediate local development,
 * automated testing, and UI demonstrations before connecting to the production HANA server.
 */
export class MockHanaReadRepository implements IB1ReadRepository {
  private openDocs: B1OpenDocument[] = [
    {
      docType: 'AR_INVOICE',
      docEntry: 101,
      docNum: 1042,
      atDocNumber: 'FT 2026/1042',
      cardCode: 'C10010',
      cardName: 'Cliente Delta Comércio Lda',
      nif: '510987659',
      bpIbans: ['PT50003501230001122330088'],
      docDate: '2026-10-25',
      dueDate: '2026-11-05',
      currency: 'EUR',
      docTotal: 1845.0,
      openAmount: 1845.0,
      multibancoEntity: '21345',
      multibancoRef: '104200890',
      comments: 'Venda Equipamento Industrial - Multibanco',
    },
    {
      docType: 'AR_INVOICE',
      docEntry: 102,
      docNum: 1055,
      atDocNumber: 'FT 2026/1055',
      cardCode: 'C10025',
      cardName: 'TechLusitana Sistemas SA',
      nif: '509876544',
      bpIbans: ['PT50001800031928374650055'],
      docDate: '2026-10-29',
      dueDate: '2026-11-12',
      currency: 'EUR',
      docTotal: 4305.0,
      openAmount: 4305.0,
      comments: 'Licenciamento Anual Cloud On-Prem',
    },
    {
      docType: 'AR_INVOICE',
      docEntry: 103,
      docNum: 1068,
      atDocNumber: 'FT 2026/1068',
      cardCode: 'C10040',
      cardName: 'Metalúrgica do Tejo Lda',
      nif: '502345675',
      bpIbans: [],
      docDate: '2026-11-12',
      dueDate: '2026-11-20',
      currency: 'EUR',
      docTotal: 750.0,
      openAmount: 750.0,
      comments: 'Serviços de Manutenção Preventiva',
    },
    {
      docType: 'AR_INVOICE',
      docEntry: 104,
      docNum: 1070,
      atDocNumber: 'FT 2026/1070',
      cardCode: 'C10088',
      cardName: 'Corticeira do Sul SA',
      nif: '507654323',
      bpIbans: ['PT50003302009988776650017'],
      docDate: '2026-10-18',
      dueDate: '2026-11-07',
      currency: 'EUR',
      docTotal: 1230.0,
      openAmount: 1230.0,
      comments: 'Lote Rolhas Exportação #1',
    },
    {
      docType: 'AR_INVOICE',
      docEntry: 105,
      docNum: 1071,
      atDocNumber: 'FT 2026/1071',
      cardCode: 'C10088',
      cardName: 'Corticeira do Sul SA',
      nif: '507654323',
      bpIbans: ['PT50003302009988776650017'],
      docDate: '2026-10-22',
      dueDate: '2026-11-08',
      currency: 'EUR',
      docTotal: 2460.0,
      openAmount: 2460.0,
      comments: 'Lote Rolhas Exportação #2',
    },
    {
      docType: 'AP_INVOICE',
      docEntry: 201,
      docNum: 5021,
      atDocNumber: 'FA 2026/5021',
      cardCode: 'V20015',
      cardName: 'Energia Ibérica Lda',
      nif: '501234560',
      bpIbans: [],
      docDate: '2026-11-01',
      dueDate: '2026-11-15',
      currency: 'EUR',
      docTotal: 1599.0,
      openAmount: 1599.0,
      comments: 'Fornecimento Eletricidade Industrial Novembro',
    },
  ];

  private unreconciledJournalLines: B1UnreconciledJournalLine[] = [
    {
      transId: 9001,
      lineId: 0,
      refDate: '2026-11-11',
      dueDate: '2026-11-12',
      glAccountCode: '120101',
      debit: 0,
      credit: 2460.0,
      signedAmount: -2460.0,
      ref1: '4012',
      ref2: 'OP 4012',
      memo: 'Pagamentos Efetuados - V20008 - Logística Norte',
      contraAct: 'V20008',
      cardCode: 'V20008',
      cardName: 'Logística Norte Transportes Lda',
      nif: '504433229',
      sourceType: '46',
      sourceDocNum: 4012,
    },
    {
      transId: 9002,
      lineId: 0,
      refDate: '2026-11-18',
      dueDate: '2026-11-19',
      glAccountCode: '120102',
      debit: 984.0,
      credit: 0,
      signedAmount: 984.0,
      ref1: '3015',
      ref2: 'FT 2026/1080',
      memo: 'Recebimentos de Clientes - C10010 - Cliente Delta',
      contraAct: 'C10010',
      cardCode: 'C10010',
      cardName: 'Cliente Delta Comércio Lda',
      nif: '510987659',
      sourceType: '24',
      sourceDocNum: 3015,
    },
  ];

  private nextPaymentDocEntry = 7001;
  private nextTransId = 9501;

  async testConnection(): Promise<{
    ok: boolean;
    latencyMs: number;
    schema: string;
    houseBanksCount: number;
    openDocumentsCount: number;
  }> {
    const [banks, docs] = await Promise.all([
      this.getHouseBanks(),
      this.getAllOpenDocuments(),
    ]);
    return {
      ok: true,
      latencyMs: 1,
      schema: 'SBO_MOCK_PT',
      houseBanksCount: banks.length,
      openDocumentsCount: docs.length,
    };
  }

  async getHouseBanks(): Promise<HouseBankAccount[]> {
    return [
      {
        id: 'hb-mt940-main',
        bankCode: '0035',
        bankName: 'Conta Bancária Principal',
        accountLabel: 'Conta DO Principal (EUR)',
        iban: 'PT50003506510008432190079',
        accountNumber: '0651000843219',
        glAccountCode: '120101',
        glAccountName: 'Depósitos à Ordem - Conta Principal EUR',
        currency: 'EUR',
        defaultFormat: 'MT940',
      },
      {
        id: 'hb-norma43-main',
        bankCode: '0033',
        bankName: 'Conta Bancária Tesouraria',
        accountLabel: 'Conta DO Tesouraria (EUR)',
        iban: 'PT50003300004561234567862',
        accountNumber: '4561234567',
        glAccountCode: '120102',
        glAccountName: 'Depósitos à Ordem - Tesouraria EUR',
        currency: 'EUR',
        defaultFormat: 'NORMA43',
      },
    ];
  }

  async getOpenDocuments(direction: 'CREDIT' | 'DEBIT'): Promise<B1OpenDocument[]> {
    const allowed: B1DocumentType[] =
      direction === 'CREDIT' ? ['AR_INVOICE', 'AR_CREDIT_MEMO'] : ['AP_INVOICE', 'AP_CREDIT_MEMO'];
    return this.openDocs.filter((d) => allowed.includes(d.docType) && Math.abs(d.openAmount) > 0.009);
  }

  async getAllOpenDocuments(): Promise<B1OpenDocument[]> {
    return this.openDocs.filter((d) => Math.abs(d.openAmount) > 0.009);
  }

  async getUnreconciledJournalLines(glAccountCode: string): Promise<B1UnreconciledJournalLine[]> {
    return this.unreconciledJournalLines.filter((j) => j.glAccountCode === glAccountCode);
  }

  /** Used by MockServiceLayerClient to reflect posted payments immediately */
  recordMockPayment(opts: {
    direction: 'INCOMING' | 'OUTGOING';
    cardCode: string;
    glAccountCode: string;
    date: string;
    transferSum?: number;
    allocations: Array<{ docEntry: number; allocatedAmount: number }>;
  }): { docEntry: number; transId: number; transLineId: number } {
    const docEntry = this.nextPaymentDocEntry++;
    const transId = this.nextTransId++;
    let total = 0;

    for (const alloc of opts.allocations) {
      total += alloc.allocatedAmount;
      const doc = this.openDocs.find((d) => d.docEntry === alloc.docEntry);
      if (doc) {
        if (doc.openAmount >= 0) {
          doc.openAmount = Math.max(0, Math.round((doc.openAmount - Math.abs(alloc.allocatedAmount)) * 100) / 100);
        } else {
          doc.openAmount = Math.min(0, Math.round((doc.openAmount + Math.abs(alloc.allocatedAmount)) * 100) / 100);
        }
      }
    }

    const effectiveSum = opts.transferSum ?? total;
    const signedAmount = opts.direction === 'INCOMING' ? effectiveSum : -effectiveSum;
    this.unreconciledJournalLines.push({
      transId,
      lineId: 0,
      refDate: opts.date,
      dueDate: opts.date,
      glAccountCode: opts.glAccountCode,
      debit: opts.direction === 'INCOMING' ? effectiveSum : 0,
      credit: opts.direction === 'OUTGOING' ? effectiveSum : 0,
      signedAmount,
      ref1: String(docEntry),
      contraAct: opts.cardCode,
      cardCode: opts.cardCode,
      sourceType: opts.direction === 'INCOMING' ? '24' : '46',
      sourceDocNum: docEntry,
    });

    return { docEntry, transId, transLineId: 0 };
  }

  /** Used by MockServiceLayerClient to mark a Journal Entry line as reconciled (ExtrMatch > 0) */
  markMockJournalLineReconciled(transId: number, lineId: number): void {
    this.unreconciledJournalLines = this.unreconciledJournalLines.filter(
      (j) => !(j.transId === transId && j.lineId === lineId)
    );
  }
}
