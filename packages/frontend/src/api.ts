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

const STORAGE_KEY_API_BASE = 'B1_RECON_API_BASE_URL';

export function getApiBaseUrl(): string {
  const urlParam = new URLSearchParams(window.location.search).get('apiUrl');
  if (urlParam) {
    const clean = urlParam.replace(/\/+$/, '');
    localStorage.setItem(STORAGE_KEY_API_BASE, clean);
    return clean;
  }
  const saved = localStorage.getItem(STORAGE_KEY_API_BASE);
  if (saved) return saved.replace(/\/+$/, '');

  const envUrl = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_API_BASE_URL;
  if (envUrl) return envUrl.replace(/\/+$/, '');

  // When running as a static single-page-app inside SAP B1 Web Client (/extn/ui-static/...),
  // default to the local/same-host backend on port 4010 until configured in Connection Settings.
  if (typeof window !== 'undefined' && window.location.pathname.includes('/extn/ui-static/')) {
    return `${window.location.protocol === 'https:' ? 'http:' : window.location.protocol}//${window.location.hostname}:4010`;
  }
  return '';
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
    return requestJson('/api/settings/connection');
  },

  saveConnectionSettings(settings: ConnectionSettingsDto): Promise<{ ok: boolean; mode: 'mock' | 'live' }> {
    return requestJson('/api/settings/connection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });
  },

  testConnection(): Promise<ConnectionTestResultDto> {
    return requestJson('/api/settings/test-connection', {
      method: 'POST',
    });
  },

  getDashboard(houseBankId?: string): Promise<{
    houseBanks: HouseBankAccount[];
    summary: DashboardSummary;
  }> {
    const qs = houseBankId && houseBankId !== 'ALL' ? `?houseBankId=${encodeURIComponent(houseBankId)}` : '';
    return requestJson(`/api/dashboard${qs}`);
  },

  getLines(params: {
    houseBankId?: string;
    statusGroup?: 'PENDING' | 'RECONCILED' | 'IGNORED' | 'ALL';
    search?: string;
  }): Promise<{ lines: StagedBankLine[] }> {
    const sp = new URLSearchParams();
    if (params.houseBankId && params.houseBankId !== 'ALL') sp.set('houseBankId', params.houseBankId);
    if (params.statusGroup) sp.set('statusGroup', params.statusGroup);
    if (params.search?.trim()) sp.set('search', params.search.trim());
    return requestJson(`/api/lines?${sp.toString()}`);
  },

  getManualCandidates(
    direction: 'CREDIT' | 'DEBIT',
    glAccountCode: string
  ): Promise<{ openDocuments: B1OpenDocument[]; journalLines: B1UnreconciledJournalLine[] }> {
    const sp = new URLSearchParams({ direction, glAccountCode });
    return requestJson(`/api/b1/candidates?${sp.toString()}`);
  },

  getGlRules(): Promise<{ rules: GlMatchingRule[] }> {
    return requestJson('/api/gl-rules');
  },

  saveGlRule(rule: Omit<GlMatchingRule, 'id'> & { id?: string }): Promise<{ rule: GlMatchingRule }> {
    return requestJson('/api/gl-rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rule),
    });
  },

  deleteGlRule(id: string): Promise<{ ok: boolean }> {
    return requestJson(`/api/gl-rules/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  },

  previewStatement(file: File): Promise<StatementPreviewResponse> {
    const form = new FormData();
    form.append('file', file);
    return requestJson('/api/statements/preview', { method: 'POST', body: form });
  },

  importStatement(file: File, houseBankId?: string): Promise<StatementImportResponse> {
    const form = new FormData();
    if (houseBankId) form.append('houseBankId', houseBankId);
    form.append('file', file);
    return requestJson('/api/statements/import', { method: 'POST', body: form });
  },

  importSampleStatements(): Promise<{ importedLinesCount: number; skippedDuplicateCount: number }> {
    return requestJson('/api/statements/import-samples', { method: 'POST' });
  },

  approveReconciliation(payload: ApproveReconciliationRequest): Promise<{ line: StagedBankLine }> {
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
    return requestJson(`/api/reconciliations/${encodeURIComponent(bankLineId)}/ignore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
  },

  reopenLine(bankLineId: string): Promise<{ line: StagedBankLine }> {
    return requestJson(`/api/reconciliations/${encodeURIComponent(bankLineId)}/reopen`, {
      method: 'POST',
    });
  },

  getAuditLogs(): Promise<{ logs: AuditLogRecord[] }> {
    return requestJson('/api/audit-logs');
  },
};

export function formatEur(amount: number): string {
  return new Intl.NumberFormat('pt-PT', {
    style: 'currency',
    currency: 'EUR',
  }).format(amount);
}
