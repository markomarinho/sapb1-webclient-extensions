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
  autoInvoiceEnabled: boolean;
  docCurrency: string;
  docTotal: number;
  vatSum: number;
  numAtCard?: string;
  comments?: string;
  lines: DeliveryLine[];
  alreadyProcessed?: boolean;
}

export interface AutomationSettings {
  schedulerEnabled: boolean;
  intervalMinutes: number;
  groupingMode: GroupingMode;
  onlyAutoInvoiceCustomers: boolean;
  minDeliveryAgeDays: number;
  sendEmailAutomatically: boolean;
  emailSubjectTemplate: string;
  emailBodyTemplate: string;
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
}

export interface ConvertDeliveriesRequest {
  deliveryDocEntries: number[];
  groupingMode: GroupingMode;
  sendEmail: boolean;
  invoiceDate?: string;
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
  deliveries: OpenDeliveryNote[];
  totalAmount: number;
}

/**
 * Resolves the best recipient email for a delivery note (BP email -> contact email -> null).
 */
export function resolveRecipientEmail(delivery: OpenDeliveryNote): string | null {
  const primary = delivery.customerEmail?.trim();
  if (primary && primary.includes('@')) return primary;
  const fallback = delivery.contactEmail?.trim();
  if (fallback && fallback.includes('@')) return fallback;
  return null;
}

/**
 * Groups selected delivery notes either 1:1 (PER_DELIVERY) or consolidated by customer + currency.
 */
export function groupDeliveriesForInvoicing(
  deliveries: OpenDeliveryNote[],
  mode: GroupingMode
): DeliveryGroup[] {
  if (mode === 'PER_DELIVERY') {
    return deliveries.map((d) => ({
      key: `delivery-${d.docEntry}`,
      cardCode: d.cardCode,
      cardName: d.cardName,
      currency: d.docCurrency,
      recipientEmail: resolveRecipientEmail(d),
      deliveries: [d],
      totalAmount: roundMoney(d.docTotal),
    }));
  }

  const map = new Map<string, DeliveryGroup>();
  for (const d of deliveries) {
    const key = `${d.cardCode}::${d.docCurrency}`;
    const existing = map.get(key);
    if (existing) {
      existing.deliveries.push(d);
      existing.totalAmount = roundMoney(existing.totalAmount + d.docTotal);
      if (!existing.recipientEmail) {
        existing.recipientEmail = resolveRecipientEmail(d);
      }
    } else {
      map.set(key, {
        key,
        cardCode: d.cardCode,
        cardName: d.cardName,
        currency: d.docCurrency,
        recipientEmail: resolveRecipientEmail(d),
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
 */
export function renderEmailTemplate(
  template: string,
  vars: Record<string, string>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => vars[key] ?? '');
}

export function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
