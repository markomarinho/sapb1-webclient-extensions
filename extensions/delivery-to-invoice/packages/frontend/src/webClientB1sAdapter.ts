import {
  applyDefaultEmlGrpCode,
  buildInvoicePayload,
  deliverySelectFields,
  parseDeliveryExpenses,
  parseDeliveryHeaderCopy,
  evaluateDeliveryNoteChecks,
  filterEligibleDeliveries,
  getDeliveryEmailOptions,
  groupDeliveriesForInvoicing,
  roundMoney,
  type AuditLogRecord,
  type AutomationSettings,
  type ConversionRecord,
  type ConvertDeliveriesRequest,
  type ConvertDeliveriesResponse,
  type CustomerEmailOption,
  type DashboardSummary,
  type DeliveryLine,
  type OpenDeliveryNote,
  type SentEmailPreview,
  type TriggerSource,
} from '@b1-d2i/shared';

/**
 * Native SAP B1 Web Client mode.
 *
 * Inside the Web Client the SPA is served from /extn/ui-static/... and its Content-Security-Policy only
 * allows same-origin requests ('self'). /b1s/v1 (Service Layer) is same-origin there and the user's B1SESSION
 * cookie is sent automatically, so every SAP operation runs straight from the browser with no Node backend.
 *
 * Not possible without a backend: SMTP e-mail dispatch, PDF generation, the background scheduler.
 * Settings, conversion history and the audit log are kept in the browser's localStorage.
 */

const STATE_KEY = 'B1_D2I_WEBCLIENT_STATE_V1';
const ACTOR = 'webclient-user';
const AUTO_INVOICE_UDF = 'U_AutoInvoice';
const INVOICE_EMAIL_UDF = '';
const NO_EMAIL_NOTE =
  'Envio de email indisponível no modo Web Client (sem backend). A fatura foi criada no SAP B1.';

interface LocalState {
  settings: AutomationSettings;
  conversions: ConversionRecord[];
  auditLogs: AuditLogRecord[];
  nextAuditId: number;
}

const DEFAULT_SETTINGS: AutomationSettings = {
  schedulerEnabled: false,
  intervalMinutes: 60,
  groupingMode: 'PER_DELIVERY',
  onlyAutoInvoiceCustomers: true,
  minDeliveryAgeDays: 0,
  sendEmailAutomatically: false,
  defaultEmlGrpCode: '',
  checkPriceMatchLastInvoice: true,
  checkMinimumMargin: true,
  minimumMarginPercent: 30,
  emailSubjectTemplate: 'Fatura {{InvoiceDocNum}} — {{CardName}}',
  emailBodyTemplate: [
    'Exmo.(a) Cliente {{CardName}},',
    '',
    'Enviamos em anexo a Fatura nº {{InvoiceDocNum}} (data {{InvoiceDate}}), referente à(s) Guia(s) de Remessa {{DeliveryRefs}}.',
    '',
    'Valor Total: {{DocTotal}} {{Currency}}',
    '',
    'Com os melhores cumprimentos,',
    'Departamento de Faturação',
  ].join('\n'),
  emailBodyIsHtml: false,
  ccAddresses: '',
  replyToAddress: '',
  smtpHost: '',
  smtpPort: 587,
  smtpSecure: false,
  smtpUser: '',
  smtpFrom: '',
  hasSmtpPassword: false,
  pdfSource: 'builtin',
  gatewayUrl: '',
  invoiceDocCode: 'INV20004',
  gatewayFallbackToBuiltin: false,
  lastRunAt: null,
  nextRunAt: null,
};

function loadState(): LocalState {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<LocalState>;
      if (parsed && Array.isArray(parsed.conversions)) {
        return {
          settings: { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) },
          conversions: parsed.conversions,
          auditLogs: parsed.auditLogs ?? [],
          nextAuditId: parsed.nextAuditId ?? 1,
        };
      }
    }
  } catch {
    // fall through to defaults
  }
  return { settings: { ...DEFAULT_SETTINGS }, conversions: [], auditLogs: [], nextAuditId: 1 };
}

function saveState(state: LocalState): void {
  localStorage.setItem(STATE_KEY, JSON.stringify(state));
}

function audit(state: LocalState, action: string, details: string): void {
  state.auditLogs.unshift({
    id: state.nextAuditId++,
    timestamp: new Date().toISOString(),
    actor: ACTOR,
    action,
    details,
  });
  if (state.auditLogs.length > 200) state.auditLogs.length = 200;
}

