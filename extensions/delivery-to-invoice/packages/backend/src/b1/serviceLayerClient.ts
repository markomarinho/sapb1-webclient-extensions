import { currentCompany } from '../company/context.js';
import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import type { CustomerEmailOption, DeliveryLine, OpenDeliveryNote } from '@b1-d2i/shared';
import {
  buildInvoicePayload,
  deliverySelectFields,
  joinNumAtCard,
  parseDeliveryExpenses,
  parseDeliveryHeaderCopy,
  parseUdfList,
  roundMoney,
} from '@b1-d2i/shared';
import type { AppConfig } from '../config/env.js';

export interface CreateInvoiceFromDeliveriesInput {
  cardCode: string;
  docDate: string;
  deliveries: OpenDeliveryNote[];
  comments?: string;
}

export interface CreatedInvoiceResult {
  docEntry: number;
  docNum: number;
  docDate: string;
  docTotal: number;
  vatSum: number;
  currency: string;
  /** Customer reference (NumAtCard) stored on the invoice. */
  numAtCard: string;
  lines: DeliveryLine[];
}

export interface IB1ServiceLayerClient {
  /** CompanyName of the company the caller's own B1SESSION is logged into (null if no/invalid session). */
  getSessionCompanyName(cookieHeader?: string): Promise<string | null>;
  listOpenDeliveries(cookieHeader?: string): Promise<OpenDeliveryNote[]>;
  getCustomerEmails(cardCode: string, cookieHeader?: string): Promise<CustomerEmailOption[]>;
  createInvoiceFromDeliveries(
    input: CreateInvoiceFromDeliveriesInput,
    cookieHeader?: string
  ): Promise<CreatedInvoiceResult>;
  getInvoiceForEmail(
    docEntry: number,
    cookieHeader?: string
  ): Promise<{
    docEntry: number;
    docNum: number;
    docDate: string;
    cardCode: string;
    cardName: string;
    customerNif: string;
    currency: string;
    docTotal: number;
    vatSum: number;
    numAtCard: string;
    lines: DeliveryLine[];
  } | null>;
  testConnection(cookieHeader?: string): Promise<{
    ok: boolean;
    latencyMs: number;
    companyDb: string;
    message: string;
  }>;
}

const MOCK_CUSTOMER_EMAILS: Record<string, CustomerEmailOption[]> = {
  C20001: [
    {
      id: 'main:faturacao@deltacomercio.pt',
      email: 'faturacao@deltacomercio.pt',
      source: 'MAIN',
      label: 'faturacao@deltacomercio.pt',
      isDefault: true,
    },
    {
      id: 'contact:1:financeiro@deltacomercio.pt',
      email: 'financeiro@deltacomercio.pt',
      source: 'CONTACT',
      contactName: 'Ana Martins',
      position: 'Diretora Financeira',
      emlGrpCode: 'FATURACAO',
      label: 'Ana Martins (Diretora Financeira) [FATURACAO] — financeiro@deltacomercio.pt',
    },
    {
      id: 'contact:2:logistica@deltacomercio.pt',
      email: 'logistica@deltacomercio.pt',
      source: 'CONTACT',
      contactName: 'Carlos Ferreira',
      position: 'Responsável de Logística',
      emlGrpCode: 'LOGISTICA',
      label: 'Carlos Ferreira (Responsável de Logística) [LOGISTICA] — logistica@deltacomercio.pt',
    },
  ],
  C20015: [
    {
      id: 'contact:1:contas.pagar@techlusitana.pt',
      email: 'contas.pagar@techlusitana.pt',
      source: 'CONTACT',
      contactName: 'Sofia Almeida',
      position: 'Contas a Pagar',
      emlGrpCode: 'FATURACAO',
      label: 'Sofia Almeida (Contas a Pagar) [FATURACAO] — contas.pagar@techlusitana.pt',
      isDefault: true,
    },
    {
      id: 'contact:2:mrodrigues@techlusitana.pt',
      email: 'mrodrigues@techlusitana.pt',
      source: 'CONTACT',
      contactName: 'Miguel Rodrigues',
      position: 'Diretor de TI',
      emlGrpCode: 'TI',
      label: 'Miguel Rodrigues (Diretor de TI) [TI] — mrodrigues@techlusitana.pt',
    },
  ],
  C20022: [
    {
      id: 'main:ap@corticeirasul.pt',
      email: 'ap@corticeirasul.pt',
      source: 'MAIN',
      label: 'ap@corticeirasul.pt',
      isDefault: true,
    },
    {
      id: 'contact:1:rtavares@corticeirasul.pt',
      email: 'rtavares@corticeirasul.pt',
      source: 'CONTACT',
      contactName: 'Rui Tavares',
      position: 'Tesouraria',
      emlGrpCode: 'FATURACAO',
      label: 'Rui Tavares (Tesouraria) [FATURACAO] — rtavares@corticeirasul.pt',
    },
    {
      id: 'contact:2:ihenriques@corticeirasul.pt',
      email: 'ihenriques@corticeirasul.pt',
      source: 'CONTACT',
      contactName: 'Inês Henriques',
      position: 'Compras',
      emlGrpCode: 'COMPRAS',
      label: 'Inês Henriques (Compras) [COMPRAS] — ihenriques@corticeirasul.pt',
    },
  ],
  C20039: [],
};

