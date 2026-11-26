export type GroupingMode = 'PER_DELIVERY' | 'CONSOLIDATED_BY_CUSTOMER';

export type PdfSourceMode = 'builtin' | 'gateway';

export type ConversionItemStatus =
  | 'INVOICED_AND_EMAILED'
  | 'INVOICED_ONLY'
  | 'INVOICED_EMAIL_FAILED'
  | 'INVOICED_NO_EMAIL'
  | 'FAILED';

export type TriggerSource = 'MANUAL' | 'SCHEDULED';

export interface DeliveryLine {
  lineNum: number;
  itemCode: string;
  itemDescription: string;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  taxCode: string;
  taxRate: number;
  lineTotal: number;
  warehouseCode?: string;
  unitCost?: number;
  /** Sales UoM code of the line and how many inventory units it contains (1 when no UoM). */
  uomCode?: string;
  uomFactor?: number;
  lastInvoicedPrice?: number | null;
  /** UoM of the last invoice line (price above is per that UoM). */
  lastInvoicedUomCode?: string;
  lastInvoicedUomFactor?: number;
  lastInvoicedDocNum?: number | null;
  lastInvoicedDate?: string | null;
  /** Price source type on the delivery line (e.g. dpsActivePriceList, dpsPriceList, dpsManual). */
  priceSource?: string | null;
  /** Price list ID on the delivery line when priced from a price list. */
  priceList?: number | null;
  /** Price source type on the last invoice line. */
  lastInvoicedPriceSource?: string | null;
  /** Price list ID on the last invoice line. */
  lastInvoicedPriceList?: number | null;
}

export interface DeliveryLineCheckResult {
  lineNum: number;
  itemCode: string;
  itemDescription: string;
  warehouseCode?: string;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  netUnitPrice: number;
  unitCost: number;
  lineTotal: number;
  marginAmount: number;
  marginPercent: number;
  lastInvoicedPrice: number | null;
  uomCode?: string;
  lastInvoicedUomCode?: string;
  lastInvoicedDocNum?: number | null;
  lastInvoicedDate?: string | null;
  priceDiff: number | null;
  priceMatchesLastInvoice: boolean;
  samePriceList?: boolean;
}

export interface DeliveryItemValidationSummary {
  itemCode: string;
  itemDescription: string;
  rowCount: number;
  totalQuantity: number;
  avgUnitPrice: number;
  avgUnitCost: number;
  totalLineAmount: number;
  avgMarginPercent: number;
  lastInvoicedPrice: number | null;
  lastInvoicedDocNum?: number | null;
  lastInvoicedDate?: string | null;
  priceDiff: number | null;
  priceMatchesLastInvoice: boolean;
  marginMeetsMinimum: boolean;
}

export interface DeliveryValidationRules {
  checkPriceMatchLastInvoice: boolean;
  checkMinimumMargin: boolean;
  minimumMarginPercent: number;
}

export interface DeliveryValidationResult {
  passed: boolean;
  hasPriceWarning: boolean;
  hasMarginWarning: boolean;
  minMarginThreshold: number;
  priceCheckEnabled: boolean;
  marginCheckEnabled: boolean;
  lowestItemMarginPercent: number | null;
  warnings: string[];
  lineResults: DeliveryLineCheckResult[];
  itemSummaries: DeliveryItemValidationSummary[];
}

export type CustomerEmailSource = 'MAIN' | 'UDF' | 'CONTACT' | 'CUSTOM';

export interface CustomerEmailOption {
  id: string;
  email: string;
  source: CustomerEmailSource;
  label: string;
  contactName?: string;
  position?: string;
  emlGrpCode?: string;
  isDefault?: boolean;
}

export interface RecipientSelection {
  email: string;
  contactName?: string;
  source?: CustomerEmailSource;
}