// ---------------------------------------------------------------------------
// Service Layer access (same-origin /b1s/v1)
// ---------------------------------------------------------------------------

async function b1sFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/b1s/v1${path.startsWith('/') ? '' : '/'}${path}`, {
    credentials: 'include',
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'odata.maxpagesize=200',
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const txt = await res.text();
    let message = txt;
    try {
      const parsed = JSON.parse(txt) as { error?: { message?: { value?: string } | string } };
      const m = parsed.error?.message;
      message = (typeof m === 'string' ? m : m?.value) || txt;
    } catch {
      // keep raw text
    }
    throw new Error(`Service Layer ${init?.method ?? 'GET'} ${path} (${res.status}): ${message}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

type Raw = Record<string, unknown>;

const q = (s: string) => encodeURIComponent(s.replace(/'/g, "''"));

function extractBpEmailOptions(bp: Raw): {
  primaryEmail: string;
  firstContactEmail: string;
  firstContactName: string;
  availableEmails: CustomerEmailOption[];
} {
  const udfEmail = INVOICE_EMAIL_UDF ? String(bp[INVOICE_EMAIL_UDF] ?? '').trim() : '';
  const mainEmail = String(bp.EmailAddress ?? '').trim();
  const availableEmails: CustomerEmailOption[] = [];

  if (udfEmail.includes('@')) {
    availableEmails.push({
      id: `udf:${udfEmail.toLowerCase()}`,
      email: udfEmail,
      source: 'UDF',
      label: `Email Faturação (${INVOICE_EMAIL_UDF}) — ${udfEmail}`,
      isDefault: true,
    });
  }
  if (mainEmail.includes('@')) {
    const alreadyAdded = availableEmails.some(
      (e) => e.email.toLowerCase() === mainEmail.toLowerCase() && e.source !== 'CONTACT'
    );
    if (!alreadyAdded) {
      availableEmails.push({
        id: `main:${mainEmail.toLowerCase()}`,
        email: mainEmail,
        source: 'MAIN',
        label: mainEmail,
        isDefault: availableEmails.length === 0,
      });
    }
  }

  const contacts = Array.isArray(bp.ContactEmployees) ? (bp.ContactEmployees as Raw[]) : [];
  let firstContactEmail = '';
  let firstContactName = '';

  contacts.forEach((c, idx) => {
    if (String(c.Active ?? 'tYES') === 'tNO') return;
    const email = String(c.E_Mail ?? c.E_MailL ?? '').trim();
    if (!email.includes('@')) return;

    const fullName = [c.FirstName, c.MiddleName, c.LastName]
      .map((p) => String(p ?? '').trim())
      .filter(Boolean)
      .join(' ');
    const contactName = fullName || String(c.Name ?? '').trim() || `Contacto #${idx + 1}`;
    const position = String(c.Position ?? c.Title ?? '').trim() || undefined;
    const emlGrpCode = String(c.EmailGroupCode ?? c.EmlGrpCode ?? '').trim() || undefined;
    const internalCode = c.InternalCode ?? idx + 1;

    if (!firstContactEmail) {
      firstContactEmail = email;
      firstContactName = contactName;
    }
    availableEmails.push({
      id: `contact:${internalCode}:${email.toLowerCase()}`,
      email,
      source: 'CONTACT',
      contactName,
      position,
      emlGrpCode,
      label: `${contactName}${position ? ` (${position})` : ''}${
        emlGrpCode ? ` [${emlGrpCode}]` : ''
      } — ${email}`,
      isDefault: availableEmails.length === 0,
    });
  });

  return {
    primaryEmail: udfEmail.includes('@') ? udfEmail : mainEmail.includes('@') ? mainEmail : '',
    firstContactEmail,
    firstContactName,
    availableEmails,
  };
}

interface LastInvoiced {
  price: number;
  uomCode?: string;
  uomFactor: number;
  docNum: number;
  docDate: string;
}

async function loadLastInvoicedPrices(
  cardCode: string
): Promise<Map<string, LastInvoiced>> {
  const map = new Map<string, LastInvoiced>();
  try {
    const data = await b1sFetch<{ value?: Raw[] }>(
      `/Invoices?$filter=${encodeURIComponent(`CardCode eq '${cardCode.replace(/'/g, "''")}' and Cancelled eq 'tNO'`)}` +
        `&$select=${encodeURIComponent('DocEntry,DocNum,DocDate,DocumentLines')}` +
        `&$orderby=${encodeURIComponent('DocDate desc,DocEntry desc')}&$top=25`
    );
    for (const inv of data.value ?? []) {
      const docNum = Number(inv.DocNum ?? 0);
      const docDate = String(inv.DocDate ?? '').slice(0, 10);
      const lines = Array.isArray(inv.DocumentLines) ? (inv.DocumentLines as Raw[]) : [];
      for (const il of lines) {
        const itemCode = String(il.ItemCode ?? '');
        if (!itemCode || map.has(itemCode)) continue;
        // `Price` is already after discount in the Service Layer.
        map.set(itemCode, {
          price: roundMoney(Number(il.Price ?? 0)),
          uomCode: il.UoMCode ? String(il.UoMCode) : undefined,
          uomFactor: Number(il.UnitsOfMeasurment ?? 1) || 1,
          docNum,
          docDate,
        });
      }
    }
  } catch {
    // invoice history is optional
  }
  return map;
}