function buildSeedMockDeliveries(): OpenDeliveryNote[] {
  const today = new Date();
  const daysAgo = (n: number) => {
    const d = new Date(today.getTime() - n * 86_400_000);
    return d.toISOString().slice(0, 10);
  };

  return [
    {
      docEntry: 501,
      docNum: 20260101,
      docDate: daysAgo(3),
      docDueDate: daysAgo(-27),
      cardCode: 'C20001',
      cardName: 'Delta Comércio & Distribuição, Lda.',
      federalTaxId: 'PT504112233',
      customerEmail: 'faturacao@deltacomercio.pt',
      contactEmail: 'financeiro@deltacomercio.pt',
      contactName: 'Ana Martins',
      availableEmails: MOCK_CUSTOMER_EMAILS.C20001,
      autoInvoiceEnabled: true,
      docCurrency: 'EUR',
      vatSum: 345.0,
      docTotal: 1845.0,
      numAtCard: 'ENC-8821',
      comments: 'Entrega armazém Lisboa Norte',
      lines: [
        {
          lineNum: 0,
          itemCode: 'A0010',
          itemDescription: 'Servidor Rack Industrial 2U',
          quantity: 1,
          unitPrice: 1200,
          discountPercent: 0,
          taxCode: 'IVA23',
          taxRate: 23,
          lineTotal: 1200,
          warehouseCode: '01',
          unitCost: 780,
          lastInvoicedPrice: 1200,
          lastInvoicedDocNum: 20264890,
          lastInvoicedDate: daysAgo(18),
        },
        {
          lineNum: 1,
          itemCode: 'S0045',
          itemDescription: 'Instalação e Configuração On-Site',
          quantity: 3,
          unitPrice: 100,
          discountPercent: 0,
          taxCode: 'IVA23',
          taxRate: 23,
          lineTotal: 300,
          warehouseCode: '01',
          unitCost: 60,
          lastInvoicedPrice: 100,
          lastInvoicedDocNum: 20264890,
          lastInvoicedDate: daysAgo(18),
        },
      ],
    },
    {
      docEntry: 502,
      docNum: 20260102,
      docDate: daysAgo(2),
      docDueDate: daysAgo(-28),
      cardCode: 'C20001',
      cardName: 'Delta Comércio & Distribuição, Lda.',
      federalTaxId: 'PT504112233',
      customerEmail: 'faturacao@deltacomercio.pt',
      contactEmail: 'financeiro@deltacomercio.pt',
      contactName: 'Ana Martins',
      availableEmails: MOCK_CUSTOMER_EMAILS.C20001,
      autoInvoiceEnabled: true,
      docCurrency: 'EUR',
      vatSum: 138.0,
      docTotal: 738.0,
      numAtCard: 'ENC-8840',
      comments: 'Entrega adicional cablagem e switches (2 linhas do mesmo artigo A0088 com preços diferentes)',
      lines: [
        {
          lineNum: 0,
          itemCode: 'A0088',
          itemDescription: 'Switch Gigabit Managed 24P',
          quantity: 1,
          unitPrice: 320,
          discountPercent: 0,
          taxCode: 'IVA23',
          taxRate: 23,
          lineTotal: 320,
          warehouseCode: '01',
          unitCost: 250,
          lastInvoicedPrice: 340,
          lastInvoicedDocNum: 20264912,
          lastInvoicedDate: daysAgo(12),
        },
        {
          lineNum: 1,
          itemCode: 'A0088',
          itemDescription: 'Switch Gigabit Managed 24P',
          quantity: 1,
          unitPrice: 280,
          discountPercent: 0,
          taxCode: 'IVA23',
          taxRate: 23,
          lineTotal: 280,
          warehouseCode: '02',
          unitCost: 250,
          lastInvoicedPrice: 340,
          lastInvoicedDocNum: 20264912,
          lastInvoicedDate: daysAgo(12),
        },
      ],
    },
    {
      docEntry: 503,
      docNum: 20260103,
      docDate: daysAgo(1),
      docDueDate: daysAgo(-29),
      cardCode: 'C20015',
      cardName: 'TechLusitana Sistemas, S.A.',
      federalTaxId: 'PT509876544',
      customerEmail: '',
      contactEmail: 'contas.pagar@techlusitana.pt',
      contactName: 'Sofia Almeida',
      availableEmails: MOCK_CUSTOMER_EMAILS.C20015,
      autoInvoiceEnabled: true,
      docCurrency: 'EUR',
      vatSum: 805.0,
      docTotal: 4305.0,
      numAtCard: 'PO-2026-441',
      comments: 'Fornecimento licenças e terminais POS',
      lines: [
        {
          lineNum: 0,
          itemCode: 'P0200',
          itemDescription: 'Terminal POS Tátil 15" + Impressora',
          quantity: 5,
          unitPrice: 700,
          discountPercent: 0,
          taxCode: 'IVA23',
          taxRate: 23,
          lineTotal: 3500,
          warehouseCode: '02',
          unitCost: 455,
          lastInvoicedPrice: 750,
          lastInvoicedDocNum: 20264705,
          lastInvoicedDate: daysAgo(25),
        },
      ],
    },
    {
      docEntry: 504,
      docNum: 20260104,
      docDate: daysAgo(0),
      docDueDate: daysAgo(-30),
      cardCode: 'C20022',
      cardName: 'Corticeira do Sul, S.A.',
      federalTaxId: 'PT507654323',
      customerEmail: 'ap@corticeirasul.pt',
      contactEmail: 'rtavares@corticeirasul.pt',
      contactName: 'Rui Tavares',
      availableEmails: MOCK_CUSTOMER_EMAILS.C20022,
      autoInvoiceEnabled: false,
      docCurrency: 'EUR',
      vatSum: 690.0,
      docTotal: 3690.0,
      numAtCard: 'CS-9012',
      comments: 'Cliente com faturação manual (U_AutoInvoice = N)',
      lines: [
        {
          lineNum: 0,
          itemCode: 'M0110',
          itemDescription: 'Palete Embalagem Industrial Reforçada',
          quantity: 60,
          unitPrice: 50,
          discountPercent: 0,
          taxCode: 'IVA23',
          taxRate: 23,
          lineTotal: 3000,
          warehouseCode: '01',
          unitCost: 40,
          lastInvoicedPrice: 50,
          lastInvoicedDocNum: 20264950,
          lastInvoicedDate: daysAgo(9),
        },
      ],
    },
    {
      docEntry: 505,
      docNum: 20260105,
      docDate: daysAgo(4),
      docDueDate: daysAgo(-26),
      cardCode: 'C20039',
      cardName: 'Oficina Atlântico Unipessoal, Lda.',
      federalTaxId: 'PT512345678',
      customerEmail: '',
      contactEmail: '',
      availableEmails: MOCK_CUSTOMER_EMAILS.C20039,
      autoInvoiceEnabled: true,
      docCurrency: 'EUR',
      vatSum: 115.0,
      docTotal: 615.0,
      numAtCard: 'OA-112',
      comments: 'Cliente sem endereço de email configurado (testa estado INVOICED_NO_EMAIL)',
      lines: [
        {
          lineNum: 0,
          itemCode: 'K0012',
          itemDescription: 'Kit Ferramentas Manutenção Preventiva',
          quantity: 2,
          unitPrice: 250,
          discountPercent: 0,
          taxCode: 'IVA23',
          taxRate: 23,
          lineTotal: 500,
          warehouseCode: '01',
          unitCost: 150,
          lastInvoicedPrice: 250,
          lastInvoicedDocNum: 20264810,
          lastInvoicedDate: daysAgo(30),
        },
      ],
    },
  ];
}

