import { currentCompany } from '../company/context.js';
import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import type { AutomationSettings } from '@b1-d2i/shared';
import type { AppConfig } from '../config/env.js';

export interface ExportCrystalPdfInput {
  docEntry: number;
  objectId?: number; // 13 = A/R Invoice (OINV)
  docCode?: string;
}

export interface IGatewayCrystalPdfClient {
  exportInvoicePdf(
    input: ExportCrystalPdfInput,
    settings: AutomationSettings
  ): Promise<Buffer>;
  testConnection(settings: AutomationSettings): Promise<{
    ok: boolean;
    latencyMs: number;
    message: string;
  }>;
}

interface RawHttpResponse {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  bodyBuffer: Buffer;
}

function sendHttpRequest(
  fullUrl: string,
  opts: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    rejectUnauthorized: boolean;
    timeoutMs?: number;
  }
): Promise<RawHttpResponse> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(fullUrl);
    const isHttps = parsed.protocol === 'https:';
    const transport = isHttps ? https : http;

    const req = transport.request(
      parsed,
      {
        method: opts.method,
        headers: opts.headers,
        rejectUnauthorized: isHttps ? opts.rejectUnauthorized : undefined,
        timeout: opts.timeoutMs ?? 30_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode ?? 500,
            headers: res.headers,
            bodyBuffer: Buffer.concat(chunks),
          });
        });
      }
    );

    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('SAP B1 API Gateway request timed out')));
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

/**
 * Exports Crystal Reports layouts to PDF via the SAP Business One API Gateway
 * Reporting Service (`POST /login` -> `POST /rs/v1/ExportPDFData?DocCode=<DocCode>`).
 */
export class GatewayCrystalPdfClient implements IGatewayCrystalPdfClient {
  /** Gateway sessions per company + gateway URL. */
  private cachedCookies = new Map<string, { cookie: string; expiresAt: number }>();

  constructor(private readonly config: AppConfig) {}

  private resolveGatewayUrl(settings: AutomationSettings): string {
    const raw = (settings.gatewayUrl || this.config.B1_GATEWAY_URL || '').trim();
    if (!raw) {
      throw new Error(
        'URL do SAP B1 API Gateway não configurado (defina B1_GATEWAY_URL ou nas Definições).'
      );
    }
    return raw.replace(/\/+$/, '');
  }

