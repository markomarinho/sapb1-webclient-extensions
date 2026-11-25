import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  evaluateDeliveryNoteChecks,
  getDeliveryEmailOptions,
  resolveRecipientSelection,
  type AutomationSettings,
  type ConversionItemStatus,
  type ConversionRecord,
  type CustomerEmailOption,
  type DashboardSummary,
  type GroupingMode,
  type OpenDeliveryNote,
  type RecipientSelection,
  type SentEmailPreview,
} from '@b1-d2i/shared';
import {
  Bar,
  BusyIndicator,
  Button,
  CheckBox,
  Dialog,
  Input,
  Label,
  MessageStrip,
  ObjectStatus,
  Option,
  Select,
  Tag,
  Text,
} from '@ui5/webcomponents-react';
import { api, formatMoney } from './api';
import { AuditLogDialog } from './components/AuditLogDialog';
import { DeliveryDetailsDialog } from './components/DeliveryDetailsDialog';
import { EmailPreviewDialog } from './components/EmailPreviewDialog';
import { SettingsDialog } from './components/SettingsDialog';

type ActiveSectionTab = 'DELIVERIES' | 'VALIDATION' | 'HISTORY';

function statusBadge(
  status: ConversionItemStatus
): { text: string; state: 'Positive' | 'Critical' | 'Negative' | 'Information' } {
  switch (status) {
    case 'INVOICED_AND_EMAILED':
      return { text: 'Faturada e Enviada', state: 'Positive' };
    case 'INVOICED_ONLY':
      return { text: 'Apenas Faturada', state: 'Information' };
    case 'INVOICED_NO_EMAIL':
      return { text: 'Sem E-mail', state: 'Critical' };
    case 'INVOICED_EMAIL_FAILED':
      return { text: 'Falha no E-mail', state: 'Negative' };
    case 'FAILED':
      return { text: 'Erro', state: 'Negative' };
  }
}