interface LastInvoiced {
  price: number;
  uomCode?: string;
  uomFactor: number;
  docNum: number;
  docDate: string;
  priceSource?: string | null;
  priceList?: number | null;
}

export class MockServiceLayerClient implements IB1ServiceLayerClient {
  private deliveries: Map<number, OpenDeliveryNote>;
  private invoices: Map<
    number,
    {
      docEntry: number;
      docNum: number;
      docDate: string;
      cardCode: string;
      cardName: string;
      customerNif: string;
      currency: string;
      docTotal: number;
      vatSum: number;
      numAtCard: string;
      lines: DeliveryLine[];
    }
  > = new Map();
  /** Service Layer bodies that would have been POSTed to /Invoices (inspected by tests). */
  public readonly invoicePayloads: Array<Record<string, unknown>> = [];
  private nextInvoiceDocEntry = 9001;
  private nextInvoiceDocNum = 20265001;

  constructor(private readonly config: AppConfig) {
    this.deliveries = new Map(buildSeedMockDeliveries().map((d) => [d.docEntry, d]));
  }

  public resetMockData(): void {
    this.deliveries = new Map(buildSeedMockDeliveries().map((d) => [d.docEntry, d]));
    this.invoices.clear();
  }

  async listOpenDeliveries(): Promise<OpenDeliveryNote[]> {
    return Array.from(this.deliveries.values()).sort((a, b) => a.docNum - b.docNum);
  }

