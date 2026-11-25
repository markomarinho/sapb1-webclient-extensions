import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import type { DeliveryLine, OpenDeliveryNote } from '@b1-d2i/shared';
import { roundMoney } from '@b1-d2i/shared';
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
  lines: DeliveryLine[];
}

export interface IB1ServiceLayerClient {
  listOpenDeliveries(cookieHeader?: string): Promise<OpenDeliveryNote[]>;
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
    lines: DeliveryLine[];
  } | null>;
  testConnection(cookieHeader?: string): Promise<{
    ok: boolean;
    latencyMs: number;
    companyDb: string;
    message: string;
  }>;
}

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
      autoInvoiceEnabled: true,
      docCurrency: 'EUR',
      vatSum: 138.0,
      docTotal: 738.0,
      numAtCard: 'ENC-8840',
      comments: 'Entrega adicional cablagem e switches',
      lines: [
        {
          lineNum: 0,
          itemCode: 'A0088',
          itemDescription: 'Switch Gigabit Managed 24P',
          quantity: 2,
          unitPrice: 300,
          discountPercent: 0,
          taxCode: 'IVA23',
          taxRate: 23,
          lineTotal: 600,
          warehouseCode: '01',
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
        },
      ],
    },
  ];
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
      lines: DeliveryLine[];
    }
  > = new Map();
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

  async createInvoiceFromDeliveries(
    input: CreateInvoiceFromDeliveriesInput
  ): Promise<CreatedInvoiceResult> {
    const docEntry = this.nextInvoiceDocEntry++;
    const docNum = this.nextInvoiceDocNum++;
    const lines = input.deliveries.flatMap((d) => d.lines);
    const vatSum = roundMoney(input.deliveries.reduce((sum, d) => sum + d.vatSum, 0));
    const docTotal = roundMoney(input.deliveries.reduce((sum, d) => sum + d.docTotal, 0));
    const first = input.deliveries[0];

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
      lines,
    };
  }

  async getInvoiceForEmail(docEntry: number) {
    return this.invoices.get(docEntry) ?? null;
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
  private cachedCookie: string | null = null;
  private cachedCookieExpiresAt = 0;

  constructor(private readonly config: AppConfig) {}

  private async resolveCookie(cookieHeader?: string): Promise<string> {
    if (cookieHeader && cookieHeader.includes('B1SESSION=')) {
      return cookieHeader;
    }
    if (this.cachedCookie && Date.now() < this.cachedCookieExpiresAt) {
      return this.cachedCookie;
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
        CompanyDB: this.config.B1_COMPANY_DB,
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
    this.cachedCookie = cookieStr;
    this.cachedCookieExpiresAt = Date.now() + 20 * 60_000;
    return cookieStr;
  }

  private async requestJson<T>(
    method: string,
    endpoint: string,
    cookieHeader?: string,
    body?: unknown
  ): Promise<T> {
    const cookie = await this.resolveCookie(cookieHeader);
    const baseUrl = this.config.B1_SERVICE_LAYER_URL.replace(/\/+$/, '');
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

  async listOpenDeliveries(cookieHeader?: string): Promise<OpenDeliveryNote[]> {
    const filter = encodeURIComponent("DocumentStatus eq 'bost_Open' and Cancelled eq 'tNO'");
    const select = encodeURIComponent(
      'DocEntry,DocNum,DocDate,DocDueDate,CardCode,CardName,DocCurrency,DocTotal,VatSum,NumAtCard,Comments,DocumentLines'
    );
    const data = await this.requestJson<{ value?: Array<Record<string, unknown>> }>(
      'GET',
      `/DeliveryNotes?$filter=${filter}&$select=${select}&$orderby=DocDate desc&$top=200`,
      cookieHeader
    );

    const rawDeliveries = data.value ?? [];
    const uniqueCardCodes = Array.from(new Set(rawDeliveries.map((d) => String(d.CardCode))));
    const bpMap = new Map<
      string,
      { email: string; contactEmail: string; nif: string; autoInvoice: boolean }
    >();

    const autoUdf = this.config.B1_BP_AUTO_INVOICE_UDF;
    const emailUdf = this.config.B1_BP_INVOICE_EMAIL_UDF;

    for (const cardCode of uniqueCardCodes) {
      try {
        const safeCode = cardCode.replace(/'/g, "''");
        const bp = await this.requestJson<Record<string, unknown>>(
          'GET',
          `/BusinessPartners('${encodeURIComponent(safeCode)}')`,
          cookieHeader
        );
        const contacts = Array.isArray(bp.ContactEmployees)
          ? (bp.ContactEmployees as Array<Record<string, unknown>>)
          : [];
        const contactEmail =
          contacts.map((c) => String(c.E_Mail ?? '')).find((e) => e.includes('@')) ?? '';
        const udfEmail = emailUdf ? String(bp[emailUdf] ?? '') : '';
        const primaryEmail = udfEmail.includes('@') ? udfEmail : String(bp.EmailAddress ?? '');
        const autoFlagRaw = autoUdf ? String(bp[autoUdf] ?? '').toUpperCase() : 'Y';
        const autoInvoice = autoFlagRaw === 'Y' || autoFlagRaw === 'YES' || autoFlagRaw === 'TYES' || autoFlagRaw === '1';

        bpMap.set(cardCode, {
          email: primaryEmail,
          contactEmail,
          nif: String(bp.FederalTaxID ?? ''),
          autoInvoice,
        });
      } catch {
        bpMap.set(cardCode, { email: '', contactEmail: '', nif: '', autoInvoice: false });
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
        .map((l) => ({
          lineNum: Number(l.LineNum ?? 0),
          itemCode: String(l.ItemCode ?? ''),
          itemDescription: String(l.ItemDescription ?? ''),
          quantity: Number(l.RemainingOpenQuantity ?? l.Quantity ?? 0),
          unitPrice: Number(l.Price ?? 0),
          discountPercent: Number(l.DiscountPercent ?? 0),
          taxCode: String(l.TaxCode ?? ''),
          taxRate: Number(l.TaxPercentagePerRow ?? 0),
          lineTotal: Number(l.LineTotal ?? 0),
          warehouseCode: l.WarehouseCode ? String(l.WarehouseCode) : undefined,
        }));

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
        autoInvoiceEnabled: bp?.autoInvoice ?? false,
        docCurrency: String(d.DocCurrency ?? 'EUR'),
        docTotal: Number(d.DocTotal ?? 0),
        vatSum: Number(d.VatSum ?? 0),
        numAtCard: d.NumAtCard ? String(d.NumAtCard) : undefined,
        comments: d.Comments ? String(d.Comments) : undefined,
        lines,
      };
    });
  }

  async createInvoiceFromDeliveries(
    input: CreateInvoiceFromDeliveriesInput,
    cookieHeader?: string
  ): Promise<CreatedInvoiceResult> {
    // Copy every open delivery line via BaseType: 15 (ODLN / DeliveryNotes) so SAP B1 closes the source deliveries
    const documentLines = input.deliveries.flatMap((delivery) =>
      delivery.lines.map((line) => ({
        BaseType: 15,
        BaseEntry: delivery.docEntry,
        BaseLine: line.lineNum,
        Quantity: line.quantity,
      }))
    );

    const payload = {
      CardCode: input.cardCode,
      DocDate: input.docDate,
      Comments:
        input.comments ??
        `Faturado automaticamente a partir da(s) Guia(s): ${input.deliveries.map((d) => d.docNum).join(', ')}`,
      DocumentLines: documentLines,
    };

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
      await this.requestJson('GET', '/CompanyService_GetCompanyInfo', cookieHeader);
      return {
        ok: true,
        latencyMs: Date.now() - start,
        companyDb: this.config.B1_COMPANY_DB,
        message: 'Ligação ao SAP B1 Service Layer operacional.',
      };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        companyDb: this.config.B1_COMPANY_DB,
        message: err instanceof Error ? err.message : 'Erro ao contactar Service Layer.',
      };
    }
  }
}
