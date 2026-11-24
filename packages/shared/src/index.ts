export type BankCode = string;

export type StatementFormat = 'MT940' | 'NORMA43';

export type MovementDirection = 'CREDIT' | 'DEBIT';

export type ReconciliationStatus =
  | 'UNMATCHED'
  | 'SUGGESTED'
  | 'PAYMENT_CREATED'
  | 'BANKPAGE_CREATED'
  | 'RECONCILED'
  | 'IGNORED'
  | 'ERROR';

export type ConfidenceTier = 'HIGH' | 'MEDIUM' | 'LOW';

export type MatchTargetType =
  | 'EXISTING_JOURNAL_ENTRY'
  | 'OPEN_AR_INVOICE'
  | 'OPEN_AP_INVOICE'
  | 'MULTI_INVOICE_BUNDLE'
  | 'DIRECT_GL_ACCOUNT';

export type B1DocumentType =
  | 'AR_INVOICE'
  | 'AR_CREDIT_MEMO'
  | 'AP_INVOICE'
  | 'AP_CREDIT_MEMO';

export interface HouseBankAccount {
  id: string;
  bankCode: BankCode;
  bankName: string;
  accountLabel: string;
  iban: string;
  accountNumber: string;
  glAccountCode: string;
  glAccountName: string;
  currency: string;
  defaultFormat: StatementFormat;
}

export interface GlMatchingRule {
  id: string;
  name: string;
  direction: MovementDirection;
  keywordsPattern: string; // Comma-separated keywords or regex tokens, e.g. "COMISSAO,COMISSÃO,MANUTENCAO"
  glAccountCode: string;
  glAccountName: string;
  confidence: number;
}

export interface ExtractedPortugueseMetadata {
  counterpartyIban?: string;
  counterpartyNif?: string;
  counterpartyName?: string;
  multibancoEntity?: string;
  multibancoRef?: string;
  invoiceCandidates: string[];
  sepaEndToEndId?: string;
}

export interface ParsedStatementLine {
  lineNumber: number;
  bookingDate: string; // YYYY-MM-DD
  valueDate: string;   // YYYY-MM-DD
  direction: MovementDirection;
  /** Always positive; sign is determined by direction ('CREDIT' = inflow, 'DEBIT' = outflow) */
  amount: number;
  /** Signed amount (+ for CREDIT, - for DEBIT) */
  signedAmount: number;
  currency: string;
  isReversal: boolean;
  transactionCode: string;
  bankReference: string;
  customerReference: string;
  description: string;
  rawNarrative: string;
  extracted: ExtractedPortugueseMetadata;
  fingerprint: string;
}

export interface ParsedBankStatement {
  format: StatementFormat;
  bankCode: BankCode;
  statementId: string;
  accountIdentifier: string;
  normalizedIban?: string;
  normalizedAccountNumber: string;
  currency: string;
  periodStart: string; // YYYY-MM-DD
  periodEnd: string;   // YYYY-MM-DD
  openingBalance: number; // Signed (+ credit, - debit)
  closingBalance: number; // Signed (+ credit, - debit)
  calculatedClosingBalance: number;
  balanceVerified: boolean;
  balanceDiscrepancy: number;
  totalCredits: number;
  totalDebits: number;
  lines: ParsedStatementLine[];
}

export interface StagedBankLine {
  id: string;
  statementId: string;
  houseBankId: string;
  bankCode: BankCode;
  format?: StatementFormat;
  glAccountCode: string;
  lineNumber: number;
  bookingDate: string;
  valueDate: string;
  direction: MovementDirection;
  amount: number;
  signedAmount: number;
  currency: string;
  isReversal: boolean;
  transactionCode: string;
  bankReference: string;
  customerReference: string;
  description: string;
  rawNarrative?: string;
  extracted: ExtractedPortugueseMetadata;
  fingerprint: string;
  status: ReconciliationStatus;
  topConfidence: number;
  b1PaymentDocEntry?: number;
  b1TransId?: number;
  b1TransLineId?: number;
  b1BankPageSequence?: number;
  errorMessage?: string;
  reconciledAt?: string;
  reconciledBy?: string;
  suggestions?: MatchSuggestion[];
}

