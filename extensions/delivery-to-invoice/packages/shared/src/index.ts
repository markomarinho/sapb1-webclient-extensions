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
  lastInvoicedPrice?: number | null;
  lastInvoicedDocNum?: number | null;
  lastInvoicedDate?: string | null;
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
  lastInvoicedDocNum?: number | null;
  lastInvoicedDate?: string | null;
  priceDiff: number | null;
  priceMatchesLastInvoice: boolean;
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
      label: `Principal — ${primary}`,
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
      label: contactName ? `Contacto: ${contactName} — ${contact}` : `Contacto — ${contact}`,
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

  if (override?.email && override.email.trim().includes('@')) {
    const cleanEmail = override.email.trim();
    if (override.contactName !== undefined) {
      return {
        email: cleanEmail,
        contactName: override.contactName.trim() || null,
      };
    }
    const matched = options.find((o) => o.email.toLowerCase() === cleanEmail.toLowerCase());
    return {
      email: cleanEmail,
      contactName: matched?.source === 'CONTACT' ? (matched.contactName?.trim() || null) : null,
    };
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

export function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Evaluates price and margin rules for a delivery note:
 * 1. Checks if each item's price matches the last price invoiced to this customer.
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
    const unitCost = roundMoney(line.unitCost ?? 0);
    const marginAmount = roundMoney((netUnitPrice - unitCost) * line.quantity);
    const marginPercent =
      netUnitPrice > 0 ? roundMoney(((netUnitPrice - unitCost) / netUnitPrice) * 100) : 0;

    const lastInvoicedPrice =
      line.lastInvoicedPrice !== undefined && line.lastInvoicedPrice !== null
        ? roundMoney(line.lastInvoicedPrice)
        : null;
    const priceDiff =
      lastInvoicedPrice !== null ? roundMoney(netUnitPrice - lastInvoicedPrice) : null;
    const priceMatchesLastInvoice =
      lastInvoicedPrice === null || Math.abs(netUnitPrice - lastInvoicedPrice) <= 0.009;

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
      lastInvoicedDocNum: line.lastInvoicedDocNum ?? null,
      lastInvoicedDate: line.lastInvoicedDate ?? null,
      priceDiff,
      priceMatchesLastInvoice,
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
    const avgUnitPrice = roundMoney(rows.reduce((s, r) => s + r.netUnitPrice, 0) / rowCount);
    const avgUnitCost = roundMoney(rows.reduce((s, r) => s + r.unitCost, 0) / rowCount);
    const avgMarginPercent = roundMoney(
      rows.reduce((s, r) => s + r.marginPercent, 0) / rowCount
    );

    if (lowestItemMarginPercent === null || avgMarginPercent < lowestItemMarginPercent) {
      lowestItemMarginPercent = avgMarginPercent;
    }

    const firstWithHistory = rows.find((r) => r.lastInvoicedPrice !== null);
    const lastInvoicedPrice = firstWithHistory?.lastInvoicedPrice ?? null;
    const lastInvoicedDocNum = firstWithHistory?.lastInvoicedDocNum ?? null;
    const lastInvoicedDate = firstWithHistory?.lastInvoicedDate ?? null;
    const priceDiff =
      lastInvoicedPrice !== null ? roundMoney(avgUnitPrice - lastInvoicedPrice) : null;

    const allRowsMatchPrice =
      rows.every((r) => r.priceMatchesLastInvoice) &&
      (lastInvoicedPrice === null || Math.abs(avgUnitPrice - lastInvoicedPrice) <= 0.009);

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
