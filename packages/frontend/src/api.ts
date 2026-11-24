import type {
  ApproveReconciliationRequest,
  AuditLogRecord,
  B1OpenDocument,
  B1UnreconciledJournalLine,
  DashboardSummary,
  GlMatchingRule,
  HouseBankAccount,
  StagedBankLine,
  StatementImportResponse,
  StatementPreviewResponse,
} from '@b1-recon/shared';
import { webClientB1sAdapter } from './webClientB1sAdapter';

const STORAGE_KEY_API_BASE = 'B1_RECON_API_BASE_URL';

/**
 * Detects whether the React SPA is running directly inside the SAP Business One Web Client
 * (/extn/ui-static/...) without an external backend URL override.
 * When true, all operations run natively in-browser against same-origin `/b1s/v1/...`,
 * avoiding any Content-Security-Policy (connect-src 'self') violations.
 */
export function isUsingNativeWebClientB1s(): boolean {
  const customBase = getApiBaseUrl();
  if (customBase) return false;
  return typeof window !== 'undefined' && window.location.pathname.includes('/extn/ui-static/');
}

export function getApiBaseUrl(): string {
  const urlParam = new URLSearchParams(window.location.search).get('apiUrl');
  if (urlParam) {
    const clean = urlParam.replace(/\/+$/, '');
    localStorage.setItem(STORAGE_KEY_API_BASE, clean);
    return clean;
  }
  const saved = localStorage.getItem(STORAGE_KEY_API_BASE);
  if (saved) {
    // Clear any stale non-HTTPS / bare-host URL that would violate SAP B1 Web Client CSP
    if (
      typeof window !== 'undefined' &&
      window.location.pathname.includes('/extn/ui-static/') &&
      saved.startsWith('http://')
    ) {
      localStorage.removeItem(STORAGE_KEY_API_BASE);
      return '';
    }
    return saved.replace(/\/+$/, '');
  }

  const envUrl = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_API_BASE_URL;
  return envUrl ? envUrl.replace(/\/+$/, '') : '';
}

export function setApiBaseUrl(baseUrl: string): void {
  const clean = baseUrl.trim().replace(/\/+$/, '');
  if (!clean) {
    localStorage.removeItem(STORAGE_KEY_API_BASE);
  } else {
    localStorage.setItem(STORAGE_KEY_API_BASE, clean);
  }
}

export interface ConnectionSettingsDto {
  mode: 'mock' | 'live';
  hanaHost: string;
  hanaPort: number;
  hanaSchema: string;
  hanaReadonlyUser: string;
  hanaReadonlyPassword?: string;
  hasHanaPassword?: boolean;
  hanaEncrypt: boolean;
  hanaSslValidateCert: boolean;
  b1ServiceLayerUrl: string;
  b1CompanyDb: string;
  b1TechUser: string;
  b1TechPassword?: string;
  hasB1TechPassword?: boolean;
  b1RejectUnauthorizedTls: boolean;
}

export interface ConnectionTestResultDto {
  mode: 'mock' | 'live';
  hana: {
    ok: boolean;
    latencyMs?: number;
    schema?: string;
    houseBanksCount?: number;
    openDocumentsCount?: number;
    error?: string;
  };
  serviceLayer: {
    ok: boolean;
    latencyMs?: number;
    authenticatedUser?: string;
    companyDb?: string;
    error?: string;
  };
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const base = getApiBaseUrl();
  const res = await fetch(`${base}${url}`, {
    credentials: 'include',
    ...init,
  });
  if (!res.ok) {
    let errMsg = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) errMsg = body.error;
    } catch {
      // fallback to status
    }
    throw new Error(errMsg);
  }
  return (await res.json()) as T;
}

