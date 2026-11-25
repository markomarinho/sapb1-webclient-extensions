import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import type { AppConfig } from '../config/env.js';
import type { MockHanaReadRepository } from './hanaReadRepository.js';

export type B1ServiceLayerInvoiceType =
  | 'it_Invoice'
  | 'it_CredItnote'
  | 'it_PurchaseInvoice'
  | 'it_PurchaseCreditNote';

export interface CreatePaymentInput {
  cardCode: string;
  docDate: string;
  transferAccount: string;
  transferSum: number;
  transferDate: string;
  transferReference: string;
  remarks: string;
  invoices: Array<{
    docEntry: number;
    sumApplied: number;
    invoiceType: B1ServiceLayerInvoiceType;
  }>;
}

export interface CreateDirectGlPaymentInput {
  direction: 'CREDIT' | 'DEBIT';
  docDate: string;
  transferAccount: string;
  transferSum: number;
  transferDate: string;
  transferReference: string;
  expenseOrRevenueGlAccount: string;
  remarks: string;
}

export interface CreateBankPageInput {
  accountCode: string;
  dueDate: string;
  debitAmount: number;
  creditAmount: number;
  paymentReference: string;
  details: string;
}

export interface ExternalReconcileInput {
  glAccountCode: string;
  bankPageSequence: number;
  journalTransId: number;
  journalLineId: number;
}

export interface IB1ServiceLayerClient {
  testConnection(cookieHeader?: string): Promise<{
    ok: boolean;
    latencyMs: number;
    authenticatedUser: string;
    companyDb: string;
  }>;
  resolveSessionUser(cookieHeader?: string, userHeader?: string): Promise<string>;
  createIncomingPayment(
    input: CreatePaymentInput,
    cookieHeader?: string
  ): Promise<{ docEntry: number; transId: number; transLineId: number }>;
  createVendorPayment(
    input: CreatePaymentInput,
    cookieHeader?: string
  ): Promise<{ docEntry: number; transId: number; transLineId: number }>;
  createDirectGlAccountPayment(
    input: CreateDirectGlPaymentInput,
    cookieHeader?: string
  ): Promise<{ docEntry: number; transId: number; transLineId: number }>;
  createBankPage(
    input: CreateBankPageInput,
    cookieHeader?: string
  ): Promise<{ sequence: number }>;
  reconcileExternalBankStatement(
    input: ExternalReconcileInput,
    cookieHeader?: string
  ): Promise<void>;
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
        timeout: opts.timeoutMs ?? 20_000,
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

    req.on('timeout', () => {
      req.destroy(new Error(`Service Layer request timed out (${fullUrl})`));
    });
    req.on('error', (err) => reject(err));

    if (opts.body !== undefined) {
      req.write(opts.body);
    }
    req.end();
  });
}

/**
 * Live SAP Business One Service Layer Client.
 * Supports on-premise self-signed certificates (B1_REJECT_UNAUTHORIZED_TLS=false),
 * Web Client B1SESSION cookie forwarding, and fallback technical user login.
 */
export class LiveServiceLayerClient implements IB1ServiceLayerClient {
  private readonly baseUrl: string;
  private cachedTechCookie: string | null = null;
  private cachedTechCookieExpiry = 0;

  constructor(private readonly config: AppConfig) {
    this.baseUrl = config.B1_SERVICE_LAYER_URL.replace(/\/+$/, '');
  }

  private async getAuthCookie(forwardedCookie?: string): Promise<string> {
    if (forwardedCookie && forwardedCookie.includes('B1SESSION=')) {
      return forwardedCookie;
    }

    if (this.cachedTechCookie && Date.now() < this.cachedTechCookieExpiry) {
      return this.cachedTechCookie;
    }

    if (!this.config.B1_TECH_USER || !this.config.B1_TECH_PASSWORD) {
      throw new Error(
        'No SAP B1 Web Client session cookie (B1SESSION) forwarded and no fallback B1_TECH_USER configured.'
      );
    }

    const res = await executeNodeHttpRequest(`${this.baseUrl}/Login`, {
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
      throw new Error(`Service Layer Login failed (${res.statusCode}): ${res.bodyText}`);
    }

    const rawSetCookies = res.headers['set-cookie'] ?? [];
    const cookieList = Array.isArray(rawSetCookies) ? rawSetCookies : [rawSetCookies];
    const cookieStr = cookieList.map((c) => c.split(';')[0]).join('; ');
    this.cachedTechCookie = cookieStr;
    this.cachedTechCookieExpiry = Date.now() + 20 * 60 * 1000;
    return cookieStr;
  }

  private async slRequest<T>(
    endpoint: string,
    options: { method: string; body?: unknown; cookieHeader?: string }
  ): Promise<T> {
    const cookie = await this.getAuthCookie(options.cookieHeader);
    const payload = options.body !== undefined ? JSON.stringify(options.body) : undefined;

    const res = await executeNodeHttpRequest(`${this.baseUrl}${endpoint}`, {
      method: options.method,
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
      },
      body: payload,
      rejectUnauthorized: this.config.B1_REJECT_UNAUTHORIZED_TLS,
    });

    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new Error(
        `Service Layer ${options.method} ${endpoint} failed (${res.statusCode}): ${res.bodyText}`
      );
    }