export interface B1OpenDocument {
  docType: B1DocumentType;
  docEntry: number;
  docNum: number;
  atDocNumber?: string; // e.g. FT 2026/1042 or NC 2026/15
  cardCode: string;
  cardName: string;
  nif?: string;
  bpIbans: string[];
  docDate: string;
  dueDate: string;
  currency: string;
  /** Positive for Invoices, negative for Credit Memos when netting */
  docTotal: number;
  /** Positive for Invoices, negative for Credit Memos when netting */
  openAmount: number;
  multibancoEntity?: string;
  multibancoRef?: string;
  comments?: string;
}

export interface B1UnreconciledJournalLine {
  transId: number;
  lineId: number;
  refDate: string;
  dueDate: string;
  glAccountCode: string;
  debit: number;
  credit: number;
  signedAmount: number; // + for debit to bank G/L (inflow), - for credit to bank G/L (outflow)
  ref1?: string;
  ref2?: string;
  memo?: string;
  contraAct?: string;
  cardCode?: string;
  cardName?: string;
  nif?: string;
  sourceType?: string; // e.g., '24' Incoming Payment, '46' Outgoing Payment, '30' JE
  sourceDocNum?: number;
}

export interface MatchDocumentAllocation {
  docType: B1DocumentType;
  docEntry: number;
  docNum: number;
  atDocNumber?: string;
  cardCode: string;
  cardName: string;
  dueDate: string;
  openAmount: number;
  allocatedAmount: number;
}

export interface MatchSuggestion {
  id: string;
  bankLineId: string;
  targetType: MatchTargetType;
  confidence: number; // 0..100
  tier: ConfidenceTier;
  reasons: string[];
  cardCode?: string;
  cardName?: string;
  nif?: string;
  matchedAmount: number;
  differenceAmount: number;
  /** Present when matching an existing unreconciled Journal Entry / Payment */
  journalLine?: B1UnreconciledJournalLine;
  /** Present when creating an IncomingPayment or VendorPayment against open Invoice(s) / Credit Memo(s) */
  allocations?: MatchDocumentAllocation[];
  /** Present when targetType === 'DIRECT_GL_ACCOUNT' (e.g. Bank Fees, Stamp Duty, Interest) */
  glAccountMatch?: {
    ruleId?: string;
    glAccountCode: string;
    glAccountName: string;
  };
}

export interface StatementPreviewResponse {
  detectedFormat: StatementFormat;
  bankCode: BankCode;
  matchedHouseBank?: HouseBankAccount;
  statement: ParsedBankStatement;
  duplicateLinesCount: number;
  newLinesCount: number;
}

export interface StatementImportResponse {
  statementId: string;
  houseBankId: string;
  importedLinesCount: number;
  skippedDuplicateCount: number;
  autoSuggestedCount: number;
}

export interface ApproveReconciliationRequest {
  bankLineId: string;
  targetType: MatchTargetType;
  /** For EXISTING_JOURNAL_ENTRY */
  journalSelection?: {
    transId: number;
    lineId: number;
  };
  /** For OPEN_AR_INVOICE / OPEN_AP_INVOICE / MULTI_INVOICE_BUNDLE */
  invoiceSelection?: {
    cardCode: string;
    allocations: Array<{
      docType: B1DocumentType;
      docEntry: number;
      allocatedAmount: number;
    }>;
    /** Optional overpayment left on the Business Partner account (Payment on Account) */
    paymentOnAccountAmount?: number;
  };
  /** For DIRECT_GL_ACCOUNT (DocType = rAccount: Bank fees, Imposto do Selo, Interest) */
  glAccountSelection?: {
    glAccountCode: string;
    glAccountName?: string;
  };
}

export interface AuditLogRecord {
  id: number;
  createdAt: string;
  b1User: string;
  action: string;
  bankLineId?: string;
  statementId?: string;
  detailsJson: string;
}

export interface DashboardSummary {
  mode: 'mock' | 'live';
  totalUnreconciled: number;
  highConfidenceReady: number;
  needsReview: number;
  reconciledCount: number;
  unreconciledInflowEur: number;
  unreconciledOutflowEur: number;
}

export {
  filterManualJournalLines,
  filterManualOpenDocuments,
  matchesAmountValue,
  normalizeSearchString,
  parseSearchAmount,
} from './manualSearch.js';
