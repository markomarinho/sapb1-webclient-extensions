import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

let dotenvLoaded = false;
function ensureDotenvLoaded(): void {
  if (dotenvLoaded) return;
  dotenvLoaded = true;
  const candidates = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '../../.env'),
  ];
  const envFile = candidates.find((p) => fs.existsSync(p));
  if (envFile && typeof process.loadEnvFile === 'function') {
    try {
      process.loadEnvFile(envFile);
    } catch {
      // Ignore if already loaded
    }
  }
}

const boolFromEnv = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : v.toLowerCase() === 'true' || v === '1'));

const EnvSchema = z.object({
  PORT: z.coerce.number().default(4020),
  HOST: z.string().default('127.0.0.1'),
  CORS_ORIGIN: z.string().default('http://localhost:5174'),
  B1_MODE: z.enum(['mock', 'live']).default('mock'),
  EMAIL_MODE: z.enum(['mock', 'smtp']).default('mock'),
  SQLITE_DB_PATH: z.string().default('./data/delivery-to-invoice.sqlite'),

  // SAP B1 Service Layer
  B1_SERVICE_LAYER_URL: z.string().default('https://b1.internal.example.local:50000/b1s/v1'),
  // Legacy/default company: only used to (a) tag rows created before multi-company support and (b) as the
  // single company in mock mode. In live mode the company always comes from the user's session.
  // The Web Client's own gateway (gate.jar). Browsers only hold its `SESSION` cookie (the Service Layer
  // B1SESSION stays server-side), so calls made on behalf of a logged-in user go through
  // <B1_WEBCLIENT_URL>/b1s/v1 with that cookie, exactly like the Web Client UI does. Example: https://192.168.1.30:8443
  B1_WEBCLIENT_URL: z.string().default(''),
  B1_COMPANY_DB: z.string().default('SBO_COMPANY_PT'),
  // Company that owns data created before multi-company support (defaults to B1_COMPANY_DB).
  B1_LEGACY_COMPANY_DB: z.string().default(''),
  // JSON map {"<CompanyName from session>":"<CompanyDB>"}; sessions of unmapped companies are rejected.
  B1_COMPANIES: z.string().default('{}'),
  B1_REJECT_UNAUTHORIZED_TLS: boolFromEnv.default(true),
  B1_TECH_USER: z.string().default(''),
  B1_TECH_PASSWORD: z.string().default(''),
  B1_BP_AUTO_INVOICE_UDF: z.string().default('U_AutoInvoice'),
  B1_BP_INVOICE_EMAIL_UDF: z.string().default(''),
  B1_DEFAULT_EML_GRP_CODE: z.string().default(''),

  // SAP B1 API Gateway (Crystal Reports PDF Export: POST /rs/v1/ExportPDFData)
  PDF_SOURCE: z.enum(['builtin', 'gateway']).default('builtin'),
  B1_GATEWAY_URL: z.string().default(''),
  B1_GATEWAY_DB_INSTANCE: z.string().default(''),
  B1_INVOICE_DOC_CODE: z.string().default('INV20004'),
  B1_GATEWAY_FALLBACK_BUILTIN: boolFromEnv.default(false),

  // Company details for generated PDF header (used when PDF_SOURCE=builtin or fallback)
  COMPANY_NAME: z.string().default('Empresa Lusitana, S.A.'),
  COMPANY_NIF: z.string().default('PT501234567'),
  COMPANY_ADDRESS: z.string().default('Av. da Liberdade 120, 1250-146 Lisboa'),

  // SMTP defaults (can be overridden from UI Settings)
  SMTP_HOST: z.string().default(''),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_SECURE: boolFromEnv.default(false),
  SMTP_USER: z.string().default(''),
  SMTP_PASSWORD: z.string().default(''),
  SMTP_FROM: z.string().default('faturacao@empresa.local'),
});

export type AppConfig = z.infer<typeof EnvSchema>;

export function loadConfig(overrides: Partial<Record<string, string | number | boolean>> = {}): AppConfig {
  ensureDotenvLoaded();
  return EnvSchema.parse({
    ...process.env,
    ...overrides,
  });
}