/** A freight / additional-expense row of a delivery note (SL: DocumentAdditionalExpenses). */
export interface DeliveryExpense {
  lineNum: number;
  expenseCode: number;
  /** Net amount in document currency (LineTotal) or, for foreign-currency rows, LineTotalFC. */
  amount: number;
  /** True when `amount` came from LineTotalFC (foreign-currency document). */
  isForeignCurrency: boolean;
  remarks?: string;
  taxCode?: string;
  distributionRules?: Array<string | null>;
}

export interface OpenDeliveryNote {
  docEntry: number;
  docNum: number;
  docDate: string;
  docDueDate: string;
  cardCode: string;
  cardName: string;
  federalTaxId: string;
  customerEmail: string;
  contactEmail?: string;
  contactName?: string;
  availableEmails?: CustomerEmailOption[];
  autoInvoiceEnabled: boolean;
  docCurrency: string;
  docTotal: number;
  vatSum: number;
  numAtCard?: string;
  comments?: string;
  /** Freight and other additional expenses, copied to the invoice. */
  additionalExpenses?: DeliveryExpense[];
  /** Header values (salesperson, payment terms, ...) copied to the invoice; see DELIVERY_HEADER_FIELDS. */
  headerCopy?: Record<string, string | number>;
  lines: DeliveryLine[];
  validation?: DeliveryValidationResult;
  alreadyProcessed?: boolean;
}

export interface AutomationSettings {
  schedulerEnabled: boolean;
  intervalMinutes: number;
  groupingMode: GroupingMode;
  onlyAutoInvoiceCustomers: boolean;
  minDeliveryAgeDays: number;
  sendEmailAutomatically: boolean;
  defaultEmlGrpCode: string;
  checkPriceMatchLastInvoice: boolean;
  checkMinimumMargin: boolean;
  minimumMarginPercent: number;
  emailSubjectTemplate: string;
  emailBodyTemplate: string;
  emailBodyIsHtml?: boolean;
  ccAddresses: string;
  replyToAddress: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpFrom: string;
  hasSmtpPassword?: boolean;
  pdfSource: PdfSourceMode;
  gatewayUrl: string;
  invoiceDocCode: string;
  gatewayFallbackToBuiltin: boolean;
  lastRunAt?: string | null;
  nextRunAt?: string | null;
}

export interface ConversionRecord {
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

export interface SentEmailPreview {
  id: string;
  conversionId: string;
  to: string;
  recipientName?: string;
  cc?: string;
  subject: string;
  htmlBody: string;
  attachmentFilename: string;
  attachmentBytes: number;
  sentAt: string;
}

export interface AuditLogRecord {
  id: number;
  timestamp: string;
  actor: string;
  action: string;
  details: string;
}

export interface DashboardSummary {
  openDeliveriesCount: number;
  eligibleAutoCount: number;
  openDeliveriesTotal: number;
  invoicedTodayCount: number;
  emailsSentCount: number;
  emailFailedCount: number;
  schedulerEnabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  b1Mode: 'mock' | 'live';
  emailMode: 'mock' | 'smtp';
  /** True when running inside the SAP B1 Web Client without a backend (no email/scheduler). */
  nativeWebClient?: boolean;
}

export interface ConvertDeliveriesRequest {
  deliveryDocEntries: number[];
  groupingMode: GroupingMode;
  sendEmail: boolean;
  invoiceDate?: string;
  recipientOverrides?: Record<string, RecipientSelection>;
}

export interface ConvertDeliveriesResponse {
  runId: string;
  processedCount: number;
  invoicesCreated: number;
  emailsSent: number;
  failedCount: number;
  records: ConversionRecord[];
}

export interface DeliveryGroup {
  key: string;
  cardCode: string;
  cardName: string;
  currency: string;
  recipientEmail: string | null;
  recipientName?: string | null;
  deliveries: OpenDeliveryNote[];
  totalAmount: number;
}

/**
 * Splits a comma/semicolon-separated email string into deduplicated, trimmed email addresses.
 */
export function parseEmailList(raw?: string | null): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const part of raw.split(/[,;]/)) {
    const clean = part.trim();
    if (!clean || !clean.includes('@')) continue;
    const key = clean.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(clean);
    }
  }
  return result;
}

