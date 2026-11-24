import {
  decodeStatementBytes,
  detectStatementFormat,
  filterManualJournalLines,
  filterManualOpenDocuments,
  parseMt940,
  parseNorma43,
  scoreSingleBankLine,
  type ApproveReconciliationRequest,
  type AuditLogRecord,
  type B1DocumentType,
  type B1OpenDocument,
  type B1UnreconciledJournalLine,
  type DashboardSummary,
  type GlMatchingRule,
  type HouseBankAccount,
  type ParsedBankStatement,
  type StagedBankLine,
  type StatementImportResponse,
  type StatementPreviewResponse,
} from '@b1-recon/shared';
import type { ConnectionSettingsDto, ConnectionTestResultDto } from './api';

const STATE_STORAGE_KEY = 'B1_RECON_WEBCLIENT_STATE_V1';

const SAMPLE_MT940 = `{1:F01BANKPTPLXXXX0000000000}{2:I940BANKPTPLXXXXN}{4:
:20:STMT20261120001
:25:PT50003506510008432190079
:28C:00112/001
:60F:C261101EUR45200,00
:61:2611051105CE1845,00NMSCMBREF000001//BNK2026110501
:86:COB MULTIBANCO ENT 21345 REF 104 200 890
CLIENTE DELTA COMERCIO LDA LIQUIDACAO FATURA
:61:2611101110CE4305,00NTRFSEPA88219//BNK2026111002
:86:TRF SEPA /EREF/END2END-TL-1055 ORDENANTE: TECHLUSITANA SISTEMAS SA
IBAN PT50001800031928374650055 NIF 509876544 PAG FT 2026/1055
:61:2611121112DE2460,00NTRF770012//BNK2026111203
:86:TRF SEPA BENEFICIARIO: LOGISTICA NORTE TRANSPORTES LDA
IBAN PT50001000128877665540058 NIF 504433229 PAG OP 4012
:61:2611181118CE750,00NTRF991004//BNK2026111804
:86:TRANSFERENCIA BANCARIA ADIANTAMENTO LIQUIDACAO CONTA
:62F:C261120EUR49640,00
-}`;

const SAMPLE_NORMA43 = [
  '110033000045612345672611012611222000000028500009783EMPRESA LUSITANA SA          ',
  '22    0000261108261108020122000000003690000000800101000507654323N4320261108A    ',
  '2301ORDENANTE: CORTICEIRA DO SUL SA       PT50003302009988776650017 NIF507654323',
  '22    0000261114261114040451000000001599000000800102000501234560FA 2026/5021    ',
  '2301BENEFICIARIO: ENERGIA IBERICA LDA     LIQ FATURA 5021 NIF 501234560         ',
  '22    0000261119261119020122000000000984000000800103000000001080RC 3015         ',
  '2301TRF CLIENTE DELTA COMERCIO LDA        PT50003501230001122330088 FT 2026/1080',
  '3300330000456123456700001000000001599000000200000000467400200000003157500978    ',
  '88999999999999999999000008                                                      ',
].join('\n');

interface LocalReconState {
  houseBanks: HouseBankAccount[];
  lines: StagedBankLine[];
  glRules: GlMatchingRule[];
  auditLogs: AuditLogRecord[];
  nextAuditId: number;
}

