import React, { useEffect, useState } from 'react';
import {
  renderEmailTemplate,
  type AutomationSettings,
  type GroupingMode,
  type PdfSourceMode,
} from '@b1-d2i/shared';
import {
  Bar,
  Button,
  CheckBox,
  Dialog,
  Input,
  Label,
  MessageStrip,
  Option,
  Select,
  Switch,
  TextArea,
} from '@ui5/webcomponents-react';
import { api, getApiBaseUrl, setApiBaseUrl } from '../api';
import { useI18n } from '../i18n';

interface SettingsDialogProps {
  open: boolean;
  initialSettings?: AutomationSettings | null;
  onClose: () => void;
  onSaved: () => void;
}

type SettingsTab = 'GENERAL' | 'EMAIL' | 'SMTP_PDF';

const DEFAULT_SETTINGS: AutomationSettings = {
  schedulerEnabled: false,
  intervalMinutes: 60,
  groupingMode: 'PER_DELIVERY',
  onlyAutoInvoiceCustomers: true,
  minDeliveryAgeDays: 0,
  sendEmailAutomatically: true,
  defaultEmlGrpCode: '',
  checkPriceMatchLastInvoice: true,
  checkMinimumMargin: true,
  minimumMarginPercent: 30,
  emailSubjectTemplate: 'Fatura {{InvoiceDocNum}} — {{CardName}}',
  emailBodyTemplate: '',
  emailBodyIsHtml: false,
  ccAddresses: '',
  replyToAddress: '',
  smtpHost: '',
  smtpPort: 587,
  smtpSecure: false,
  smtpUser: '',
  smtpFrom: '',
  pdfSource: 'builtin',
  gatewayUrl: '',
  invoiceDocCode: 'INV20004',
  gatewayFallbackToBuiltin: false,
};