    if (res.statusCode === 204 || !res.bodyText.trim()) {
      return undefined as T;
    }
    return JSON.parse(res.bodyText) as T;
  }

  async testConnection(cookieHeader?: string): Promise<{
    ok: boolean;
    latencyMs: number;
    authenticatedUser: string;
    companyDb: string;
  }> {
    const start = Date.now();
    this.cachedTechCookie = null; // Force fresh verification
    const user = await this.resolveSessionUser(cookieHeader);
    return {
      ok: true,
      latencyMs: Date.now() - start,
      authenticatedUser: user,
      companyDb: this.config.B1_COMPANY_DB,
    };
  }

  async resolveSessionUser(cookieHeader?: string, userHeader?: string): Promise<string> {
    if (cookieHeader && cookieHeader.includes('B1SESSION=')) {
      const userObj = await this.slRequest<{ UserCode?: string }>(
        '/UsersService_GetCurrentUser',
        { method: 'POST', body: {}, cookieHeader }
      );
      return userObj?.UserCode ?? userHeader ?? 'b1-webclient-user';
    }
    await this.getAuthCookie(cookieHeader);
    return userHeader || this.config.B1_TECH_USER || 'b1-tech-user';
  }

  private async resolveBankJournalLineId(
    transId: number,
    glAccountCode: string,
    cookieHeader?: string
  ): Promise<number> {
    const je = await this.slRequest<{
      JournalEntryLines?: Array<{ Line_ID: number; AccountCode: string }>;
    }>(`/JournalEntries(${transId})`, { method: 'GET', cookieHeader });

    const matchedLine = je.JournalEntryLines?.find((l) => l.AccountCode === glAccountCode);
    return matchedLine?.Line_ID ?? 0;
  }

  async createIncomingPayment(
    input: CreatePaymentInput,
    cookieHeader?: string
  ): Promise<{ docEntry: number; transId: number; transLineId: number }> {
    const created = await this.slRequest<{ DocEntry: number; TransNum?: number }>(
      '/IncomingPayments',
      {
        method: 'POST',
        cookieHeader,
        body: {
          DocType: 'rCustomer',
          CardCode: input.cardCode,
          DocDate: input.docDate,
          TransferAccount: input.transferAccount,
          TransferSum: input.transferSum,
          TransferDate: input.transferDate,
          TransferReference: input.transferReference.slice(0, 27),
          Remarks: input.remarks.slice(0, 250),
          PaymentInvoices: input.invoices.map((inv, idx) => ({
            LineNum: idx,
            DocEntry: inv.docEntry,
            SumApplied: Math.abs(inv.sumApplied),
            InvoiceType: inv.invoiceType,
          })),
        },
      }
    );

    const transId = Number(created.TransNum);
    const transLineId = await this.resolveBankJournalLineId(
      transId,
      input.transferAccount,
      cookieHeader
    );
    return { docEntry: Number(created.DocEntry), transId, transLineId };
  }

  async createVendorPayment(
    input: CreatePaymentInput,
    cookieHeader?: string
  ): Promise<{ docEntry: number; transId: number; transLineId: number }> {
    const created = await this.slRequest<{ DocEntry: number; TransNum?: number }>(
      '/VendorPayments',
      {
        method: 'POST',
        cookieHeader,
        body: {
          DocType: 'rSupplier',
          CardCode: input.cardCode,
          DocDate: input.docDate,
          TransferAccount: input.transferAccount,
          TransferSum: input.transferSum,
          TransferDate: input.transferDate,
          TransferReference: input.transferReference.slice(0, 27),
          Remarks: input.remarks.slice(0, 250),
          PaymentInvoices: input.invoices.map((inv, idx) => ({
            LineNum: idx,
            DocEntry: inv.docEntry,
            SumApplied: Math.abs(inv.sumApplied),
            InvoiceType: inv.invoiceType,
          })),
        },
      }
    );

    const transId = Number(created.TransNum);
    const transLineId = await this.resolveBankJournalLineId(
      transId,
      input.transferAccount,
      cookieHeader
    );
    return { docEntry: Number(created.DocEntry), transId, transLineId };
  }

  async createDirectGlAccountPayment(
    input: CreateDirectGlPaymentInput,
    cookieHeader?: string
  ): Promise<{ docEntry: number; transId: number; transLineId: number }> {
    const endpoint = input.direction === 'CREDIT' ? '/IncomingPayments' : '/VendorPayments';
    const created = await this.slRequest<{ DocEntry: number; TransNum?: number }>(endpoint, {
      method: 'POST',
      cookieHeader,
      body: {
        DocType: 'rAccount',
        DocDate: input.docDate,
        TransferAccount: input.transferAccount,
        TransferSum: input.transferSum,
        TransferDate: input.transferDate,
        TransferReference: input.transferReference.slice(0, 27),
        Remarks: input.remarks.slice(0, 250),
        PaymentAccounts: [
          {
            LineNum: 0,
            AccountCode: input.expenseOrRevenueGlAccount,
            SumPaid: input.transferSum,
            Decription: input.remarks.slice(0, 250),
          },
        ],
      },
    });

    const transId = Number(created.TransNum);
    const transLineId = await this.resolveBankJournalLineId(
      transId,
      input.transferAccount,
      cookieHeader
    );
    return { docEntry: Number(created.DocEntry), transId, transLineId };
  }

  async createBankPage(
    input: CreateBankPageInput,
    cookieHeader?: string
  ): Promise<{ sequence: number }> {
    const created = await this.slRequest<{ Sequence: number }>('/BankPages', {
      method: 'POST',
      cookieHeader,
      body: {
        AccountCode: input.accountCode,
        DueDate: input.dueDate,
        DebitAmount: input.debitAmount,
        CreditAmount: input.creditAmount,
        DocNumberType: 'bpdt_DocNum',
        PaymentReference: input.paymentReference.slice(0, 27),
        Details: input.details.slice(0, 250),
      },
    });
    return { sequence: Number(created.Sequence) };
  }

  async reconcileExternalBankStatement(
    input: ExternalReconcileInput,
    cookieHeader?: string
  ): Promise<void> {
    await this.slRequest<void>('/ExternalReconciliationsService_Reconcile', {
      method: 'POST',
      cookieHeader,
      body: {
        ExternalReconciliation: {
          ReconciliationAccountType: 'rat_GLAccount',
          ReconciliationBankStatementLines: [
            {
              BankStatementAccountCode: input.glAccountCode,
              Sequence: input.bankPageSequence,
            },
          ],
          ReconciliationJournalEntryLines: [
            {
              TransactionNumber: input.journalTransId,
              LineNumber: input.journalLineId,
            },
          ],
        },
      },
    });
  }
}

