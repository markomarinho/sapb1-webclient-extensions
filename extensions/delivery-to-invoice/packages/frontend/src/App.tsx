import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  ConversionItemStatus,
  ConversionRecord,
  DashboardSummary,
  GroupingMode,
  OpenDeliveryNote,
  SentEmailPreview,
} from '@b1-d2i/shared';
import {
  Bar,
  BusyIndicator,
  Button,
  Card,
  CheckBox,
  Dialog,
  Input,
  Label,
  MessageStrip,
  Option,
  Select,
  Tab,
  TabContainer,
  Tag,
  Text,
  Title,
} from '@ui5/webcomponents-react';
import { api, formatMoney } from './api';
import { AuditLogDialog } from './components/AuditLogDialog';
import { EmailPreviewDialog } from './components/EmailPreviewDialog';
import { SettingsDialog } from './components/SettingsDialog';

function statusBadge(status: ConversionItemStatus): { text: string; design: 'Positive' | 'Critical' | 'Negative' | 'Information' } {
  switch (status) {
    case 'INVOICED_AND_EMAILED':
      return { text: 'Faturada e Enviada', design: 'Positive' };
    case 'INVOICED_ONLY':
      return { text: 'Apenas Faturada', design: 'Information' };
    case 'INVOICED_NO_EMAIL':
      return { text: 'Sem Email', design: 'Critical' };
    case 'INVOICED_EMAIL_FAILED':
      return { text: 'Falha no Email', design: 'Negative' };
    case 'FAILED':
      return { text: 'Erro', design: 'Negative' };
  }
}

