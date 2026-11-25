import type {
  AuditLogRecord,
  AutomationSettings,
  ConversionRecord,
  ConvertDeliveriesRequest,
  ConvertDeliveriesResponse,
  CustomerEmailOption,
  DashboardSummary,
  OpenDeliveryNote,
  SentEmailPreview,
} from '@b1-d2i/shared';
import {
  dismissLocalSettingsImport,
  getLocalSettingsImportPatch,
  hasLocalSettingsToImport,
  webClientB1sAdapter,
} from './webClientB1sAdapter';

const STORAGE_KEY_API_BASE = 'B1_D2I_API_BASE_URL';

/**
 * Base URL of the Node.js backend. Inside the SAP B1 Web Client the SPA is served from
 * /extn/ui-static/..., so relative '/api/...' calls hit the B1 server (HTTP 500) instead of the backend.
 * Resolution order: ?apiUrl=... (persisted) -> localStorage -> VITE_API_BASE_URL -> same origin.
 */
export function getApiBaseUrl(): string {
  const urlParam = new URLSearchParams(window.location.search).get('apiUrl');
  if (urlParam !== null) {
    const clean = urlParam.trim().replace(/\/+$/, '');
    if (clean) localStorage.setItem(STORAGE_KEY_API_BASE, clean);
    else localStorage.removeItem(STORAGE_KEY_API_BASE);
    return clean;
  }
  const saved = localStorage.getItem(STORAGE_KEY_API_BASE);
  if (saved) return saved.replace(/\/+$/, '');
  const envUrl = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_API_BASE_URL;
  return envUrl ? envUrl.replace(/\/+$/, '') : '';
}

export function setApiBaseUrl(baseUrl: string): void {
  const clean = baseUrl.trim().replace(/\/+$/, '');
  if (clean) localStorage.setItem(STORAGE_KEY_API_BASE, clean);
  else localStorage.removeItem(STORAGE_KEY_API_BASE);
}

/**
 * True when the SPA runs inside the SAP B1 Web Client (/extn/ui-static/...) with no backend URL configured.
 * All operations then go straight to the same-origin Service Layer (/b1s/v1), which complies with the
 * Web Client's CSP (connect-src 'self') and reuses the user's B1SESSION.
 */
export function isUsingNativeWebClientB1s(): boolean {
  if (getApiBaseUrl()) return false;
  return window.location.pathname.includes('/extn/ui-static/');
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${getApiBaseUrl()}${url}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!res.ok) {
    const text = await res.text();
    let message = text || `HTTP ${res.status}`;
    try {
      const parsed = JSON.parse(text) as { error?: string };
      if (parsed.error) message = parsed.error;
    } catch {
      // Keep raw text
    }
    throw new Error(message);
  }

  return (await res.json()) as T;
}

const remoteApi = {
  getDashboard(): Promise<DashboardSummary> {
    return requestJson('/api/dashboard');
  },
  listDeliveries(): Promise<{ deliveries: OpenDeliveryNote[] }> {
    return requestJson('/api/deliveries');
  },
  getCustomerEmails(cardCode: string): Promise<{ cardCode: string; emails: CustomerEmailOption[] }> {
    return requestJson(`/api/customers/${encodeURIComponent(cardCode)}/emails`);
  },
  convertDeliveries(payload: ConvertDeliveriesRequest): Promise<ConvertDeliveriesResponse> {
    return requestJson('/api/deliveries/convert', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  runScheduledNow(): Promise<ConvertDeliveriesResponse> {
    return requestJson('/api/scheduler/run-now', { method: 'POST' });
  },
  listConversions(): Promise<{ conversions: ConversionRecord[] }> {
    return requestJson('/api/conversions');
  },
  retryEmail(
    conversionId: string,
    recipientEmail?: string,
    recipientName?: string
  ): Promise<{ conversion: ConversionRecord }> {
    const payload: Record<string, string> = {};
    if (recipientEmail) payload.recipientEmail = recipientEmail;
    if (recipientName !== undefined) payload.recipientName = recipientName;
    return requestJson(`/api/conversions/${encodeURIComponent(conversionId)}/retry-email`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  listEmails(): Promise<{ emails: SentEmailPreview[] }> {
    return requestJson('/api/emails');
  },
  getSettings(): Promise<{ settings: AutomationSettings }> {
    return requestJson('/api/settings');
  },
  updateSettings(
    patch: Partial<AutomationSettings> & { smtpPassword?: string }
  ): Promise<{ settings: AutomationSettings }> {
    return requestJson('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(patch),
    });
  },
  testConnections(): Promise<{
    b1: { ok: boolean; latencyMs: number; companyDb: string; message: string };
    smtp: { ok: boolean; message: string };
    gateway: { ok: boolean; latencyMs: number; message: string };
  }> {
    return requestJson('/api/settings/test-connections', { method: 'POST' });
  },
  listAuditLogs(): Promise<{ logs: AuditLogRecord[] }> {
    return requestJson('/api/audit-logs');
  },
};

export const api: typeof remoteApi = new Proxy(remoteApi, {
  get(target, prop: string) {
    const source = (isUsingNativeWebClientB1s() ? webClientB1sAdapter : target) as Record<string, unknown>;
    return source[prop];
  },
});

export function canImportLocalSettings(): boolean {
  return !isUsingNativeWebClientB1s() && hasLocalSettingsToImport();
}

export async function importLocalSettingsToBackend(): Promise<void> {
  await remoteApi.updateSettings(getLocalSettingsImportPatch());
  dismissLocalSettingsImport();
}

export { dismissLocalSettingsImport };

export function formatMoney(value: number, currency = 'EUR'): string {
  return new Intl.NumberFormat('pt-PT', {
    style: 'currency',
    currency: currency || 'EUR',
  }).format(value);
}