async function fetchOpenDeliveries(): Promise<OpenDeliveryNote[]> {
  const data = await b1sFetch<{ value?: Raw[] }>(
    `/DeliveryNotes?$filter=${encodeURIComponent("DocumentStatus eq 'bost_Open' and Cancelled eq 'tNO'")}` +
      `&$select=${encodeURIComponent(deliverySelectFields())}&$orderby=${encodeURIComponent('DocDate desc')}&$top=200`
  );
  const raw = data.value ?? [];
  const cardCodes = Array.from(new Set(raw.map((d) => String(d.CardCode))));

  const bpEntries = await Promise.all(
    cardCodes.map(async (cardCode) => {
      const [lastInvoiced, bp] = await Promise.all([
        loadLastInvoicedPrices(cardCode),
        b1sFetch<Raw>(`/BusinessPartners('${q(cardCode)}')`).catch(() => null),
      ]);
      if (!bp) {
        return [
          cardCode,
          {
            email: '',
            contactEmail: '',
            contactName: '',
            availableEmails: [] as CustomerEmailOption[],
            nif: '',
            autoInvoice: false,
            lastInvoiced,
          },
        ] as const;
      }
      const ex = extractBpEmailOptions(bp);
      const flag = String(bp[AUTO_INVOICE_UDF] ?? '').toUpperCase();
      return [
        cardCode,
        {
          email: ex.primaryEmail,
          contactEmail: ex.firstContactEmail,
          contactName: ex.firstContactName,
          availableEmails: ex.availableEmails,
          nif: String(bp.FederalTaxID ?? ''),
          autoInvoice: ['Y', 'YES', 'TYES', '1'].includes(flag),
          lastInvoiced,
        },
      ] as const;
    })
  );
  const bpMap = new Map(bpEntries);

  return raw.map((d) => {
    const cardCode = String(d.CardCode);
    const bp = bpMap.get(cardCode);
    const rawLines = Array.isArray(d.DocumentLines) ? (d.DocumentLines as Raw[]) : [];
    const lines: DeliveryLine[] = rawLines
      .filter((l) => String(l.LineStatus ?? 'bost_Open') === 'bost_Open')
      .map((l) => {
        const itemCode = String(l.ItemCode ?? '');
        const last = bp?.lastInvoiced.get(itemCode);
        return {
          lineNum: Number(l.LineNum ?? 0),
          itemCode,
          itemDescription: String(l.ItemDescription ?? ''),
          quantity: Number(l.RemainingOpenQuantity ?? l.Quantity ?? 0),
          unitPrice: Number(l.UnitPrice ?? l.Price ?? 0),
          discountPercent: Number(l.DiscountPercent ?? 0),
          taxCode: String(l.TaxCode ?? ''),
          taxRate: Number(l.TaxPercentagePerRow ?? 0),
          lineTotal: Number(l.LineTotal ?? 0),
          warehouseCode: l.WarehouseCode ? String(l.WarehouseCode) : undefined,
          unitCost: Number(l.GrossBuyPrice ?? l.StockPrice ?? 0),
          uomCode: l.UoMCode ? String(l.UoMCode) : undefined,
          uomFactor: Number(l.UnitsOfMeasurment ?? 1) || 1,
          lastInvoicedUomCode: last?.uomCode,
          lastInvoicedUomFactor: last?.uomFactor,
          lastInvoicedPrice: last ? last.price : null,
          lastInvoicedDocNum: last ? last.docNum : null,
          lastInvoicedDate: last ? last.docDate : null,
        };
      });

    return {
      docEntry: Number(d.DocEntry),
      docNum: Number(d.DocNum),
      docDate: String(d.DocDate ?? '').slice(0, 10),
      docDueDate: String(d.DocDueDate ?? '').slice(0, 10),
      cardCode,
      cardName: String(d.CardName ?? ''),
      federalTaxId: bp?.nif ?? '',
      customerEmail: bp?.email ?? '',
      contactEmail: bp?.contactEmail ?? '',
      contactName: bp?.contactName || undefined,
      availableEmails: bp?.availableEmails ?? [],
      autoInvoiceEnabled: bp?.autoInvoice ?? false,
      docCurrency: String(d.DocCurrency ?? 'EUR'),
      docTotal: Number(d.DocTotal ?? 0),
      vatSum: Number(d.VatSum ?? 0),
      numAtCard: d.NumAtCard ? String(d.NumAtCard) : undefined,
      comments: d.Comments ? String(d.Comments) : undefined,
      additionalExpenses: parseDeliveryExpenses(d),
      headerCopy: parseDeliveryHeaderCopy(d),
      lines,
    };
  });
}

