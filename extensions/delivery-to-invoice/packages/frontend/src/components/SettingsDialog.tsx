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
import { api } from '../api';

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
  const [settings, setSettings] = useState<AutomationSettings>(
    initialSettings ?? DEFAULT_SETTINGS
  );
  const [activeTab, setActiveTab] = useState<SettingsTab>('GENERAL');
  const [smtpPassword, setSmtpPassword] = useState('');
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
    if (!settings) return;
    setSaving(true);
    setError(null);
    try {
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
      headerText="Definições de automação, validação e e-mail"
      onClose={onClose}
      footer={
        <Bar
          startContent={
            <Button design="Transparent" onClick={handleTest} disabled={testing}>
              {testing ? 'A testar...' : 'Testar ligações'}
            </Button>
          }
          endContent={
            <>
              <Button design="Emphasized" onClick={handleSave} disabled={saving}>
                {saving ? 'A guardar...' : 'Guardar'}
              </Button>
              <Button design="Transparent" onClick={onClose}>
                Cancelar
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
              Geral e regras de validação
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('EMAIL')}
              style={tabBtnStyle(activeTab === 'EMAIL')}
            >
              Contactos e modelo de e-mail
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('SMTP_PDF')}
              style={tabBtnStyle(activeTab === 'SMTP_PDF')}
            >
              Servidor SMTP e Crystal Reports PDF
            </button>
          </div>

          <div style={{ padding: '18px 24px 24px 24px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {error && <MessageStrip design="Negative">{error}</MessageStrip>}
            {testResult && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <MessageStrip design={testResult.b1.ok ? 'Positive' : 'Negative'}>
                  SAP B1 ({testResult.b1.companyDb}): {testResult.b1.message} ({testResult.b1.latencyMs}ms)
                </MessageStrip>
                <MessageStrip design={testResult.smtp.ok ? 'Positive' : 'Negative'}>
                  E-mail: {testResult.smtp.message}
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
                    <div style={groupTitleStyle}>Agendamento automático</div>
                    <div style={formGridStyle}>
                      <span style={labelStyle}>Job automático ativo:</span>
                      <Switch
                        checked={settings.schedulerEnabled}
                        onChange={(e) =>
                          setSettings({ ...settings, schedulerEnabled: Boolean(e.target.checked) })
                        }
                      />

                      <span style={labelStyle}>Intervalo (minutos):</span>
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

                      <span style={labelStyle}>Agrupamento padrão:</span>
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
                          1 fatura por guia de remessa
                        </Option>
                        <Option
                          data-value="CONSOLIDATED_BY_CUSTOMER"
                          selected={settings.groupingMode === 'CONSOLIDATED_BY_CUSTOMER'}
                        >
                          Consolidar por cliente
                        </Option>
                      </Select>

                      <span style={labelStyle}>Idade mín. da guia (dias):</span>
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

                      <span style={labelStyle}>Filtro U_AutoInvoice:</span>
                      <CheckBox
                        text="Apenas clientes com U_AutoInvoice = Y"
                        checked={settings.onlyAutoInvoiceCustomers}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            onlyAutoInvoiceCustomers: Boolean(e.target.checked),
                          })
                        }
                      />

                      <span style={labelStyle}>Envio automático:</span>
                      <CheckBox
                        text="Enviar e-mail automaticamente após faturar"
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
                    <div style={groupTitleStyle}>Regras de validação (Preços e margens)</div>
                    <div style={formGridStyle}>
                      <span style={labelStyle}>Validar último preço:</span>
                      <CheckBox
                        text="Comparar preço com a última fatura do cliente"
                        checked={settings.checkPriceMatchLastInvoice ?? true}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            checkPriceMatchLastInvoice: Boolean(e.target.checked),
                          })
                        }
                      />

                      <span style={labelStyle}>Validar margem mínima:</span>
                      <CheckBox
                        text="Exigir margem mínima por artigo (média por artigo)"
                        checked={settings.checkMinimumMargin ?? true}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            checkMinimumMargin: Boolean(e.target.checked),
                          })
                        }
                      />

                      <span style={labelStyle}>Margem mínima (%):</span>
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
                <div style={groupTitleStyle}>Seleção de contacto padrão e modelo de e-mail</div>
                <div style={{ ...formGridStyle, marginBottom: '16px' }}>
                  <span style={labelStyle}>Grupo de e-mail (EmlGrpCode):</span>
                  <Input
                    value={settings.defaultEmlGrpCode ?? ''}
                    placeholder="Ex.: FATURACAO (vazio usa o e-mail principal dos Dados Mestre)"
                    style={{ width: '100%' }}
                    onInput={(e) => setSettings({ ...settings, defaultEmlGrpCode: e.target.value })}
                  />

                  <span style={labelStyle}>Assunto do e-mail:</span>
                  <Input
                    value={settings.emailSubjectTemplate}
                    style={{ width: '100%' }}
                    onInput={(e) =>
                      setSettings({ ...settings, emailSubjectTemplate: e.target.value })
                    }
                  />

                  <span style={labelStyle}>CC (opcional):</span>
                  <Input
                    value={settings.ccAddresses}
                    style={{ width: '100%' }}
                    onInput={(e) => setSettings({ ...settings, ccAddresses: e.target.value })}
                  />

                  <span style={labelStyle}>Reply-To (opcional):</span>
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
                      Corpo do e-mail (placeholders: {'{{InvoiceDocNum}}'}, {'{{InvoiceDate}}'},{' '}
                      {'{{CardName}}'}, {'{{ContactName}}'}, {'{{RecipientName}}'}, {'{{DocTotal}}'},{' '}
                      {'{{Currency}}'}, {'{{DeliveryRefs}}'})
                    </Label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Label>Usar código HTML</Label>
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
                        Pré-visualização HTML (com placeholders de exemplo):
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
                    <div style={groupTitleStyle}>Servidor SMTP</div>
                    <div style={formGridStyle}>
                      <span style={labelStyle}>Host SMTP:</span>
                      <Input
                        value={settings.smtpHost}
                        placeholder="smtp.empresa.pt"
                        style={{ width: '100%' }}
                        onInput={(e) => setSettings({ ...settings, smtpHost: e.target.value })}
                      />

                      <span style={labelStyle}>Porta:</span>
                      <Input
                        type="Number"
                        value={String(settings.smtpPort)}
                        style={{ width: '100%' }}
                        onInput={(e) =>
                          setSettings({ ...settings, smtpPort: Number(e.target.value) || 587 })
                        }
                      />

                      <span style={labelStyle}>Utilizador:</span>
                      <Input
                        value={settings.smtpUser}
                        style={{ width: '100%' }}
                        onInput={(e) => setSettings({ ...settings, smtpUser: e.target.value })}
                      />

                      <span style={labelStyle}>
                        Password {settings.hasSmtpPassword ? '(definida)' : ''}:
                      </span>
                      <Input
                        type="Password"
                        value={smtpPassword}
                        placeholder={settings.hasSmtpPassword ? '••••••••' : ''}
                        style={{ width: '100%' }}
                        onInput={(e) => setSmtpPassword(e.target.value)}
                      />

                      <span style={labelStyle}>Remetente (From):</span>
                      <Input
                        value={settings.smtpFrom}
                        placeholder="faturacao@empresa.pt"
                        style={{ width: '100%' }}
                        onInput={(e) => setSettings({ ...settings, smtpFrom: e.target.value })}
                      />

                      <span style={labelStyle}>Segurança TLS:</span>
                      <CheckBox
                        text="Usar TLS direto (porta 465)"
                        checked={settings.smtpSecure}
                        onChange={(e) =>
                          setSettings({ ...settings, smtpSecure: Boolean(e.target.checked) })
                        }
                      />
                    </div>
                  </div>

                  <div>
                    <div style={groupTitleStyle}>Geração de PDF (Crystal Reports Gateway)</div>
                    <div style={formGridStyle}>
                      <span style={labelStyle}>Fonte do PDF:</span>
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
                          PDF Built-in (interno)
                        </Option>
                        <Option data-value="gateway" selected={settings.pdfSource === 'gateway'}>
                          Crystal Reports via API Gateway
                        </Option>
                      </Select>

                      <span style={labelStyle}>Layout DocCode (RDOC):</span>
                      <Input
                        value={settings.invoiceDocCode}
                        placeholder="INV20004"
                        style={{ width: '100%' }}
                        onInput={(e) =>
                          setSettings({ ...settings, invoiceDocCode: e.target.value })
                        }
                      />

                      <span style={labelStyle}>URL do API Gateway:</span>
                      <Input
                        value={settings.gatewayUrl}
                        placeholder="https://b1.internal.example.local:50000"
                        style={{ width: '100%' }}
                        onInput={(e) => setSettings({ ...settings, gatewayUrl: e.target.value })}
                      />

                      <span style={labelStyle}>Fallback automático:</span>
                      <CheckBox
                        text="Usar PDF built-in se o Gateway falhar"
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