export function SettingsDialog({
  open,
  initialSettings,
  onClose,
  onSaved,
}: SettingsDialogProps) {
  const { t } = useI18n();
  const [settings, setSettings] = useState<AutomationSettings>(
    initialSettings ?? DEFAULT_SETTINGS
  );
  const [activeTab, setActiveTab] = useState<SettingsTab>('GENERAL');
  const [smtpPassword, setSmtpPassword] = useState('');
  const [backendUrl, setBackendUrl] = useState(() => getApiBaseUrl());
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    b1: { ok: boolean; latencyMs: number; companyDb: string; message: string };
    smtp: { ok: boolean; message: string };
    gateway: { ok: boolean; latencyMs: number; message: string };
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialSettings) {
      setSettings(initialSettings);
    }
  }, [initialSettings]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setTestResult(null);
    setSmtpPassword('');
    setBackendUrl(getApiBaseUrl());
    api
      .getSettings()
      .then((res) => {
        setSettings(res.settings);
        requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : 'Erro ao carregar definições')
      );
  }, [open]);

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  }, [open, activeTab, testResult, error, settings.emailBodyIsHtml]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const newUrl = backendUrl.trim().replace(/\/+$/, '');
      if (newUrl !== getApiBaseUrl()) {
        // Mode (Web Client vs backend) is resolved at load time: persist and reload.
        setApiBaseUrl(newUrl);
        const url = new URL(window.location.href);
        url.searchParams.delete('apiUrl'); // the query param would override the saved value
        window.location.replace(url.toString());
        return;
      }
      await api.updateSettings({
        ...settings,
        ...(smtpPassword ? { smtpPassword } : {}),
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao guardar definições');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api.testConnections();
      setTestResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao testar ligações');
    } finally {
      setTesting(false);
    }
  };

  return (
    <Dialog
      open={open}
      headerText={t.settingsDialogTitle}
      onClose={onClose}
      footer={
        <Bar
          startContent={
            <Button design="Transparent" onClick={handleTest} disabled={testing}>
              {testing ? t.testingBtn : t.testConnectionsBtn}
            </Button>
          }
          endContent={
            <>
              <Button design="Emphasized" onClick={handleSave} disabled={saving}>
                {saving ? t.savingBtn : t.saveBtn}
              </Button>
              <Button design="Transparent" onClick={onClose}>
                {t.cancelBtn}
              </Button>
            </>
          }
        />
      }
    >
      <div
        style={{
          width: '840px',
          maxWidth: '88vw',
          display: 'flex',
          flexDirection: 'column',
          background: '#f5f6f7',
          borderRadius: '8px',
          overflow: 'hidden',
          border: '1px solid #e5e8eb',
          fontFamily: '"72", "72full", Arial, Helvetica, sans-serif',
        }}
      >
        {/* Fiori Anchor Tab Bar */}
        <div
          style={{
            background: '#ffffff',
            borderBottom: '2px solid #0032a5',
            padding: '0 24px',
            display: 'flex',
            gap: '24px',
          }}
        >
          <button
            type="button"
            onClick={() => setActiveTab('GENERAL')}
            style={tabBtnStyle(activeTab === 'GENERAL')}
          >
            {t.tabGeneralAndValidation}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('EMAIL')}
            style={tabBtnStyle(activeTab === 'EMAIL')}
          >
            {t.tabContactsAndEmail}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('SMTP_PDF')}
            style={tabBtnStyle(activeTab === 'SMTP_PDF')}
          >
            {t.tabSmtpAndPdf}
          </button>
        </div>

        <div style={{ padding: '18px 24px 24px 24px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={whitePanelStyle}>
            <div style={formGridStyle}>
              <span style={labelStyle}>{t.backendUrlLabel}</span>
              <Input
                value={backendUrl}
                placeholder="https://servidor:4020"
                style={{ width: '100%' }}
                onInput={(e) => setBackendUrl(e.target.value)}
              />
            </div>
            <div style={{ fontSize: '12px', color: '#556b82', marginTop: '6px' }}>
              {t.backendUrlHelp} {t.backendUrlReloadNote}
            </div>
          </div>
          {error && <MessageStrip design="Negative">{error}</MessageStrip>}
          {testResult && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <MessageStrip design={testResult.b1.ok ? 'Positive' : 'Negative'}>
                SAP B1 ({testResult.b1.companyDb}): {testResult.b1.message} ({testResult.b1.latencyMs}ms)
              </MessageStrip>
              <MessageStrip design={testResult.smtp.ok ? 'Positive' : 'Negative'}>
                {t.emailLabel}: {testResult.smtp.message}
              </MessageStrip>
              <MessageStrip design={testResult.gateway.ok ? 'Positive' : 'Negative'}>
                Crystal PDF Gateway: {testResult.gateway.message}
                {testResult.gateway.latencyMs > 0 ? ` (${testResult.gateway.latencyMs}ms)` : ''}
              </MessageStrip>
            </div>
          )}

          {activeTab === 'GENERAL' && (
            <div style={whitePanelStyle}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
                  gap: '24px 40px',
                }}
              >
                {/* Left: Agendamento */}
                <div>
                  <div style={groupTitleStyle}>{t.groupAutoSchedule}</div>
                  <div style={formGridStyle}>
                    <span style={labelStyle}>{t.autoJobActiveLabel}</span>
                    <Switch
                      checked={settings.schedulerEnabled}
                      onChange={(e) =>
                        setSettings({ ...settings, schedulerEnabled: Boolean(e.target.checked) })
                      }
                    />

                    <span style={labelStyle}>{t.intervalMinutesLabel}</span>
                    <Input
                      type="Number"
                      value={String(settings.intervalMinutes)}
                      style={{ width: '100%' }}
                      onInput={(e) =>
                        setSettings({
                          ...settings,
                          intervalMinutes: Math.max(1, Number(e.target.value) || 60),
                        })
                      }
                    />

                    <span style={labelStyle}>{t.defaultGroupingLabel}</span>
                    <Select
                      style={{ width: '100%' }}
                      onChange={(e) => {
                        const val = e.detail.selectedOption?.dataset.value as
                          | GroupingMode
                          | undefined;
                        if (val) setSettings({ ...settings, groupingMode: val });
                      }}
                    >
                      <Option
                        data-value="PER_DELIVERY"
                        selected={settings.groupingMode === 'PER_DELIVERY'}
                      >
                        {t.groupingPerDelivery}
                      </Option>
                      <Option
                        data-value="CONSOLIDATED_BY_CUSTOMER"
                        selected={settings.groupingMode === 'CONSOLIDATED_BY_CUSTOMER'}
                      >
                        {t.groupingConsolidated}
                      </Option>
                    </Select>

                    <span style={labelStyle}>{t.minDeliveryAgeLabel}</span>
                    <Input
                      type="Number"
                      value={String(settings.minDeliveryAgeDays)}
                      style={{ width: '100%' }}
                      onInput={(e) =>
                        setSettings({
                          ...settings,
                          minDeliveryAgeDays: Math.max(0, Number(e.target.value) || 0),
                        })
                      }
                    />

                    <span style={labelStyle}>U_AutoInvoice:</span>
                    <CheckBox
                      text={t.onlyAutoCustomersCheck}
                      checked={settings.onlyAutoInvoiceCustomers}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          onlyAutoInvoiceCustomers: Boolean(e.target.checked),
                        })
                      }
                    />

                    <span style={labelStyle}>{t.autoSendEmailLabel}</span>
                    <CheckBox
                      text={t.autoSendEmailCheck}
                      checked={settings.sendEmailAutomatically}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          sendEmailAutomatically: Boolean(e.target.checked),
                        })
                      }
                    />
                  </div>
                </div>

                {/* Right: Regras de Validação (Preços e Margens) */}
                <div>
                  <div style={groupTitleStyle}>{t.groupValidationRules}</div>
                  <div style={formGridStyle}>
                    <span style={labelStyle}>{t.validateLastPriceLabel}</span>
                    <CheckBox
                      text={t.validateLastPriceCheck}
                      checked={settings.checkPriceMatchLastInvoice ?? true}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          checkPriceMatchLastInvoice: Boolean(e.target.checked),
                        })
                      }
                    />

                    <span style={labelStyle}>{t.validateMinMarginLabel}</span>
                    <CheckBox
                      text={t.validateMinMarginCheck}
                      checked={settings.checkMinimumMargin ?? true}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          checkMinimumMargin: Boolean(e.target.checked),
                        })
                      }
                    />

                    <span style={labelStyle}>{t.minMarginPctLabel}</span>
                    <Input
                      type="Number"
                      value={String(settings.minimumMarginPercent ?? 30)}
                      disabled={!(settings.checkMinimumMargin ?? true)}
                      style={{ width: '100%' }}
                      onInput={(e) =>
                        setSettings({
                          ...settings,
                          minimumMarginPercent: Number(e.target.value) || 0,
                        })
                      }
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'EMAIL' && (
            <div style={whitePanelStyle}>
              <div style={groupTitleStyle}>{t.groupContactAndTemplate}</div>
              <div style={{ ...formGridStyle, marginBottom: '16px' }}>
                <span style={labelStyle}>{t.emlGrpCodeLabel}</span>
                <Input
                  value={settings.defaultEmlGrpCode ?? ''}
                  placeholder={t.emlGrpCodePlaceholder}
                  style={{ width: '100%' }}
                  onInput={(e) => setSettings({ ...settings, defaultEmlGrpCode: e.target.value })}
                />

                <span style={labelStyle}>{t.emailSubjectLabel}</span>
                <Input
                  value={settings.emailSubjectTemplate}
                  style={{ width: '100%' }}
                  onInput={(e) =>
                    setSettings({ ...settings, emailSubjectTemplate: e.target.value })
                  }
                />

                <span style={labelStyle}>CC:</span>
                <Input
                  value={settings.ccAddresses}
                  style={{ width: '100%' }}
                  onInput={(e) => setSettings({ ...settings, ccAddresses: e.target.value })}
                />

                <span style={labelStyle}>Reply-To:</span>
                <Input
                  value={settings.replyToAddress}
                  style={{ width: '100%' }}
                  onInput={(e) => setSettings({ ...settings, replyToAddress: e.target.value })}
                />
              </div>

              <div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: '8px',
                    marginBottom: '6px',
                  }}
                >
                  <Label>
                    {t.emailBodyLabel} {'{{InvoiceDocNum}}'}, {'{{InvoiceDate}}'}, {'{{CardName}}'},{' '}
                    {'{{ContactName}}'}, {'{{RecipientName}}'}, {'{{DocTotal}}'}, {'{{Currency}}'},{' '}
                    {'{{DeliveryRefs}}'}, {'{{NumAtCard}}'})
                  </Label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Label>{t.useHtmlCodeSwitch}</Label>
                    <Switch
                      checked={Boolean(settings.emailBodyIsHtml)}
                      onChange={(e) =>
                        setSettings({ ...settings, emailBodyIsHtml: Boolean(e.target.checked) })
                      }
                    />
                  </div>
                </div>
                <TextArea
                  rows={6}
                  value={settings.emailBodyTemplate}
                  style={{
                    width: '100%',
                    fontFamily: settings.emailBodyIsHtml ? 'monospace' : 'inherit',
                  }}
                  onInput={(e) =>
                    setSettings({ ...settings, emailBodyTemplate: e.target.value })
                  }
                />
                {settings.emailBodyIsHtml && (
                  <div style={{ marginTop: '10px' }}>
                    <Label style={{ fontSize: '12px', color: '#556b82' }}>
                      {t.htmlPreviewLabel}
                    </Label>
                    <div
                      style={{
                        marginTop: '4px',
                        padding: '12px',
                        border: '1px solid #d9d9d9',
                        borderRadius: '8px',
                        background: '#fafafa',
                        fontSize: '13px',
                      }}
                      dangerouslySetInnerHTML={{
                        __html: renderEmailTemplate(settings.emailBodyTemplate, {
                          InvoiceDocNum: '20265001',
                          InvoiceDate: new Date().toISOString().slice(0, 10),
                          CardCode: 'C20001',
                          CardName: 'Delta Comércio & Distribuição, Lda.',
                          ContactName: 'Ana Martins',
                          DocTotal: '1845.00',
                          Currency: 'EUR',
                          DeliveryRefs: 'GR 20260101',
                          NumAtCard: 'ENC-8821',
                        }),
                      }}
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'SMTP_PDF' && (
            <div style={whitePanelStyle}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
                  gap: '24px 40px',
                }}
              >
                <div>
                  <div style={groupTitleStyle}>{t.groupSmtpServer}</div>
                  <div style={formGridStyle}>
                    <span style={labelStyle}>{t.smtpHostLabel}</span>
                    <Input
                      value={settings.smtpHost}
                      placeholder="smtp.empresa.pt"
                      style={{ width: '100%' }}
                      onInput={(e) => setSettings({ ...settings, smtpHost: e.target.value })}
                    />

                    <span style={labelStyle}>{t.smtpPortLabel}</span>
                    <Input
                      type="Number"
                      value={String(settings.smtpPort)}
                      style={{ width: '100%' }}
                      onInput={(e) =>
                        setSettings({ ...settings, smtpPort: Number(e.target.value) || 587 })
                      }
                    />

                    <span style={labelStyle}>{t.smtpUserLabel}</span>
                    <Input
                      value={settings.smtpUser}
                      style={{ width: '100%' }}
                      onInput={(e) => setSettings({ ...settings, smtpUser: e.target.value })}
                    />

                    <span style={labelStyle}>
                      Password {settings.hasSmtpPassword ? t.smtpPassDefined : ''}:
                    </span>
                    <Input
                      type="Password"
                      value={smtpPassword}
                      placeholder={settings.hasSmtpPassword ? '••••••••' : ''}
                      style={{ width: '100%' }}
                      onInput={(e) => setSmtpPassword(e.target.value)}
                    />

                    <span style={labelStyle}>{t.smtpFromLabel}</span>
                    <Input
                      value={settings.smtpFrom}
                      placeholder="faturacao@empresa.pt"
                      style={{ width: '100%' }}
                      onInput={(e) => setSettings({ ...settings, smtpFrom: e.target.value })}
                    />

                    <span style={labelStyle}>{t.smtpTlsLabel}</span>
                    <CheckBox
                      text={t.smtpTlsCheck}
                      checked={settings.smtpSecure}
                      onChange={(e) =>
                        setSettings({ ...settings, smtpSecure: Boolean(e.target.checked) })
                      }
                    />
                  </div>
                </div>

                <div>
                  <div style={groupTitleStyle}>{t.groupPdfCrystal}</div>
                  <div style={formGridStyle}>
                    <span style={labelStyle}>{t.pdfSourceLabel}</span>
                    <Select
                      style={{ width: '100%' }}
                      onChange={(e) => {
                        const val = e.detail.selectedOption?.dataset.value as
                          | PdfSourceMode
                          | undefined;
                        if (val) setSettings({ ...settings, pdfSource: val });
                      }}
                    >
                      <Option data-value="builtin" selected={settings.pdfSource === 'builtin'}>
                        {t.pdfBuiltinOption}
                      </Option>
                      <Option data-value="gateway" selected={settings.pdfSource === 'gateway'}>
                        {t.pdfGatewayOption}
                      </Option>
                    </Select>

                    <span style={labelStyle}>{t.docCodeLabel}</span>
                    <Input
                      value={settings.invoiceDocCode}
                      placeholder="INV20004"
                      style={{ width: '100%' }}
                      onInput={(e) =>
                        setSettings({ ...settings, invoiceDocCode: e.target.value })
                      }
                    />

                    <span style={labelStyle}>{t.gatewayUrlLabel}</span>
                    <Input
                      value={settings.gatewayUrl}
                      placeholder="https://b1.internal.example.local:50000"
                      style={{ width: '100%' }}
                      onInput={(e) => setSettings({ ...settings, gatewayUrl: e.target.value })}
                    />

                    <span style={labelStyle}>{t.autoFallbackLabel}</span>
                    <CheckBox
                      text={t.autoFallbackCheck}
                      checked={settings.gatewayFallbackToBuiltin}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          gatewayFallbackToBuiltin: Boolean(e.target.checked),
                        })
                      }
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}

function tabBtnStyle(active: boolean): React.CSSProperties {
  return {
    background: 'transparent',
    border: 'none',
    borderBottom: active ? '3px solid #0064d9' : '3px solid transparent',
    padding: '10px 2px 9px 2px',
    fontSize: '13px',
    fontWeight: 600,
    color: active ? '#0064d9' : '#1d2d3e',
    cursor: 'pointer',
  };
}

const whitePanelStyle: React.CSSProperties = {
  background: '#ffffff',
  borderRadius: '10px',
  padding: '20px 24px',
  border: '1px solid #e6ebf0',
  boxShadow: '0 1px 3px rgba(15, 35, 55, 0.04)',
};

const groupTitleStyle: React.CSSProperties = {
  fontSize: '14px',
  fontWeight: 700,
  color: '#1d2d3e',
  marginBottom: '14px',
};

const formGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '165px 1fr',
  rowGap: '10px',
  columnGap: '14px',
  alignItems: 'center',
};

const labelStyle: React.CSSProperties = {
  fontSize: '13px',
  color: '#556b82',
};