/**
 * Formats one or more email addresses into a comma-separated recipient string.
 */
export function formatEmailList(emails: string[]): string {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const email of emails) {
    const clean = email.trim();
    if (!clean || !clean.includes('@')) continue;
    const key = clean.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(clean);
    }
  }
  return result.join(', ');
}

/**
 * Builds deduplicated list of available customer email options (Main BP email + Contacts).
 */
export function getDeliveryEmailOptions(delivery: OpenDeliveryNote): CustomerEmailOption[] {
  if (delivery.availableEmails && delivery.availableEmails.length > 0) {
    return delivery.availableEmails;
  }
  const options: CustomerEmailOption[] = [];
  const primary = delivery.customerEmail?.trim();
  if (primary && primary.includes('@')) {
    options.push({
      id: `main:${primary.toLowerCase()}`,
      email: primary,
      source: 'MAIN',
      label: primary,
      isDefault: true,
    });
  }
  const contact = delivery.contactEmail?.trim();
  if (contact && contact.includes('@')) {
    const contactName = delivery.contactName?.trim();
    options.push({
      id: `contact:${contactName ?? 'default'}:${contact.toLowerCase()}`,
      email: contact,
      source: 'CONTACT',
      contactName: contactName || undefined,
      label: contactName ? `${contactName} — ${contact}` : contact,
      isDefault: options.length === 0,
    });
  }
  return options;
}

/**
 * Applies a default EmlGrpCode preference to a list of CustomerEmailOption items.
 * If defaultEmlGrpCode is non-empty and matches one of the contact options (case-insensitive),
 * that contact is marked as `isDefault: true` (and other options `isDefault: false`).
 */
export function applyDefaultEmlGrpCode(
  options: CustomerEmailOption[],
  defaultEmlGrpCode?: string
): CustomerEmailOption[] {
  const targetGroup = defaultEmlGrpCode?.trim().toLowerCase();
  if (!targetGroup) return options;

  const matchedContact = options.find(
    (o) => o.source === 'CONTACT' && (o.emlGrpCode?.trim().toLowerCase() ?? '') === targetGroup
  );
  if (!matchedContact) return options;

  return options.map((o) => ({
    ...o,
    isDefault: o.id === matchedContact.id,
  }));
}

/**
 * Resolves the best recipient (email + optional contactName) for a delivery note,
 * taking optional user override and defaultEmlGrpCode into account.
 */
export function resolveRecipientSelection(
  delivery: OpenDeliveryNote,
  override?: RecipientSelection,
  defaultEmlGrpCode?: string
): { email: string | null; contactName: string | null } {
  const options = applyDefaultEmlGrpCode(getDeliveryEmailOptions(delivery), defaultEmlGrpCode);

  const overrideEmails = parseEmailList(override?.email);
  if (overrideEmails.length > 0) {
    const cleanEmail = formatEmailList(overrideEmails);
    if (override?.contactName !== undefined) {
      return {
        email: cleanEmail,
        contactName: override.contactName.trim() || null,
      };
    }
    if (overrideEmails.length === 1) {
      const matched = options.find(
        (o) => o.email.toLowerCase() === overrideEmails[0].toLowerCase()
      );
      return {
        email: cleanEmail,
        contactName: matched?.source === 'CONTACT' ? (matched.contactName?.trim() || null) : null,
      };
    }
    return { email: cleanEmail, contactName: null };
  }

  const defaultOpt = options.find((o) => o.isDefault) ?? options[0];
  if (defaultOpt) {
    return {
      email: defaultOpt.email,
      contactName: defaultOpt.source === 'CONTACT' ? (defaultOpt.contactName?.trim() || null) : null,
    };
  }

  const primary = delivery.customerEmail?.trim();
  if (primary && primary.includes('@')) {
    return { email: primary, contactName: null };
  }
  const fallback = delivery.contactEmail?.trim();
  if (fallback && fallback.includes('@')) {
    return { email: fallback, contactName: delivery.contactName?.trim() || null };
  }
  return { email: null, contactName: null };
}