async function listOpenDeliveries(state: LocalState): Promise<OpenDeliveryNote[]> {
  const deliveries = await fetchOpenDeliveries();
  const processed = new Set(
    state.conversions.filter((c) => c.invoiceDocEntry !== null).flatMap((c) => c.deliveryDocEntries)
  );
  const s = state.settings;
  return deliveries.map((d) => ({
    ...d,
    availableEmails: applyDefaultEmlGrpCode(getDeliveryEmailOptions(d), s.defaultEmlGrpCode),
    validation: evaluateDeliveryNoteChecks(d, {
      checkPriceMatchLastInvoice: s.checkPriceMatchLastInvoice,
      checkMinimumMargin: s.checkMinimumMargin,
      minimumMarginPercent: s.minimumMarginPercent,
    }),
    alreadyProcessed: processed.has(d.docEntry),
  }));
}

async function convert(
  state: LocalState,
  req: ConvertDeliveriesRequest,
  triggerSource: TriggerSource
): Promise<ConvertDeliveriesResponse> {
  const runId = crypto.randomUUID();
  const invoiceDate = req.invoiceDate || new Date().toISOString().slice(0, 10);
  const allOpen = await listOpenDeliveries(state);
  const wanted = new Set(req.deliveryDocEntries);
  const eligible = allOpen.filter((d) => wanted.has(d.docEntry) && !d.alreadyProcessed);
  const groups = groupDeliveriesForInvoicing(
    eligible,
    req.groupingMode,
    req.recipientOverrides,
    state.settings.defaultEmlGrpCode
  );

  const records: ConversionRecord[] = [];
  let invoicesCreated = 0;
  let failedCount = 0;

  for (const group of groups) {
    const base = {
      id: crypto.randomUUID(),
      runId,
      triggerSource,
      groupingMode: req.groupingMode,
      cardCode: group.cardCode,
      cardName: group.cardName,
      deliveryDocEntries: group.deliveries.map((d) => d.docEntry),
      deliveryDocNums: group.deliveries.map((d) => d.docNum),
      recipientEmail: group.recipientEmail,
      recipientName: group.recipientName ?? null,
      emailSubject: null,
      emailSentAt: null,
      createdBy: ACTOR,
      createdAt: new Date().toISOString(),
    };
    let rec: ConversionRecord;
    try {
      // BaseType 15 = Delivery Notes: SAP B1 copies the lines and closes the source deliveries.
      const created = await b1sFetch<Raw>('/Invoices', {
        method: 'POST',
        body: JSON.stringify(
          buildInvoicePayload({
            cardCode: group.cardCode,
            docDate: invoiceDate,
            deliveries: group.deliveries,
          })
        ),
      });
      invoicesCreated++;
      rec = {
        ...base,
        invoiceDocEntry: Number(created.DocEntry),
        invoiceDocNum: Number(created.DocNum),
        invoiceDate: String(created.DocDate ?? invoiceDate).slice(0, 10),
        currency: String(created.DocCurrency ?? group.currency),
        totalAmount: Number(created.DocTotal ?? group.totalAmount),
        status: 'INVOICED_ONLY',
        errorMessage: req.sendEmail ? NO_EMAIL_NOTE : null,
      };
    } catch (err) {
      failedCount++;
      rec = {
        ...base,
        invoiceDocEntry: null,
        invoiceDocNum: null,
        invoiceDate: null,
        currency: group.currency,
        totalAmount: group.totalAmount,
        status: 'FAILED',
        errorMessage: err instanceof Error ? err.message : 'Erro ao criar fatura no SAP B1',
      };
    }
    state.conversions.unshift(rec);
    records.push(rec);
  }
  if (state.conversions.length > 300) state.conversions.length = 300;

  audit(
    state,
    triggerSource === 'SCHEDULED' ? 'SCHEDULED_CONVERSION_RUN' : 'MANUAL_CONVERSION_RUN',
    `Run ${runId.slice(0, 8)}: ${eligible.length} guias -> ${invoicesCreated} faturas, 0 emails enviados, ${failedCount} falhas (${req.groupingMode}) [Web Client]`
  );
  saveState(state);

  return { runId, processedCount: eligible.length, invoicesCreated, emailsSent: 0, failedCount, records };
}

