import { AsyncLocalStorage } from 'node:async_hooks';
import type { AppConfig } from '../config/env.js';

/**
 * Multi-company support: every API request (and every scheduled run) executes inside a company
 * context. The company is never taken from configuration: for requests it is derived from the
 * caller's own SAP B1 session (see resolveCompanyFromSession in app.ts), for the scheduler it is the
 * company whose settings enabled it. The DB layer and the SAP clients read it from here.
 */
const store = new AsyncLocalStorage<{ companyDb: string }>();

export function runInCompany<T>(companyDb: string, fn: () => T): T {
  return store.run({ companyDb }, fn);
}

export function enterCompany(companyDb: string, done: () => void): void {
  store.run({ companyDb }, done);
}

export function currentCompany(): string {
  const ctx = store.getStore();
  if (!ctx?.companyDb) {
    throw new Error('Operação sem empresa SAP B1 definida (contexto de empresa em falta).');
  }
  return ctx.companyDb;
}

export function tryCurrentCompany(): string | null {
  return store.getStore()?.companyDb ?? null;
}

/**
 * B1_COMPANIES maps the CompanyName reported by the user's session to the CompanyDB schema name that the
 * API Gateway login needs, e.g. {"BIOKIMICA LDA":"SBO_BIOKIMICA","TESTES BIOKIMICA":"TESTES_BIOKIMICA"}.
 */
export function companyDbForName(config: AppConfig, companyName: string): string | null {
  let map: Record<string, string> = {};
  try {
    map = JSON.parse(config.B1_COMPANIES || '{}') as Record<string, string>;
  } catch {
    throw new Error('B1_COMPANIES inválido: tem de ser um objeto JSON {"Nome da empresa":"CompanyDB"}.');
  }
  const wanted = companyName.trim().toLowerCase();
  for (const [name, db] of Object.entries(map)) {
    if (name.trim().toLowerCase() === wanted && typeof db === 'string' && db.trim()) return db.trim();
  }
  return null;
}