export const api = {
  getConnectionSettings(): Promise<ConnectionSettingsDto> {
    if (isUsingNativeWebClientB1s()) return webClientB1sAdapter.getConnectionSettings();
    return requestJson('/api/settings/connection');
  },

  saveConnectionSettings(settings: ConnectionSettingsDto): Promise<{ ok: boolean; mode: 'mock' | 'live' }> {
    if (isUsingNativeWebClientB1s()) return Promise.resolve({ ok: true, mode: 'live' });
    return requestJson('/api/settings/connection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });
  },

  testConnection(): Promise<ConnectionTestResultDto> {
    if (isUsingNativeWebClientB1s()) return webClientB1sAdapter.testConnection();
    return requestJson('/api/settings/test-connection', {
      method: 'POST',
    });
  },

  getDashboard(houseBankId?: string): Promise<{
    houseBanks: HouseBankAccount[];
    summary: DashboardSummary;
  }> {
    if (isUsingNativeWebClientB1s()) return webClientB1sAdapter.getDashboard(houseBankId);
    const qs = houseBankId && houseBankId !== 'ALL' ? `?houseBankId=${encodeURIComponent(houseBankId)}` : '';
    return requestJson(`/api/dashboard${qs}`);
  },

  getLines(params: {
    houseBankId?: string;
    statusGroup?: 'PENDING' | 'RECONCILED' | 'IGNORED' | 'ALL';
    search?: string;
  }): Promise<{ lines: StagedBankLine[] }> {
    if (isUsingNativeWebClientB1s()) return webClientB1sAdapter.getLines(params);
    const sp = new URLSearchParams();
    if (params.houseBankId && params.houseBankId !== 'ALL') sp.set('houseBankId', params.houseBankId);
    if (params.statusGroup) sp.set('statusGroup', params.statusGroup);
    if (params.search?.trim()) sp.set('search', params.search.trim());
    return requestJson(`/api/lines?${sp.toString()}`);
  },

  getManualCandidates(
    direction: 'CREDIT' | 'DEBIT',
    glAccountCode: string,
    search?: string,
    forceRefresh = false
  ): Promise<{ openDocuments: B1OpenDocument[]; journalLines: B1UnreconciledJournalLine[] }> {
    if (isUsingNativeWebClientB1s()) {
      return webClientB1sAdapter.getManualCandidates(direction, glAccountCode, search, forceRefresh);
    }
    const sp = new URLSearchParams({ direction, glAccountCode });
    if (search?.trim()) sp.set('search', search.trim());
    return requestJson(`/api/b1/candidates?${sp.toString()}`);
  },

  getGlRules(): Promise<{ rules: GlMatchingRule[] }> {
    if (isUsingNativeWebClientB1s()) return webClientB1sAdapter.getGlRules();
    return requestJson('/api/gl-rules');
  },

  saveGlRule(rule: Omit<GlMatchingRule, 'id'> & { id?: string }): Promise<{ rule: GlMatchingRule }> {
    if (isUsingNativeWebClientB1s()) return webClientB1sAdapter.saveGlRule(rule);
    return requestJson('/api/gl-rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rule),
    });
  },

  deleteGlRule(id: string): Promise<{ ok: boolean }> {
    if (isUsingNativeWebClientB1s()) return webClientB1sAdapter.deleteGlRule(id);
    return requestJson(`/api/gl-rules/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  },

  previewStatement(file: File): Promise<StatementPreviewResponse> {
    if (isUsingNativeWebClientB1s()) return webClientB1sAdapter.previewStatement(file);
    const form = new FormData();
    form.append('file', file);
    return requestJson('/api/statements/preview', { method: 'POST', body: form });
  },

  importStatement(file: File, houseBankId?: string): Promise<StatementImportResponse> {
    if (isUsingNativeWebClientB1s()) return webClientB1sAdapter.importStatement(file, houseBankId);
    const form = new FormData();
    if (houseBankId) form.append('houseBankId', houseBankId);
    form.append('file', file);
    return requestJson('/api/statements/import', { method: 'POST', body: form });
  },

  importSampleStatements(): Promise<{ importedLinesCount: number; skippedDuplicateCount: number }> {
    if (isUsingNativeWebClientB1s()) return webClientB1sAdapter.importSampleStatements();
    return requestJson('/api/statements/import-samples', { method: 'POST' });
  },

  approveReconciliation(payload: ApproveReconciliationRequest): Promise<{ line: StagedBankLine }> {
    if (isUsingNativeWebClientB1s()) return webClientB1sAdapter.approveReconciliation(payload);
    return requestJson('/api/reconciliations/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  },

  batchApprove(
    minConfidence = 90,
    houseBankId?: string
  ): Promise<{ reconciledCount: number; errors: Array<{ bankLineId: string; error: string }> }> {
    if (isUsingNativeWebClientB1s()) return webClientB1sAdapter.batchApprove(minConfidence, houseBankId);
    return requestJson('/api/reconciliations/batch-approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        minConfidence,
        houseBankId: houseBankId && houseBankId !== 'ALL' ? houseBankId : undefined,
      }),
    });
  },

  ignoreLine(bankLineId: string, reason?: string): Promise<{ line: StagedBankLine }> {
    if (isUsingNativeWebClientB1s()) return webClientB1sAdapter.ignoreLine(bankLineId, reason);
    return requestJson(`/api/reconciliations/${encodeURIComponent(bankLineId)}/ignore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
  },

  reopenLine(bankLineId: string): Promise<{ line: StagedBankLine }> {
    if (isUsingNativeWebClientB1s()) return webClientB1sAdapter.reopenLine(bankLineId);
    return requestJson(`/api/reconciliations/${encodeURIComponent(bankLineId)}/reopen`, {
      method: 'POST',
    });
  },

  getAuditLogs(): Promise<{ logs: AuditLogRecord[] }> {
    if (isUsingNativeWebClientB1s()) return webClientB1sAdapter.getAuditLogs();
    return requestJson('/api/audit-logs');
  },
};

export function formatEur(amount: number): string {
  return new Intl.NumberFormat('pt-PT', {
    style: 'currency',
    currency: 'EUR',
  }).format(amount);
}