const DEFAULT_HOUSE_BANKS: HouseBankAccount[] = [
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

const DEFAULT_GL_RULES: GlMatchingRule[] = [
  {
    id: 'rule-bank-fee',
    name: 'Comissões e Serviços Bancários',
    direction: 'DEBIT',
    keywordsPattern: 'COMISSAO,COMISSÃO,MANUTENCAO,DESPESA BANCARIA,PORTES,ANUIDADE',
    glAccountCode: '622701',
    glAccountName: 'Serviços Bancários',
    confidence: 94,
  },
  {
    id: 'rule-stamp-duty',
    name: 'Imposto do Selo Bancário',
    direction: 'DEBIT',
    keywordsPattern: 'IMPOSTO DO SELO,IMP SELO,I.SELO,IS ART',
    glAccountCode: '681201',
    glAccountName: 'Imposto do Selo',
    confidence: 95,
  },
  {
    id: 'rule-interest-exp',
    name: 'Juros Suportados',
    direction: 'DEBIT',
    keywordsPattern: 'JUROS DEVEDORES,JUROS SUPORTADOS',
    glAccountCode: '691101',
    glAccountName: 'Juros Suportados - Financiamentos',
    confidence: 92,
  },
  {
    id: 'rule-interest-inc',
    name: 'Juros Obtidos de Depósitos',
    direction: 'CREDIT',
    keywordsPattern: 'JUROS CREDORES,JUROS DEPOSITO,JUROS OBTIDOS',
    glAccountCode: '791101',
    glAccountName: 'Juros Obtidos - Depósitos Bancários',
    confidence: 92,
  },
];

function loadState(): LocalReconState {
  try {
    const raw = localStorage.getItem(STATE_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as LocalReconState;
      if (parsed && Array.isArray(parsed.lines)) return parsed;
    }
  } catch {
    // Fallback to initial state
  }
  return {
    houseBanks: DEFAULT_HOUSE_BANKS,
    lines: [],
    glRules: DEFAULT_GL_RULES,
    auditLogs: [],
    nextAuditId: 1,
  };
}

function saveState(state: LocalReconState): void {
  localStorage.setItem(STATE_STORAGE_KEY, JSON.stringify(state));
}

function recordAudit(state: LocalReconState, b1User: string, action: string, details: Record<string, unknown>, bankLineId?: string): void {
  state.auditLogs.unshift({
    id: state.nextAuditId++,
    createdAt: new Date().toISOString(),
    b1User,
    action,
    bankLineId,
    detailsJson: JSON.stringify(details),
  });
  if (state.auditLogs.length > 100) state.auditLogs.length = 100;
}

/**
 * Calls the SAP Business One Service Layer directly via same-origin relative URLs (/b1s/v1/...).
 * Because /b1s/v1/ is on 'self' inside the SAP B1 Web Client, this complies 100% with the
 * Web Client's Content Security Policy (CSP) and automatically uses the user's active session.
 */
async function b1sFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const normalizedPath = path.startsWith('/b1s/v1') ? path.slice('/b1s/v1'.length) : path;
  const res = await fetch(`/b1s/v1${normalizedPath.startsWith('/') ? '' : '/'}${normalizedPath}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'odata.maxpagesize=500',
      ...(init?.headers ?? {}),
    },
    ...init,
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Service Layer /b1s/v1${normalizedPath} (${res.status}): ${txt}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/**
 * Fetches all pages of an OData entity collection from SAP B1 Service Layer using deterministic $skip pagination.
 * Without Prefer: odata.maxpagesize and following pages, SAP B1 Service Layer returns only 20 records per request.
 * Uses $skip on the original query path so reverse-proxy nextLink rewrites never break pagination,
 * and preserves all fetched pages even if a later page fails.
 */
async function b1sFetchAllPages<T = Record<string, unknown>>(
  initialPath: string,
  maxRecords = 5000
): Promise<T[]> {
  const all: T[] = [];
  const baseWithoutSkip = initialPath.replace(/[?&]\$skip=\d+/g, '');
  const sep = baseWithoutSkip.includes('?') ? '&' : '?';
  let firstPageLen = 0;

  while (all.length < maxRecords) {
    const pageUrl = all.length === 0 ? baseWithoutSkip : `${baseWithoutSkip}${sep}$skip=${all.length}`;
    let page: {
      value?: T[];
      '@odata.nextLink'?: string;
      'odata.nextLink'?: string;
    };
    try {
      page = await b1sFetch(pageUrl);
    } catch {
      break;
    }

    const items = Array.isArray(page?.value) ? page.value : [];
    if (items.length === 0) {
      break;
    }

    if (firstPageLen === 0) {
      firstPageLen = items.length;
    }

    all.push(...items);

    const hasNextLink = Boolean(page['@odata.nextLink'] || page['odata.nextLink']);
    // Continue if Service Layer indicates a nextLink OR if the page was full (e.g. 20 items default page size)
    if (!hasNextLink && items.length < firstPageLen) {
      break;
    }
    if (!hasNextLink && items.length < 20) {
      break;
    }
  }

  return all;
}

interface LiveB1ContextData {
  fetchedAt: number;
  houseBanks: HouseBankAccount[];
  creditDocs: B1OpenDocument[];
  debitDocs: B1OpenDocument[];
  journalByGl: Map<string, B1UnreconciledJournalLine[]>;
}

let cachedB1Data: LiveB1ContextData | null = null;
let inFlightB1ContextPromise: Promise<LiveB1ContextData> | null = null;
let cachedSeriesNameByCode: Map<number, string> | null = null;
const cachedBpByCode = new Map<string, { cardName: string; nif?: string }>();

async function loadSeriesMapOnce(): Promise<Map<number, string>> {
  if (cachedSeriesNameByCode) return cachedSeriesNameByCode;
  const map = new Map<number, string>();
  await Promise.all(
    ['13', '14', '18', '19'].map(async (docObjType) => {
      try {
        const srRes = await b1sFetch<{
          value?: Array<{ Series?: number; Name?: string }>;
        }>('/SeriesService_GetDocumentSeries', {
          method: 'POST',
          body: JSON.stringify({
            DocumentTypeParams: { Document: docObjType },
          }),
        });
        for (const s of srRes?.value ?? []) {
          if (s.Series != null && s.Name) {
            map.set(Number(s.Series), String(s.Name).trim());
          }
        }
      } catch {
        // Fallback to numeric Series code if SeriesService is restricted
      }
    })
  );
  cachedSeriesNameByCode = map;
  return map;
}

async function fetchLiveB1Context(state: LocalReconState, forceRefresh = false): Promise<LiveB1ContextData> {
  if (!forceRefresh && cachedB1Data && Date.now() - cachedB1Data.fetchedAt < 60_000) {
    return cachedB1Data;
  }
  if (!forceRefresh && inFlightB1ContextPromise) {
    return inFlightB1ContextPromise;
  }

  inFlightB1ContextPromise = (async (): Promise<LiveB1ContextData> => {
    try {
      const docSelect =
        "$filter=DocumentStatus eq 'bost_Open' and Cancelled eq 'tNO'&$select=DocEntry,DocNum,Series,NumAtCard,CardCode,CardName,FederalTaxID,DocDate,DocDueDate,DocCurrency,DocTotal,PaidToDate,Comments&$orderby=DocDate desc";

      const [hbRes, seriesNameByCode, arInvs, arCms, apInvs, apCms, jeList] = await Promise.all([
        b1sFetch<{
          value?: Array<{
            AbsoluteEntry: number;
            BankCode: string;
            AccountName?: string;
            IBAN?: string;
            AccNo: string;
            GLAccount: string;
          }>;
        }>('/HouseBankAccounts?$select=AbsoluteEntry,BankCode,AccountName,IBAN,AccNo,GLAccount').catch(
          () => ({ value: [] })
        ),
        loadSeriesMapOnce(),
        b1sFetchAllPages<Record<string, unknown>>(`/Invoices?${docSelect}`, 5000).catch(() => []),
        b1sFetchAllPages<Record<string, unknown>>(`/CreditNotes?${docSelect}`, 1500).catch(() => []),
        b1sFetchAllPages<Record<string, unknown>>(`/PurchaseInvoices?${docSelect}`, 5000).catch(() => []),
        b1sFetchAllPages<Record<string, unknown>>(`/PurchaseCreditNotes?${docSelect}`, 1500).catch(() => []),
        b1sFetchAllPages<{
          JdtNum: number;
          ReferenceDate?: string;
          DueDate?: string;
          Memo?: string;
          Reference?: string;
          Reference2?: string;
          BaseReference?: string;
          JournalEntryLines?: Array<{
            Line_ID: number;
            AccountCode: string;
            Debit?: number;
            Credit?: number;
            ShortName?: string;
            ContraAccount?: string;
            LineMemo?: string;
            Reference1?: string;
            Reference2?: string;
          }>;
        }>(
          '/JournalEntries?$select=JdtNum,ReferenceDate,DueDate,Memo,Reference,Reference2,BaseReference,JournalEntryLines&$orderby=JdtNum desc',
          300
        ).catch(() => []),
      ]);

      let houseBanks = state.houseBanks;
      if (hbRes.value && hbRes.value.length > 0) {
        const mappedBanks: HouseBankAccount[] = hbRes.value
          .filter((h) => Boolean(h.GLAccount))
          .map((h) => ({
            id: `hb-${h.AbsoluteEntry}`,
            bankCode: String(h.BankCode || 'BANK'),
            bankName: String(h.AccountName || h.BankCode || 'Bank'),
            accountLabel: String(h.AccountName || h.AccNo),
            iban: String(h.IBAN || '').replace(/\s+/g, ''),
            accountNumber: String(h.AccNo || ''),
            glAccountCode: String(h.GLAccount),
            glAccountName: `G/L ${h.GLAccount}`,
            currency: 'EUR',
            defaultFormat: 'MT940',
          }));
        if (mappedBanks.length > 0) {
          houseBanks = mappedBanks;
          state.houseBanks = houseBanks;
          saveState(state);
        }
      }

      const mapServiceLayerDocs = (
        items: Array<Record<string, unknown>>,
        docType: B1DocumentType,
        sign: 1 | -1
      ): B1OpenDocument[] => {
        const results: B1OpenDocument[] = [];
        for (const r of items) {
          const total = Number(r.DocTotal ?? 0);
          const paid = Number(r.PaidToDate ?? 0);
          let openAbs = Math.round((total - paid) * 100) / 100;
          // If DocumentStatus is 'bost_Open' in SAP B1, never silently drop the document if PaidToDate calculation is 0
          if (openAbs <= 0.009 && total > 0.009) {
            openAbs = Math.round(total * 100) / 100;
          }
          if (openAbs <= 0.009) continue;

          const cardCode = String(r.CardCode ?? '');
          const cardName = String(r.CardName ?? cardCode);
          const docNif = String(r.FederalTaxID ?? '').replace(/^PT/i, '').trim();
          if (cardCode && cardName) {
            cachedBpByCode.set(cardCode, {
              cardName,
              nif: docNif || cachedBpByCode.get(cardCode)?.nif,
            });
          }
          const seriesCode = r.Series != null ? Number(r.Series) : undefined;
          const seriesName =
            (seriesCode != null ? seriesNameByCode.get(seriesCode) : undefined) ||
            (r.SeriesString ? String(r.SeriesString).trim() : undefined) ||
            (seriesCode != null ? `Série ${seriesCode}` : undefined);

          const numAtCard = r.NumAtCard ? String(r.NumAtCard).trim() : undefined;
          const docNum = Number(r.DocNum);
          const formattedDocLabel =
            seriesName && !seriesName.startsWith('Série ')
              ? `${seriesName}/${docNum}`
              : numAtCard || undefined;

          results.push({
            docType,
            docEntry: Number(r.DocEntry),
            docNum,
            seriesCode,
            seriesName,
            atDocNumber: numAtCard || formattedDocLabel,
            cardCode,
            cardName,
            nif: docNif || undefined,
            bpIbans: [],
            docDate: String(r.DocDate ?? '').slice(0, 10),
            dueDate: String(r.DocDueDate ?? r.DocDate ?? '').slice(0, 10),
            currency: String(r.DocCurrency ?? 'EUR'),
            docTotal: sign * total,
            openAmount: sign * openAbs,
            comments: r.Comments ? String(r.Comments) : undefined,
          });
        }
        return results;
      };

      const creditDocs = [
        ...mapServiceLayerDocs(arInvs, 'AR_INVOICE', 1),
        ...mapServiceLayerDocs(arCms, 'AR_CREDIT_MEMO', -1),
      ];

      const debitDocs = [
        ...mapServiceLayerDocs(apInvs, 'AP_INVOICE', 1),
        ...mapServiceLayerDocs(apCms, 'AP_CREDIT_MEMO', -1),
      ];

      const resolveJeCardCode = (
        je: {
          Memo?: string;
          JournalEntryLines?: Array<{
            AccountCode: string;
            ShortName?: string;
            ContraAccount?: string;
            LineMemo?: string;
          }>;
        },
        line: {
          AccountCode: string;
          ShortName?: string;
          ContraAccount?: string;
          LineMemo?: string;
        }
      ): string | undefined => {
        if (line.ShortName && line.ShortName !== line.AccountCode) return line.ShortName;
        if (line.ContraAccount && line.ContraAccount !== line.AccountCode && !/^\d{5,}$/.test(line.ContraAccount)) {
          return line.ContraAccount;
        }
        const siblingBp = (je.JournalEntryLines ?? []).find(
          (s) => s.ShortName && s.ShortName !== s.AccountCode
        );
        if (siblingBp?.ShortName) return siblingBp.ShortName;
        if (line.ContraAccount && line.ContraAccount !== line.AccountCode) return line.ContraAccount;
        const memoText = line.LineMemo || je.Memo || '';
        const memoMatch = memoText.match(/-\s*([A-Za-z0-9_-]{3,20})\s*$/);
        return memoMatch ? memoMatch[1] : undefined;
      };

      const missingBpCodes = new Set<string>();
      for (const je of jeList) {
        for (const line of je.JournalEntryLines ?? []) {
          const code = resolveJeCardCode(je, line);
          if (code && !cachedBpByCode.has(code)) {
            missingBpCodes.add(code);
          }
        }
      }

      if (missingBpCodes.size > 0) {
        const batchCodes = Array.from(missingBpCodes).slice(0, 30);
        const filterExpr = batchCodes
          .map((c) => `CardCode eq '${c.replace(/'/g, "''")}'`)
          .join(' or ');
        try {
          const bpRes = await b1sFetch<{
            value?: Array<{ CardCode: string; CardName?: string; FederalTaxID?: string }>;
          }>(`/BusinessPartners?$select=CardCode,CardName,FederalTaxID&$filter=${encodeURIComponent(filterExpr)}`);
          for (const bp of bpRes.value ?? []) {
            if (bp.CardCode && bp.CardName) {
              cachedBpByCode.set(bp.CardCode, {
                cardName: String(bp.CardName).trim(),
                nif: String(bp.FederalTaxID ?? '').replace(/^PT/i, '').trim() || undefined,
              });
            }
          }
        } catch {
          // Ignore if BusinessPartners endpoint is restricted
        }
      }

      const journalByGl = new Map<string, B1UnreconciledJournalLine[]>();
      for (const je of jeList) {
        for (const line of je.JournalEntryLines ?? []) {
          const debit = Number(line.Debit ?? 0);
          const credit = Number(line.Credit ?? 0);
          const signedAmount = Math.round((debit - credit) * 100) / 100;
          if (Math.abs(signedAmount) < 0.009) continue;

          const cardCode = resolveJeCardCode(je, line);
          const bpInfo = cardCode ? cachedBpByCode.get(cardCode) : undefined;

          const list = journalByGl.get(line.AccountCode) ?? [];
          list.push({
            transId: Number(je.JdtNum),
            lineId: Number(line.Line_ID),
            refDate: String(je.ReferenceDate ?? '').slice(0, 10),
            dueDate: String(je.DueDate ?? je.ReferenceDate ?? '').slice(0, 10),
            glAccountCode: line.AccountCode,
            debit,
            credit,
            signedAmount,
            ref1: line.Reference1 || je.Reference,
            ref2: line.Reference2 || je.Reference2,
            memo: line.LineMemo || je.Memo,
            contraAct: line.ContraAccount || line.ShortName,
            cardCode,
            cardName: bpInfo?.cardName,
            nif: bpInfo?.nif,
            sourceDocNum: je.BaseReference ? Number(je.BaseReference) : undefined,
          });
          journalByGl.set(line.AccountCode, list);
        }
      }

      cachedB1Data = {
        fetchedAt: Date.now(),
        houseBanks,
        creditDocs,
        debitDocs,
        journalByGl,
      };
      return cachedB1Data;
    } finally {
      inFlightB1ContextPromise = null;
    }
  })();

  return inFlightB1ContextPromise;
}

