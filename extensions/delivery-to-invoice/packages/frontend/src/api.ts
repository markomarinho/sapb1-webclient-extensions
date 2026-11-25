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

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
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

export const api = {
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

export function formatMoney(value: number, currency = 'EUR'): string {
  return new Intl.NumberFormat('pt-PT', {
    style: 'currency',
    currency: currency || 'EUR',
  }).format(value);
}