// ---------------------------------------------------------------------------
// Public adapter (mirrors the REST `api` object)
// ---------------------------------------------------------------------------

export const webClientB1sAdapter = {
  async getDashboard(): Promise<DashboardSummary> {
    const state = loadState();
    const deliveries = await listOpenDeliveries(state);
    const open = deliveries.filter((d) => !d.alreadyProcessed);
    const eligible = filterEligibleDeliveries(deliveries, {
      onlyAutoInvoiceCustomers: state.settings.onlyAutoInvoiceCustomers,
      minDeliveryAgeDays: state.settings.minDeliveryAgeDays,
    });
    const today = new Date().toISOString().slice(0, 10);
    return {
      openDeliveriesCount: open.length,
      eligibleAutoCount: eligible.length,
      openDeliveriesTotal: open.reduce((s, d) => s + d.docTotal, 0),
      invoicedTodayCount: state.conversions.filter(
        (c) => c.invoiceDocEntry !== null && c.createdAt.startsWith(today)
      ).length,
      emailsSentCount: 0,
      emailFailedCount: state.conversions.filter((c) => c.status === 'FAILED').length,
      schedulerEnabled: false,
      lastRunAt: state.settings.lastRunAt ?? null,
      nextRunAt: null,
      b1Mode: 'live',
      emailMode: 'mock',
      nativeWebClient: true,
    };
  },

  async listDeliveries(): Promise<{ deliveries: OpenDeliveryNote[] }> {
    return { deliveries: await listOpenDeliveries(loadState()) };
  },

  async getCustomerEmails(
    cardCode: string
  ): Promise<{ cardCode: string; emails: CustomerEmailOption[] }> {
    const bp = await b1sFetch<Raw>(`/BusinessPartners('${q(cardCode)}')`).catch(() => null);
    const emails = bp ? extractBpEmailOptions(bp).availableEmails : [];
    return { cardCode, emails: applyDefaultEmlGrpCode(emails, loadState().settings.defaultEmlGrpCode) };
  },

  async convertDeliveries(payload: ConvertDeliveriesRequest): Promise<ConvertDeliveriesResponse> {
    return convert(loadState(), payload, 'MANUAL');
  },

  async runScheduledNow(): Promise<ConvertDeliveriesResponse> {
    const state = loadState();
    const all = await listOpenDeliveries(state);
    const eligible = filterEligibleDeliveries(all, {
      onlyAutoInvoiceCustomers: state.settings.onlyAutoInvoiceCustomers,
      minDeliveryAgeDays: state.settings.minDeliveryAgeDays,
    });
    state.settings.lastRunAt = new Date().toISOString();
    if (eligible.length === 0) {
      audit(state, 'SCHEDULED_RUN_EMPTY', 'Nenhuma guia elegível encontrada.');
      saveState(state);
      return { runId: crypto.randomUUID(), processedCount: 0, invoicesCreated: 0, emailsSent: 0, failedCount: 0, records: [] };
    }
    return convert(
      state,
      {
        deliveryDocEntries: eligible.map((d) => d.docEntry),
        groupingMode: state.settings.groupingMode,
        sendEmail: false,
      },
      'SCHEDULED'
    );
  },

  async listConversions(): Promise<{ conversions: ConversionRecord[] }> {
    return { conversions: loadState().conversions.slice(0, 150) };
  },

  async retryEmail(): Promise<{ conversion: ConversionRecord }> {
    throw new Error(
      'Envio de email indisponível no modo Web Client (sem backend Node.js). Configure o backend com ?apiUrl=... para enviar emails.'
    );
  },

  async listEmails(): Promise<{ emails: SentEmailPreview[] }> {
    return { emails: [] };
  },

  async getSettings(): Promise<{ settings: AutomationSettings }> {
    return { settings: loadState().settings };
  },

  async updateSettings(
    patch: Partial<AutomationSettings> & { smtpPassword?: string }
  ): Promise<{ settings: AutomationSettings }> {
    const state = loadState();
    const { smtpPassword: _ignored, ...rest } = patch;
    state.settings = {
      ...state.settings,
      ...rest,
      // The scheduler and SMTP need a backend; keep them off in native mode.
      schedulerEnabled: false,
      sendEmailAutomatically: false,
    };
    audit(state, 'SETTINGS_UPDATED', `Grouping=${state.settings.groupingMode} [Web Client]`);
    saveState(state);
    return { settings: state.settings };
  },

  async testConnections() {
    const start = Date.now();
    let b1: { ok: boolean; latencyMs: number; companyDb: string; message: string };
    try {
      const info = await b1sFetch<Raw>('/CompanyService_GetCompanyInfo', { method: 'POST', body: '{}' });
      b1 = {
        ok: true,
        latencyMs: Date.now() - start,
        companyDb: String(info.CompanyName ?? ''),
        message: 'Ligação ao SAP B1 Service Layer operacional (sessão do Web Client).',
      };
    } catch (err) {
      b1 = {
        ok: false,
        latencyMs: Date.now() - start,
        companyDb: '',
        message: err instanceof Error ? err.message : 'Erro ao contactar Service Layer.',
      };
    }
    const na = 'Indisponível no modo Web Client (requer backend).';
    return { b1, smtp: { ok: false, message: na }, gateway: { ok: false, latencyMs: 0, message: na } };
  },

  async listAuditLogs(): Promise<{ logs: AuditLogRecord[] }> {
    return { logs: loadState().auditLogs.slice(0, 100) };
  },
};

