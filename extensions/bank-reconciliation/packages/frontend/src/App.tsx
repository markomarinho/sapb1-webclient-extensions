import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { DashboardSummary, HouseBankAccount, StagedBankLine } from '@b1-recon/shared';
import {
  Button,
  BusyIndicator,
  Input,
  MessageStrip,
  ObjectStatus,
  Option,
  Select,
  Tag,
} from '@ui5/webcomponents-react';
import { api, formatEur, isUsingNativeWebClientB1s } from './api';
import { AuditLogDialog } from './components/AuditLogDialog';
import { ConnectionSettingsDialog } from './components/ConnectionSettingsDialog';
import { GlRulesDialog } from './components/GlRulesDialog';
import { StatementUploadDialog } from './components/StatementUploadDialog';
import { SuggestionInspector } from './components/SuggestionInspector';
import { useI18n, type LocalePreference } from './i18n';

export const App: React.FC = () => {
  const { t, preference, detectedLocale, setPreference } = useI18n();
  const [houseBanks, setHouseBanks] = useState<HouseBankAccount[]>([]);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [lines, setLines] = useState<StagedBankLine[]>([]);
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);

  const [selectedBankId, setSelectedBankId] = useState<string>('ALL');
  const [statusGroup, setStatusGroup] = useState<'PENDING' | 'RECONCILED' | 'IGNORED' | 'ALL'>('PENDING');
  const [confidenceFilter, setConfidenceFilter] = useState<'ALL' | 'HIGH' | 'REVIEW' | 'NONE'>('ALL');
  const [search, setSearch] = useState<string>('');

  const [loading, setLoading] = useState<boolean>(true);
  const [batchBusy, setBatchBusy] = useState<boolean>(false);
  const [banner, setBanner] = useState<{ type: 'Positive' | 'Negative' | 'Information'; text: string } | null>(
    null
  );

  const [uploadOpen, setUploadOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [glRulesOpen, setGlRulesOpen] = useState(false);
  const [connOpen, setConnOpen] = useState(false);
  const [headerExpanded, setHeaderExpanded] = useState(true);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    try {
      const [dashRes, linesRes] = await Promise.all([
        api.getDashboard(selectedBankId),
        api.getLines({ houseBankId: selectedBankId, statusGroup, search }),
      ]);
      setHouseBanks(dashRes.houseBanks);
      setSummary(dashRes.summary);
      setLines(linesRes.lines);

      if (linesRes.lines.length > 0) {
        setSelectedLineId((prev) =>
          prev && linesRes.lines.some((l) => l.id === prev) ? prev : linesRes.lines[0].id
        );
      } else {
        setSelectedLineId(null);
      }
    } catch (err) {
      setBanner({
        type: 'Negative',
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setLoading(false);
    }
  }, [selectedBankId, statusGroup, search]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  const displayedLines = useMemo(() => {
    if (confidenceFilter === 'ALL') return lines;
    return lines.filter((l) => {
      const conf = l.suggestions?.[0]?.confidence ?? l.topConfidence ?? 0;
      if (confidenceFilter === 'HIGH') return conf >= 85;
      if (confidenceFilter === 'REVIEW') return conf >= 50 && conf < 85;
      return conf < 50;
    });
  }, [lines, confidenceFilter]);

  const autoCoveragePct = useMemo(() => {
    if (!summary) return 0;
    const total = summary.totalUnreconciled + summary.reconciledCount;
    if (total === 0) return 100;
    return Math.min(
      100,
      Math.round(((summary.reconciledCount + summary.highConfidenceReady) / total) * 100)
    );
  }, [summary]);

  const handleLoadSamples = async () => {
    setBatchBusy(true);
    setBanner(null);
    try {
      const res = await api.importSampleStatements();
      setBanner({
        type: 'Positive',
        text: `SWIFT MT940 + Norma 43: +${res.importedLinesCount} ${t.movementUnit}.`,
      });
      await refreshAll();
    } catch (err) {
      setBanner({
        type: 'Negative',
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBatchBusy(false);
    }
  };

  const handleBatchApprove = async () => {
    setBatchBusy(true);
    setBanner(null);
    try {
      const res = await api.batchApprove(88, selectedBankId);
      setBanner({
        type: res.errors.length > 0 ? 'Information' : 'Positive',
        text: `${res.reconciledCount} ${t.movementUnit} -> SAP Business One.`,
      });
      await refreshAll();
    } catch (err) {
      setBanner({
        type: 'Negative',
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBatchBusy(false);
    }
  };

  const selectedLine =
    displayedLines.find((l) => l.id === selectedLineId) ??
    lines.find((l) => l.id === selectedLineId) ??
    null;

  const handleExportCsv = () => {
    const header = [
      'Linha',
      'Banco',
      'Conta_GL',
      'Data_Lancamento',
      'Data_Valor',
      'Sentido',
      'Montante_EUR',
      'Estado',
      'Confianca_HANA',
      'Parceiro_ou_Conta_Sugerida',
      'Descricao',
    ];
    const rows = [
      header.join(';'),
      ...displayedLines.map((l) =>
        [
          l.lineNumber,
          l.bankCode,
          l.glAccountCode,
          l.bookingDate,
          l.valueDate,
          l.direction,
          l.signedAmount.toFixed(2).replace('.', ','),
          l.status,
          `${l.topConfidence}%`,
          `"${(l.suggestions?.[0]?.journalLine?.cardName ?? l.suggestions?.[0]?.cardName ?? '').replace(
            /"/g,
            '""'
          )}"`,
          `"${l.description.replace(/"/g, '""')}"`,
        ].join(';')
      ),
    ];
    const blob = new Blob(['\uFEFF' + rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Extrato_Reconciliacao_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

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
      {/* SAP Fiori Horizon ObjectPage Header */}
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
              {t.appTitle}
            </h1>
            <span style={{ fontSize: '13px', color: '#556b82' }}>{t.appSubtitle}</span>
            {summary && (
              <Tag
                design={summary.mode === 'live' ? 'Positive' : 'Set2'}
                colorScheme={summary.mode === 'live' ? '8' : '6'}
                hideStateIcon
              >
                {isUsingNativeWebClientB1s()
                  ? t.connectedB1
                  : summary.mode === 'live'
                    ? t.sapHanaLive
                    : t.localSimulation}
              </Tag>
            )}
          </div>

          {/* Right Header Action Links (SAP Horizon style) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <Button design="Transparent" onClick={() => setUploadOpen(true)}>
              {t.importStatementBtn}
            </Button>
            <Button
              design="Transparent"
              onClick={() => void handleLoadSamples()}
              disabled={batchBusy}
            >
              {t.loadSampleBtn}
            </Button>
            <Button design="Transparent" onClick={() => setGlRulesOpen(true)}>
              {t.glRulesBtn}
            </Button>
            <Button design="Transparent" onClick={() => setAuditOpen(true)}>
              {t.auditLogBtn}
            </Button>
            <Button design="Transparent" onClick={() => setConnOpen(true)}>
              {isUsingNativeWebClientB1s() ? t.diagnosticsBtn : t.editConnectionBtn}
            </Button>
            <Button
              design="Transparent"
              onClick={() => void refreshAll()}
              disabled={loading}
            >
              {t.refreshBtn}
            </Button>
            <Select
              style={{ width: '165px' }}
              onChange={(e) => {
                const val = e.detail.selectedOption?.getAttribute('data-lang') as
                  | LocalePreference
                  | undefined;
                if (val) setPreference(val);
              }}
            >
              <Option data-lang="auto" selected={preference === 'auto'}>
                {t.langAutoPrefix}: {detectedLocale.toUpperCase()})
              </Option>
              <Option data-lang="pt" selected={preference === 'pt'}>
                Português (PT)
              </Option>
              <Option data-lang="en" selected={preference === 'en'}>
                English (EN)
              </Option>
              <Option data-lang="es" selected={preference === 'es'}>
                Español (ES)
              </Option>
              <Option data-lang="de" selected={preference === 'de'}>
                Deutsch (DE)
              </Option>
            </Select>
          </div>
        </div>

        {/* ObjectPage Header Facets */}
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
              <span style={fioriFacetLabelStyle}>{t.facetOpenMovements}</span>
              <span style={fioriFacetValueStyle}>
                {summary.totalUnreconciled} {t.movementUnit}
              </span>
              <span style={{ fontSize: '12px', color: '#556b82' }}>
                {t.reconciledShort}: {summary.reconciledCount}
              </span>
            </div>

            <div style={fioriFacetStyle}>
              <span style={fioriFacetLabelStyle}>{t.facetAutoReady}</span>
              <span style={{ ...fioriFacetValueStyle, color: '#107e3e' }}>
                {summary.highConfidenceReady} {t.movementUnit}
              </span>
              <span style={{ fontSize: '12px', color: '#556b82' }}>
                {t.manualReviewShort}: {summary.needsReview}
              </span>
            </div>

            <div style={fioriFacetStyle}>
              <span style={fioriFacetLabelStyle}>{t.facetPendingInflow}</span>
              <span style={{ ...fioriFacetValueStyle, color: '#107e3e' }}>
                +{formatEur(summary.unreconciledInflowEur)}
              </span>
              <span style={{ fontSize: '12px', color: '#556b82' }}>{t.bankCreditsSub}</span>
            </div>

            <div style={fioriFacetStyle}>
              <span style={fioriFacetLabelStyle}>{t.facetPendingOutflow}</span>
              <span style={{ ...fioriFacetValueStyle, color: '#bb0000' }}>
                -{formatEur(summary.unreconciledOutflowEur)}
              </span>
              <span style={{ fontSize: '12px', color: '#556b82' }}>{t.bankDebitsSub}</span>
            </div>

            {/* SAP Fiori Micro-Progress Bar Facet */}
            <div style={{ ...fioriFacetStyle, minWidth: '185px' }}>
              <span style={fioriFacetLabelStyle}>{t.facetReconCoverage}</span>
              <span style={{ fontSize: '12.5px', fontWeight: 600, color: '#1d2d3e' }}>
                {autoCoveragePct}%
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
                      width: `${autoCoveragePct}%`,
                      height: '100%',
                      background: autoCoveragePct >= 70 ? '#256f3a' : '#e76500',
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
                    background: autoCoveragePct >= 70 ? '#256f3a' : '#e76500',
                    color: '#ffffff',
                    fontSize: '10px',
                    fontWeight: 700,
                  }}
                >
                  {autoCoveragePct >= 70 ? '✓' : '!'}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Center Collapse Chevron Divider Bar */}
        <div
          style={{
            position: 'relative',
            height: '16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#ffffff',
            overflow: 'visible',
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: '50%',
              borderTop: '1px solid #e5e8eb',
            }}
          />
          <button
            type="button"
            onClick={() => setHeaderExpanded((v) => !v)}
            title={headerExpanded ? t.headerCollapse : t.headerExpand}
            style={{
              position: 'relative',
              zIndex: 2,
              width: '28px',
              height: '22px',
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
              lineHeight: 1,
              boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
            }}
          >
            {headerExpanded ? '⌃' : '⌄'}
          </button>
        </div>

        {/* Anchor Tab Bar */}
        <div
          style={{
            borderBottom: '2px solid #0032a5',
            padding: '2px 36px 0 36px',
            display: 'flex',
            alignItems: 'center',
            gap: '28px',
            background: '#ffffff',
            overflowX: 'auto',
          }}
        >
          <button
            type="button"
            onClick={() => {
              setStatusGroup('PENDING');
              setConfidenceFilter('ALL');
            }}
            style={anchorTabButtonStyle(statusGroup === 'PENDING' && confidenceFilter === 'ALL')}
          >
            {t.tabPending} ({summary?.totalUnreconciled ?? 0})
          </button>
          <button
            type="button"
            onClick={() => {
              setStatusGroup('PENDING');
              setConfidenceFilter('HIGH');
            }}
            style={anchorTabButtonStyle(statusGroup === 'PENDING' && confidenceFilter === 'HIGH')}
          >
            {t.tabAutoReady} ({summary?.highConfidenceReady ?? 0})
          </button>
          <button
            type="button"
            onClick={() => {
              setStatusGroup('PENDING');
              setConfidenceFilter('REVIEW');
            }}
            style={anchorTabButtonStyle(statusGroup === 'PENDING' && confidenceFilter === 'REVIEW')}
          >
            {t.tabReview} ({summary?.needsReview ?? 0})
          </button>
          <button
            type="button"
            onClick={() => {
              setStatusGroup('RECONCILED');
              setConfidenceFilter('ALL');
            }}
            style={anchorTabButtonStyle(statusGroup === 'RECONCILED')}
          >
            {t.tabReconciled} ({summary?.reconciledCount ?? 0})
          </button>
          <button
            type="button"
            onClick={() => {
              setStatusGroup('IGNORED');
              setConfidenceFilter('ALL');
            }}
            style={anchorTabButtonStyle(statusGroup === 'IGNORED')}
          >
            {t.tabIgnored}
          </button>
          <button
            type="button"
            onClick={() => {
              setStatusGroup('ALL');
              setConfidenceFilter('ALL');
            }}
            style={anchorTabButtonStyle(statusGroup === 'ALL')}
          >
            {t.tabAll}
          </button>
        </div>
      </header>

      {banner && (
        <div style={{ padding: '14px 36px 0 36px' }}>
          <MessageStrip design={banner.type} onClose={() => setBanner(null)}>
            {banner.text}
          </MessageStrip>
        </div>
      )}

      {/* Main SAP Horizon ObjectPage Section Canvas */}
      <main style={{ flex: 1, padding: '18px 36px 28px 36px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div>
          <h2
            style={{
              margin: '0 0 12px 4px',
              fontSize: '16px',
              fontWeight: 700,
              color: '#1d2d3e',
            }}
          >
            {t.sectionGeneral}
          </h2>

          {/* Top White Rounded Filter & Selection Card (2-column SAP Horizon Form Grid) */}
          <div style={horizonWhiteSectionCardStyle}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
                gap: '20px 48px',
              }}
            >
              <div>
                <div style={fioriSubGroupTitleStyle}>{t.subBankAndState}</div>
                <div style={fioriFormGridStyle}>
                  <span style={fioriFormLabelStyle}>{t.houseBankLabel}</span>
                  <Select
                    style={{ width: '100%' }}
                    onChange={(e) => {
                      const bankId = e.detail.selectedOption?.getAttribute('data-bank-id');
                      if (bankId) setSelectedBankId(bankId);
                    }}
                  >
                    <Option data-bank-id="ALL" selected={selectedBankId === 'ALL'}>
                      {t.allAccountsOption} ({houseBanks.length})
                    </Option>
                    {houseBanks.map((hb) => (
                      <Option key={hb.id} data-bank-id={hb.id} selected={selectedBankId === hb.id}>
                        {hb.bankCode} — {hb.accountLabel} (G/L {hb.glAccountCode})
                      </Option>
                    ))}
                  </Select>

                  <span style={fioriFormLabelStyle}>{t.movementStateLabel}</span>
                  <Select
                    style={{ width: '100%' }}
                    onChange={(e) => {
                      const st = e.detail.selectedOption?.getAttribute('data-status') as
                        | 'PENDING'
                        | 'RECONCILED'
                        | 'IGNORED'
                        | 'ALL'
                        | undefined;
                      if (st) setStatusGroup(st);
                    }}
                  >
                    <Option data-status="PENDING" selected={statusGroup === 'PENDING'}>
                      {t.tabPending}
                    </Option>
                    <Option data-status="RECONCILED" selected={statusGroup === 'RECONCILED'}>
                      {t.tabReconciled}
                    </Option>
                    <Option data-status="IGNORED" selected={statusGroup === 'IGNORED'}>
                      {t.tabIgnored}
                    </Option>
                    <Option data-status="ALL" selected={statusGroup === 'ALL'}>
                      {t.confAll}
                    </Option>
                  </Select>
                </div>
              </div>

              <div>
                <div style={fioriSubGroupTitleStyle}>{t.subSearchAndMatch}</div>
                <div style={fioriFormGridStyle}>
                  <span style={fioriFormLabelStyle}>{t.searchMovementLabel}</span>
                  <Input
                    placeholder={t.searchPlaceholder}
                    value={search}
                    style={{ width: '100%' }}
                    onInput={(e) => setSearch((e.target as unknown as { value: string }).value)}
                  />

                  <span style={fioriFormLabelStyle}>{t.confidenceLevelLabel}</span>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <Select
                      style={{ flex: 1 }}
                      onChange={(e) => {
                        const cf = e.detail.selectedOption?.getAttribute('data-conf') as
                          | 'ALL'
                          | 'HIGH'
                          | 'REVIEW'
                          | 'NONE'
                          | undefined;
                        if (cf) setConfidenceFilter(cf);
                      }}
                    >
                      <Option data-conf="ALL" selected={confidenceFilter === 'ALL'}>
                        {t.confAll}
                      </Option>
                      <Option data-conf="HIGH" selected={confidenceFilter === 'HIGH'}>
                        {t.confHigh}
                      </Option>
                      <Option data-conf="REVIEW" selected={confidenceFilter === 'REVIEW'}>
                        {t.confReview}
                      </Option>
                      <Option data-conf="NONE" selected={confidenceFilter === 'NONE'}>
                        {t.confNone}
                      </Option>
                    </Select>
                    {(search ||
                      selectedBankId !== 'ALL' ||
                      statusGroup !== 'PENDING' ||
                      confidenceFilter !== 'ALL') && (
                      <Button
                        design="Transparent"
                        onClick={() => {
                          setSearch('');
                          setSelectedBankId('ALL');
                          setStatusGroup('PENDING');
                          setConfidenceFilter('ALL');
                        }}
                      >
                        {t.resetBtn}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* FlexibleColumnLayout Split Workspace: Statement Lines Table + ObjectPage Detail Inspector */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: selectedLine ? '1.08fr 1fr' : '1fr',
            gap: '16px',
            alignItems: 'start',
          }}
        >
          {/* Left Column: Statement Lines Table in White Rounded Section Card */}
          <section
            style={{
              background: '#ffffff',
              border: '1px solid #e6ebf0',
              borderRadius: '12px',
              overflow: 'hidden',
              boxShadow: '0 1px 4px rgba(15, 35, 55, 0.05)',
            }}
          >
            <div
              style={{
                padding: '14px 22px',
                borderBottom: '1px solid #ebeef2',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                background: '#ffffff',
              }}
            >
              <div style={{ fontSize: '14px', fontWeight: 700, color: '#1d2d3e' }}>
                {t.statementLinesTitle} ({displayedLines.length})
              </div>
              <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                <Button design="Transparent" onClick={() => setUploadOpen(true)}>
                  {t.importFileBtn}
                </Button>
                <Button
                  design="Transparent"
                  disabled={displayedLines.length === 0}
                  onClick={handleExportCsv}
                >
                  {t.exportCsvBtn}
                </Button>
              </div>
            </div>

            {loading ? (
              <div style={{ padding: '48px', textAlign: 'center' }}>
                <BusyIndicator active size="M" />
              </div>
            ) : displayedLines.length === 0 ? (
              <div style={{ padding: '44px 24px', textAlign: 'center', color: '#556b82' }}>
                <div
                  style={{
                    fontSize: '15px',
                    fontWeight: 600,
                    marginBottom: '6px',
                    color: '#1d2d3e',
                  }}
                >
                  {t.noMovementsTitle}
                </div>
                <div style={{ fontSize: '13px', marginBottom: '16px' }}>{t.noMovementsDesc}</div>
                <div style={{ display: 'flex', justifyContent: 'center', gap: '8px' }}>
                  <Button design="Emphasized" onClick={() => setUploadOpen(true)}>
                    {t.importStatementBtn}
                  </Button>
                  <Button design="Default" onClick={() => void handleLoadSamples()}>
                    {t.loadSampleBtn}
                  </Button>
                </div>
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <thead>
                    <tr
                      style={{
                        background: '#f5f6f7',
                        borderBottom: '1px solid #d9d9d9',
                        textAlign: 'left',
                        color: '#556b82',
                        fontSize: '12px',
                      }}
                    >
                      <th style={{ padding: '10px 14px', fontWeight: 600 }}>{t.colDate}</th>
                      <th style={{ padding: '10px 10px', fontWeight: 600 }}>{t.colAccount}</th>
                      <th style={{ padding: '10px 12px', fontWeight: 600 }}>
                        {t.colDescAndPartner}
                      </th>
                      <th style={{ padding: '10px 12px', fontWeight: 600, textAlign: 'right' }}>
                        {t.colAmount}
                      </th>
                      <th style={{ padding: '10px 12px', fontWeight: 600 }}>
                        {t.colStateSuggestion}
                      </th>
                      <th style={{ padding: '10px 8px', width: '18px' }} />
                    </tr>
                  </thead>
                  <tbody>
                    {displayedLines.map((l) => {
                      const isSelected = l.id === selectedLineId;
                      const topSug = l.suggestions?.[0];
                      const partnerLabel = topSug
                        ? `${topSug.cardCode ? `${topSug.cardCode} — ` : ''}${
                            topSug.journalLine?.cardName || topSug.cardName || ''
                          }`
                        : '';
                      return (
                        <tr
                          key={l.id}
                          onClick={() => setSelectedLineId(l.id)}
                          style={{
                            cursor: 'pointer',
                            borderBottom: '1px solid #edf0f3',
                            background: isSelected ? '#eef6ff' : '#ffffff',
                            borderLeft: isSelected
                              ? '3px solid #0064d9'
                              : '3px solid transparent',
                          }}
                        >
                          <td
                            style={{
                              padding: '10px 14px',
                              whiteSpace: 'nowrap',
                              verticalAlign: 'middle',
                            }}
                          >
                            <div style={{ fontWeight: 600, color: '#1d2d3e' }}>{l.bookingDate}</div>
                            <div style={{ fontSize: '11px', color: '#6a6d70' }}>#{l.lineNumber}</div>
                          </td>
                          <td
                            style={{
                              padding: '10px 10px',
                              whiteSpace: 'nowrap',
                              verticalAlign: 'middle',
                            }}
                          >
                            <div style={{ fontWeight: 600, color: '#1d2d3e' }}>{l.bankCode}</div>
                            <div style={{ fontSize: '11px', color: '#6a6d70' }}>
                              G/L {l.glAccountCode}
                            </div>
                          </td>
                          <td style={{ padding: '10px 12px', verticalAlign: 'middle' }}>
                            <div
                              style={{
                                fontWeight: 500,
                                color: '#1d2d3e',
                                maxWidth: '330px',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                              title={l.description}
                            >
                              {l.description}
                            </div>
                            <div
                              style={{
                                fontSize: '11.5px',
                                color: topSug ? '#0064d9' : '#6a6d70',
                                maxWidth: '330px',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {partnerLabel || `Ref: ${l.bankReference || '—'}`}
                            </div>
                          </td>
                          <td
                            style={{
                              padding: '10px 12px',
                              textAlign: 'right',
                              fontWeight: 700,
                              whiteSpace: 'nowrap',
                              verticalAlign: 'middle',
                              color: l.direction === 'CREDIT' ? '#107e3e' : '#bb0000',
                            }}
                          >
                            {l.direction === 'CREDIT' ? '+' : '-'}
                            {formatEur(l.amount)}
                          </td>
                          <td
                            style={{
                              padding: '10px 12px',
                              whiteSpace: 'nowrap',
                              verticalAlign: 'middle',
                            }}
                          >
                            {l.status === 'RECONCILED' ? (
                              <ObjectStatus state="Positive" showDefaultIcon>
                                {t.statusReconciled}
                              </ObjectStatus>
                            ) : l.status === 'ERROR' ? (
                              <ObjectStatus state="Negative" showDefaultIcon>
                                {t.statusError}
                              </ObjectStatus>
                            ) : l.status === 'IGNORED' ? (
                              <ObjectStatus state="None">{t.statusIgnored}</ObjectStatus>
                            ) : topSug ? (
                              <ObjectStatus
                                state={
                                  topSug.confidence >= 85
                                    ? 'Positive'
                                    : topSug.confidence >= 70
                                      ? 'Critical'
                                      : 'Information'
                                }
                                showDefaultIcon
                              >
                                {topSug.confidence}% (
                                {topSug.tier === 'HIGH' ? t.tierAuto : t.tierReview})
                              </ObjectStatus>
                            ) : (
                              <ObjectStatus state="None">{t.statusManual}</ObjectStatus>
                            )}
                          </td>
                          <td
                            style={{
                              padding: '10px 10px 10px 0',
                              color: '#6a6d70',
                              fontSize: '16px',
                              textAlign: 'right',
                              verticalAlign: 'middle',
                            }}
                          >
                            ›
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Right Column: SAP B1 Web Client Object Page Detail Inspector */}
          {selectedLine && (
            <SuggestionInspector
              line={selectedLine}
              onActionSuccess={(msg) => {
                setBanner({ type: 'Positive', text: msg });
                void refreshAll();
              }}
            />
          )}
        </div>
      </main>

      {/* SAP B1 Web Client Signature Floating Rounded Footer Bar */}
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
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            fontSize: '13px',
            color: '#556b82',
          }}
        >
          <span>
            {t.openFooterLabel}:{' '}
            <strong style={{ color: '#1d2d3e' }}>{summary?.totalUnreconciled ?? 0}</strong>
          </span>
          <span>|</span>
          <span>
            {t.autoReadyFooterLabel}:{' '}
            <strong style={{ color: '#107e3e' }}>{summary?.highConfidenceReady ?? 0}</strong>
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Button
            design="Emphasized"
            disabled={batchBusy || !summary || summary.highConfidenceReady === 0}
            onClick={() => void handleBatchApprove()}
          >
            {t.reconcileAutoBtn} ({summary?.highConfidenceReady ?? 0}) | ⌄
          </Button>
          <Button design="Default" onClick={() => setUploadOpen(true)}>
            {t.importStatementBtn}
          </Button>
          <Button
            design="Transparent"
            disabled={displayedLines.length === 0}
            onClick={handleExportCsv}
          >
            {t.exportCsvBtn}
          </Button>
        </div>
      </footer>

      <StatementUploadDialog
        open={uploadOpen}
        houseBanks={houseBanks}
        onClose={() => setUploadOpen(false)}
        onImported={(msg) => {
          setBanner({ type: 'Positive', text: msg });
          void refreshAll();
        }}
      />

      <AuditLogDialog open={auditOpen} onClose={() => setAuditOpen(false)} />

      <GlRulesDialog
        open={glRulesOpen}
        onClose={() => setGlRulesOpen(false)}
        onUpdated={() => void refreshAll()}
      />

      <ConnectionSettingsDialog
        open={connOpen}
        onClose={() => setConnOpen(false)}
        onSaved={() => {
          setBanner({
            type: 'Positive',
            text: 'SAP HANA & Service Layer configuration updated.',
          });
          void refreshAll();
        }}
      />
    </div>
  );
};

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
  padding: '20px 28px',
  boxShadow: '0 1px 4px rgba(15, 35, 55, 0.05)',
  border: '1px solid #e6ebf0',
};

const fioriSubGroupTitleStyle: React.CSSProperties = {
  fontSize: '14px',
  fontWeight: 700,
  color: '#1d2d3e',
  marginBottom: '12px',
};

const fioriFormGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '165px 1fr',
  rowGap: '10px',
  columnGap: '14px',
  alignItems: 'center',
};

const fioriFormLabelStyle: React.CSSProperties = {
  fontSize: '13px',
  color: '#556b82',
};
