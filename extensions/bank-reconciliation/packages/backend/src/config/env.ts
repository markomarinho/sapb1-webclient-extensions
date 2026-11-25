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

const EnvSchema = z.object({
  PORT: z.coerce.number().default(4010),
  HOST: z.string().default('127.0.0.1'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  B1_MODE: z.enum(['mock', 'live']).default('mock'),
  VAULT_MASTER_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/)
    .default('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'),
  SQLITE_DB_PATH: z.string().default(path.resolve(process.cwd(), 'data/reconciliation.sqlite')),

  // Direct Read-Only SAP HANA
  HANA_HOST: z.string().default('localhost'),
  HANA_PORT: z.coerce.number().default(30015),
  HANA_SCHEMA: z.string().default('SBO_COMPANY_PT'),
  HANA_READONLY_USER: z.string().default('B1_RECON_RO'),
  HANA_READONLY_PASSWORD: z.string().default(''),
  HANA_ENCRYPT: z
    .string()
    .transform((v) => v !== 'false')
    .default('true'),
  HANA_SSL_VALIDATE_CERT: z
    .string()
    .transform((v) => v !== 'false')
    .default('true'),
  HANA_UDF_MB_ENTITY: z.string().optional(),
  HANA_UDF_MB_REF: z.string().optional(),

  // SAP Business One Service Layer (Auth & Writes)
  B1_SERVICE_LAYER_URL: z.string().default('https://localhost:50000/b1s/v1'),
  B1_COMPANY_DB: z.string().default('SBO_COMPANY_PT'),
  B1_REJECT_UNAUTHORIZED_TLS: z
    .string()
    .transform((v) => v !== 'false')
    .default('true'),
  B1_TECH_USER: z.string().optional(),
  B1_TECH_PASSWORD: z.string().optional(),
});

export type AppConfig = z.infer<typeof EnvSchema>;

export function loadConfig(rawEnv: NodeJS.ProcessEnv = process.env): AppConfig {
  if (rawEnv === process.env) {
    ensureDotenvLoaded();
  }
  return EnvSchema.parse(rawEnv);
}