/**
 * Resolves the best recipient email for a delivery note (BP email -> contact email -> null).
 */
export function resolveRecipientEmail(
  delivery: OpenDeliveryNote,
  defaultEmlGrpCode?: string
): string | null {
  return resolveRecipientSelection(delivery, undefined, defaultEmlGrpCode).email;
}

/**
 * Groups selected delivery notes either 1:1 (PER_DELIVERY) or consolidated by customer + currency.
 */
export function groupDeliveriesForInvoicing(
  deliveries: OpenDeliveryNote[],
  mode: GroupingMode,
  recipientOverrides?: Record<string, RecipientSelection>,
  defaultEmlGrpCode?: string
): DeliveryGroup[] {
  const getOverride = (d: OpenDeliveryNote): RecipientSelection | undefined =>
    recipientOverrides?.[String(d.docEntry)] ?? recipientOverrides?.[d.cardCode];

  if (mode === 'PER_DELIVERY') {
    return deliveries.map((d) => {
      const resolved = resolveRecipientSelection(d, getOverride(d), defaultEmlGrpCode);
      return {
        key: `delivery-${d.docEntry}`,
        cardCode: d.cardCode,
        cardName: d.cardName,
        currency: d.docCurrency,
        recipientEmail: resolved.email,
        recipientName: resolved.contactName,
        deliveries: [d],
        totalAmount: roundMoney(d.docTotal),
      };
    });
  }

  const map = new Map<string, DeliveryGroup>();
  for (const d of deliveries) {
    const key = `${d.cardCode}::${d.docCurrency}`;
    const override = getOverride(d);
    const resolved = resolveRecipientSelection(d, override, defaultEmlGrpCode);
    const existing = map.get(key);
    if (existing) {
      existing.deliveries.push(d);
      existing.totalAmount = roundMoney(existing.totalAmount + d.docTotal);
      if (override?.email || !existing.recipientEmail) {
        existing.recipientEmail = resolved.email;
        existing.recipientName = resolved.contactName;
      }
    } else {
      map.set(key, {
        key,
        cardCode: d.cardCode,
        cardName: d.cardName,
        currency: d.docCurrency,
        recipientEmail: resolved.email,
        recipientName: resolved.contactName,
        deliveries: [d],
        totalAmount: roundMoney(d.docTotal),
      });
    }
  }
  return Array.from(map.values());
}

/**
 * Filters open deliveries according to automation eligibility rules.
 */
export function filterEligibleDeliveries(
  deliveries: OpenDeliveryNote[],
  opts: {
    onlyAutoInvoiceCustomers: boolean;
    minDeliveryAgeDays: number;
    referenceDate?: Date;
  }
): OpenDeliveryNote[] {
  const now = opts.referenceDate ?? new Date();
  const cutoffMs = now.getTime() - Math.max(0, opts.minDeliveryAgeDays) * 86_400_000;

  return deliveries.filter((d) => {
    if (d.alreadyProcessed) return false;
    if (opts.onlyAutoInvoiceCustomers && !d.autoInvoiceEnabled) return false;
    if (opts.minDeliveryAgeDays > 0) {
      const docTime = Date.parse(d.docDate);
      if (!Number.isNaN(docTime) && docTime > cutoffMs) {
        return false;
      }
    }
    return true;
  });
}

/**
 * Renders email subject/body templates with {{Placeholder}} tokens.
 * When a contactName is present in vars (from a selected BP contact),
 * it populates {{ContactName}} and {{RecipientName}} and personalizes
 * the greeting if the template only references {{CardName}} in the salutation.
 */