  async getCustomerEmails(cardCode: string): Promise<CustomerEmailOption[]> {
    return MOCK_CUSTOMER_EMAILS[cardCode] ?? [];
  }

  async createInvoiceFromDeliveries(
    input: CreateInvoiceFromDeliveriesInput
  ): Promise<CreatedInvoiceResult> {
    const docEntry = this.nextInvoiceDocEntry++;
    const docNum = this.nextInvoiceDocNum++;
    const lines = input.deliveries.flatMap((d) => d.lines);
    const vatSum = roundMoney(input.deliveries.reduce((sum, d) => sum + d.vatSum, 0));
    const docTotal = roundMoney(input.deliveries.reduce((sum, d) => sum + d.docTotal, 0));
    const first = input.deliveries[0];
    const numAtCard = joinNumAtCard(input.deliveries);
    this.invoicePayloads.push(buildInvoicePayload(input));

    // Close the source delivery notes (mimicking SAP B1 copy-to-invoice behavior)
    for (const d of input.deliveries) {
      this.deliveries.delete(d.docEntry);
    }

    const invoice = {
      docEntry,
      docNum,
      docDate: input.docDate,
      cardCode: input.cardCode,
      cardName: first.cardName,
      customerNif: first.federalTaxId,
      currency: first.docCurrency,
      docTotal,
      vatSum,
      numAtCard,
      lines,
    };
    this.invoices.set(docEntry, invoice);

    return {
      docEntry,
      docNum,
      docDate: input.docDate,
      docTotal,
      vatSum,
      currency: first.docCurrency,
      numAtCard,
      lines,
    };
  }

  async getInvoiceForEmail(docEntry: number) {
    return this.invoices.get(docEntry) ?? null;
  }

  async getSessionCompanyName(): Promise<string | null> {
    return null;
  }

  async testConnection() {
    return {
      ok: true,
      latencyMs: 2,
      companyDb: this.config.B1_COMPANY_DB,
      message: `Modo Mock ativo (${this.deliveries.size} guias de remessa abertas em memória).`,
    };
  }
}

interface RawHttpResult {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  bodyText: string;
}

function executeNodeHttpRequest(
  fullUrl: string,
  opts: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    rejectUnauthorized: boolean;
    timeoutMs?: number;
  }
): Promise<RawHttpResult> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(fullUrl);
    const isHttps = parsedUrl.protocol === 'https:';
    const transport = isHttps ? https : http;

    const req = transport.request(
      parsedUrl,
      {
        method: opts.method,
        headers: opts.headers,
        rejectUnauthorized: isHttps ? opts.rejectUnauthorized : undefined,
        timeout: opts.timeoutMs ?? 25_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode ?? 500,
            headers: res.headers,
            bodyText: Buffer.concat(chunks).toString('utf8'),
          });
        });
      }
    );

    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('Service Layer request timed out')));
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

