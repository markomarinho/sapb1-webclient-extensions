import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { DashboardSummary, HouseBankAccount, StagedBankLine } from '@b1-recon/shared';
import {
  Button,
  BusyIndicator,
  Input,
  Label,
  MessageStrip,
  ObjectStatus,
  Option,
  Select,
  Tag,
  Title,
} from '@ui5/webcomponents-react';
import { api, formatEur, isUsingNativeWebClientB1s } from './api';
import { AuditLogDialog } from './components/AuditLogDialog';
import { ConnectionSettingsDialog } from './components/ConnectionSettingsDialog';
import { GlRulesDialog } from './components/GlRulesDialog';
import { StatementUploadDialog } from './components/StatementUploadDialog';
import { SuggestionInspector } from './components/SuggestionInspector';

export const App: React.FC = () => {
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

  const handleLoadSamples = async () => {
    setBatchBusy(true);
    setBanner(null);
    try {
      const res = await api.importSampleStatements();
      setBanner({
        type: 'Positive',
        text: `Extratos de demonstração (SWIFT MT940 + Norma 43) carregados: ${res.importedLinesCount} movimentos novos.`,
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
        text: `Reconciliação em lote concluída: ${res.reconciledCount} movimento(s) lançado(s) e reconciliado(s) no SAP Business One.`,
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
      }}
    >
      {/* SAP Business One Web Client DynamicPage Header */}
      <header
        style={{
          background: '#ffffff',
          borderBottom: '1px solid #d9d9d9',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
        }}
      >
        {/* DynamicPage Title Bar */}
        <div
          style={{
            padding: '12px 24px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '12px',
            borderBottom: headerExpanded ? '1px solid #ededed' : 'none',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Title level="H4" style={{ margin: 0 }}>
              Processar Extratos Bancários Externos
            </Title>
            <span style={{ color: '#d9d9d9' }}>|</span>
            <span style={{ fontSize: '13px', color: '#556b82', fontWeight: 500 }}>Vista Padrão</span>
            {summary && (
              <Tag
                design={summary.mode === 'live' ? 'Positive' : 'Set2'}
                colorScheme={summary.mode === 'live' ? '8' : '6'}
                hideStateIcon
              >
                {isUsingNativeWebClientB1s()
                  ? 'Ligado ao SAP B1'
                  : summary.mode === 'live'
                    ? 'SAP HANA Live'
                    : 'Simulação Local'}
              </Tag>
            )}
          </div>

          {/* Native SAP B1 Web Client Header Action Toolbar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <Button design="Emphasized" onClick={() => setUploadOpen(true)}>
              Importar Extrato
            </Button>
            <Button
              design="Default"
              disabled={batchBusy || !summary || summary.highConfidenceReady === 0}
              onClick={() => void handleBatchApprove()}
            >
              Reconciliar Automáticos ({summary?.highConfidenceReady ?? 0})
            </Button>
            <Button design="Transparent" onClick={() => setGlRulesOpen(true)}>
              Regras de Contabilização G/L
            </Button>
            <Button design="Transparent" onClick={() => void handleLoadSamples()} disabled={batchBusy}>
              Carregar Demonstração
            </Button>
            <Button design="Transparent" onClick={() => setAuditOpen(true)}>
              Registo de Auditoria
            </Button>
            <Button design="Transparent" onClick={() => setConnOpen(true)}>
              {isUsingNativeWebClientB1s() ? 'Diagnóstico' : 'Ligação'}
            </Button>
            <Button design="Transparent" onClick={() => setHeaderExpanded((v) => !v)}>
              {headerExpanded ? 'Ocultar Cabeçalho ▲' : 'Mostrar Cabeçalho ▼'}
            </Button>
          </div>
        </div>

        {/* DynamicPage Expandable FilterBar & Analytical Facets */}
        {headerExpanded && (
          <div style={{ padding: '14px 24px 16px 24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* SAP B1 Web Client Standard FilterBar */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr)) auto',
                gap: '12px',
                alignItems: 'end',
              }}
            >
              <div>
                <Label style={filterLabelStyle}>Pesquisar</Label>
                <Input
                  placeholder="Descrição, NIF, IBAN, Multibanco, Nº Doc, Valor..."
                  value={search}
                  style={{ width: '100%' }}
                  onInput={(e) => setSearch((e.target as unknown as { value: string }).value)}
                />
              </div>

              <div>
                <Label style={filterLabelStyle}>Conta do Banco da Empresa:</Label>
                <Select
                  style={{ width: '100%' }}
                  onChange={(e) => {
                    const bankId = e.detail.selectedOption?.getAttribute('data-bank-id');
                    if (bankId) setSelectedBankId(bankId);
                  }}
                >
                  <Option data-bank-id="ALL" selected={selectedBankId === 'ALL'}>
                    Todas ({houseBanks.length})
                  </Option>
                  {houseBanks.map((hb) => (
                    <Option key={hb.id} data-bank-id={hb.id} selected={selectedBankId === hb.id}>
                      {hb.bankCode} — {hb.accountLabel} (G/L {hb.glAccountCode})
                    </Option>
                  ))}
                </Select>
              </div>

              <div>
                <Label style={filterLabelStyle}>Estado do Movimento:</Label>
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
                    Em Aberto / Por Reconciliar
                  </Option>
                  <Option data-status="RECONCILED" selected={statusGroup === 'RECONCILED'}>
                    Reconciliados
                  </Option>
                  <Option data-status="IGNORED" selected={statusGroup === 'IGNORED'}>
                    Ignorados
                  </Option>
                  <Option data-status="ALL" selected={statusGroup === 'ALL'}>
                    Todos
                  </Option>
                </Select>
              </div>

              <div>
                <Label style={filterLabelStyle}>Nível de Confiança:</Label>
                <Select
                  style={{ width: '100%' }}
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
                    Todos
                  </Option>
                  <Option data-conf="HIGH" selected={confidenceFilter === 'HIGH'}>
                    Automático / Elevada (≥85%)
                  </Option>
                  <Option data-conf="REVIEW" selected={confidenceFilter === 'REVIEW'}>
                    Revisão Recomendada (50%–84%)
                  </Option>
                  <Option data-conf="NONE" selected={confidenceFilter === 'NONE'}>
                    Sem Correspondência Direta
                  </Option>
                </Select>
              </div>

              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <Button design="Emphasized" onClick={() => void refreshAll()} disabled={loading}>
                  Ir
                </Button>
                {(search || selectedBankId !== 'ALL' || statusGroup !== 'PENDING' || confidenceFilter !== 'ALL') && (
                  <Button
                    design="Transparent"
                    onClick={() => {
                      setSearch('');
                      setSelectedBankId('ALL');
                      setStatusGroup('PENDING');
                      setConfidenceFilter('ALL');
                    }}
                  >
                    Repor Filtros
                  </Button>
                )}
              </div>
            </div>

            {/* SAP Fiori Object Header Facets (KPIs) */}
            {summary && (
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '24px',
                  paddingTop: '10px',
                  borderTop: '1px solid #f0f0f0',
                }}
              >
                <div style={facetItemStyle}>
                  <span style={facetLabelStyle}>Movimentos em Aberto</span>
                  <span style={{ fontSize: '18px', fontWeight: 700, color: '#1d2d3e' }}>
                    {summary.totalUnreconciled}
                  </span>
                </div>
                <div style={facetDividerStyle}>
                  <span style={facetLabelStyle}>Prontos p/ Automático (≥85%)</span>
                  <span style={{ fontSize: '18px', fontWeight: 700, color: '#107e3e' }}>
                    {summary.highConfidenceReady}
                  </span>
                </div>
                <div style={facetDividerStyle}>
                  <span style={facetLabelStyle}>Revisão Manual</span>
                  <span style={{ fontSize: '18px', fontWeight: 700, color: '#e9730c' }}>
                    {summary.needsReview}
                  </span>
                </div>
                <div style={facetDividerStyle}>
                  <span style={facetLabelStyle}>Recebimentos Pendentes</span>
                  <span style={{ fontSize: '16px', fontWeight: 700, color: '#107e3e' }}>
                    +{formatEur(summary.unreconciledInflowEur)}
                  </span>
                </div>
                <div style={facetDividerStyle}>
                  <span style={facetLabelStyle}>Pagamentos Pendentes</span>
                  <span style={{ fontSize: '16px', fontWeight: 700, color: '#bb0000' }}>
                    -{formatEur(summary.unreconciledOutflowEur)}
                  </span>
                </div>
                <div style={facetDividerStyle}>
                  <span style={facetLabelStyle}>Reconciliados</span>
                  <span style={{ fontSize: '18px', fontWeight: 700, color: '#0070f2' }}>
                    {summary.reconciledCount}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </header>

      {banner && (
        <div style={{ padding: '10px 24px 0 24px' }}>
          <MessageStrip design={banner.type} onClose={() => setBanner(null)}>
            {banner.text}
          </MessageStrip>
        </div>
      )}

      {/* SAP Fiori FlexibleColumnLayout Workspace (List Report Table + Object Page Inspector) */}
      <main
        style={{
          flex: 1,
          padding: '12px 24px 20px 24px',
          display: 'grid',
          gridTemplateColumns: selectedLine ? '1.1fr 1fr' : '1fr',
          gap: '12px',
          alignItems: 'start',
        }}
      >
        {/* Left Column: SAP B1 Web Client List Report Table */}
        <section
          style={{
            background: '#ffffff',
            border: '1px solid #d9d9d9',
            borderRadius: '4px',
            overflow: 'hidden',
            boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
          }}
        >
          {/* Fiori Table Header Toolbar */}
          <div
            style={{
              padding: '8px 16px',
              borderBottom: '1px solid #e5e5e5',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: '#ffffff',
            }}
          >
            <Title level="H5" style={{ margin: 0, fontSize: '15px' }}>
              Linhas do Extrato Bancário ({displayedLines.length})
            </Title>
            <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
              <Button design="Transparent" onClick={() => setUploadOpen(true)}>
                Importar Ficheiro
              </Button>
              <Button
                design="Transparent"
                disabled={displayedLines.length === 0}
                onClick={handleExportCsv}
              >
                Exportar
              </Button>
              <Button design="Transparent" onClick={() => void refreshAll()} disabled={loading}>
                Atualizar
              </Button>
            </div>
          </div>

          {loading ? (
            <div style={{ padding: '48px', textAlign: 'center' }}>
              <BusyIndicator active size="M" />
            </div>
          ) : displayedLines.length === 0 ? (
            <div style={{ padding: '44px 24px', textAlign: 'center', color: '#556b82' }}>
              <div style={{ fontSize: '15px', fontWeight: 600, marginBottom: '6px', color: '#1d2d3e' }}>
                Não foram encontrados movimentos bancários
              </div>
              <div style={{ fontSize: '13px', marginBottom: '16px' }}>
                Importe um ficheiro de extrato bancário (SWIFT MT940 ou Norma 43) ou ajuste os filtros no cabeçalho.
              </div>
              <div style={{ display: 'flex', justifyContent: 'center', gap: '8px' }}>
                <Button design="Emphasized" onClick={() => setUploadOpen(true)}>
                  Importar Extrato
                </Button>
                <Button design="Default" onClick={() => void handleLoadSamples()}>
                  Carregar Dados de Demonstração
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
                      color: '#32363a',
                      fontSize: '12px',
                    }}
                  >
                    <th style={{ padding: '9px 12px', fontWeight: 600 }}>Data</th>
                    <th style={{ padding: '9px 10px', fontWeight: 600 }}>Conta</th>
                    <th style={{ padding: '9px 12px', fontWeight: 600 }}>Descrição &amp; Parceiro Sugerido</th>
                    <th style={{ padding: '9px 12px', fontWeight: 600, textAlign: 'right' }}>Montante</th>
                    <th style={{ padding: '9px 12px', fontWeight: 600 }}>Estado / Sugestão</th>
                    <th style={{ padding: '9px 8px', width: '18px' }} />
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
                          borderBottom: '1px solid #e5e5e5',
                          background: isSelected ? '#ebf5fe' : '#ffffff',
                          borderLeft: isSelected ? '3px solid #0070f2' : '3px solid transparent',
                        }}
                      >
                        <td style={{ padding: '9px 12px', whiteSpace: 'nowrap', verticalAlign: 'middle' }}>
                          <div style={{ fontWeight: 600, color: '#1d2d3e' }}>{l.bookingDate}</div>
                          <div style={{ fontSize: '11px', color: '#6a6d70' }}>#{l.lineNumber}</div>
                        </td>
                        <td style={{ padding: '9px 10px', whiteSpace: 'nowrap', verticalAlign: 'middle' }}>
                          <div style={{ fontWeight: 600, color: '#1d2d3e' }}>{l.bankCode}</div>
                          <div style={{ fontSize: '11px', color: '#6a6d70' }}>G/L {l.glAccountCode}</div>
                        </td>
                        <td style={{ padding: '9px 12px', verticalAlign: 'middle' }}>
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
                            padding: '9px 12px',
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
                        <td style={{ padding: '9px 12px', whiteSpace: 'nowrap', verticalAlign: 'middle' }}>
                          {l.status === 'RECONCILED' ? (
                            <ObjectStatus state="Positive" showDefaultIcon>
                              Reconciliado
                            </ObjectStatus>
                          ) : l.status === 'ERROR' ? (
                            <ObjectStatus state="Negative" showDefaultIcon>
                              Erro
                            </ObjectStatus>
                          ) : l.status === 'IGNORED' ? (
                            <ObjectStatus state="None">Ignorado</ObjectStatus>
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
                              {topSug.confidence}% ({topSug.tier === 'HIGH' ? 'Automático' : 'Rever'})
                            </ObjectStatus>
                          ) : (
                            <ObjectStatus state="None">Manual</ObjectStatus>
                          )}
                        </td>
                        <td
                          style={{
                            padding: '9px 10px 9px 0',
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
      </main>

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
            text: 'Configuração de ligação SAP HANA & Service Layer atualizada.',
          });
          void refreshAll();
        }}
      />
    </div>
  );
};

const filterLabelStyle: React.CSSProperties = {
  display: 'block',
  marginBottom: '4px',
  fontSize: '12px',
  color: '#556b82',
};

const facetItemStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '2px',
};

const facetDividerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '2px',
  borderLeft: '1px solid #e5e5e5',
  paddingLeft: '20px',
};

const facetLabelStyle: React.CSSProperties = {
  fontSize: '11.5px',
  color: '#556b82',
};