export function renderEmailTemplate(
  template: string,
  vars: Record<string, string>
): string {
  const contactName = vars.ContactName?.trim() ?? '';
  const cardName = vars.CardName?.trim() ?? '';
  const enrichedVars: Record<string, string> = {
    ...vars,
    ContactName: contactName,
    RecipientName: contactName ? (cardName ? `${contactName} (${cardName})` : contactName) : cardName,
  };

  let effectiveTemplate = template;
  if (
    contactName &&
    !template.includes('{{ContactName}}') &&
    !template.includes('{{RecipientName}}')
  ) {
    if (effectiveTemplate.includes('Exmo.(a) Cliente {{CardName}}')) {
      effectiveTemplate = effectiveTemplate.replace(
        'Exmo.(a) Cliente {{CardName}}',
        'Exmo.(a) {{ContactName}} ({{CardName}})'
      );
    } else if (
      /(Exmo\.\(a\)|Caro\(a\)|Olá|Estimado\(a\)|Dear)\s+(?:Cliente\s+)?((?:<[^>]+>)*)\{\{CardName\}\}((?:<\/[^>]+>)*)/i.test(
        effectiveTemplate
      )
    ) {
      effectiveTemplate = effectiveTemplate.replace(
        /(Exmo\.\(a\)|Caro\(a\)|Olá|Estimado\(a\)|Dear)\s+(?:Cliente\s+)?((?:<[^>]+>)*)\{\{CardName\}\}((?:<\/[^>]+>)*)/i,
        '$1 $2{{ContactName}}$3 ({{CardName}})'
      );
    }
  }

  return effectiveTemplate.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => enrichedVars[key] ?? '');
}

/**
 * Delivery-note header fields that are carried over to the A/R invoice (besides NumAtCard, freight and lines).
 * Values that mean "none" in SAP (null, '', -1, 0 for the discount) are not copied.
 */
export const DELIVERY_HEADER_FIELDS = [
  'SalesPersonCode',
  'PaymentGroupCode',
  'DiscountPercent',
  'TransportationCode',
  'ShipToCode',
  'Address2',
  'ContactPersonCode',
  'Project',
] as const;

/** Names to put in the OData $select so the header fields, freight and extra UDFs come back. */
export function deliverySelectFields(extraUdfs: string[] = []): string {
  return [
    'DocEntry', 'DocNum', 'DocDate', 'DocDueDate', 'CardCode', 'CardName', 'DocCurrency', 'DocTotal', 'VatSum',
    'NumAtCard', 'Comments', 'DocumentLines', 'DocumentAdditionalExpenses',
    ...DELIVERY_HEADER_FIELDS,
    ...extraUdfs,
  ].join(',');
}

export function parseUdfList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((n) => n.trim())
    .filter((n) => /^U_\w+$/.test(n));
}

type RawRecord = Record<string, unknown>;

function isMeaningful(value: unknown): value is string | number {
  if (value === null || value === undefined) return false;
  if (typeof value === 'number') return Number.isFinite(value) && value !== -1;
  if (typeof value === 'string') return value.trim() !== '' && value.trim() !== '-1';
  return false;
}

/** Extracts the header values to copy from a raw Service Layer delivery note. */
export function parseDeliveryHeaderCopy(raw: RawRecord, extraUdfs: string[] = []): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const field of [...DELIVERY_HEADER_FIELDS, ...extraUdfs]) {
    const value = raw[field];
    if (!isMeaningful(value)) continue;
    if (field === 'DiscountPercent' && Number(value) === 0) continue;
    out[field] = typeof value === 'number' ? value : String(value);
  }
  return out;
}

/** Extracts the freight / additional-expense rows from a raw Service Layer delivery note. */
export function parseDeliveryExpenses(raw: RawRecord): DeliveryExpense[] {
  const rows = Array.isArray(raw.DocumentAdditionalExpenses)
    ? (raw.DocumentAdditionalExpenses as RawRecord[])
    : [];
  const result: DeliveryExpense[] = [];
  for (const r of rows) {
    const local = Number(r.LineTotal ?? 0);
    const foreign = Number(r.LineTotalFC ?? 0);
    const isForeignCurrency = !local && Boolean(foreign);
    const amount = isForeignCurrency ? foreign : local;
    if (!amount) continue; // empty rows (ExpenseCode only) carry nothing to invoice
    const rules = [r.DistributionRule, r.DistributionRule2, r.DistributionRule3, r.DistributionRule4, r.DistributionRule5];
    result.push({
      lineNum: Number(r.LineNum ?? 0),
      expenseCode: Number(r.ExpenseCode ?? 0),
      amount,
      isForeignCurrency,
      remarks: r.Remarks ? String(r.Remarks) : undefined,
      taxCode: r.TaxCode ? String(r.TaxCode) : undefined,
      distributionRules: rules.some((x) => isMeaningful(x)) ? rules.map((x) => (isMeaningful(x) ? String(x) : null)) : undefined,
    });
  }
  return result;
}