export class LiveServiceLayerClient implements IB1ServiceLayerClient {
  /** Technical-user sessions (scheduler only), one per company. */
  private cachedCookies = new Map<string, { cookie: string; expiresAt: number }>();

  constructor(private readonly config: AppConfig) {}

  public async getSessionCompanyName(cookieHeader?: string): Promise<string | null> {
    if (!this.isUserSession(cookieHeader)) return null;
    try {
      const info = await this.requestJson<{ CompanyName?: string }>(
        'POST',
        '/CompanyService_GetCompanyInfo',
        cookieHeader,
        {}
      );
      const name = String(info.CompanyName ?? '').trim();
      return name || null;
    } catch {
      return null;
    }
  }

  /** True when the caller brought a Web Client `SESSION` cookie or a Service Layer `B1SESSION` cookie. */
  private isUserSession(cookieHeader?: string): cookieHeader is string {
    return Boolean(cookieHeader && /(?:^|;\s*)(?:B1)?SESSION=/.test(cookieHeader));
  }

  /** Browser sessions (`SESSION`) must go through the Web Client gateway; B1SESSION goes straight to the SL. */
  private baseUrlFor(cookieHeader?: string): string {
    const viaWebClient =
      Boolean(this.config.B1_WEBCLIENT_URL) &&
      Boolean(cookieHeader) &&
      !cookieHeader!.includes('B1SESSION=') &&
      /(?:^|;\s*)SESSION=/.test(cookieHeader!);
    return viaWebClient
      ? `${this.config.B1_WEBCLIENT_URL.replace(/\/+$/, '')}/b1s/v1`
      : this.config.B1_SERVICE_LAYER_URL.replace(/\/+$/, '');
  }

  private async resolveCookie(cookieHeader?: string): Promise<string> {
    if (this.isUserSession(cookieHeader)) {
      return cookieHeader;
    }
    const company = currentCompany();
    const cached = this.cachedCookies.get(company);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.cookie;
    }
    if (!this.config.B1_TECH_USER || !this.config.B1_TECH_PASSWORD) {
      throw new Error(
        'Sem sessão B1SESSION do Web Client nem credenciais técnicas (B1_TECH_USER / B1_TECH_PASSWORD).'
      );
    }