export function App() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [deliveries, setDeliveries] = useState<OpenDeliveryNote[]>([]);
  const [conversions, setConversions] = useState<ConversionRecord[]>([]);
  const [emails, setEmails] = useState<SentEmailPreview[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState(false);

  const [selectedEntries, setSelectedEntries] = useState<Set<number>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [onlyAutoFilter, setOnlyAutoFilter] = useState(false);
  const [groupingMode, setGroupingMode] = useState<GroupingMode>('PER_DELIVERY');

  const [banner, setBanner] = useState<{ design: 'Positive' | 'Negative' | 'Information'; text: string } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [previewEmail, setPreviewEmail] = useState<SentEmailPreview | null>(null);
  const [retryTarget, setRetryTarget] = useState<ConversionRecord | null>(null);
  const [retryEmailInput, setRetryEmailInput] = useState('');

  const refreshAll = useCallback(async () => {
    setLoading(true);
    try {
      const [dash, delRes, convRes, emailRes] = await Promise.all([
        api.getDashboard(),
        api.listDeliveries(),
        api.listConversions(),
        api.listEmails(),
      ]);
      setSummary(dash);
      setDeliveries(delRes.deliveries);
      setConversions(convRes.conversions);
      setEmails(emailRes.emails);
      setSelectedEntries((prev) => {
        const valid = new Set(delRes.deliveries.filter((d) => !d.alreadyProcessed).map((d) => d.docEntry));
        return new Set(Array.from(prev).filter((id) => valid.has(id)));
      });
    } catch (err) {
      setBanner({
        design: 'Negative',
        text: err instanceof Error ? err.message : 'Erro ao carregar dados do servidor.',
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  const filteredDeliveries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return deliveries.filter((d) => {
      if (d.alreadyProcessed) return false;
      if (onlyAutoFilter && !d.autoInvoiceEnabled) return false;
      if (!q) return true;
      return (
        String(d.docNum).includes(q) ||
        d.cardCode.toLowerCase().includes(q) ||
        d.cardName.toLowerCase().includes(q) ||
        (d.customerEmail || d.contactEmail || '').toLowerCase().includes(q) ||
        (d.numAtCard ?? '').toLowerCase().includes(q)
      );
    });
  }, [deliveries, searchQuery, onlyAutoFilter]);

  const allVisibleSelected =
    filteredDeliveries.length > 0 &&
    filteredDeliveries.every((d) => selectedEntries.has(d.docEntry));

  const toggleAllVisible = () => {
    if (allVisibleSelected) {
      setSelectedEntries(new Set());
    } else {
      setSelectedEntries(new Set(filteredDeliveries.map((d) => d.docEntry)));
    }
  };

  const toggleOne = (docEntry: number) => {
    setSelectedEntries((prev) => {
      const next = new Set(prev);
      if (next.has(docEntry)) next.delete(docEntry);
      else next.add(docEntry);
      return next;
    });
  };

  const handleConvert = async (sendEmail: boolean) => {
    const ids = Array.from(selectedEntries);
    if (ids.length === 0) return;
    setBusyAction(true);
    setBanner(null);
    try {
      const res = await api.convertDeliveries({
        deliveryDocEntries: ids,
        groupingMode,
        sendEmail,
      });
      setBanner({
        design: res.failedCount > 0 ? 'Information' : 'Positive',
        text: `Processadas ${res.processedCount} guia(s): ${res.invoicesCreated} fatura(s) criada(s), ${res.emailsSent} email(s) enviado(s)${
          res.failedCount > 0 ? `, ${res.failedCount} alerta(s)/falha(s).` : '.'
        }`,
      });
      await refreshAll();
    } catch (err) {
      setBanner({
        design: 'Negative',
        text: err instanceof Error ? err.message : 'Erro ao converter guias de remessa.',
      });
    } finally {
      setBusyAction(false);
    }
  };

  const handleRunScheduledNow = async () => {
    setBusyAction(true);
    setBanner(null);
    try {
      const res = await api.runScheduledNow();
      setBanner({
        design: res.processedCount > 0 ? 'Positive' : 'Information',
        text:
          res.processedCount === 0
            ? 'Job automático executado: nenhuma guia elegível encontrada.'
            : `Job automático concluído: ${res.processedCount} guia(s) -> ${res.invoicesCreated} fatura(s), ${res.emailsSent} email(s) enviado(s).`,
      });
      await refreshAll();
    } catch (err) {
      setBanner({
        design: 'Negative',
        text: err instanceof Error ? err.message : 'Erro ao executar job automático.',
      });
    } finally {
      setBusyAction(false);
    }
  };

  const handleConfirmRetryEmail = async () => {
    if (!retryTarget) return;
    setBusyAction(true);
    try {
      const res = await api.retryEmail(retryTarget.id, retryEmailInput.trim() || undefined);
      setBanner({
        design: res.conversion.status === 'INVOICED_AND_EMAILED' ? 'Positive' : 'Negative',
        text:
          res.conversion.status === 'INVOICED_AND_EMAILED'
            ? `Email da Fatura #${res.conversion.invoiceDocNum} enviado para ${res.conversion.recipientEmail}.`
            : res.conversion.errorMessage || 'Falha ao reenviar email.',
      });
      setRetryTarget(null);
      await refreshAll();
    } catch (err) {
      setBanner({
        design: 'Negative',
        text: err instanceof Error ? err.message : 'Erro ao reenviar email.',
      });
    } finally {
      setBusyAction(false);
    }
  };

  const emailByConversionId = useMemo(() => {
    const map = new Map<string, SentEmailPreview>();
    for (const e of emails) {
      if (!map.has(e.conversionId)) map.set(e.conversionId, e);
    }
    return map;
  }, [emails]);

  return (
    <div style={{ minHeight: '100vh', background: '#f5f6f7', padding: '1rem 1.5rem', boxSizing: 'border-box' }}>
      {/* Header Bar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '0.75rem',
          marginBottom: '1rem',
        }}
      >
        <div>
          <Title level="H3">Faturação Automática — Guias de Remessa para Faturas</Title>
          <Text style={{ color: '#556b82', fontSize: '0.875rem' }}>
            Conversão de Guias de Remessa (ODLN) em Faturas de Cliente (OINV) com envio automático de PDF por email
          </Text>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          {summary && (
            <Tag design={summary.schedulerEnabled ? 'Positive' : 'Neutral'}>
              {summary.schedulerEnabled ? 'Agendador Ativo' : 'Agendador Inativo'}
            </Tag>
          )}
          <Button icon="play" design="Default" onClick={handleRunScheduledNow} disabled={busyAction}>
            Executar Job Automático
          </Button>
          <Button icon="action-settings" design="Transparent" onClick={() => setSettingsOpen(true)}>
            Definições
          </Button>
          <Button icon="history" design="Transparent" onClick={() => setAuditOpen(true)}>
            Auditoria
          </Button>
          <Button icon="refresh" design="Transparent" onClick={() => void refreshAll()} disabled={loading}>
            Atualizar
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      {summary && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(185px, 1fr))',
            gap: '0.75rem',
            marginBottom: '1rem',
          }}
        >
          <Card>
            <div style={{ padding: '0.85rem 1rem' }}>
              <Text style={{ color: '#556b82', fontSize: '0.8rem' }}>Guias Abertas</Text>
              <Title level="H2" style={{ marginTop: '0.25rem' }}>
                {summary.openDeliveriesCount}
              </Title>
              <Text style={{ fontSize: '0.8rem', color: '#556b82' }}>
                {formatMoney(summary.openDeliveriesTotal)}
              </Text>
            </div>
          </Card>
          <Card>
            <div style={{ padding: '0.85rem 1rem' }}>
              <Text style={{ color: '#556b82', fontSize: '0.8rem' }}>Elegíveis Auto-Fatura</Text>
              <Title level="H2" style={{ marginTop: '0.25rem', color: '#0070f2' }}>
                {summary.eligibleAutoCount}
              </Title>
              <Text style={{ fontSize: '0.8rem', color: '#556b82' }}>
                Modo B1: {summary.b1Mode.toUpperCase()}
              </Text>
            </div>
          </Card>
          <Card>
            <div style={{ padding: '0.85rem 1rem' }}>
              <Text style={{ color: '#556b82', fontSize: '0.8rem' }}>Faturas Criadas Hoje</Text>
              <Title level="H2" style={{ marginTop: '0.25rem', color: '#256f3a' }}>
                {summary.invoicedTodayCount}
              </Title>
              <Text style={{ fontSize: '0.8rem', color: '#556b82' }}>
                Emails enviados: {summary.emailsSentCount}
              </Text>
            </div>
          </Card>
          <Card>
            <div style={{ padding: '0.85rem 1rem' }}>
              <Text style={{ color: '#556b82', fontSize: '0.8rem' }}>Alertas / Falhas Email</Text>
              <Title
                level="H2"
                style={{
                  marginTop: '0.25rem',
                  color: summary.emailFailedCount > 0 ? '#aa0808' : '#256f3a',
                }}
              >
                {summary.emailFailedCount}
              </Title>
              <Text style={{ fontSize: '0.8rem', color: '#556b82' }}>
                Email: {summary.emailMode.toUpperCase()}
              </Text>
            </div>
          </Card>
        </div>
      )}

      {banner && (
        <MessageStrip
          design={banner.design}
          style={{ marginBottom: '1rem' }}
          onClose={() => setBanner(null)}
        >
          {banner.text}
        </MessageStrip>
      )}

      <BusyIndicator active={loading || busyAction} style={{ width: '100%' }}>
        <Card>
          <TabContainer>
            <Tab text={`Guias de Remessa Abertas (${filteredDeliveries.length})`} selected>
              <div style={{ padding: '0.75rem 1rem' }}>
                {/* Filter & Action Toolbar */}
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '0.75rem',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: '0.75rem',
                  }}
                >
                  <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <Input
                      placeholder="Pesquisar nº guia, cliente, email..."
                      value={searchQuery}
                      style={{ width: '260px' }}
                      onInput={(e) => setSearchQuery(e.target.value)}
                    />
                    <CheckBox
                      text="Só Auto-Fatura"
                      checked={onlyAutoFilter}
                      onChange={(e) => setOnlyAutoFilter(Boolean(e.target.checked))}
                    />
                    <Select
                      onChange={(e) => {
                        const val = e.detail.selectedOption?.dataset.value as GroupingMode | undefined;
                        if (val) setGroupingMode(val);
                      }}
                    >
                      <Option data-value="PER_DELIVERY" selected={groupingMode === 'PER_DELIVERY'}>
                        1 Fatura por Guia
                      </Option>
                      <Option
                        data-value="CONSOLIDATED_BY_CUSTOMER"
                        selected={groupingMode === 'CONSOLIDATED_BY_CUSTOMER'}
                      >
                        Consolidar por Cliente
                      </Option>
                    </Select>
                  </div>

                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <Button
                      design="Default"
                      icon="document"
                      disabled={selectedEntries.size === 0 || busyAction}
                      onClick={() => void handleConvert(false)}
                    >
                      Apenas Faturar ({selectedEntries.size})
                    </Button>
                    <Button
                      design="Emphasized"
                      icon="email"
                      disabled={selectedEntries.size === 0 || busyAction}
                      onClick={() => void handleConvert(true)}
                    >
                      Converter e Enviar Email ({selectedEntries.size})
                    </Button>
                  </div>
                </div>

                {/* Open Deliveries Table */}
                {filteredDeliveries.length === 0 ? (
                  <div style={{ padding: '2rem', textAlign: 'center', color: '#556b82' }}>
                    Nenhuma guia de remessa aberta corresponde aos filtros.
                  </div>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                      <thead>
                        <tr style={{ borderBottom: '2px solid #e5e5e5', textAlign: 'left', color: '#556b82' }}>
                          <th style={{ padding: '0.6rem 0.5rem', width: '36px' }}>
                            <CheckBox checked={allVisibleSelected} onChange={toggleAllVisible} />
                          </th>
                          <th style={{ padding: '0.6rem 0.5rem' }}>Guia Nº</th>
                          <th style={{ padding: '0.6rem 0.5rem' }}>Data</th>
                          <th style={{ padding: '0.6rem 0.5rem' }}>Cliente</th>
                          <th style={{ padding: '0.6rem 0.5rem' }}>Email Destino</th>
                          <th style={{ padding: '0.6rem 0.5rem' }}>Auto</th>
                          <th style={{ padding: '0.6rem 0.5rem' }}>Linhas</th>
                          <th style={{ padding: '0.6rem 0.5rem', textAlign: 'right' }}>Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredDeliveries.map((d) => {
                          const effectiveEmail = d.customerEmail || d.contactEmail || '';
                          const isChecked = selectedEntries.has(d.docEntry);
                          return (
                            <tr
                              key={d.docEntry}
                              style={{
                                borderBottom: '1px solid #efefef',
                                background: isChecked ? '#ebf5ff' : 'transparent',
                              }}
                            >
                              <td style={{ padding: '0.5rem' }}>
                                <CheckBox checked={isChecked} onChange={() => toggleOne(d.docEntry)} />
                              </td>
                              <td style={{ padding: '0.5rem', fontWeight: 600 }}>GR {d.docNum}</td>
                              <td style={{ padding: '0.5rem' }}>{d.docDate}</td>
                              <td style={{ padding: '0.5rem' }}>
                                <div style={{ fontWeight: 500 }}>{d.cardName}</div>
                                <div style={{ fontSize: '0.78rem', color: '#556b82' }}>
                                  {d.cardCode} {d.numAtCard ? `• Ref: ${d.numAtCard}` : ''}
                                </div>
                              </td>
                              <td style={{ padding: '0.5rem' }}>
                                {effectiveEmail ? (
                                  <span>{effectiveEmail}</span>
                                ) : (
                                  <Tag design="Critical">Sem Email</Tag>
                                )}
                              </td>
                              <td style={{ padding: '0.5rem' }}>
                                <Tag design={d.autoInvoiceEnabled ? 'Positive' : 'Neutral'}>
                                  {d.autoInvoiceEnabled ? 'Sim' : 'Manual'}
                                </Tag>
                              </td>
                              <td style={{ padding: '0.5rem' }}>{d.lines.length}</td>
                              <td style={{ padding: '0.5rem', textAlign: 'right', fontWeight: 600 }}>
                                {formatMoney(d.docTotal, d.docCurrency)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </Tab>

            <Tab text={`Histórico & Emails (${conversions.length})`}>
              <div style={{ padding: '0.75rem 1rem', overflowX: 'auto' }}>
                {conversions.length === 0 ? (
                  <div style={{ padding: '2rem', textAlign: 'center', color: '#556b82' }}>
                    Ainda não existem faturas convertidas nesta sessão.
                  </div>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid #e5e5e5', textAlign: 'left', color: '#556b82' }}>
                        <th style={{ padding: '0.6rem 0.5rem' }}>Data/Hora</th>
                        <th style={{ padding: '0.6rem 0.5rem' }}>Origem</th>
                        <th style={{ padding: '0.6rem 0.5rem' }}>Fatura</th>
                        <th style={{ padding: '0.6rem 0.5rem' }}>Guias Base</th>
                        <th style={{ padding: '0.6rem 0.5rem' }}>Cliente</th>
                        <th style={{ padding: '0.6rem 0.5rem' }}>Destinatário</th>
                        <th style={{ padding: '0.6rem 0.5rem', textAlign: 'right' }}>Total</th>
                        <th style={{ padding: '0.6rem 0.5rem' }}>Estado</th>
                        <th style={{ padding: '0.6rem 0.5rem' }}>Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {conversions.map((c) => {
                        const badge = statusBadge(c.status);
                        const sentEmail = emailByConversionId.get(c.id);
                        const canRetryEmail =
                          c.invoiceDocEntry !== null &&
                          (c.status === 'INVOICED_EMAIL_FAILED' ||
                            c.status === 'INVOICED_NO_EMAIL' ||
                            c.status === 'INVOICED_ONLY');
                        return (
                          <tr key={c.id} style={{ borderBottom: '1px solid #efefef' }}>
                            <td style={{ padding: '0.5rem', whiteSpace: 'nowrap' }}>
                              {new Date(c.createdAt).toLocaleString('pt-PT')}
                            </td>
                            <td style={{ padding: '0.5rem' }}>
                              <Tag design={c.triggerSource === 'SCHEDULED' ? 'Information' : 'Neutral'}>
                                {c.triggerSource === 'SCHEDULED' ? 'Auto' : 'Manual'}
                              </Tag>
                            </td>
                            <td style={{ padding: '0.5rem', fontWeight: 600 }}>
                              {c.invoiceDocNum ? `FT ${c.invoiceDocNum}` : '—'}
                            </td>
                            <td style={{ padding: '0.5rem' }}>
                              {c.deliveryDocNums.map((n) => `GR ${n}`).join(', ')}
                            </td>
                            <td style={{ padding: '0.5rem' }}>{c.cardName}</td>
                            <td style={{ padding: '0.5rem' }}>{c.recipientEmail ?? '—'}</td>
                            <td style={{ padding: '0.5rem', textAlign: 'right', fontWeight: 600 }}>
                              {formatMoney(c.totalAmount, c.currency)}
                            </td>
                            <td style={{ padding: '0.5rem' }}>
                              <Tag design={badge.design}>{badge.text}</Tag>
                              {c.errorMessage && (
                                <div style={{ fontSize: '0.75rem', color: '#aa0808', marginTop: '0.2rem' }}>
                                  {c.errorMessage}
                                </div>
                              )}
                            </td>
                            <td style={{ padding: '0.5rem', whiteSpace: 'nowrap' }}>
                              <div style={{ display: 'flex', gap: '0.35rem' }}>
                                {sentEmail && (
                                  <Button
                                    design="Transparent"
                                    icon="show"
                                    onClick={() => setPreviewEmail(sentEmail)}
                                  >
                                    Ver Email
                                  </Button>
                                )}
                                {canRetryEmail && (
                                  <Button
                                    design="Default"
                                    icon="email"
                                    onClick={() => {
                                      setRetryTarget(c);
                                      setRetryEmailInput(c.recipientEmail ?? '');
                                    }}
                                  >
                                    Enviar Email
                                  </Button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </Tab>
          </TabContainer>
        </Card>
      </BusyIndicator>

      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSaved={() => {
          setBanner({ design: 'Positive', text: 'Definições guardadas com sucesso.' });
          void refreshAll();
        }}
      />

      <AuditLogDialog open={auditOpen} onClose={() => setAuditOpen(false)} />

      <EmailPreviewDialog email={previewEmail} onClose={() => setPreviewEmail(null)} />

      <Dialog
        open={Boolean(retryTarget)}
        headerText={`Enviar Email — Fatura #${retryTarget?.invoiceDocNum ?? ''}`}
        onClose={() => setRetryTarget(null)}
        footer={
          <Bar
            endContent={
              <>
                <Button design="Transparent" onClick={() => setRetryTarget(null)}>
                  Cancelar
                </Button>
                <Button
                  design="Emphasized"
                  disabled={!retryEmailInput.includes('@') || busyAction}
                  onClick={() => void handleConfirmRetryEmail()}
                >
                  Enviar Agora
                </Button>
              </>
            }
          />
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', minWidth: '340px' }}>
          <Text>
            Cliente: <strong>{retryTarget?.cardName}</strong>
          </Text>
          <div>
            <Label>Endereço de Email do Destinatário</Label>
            <Input
              type="Email"
              value={retryEmailInput}
              placeholder="faturacao@cliente.pt"
              style={{ width: '100%' }}
              onInput={(e) => setRetryEmailInput(e.target.value)}
            />
          </div>
        </div>
      </Dialog>
    </div>
  );
}