/**
 * Mock Service Layer Client for offline testing and realistic local development.
 */
export class MockServiceLayerClient implements IB1ServiceLayerClient {
  private nextBankPageSeq = 501;

  constructor(private readonly mockHana: MockHanaReadRepository) {}

  async testConnection(): Promise<{
    ok: boolean;
    latencyMs: number;
    authenticatedUser: string;
    companyDb: string;
  }> {
    return {
      ok: true,
      latencyMs: 1,
      authenticatedUser: 'manager (Mock B1)',
      companyDb: 'SBO_MOCK_PT',
    };
  }

  async resolveSessionUser(_cookieHeader?: string, userHeader?: string): Promise<string> {
    return userHeader?.trim() || 'manager (Mock B1)';
  }

  async createIncomingPayment(
    input: CreatePaymentInput
  ): Promise<{ docEntry: number; transId: number; transLineId: number }> {
    return this.mockHana.recordMockPayment({
      direction: 'INCOMING',
      cardCode: input.cardCode,
      glAccountCode: input.transferAccount,
      date: input.transferDate,
      transferSum: input.transferSum,
      allocations: input.invoices.map((i) => ({
        docEntry: i.docEntry,
        allocatedAmount: i.sumApplied,
      })),
    });
  }

  async createVendorPayment(
    input: CreatePaymentInput
  ): Promise<{ docEntry: number; transId: number; transLineId: number }> {
    return this.mockHana.recordMockPayment({
      direction: 'OUTGOING',
      cardCode: input.cardCode,
      glAccountCode: input.transferAccount,
      date: input.transferDate,
      transferSum: input.transferSum,
      allocations: input.invoices.map((i) => ({
        docEntry: i.docEntry,
        allocatedAmount: i.sumApplied,
      })),
    });
  }

  async createDirectGlAccountPayment(
    input: CreateDirectGlPaymentInput
  ): Promise<{ docEntry: number; transId: number; transLineId: number }> {
    return this.mockHana.recordMockPayment({
      direction: input.direction === 'CREDIT' ? 'INCOMING' : 'OUTGOING',
      cardCode: input.expenseOrRevenueGlAccount,
      glAccountCode: input.transferAccount,
      date: input.transferDate,
      transferSum: input.transferSum,
      allocations: [],
    });
  }

  async createBankPage(_input: CreateBankPageInput): Promise<{ sequence: number }> {
    return { sequence: this.nextBankPageSeq++ };
  }

  async reconcileExternalBankStatement(input: ExternalReconcileInput): Promise<void> {
    this.mockHana.markMockJournalLineReconciled(input.journalTransId, input.journalLineId);
  }
}