/** SAP B1 limits NumAtCard to 100 characters. */
const NUM_AT_CARD_MAX = 100;

/**
 * NumAtCard of the invoice: the delivery's own reference; when several deliveries are consolidated, the distinct
 * references joined with ", " (cut to the field limit).
 */
export function joinNumAtCard(deliveries: Array<Pick<OpenDeliveryNote, 'numAtCard'>>): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const d of deliveries) {
    const v = (d.numAtCard ?? '').trim();
    if (v && !seen.has(v)) {
      seen.add(v);
      parts.push(v);
    }
  }
  return parts.join(', ').slice(0, NUM_AT_CARD_MAX);
}

/**
 * Builds the Service Layer `POST /Invoices` body that copies delivery notes (BaseType 15) to an A/R invoice:
 * lines linked to their delivery lines, freight/expenses linked to the delivery expense rows, the customer
 * reference (NumAtCard) and the header values in DELIVERY_HEADER_FIELDS. For consolidated invoices each header
 * value is taken from the first delivery that has it.
 */
export function buildInvoicePayload(input: {
  cardCode: string;
  docDate: string;
  deliveries: OpenDeliveryNote[];
  comments?: string;
  extraUdfs?: string[];
}): RawRecord {
  const { deliveries } = input;
  const payload: RawRecord = {
    CardCode: input.cardCode,
    DocDate: input.docDate,
    Comments:
      input.comments ??
      `Faturado automaticamente a partir da(s) Guia(s): ${deliveries.map((d) => d.docNum).join(', ')}`,
    DocumentLines: deliveries.flatMap((d) =>
      d.lines.map((l) => ({
        BaseType: 15,
        BaseEntry: d.docEntry,
        BaseLine: l.lineNum,
        Quantity: l.quantity,
      }))
    ),
  };

  const numAtCard = joinNumAtCard(deliveries);
  if (numAtCard) payload.NumAtCard = numAtCard;

  for (const field of [...DELIVERY_HEADER_FIELDS, ...(input.extraUdfs ?? [])]) {
    const source = deliveries.find((d) => d.headerCopy && field in d.headerCopy);
    if (source?.headerCopy) payload[field] = source.headerCopy[field];
  }

  const expenses = deliveries.flatMap((d) =>
    (d.additionalExpenses ?? []).map((e) => {
      const row: RawRecord = {
        ExpenseCode: e.expenseCode,
        [e.isForeignCurrency ? 'LineTotalFC' : 'LineTotal']: e.amount,
        BaseDocType: 15,
        BaseDocEntry: d.docEntry,
        BaseDocLine: e.lineNum,
      };
      if (e.remarks) row.Remarks = e.remarks;
      if (e.taxCode) row.TaxCode = e.taxCode;
      e.distributionRules?.forEach((rule, i) => {
        if (rule) row[i === 0 ? 'DistributionRule' : `DistributionRule${i + 1}`] = rule;
      });
      return row;
    })
  );
  if (expenses.length > 0) payload.DocumentAdditionalExpenses = expenses;

  return payload;
}

export function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Returns true when the SAP B1 DocumentLines.PriceSource indicates a price list (not manual/special). */
export function isPriceListPriceSource(source?: string | null): boolean {
  if (!source) return false;
  const norm = source.trim().toLowerCase();
  return norm.includes('pricelist') || norm === 'p' || norm === 't';
}

/**
 * Returns true when both the current delivery line and the last invoiced line
 * are priced from a price list (as PriceSource type) and reference the same PriceList.
 */