// ---------------------------------------------------------------------------
// One-time import of the browser-stored settings into the backend
// ---------------------------------------------------------------------------

const IMPORTED_KEY = 'B1_D2I_WEBCLIENT_STATE_IMPORTED';

/** True when Web Client mode saved settings in this browser and they were not imported/dismissed yet. */
export function hasLocalSettingsToImport(): boolean {
  return localStorage.getItem(STATE_KEY) !== null && localStorage.getItem(IMPORTED_KEY) === null;
}

/** Marks the browser-stored settings as handled so the import offer is not shown again. */
export function dismissLocalSettingsImport(): void {
  localStorage.setItem(IMPORTED_KEY, new Date().toISOString());
}

/**
 * Settings worth carrying over to the backend. Scheduler/auto-email flags, SMTP, PDF/gateway and run
 * timestamps are left out: they depend on the backend's own environment and must be set there.
 */
export function getLocalSettingsImportPatch(): Partial<AutomationSettings> {
  const s = loadState().settings;
  return {
    groupingMode: s.groupingMode,
    onlyAutoInvoiceCustomers: s.onlyAutoInvoiceCustomers,
    minDeliveryAgeDays: s.minDeliveryAgeDays,
    defaultEmlGrpCode: s.defaultEmlGrpCode,
    checkPriceMatchLastInvoice: s.checkPriceMatchLastInvoice,
    checkMinimumMargin: s.checkMinimumMargin,
    minimumMarginPercent: s.minimumMarginPercent,
    emailSubjectTemplate: s.emailSubjectTemplate,
    emailBodyTemplate: s.emailBodyTemplate,
    emailBodyIsHtml: s.emailBodyIsHtml,
    ccAddresses: s.ccAddresses,
    replyToAddress: s.replyToAddress,
  };
}