export function App() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [settings, setSettings] = useState<AutomationSettings | null>(null);
  const [deliveries, setDeliveries] = useState<OpenDeliveryNote[]>([]);
  const [conversions, setConversions] = useState<ConversionRecord[]>([]);
  const [emails, setEmails] = useState<SentEmailPreview[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState(false);

  const [headerExpanded, setHeaderExpanded] = useState(true);
  const [activeTab, setActiveTab] = useState<ActiveSectionTab>('DELIVERIES');

  const [selectedEntries, setSelectedEntries] = useState<Set<number>>(new Set());
  const [recipientOverrides, setRecipientOverrides] = useState<Record<string, RecipientSelection>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [onlyAutoFilter, setOnlyAutoFilter] = useState(false);
  const [validationFilter, setValidationFilter] = useState<'ALL' | 'WARNINGS' | 'OK'>('ALL');
  const [groupingMode, setGroupingMode] = useState<GroupingMode>('PER_DELIVERY');
  const [invoiceDate, setInvoiceDate] = useState<string>(new Date().toISOString().slice(0, 10));

  const [banner, setBanner] = useState<{
    design: 'Positive' | 'Negative' | 'Information';
    text: string;
  } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [previewEmail, setPreviewEmail] = useState<SentEmailPreview | null>(null);
  const [detailsDelivery, setDetailsDelivery] = useState<OpenDeliveryNote | null>(null);
  const [retryTarget, setRetryTarget] = useState<ConversionRecord | null>(null);
  const [retryEmailInput, setRetryEmailInput] = useState('');
  const [retryRecipientName, setRetryRecipientName] = useState('');
  const [retryCustomerOptions, setRetryCustomerOptions] = useState<CustomerEmailOption[]>([]);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    try {
      const [dash, delRes, convRes, emailRes, settingsRes] = await Promise.all([
        api.getDashboard(),
        api.listDeliveries(),
        api.listConversions(),
        api.listEmails(),
        api.getSettings(),
      ]);
      setSummary(dash);
      setDeliveries(delRes.deliveries);
      setConversions(convRes.conversions);
      setEmails(emailRes.emails);
      setSettings(settingsRes.settings);
      setSelectedEntries((prev) => {
        const valid = new Set(
          delRes.deliveries.filter((d) => !d.alreadyProcessed).map((d) => d.docEntry)
        );
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

  const openDeliveries = useMemo(
    () => deliveries.filter((d) => !d.alreadyProcessed),
    [deliveries]
  );

  const validationStats = useMemo(() => {
    let okCount = 0;
    let warningCount = 0;
    for (const d of openDeliveries) {
      const v = d.validation ?? evaluateDeliveryNoteChecks(d);
      if (v.passed) okCount++;
      else warningCount++;
    }
    const total = openDeliveries.length;
    const compliancePct = total > 0 ? Math.round((okCount / total) * 100) : 100;
    return { okCount, warningCount, compliancePct };
  }, [openDeliveries]);

  const filteredDeliveries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return openDeliveries.filter((d) => {
      if (onlyAutoFilter && !d.autoInvoiceEnabled) return false;
      const v = d.validation ?? evaluateDeliveryNoteChecks(d);
      if (validationFilter === 'WARNINGS' && v.passed) return false;
      if (validationFilter === 'OK' && !v.passed) return false;
      if (!q) return true;
      const emailTexts = getDeliveryEmailOptions(d)
        .map((o) => `${o.email} ${o.contactName ?? ''} ${o.emlGrpCode ?? ''}`)
        .join(' ')
        .toLowerCase();
      return (
        String(d.docNum).includes(q) ||
        d.cardCode.toLowerCase().includes(q) ||
        d.cardName.toLowerCase().includes(q) ||
        emailTexts.includes(q) ||
        (d.customerEmail || d.contactEmail || '').toLowerCase().includes(q) ||
        (d.numAtCard ?? '').toLowerCase().includes(q)
      );
    });
  }, [openDeliveries, searchQuery, onlyAutoFilter, validationFilter]);

  const allVisibleSelected =
    filteredDeliveries.length > 0 &&
    filteredDeliveries.every((d) => selectedEntries.has(d.docEntry));

  const selectedTotalAmount = useMemo(
    () =>
      openDeliveries
        .filter((d) => selectedEntries.has(d.docEntry))
        .reduce((sum, d) => sum + d.docTotal, 0),
    [openDeliveries, selectedEntries]
  );

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

  const handleSelectDeliveryRecipient = (
    delivery: OpenDeliveryNote,
    option: CustomerEmailOption
  ) => {
    const selection: RecipientSelection = {
      email: option.email,
      contactName: option.source === 'CONTACT' ? (option.contactName ?? '') : '',
      source: option.source,
    };
    setRecipientOverrides((prev) => {
      const next = { ...prev, [String(delivery.docEntry)]: selection };
      if (groupingMode === 'CONSOLIDATED_BY_CUSTOMER') {
        for (const d of deliveries) {
          if (d.cardCode === delivery.cardCode) {
            next[String(d.docEntry)] = selection;
          }
        }
        next[delivery.cardCode] = selection;
      }
      return next;
    });
  };

  const openRetryEmailDialog = async (record: ConversionRecord) => {
    setRetryTarget(record);
    setRetryEmailInput(record.recipientEmail ?? '');
    setRetryRecipientName(record.recipientName ?? '');

    const fromOpenDelivery = deliveries.find((d) => d.cardCode === record.cardCode);
    if (fromOpenDelivery) {
      const opts = getDeliveryEmailOptions(fromOpenDelivery);
      setRetryCustomerOptions(opts);
      const defaultOpt = opts.find((o) => o.isDefault) ?? opts[0];
      if (!record.recipientEmail && defaultOpt) {
        setRetryEmailInput(defaultOpt.email);
        setRetryRecipientName(
          defaultOpt.source === 'CONTACT' ? (defaultOpt.contactName ?? '') : ''
        );
      }
      return;
    }

    try {
      const res = await api.getCustomerEmails(record.cardCode);
      setRetryCustomerOptions(res.emails);
      const defaultOpt = res.emails.find((o) => o.isDefault) ?? res.emails[0];
      if (!record.recipientEmail && defaultOpt) {
        setRetryEmailInput(defaultOpt.email);
        setRetryRecipientName(
          defaultOpt.source === 'CONTACT' ? (defaultOpt.contactName ?? '') : ''
        );
      }
    } catch {
      setRetryCustomerOptions([]);
    }
  };

  const handleConvert = async (sendEmail: boolean) => {
    const ids = Array.from(selectedEntries);
    if (ids.length === 0) return;
    setBusyAction(true);
    setBanner(null);
    try {
      const activeOverrides: Record<string, RecipientSelection> = {};
      for (const id of ids) {
        const d = deliveries.find((item) => item.docEntry === id);
        const override =
          recipientOverrides[String(id)] ?? (d ? recipientOverrides[d.cardCode] : undefined);
        if (override) {
          activeOverrides[String(id)] = override;
          if (d && groupingMode === 'CONSOLIDATED_BY_CUSTOMER') {
            activeOverrides[d.cardCode] = override;
          }
        }
      }
      const res = await api.convertDeliveries({
        deliveryDocEntries: ids,
        groupingMode,
        sendEmail,
        invoiceDate: invoiceDate || undefined,
        ...(Object.keys(activeOverrides).length > 0
          ? { recipientOverrides: activeOverrides }
          : {}),
      });
      setBanner({
        design: res.failedCount > 0 ? 'Information' : 'Positive',
        text: `Processadas ${res.processedCount} guia(s): ${res.invoicesCreated} fatura(s) criada(s), ${res.emailsSent} e-mail(s) enviado(s)${
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
            : `Job automático concluído: ${res.processedCount} guia(s) -> ${res.invoicesCreated} fatura(s), ${res.emailsSent} e-mail(s) enviado(s).`,
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
      const res = await api.retryEmail(
        retryTarget.id,
        retryEmailInput.trim() || undefined,
        retryRecipientName
      );
      setBanner({
        design: res.conversion.status === 'INVOICED_AND_EMAILED' ? 'Positive' : 'Negative',
        text:
          res.conversion.status === 'INVOICED_AND_EMAILED'
            ? `E-mail da Fatura #${res.conversion.invoiceDocNum} enviado para ${res.conversion.recipientEmail}${
                res.conversion.recipientName ? ` (${res.conversion.recipientName})` : ''
              }.`
            : res.conversion.errorMessage || 'Falha ao reenviar e-mail.',
      });
      setRetryTarget(null);
      await refreshAll();
    } catch (err) {
      setBanner({
        design: 'Negative',
        text: err instanceof Error ? err.message : 'Erro ao reenviar e-mail.',
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
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: '#f5f6f7',
        color: '#1d2d3e',
        fontFamily: '"72", "72full", Arial, Helvetica, sans-serif',
        paddingBottom: '68px',
      }}
    >
      {/* SAP Fiori Horizon ObjectPage / DynamicPage Header */}
      <header
        style={{
          background: '#ffffff',
          position: 'relative',
          boxShadow: '0 1px 2px rgba(0, 0, 0, 0.04)',
        }}
      >
        {/* Top ObjectPage Title Bar */}
        <div
          style={{
            padding: '18px 36px 8px 36px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px', flexWrap: 'wrap' }}>
            <h1
              style={{
                margin: 0,
                fontSize: '21px',
                fontWeight: 700,
                color: '#1d2d3e',
                letterSpacing: '-0.2px',
              }}
            >
              Faturação automática de guias de remessa
            </h1>
            <span style={{ fontSize: '13px', color: '#556b82' }}>
              ODLN → OINV
            </span>
          </div>

          {/* Right Header Action Links (SAP Horizon style) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
            <Button
              design="Transparent"
              icon="play"
              onClick={() => void handleRunScheduledNow()}
              disabled={busyAction}
            >
              Executar job automático
            </Button>
            <Button
              design="Transparent"
              icon="action-settings"
              onClick={() => setSettingsOpen(true)}
            >
              Editar definições de automação
            </Button>
            <Button
              design="Transparent"
              icon="history"
              onClick={() => setAuditOpen(true)}
            >
              Auditoria
            </Button>
            <Button
              design="Transparent"
              icon="refresh"
              onClick={() => void refreshAll()}
              disabled={loading}
            >
              Atualizar
            </Button>
          </div>
        </div>

        {/* ObjectPage Header Facets (matches SAP B1 Web Client "Parceiro de negócios" header layout) */}
        {headerExpanded && summary && (
          <div
            style={{
              padding: '10px 36px 22px 36px',
              display: 'flex',
              flexWrap: 'wrap',
              gap: '38px',
              alignItems: 'flex-start',
            }}
          >
            <div style={fioriFacetStyle}>
              <span style={fioriFacetLabelStyle}>Informações gerais</span>
              <span style={fioriFacetValueStyle}>
                {summary.b1Mode === 'live' ? 'SAP B1 Service Layer' : 'Modo Simulação (Mock)'}
              </span>
              <span style={{ fontSize: '12px', color: '#556b82' }}>
                E-mail: {summary.emailMode.toUpperCase()} • Agendador:{' '}
                {summary.schedulerEnabled ? 'Ativo' : 'Inativo'}
              </span>
            </div>

            <div style={fioriFacetStyle}>
              <span style={fioriFacetLabelStyle}>Guias de remessa</span>
              <span style={fioriFacetValueStyle}>
                {summary.openDeliveriesCount} em aberto
              </span>
              <span style={{ fontSize: '12px', color: '#556b82' }}>
                {formatMoney(summary.openDeliveriesTotal)}
              </span>
            </div>

            <div style={fioriFacetStyle}>
              <span style={fioriFacetLabelStyle}>Elegíveis auto-fatura</span>
              <span style={{ ...fioriFacetValueStyle, color: '#0064d9' }}>
                {summary.eligibleAutoCount} guia(s)
              </span>
              <span style={{ fontSize: '12px', color: '#556b82' }}>
                Grupo e-mail: {settings?.defaultEmlGrpCode || 'Principal'}
              </span>
            </div>

            <div style={fioriFacetStyle}>
              <span style={fioriFacetLabelStyle}>Faturas emitidas hoje</span>
              <span style={{ ...fioriFacetValueStyle, color: '#256f3a' }}>
                {summary.invoicedTodayCount}
              </span>
              <span style={{ fontSize: '12px', color: '#556b82' }}>
                E-mails enviados: {summary.emailsSentCount}
              </span>
            </div>

            <div style={fioriFacetStyle}>
              <span style={fioriFacetLabelStyle}>Alertas / falhas de e-mail</span>
              <span
                style={{
                  ...fioriFacetValueStyle,
                  color: summary.emailFailedCount > 0 ? '#aa0808' : '#1d2d3e',
                }}
              >
                {summary.emailFailedCount > 0 ? `${summary.emailFailedCount} alerta(s)` : '--- ---'}
              </span>
              <span style={{ fontSize: '12px', color: '#556b82' }}>
                Margem mín.: {settings?.minimumMarginPercent ?? 30}%
              </span>
            </div>

            {/* SAP Fiori Micro-Progress Bar Facet (like "Utilização limite de crédito" in example.html) */}
            <div style={{ ...fioriFacetStyle, minWidth: '175px' }}>
              <span style={fioriFacetLabelStyle}>Conformidade preços e margens</span>
              <span style={{ fontSize: '12.5px', fontWeight: 600, color: '#1d2d3e' }}>
                {validationStats.compliancePct}% ({validationStats.okCount}/{openDeliveries.length})
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px' }}>
                <div
                  style={{
                    flex: 1,
                    height: '6px',
                    borderRadius: '4px',
                    background: '#e2ebd7',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      width: `${validationStats.compliancePct}%`,
                      height: '100%',
                      background:
                        validationStats.warningCount === 0 ? '#256f3a' : '#e76500',
                      borderRadius: '4px',
                    }}
                  />
                </div>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '16px',
                    height: '16px',
                    borderRadius: '50%',
                    background: validationStats.warningCount === 0 ? '#256f3a' : '#e76500',
                    color: '#ffffff',
                    fontSize: '10px',
                    fontWeight: 700,
                  }}
                  title={
                    validationStats.warningCount === 0
                      ? 'Todas as guias cumprem preços e margens'
                      : `${validationStats.warningCount} guia(s) com alerta de preço ou margem`
                  }
                >
                  {validationStats.warningCount === 0 ? '✓' : '!'}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Center Collapse Chevron Pill + Anchor Tab Bar (exact SAP Horizon ObjectPage AnchorBar) */}
        <div
          style={{
            position: 'relative',
            borderTop: '1px solid #eceef0',
            borderBottom: '2px solid #0032a5',
            padding: '0 36px',
            display: 'flex',
            alignItems: 'center',
            gap: '28px',
            background: '#ffffff',
          }}
        >
          {/* Floating Collapse/Expand Chevron Button in Center */}
          <button
            type="button"
            onClick={() => setHeaderExpanded((v) => !v)}
            title={headerExpanded ? 'Ocultar cabeçalho' : 'Expandir cabeçalho'}
            style={{
              position: 'absolute',
              top: '-13px',
              left: '50%',
              transform: 'translateX(-50%)',
              width: '26px',
              height: '24px',
              borderRadius: '6px',
              border: '1px solid #b8c2cc',
              background: '#ffffff',
              color: '#0064d9',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '12px',
              fontWeight: 700,
              boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
            }}
          >
            {headerExpanded ? '⌃' : '⌄'}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('DELIVERIES')}
            style={anchorTabButtonStyle(activeTab === 'DELIVERIES')}
          >
            Guias de remessa ({filteredDeliveries.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('VALIDATION')}
            style={anchorTabButtonStyle(activeTab === 'VALIDATION')}
          >
            Controlo de preços e margens ({validationStats.warningCount} alerta
            {validationStats.warningCount === 1 ? '' : 's'})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('HISTORY')}
            style={anchorTabButtonStyle(activeTab === 'HISTORY')}
          >
            Histórico e e-mails enviados ({conversions.length})
          </button>
        </div>
      </header>

      {/* Optional Notification Strip */}
      {banner && (
        <div style={{ padding: '14px 36px 0 36px' }}>
          <MessageStrip design={banner.design} onClose={() => setBanner(null)}>
            {banner.text}
          </MessageStrip>
        </div>
      )}

      {/* Main SAP Horizon ObjectPage Section Canvas */}
      <BusyIndicator active={loading || busyAction} style={{ width: '100%', flex: 1 }}>
        <main style={{ padding: '18px 36px 28px 36px' }}>
          {activeTab === 'DELIVERIES' && (
            <>
              {/* Section Heading outside white card (exact SAP Horizon pattern) */}
              <h2
                style={{
                  margin: '0 0 12px 4px',
                  fontSize: '16px',
                  fontWeight: 700,
                  color: '#1d2d3e',
                }}
              >
                Geral
              </h2>

              {/* White Rounded ObjectPage Card */}
              <div style={horizonWhiteSectionCardStyle}>
                {/* 2-Column Fiori Form Layout: Parâmetros de Faturação & Filtros */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))',
                    gap: '24px 48px',
                    paddingBottom: '20px',
                    marginBottom: '20px',
                    borderBottom: '1px solid #ebeef2',
                  }}
                >
                  {/* Left Column: Parâmetros de conversão */}
                  <div>
                    <div style={fioriSubGroupTitleStyle}>Parâmetros de faturação</div>
                    <div style={fioriFormGridStyle}>
                      <span style={fioriFormLabelStyle}>Modo de agrupamento:</span>
                      <Select
                        style={{ width: '100%' }}
                        onChange={(e) => {
                          const val = e.detail.selectedOption?.dataset.value as
                            | GroupingMode
                            | undefined;
                          if (val) setGroupingMode(val);
                        }}
                      >
                        <Option
                          data-value="PER_DELIVERY"
                          selected={groupingMode === 'PER_DELIVERY'}
                        >
                          1 fatura por guia de remessa
                        </Option>
                        <Option
                          data-value="CONSOLIDATED_BY_CUSTOMER"
                          selected={groupingMode === 'CONSOLIDATED_BY_CUSTOMER'}
                        >
                          Consolidar por parceiro de negócios
                        </Option>
                      </Select>

                      <span style={fioriFormLabelStyle}>Data do documento (OINV):</span>
                      <Input
                        type="Text"
                        placeholder="AAAA-MM-DD"
                        value={invoiceDate}
                        style={{ width: '100%' }}
                        onInput={(e) => setInvoiceDate(e.target.value)}
                      />

                      <span style={fioriFormLabelStyle}>Grupo de contacto padrão:</span>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '8px',
                        }}
                      >
                        <span style={{ fontSize: '13.5px', color: '#1d2d3e' }}>
                          {settings?.defaultEmlGrpCode
                            ? `${settings.defaultEmlGrpCode} (OCPR.EmlGrpCode)`
                            : 'Email principal (OCRD.E_Mail)'}
                        </span>
                        <button
                          type="button"
                          onClick={() => setSettingsOpen(true)}
                          style={fioriInlineLinkButtonStyle}
                        >
                          Alterar regra
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Right Column: Filtros de seleção */}
                  <div>
                    <div style={fioriSubGroupTitleStyle}>Filtros de pesquisa e validação</div>
                    <div style={fioriFormGridStyle}>
                      <span style={fioriFormLabelStyle}>Procurar guia / cliente:</span>
                      <Input
                        placeholder="Nº guia, CardCode, nome, contacto, e-mail..."
                        value={searchQuery}
                        style={{ width: '100%' }}
                        onInput={(e) => setSearchQuery(e.target.value)}
                      />

                      <span style={fioriFormLabelStyle}>Estado de validação:</span>
                      <Select
                        style={{ width: '100%' }}
                        onChange={(e) => {
                          const val = e.detail.selectedOption?.dataset.value as
                            | 'ALL'
                            | 'WARNINGS'
                            | 'OK'
                            | undefined;
                          if (val) setValidationFilter(val);
                        }}
                      >
                        <Option data-value="ALL" selected={validationFilter === 'ALL'}>
                          Todas as guias ({openDeliveries.length})
                        </Option>
                        <Option data-value="WARNINGS" selected={validationFilter === 'WARNINGS'}>
                          Com alertas de preço ou margem ({validationStats.warningCount})
                        </Option>
                        <Option data-value="OK" selected={validationFilter === 'OK'}>
                          Sem alertas — Conformes ({validationStats.okCount})
                        </Option>
                      </Select>

                      <span style={fioriFormLabelStyle}>Elegibilidade automática:</span>
                      <CheckBox
                        text="Apenas clientes com U_AutoInvoice ativo"
                        checked={onlyAutoFilter}
                        onChange={(e) => setOnlyAutoFilter(Boolean(e.target.checked))}
                      />
                    </div>
                  </div>
                </div>

                {/* Sub-section: Open Deliveries Table */}
                <div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: '12px',
                      flexWrap: 'wrap',
                      gap: '8px',
                    }}
                  >
                    <div style={{ ...fioriSubGroupTitleStyle, marginBottom: 0 }}>
                      Guias de remessa em aberto ({filteredDeliveries.length})
                    </div>
                    <div style={{ fontSize: '12.5px', color: '#556b82' }}>
                      Selecionadas: <strong>{selectedEntries.size}</strong> guia(s) • Total:{' '}
                      <strong>{formatMoney(selectedTotalAmount)}</strong>
                    </div>
                  </div>

                  {filteredDeliveries.length === 0 ? (
                    <div
                      style={{
                        padding: '36px 20px',
                        textAlign: 'center',
                        color: '#556b82',
                        background: '#fafbfc',
                        borderRadius: '8px',
                        border: '1px dashed #d9e0e6',
                      }}
                    >
                      Nenhuma guia de remessa aberta corresponde aos critérios selecionados.
                    </div>
                  ) : (
                    <div style={{ overflowX: 'auto' }}>
                      <table
                        style={{
                          width: '100%',
                          borderCollapse: 'collapse',
                          fontSize: '13.5px',
                        }}
                      >
                        <thead>
                          <tr
                            style={{
                              borderBottom: '1px solid #d9d9d9',
                              background: '#f5f6f7',
                              textAlign: 'left',
                              color: '#556b82',
                              fontSize: '12.5px',
                            }}
                          >
                            <th style={{ padding: '10px 8px', width: '36px' }}>
                              <CheckBox checked={allVisibleSelected} onChange={toggleAllVisible} />
                            </th>
                            <th style={{ padding: '10px 10px', fontWeight: 600 }}>Nº documento</th>
                            <th style={{ padding: '10px 10px', fontWeight: 600 }}>Data</th>
                            <th style={{ padding: '10px 10px', fontWeight: 600 }}>
                              Parceiro de negócios
                            </th>
                            <th style={{ padding: '10px 10px', fontWeight: 600 }}>
                              Destinatário de e-mail (Dados mestre / Contactos)
                            </th>
                            <th style={{ padding: '10px 10px', fontWeight: 600 }}>
                              Controlo de preço e margem
                            </th>
                            <th style={{ padding: '10px 10px', fontWeight: 600 }}>Auto</th>
                            <th
                              style={{
                                padding: '10px 10px',
                                fontWeight: 600,
                                textAlign: 'right',
                              }}
                            >
                              Total
                            </th>
                            <th style={{ padding: '10px 10px', fontWeight: 600 }}>Ações</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredDeliveries.map((d) => {
                            const emailOptions = getDeliveryEmailOptions(d);
                            const override =
                              recipientOverrides[String(d.docEntry)] ??
                              recipientOverrides[d.cardCode];
                            const resolved = resolveRecipientSelection(
                              d,
                              override,
                              settings?.defaultEmlGrpCode
                            );
                            const validation = d.validation ?? evaluateDeliveryNoteChecks(d);
                            const isChecked = selectedEntries.has(d.docEntry);

                            return (
                              <tr
                                key={d.docEntry}
                                style={{
                                  borderBottom: '1px solid #edf0f3',
                                  background: isChecked ? '#eef6ff' : '#ffffff',
                                }}
                              >
                                <td style={{ padding: '10px 8px' }}>
                                  <CheckBox
                                    checked={isChecked}
                                    onChange={() => toggleOne(d.docEntry)}
                                  />
                                </td>
                                <td style={{ padding: '10px 10px', whiteSpace: 'nowrap' }}>
                                  <button
                                    type="button"
                                    onClick={() => setDetailsDelivery(d)}
                                    style={{
                                      ...fioriInlineLinkButtonStyle,
                                      fontWeight: 700,
                                      fontSize: '13.5px',
                                    }}
                                  >
                                    GR {d.docNum}
                                  </button>
                                  <div style={{ fontSize: '11.5px', color: '#556b82' }}>
                                    {d.lines.length} linha(s)
                                  </div>
                                </td>
                                <td style={{ padding: '10px 10px', whiteSpace: 'nowrap' }}>
                                  <div>{d.docDate}</div>
                                  <div style={{ fontSize: '11.5px', color: '#556b82' }}>
                                    Venc.: {d.docDueDate}
                                  </div>
                                </td>
                                <td style={{ padding: '10px 10px' }}>
                                  <div style={{ fontWeight: 600, color: '#1d2d3e' }}>
                                    {d.cardName}
                                  </div>
                                  <div style={{ fontSize: '12px', color: '#556b82' }}>
                                    {d.cardCode} • NIF: {d.federalTaxId || '—'}
                                    {d.numAtCard ? ` • Ref: ${d.numAtCard}` : ''}
                                  </div>
                                </td>
                                <td style={{ padding: '10px 10px', minWidth: '295px' }}>
                                  {emailOptions.length > 0 ? (
                                    <div
                                      style={{
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: '3px',
                                      }}
                                    >
                                      <Select
                                        style={{ width: '100%' }}
                                        onChange={(e) => {
                                          const optId = e.detail.selectedOption?.dataset.id;
                                          const found = emailOptions.find((o) => o.id === optId);
                                          if (found) handleSelectDeliveryRecipient(d, found);
                                        }}
                                      >
                                        {emailOptions.map((opt) => {
                                          const isSelected =
                                            resolved.email?.toLowerCase() ===
                                              opt.email.toLowerCase() &&
                                            (opt.source === 'CONTACT'
                                              ? (resolved.contactName ?? '') ===
                                                (opt.contactName ?? '')
                                              : !resolved.contactName);
                                          return (
                                            <Option
                                              key={opt.id}
                                              data-id={opt.id}
                                              selected={isSelected}
                                            >
                                              {opt.label}
                                            </Option>
                                          );
                                        })}
                                      </Select>
                                      <div style={{ fontSize: '11.5px', color: '#556b82' }}>
                                        {resolved.contactName ? (
                                          <span>
                                            Saudação personalizada:{' '}
                                            <strong style={{ color: '#0064d9' }}>
                                              {resolved.contactName}
                                            </strong>
                                          </span>
                                        ) : (
                                          <span>Saudação geral: {d.cardName}</span>
                                        )}
                                      </div>
                                    </div>
                                  ) : resolved.email ? (
                                    <span>{resolved.email}</span>
                                  ) : (
                                    <ObjectStatus state="Critical" showDefaultIcon>
                                      Sem e-mail configurado
                                    </ObjectStatus>
                                  )}
                                </td>
                                <td style={{ padding: '10px 10px' }}>
                                  <div
                                    onClick={() => setDetailsDelivery(d)}
                                    style={{
                                      display: 'flex',
                                      flexDirection: 'column',
                                      gap: '4px',
                                      cursor: 'pointer',
                                      alignItems: 'flex-start',
                                    }}
                                    title={
                                      validation.warnings.length > 0
                                        ? validation.warnings.join('\n')
                                        : 'Clique para inspecionar preços e margens'
                                    }
                                  >
                                    {validation.passed ? (
                                      <ObjectStatus state="Positive" showDefaultIcon>
                                        Conforme (Margem mín.{' '}
                                        {validation.lowestItemMarginPercent?.toFixed(1) ?? '—'}%)
                                      </ObjectStatus>
                                    ) : (
                                      <div
                                        style={{
                                          display: 'flex',
                                          flexWrap: 'wrap',
                                          gap: '4px',
                                        }}
                                      >
                                        {validation.hasPriceWarning && (
                                          <Tag design="Critical">Preço ≠ Últ. Fatura</Tag>
                                        )}
                                        {validation.hasMarginWarning && (
                                          <Tag design="Negative">
                                            Margem{' '}
                                            {validation.lowestItemMarginPercent?.toFixed(1) ?? ''}%
                                            &lt; {validation.minMarginThreshold}%
                                          </Tag>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                </td>
                                <td style={{ padding: '10px 10px', whiteSpace: 'nowrap' }}>
                                  <Tag design={d.autoInvoiceEnabled ? 'Positive' : 'Neutral'}>
                                    {d.autoInvoiceEnabled ? 'Sim' : 'Manual'}
                                  </Tag>
                                </td>
                                <td
                                  style={{
                                    padding: '10px 10px',
                                    textAlign: 'right',
                                    fontWeight: 700,
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  {formatMoney(d.docTotal, d.docCurrency)}
                                </td>
                                <td style={{ padding: '10px 10px', whiteSpace: 'nowrap' }}>
                                  <Button
                                    design="Transparent"
                                    icon="inspect"
                                    onClick={() => setDetailsDelivery(d)}
                                  >
                                    Preços e margens
                                  </Button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {activeTab === 'VALIDATION' && (
            <>
              <h2
                style={{
                  margin: '0 0 12px 4px',
                  fontSize: '16px',
                  fontWeight: 700,
                  color: '#1d2d3e',
                }}
              >
                Controlo de preços e margens por artigo
              </h2>

              <div style={horizonWhiteSectionCardStyle}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '16px',
                    flexWrap: 'wrap',
                    gap: '12px',
                  }}
                >
                  <div>
                    <div style={{ ...fioriSubGroupTitleStyle, marginBottom: '2px' }}>
                      Regras ativas de validação comercial
                    </div>
                    <Text style={{ fontSize: '13px', color: '#556b82' }}>
                      Comparação com último preço faturado:{' '}
                      <strong>
                        {settings?.checkPriceMatchLastInvoice ?? true ? 'Ativa' : 'Inativa'}
                      </strong>{' '}
                      • Margem mínima por artigo (média para linhas repetidas):{' '}
                      <strong>
                        {settings?.checkMinimumMargin ?? true
                          ? `${settings?.minimumMarginPercent ?? 30}%`
                          : 'Inativa'}
                      </strong>
                    </Text>
                  </div>
                  <Button
                    design="Transparent"
                    icon="action-settings"
                    onClick={() => setSettingsOpen(true)}
                  >
                    Configurar regras de validação
                  </Button>
                </div>

                <div style={{ overflowX: 'auto' }}>
                  <table
                    style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13.5px' }}
                  >
                    <thead>
                      <tr
                        style={{
                          borderBottom: '1px solid #d9d9d9',
                          background: '#f5f6f7',
                          textAlign: 'left',
                          color: '#556b82',
                          fontSize: '12.5px',
                        }}
                      >
                        <th style={{ padding: '10px' }}>Guia</th>
                        <th style={{ padding: '10px' }}>Cliente</th>
                        <th style={{ padding: '10px' }}>Artigo</th>
                        <th style={{ padding: '10px' }}>Linhas / Qtd.</th>
                        <th style={{ padding: '10px', textAlign: 'right' }}>Preço médio atual</th>
                        <th style={{ padding: '10px', textAlign: 'right' }}>Últ. preço faturado</th>
                        <th style={{ padding: '10px', textAlign: 'right' }}>Custo médio</th>
                        <th style={{ padding: '10px', textAlign: 'right' }}>Margem média</th>
                        <th style={{ padding: '10px' }}>Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {openDeliveries.flatMap((d) => {
                        const v = d.validation ?? evaluateDeliveryNoteChecks(d);
                        return v.itemSummaries.map((item) => (
                          <tr
                            key={`${d.docEntry}-${item.itemCode}`}
                            style={{ borderBottom: '1px solid #edf0f3' }}
                          >
                            <td style={{ padding: '10px', whiteSpace: 'nowrap' }}>
                              <button
                                type="button"
                                onClick={() => setDetailsDelivery(d)}
                                style={{ ...fioriInlineLinkButtonStyle, fontWeight: 700 }}
                              >
                                GR {d.docNum}
                              </button>
                            </td>
                            <td style={{ padding: '10px' }}>
                              <div style={{ fontWeight: 500 }}>{d.cardName}</div>
                              <div style={{ fontSize: '11.5px', color: '#556b82' }}>
                                {d.cardCode}
                              </div>
                            </td>
                            <td style={{ padding: '10px' }}>
                              <div style={{ fontWeight: 600 }}>{item.itemCode}</div>
                              <div style={{ fontSize: '12px', color: '#556b82' }}>
                                {item.itemDescription}
                              </div>
                            </td>
                            <td style={{ padding: '10px' }}>
                              <div>{item.totalQuantity} un.</div>
                              {item.rowCount > 1 && (
                                <Tag design="Information">{item.rowCount} linhas (média)</Tag>
                              )}
                            </td>
                            <td style={{ padding: '10px', textAlign: 'right', fontWeight: 600 }}>
                              {formatMoney(item.avgUnitPrice, d.docCurrency)}
                            </td>
                            <td style={{ padding: '10px', textAlign: 'right' }}>
                              {item.lastInvoicedPrice !== null
                                ? formatMoney(item.lastInvoicedPrice, d.docCurrency)
                                : '—'}
                            </td>
                            <td style={{ padding: '10px', textAlign: 'right' }}>
                              {formatMoney(item.avgUnitCost, d.docCurrency)}
                            </td>
                            <td
                              style={{
                                padding: '10px',
                                textAlign: 'right',
                                fontWeight: 700,
                                color: item.marginMeetsMinimum ? '#256f3a' : '#aa0808',
                              }}
                            >
                              {item.avgMarginPercent.toFixed(1)}%
                            </td>
                            <td style={{ padding: '10px' }}>
                              <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                                {item.priceMatchesLastInvoice && item.marginMeetsMinimum ? (
                                  <Tag design="Positive">Conforme</Tag>
                                ) : (
                                  <>
                                    {!item.priceMatchesLastInvoice && (
                                      <Tag design="Critical">Preço diferente</Tag>
                                    )}
                                    {!item.marginMeetsMinimum && (
                                      <Tag design="Negative">
                                        Margem &lt; {v.minMarginThreshold}%
                                      </Tag>
                                    )}
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        ));
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {activeTab === 'HISTORY' && (
            <>
              <h2
                style={{
                  margin: '0 0 12px 4px',
                  fontSize: '16px',
                  fontWeight: 700,
                  color: '#1d2d3e',
                }}
              >
                Histórico de faturação e e-mails enviados
              </h2>

              <div style={horizonWhiteSectionCardStyle}>
                {conversions.length === 0 ? (
                  <div
                    style={{
                      padding: '36px 20px',
                      textAlign: 'center',
                      color: '#556b82',
                    }}
                  >
                    Ainda não existem faturas convertidas nesta sessão.
                  </div>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table
                      style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13.5px' }}
                    >
                      <thead>
                        <tr
                          style={{
                            borderBottom: '1px solid #d9d9d9',
                            background: '#f8fafc',
                            textAlign: 'left',
                            color: '#556b82',
                            fontSize: '12.5px',
                          }}
                        >
                          <th style={{ padding: '10px' }}>Data / Hora</th>
                          <th style={{ padding: '10px' }}>Origem</th>
                          <th style={{ padding: '10px' }}>Fatura (OINV)</th>
                          <th style={{ padding: '10px' }}>Guias base</th>
                          <th style={{ padding: '10px' }}>Parceiro de negócios</th>
                          <th style={{ padding: '10px' }}>Destinatário / Contacto</th>
                          <th style={{ padding: '10px', textAlign: 'right' }}>Total</th>
                          <th style={{ padding: '10px' }}>Estado</th>
                          <th style={{ padding: '10px' }}>Ações</th>
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
                            <tr key={c.id} style={{ borderBottom: '1px solid #edf0f3' }}>
                              <td style={{ padding: '10px', whiteSpace: 'nowrap' }}>
                                {new Date(c.createdAt).toLocaleString('pt-PT')}
                              </td>
                              <td style={{ padding: '10px' }}>
                                <Tag
                                  design={
                                    c.triggerSource === 'SCHEDULED' ? 'Information' : 'Neutral'
                                  }
                                >
                                  {c.triggerSource === 'SCHEDULED' ? 'Auto' : 'Manual'}
                                </Tag>
                              </td>
                              <td style={{ padding: '10px', fontWeight: 700 }}>
                                {c.invoiceDocNum ? `FT ${c.invoiceDocNum}` : '—'}
                              </td>
                              <td style={{ padding: '10px' }}>
                                {c.deliveryDocNums.map((n) => `GR ${n}`).join(', ')}
                              </td>
                              <td style={{ padding: '10px' }}>{c.cardName}</td>
                              <td style={{ padding: '10px' }}>
                                {c.recipientEmail ? (
                                  <div>
                                    {c.recipientName && (
                                      <div style={{ fontWeight: 600 }}>{c.recipientName}</div>
                                    )}
                                    <div
                                      style={{
                                        color: c.recipientName ? '#556b82' : 'inherit',
                                        fontSize: c.recipientName ? '12px' : 'inherit',
                                      }}
                                    >
                                      {c.recipientEmail}
                                    </div>
                                  </div>
                                ) : (
                                  '—'
                                )}
                              </td>
                              <td
                                style={{
                                  padding: '10px',
                                  textAlign: 'right',
                                  fontWeight: 700,
                                }}
                              >
                                {formatMoney(c.totalAmount, c.currency)}
                              </td>
                              <td style={{ padding: '10px' }}>
                                <ObjectStatus state={badge.state} showDefaultIcon>
                                  {badge.text}
                                </ObjectStatus>
                                {c.errorMessage && (
                                  <div
                                    style={{
                                      fontSize: '11.5px',
                                      color: '#aa0808',
                                      marginTop: '3px',
                                    }}
                                  >
                                    {c.errorMessage}
                                  </div>
                                )}
                              </td>
                              <td style={{ padding: '10px', whiteSpace: 'nowrap' }}>
                                <div style={{ display: 'flex', gap: '6px' }}>
                                  {sentEmail && (
                                    <Button
                                      design="Transparent"
                                      icon="show"
                                      onClick={() => setPreviewEmail(sentEmail)}
                                    >
                                      Ver e-mail
                                    </Button>
                                  )}
                                  {c.invoiceDocEntry !== null && (
                                    <Button
                                      design={canRetryEmail ? 'Default' : 'Transparent'}
                                      icon="email"
                                      onClick={() => void openRetryEmailDialog(c)}
                                    >
                                      {canRetryEmail ? 'Enviar e-mail' : 'Reenviar'}
                                    </Button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </main>
      </BusyIndicator>

      {/* SAP B1 Web Client Signature Floating Rounded Footer Bar (matches bottom bar in example.html) */}
      <footer
        style={{
          position: 'fixed',
          bottom: '10px',
          left: '16px',
          right: '16px',
          background: '#ffffff',
          border: '1px solid #d5dce3',
          borderRadius: '10px',
          padding: '8px 20px',
          boxShadow: '0 4px 16px rgba(15, 35, 55, 0.12)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          zIndex: 50,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '13px', color: '#556b82' }}>
          <span>
            Guias selecionadas: <strong style={{ color: '#1d2d3e' }}>{selectedEntries.size}</strong>
          </span>
          {selectedEntries.size > 0 && (
            <>
              <span>|</span>
              <span>
                Total a faturar:{' '}
                <strong style={{ color: '#0064d9' }}>{formatMoney(selectedTotalAmount)}</strong>
              </span>
            </>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Button
            design="Emphasized"
            icon="email"
            disabled={selectedEntries.size === 0 || busyAction}
            onClick={() => void handleConvert(true)}
          >
            Faturar e enviar e-mail ({selectedEntries.size}) | ⌄
          </Button>
          <Button
            design="Default"
            icon="document"
            disabled={selectedEntries.size === 0 || busyAction}
            onClick={() => void handleConvert(false)}
          >
            Apenas faturar
          </Button>
          <Button
            design="Transparent"
            disabled={selectedEntries.size === 0 || busyAction}
            onClick={() => setSelectedEntries(new Set())}
          >
            Cancelar
          </Button>
        </div>
      </footer>

      <SettingsDialog
        open={settingsOpen}
        initialSettings={settings}
        onClose={() => setSettingsOpen(false)}
        onSaved={() => {
          setBanner({ design: 'Positive', text: 'Definições guardadas com sucesso.' });
          void refreshAll();
        }}
      />

      <AuditLogDialog open={auditOpen} onClose={() => setAuditOpen(false)} />

      <EmailPreviewDialog email={previewEmail} onClose={() => setPreviewEmail(null)} />

      <DeliveryDetailsDialog
        delivery={detailsDelivery}
        onClose={() => setDetailsDelivery(null)}
      />

      {/* Send / Retry Email Dialog */}
      <Dialog
        open={Boolean(retryTarget)}
        headerText={`Enviar e-mail — Fatura FT ${retryTarget?.invoiceDocNum ?? ''}`}
        onClose={() => setRetryTarget(null)}
        footer={
          <Bar
            endContent={
              <>
                <Button
                  design="Emphasized"
                  disabled={!retryEmailInput.includes('@') || busyAction}
                  onClick={() => void handleConfirmRetryEmail()}
                >
                  Enviar agora
                </Button>
                <Button design="Transparent" onClick={() => setRetryTarget(null)}>
                  Cancelar
                </Button>
              </>
            }
          />
        }
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
            minWidth: '460px',
            padding: '8px 4px',
          }}
        >
          <div style={fioriFormGridStyle}>
            <span style={fioriFormLabelStyle}>Parceiro de negócios:</span>
            <span style={{ fontSize: '13.5px', fontWeight: 600 }}>
              {retryTarget?.cardName} ({retryTarget?.cardCode})
            </span>

            {retryCustomerOptions.length > 0 && (
              <>
                <span style={fioriFormLabelStyle}>Contacto / Dados mestre:</span>
                <Select
                  style={{ width: '100%' }}
                  onChange={(e) => {
                    const optId = e.detail.selectedOption?.dataset.id;
                    const found = retryCustomerOptions.find((o) => o.id === optId);
                    if (found) {
                      setRetryEmailInput(found.email);
                      setRetryRecipientName(
                        found.source === 'CONTACT' ? (found.contactName ?? '') : ''
                      );
                    }
                  }}
                >
                  {retryCustomerOptions.map((opt) => (
                    <Option
                      key={opt.id}
                      data-id={opt.id}
                      selected={
                        retryEmailInput.trim().toLowerCase() === opt.email.toLowerCase() &&
                        (opt.source === 'CONTACT'
                          ? retryRecipientName.trim() === (opt.contactName ?? '')
                          : !retryRecipientName.trim())
                      }
                    >
                      {opt.label}
                    </Option>
                  ))}
                </Select>
              </>
            )}

            <span style={fioriFormLabelStyle}>E-mail de destino:*</span>
            <Input
              type="Email"
              value={retryEmailInput}
              placeholder="faturacao@cliente.pt"
              style={{ width: '100%' }}
              onInput={(e) => {
                const nextEmail = e.target.value;
                setRetryEmailInput(nextEmail);
                const matched = retryCustomerOptions.find(
                  (o) => o.email.toLowerCase() === nextEmail.trim().toLowerCase()
                );
                if (matched) {
                  setRetryRecipientName(
                    matched.source === 'CONTACT' ? (matched.contactName ?? '') : ''
                  );
                }
              }}
            />

            <span style={fioriFormLabelStyle}>Nome do contacto:</span>
            <Input
              value={retryRecipientName}
              placeholder="Vazio para usar apenas o nome do cliente"
              style={{ width: '100%' }}
              onInput={(e) => setRetryRecipientName(e.target.value)}
            />
          </div>
        </div>
      </Dialog>
    </div>
  );
}

const fioriFacetStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '3px',
};

const fioriFacetLabelStyle: React.CSSProperties = {
  fontSize: '12px',
  color: '#556b82',
  fontWeight: 400,
};

const fioriFacetValueStyle: React.CSSProperties = {
  fontSize: '14px',
  fontWeight: 600,
  color: '#1d2d3e',
};

function anchorTabButtonStyle(active: boolean): React.CSSProperties {
  return {
    background: 'transparent',
    border: 'none',
    borderBottom: active ? '3px solid #0064d9' : '3px solid transparent',
    padding: '12px 2px 10px 2px',
    fontSize: '13.5px',
    fontWeight: 600,
    color: active ? '#0064d9' : '#1d2d3e',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  };
}

const horizonWhiteSectionCardStyle: React.CSSProperties = {
  background: '#ffffff',
  borderRadius: '12px',
  padding: '24px 32px',
  boxShadow: '0 1px 4px rgba(15, 35, 55, 0.05)',
  border: '1px solid #e6ebf0',
};

const fioriSubGroupTitleStyle: React.CSSProperties = {
  fontSize: '14px',
  fontWeight: 700,
  color: '#1d2d3e',
  marginBottom: '14px',
};

const fioriFormGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '180px 1fr',
  rowGap: '10px',
  columnGap: '16px',
  alignItems: 'center',
};

const fioriFormLabelStyle: React.CSSProperties = {
  fontSize: '13px',
  color: '#556b82',
};

const fioriInlineLinkButtonStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  padding: 0,
  color: '#0064d9',
  fontSize: '13px',
  fontWeight: 600,
  cursor: 'pointer',
  textDecoration: 'none',
};