  private async login(baseUrl: string, forceRefresh = false): Promise<string> {
    const company = currentCompany();
    const cacheKey = `${company}@${baseUrl}`;
    const cached = this.cachedCookies.get(cacheKey);
    if (!forceRefresh && cached && Date.now() < cached.expiresAt) {
      return cached.cookie;
    }

    if (!this.config.B1_TECH_USER || !this.config.B1_TECH_PASSWORD) {
      throw new Error(
        'Credenciais técnicas (B1_TECH_USER / B1_TECH_PASSWORD) são obrigatórias para autenticar no SAP B1 API Gateway.'
      );
    }

    const payload: Record<string, string> = {
      CompanyDB: company,
      UserName: this.config.B1_TECH_USER,
      Password: this.config.B1_TECH_PASSWORD,
    };
    if (this.config.B1_GATEWAY_DB_INSTANCE) {
      payload.DBInstance = this.config.B1_GATEWAY_DB_INSTANCE;
    }

    const res = await sendHttpRequest(`${baseUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      rejectUnauthorized: this.config.B1_REJECT_UNAUTHORIZED_TLS,
    });

    if (res.statusCode < 200 || res.statusCode >= 300) {
      const text = res.bodyBuffer.toString('utf8');
      throw new Error(`Falha no login do API Gateway (${res.statusCode}): ${text}`);
    }

    const setCookies = res.headers['set-cookie'] ?? [];
    const cookieHeader = setCookies.map((c) => c.split(';')[0]).join('; ');
    if (!cookieHeader) {
      // The Gateway answers HTTP 200 with a JSON error body (e.g. {"code":-1,"message":{...}}) on failed logins.
      const detail = res.bodyBuffer.toString('utf8').trim().slice(0, 300);
      throw new Error(
        `API Gateway não devolveu cookie de sessão (SESSION) no /login.${detail ? ` Resposta: ${detail}` : ''}`
      );
    }

    this.cachedCookies.set(cacheKey, { cookie: cookieHeader, expiresAt: Date.now() + 15 * 60_000 });
    return cookieHeader;
  }

  public async exportInvoicePdf(
    input: ExportCrystalPdfInput,
    settings: AutomationSettings
  ): Promise<Buffer> {
    const baseUrl = this.resolveGatewayUrl(settings);
    const docCode = (input.docCode || settings.invoiceDocCode || this.config.B1_INVOICE_DOC_CODE || 'INV20004').trim();
    const objectId = input.objectId ?? 13; // 13 = OINV (A/R Invoice)

    const body = JSON.stringify([
      {
        name: 'DocKey@',
        type: 'xsd:decimal',
        value: [[input.docEntry]],
      },
      {
        name: 'ObjectId@',
        type: 'xsd:decimal',
        value: [[objectId]],
      },
    ]);

    let cookie = await this.login(baseUrl, false);
    const exportUrl = `${baseUrl}/rs/v1/ExportPDFData?DocCode=${encodeURIComponent(docCode)}`;

    let res = await sendHttpRequest(exportUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
      },
      body,
      rejectUnauthorized: this.config.B1_REJECT_UNAUTHORIZED_TLS,
    });

    // Retry once with a fresh session if the Gateway session expired
    if (res.statusCode === 401 || res.statusCode === 403) {
      cookie = await this.login(baseUrl, true);
      res = await sendHttpRequest(exportUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
        },
        body,
        rejectUnauthorized: this.config.B1_REJECT_UNAUTHORIZED_TLS,
      });
    }

    if (res.statusCode < 200 || res.statusCode >= 300) {
      const text = res.bodyBuffer.toString('utf8');
      throw new Error(
        `API Gateway ExportPDFData (DocCode=${docCode}) falhou (${res.statusCode}): ${text}`
      );
    }

    return decodeGatewayPdfPayload(res.bodyBuffer);
  }

  public async testConnection(settings: AutomationSettings): Promise<{
    ok: boolean;
    latencyMs: number;
    message: string;
  }> {
    const start = Date.now();
    if (settings.pdfSource !== 'gateway') {
      return {
        ok: true,
        latencyMs: 0,
        message: 'Fonte PDF configurada como Built-in (API Gateway desativado).',
      };
    }

    try {
      const baseUrl = this.resolveGatewayUrl(settings);
      await this.login(baseUrl, true);
      return {
        ok: true,
        latencyMs: Date.now() - start,
        message: `Autenticação no SAP B1 API Gateway bem-sucedida (DocCode: ${settings.invoiceDocCode}).`,
      };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        message: err instanceof Error ? err.message : 'Erro ao contactar SAP B1 API Gateway.',
      };
    }
  }
}

/**
 * Decodes SAP B1 API Gateway ExportPDFData responses:
 * - Raw PDF bytes (`%PDF-...`)
 * - Plain Base64 string (`JVBERi0...`)
 * - JSON-quoted Base64 string (`"JVBERi0..."`)
 */
export function decodeGatewayPdfPayload(raw: Buffer): Buffer {
  if (raw.subarray(0, 5).toString('ascii') === '%PDF-') {
    return raw;
  }

  let text = raw.toString('utf8').trim();
  if (text.startsWith('"') && text.endsWith('"')) {
    try {
      text = JSON.parse(text) as string;
    } catch {
      text = text.slice(1, -1);
    }
  }

  const decoded = Buffer.from(text, 'base64');
  if (decoded.subarray(0, 5).toString('ascii') !== '%PDF-') {
    const detail = raw.subarray(0, 300).toString('utf8').replace(/\s+/g, ' ').trim();
    throw new Error(
      `Resposta do API Gateway ExportPDFData não contém um PDF válido.${detail ? ` Resposta: ${detail}` : ''}`
    );
  }
  return decoded;
}
