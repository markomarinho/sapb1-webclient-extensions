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
  Title,
} from '@ui5/webcomponents-react';
import { api } from '../api';

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export function SettingsDialog({ open, onClose, onSaved }: SettingsDialogProps) {
  const [settings, setSettings] = useState<AutomationSettings | null>(null);
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
    if (!open) return;
    setError(null);
    setTestResult(null);
    setSmtpPassword('');
    api
      .getSettings()
      .then((res) => setSettings(res.settings))
      .catch((err) => setError(err instanceof Error ? err.message : 'Erro ao carregar definições'));
  }, [open]);

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
      headerText="Definições de Automação e Email (SMTP)"
      style={{ width: '680px', maxWidth: '95vw' }}
      onClose={onClose}
      footer={
        <Bar
          startContent={
            <Button design="Transparent" onClick={handleTest} disabled={testing}>
              {testing ? 'A testar...' : 'Testar Ligações'}
            </Button>
          }
          endContent={
            <>
              <Button design="Transparent" onClick={onClose}>
                Cancelar
              </Button>
              <Button design="Emphasized" onClick={handleSave} disabled={saving || !settings}>
                {saving ? 'A guardar...' : 'Guardar'}
              </Button>
            </>
          }
        />
      }
    >
      {error && (
        <MessageStrip design="Negative" style={{ marginBottom: '0.75rem' }}>
          {error}
        </MessageStrip>
      )}
      {testResult && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '0.75rem' }}>
          <MessageStrip design={testResult.b1.ok ? 'Positive' : 'Negative'}>
            SAP B1 ({testResult.b1.companyDb}): {testResult.b1.message} ({testResult.b1.latencyMs}ms)
          </MessageStrip>
          <MessageStrip design={testResult.smtp.ok ? 'Positive' : 'Negative'}>
            Email: {testResult.smtp.message}
          </MessageStrip>
          <MessageStrip design={testResult.gateway.ok ? 'Positive' : 'Negative'}>
            Crystal PDF Gateway: {testResult.gateway.message}
            {testResult.gateway.latencyMs > 0 ? ` (${testResult.gateway.latencyMs}ms)` : ''}
          </MessageStrip>
        </div>
      )}

      {settings && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', padding: '0.25rem 0' }}>
          <Title level="H5">Agendamento Automático</Title>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <Label>Ativar Job Automático</Label>
              <Switch
                checked={settings.schedulerEnabled}
                onChange={(e) =>
                  setSettings({ ...settings, schedulerEnabled: Boolean(e.target.checked) })
                }
              />
            </div>
            <div>
              <Label>Intervalo (minutos)</Label>
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
            </div>
            <div>
              <Label>Agrupamento de Faturas</Label>
              <Select
                style={{ width: '100%' }}
                onChange={(e) => {
                  const val = e.detail.selectedOption?.dataset.value as GroupingMode | undefined;
                  if (val) setSettings({ ...settings, groupingMode: val });
                }}
              >
                <Option
                  data-value="PER_DELIVERY"
                  selected={settings.groupingMode === 'PER_DELIVERY'}
                >
                  1 Fatura por Guia de Remessa
                </Option>
                <Option
                  data-value="CONSOLIDATED_BY_CUSTOMER"
                  selected={settings.groupingMode === 'CONSOLIDATED_BY_CUSTOMER'}
                >
                  Consolidar por Cliente
                </Option>
              </Select>
            </div>
            <div>
              <Label>Idade Mínima da Guia (dias)</Label>
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
            </div>
          </div>

          <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
            <CheckBox
              text="Apenas clientes com U_AutoInvoice ativo"
              checked={settings.onlyAutoInvoiceCustomers}
              onChange={(e) =>
                setSettings({ ...settings, onlyAutoInvoiceCustomers: Boolean(e.target.checked) })
              }
            />
            <CheckBox
              text="Enviar email automaticamente após faturar"
              checked={settings.sendEmailAutomatically}
              onChange={(e) =>
                setSettings({ ...settings, sendEmailAutomatically: Boolean(e.target.checked) })
              }
            />
          </div>

          <div>
            <Label>
              Grupo de Email Padrão dos Contactos (EmlGrpCode / OCPR) — seleciona por defeito o contacto com este código
            </Label>
            <Input
              value={settings.defaultEmlGrpCode ?? ''}
              placeholder="Ex.: FATURACAO (deixe vazio para usar o email principal dos Dados Mestre)"
              style={{ width: '100%' }}
              onInput={(e) => setSettings({ ...settings, defaultEmlGrpCode: e.target.value })}
            />
          </div>

          <Title level="H5" style={{ marginTop: '0.5rem' }}>
            Regras de Validação de Guias (Preços e Margens)
          </Title>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <CheckBox
              text="Verificar se o preço de cada artigo é igual ao último preço faturado a este cliente"
              checked={settings.checkPriceMatchLastInvoice ?? true}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  checkPriceMatchLastInvoice: Boolean(e.target.checked),
                })
              }
            />
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '2fr 1fr',
                gap: '0.75rem',
                alignItems: 'center',
              }}
            >
              <CheckBox
                text="Verificar margem mínima por artigo (média quando existem várias linhas do mesmo artigo)"
                checked={settings.checkMinimumMargin ?? true}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    checkMinimumMargin: Boolean(e.target.checked),
                  })
                }
              />
              <div>
                <Label>Margem Mínima (%)</Label>
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

          <Title level="H5" style={{ marginTop: '0.5rem' }}>
            Modelo de Email
          </Title>
          <div>
            <Label>Assunto</Label>
            <Input
              value={settings.emailSubjectTemplate}
              style={{ width: '100%' }}
              onInput={(e) => setSettings({ ...settings, emailSubjectTemplate: e.target.value })}
            />
          </div>
          <div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '0.5rem',
                marginBottom: '0.35rem',
              }}
            >
              <Label>
                Corpo do Email (placeholders: {'{{InvoiceDocNum}}'}, {'{{InvoiceDate}}'}, {'{{CardName}}'},{' '}
                {'{{ContactName}}'}, {'{{RecipientName}}'}, {'{{DocTotal}}'}, {'{{Currency}}'},{' '}
                {'{{DeliveryRefs}}'})
              </Label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
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
              placeholder={
                settings.emailBodyIsHtml
                  ? '<p>Exmo.(a) <strong>{{RecipientName}}</strong>,</p>\n<p>Enviamos em anexo a Fatura nº <strong>{{InvoiceDocNum}}</strong> ({{InvoiceDate}}) referente a {{DeliveryRefs}}.</p>\n<p>Total: <strong>{{DocTotal}} {{Currency}}</strong></p>'
                  : undefined
              }
              style={{
                width: '100%',
                fontFamily: settings.emailBodyIsHtml ? 'monospace' : 'inherit',
              }}
              onInput={(e) => setSettings({ ...settings, emailBodyTemplate: e.target.value })}
            />
            {settings.emailBodyIsHtml && (
              <div style={{ marginTop: '0.5rem' }}>
                <Label style={{ fontSize: '0.78rem', color: '#556b82' }}>
                  Pré-visualização HTML (exemplo com placeholders aplicados):
                </Label>
                <div
                  style={{
                    marginTop: '0.25rem',
                    padding: '0.75rem',
                    border: '1px solid #d9d9d9',
                    borderRadius: '6px',
                    background: '#fafafa',
                    fontSize: '0.85rem',
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
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <Label>CC (opcional, separado por vírgulas)</Label>
              <Input
                value={settings.ccAddresses}
                style={{ width: '100%' }}
                onInput={(e) => setSettings({ ...settings, ccAddresses: e.target.value })}
              />
            </div>
            <div>
              <Label>Reply-To (opcional)</Label>
              <Input
                value={settings.replyToAddress}
                style={{ width: '100%' }}
                onInput={(e) => setSettings({ ...settings, replyToAddress: e.target.value })}
              />
            </div>
          </div>

          <Title level="H5" style={{ marginTop: '0.5rem' }}>
            Servidor SMTP (quando EMAIL_MODE=smtp)
          </Title>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '0.75rem' }}>
            <div>
              <Label>SMTP Host</Label>
              <Input
                value={settings.smtpHost}
                placeholder="smtp.empresa.pt"
                style={{ width: '100%' }}
                onInput={(e) => setSettings({ ...settings, smtpHost: e.target.value })}
              />
            </div>
            <div>
              <Label>Porta</Label>
              <Input
                type="Number"
                value={String(settings.smtpPort)}
                style={{ width: '100%' }}
                onInput={(e) =>
                  setSettings({ ...settings, smtpPort: Number(e.target.value) || 587 })
                }
              />
            </div>
            <div>
              <Label>Utilizador SMTP</Label>
              <Input
                value={settings.smtpUser}
                style={{ width: '100%' }}
                onInput={(e) => setSettings({ ...settings, smtpUser: e.target.value })}
              />
            </div>
            <div>
              <Label>Password SMTP {settings.hasSmtpPassword ? '(definida)' : ''}</Label>
              <Input
                type="Password"
                value={smtpPassword}
                placeholder={settings.hasSmtpPassword ? '••••••••' : ''}
                style={{ width: '100%' }}
                onInput={(e) => setSmtpPassword(e.target.value)}
              />
            </div>
            <div>
              <Label>Remetente (From)</Label>
              <Input
                value={settings.smtpFrom}
                placeholder="faturacao@empresa.pt"
                style={{ width: '100%' }}
                onInput={(e) => setSettings({ ...settings, smtpFrom: e.target.value })}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <CheckBox
                text="Usar TLS direto (porta 465)"
                checked={settings.smtpSecure}
                onChange={(e) =>
                  setSettings({ ...settings, smtpSecure: Boolean(e.target.checked) })
                }
              />
            </div>
          </div>

          <Title level="H5" style={{ marginTop: '0.5rem' }}>
            Geração de PDF — Crystal Reports (SAP B1 API Gateway)
          </Title>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <Label>Fonte do PDF</Label>
              <Select
                style={{ width: '100%' }}
                onChange={(e) => {
                  const val = e.detail.selectedOption?.dataset.value as PdfSourceMode | undefined;
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
            </div>
            <div>
              <Label>Layout DocCode (tabela RDOC)</Label>
              <Input
                value={settings.invoiceDocCode}
                placeholder="INV20004"
                style={{ width: '100%' }}
                onInput={(e) => setSettings({ ...settings, invoiceDocCode: e.target.value })}
              />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <Label>URL do SAP B1 API Gateway</Label>
              <Input
                value={settings.gatewayUrl}
                placeholder="https://b1.internal.example.local:50000"
                style={{ width: '100%' }}
                onInput={(e) => setSettings({ ...settings, gatewayUrl: e.target.value })}
              />
            </div>
          </div>
          <CheckBox
            text="Usar PDF built-in como fallback se o API Gateway falhar"
            checked={settings.gatewayFallbackToBuiltin}
            onChange={(e) =>
              setSettings({ ...settings, gatewayFallbackToBuiltin: Boolean(e.target.checked) })
            }
          />
        </div>
      )}
    </Dialog>
  );
}