function findMatchingHouseBank(
  parsed: ParsedBankStatement,
  banks: HouseBankAccount[]
): HouseBankAccount {
  const cleanTargetIban = (parsed.normalizedIban ?? '').replace(/\s+/g, '').toUpperCase();
  const cleanTargetAcct = parsed.normalizedAccountNumber.replace(/\D/g, '');

  for (const hb of banks) {
    const hbIban = hb.iban.replace(/\s+/g, '').toUpperCase();
    const hbAcct = hb.accountNumber.replace(/\D/g, '');
    if (cleanTargetIban && hbIban === cleanTargetIban) return hb;
    if (
      cleanTargetAcct &&
      hbAcct &&
      (hbIban.includes(cleanTargetAcct) || hbAcct.includes(cleanTargetAcct) || cleanTargetAcct.includes(hbAcct))
    ) {
      return hb;
    }
  }
  return (
    banks.find((b) => b.bankCode === parsed.bankCode) ??
    banks.find((b) => b.defaultFormat === parsed.format) ??
    banks[0]
  );
}

function parseStatementFromBytes(bytes: Uint8Array, fileName?: string): ParsedBankStatement {
  const text = decodeStatementBytes(bytes);
  const format = detectStatementFormat(text, fileName);
  return format === 'MT940' ? parseMt940(text) : parseNorma43(text);
}

