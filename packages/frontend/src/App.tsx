import React, { useCallback, useEffect, useState } from 'react';
import type { DashboardSummary, HouseBankAccount, StagedBankLine } from '@b1-recon/shared';
import {
  Button,
  BusyIndicator,
  Input,
  MessageStrip,
  ObjectStatus,
  Option,
  SegmentedButton,
  SegmentedButtonItem,
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
        text: `Reconciliação em lote concluída: ${res.reconciledCount} movimento(s) lançado(s) e reconciliado(s) no SAP B1.`,
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

  const selectedLine = lines.find((l) => l.id === selectedLineId) ?? null;

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
      ...lines.map((l) =>
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
          `"${(l.suggestions?.[0]?.cardName ?? '').replace(/"/g, '""')}"`,
          `"${l.description.replace(/"/g, '""')}"`,
        ].join(';')
      ),
    ];
    const blob = new Blob(['\uFEFF' + rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Reconciliacao_Bancaria_SAP_B1_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: '#f5f6f7' }}>
      {/* KPI & Filter Toolbar */}
      <div
        style={{
          background: '#ffffff',
          borderBottom: '1px solid #d9d9d9',
          padding: '16px 24px',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Title level="H4">Tesouraria &amp; Reconciliação Externa</Title>
            {summary && (
              <Tag colorScheme={summary.mode === 'live' ? '8' : '6'}>
                {isUsingNativeWebClientB1s()
                  ? 'Sessão SAP B1 Web Client Ativa'
                  : summary.mode === 'live'
                    ? 'SAP HANA Live + Service Layer'
                    : 'Modo Simulação SAP HANA Local'}
              </Tag>
            )}
          </div>

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <Button design="Transparent" onClick={() => setConnOpen(true)}>
              {isUsingNativeWebClientB1s() ? 'Diagnóstico Sessão B1' : 'Ligação SAP B1 / HANA'}
            </Button>
            <Button design="Transparent" onClick={() => setGlRulesOpen(true)}>
              Regras G/L
            </Button>
            <Button design="Transparent" onClick={() => setAuditOpen(true)}>
              Auditoria
            </Button>
            <Button
              design="Transparent"
              disabled={lines.length === 0}
              onClick={handleExportCsv}
            >
              Exportar CSV
            </Button>
            <Button design="Default" onClick={() => void handleLoadSamples()} disabled={batchBusy}>
              Carregar Exemplos (MT940 + Norma 43)
            </Button>
            <Button design="Default" onClick={() => setUploadOpen(true)}>
              Importar Extrato (.mt940 / .n43)
            </Button>
            <Button
              design="Emphasized"
              disabled={batchBusy || !summary || summary.highConfidenceReady === 0}
              onClick={() => void handleBatchApprove()}
            >
              Aprovar Sugestões Elevadas ({summary?.highConfidenceReady ?? 0})
            </Button>
          </div>
        </div>

        {/* KPI Cards */}
        {summary && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(185px, 1fr))',
              gap: '12px',
            }}
          >
            <div style={kpiCardStyle}>
              <div style={kpiLabelStyle}>Por Reconciliar</div>
              <div style={{ fontSize: '22px', fontWeight: 700, color: '#1d2d3e' }}>
                {summary.totalUnreconciled}
              </div>
            </div>
            <div style={kpiCardStyle}>
              <div style={kpiLabelStyle}>Sugestão Elevada (≥85%)</div>
              <div style={{ fontSize: '22px', fontWeight: 700, color: '#188918' }}>
                {summary.highConfidenceReady}
              </div>
            </div>
            <div style={kpiCardStyle}>
              <div style={kpiLabelStyle}>Requer Revisão Manual</div>
              <div style={{ fontSize: '22px', fontWeight: 700, color: '#e76500' }}>{summary.needsReview}</div>
            </div>
            <div style={kpiCardStyle}>
              <div style={kpiLabelStyle}>Entradas Pendentes</div>
              <div style={{ fontSize: '18px', fontWeight: 700, color: '#188918' }}>
                +{formatEur(summary.unreconciledInflowEur)}
              </div>
            </div>
            <div style={kpiCardStyle}>
              <div style={kpiLabelStyle}>Saídas Pendentes</div>
              <div style={{ fontSize: '18px', fontWeight: 700, color: '#aa0808' }}>
                -{formatEur(summary.unreconciledOutflowEur)}
              </div>
            </div>
            <div style={kpiCardStyle}>
              <div style={kpiLabelStyle}>Reconciliados no SAP B1</div>
              <div style={{ fontSize: '22px', fontWeight: 700, color: '#0070f2' }}>
                {summary.reconciledCount}
              </div>
            </div>
          </div>
        )}

        {/* Filter Bar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <Select
              onChange={(e) => {
                const bankId = e.detail.selectedOption?.getAttribute('data-bank-id');
                if (bankId) setSelectedBankId(bankId);
              }}
            >
              <Option data-bank-id="ALL" selected={selectedBankId === 'ALL'}>
                 Todas as Contas Bancárias
              </Option>
              {houseBanks.map((hb) => (
                <Option key={hb.id} data-bank-id={hb.id} selected={selectedBankId === hb.id}>
                  {hb.bankCode} — {hb.accountLabel} (G/L {hb.glAccountCode})
                </Option>
              ))}
            </Select>

            <SegmentedButton
              onSelectionChange={(e) => {
                const st = e.detail.selectedItems?.[0]?.getAttribute('data-status') as
                  | 'PENDING'
                  | 'RECONCILED'
                  | 'IGNORED'
                  | 'ALL'
                  | undefined;
                if (st) setStatusGroup(st);
              }}
            >
              <SegmentedButtonItem data-status="PENDING" selected={statusGroup === 'PENDING'}>
                Pendentes
              </SegmentedButtonItem>
              <SegmentedButtonItem data-status="RECONCILED" selected={statusGroup === 'RECONCILED'}>
                Reconciliados
              </SegmentedButtonItem>
              <SegmentedButtonItem data-status="IGNORED" selected={statusGroup === 'IGNORED'}>
                Ignorados
              </SegmentedButtonItem>
              <SegmentedButtonItem data-status="ALL" selected={statusGroup === 'ALL'}>
                Todos
              </SegmentedButtonItem>
            </SegmentedButton>
          </div>

          <Input
            placeholder="Pesquisar NIF, IBAN, Multibanco, Fatura, Valor..."
            value={search}
            style={{ width: '320px' }}
            onInput={(e) => setSearch((e.target as unknown as { value: string }).value)}
          />
        </div>
      </div>

      {banner && (
        <div style={{ padding: '12px 24px 0 24px' }}>
          <MessageStrip design={banner.type} onClose={() => setBanner(null)}>
            {banner.text}
          </MessageStrip>
        </div>
      )}

      {/* Master-Detail Split Workspace */}
      <div
        style={{
          flex: 1,
          padding: '16px 24px 24px 24px',
          display: 'grid',
          gridTemplateColumns: selectedLine ? '1.15fr 1fr' : '1fr',
          gap: '16px',
          alignItems: 'start',
        }}
      >
        {/* Left: Bank Statement Movements Table */}
        <div
          style={{
            background: '#ffffff',
            border: '1px solid #d9d9d9',
            borderRadius: '10px',
            overflow: 'hidden',
          }}
        >
          {loading ? (
            <div style={{ padding: '48px', textAlign: 'center' }}>
              <BusyIndicator active size="L" />
            </div>
          ) : lines.length === 0 ? (
            <div style={{ padding: '48px 24px', textAlign: 'center', color: '#556b82' }}>
              <div style={{ fontSize: '16px', fontWeight: 600, marginBottom: '8px', color: '#1d2d3e' }}>
                Nenhum movimento bancário neste filtro
              </div>
              <div style={{ fontSize: '13px', marginBottom: '16px' }}>
                Importe um extrato bancário nos formatos SWIFT MT940 ou Norma 43 para
                gerar sugestões automáticas a partir do SAP HANA.
              </div>
              <div style={{ display: 'flex', justifyContent: 'center', gap: '10px' }}>
                <Button design="Emphasized" onClick={() => setUploadOpen(true)}>
                  Importar Ficheiro (.mt940 / .n43)
                </Button>
                <Button design="Default" onClick={() => void handleLoadSamples()}>
                  Carregar Exemplos (MT940 + Norma 43)
                </Button>
              </div>
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ background: '#f5f6f7', borderBottom: '1px solid #d9d9d9', textAlign: 'left' }}>
                  <th style={{ padding: '10px 12px' }}>Banco / Data</th>
                  <th style={{ padding: '10px 12px' }}>Descrição &amp; Entidade</th>
                  <th style={{ padding: '10px 12px', textAlign: 'right' }}>Montante</th>
                  <th style={{ padding: '10px 12px' }}>Sugestão SAP HANA</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  const isSelected = l.id === selectedLineId;
                  const topSug = l.suggestions?.[0];
                  return (
                    <tr
                      key={l.id}
                      onClick={() => setSelectedLineId(l.id)}
                      style={{
                        cursor: 'pointer',
                        borderBottom: '1px solid #efefef',
                        background: isSelected ? '#ebf5fe' : '#ffffff',
                      }}
                    >
                      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                        <div style={{ fontWeight: 700 }}>{l.bankCode}</div>
                        <div style={{ fontSize: '11px', color: '#556b82' }}>{l.bookingDate}</div>
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <div
                          style={{
                            fontWeight: 600,
                            color: '#1d2d3e',
                            maxWidth: '340px',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {l.description}
                        </div>
                        <div style={{ fontSize: '11px', color: '#556b82' }}>
                          {topSug ? `Sugerido: ${topSug.cardName}` : `Ref: ${l.bankReference || '—'}`}
                        </div>
                      </td>
                      <td
                        style={{
                          padding: '10px 12px',
                          textAlign: 'right',
                          fontWeight: 700,
                          whiteSpace: 'nowrap',
                          color: l.direction === 'CREDIT' ? '#188918' : '#aa0808',
                        }}
                      >
                        {l.direction === 'CREDIT' ? '+' : '-'}
                        {formatEur(l.amount)}
                      </td>
                      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                        {l.status === 'RECONCILED' ? (
                          <ObjectStatus state="Positive" showDefaultIcon>
                            Reconciliado
                          </ObjectStatus>
                        ) : l.status === 'ERROR' ? (
                          <ObjectStatus state="Negative" showDefaultIcon>
                            Erro (Retentar)
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
                            {topSug.confidence}% ({topSug.tier === 'HIGH' ? 'Auto' : 'Rever'})
                          </ObjectStatus>
                        ) : (
                          <ObjectStatus state="None">Sem Match</ObjectStatus>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Right: Detailed Candidate & Action Inspector */}
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

const kpiCardStyle: React.CSSProperties = {
  background: '#f8f9fa',
  border: '1px solid #e5e7eb',
  borderRadius: '8px',
  padding: '10px 14px',
};

const kpiLabelStyle: React.CSSProperties = {
  fontSize: '11px',
  color: '#556b82',
  marginBottom: '4px',
  textTransform: 'uppercase',
  letterSpacing: '0.02em',
};