export function isSamePriceListAsLastInvoice(
  line: Pick<
    DeliveryLine,
    'priceSource' | 'priceList' | 'lastInvoicedPriceSource' | 'lastInvoicedPriceList'
  >
): boolean {
  if (
    !isPriceListPriceSource(line.priceSource) ||
    !isPriceListPriceSource(line.lastInvoicedPriceSource)
  ) {
    return false;
  }
  if (
    line.priceList === undefined ||
    line.priceList === null ||
    line.lastInvoicedPriceList === undefined ||
    line.lastInvoicedPriceList === null
  ) {
    return false;
  }
  return line.priceList > 0 && line.priceList === line.lastInvoicedPriceList;
}

/**
 * Evaluates price and margin rules for a delivery note:
 * 1. Checks if each item's price matches the last price invoiced to this customer
 *    (or both use the same price list as price source type).
 * 2. Checks if each item's margin (averaging multiple rows of the same item) is higher than minimumMarginPercent (default 30%).
 */
export function evaluateDeliveryNoteChecks(
  delivery: OpenDeliveryNote,
  rules?: Partial<DeliveryValidationRules>
): DeliveryValidationResult {
  const priceCheckEnabled = rules?.checkPriceMatchLastInvoice ?? true;
  const marginCheckEnabled = rules?.checkMinimumMargin ?? true;
  const minMarginThreshold = rules?.minimumMarginPercent ?? 30;

  const lineResults: DeliveryLineCheckResult[] = delivery.lines.map((line) => {
    const discount = line.discountPercent || 0;
    const netUnitPrice = roundMoney(line.unitPrice * (1 - discount / 100));
    // GrossBuyPrice/StockPrice already come per sales UoM, so no UoM factor here.
    const unitCost = roundMoney(line.unitCost ?? 0);
    const marginAmount = roundMoney((netUnitPrice - unitCost) * line.quantity);
    const marginPercent =
      // Margin over cost (markup): sells 31.20, costs 23.78 -> 31.2%
      unitCost > 0 ? roundMoney(((netUnitPrice - unitCost) / unitCost) * 100) : 0;

    // Last invoiced price is converted to the UoM of this line (price per inventory unit x line factor).
    const lastInvoicedPrice =
      line.lastInvoicedPrice !== undefined && line.lastInvoicedPrice !== null
        ? roundMoney(
            (line.lastInvoicedPrice / (line.lastInvoicedUomFactor || 1)) * (line.uomFactor || 1)
          )
        : null;
    const priceDiff =
      lastInvoicedPrice !== null ? roundMoney(netUnitPrice - lastInvoicedPrice) : null;
    const samePriceList = isSamePriceListAsLastInvoice(line);
    const priceMatchesLastInvoice =
      lastInvoicedPrice === null ||
      samePriceList ||
      Math.abs(netUnitPrice - lastInvoicedPrice) <= 0.009;

    return {
      lineNum: line.lineNum,
      itemCode: line.itemCode,
      itemDescription: line.itemDescription,
      warehouseCode: line.warehouseCode,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      discountPercent: discount,
      netUnitPrice,
      unitCost,
      lineTotal: line.lineTotal,
      marginAmount,
      marginPercent,
      lastInvoicedPrice,
      uomCode: line.uomCode,
      lastInvoicedUomCode: line.lastInvoicedUomCode,
      lastInvoicedDocNum: line.lastInvoicedDocNum ?? null,
      lastInvoicedDate: line.lastInvoicedDate ?? null,
      priceDiff,
      priceMatchesLastInvoice,
      samePriceList,
    };
  });

  // Group rows by itemCode to compute average ("média") when an item appears on multiple rows
  const groupedByItem = new Map<string, DeliveryLineCheckResult[]>();
  for (const lr of lineResults) {
    const list = groupedByItem.get(lr.itemCode) ?? [];
    list.push(lr);
    groupedByItem.set(lr.itemCode, list);
  }

  const itemSummaries: DeliveryItemValidationSummary[] = [];
  const warnings: string[] = [];
  let hasPriceWarning = false;
  let hasMarginWarning = false;
  let lowestItemMarginPercent: number | null = null;

  for (const [itemCode, rows] of groupedByItem.entries()) {
    const rowCount = rows.length;
    const totalQuantity = roundMoney(rows.reduce((s, r) => s + r.quantity, 0));
    const totalLineAmount = roundMoney(rows.reduce((s, r) => s + r.lineTotal, 0));
    // Quantity-weighted averages: 2 x 26.57 + 1 x 26.57 with 100% discount -> 53.14 / 3 = 17.71
    const qtySum = rows.reduce((s, r) => s + r.quantity, 0);
    const weighted = (pick: (r: DeliveryLineCheckResult) => number): number =>
      qtySum > 0
        ? rows.reduce((s, r) => s + pick(r) * r.quantity, 0) / qtySum
        : rows.reduce((s, r) => s + pick(r), 0) / rowCount;
    const avgUnitPrice = roundMoney(weighted((r) => r.netUnitPrice));
    const avgUnitCost = roundMoney(weighted((r) => r.unitCost));
    const avgMarginPercent =
      avgUnitCost > 0 ? roundMoney(((avgUnitPrice - avgUnitCost) / avgUnitCost) * 100) : 0;

    if (lowestItemMarginPercent === null || avgMarginPercent < lowestItemMarginPercent) {
      lowestItemMarginPercent = avgMarginPercent;
    }

    const firstWithHistory = rows.find((r) => r.lastInvoicedPrice !== null);
    const lastInvoicedPrice = firstWithHistory?.lastInvoicedPrice ?? null;
    const lastInvoicedDocNum = firstWithHistory?.lastInvoicedDocNum ?? null;
    const lastInvoicedDate = firstWithHistory?.lastInvoicedDate ?? null;
    const priceDiff =
      lastInvoicedPrice !== null ? roundMoney(avgUnitPrice - lastInvoicedPrice) : null;

    // The weighted average price is what gets compared (rows of the same item are one price group).
    // If all rows share the same price list (as price source) with the last invoice, assume same price.
    const allRowsSamePriceList = rows.every((r) => r.samePriceList === true);
    const allRowsMatchPrice =
      lastInvoicedPrice === null ||
      allRowsSamePriceList ||
      Math.abs(avgUnitPrice - lastInvoicedPrice) <= 0.009;

    // Minimum margin check: must be higher than minMarginThreshold (or >= if threshold is met)
    const marginMeetsMinimum = avgMarginPercent >= minMarginThreshold;

    if (priceCheckEnabled && !allRowsMatchPrice) {
      hasPriceWarning = true;
      warnings.push(
        `Artigo ${itemCode}: preço atual (${avgUnitPrice.toFixed(2)}) diferente da última fatura (${lastInvoicedPrice?.toFixed(2) ?? '—'})`
      );
    }

    if (marginCheckEnabled && !marginMeetsMinimum) {
      hasMarginWarning = true;
      warnings.push(
        `Artigo ${itemCode}: margem${rowCount > 1 ? ' média' : ''} de ${avgMarginPercent.toFixed(1)}% inferior ao mínimo de ${minMarginThreshold}%`
      );
    }

    itemSummaries.push({
      itemCode,
      itemDescription: rows[0].itemDescription,
      rowCount,
      totalQuantity,
      avgUnitPrice,
      avgUnitCost,
      totalLineAmount,
      avgMarginPercent,
      lastInvoicedPrice,
      lastInvoicedDocNum,
      lastInvoicedDate,
      priceDiff,
      priceMatchesLastInvoice: allRowsMatchPrice,
      marginMeetsMinimum,
    });
  }

  return {
    passed: !hasPriceWarning && !hasMarginWarning,
    hasPriceWarning,
    hasMarginWarning,
    minMarginThreshold,
    priceCheckEnabled,
    marginCheckEnabled,
    lowestItemMarginPercent,
    warnings,
    lineResults,
    itemSummaries,
  };
}