export const webClientB1sAdapter = {
  async testConnection(): Promise<ConnectionTestResultDto> {
    const start = Date.now();
    const state = loadState();
    try {
      const ctx = await fetchLiveB1Context(state, true);
      const latency = Date.now() - start;
      return {
        mode: 'live',
        hana: {
          ok: true,
          latencyMs: latency,
          schema: 'SAP B1 Web Client (/b1s/v1 Same-Origin)',
          houseBanksCount: ctx.houseBanks.length,
          openDocumentsCount: ctx.creditDocs.length + ctx.debitDocs.length,
        },
        serviceLayer: {
          ok: true,
          latencyMs: latency,
          authenticatedUser: 'Sessão Ativa SAP B1 Web Client',
          companyDb: 'Ligado via Proxy /b1s/v1',
        },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        mode: 'live',
        hana: { ok: false, error: msg },
        serviceLayer: { ok: false, error: msg },
      };
    }
  },

  async getConnectionSettings(): Promise<ConnectionSettingsDto> {
    return {
      mode: 'live',
      hanaHost: window.location.hostname,
      hanaPort: 30015,
      hanaSchema: 'WEBCLIENT_SAME_ORIGIN',
      hanaReadonlyUser: 'Sessão Web Client (/b1s/v1)',
      hasHanaPassword: true,
      hanaEncrypt: true,
      hanaSslValidateCert: false,
      b1ServiceLayerUrl: `${window.location.origin}/b1s/v1`,
      b1CompanyDb: 'WEBCLIENT_SESSION',
      b1TechUser: 'Sessão Ativa Web Client',
      hasB1TechPassword: true,
      b1RejectUnauthorizedTls: false,
    };
  },

  async getDashboard(houseBankId?: string): Promise<{
    houseBanks: HouseBankAccount[];
    summary: DashboardSummary;
  }> {
    const state = loadState();
    const ctx = await fetchLiveB1Context(state);

    // Score pending lines to keep topConfidence accurate
    for (const l of state.lines) {
      if (l.status === 'UNMATCHED' || l.status === 'SUGGESTED') {
        const docs = l.direction === 'CREDIT' ? ctx.creditDocs : ctx.debitDocs;
        const jes = ctx.journalByGl.get(l.glAccountCode) ?? [];
        const sugs = scoreSingleBankLine(l, jes, docs, state.glRules);
        l.topConfidence = sugs[0]?.confidence ?? 0;
        l.status = l.topConfidence >= 50 ? 'SUGGESTED' : 'UNMATCHED';
      }
    }
    saveState(state);

    const filtered =
      houseBankId && houseBankId !== 'ALL'
        ? state.lines.filter((l) => l.houseBankId === houseBankId)
        : state.lines;

    let totalUnreconciled = 0;
    let highConfidenceReady = 0;
    let needsReview = 0;
    let reconciledCount = 0;
    let unreconciledInflowEur = 0;
    let unreconciledOutflowEur = 0;

    for (const l of filtered) {
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
      houseBanks: ctx.houseBanks,
      summary: {
        mode: 'live',
        totalUnreconciled,
        highConfidenceReady,
        needsReview,
        reconciledCount,
        unreconciledInflowEur: Math.round(unreconciledInflowEur * 100) / 100,
        unreconciledOutflowEur: Math.round(unreconciledOutflowEur * 100) / 100,
      },
    };
  },

  async getLines(params: {
    houseBankId?: string;
    statusGroup?: 'PENDING' | 'RECONCILED' | 'IGNORED' | 'ALL';
    search?: string;
  }): Promise<{ lines: StagedBankLine[] }> {
    const state = loadState();
    const ctx = await fetchLiveB1Context(state);

    let list = [...state.lines];
    if (params.houseBankId && params.houseBankId !== 'ALL') {
      list = list.filter((l) => l.houseBankId === params.houseBankId);
    }
    if (params.statusGroup === 'PENDING') {
      list = list.filter((l) =>
        ['UNMATCHED', 'SUGGESTED', 'PAYMENT_CREATED', 'BANKPAGE_CREATED', 'ERROR'].includes(l.status)
      );
    } else if (params.statusGroup === 'RECONCILED') {
      list = list.filter((l) => l.status === 'RECONCILED');
    } else if (params.statusGroup === 'IGNORED') {
      list = list.filter((l) => l.status === 'IGNORED');
    }

    if (params.search?.trim()) {
      const q = params.search.trim().toLowerCase();
      list = list.filter(
        (l) =>
          l.description.toLowerCase().includes(q) ||
          l.bankReference.toLowerCase().includes(q) ||
          String(l.amount).includes(q) ||
          JSON.stringify(l.extracted).toLowerCase().includes(q)
      );
    }

    const enriched = list.map((l) => {
      if (l.status === 'RECONCILED' || l.status === 'IGNORED') {
        return { ...l, suggestions: [] };
      }
      const docs = l.direction === 'CREDIT' ? ctx.creditDocs : ctx.debitDocs;
      const jes = ctx.journalByGl.get(l.glAccountCode) ?? [];
      const suggestions = scoreSingleBankLine(l, jes, docs, state.glRules);
      l.topConfidence = suggestions[0]?.confidence ?? 0;
      l.status = l.topConfidence >= 50 ? 'SUGGESTED' : 'UNMATCHED';
      return { ...l, suggestions };
    });

    saveState(state);
    return { lines: enriched };
  },

  async getManualCandidates(
    direction: 'CREDIT' | 'DEBIT',
    glAccountCode: string,
    search?: string,
    forceRefresh = false
  ): Promise<{ openDocuments: B1OpenDocument[]; journalLines: B1UnreconciledJournalLine[] }> {
    const state = loadState();
    const ctx = await fetchLiveB1Context(state, forceRefresh);
    let docs = [...(direction === 'CREDIT' ? ctx.creditDocs : ctx.debitDocs)];
    const jes = [...(ctx.journalByGl.get(glAccountCode) ?? [])];

    // If the user typed a search query, also query Service Layer directly so any document beyond initial pages is found
    const q = (search ?? '').trim();
    if (q.length >= 2) {
      const safeQ = q.replace(/'/g, "''");
      const numVal = /^\d+$/.test(q) ? Number(q) : null;
      const filterClauses = [
        `contains(NumAtCard, '${safeQ}')`,
        `contains(CardCode, '${safeQ.toUpperCase()}')`,
        `contains(CardName, '${safeQ}')`,
      ];
      if (numVal !== null) {
        filterClauses.unshift(`DocNum eq ${numVal}`);
      }
      const searchFilter = `$filter=DocumentStatus eq 'bost_Open' and Cancelled eq 'tNO' and (${filterClauses.join(
        ' or '
      )})&$select=DocEntry,DocNum,Series,NumAtCard,CardCode,CardName,FederalTaxID,DocDate,DocDueDate,DocCurrency,DocTotal,PaidToDate,Comments`;

      const invEndpoint = direction === 'CREDIT' ? '/Invoices' : '/PurchaseInvoices';
      const cmEndpoint = direction === 'CREDIT' ? '/CreditNotes' : '/PurchaseCreditNotes';
      const invType: B1DocumentType = direction === 'CREDIT' ? 'AR_INVOICE' : 'AP_INVOICE';
      const cmType: B1DocumentType = direction === 'CREDIT' ? 'AR_CREDIT_MEMO' : 'AP_CREDIT_MEMO';

      const [extraInvs, extraCms, seriesMap] = await Promise.all([
        b1sFetch<{ value?: Array<Record<string, unknown>> }>(`${invEndpoint}?${searchFilter}`).catch(() => ({
          value: [],
        })),
        b1sFetch<{ value?: Array<Record<string, unknown>> }>(`${cmEndpoint}?${searchFilter}`).catch(() => ({
          value: [],
        })),
        loadSeriesMapOnce(),
      ]);

      const existingKeys = new Set(docs.map((d) => `${d.docType}-${d.docEntry}`));
      const addExtra = (items: Array<Record<string, unknown>>, dt: B1DocumentType, sign: 1 | -1) => {
        for (const r of items) {
          const docEntry = Number(r.DocEntry);
          const key = `${dt}-${docEntry}`;
          if (existingKeys.has(key)) continue;
          const total = Number(r.DocTotal ?? 0);
          const paid = Number(r.PaidToDate ?? 0);
          let openAbs = Math.round((total - paid) * 100) / 100;
          if (openAbs <= 0.009 && total > 0.009) openAbs = total;
          if (openAbs <= 0.009) continue;

          const seriesCode = r.Series != null ? Number(r.Series) : undefined;
          const seriesName =
            (seriesCode != null ? seriesMap.get(seriesCode) : undefined) ||
            (seriesCode != null ? `Série ${seriesCode}` : undefined);
          const numAtCard = r.NumAtCard ? String(r.NumAtCard).trim() : undefined;
          const docNum = Number(r.DocNum);

          const mapped: B1OpenDocument = {
            docType: dt,
            docEntry,
            docNum,
            seriesCode,
            seriesName,
            atDocNumber:
              numAtCard || (seriesName && !seriesName.startsWith('Série ') ? `${seriesName}/${docNum}` : undefined),
            cardCode: String(r.CardCode ?? ''),
            cardName: String(r.CardName ?? ''),
            nif: String(r.FederalTaxID ?? '').replace(/^PT/i, '').trim() || undefined,
            bpIbans: [],
            docDate: String(r.DocDate ?? '').slice(0, 10),
            dueDate: String(r.DocDueDate ?? r.DocDate ?? '').slice(0, 10),
            currency: String(r.DocCurrency ?? 'EUR'),
            docTotal: sign * total,
            openAmount: sign * openAbs,
            comments: r.Comments ? String(r.Comments) : undefined,
          };
          docs.push(mapped);
          existingKeys.add(key);
          if (direction === 'CREDIT') ctx.creditDocs.push(mapped);
          else ctx.debitDocs.push(mapped);
        }
      };

      addExtra(extraInvs.value ?? [], invType, 1);
      addExtra(extraCms.value ?? [], cmType, -1);
    }

    return {
      openDocuments: docs,
      journalLines: jes,
    };
  },

  async previewStatement(file: File): Promise<StatementPreviewResponse> {
    const state = loadState();
    const buf = new Uint8Array(await file.arrayBuffer());
    const statement = parseStatementFromBytes(buf, file.name);
    const matchedHouseBank = findMatchingHouseBank(statement, state.houseBanks);
    const existingSet = new Set(state.lines.map((l) => l.fingerprint));
    const dupCount = statement.lines.filter((l) => existingSet.has(l.fingerprint)).length;

    return {
      detectedFormat: statement.format,
      bankCode: matchedHouseBank.bankCode,
      matchedHouseBank,
      statement,
      duplicateLinesCount: dupCount,
      newLinesCount: statement.lines.length - dupCount,
    };
  },

  async importStatement(file: File, houseBankId?: string): Promise<StatementImportResponse> {
    const state = loadState();
    const buf = new Uint8Array(await file.arrayBuffer());
    const statement = parseStatementFromBytes(buf, file.name);
    if (!statement.balanceVerified) {
      throw new Error('O saldo matemático do extrato não coincide.');
    }

    const houseBank =
      (houseBankId && houseBankId !== 'AUTO'
        ? state.houseBanks.find((h) => h.id === houseBankId)
        : undefined) ?? findMatchingHouseBank(statement, state.houseBanks);

    return this.stageParsedStatement(state, statement, houseBank);
  },

  async importSampleStatements(): Promise<{ importedLinesCount: number; skippedDuplicateCount: number }> {
    const state = loadState();
    const mt940 = parseMt940(SAMPLE_MT940);
    const n43 = parseNorma43(SAMPLE_NORMA43);

    const r1 = await this.stageParsedStatement(
      state,
      mt940,
      findMatchingHouseBank(mt940, state.houseBanks)
    );
    const r2 = await this.stageParsedStatement(
      state,
      n43,
      findMatchingHouseBank(n43, state.houseBanks)
    );
    return {
      importedLinesCount: r1.importedLinesCount + r2.importedLinesCount,
      skippedDuplicateCount: r1.skippedDuplicateCount + r2.skippedDuplicateCount,
    };
  },

  async stageParsedStatement(
    state: LocalReconState,
    statement: ParsedBankStatement,
    houseBank: HouseBankAccount
  ): Promise<StatementImportResponse> {
    const stmtId = `stmt-${Date.now()}`;
    const existingSet = new Set(state.lines.map((l) => l.fingerprint));
    let importedLinesCount = 0;
    let skippedDuplicateCount = 0;
    let autoSuggestedCount = 0;

    const ctx = await fetchLiveB1Context(state);

    for (const line of statement.lines) {
      if (existingSet.has(line.fingerprint)) {
        skippedDuplicateCount++;
        continue;
      }
      const staged: StagedBankLine = {
        id: `line-${stmtId}-${line.lineNumber}`,
        statementId: stmtId,
        houseBankId: houseBank.id,
        bankCode: houseBank.bankCode,
        glAccountCode: houseBank.glAccountCode,
        lineNumber: line.lineNumber,
        bookingDate: line.bookingDate,
        valueDate: line.valueDate,
        direction: line.direction,
        amount: line.amount,
        signedAmount: line.signedAmount,
        currency: line.currency,
        isReversal: line.isReversal,
        transactionCode: line.transactionCode,
        bankReference: line.bankReference,
        customerReference: line.customerReference,
        description: line.description,
        rawNarrative: line.rawNarrative,
        extracted: line.extracted,
        fingerprint: line.fingerprint,
        status: 'UNMATCHED',
        topConfidence: 0,
      };

      const docs = staged.direction === 'CREDIT' ? ctx.creditDocs : ctx.debitDocs;
      const jes = ctx.journalByGl.get(staged.glAccountCode) ?? [];
      const sugs = scoreSingleBankLine(staged, jes, docs, state.glRules);
      staged.topConfidence = sugs[0]?.confidence ?? 0;
      staged.status = staged.topConfidence >= 50 ? 'SUGGESTED' : 'UNMATCHED';
      if (staged.topConfidence >= 85) autoSuggestedCount++;

      state.lines.push(staged);
      importedLinesCount++;
    }

    recordAudit(state, 'webclient-user', 'STATEMENT_IMPORTED', {
      format: statement.format,
      houseBankId: houseBank.id,
      importedLinesCount,
      skippedDuplicateCount,
    });
    saveState(state);

    return {
      statementId: stmtId,
      houseBankId: houseBank.id,
      importedLinesCount,
      skippedDuplicateCount,
      autoSuggestedCount,
    };
  },

  async approveReconciliation(payload: ApproveReconciliationRequest): Promise<{ line: StagedBankLine }> {
    const state = loadState();
    const line = state.lines.find((l) => l.id === payload.bankLineId);
    if (!line) throw new Error('Movimento bancário não encontrado.');
    if (line.status === 'RECONCILED') return { line };

    try {
      let transId = line.b1TransId;
      let transLineId = line.b1TransLineId ?? 0;
      let paymentDocEntry = line.b1PaymentDocEntry;

      if (transId == null) {
        const ref = (line.bankReference || line.customerReference || line.id.slice(-12)).slice(0, 27);
        const remarks = `[B1-Recon ${line.bankCode}] ${line.description}`.slice(0, 240);

        if (payload.targetType === 'EXISTING_JOURNAL_ENTRY' && payload.journalSelection) {
          transId = payload.journalSelection.transId;
          transLineId = payload.journalSelection.lineId;
        } else if (payload.targetType === 'DIRECT_GL_ACCOUNT' && payload.glAccountSelection) {
          const endpoint = line.direction === 'CREDIT' ? '/IncomingPayments' : '/VendorPayments';
          const created = await b1sFetch<{ DocEntry: number; TransNum: number }>(endpoint, {
            method: 'POST',
            body: JSON.stringify({
              DocType: 'rAccount',
              DocDate: line.bookingDate,
              TransferAccount: line.glAccountCode,
              TransferSum: line.amount,
              TransferDate: line.valueDate,
              TransferReference: ref,
              Remarks: remarks,
              PaymentAccounts: [
                {
                  LineNum: 0,
                  AccountCode: payload.glAccountSelection.glAccountCode,
                  SumPaid: line.amount,
                  Decription: remarks,
                },
              ],
            }),
          });
          paymentDocEntry = Number(created.DocEntry);
          transId = Number(created.TransNum);
          line.b1PaymentDocEntry = paymentDocEntry;
          line.b1TransId = transId;
          line.status = 'PAYMENT_CREATED';
          saveState(state);
        } else if (payload.invoiceSelection) {
          const endpoint = line.direction === 'CREDIT' ? '/IncomingPayments' : '/VendorPayments';
          const docType = line.direction === 'CREDIT' ? 'rCustomer' : 'rSupplier';
          const mapInvType = (dt: B1DocumentType) => {
            if (dt === 'AR_INVOICE') return 'it_Invoice';
            if (dt === 'AR_CREDIT_MEMO') return 'it_CredItnote';
            if (dt === 'AP_INVOICE') return 'it_PurchaseInvoice';
            return 'it_PurchaseCreditNote';
          };

          const created = await b1sFetch<{ DocEntry: number; TransNum: number }>(endpoint, {
            method: 'POST',
            body: JSON.stringify({
              DocType: docType,
              CardCode: payload.invoiceSelection.cardCode,
              DocDate: line.bookingDate,
              TransferAccount: line.glAccountCode,
              TransferSum: line.amount,
              TransferDate: line.valueDate,
              TransferReference: ref,
              Remarks: remarks,
              PaymentInvoices: payload.invoiceSelection.allocations.map((a, idx) => ({
                LineNum: idx,
                DocEntry: a.docEntry,
                SumApplied: Math.abs(a.allocatedAmount),
                InvoiceType: mapInvType(a.docType),
              })),
            }),
          });
          paymentDocEntry = Number(created.DocEntry);
          transId = Number(created.TransNum);

          // Resolve exact Bank G/L Line_ID on the newly created JournalEntry
          const je = await b1sFetch<{
            JournalEntryLines?: Array<{ Line_ID: number; AccountCode: string }>;
          }>(`/JournalEntries(${transId})`).catch(() => ({ JournalEntryLines: [] }));
          transLineId =
            je.JournalEntryLines?.find((jl) => jl.AccountCode === line.glAccountCode)?.Line_ID ?? 0;

          line.b1PaymentDocEntry = paymentDocEntry;
          line.b1TransId = transId;
          line.b1TransLineId = transLineId;
          line.status = 'PAYMENT_CREATED';
          saveState(state);
        }
      }

      // Step 2: Create BankPage if not already created
      let bankPageSeq = line.b1BankPageSequence;
      if (bankPageSeq == null) {
        const bpCreated = await b1sFetch<{ Sequence: number }>('/BankPages', {
          method: 'POST',
          body: JSON.stringify({
            AccountCode: line.glAccountCode,
            DueDate: line.valueDate,
            DebitAmount: line.direction === 'DEBIT' ? line.amount : 0,
            CreditAmount: line.direction === 'CREDIT' ? line.amount : 0,
            DocNumberType: 'bpdt_DocNum',
            PaymentReference: (line.bankReference || line.customerReference || line.transactionCode).slice(0, 27),
            Details: line.description.slice(0, 250),
          }),
        });
        bankPageSeq = Number(bpCreated.Sequence);
        line.b1BankPageSequence = bankPageSeq;
        line.status = 'BANKPAGE_CREATED';
        saveState(state);
      }

      // Step 3: ExternalReconciliationsService_Reconcile
      await b1sFetch<void>('/ExternalReconciliationsService_Reconcile', {
        method: 'POST',
        body: JSON.stringify({
          ExternalReconciliation: {
            ReconciliationAccountType: 'rat_GLAccount',
            ReconciliationBankStatementLines: [
              {
                BankStatementAccountCode: line.glAccountCode,
                Sequence: bankPageSeq,
              },
            ],
            ReconciliationJournalEntryLines: [
              {
                TransactionNumber: transId,
                LineNumber: transLineId,
              },
            ],
          },
        }),
      });

      line.status = 'RECONCILED';
      line.errorMessage = undefined;
      line.reconciledAt = new Date().toISOString();
      line.reconciledBy = 'SAP B1 Web Client User';
      recordAudit(
        state,
        'webclient-user',
        'LINE_RECONCILED',
        {
          targetType: payload.targetType,
          amount: line.amount,
          b1PaymentDocEntry: paymentDocEntry,
          b1TransId: transId,
          b1BankPageSequence: bankPageSeq,
        },
        line.id
      );
      saveState(state);
      cachedB1Data = null; // Invalidate cache after write
      return { line };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      line.status = 'ERROR';
      line.errorMessage = msg;
      saveState(state);
      throw err;
    }
  },

  async batchApprove(
    minConfidence = 88,
    houseBankId?: string
  ): Promise<{ reconciledCount: number; errors: Array<{ bankLineId: string; error: string }> }> {
    const { lines } = await this.getLines({ houseBankId, statusGroup: 'PENDING' });
    let reconciledCount = 0;
    const errors: Array<{ bankLineId: string; error: string }> = [];

    for (const l of lines) {
      const top = l.suggestions?.[0];
      if (!top || top.confidence < minConfidence || Math.abs(top.differenceAmount) > 0.009) {
        continue;
      }
      try {
        await this.approveReconciliation({
          bankLineId: l.id,
          targetType: top.targetType,
          journalSelection: top.journalLine
            ? { transId: top.journalLine.transId, lineId: top.journalLine.lineId }
            : undefined,
          glAccountSelection: top.glAccountMatch
            ? {
                glAccountCode: top.glAccountMatch.glAccountCode,
                glAccountName: top.glAccountMatch.glAccountName,
              }
            : undefined,
          invoiceSelection:
            top.allocations && top.cardCode
              ? {
                  cardCode: top.cardCode,
                  allocations: top.allocations.map((a) => ({
                    docType: a.docType,
                    docEntry: a.docEntry,
                    allocatedAmount: a.allocatedAmount,
                  })),
                }
              : undefined,
        });
        reconciledCount++;
      } catch (err) {
        errors.push({
          bankLineId: l.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return { reconciledCount, errors };
  },

  async ignoreLine(bankLineId: string, reason?: string): Promise<{ line: StagedBankLine }> {
    const state = loadState();
    const line = state.lines.find((l) => l.id === bankLineId);
    if (!line) throw new Error('Movimento não encontrado.');
    line.status = 'IGNORED';
    recordAudit(state, 'webclient-user', 'LINE_IGNORED', { reason }, bankLineId);
    saveState(state);
    return { line };
  },

  async reopenLine(bankLineId: string): Promise<{ line: StagedBankLine }> {
    const state = loadState();
    const line = state.lines.find((l) => l.id === bankLineId);
    if (!line) throw new Error('Movimento não encontrado.');
    line.status = line.topConfidence >= 50 ? 'SUGGESTED' : 'UNMATCHED';
    line.errorMessage = undefined;
    recordAudit(state, 'webclient-user', 'LINE_REOPENED', {}, bankLineId);
    saveState(state);
    return { line };
  },

  async getGlRules(): Promise<{ rules: GlMatchingRule[] }> {
    return { rules: loadState().glRules };
  },

  async saveGlRule(rule: Omit<GlMatchingRule, 'id'> & { id?: string }): Promise<{ rule: GlMatchingRule }> {
    const state = loadState();
    const newRule: GlMatchingRule = {
      ...rule,
      id: rule.id || `rule-${Date.now()}`,
    };
    const idx = state.glRules.findIndex((r) => r.id === newRule.id);
    if (idx >= 0) state.glRules[idx] = newRule;
    else state.glRules.push(newRule);
    saveState(state);
    return { rule: newRule };
  },

  async deleteGlRule(id: string): Promise<{ ok: boolean }> {
    const state = loadState();
    state.glRules = state.glRules.filter((r) => r.id !== id);
    saveState(state);
    return { ok: true };
  },

  async getAuditLogs(): Promise<{ logs: AuditLogRecord[] }> {
    return { logs: loadState().auditLogs };
  },
};