    const baseUrl = this.config.B1_SERVICE_LAYER_URL.replace(/\/+$/, '');
    const res = await executeNodeHttpRequest(`${baseUrl}/Login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        CompanyDB: company,
        UserName: this.config.B1_TECH_USER,
        Password: this.config.B1_TECH_PASSWORD,
      }),
      rejectUnauthorized: this.config.B1_REJECT_UNAUTHORIZED_TLS,
    });

    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new Error(`Falha no login do Service Layer (${res.statusCode}): ${res.bodyText}`);
    }

    const setCookies = res.headers['set-cookie'] ?? [];
    const cookieStr = setCookies.map((c) => c.split(';')[0]).join('; ');
    this.cachedCookies.set(company, { cookie: cookieStr, expiresAt: Date.now() + 20 * 60_000 });
    return cookieStr;
  }

  private async requestJson<T>(
    method: string,
    endpoint: string,
    cookieHeader?: string,
    body?: unknown
  ): Promise<T> {
    const cookie = await this.resolveCookie(cookieHeader);
    const baseUrl = this.baseUrlFor(cookieHeader);
    const res = await executeNodeHttpRequest(`${baseUrl}${endpoint}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      rejectUnauthorized: this.config.B1_REJECT_UNAUTHORIZED_TLS,
    });

    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new Error(`SAP B1 Service Layer ${method} ${endpoint} falhou (${res.statusCode}): ${res.bodyText}`);
    }
    return (res.bodyText ? JSON.parse(res.bodyText) : {}) as T;
  }

  private extractBpEmailOptions(bp: Record<string, unknown>): {
    primaryEmail: string;
    firstContactEmail: string;
    firstContactName: string;
    availableEmails: CustomerEmailOption[];
  } {
    const emailUdf = this.config.B1_BP_INVOICE_EMAIL_UDF;
    const udfEmail = emailUdf ? String(bp[emailUdf] ?? '').trim() : '';
    const mainEmail = String(bp.EmailAddress ?? '').trim();

    const availableEmails: CustomerEmailOption[] = [];

    if (udfEmail && udfEmail.includes('@')) {
      availableEmails.push({
        id: `udf:${udfEmail.toLowerCase()}`,
        email: udfEmail,
        source: 'UDF',
        label: `Email Faturação (${emailUdf}) — ${udfEmail}`,
        isDefault: true,
      });
    }

    if (mainEmail && mainEmail.includes('@')) {
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

    const contacts = Array.isArray(bp.ContactEmployees)
      ? (bp.ContactEmployees as Array<Record<string, unknown>>)
      : [];

    let firstContactEmail = '';
    let firstContactName = '';

    contacts.forEach((c, idx) => {
      const active = String(c.Active ?? 'tYES');
      if (active === 'tNO') return;
      const email = String(c.E_Mail ?? c.E_MailL ?? '').trim();
      if (!email || !email.includes('@')) return;

      const firstName = String(c.FirstName ?? '').trim();
      const middleName = String(c.MiddleName ?? '').trim();
      const lastName = String(c.LastName ?? '').trim();
      const fullName = [firstName, middleName, lastName].filter(Boolean).join(' ').trim();
      const rawName = String(c.Name ?? '').trim();
      const contactName = fullName || rawName || `Contacto #${idx + 1}`;
      const position = String(c.Position ?? c.Title ?? '').trim() || undefined;
      const emlGrpCode = String(c.EmailGroupCode ?? c.EmlGrpCode ?? '').trim() || undefined;
      const internalCode = c.InternalCode ?? idx + 1;

      if (!firstContactEmail) {
        firstContactEmail = email;
        firstContactName = contactName;
      }

      const roleSuffix = position ? ` (${position})` : '';
      const groupSuffix = emlGrpCode ? ` [${emlGrpCode}]` : '';
      availableEmails.push({
        id: `contact:${internalCode}:${email.toLowerCase()}`,
        email,
        source: 'CONTACT',
        contactName,
        position,
        emlGrpCode,
        label: `${contactName}${roleSuffix}${groupSuffix} — ${email}`,
        isDefault: availableEmails.length === 0,
      });
    });

    const primaryEmail =
      udfEmail.includes('@') ? udfEmail : mainEmail.includes('@') ? mainEmail : '';

    return {
      primaryEmail,
      firstContactEmail,
      firstContactName,
      availableEmails,
    };
  }

  async getCustomerEmails(cardCode: string, cookieHeader?: string): Promise<CustomerEmailOption[]> {
    try {
      const safeCode = cardCode.replace(/'/g, "''");
      const bp = await this.requestJson<Record<string, unknown>>(
        'GET',
        `/BusinessPartners('${encodeURIComponent(safeCode)}')`,
        cookieHeader
      );
      return this.extractBpEmailOptions(bp).availableEmails;
    } catch {
      return [];
    }
  }

  async listOpenDeliveries(cookieHeader?: string): Promise<OpenDeliveryNote[]> {
    const filter = encodeURIComponent("DocumentStatus eq 'bost_Open' and Cancelled eq 'tNO'");
    const select = encodeURIComponent(deliverySelectFields(parseUdfList(this.config.B1_COPY_HEADER_UDFS)));
    const data = await this.requestJson<{ value?: Array<Record<string, unknown>> }>(
      'GET',
      `/DeliveryNotes?$filter=${filter}&$select=${select}&$orderby=DocDate desc&$top=200`,
      cookieHeader
    );

    const rawDeliveries = data.value ?? [];
    const uniqueCardCodes = Array.from(new Set(rawDeliveries.map((d) => String(d.CardCode))));
    const bpMap = new Map<
      string,
      {
        email: string;
        contactEmail: string;
        contactName: string;
        availableEmails: CustomerEmailOption[];
        nif: string;
        autoInvoice: boolean;
        lastInvoicedByItem: Map<string, LastInvoiced>;
      }
    >();

    const autoUdf = this.config.B1_BP_AUTO_INVOICE_UDF;

    for (const cardCode of uniqueCardCodes) {
      const lastInvoicedByItem = new Map<string, LastInvoiced>();
      try {
        const safeCode = cardCode.replace(/'/g, "''");
        const invFilter = encodeURIComponent(
          `CardCode eq '${safeCode}' and Cancelled eq 'tNO'`
        );
        const invSelect = encodeURIComponent('DocEntry,DocNum,DocDate,DocumentLines');
        const invData = await this.requestJson<{ value?: Array<Record<string, unknown>> }>(
          'GET',
          `/Invoices?$filter=${invFilter}&$select=${invSelect}&$orderby=DocDate desc,DocEntry desc&$top=25`,
          cookieHeader
        );
        for (const inv of invData.value ?? []) {
          const invDocNum = Number(inv.DocNum ?? 0);
          const invDocDate = String(inv.DocDate ?? '').slice(0, 10);
          const invLines = Array.isArray(inv.DocumentLines)
            ? (inv.DocumentLines as Array<Record<string, unknown>>)
            : [];
          for (const il of invLines) {
            const itemCode = String(il.ItemCode ?? '');
            if (!itemCode || lastInvoicedByItem.has(itemCode)) continue;
            // Service Layer: `Price` is already after discount, `UnitPrice` is before.
            lastInvoicedByItem.set(itemCode, {
              price: roundMoney(Number(il.Price ?? 0)),
              uomCode: il.UoMCode ? String(il.UoMCode) : undefined,
              uomFactor: Number(il.UnitsOfMeasurment ?? 1) || 1,
              docNum: invDocNum,
              docDate: invDocDate,
              priceSource: il.PriceSource ? String(il.PriceSource) : null,
              priceList:
                il.PriceList !== undefined && il.PriceList !== null ? Number(il.PriceList) : null,
            });
          }
        }
      } catch {
        // Ignore if invoice history query is unavailable
      }

      try {
        const safeCode = cardCode.replace(/'/g, "''");
        const bp = await this.requestJson<Record<string, unknown>>(
          'GET',
          `/BusinessPartners('${encodeURIComponent(safeCode)}')`,
          cookieHeader
        );
        const extracted = this.extractBpEmailOptions(bp);
        const autoFlagRaw = autoUdf ? String(bp[autoUdf] ?? '').toUpperCase() : 'Y';
        const autoInvoice = autoFlagRaw === 'Y' || autoFlagRaw === 'YES' || autoFlagRaw === 'TYES' || autoFlagRaw === '1';

        bpMap.set(cardCode, {
          email: extracted.primaryEmail,
          contactEmail: extracted.firstContactEmail,
          contactName: extracted.firstContactName,
          availableEmails: extracted.availableEmails,
          nif: String(bp.FederalTaxID ?? ''),
          autoInvoice,
          lastInvoicedByItem,
        });
      } catch {
        bpMap.set(cardCode, {
          email: '',
          contactEmail: '',
          contactName: '',
          availableEmails: [],
          nif: '',
          autoInvoice: false,
          lastInvoicedByItem,
        });
      }
    }

    return rawDeliveries.map((d) => {
      const cardCode = String(d.CardCode);
      const bp = bpMap.get(cardCode);
      const rawLines = Array.isArray(d.DocumentLines)
        ? (d.DocumentLines as Array<Record<string, unknown>>)
        : [];
      const lines: DeliveryLine[] = rawLines
        .filter((l) => String(l.LineStatus ?? 'bost_Open') === 'bost_Open')
        .map((l) => {
          const itemCode = String(l.ItemCode ?? '');
          const lastInv = bp?.lastInvoicedByItem.get(itemCode);
          return {
            lineNum: Number(l.LineNum ?? 0),
            itemCode,
            itemDescription: String(l.ItemDescription ?? ''),
            quantity: Number(l.RemainingOpenQuantity ?? l.Quantity ?? 0),
            // `UnitPrice` is before discount; `Price` is after discount (already net).
            unitPrice: Number(l.UnitPrice ?? l.Price ?? 0),
            discountPercent: Number(l.DiscountPercent ?? 0),
            taxCode: String(l.TaxCode ?? ''),
            taxRate: Number(l.TaxPercentagePerRow ?? 0),
            lineTotal: Number(l.LineTotal ?? 0),
            warehouseCode: l.WarehouseCode ? String(l.WarehouseCode) : undefined,
            unitCost: Number(l.GrossBuyPrice ?? l.StockPrice ?? 0),
            uomCode: l.UoMCode ? String(l.UoMCode) : undefined,
            uomFactor: Number(l.UnitsOfMeasurment ?? 1) || 1,
            lastInvoicedUomCode: lastInv?.uomCode,
            lastInvoicedUomFactor: lastInv?.uomFactor,
            lastInvoicedPrice: lastInv ? lastInv.price : null,
            lastInvoicedDocNum: lastInv ? lastInv.docNum : null,
            lastInvoicedDate: lastInv ? lastInv.docDate : null,
            priceSource: l.PriceSource ? String(l.PriceSource) : null,
            priceList:
              l.PriceList !== undefined && l.PriceList !== null ? Number(l.PriceList) : null,
            lastInvoicedPriceSource: lastInv?.priceSource ?? null,
            lastInvoicedPriceList: lastInv?.priceList ?? null,
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
        headerCopy: parseDeliveryHeaderCopy(d, parseUdfList(this.config.B1_COPY_HEADER_UDFS)),
        lines,
      };
    });
  }

  async createInvoiceFromDeliveries(
    input: CreateInvoiceFromDeliveriesInput,
    cookieHeader?: string
  ): Promise<CreatedInvoiceResult> {
    // Copy every open delivery line via BaseType: 15 (ODLN / DeliveryNotes) so SAP B1 closes the source deliveries.
    // The body also carries NumAtCard, freight/expenses (linked to the delivery rows) and the header values.
    const payload = buildInvoicePayload({
      ...input,
      extraUdfs: parseUdfList(this.config.B1_COPY_HEADER_UDFS),
    });

    const created = await this.requestJson<Record<string, unknown>>(
      'POST',
      '/Invoices',
      cookieHeader,
      payload
    );

    return {
      docEntry: Number(created.DocEntry),
      docNum: Number(created.DocNum),
      docDate: String(created.DocDate ?? input.docDate).slice(0, 10),
      docTotal: Number(created.DocTotal ?? 0),
      vatSum: Number(created.VatSum ?? 0),
      currency: String(created.DocCurrency ?? input.deliveries[0]?.docCurrency ?? 'EUR'),
      numAtCard: String(created.NumAtCard ?? joinNumAtCard(input.deliveries)),
      lines: input.deliveries.flatMap((d) => d.lines),
    };
  }

  async getInvoiceForEmail(docEntry: number, cookieHeader?: string) {
    const inv = await this.requestJson<Record<string, unknown>>(
      'GET',
      `/Invoices(${docEntry})`,
      cookieHeader
    );
    const rawLines = Array.isArray(inv.DocumentLines)
      ? (inv.DocumentLines as Array<Record<string, unknown>>)
      : [];

    return {
      docEntry: Number(inv.DocEntry),
      docNum: Number(inv.DocNum),
      docDate: String(inv.DocDate ?? '').slice(0, 10),
      cardCode: String(inv.CardCode ?? ''),
      cardName: String(inv.CardName ?? ''),
      customerNif: String(inv.FederalTaxID ?? ''),
      currency: String(inv.DocCurrency ?? 'EUR'),
      docTotal: Number(inv.DocTotal ?? 0),
      vatSum: Number(inv.VatSum ?? 0),
      numAtCard: String(inv.NumAtCard ?? ''),
      lines: rawLines.map((l) => ({
        lineNum: Number(l.LineNum ?? 0),
        itemCode: String(l.ItemCode ?? ''),
        itemDescription: String(l.ItemDescription ?? ''),
        quantity: Number(l.Quantity ?? 0),
        unitPrice: Number(l.Price ?? 0),
        discountPercent: Number(l.DiscountPercent ?? 0),
        taxCode: String(l.TaxCode ?? ''),
        taxRate: Number(l.TaxPercentagePerRow ?? 0),
        lineTotal: Number(l.LineTotal ?? 0),
      })),
    };
  }

  async testConnection(cookieHeader?: string) {
    const start = Date.now();
    try {
      await this.requestJson('POST', '/CompanyService_GetCompanyInfo', cookieHeader, {});
      return {
        ok: true,
        latencyMs: Date.now() - start,
        companyDb: currentCompany(),
        message: 'Ligação ao SAP B1 Service Layer operacional.',
      };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        companyDb: currentCompany(),
        message: err instanceof Error ? err.message : 'Erro ao contactar Service Layer.',
      };
    }
  }
}
