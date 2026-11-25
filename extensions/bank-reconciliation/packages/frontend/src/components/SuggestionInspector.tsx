import React, { useEffect, useMemo, useState } from 'react';
import {
  filterManualJournalLines,
  filterManualOpenDocuments,
  type B1OpenDocument,
  type B1UnreconciledJournalLine,
  type GlMatchingRule,
  type MatchSuggestion,
  type StagedBankLine,
} from '@b1-recon/shared';
import {
  Button,
  BusyIndicator,
  CheckBox,
  Input,
  Label,
  MessageStrip,
  ObjectStatus,
  Option,
  Select,
  Tag,
  Title,
} from '@ui5/webcomponents-react';
import { api, formatEur } from '../api';

interface Props {
  line: StagedBankLine;
  onActionSuccess: (msg: string) => void;
}

type InspectorTab = 'SUGGESTIONS' | 'OPEN_DOCS' | 'JOURNAL' | 'DIRECT_GL';

export const SuggestionInspector: React.FC<Props> = ({ line, onActionSuccess }) => {
  const [activeTab, setActiveTab] = useState<InspectorTab>('SUGGESTIONS');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  // Manual candidate picker state
  const [manualLoading, setManualLoading] = useState(false);
  const [manualSearch, setManualSearch] = useState<string>('');
  const [selectedSeries, setSelectedSeries] = useState<string>('ALL');
  const [docPage, setDocPage] = useState<number>(1);
  const [showAllDocs, setShowAllDocs] = useState<boolean>(false);
  const [openDocs, setOpenDocs] = useState<B1OpenDocument[]>([]);
  const [journalLines, setJournalLines] = useState<B1UnreconciledJournalLine[]>([]);
  const [glRules, setGlRules] = useState<GlMatchingRule[]>([]);

  // Map of docEntry -> custom allocated amount (positive for invoices, negative for credit memos)
  const [allocatedByDocEntry, setAllocatedByDocEntry] = useState<Record<number, number>>({});
  const [allocatedTextByDocEntry, setAllocatedTextByDocEntry] = useState<Record<number, string>>({});
  const [allowPaymentOnAccount, setAllowPaymentOnAccount] = useState<boolean>(false);
  const [directGlCode, setDirectGlCode] = useState<string>('622701');

  useEffect(() => {
    setError(null);
    setManualSearch('');
    setSelectedSeries('ALL');
    setDocPage(1);
    setShowAllDocs(false);
    setAllocatedByDocEntry({});
    setAllocatedTextByDocEntry({});
    setAllowPaymentOnAccount(false);
    setShowRaw(false);
    // Default to OPEN_DOCS tab automatically if there are no automatic suggestions and movement is pending
    if (
      line.status !== 'RECONCILED' &&
      (!line.suggestions || line.suggestions.length === 0)
    ) {
      setActiveTab('OPEN_DOCS');
    } else {
      setActiveTab('SUGGESTIONS');
    }
  }, [line.id]);

  const loadCandidates = (forceRefresh = false) => {
    setManualLoading(true);
    Promise.all([
      api.getManualCandidates(line.direction, line.glAccountCode, undefined, forceRefresh),
      api.getGlRules(),
    ])
      .then(([candRes, rulesRes]) => {
        setOpenDocs(candRes.openDocuments);
        setJournalLines(candRes.journalLines);
        setGlRules(rulesRes.rules);
        const defaultRule = rulesRes.rules.find((r) => r.direction === line.direction);
        if (defaultRule) setDirectGlCode(defaultRule.glAccountCode);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setManualLoading(false));
  };

  useEffect(() => {
    if (activeTab === 'SUGGESTIONS') return;
    loadCandidates(false);
  }, [activeTab, line.direction, line.glAccountCode]);

  // Live server-side search fallback when user types 2+ characters
  useEffect(() => {
    if (activeTab === 'SUGGESTIONS' || manualSearch.trim().length < 2) return;
    const timer = setTimeout(() => {
      api
        .getManualCandidates(line.direction, line.glAccountCode, manualSearch.trim(), false)
        .then((res) => {
          setOpenDocs(res.openDocuments);
          setJournalLines(res.journalLines);
        })
        .catch(() => {
          // Keep current in-memory list
        });
    }, 300);
    return () => clearTimeout(timer);
  }, [activeTab, manualSearch, line.direction, line.glAccountCode]);

  const handleApproveSuggestion = async (sug: MatchSuggestion) => {
    setBusy(true);
    setError(null);
    try {
      if (sug.targetType === 'EXISTING_JOURNAL_ENTRY' && sug.journalLine) {
        await api.approveReconciliation({
          bankLineId: line.id,
          targetType: 'EXISTING_JOURNAL_ENTRY',
          journalSelection: {
            transId: sug.journalLine.transId,
            lineId: sug.journalLine.lineId,
          },
        });
      } else if (sug.targetType === 'DIRECT_GL_ACCOUNT' && sug.glAccountMatch) {
        await api.approveReconciliation({
          bankLineId: line.id,
          targetType: 'DIRECT_GL_ACCOUNT',
          glAccountSelection: {
            glAccountCode: sug.glAccountMatch.glAccountCode,
            glAccountName: sug.glAccountMatch.glAccountName,
          },
        });
      } else if (sug.allocations && sug.cardCode) {
        await api.approveReconciliation({
          bankLineId: line.id,
          targetType: sug.targetType,
          invoiceSelection: {
            cardCode: sug.cardCode,
            allocations: sug.allocations.map((a) => ({
              docType: a.docType,
              docEntry: a.docEntry,
              allocatedAmount: a.allocatedAmount,
            })),
          },
        });
      }
      onActionSuccess(
        `Movimento reconciliado no SAP Business One (${formatEur(line.amount)} — Conta G/L ${line.glAccountCode}).`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleManualJournalReconcile = async (je: B1UnreconciledJournalLine) => {
    setBusy(true);
    setError(null);
    try {
      await api.approveReconciliation({
        bankLineId: line.id,
        targetType: 'EXISTING_JOURNAL_ENTRY',
        journalSelection: { transId: je.transId, lineId: je.lineId },
      });
      onActionSuccess(`Reconciliado manualmente com lançamento contabilístico TransId #${je.transId}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleManualDirectGlReconcile = async () => {
    if (!directGlCode.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.approveReconciliation({
        bankLineId: line.id,
        targetType: 'DIRECT_GL_ACCOUNT',
        glAccountSelection: {
          glAccountCode: directGlCode.trim(),
        },
      });
      onActionSuccess(
        `Lançado diretamente na Conta do Razão ${directGlCode.trim()} e reconciliado (${formatEur(line.amount)}).`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const selectedDocs = useMemo(
    () => openDocs.filter((d) => allocatedByDocEntry[d.docEntry] !== undefined),
    [openDocs, allocatedByDocEntry]
  );

  const availableSeries = useMemo(() => {
    const counts = new Map<string, number>();
    for (const d of openDocs) {
      const key = d.seriesName || (d.seriesCode != null ? `Série ${d.seriesCode}` : '');
      if (key) {
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries()).map(([name, count]) => ({ name, count }));
  }, [openDocs]);

  const filteredOpenDocs = useMemo(
    () => filterManualOpenDocuments(openDocs, manualSearch, selectedSeries),
    [openDocs, manualSearch, selectedSeries]
  );

  const DOCS_PAGE_SIZE = 50;
  const totalDocPages = Math.max(1, Math.ceil(filteredOpenDocs.length / DOCS_PAGE_SIZE));
  const safeDocPage = Math.min(docPage, totalDocPages);
  const visibleOpenDocs = useMemo(() => {
    if (showAllDocs) return filteredOpenDocs;
    const start = (safeDocPage - 1) * DOCS_PAGE_SIZE;
    return filteredOpenDocs.slice(start, start + DOCS_PAGE_SIZE);
  }, [filteredOpenDocs, safeDocPage, showAllDocs]);

  const filteredJournalLines = useMemo(() => {
    const directionCompatible = journalLines.filter((j) =>
      line.direction === 'CREDIT' ? j.signedAmount > 0 : j.signedAmount < 0
    );
    return filterManualJournalLines(directionCompatible, manualSearch).sort((a, b) => {
      const aExact = Math.abs(a.signedAmount - line.signedAmount) < 0.01 ? 0 : 1;
      const bExact = Math.abs(b.signedAmount - line.signedAmount) < 0.01 ? 0 : 1;
      return aExact - bExact;
    });
  }, [journalLines, line.direction, line.signedAmount, manualSearch]);

  const manualSelectedTotal = useMemo(
    () =>
      selectedDocs.reduce((sum, d) => {
        const val = allocatedByDocEntry[d.docEntry] ?? d.openAmount;
        return sum + val;
      }, 0),
    [selectedDocs, allocatedByDocEntry]
  );

  const manualDiff = Math.round((line.amount - manualSelectedTotal) * 100) / 100;
  const effectiveOnAccount = allowPaymentOnAccount && manualDiff > 0 ? manualDiff : 0;
  const canSubmitManualInvoices =
    selectedDocs.length > 0 && Math.abs(manualDiff - effectiveOnAccount) < 0.01;

  const toggleDocumentSelection = (doc: B1OpenDocument) => {
    const next = { ...allocatedByDocEntry };
    const nextText = { ...allocatedTextByDocEntry };
    if (next[doc.docEntry] !== undefined) {
      delete next[doc.docEntry];
      delete nextText[doc.docEntry];
    } else {
      const currentSum = Object.values(next).reduce((s, v) => s + v, 0);
      const remaining = Math.round((line.amount - currentSum) * 100) / 100;
      const initialVal =
        doc.openAmount > 0 && remaining > 0 && doc.openAmount > remaining
          ? remaining
          : doc.openAmount;
      next[doc.docEntry] = initialVal;
      nextText[doc.docEntry] = initialVal.toFixed(2);
    }
    setAllocatedByDocEntry(next);
    setAllocatedTextByDocEntry(nextText);
  };

  const handleManualInvoicesApprove = async () => {
    if (selectedDocs.length === 0) return;
    const distinctBps = new Set(selectedDocs.map((p) => p.cardCode));
    if (distinctBps.size > 1) {
      setError('Selecione documentos do mesmo Parceiro de Negócios (CardCode) para gerar o pagamento no SAP B1.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await api.approveReconciliation({
        bankLineId: line.id,
        targetType:
          selectedDocs.length > 1
            ? 'MULTI_INVOICE_BUNDLE'
            : line.direction === 'CREDIT'
              ? 'OPEN_AR_INVOICE'
              : 'OPEN_AP_INVOICE',
        invoiceSelection: {
          cardCode: selectedDocs[0].cardCode,
          allocations: selectedDocs.map((p) => ({
            docType: p.docType,
            docEntry: p.docEntry,
            allocatedAmount: allocatedByDocEntry[p.docEntry] ?? p.openAmount,
          })),
          paymentOnAccountAmount: effectiveOnAccount > 0 ? effectiveOnAccount : undefined,
        },
      });
      onActionSuccess(`Pagamento criado e reconciliado manualmente (${selectedDocs.length} documento(s)).`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleIgnore = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.ignoreLine(line.id, 'Ignorado pelo utilizador no painel Web Client');
      onActionSuccess('Movimento marcado como ignorado.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleReopen = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.reopenLine(line.id);
      onActionSuccess('Movimento reativado para reconciliação.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const topSug = line.suggestions?.[0];

  return (
    <section
      style={{
        background: '#ffffff',
        border: '1px solid #e6ebf0',
        borderRadius: '12px',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 1px 4px rgba(15, 35, 55, 0.05)',
        overflow: 'hidden',
      }}
    >
      {/* SAP B1 Web Client Object Page Header */}
      <div style={{ padding: '18px 24px 14px 24px' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: '12px',
            marginBottom: '10px',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
              <Title level="H5" style={{ margin: 0 }}>
                Movimento #{line.lineNumber} — {line.bankCode}
              </Title>
              <Tag design="Set2" colorScheme="6" hideStateIcon>
                Conta G/L {line.glAccountCode}
              </Tag>
            </div>
            <div style={{ fontSize: '13px', color: '#32363a', fontWeight: 500 }}>{line.description}</div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}>
            {line.status !== 'RECONCILED' && topSug && Math.abs(topSug.differenceAmount) < 0.01 && (
              <Button
                design="Emphasized"
                disabled={busy}
                onClick={() => void handleApproveSuggestion(topSug)}
              >
                Reconciliar Sugestão ({topSug.confidence}%)
              </Button>
            )}
            {line.status === 'IGNORED' || line.status === 'ERROR' ? (
              <Button design="Default" onClick={() => void handleReopen()} disabled={busy}>
                Reativar
              </Button>
            ) : (
              line.status !== 'RECONCILED' && (
                <Button design="Transparent" onClick={() => void handleIgnore()} disabled={busy}>
                  Ignorar
                </Button>
              )
            )}
          </div>
        </div>

        {/* SAP Fiori Object Page Header Facets */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
            flexWrap: 'wrap',
            gap: '12px',
            paddingTop: '8px',
            borderTop: '1px solid #f2f2f2',
          }}
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', fontSize: '12px' }}>
            <div>
              <span style={{ color: '#6a6d70', display: 'block' }}>Data de Lançamento</span>
              <strong>{line.bookingDate}</strong>
            </div>
            <div>
              <span style={{ color: '#6a6d70', display: 'block' }}>Data Valor</span>
              <strong>{line.valueDate}</strong>
            </div>
            <div>
              <span style={{ color: '#6a6d70', display: 'block' }}>Ref. Bancária / Cód.</span>
              <strong>
                {line.bankReference || '—'} ({line.transactionCode})
              </strong>
            </div>
            {line.extracted.counterpartyNif && (
              <div>
                <span style={{ color: '#6a6d70', display: 'block' }}>NIF Detetado</span>
                <strong>{line.extracted.counterpartyNif}</strong>
              </div>
            )}
            {line.extracted.multibancoRef && (
              <div>
                <span style={{ color: '#6a6d70', display: 'block' }}>Ref. Multibanco</span>
                <strong>
                  {line.extracted.multibancoEntity ? `${line.extracted.multibancoEntity} / ` : ''}
                  {line.extracted.multibancoRef}
                </strong>
              </div>
            )}
          </div>

          <div style={{ textAlign: 'right' }}>
            <div
              style={{
                fontSize: '19px',
                fontWeight: 700,
                color: line.direction === 'CREDIT' ? '#107e3e' : '#bb0000',
              }}
            >
              {line.direction === 'CREDIT' ? '+' : '-'}
              {formatEur(line.amount)}
            </div>
            <div style={{ fontSize: '11px', color: '#6a6d70' }}>
              {line.direction === 'CREDIT' ? 'Recebimento (Crédito Bancário)' : 'Pagamento (Débito Bancário)'}
            </div>
          </div>
        </div>
      </div>

      {/* SAP B1 Web Client Object Page Anchor / Section Tab Bar */}
      {line.status !== 'RECONCILED' && (
        <div
          style={{
            display: 'flex',
            borderTop: '1px solid #eceef0',
            borderBottom: '2px solid #0032a5',
            background: '#ffffff',
            padding: '0 24px',
            gap: '20px',
            overflowX: 'auto',
          }}
        >
          {(
            [
              {
                key: 'SUGGESTIONS' as InspectorTab,
                label: `Sugestões (${line.suggestions?.length ?? 0})`,
              },
              {
                key: 'OPEN_DOCS' as InspectorTab,
                label:
                  line.direction === 'CREDIT'
                    ? `Documentos de clientes${openDocs.length ? ` (${openDocs.length})` : ''}`
                    : `Documentos de fornecedores${openDocs.length ? ` (${openDocs.length})` : ''}`,
              },
              {
                key: 'JOURNAL' as InspectorTab,
                label: `Lançamentos no razão${filteredJournalLines.length ? ` (${filteredJournalLines.length})` : ''}`,
              },
              {
                key: 'DIRECT_GL' as InspectorTab,
                label: 'Conta do razão (G/L)',
              },
            ] as const
          ).map((t) => {
            const active = activeTab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setActiveTab(t.key)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  borderBottom: active ? '3px solid #0064d9' : '3px solid transparent',
                  color: active ? '#0064d9' : '#1d2d3e',
                  fontWeight: 600,
                  fontSize: '13px',
                  padding: '10px 2px 9px 2px',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  fontFamily: 'inherit',
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Object Page Section Body */}
      <div style={{ padding: '18px 24px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {(error || line.errorMessage) && (
          <MessageStrip design="Negative" hideCloseButton>
            {error || line.errorMessage}
          </MessageStrip>
        )}

        {busy && (
          <div style={{ textAlign: 'center', padding: '6px' }}>
            <BusyIndicator active size="S" />
          </div>
        )}

        {line.status === 'RECONCILED' ? (
          <MessageStrip design="Positive" hideCloseButton>
            Reconciliado no SAP Business One por <strong>{line.reconciledBy}</strong> — Lançamento TransId #
            {line.b1TransId}, Extrato BankPage Seq #{line.b1BankPageSequence}
            {line.b1PaymentDocEntry ? `, Pagamento DocEntry #${line.b1PaymentDocEntry}` : ''}.
          </MessageStrip>
        ) : (
          <>
            {/* TAB 1: AUTOMATIC SUGGESTIONS */}
            {activeTab === 'SUGGESTIONS' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {(!line.suggestions || line.suggestions.length === 0) ? (
                  <div
                    style={{
                      padding: '24px',
                      border: '1px solid #e5e5e5',
                      borderRadius: '4px',
                      background: '#fafafa',
                      textAlign: 'center',
                    }}
                  >
                    <div style={{ fontWeight: 600, fontSize: '14px', marginBottom: '6px' }}>
                      Sem sugestão automática direta
                    </div>
                    <div style={{ fontSize: '12.5px', color: '#556b82', marginBottom: '14px' }}>
                      Selecione faturas/notas de crédito em aberto, um lançamento existente no Razão ou uma conta de
                      custos/juros nos separadores acima.
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'center', gap: '8px' }}>
                      <Button design="Emphasized" onClick={() => setActiveTab('OPEN_DOCS')}>
                        Selecionar Faturas / Notas de Crédito
                      </Button>
                      <Button design="Default" onClick={() => setActiveTab('JOURNAL')}>
                        Procurar Lançamento no Razão
                      </Button>
                    </div>
                  </div>
                ) : (
                  line.suggestions.map((sug) => (
                    <div
                      key={sug.id}
                      style={{
                        border: sug.confidence >= 85 ? '1px solid #107e3e' : '1px solid #d9d9d9',
                        borderLeft: sug.confidence >= 85 ? '4px solid #107e3e' : '4px solid #0070f2',
                        borderRadius: '4px',
                        padding: '14px',
                        background: '#ffffff',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '10px',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'flex-start',
                          gap: '12px',
                        }}
                      >
                        <div>
                          <div style={{ fontWeight: 700, fontSize: '14px', color: '#1d2d3e' }}>
                            {sug.targetType === 'EXISTING_JOURNAL_ENTRY' &&
                              `Reconciliar Pagamento / Lançamento Existente (Doc. Nº ${
                                sug.journalLine?.sourceDocNum ||
                                sug.journalLine?.ref1 ||
                                sug.journalLine?.transId
                              })`}
                            {sug.targetType === 'OPEN_AR_INVOICE' &&
                              'Criar Recebimento de Cliente + Reconciliar'}
                            {sug.targetType === 'OPEN_AP_INVOICE' &&
                              'Criar Pagamento a Fornecedor + Reconciliar'}
                            {sug.targetType === 'MULTI_INVOICE_BUNDLE' &&
                              `Criar Pagamento Agrupado (${sug.allocations?.length} Documentos) + Reconciliar`}
                            {sug.targetType === 'DIRECT_GL_ACCOUNT' &&
                              'Contabilização Direta em Conta G/L + Reconciliar'}
                          </div>
                          <div style={{ fontSize: '13px', color: '#556b82', marginTop: '2px' }}>
                            {sug.cardCode ? (
                              <>
                                <strong style={{ color: '#1d2d3e' }}>{sug.cardCode}</strong>
                                {' — '}
                                <strong style={{ color: '#1d2d3e' }}>
                                  {sug.journalLine?.cardName || sug.cardName || 'Parceiro de Negócios'}
                                </strong>
                              </>
                            ) : (
                              <strong style={{ color: '#1d2d3e' }}>{sug.cardName}</strong>
                            )}
                            {sug.nif ? ` (NIF ${sug.nif})` : ''}
                          </div>
                        </div>

                        <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <div
                            style={{
                              fontSize: '15px',
                              fontWeight: 700,
                              color: '#1d2d3e',
                              marginBottom: '2px',
                            }}
                          >
                            Total: {formatEur(sug.matchedAmount)}
                          </div>
                          <ObjectStatus
                            state={
                              sug.confidence >= 85
                                ? 'Positive'
                                : sug.confidence >= 70
                                  ? 'Critical'
                                  : 'Information'
                            }
                            showDefaultIcon
                          >
                            Confiança {sug.confidence}%
                          </ObjectStatus>
                        </div>
                      </div>

                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        {sug.reasons.map((r) => (
                          <Tag key={r} design="Positive">
                            {r}
                          </Tag>
                        ))}
                      </div>

                      {sug.journalLine && (
                        <div
                          style={{
                            fontSize: '12px',
                            background: '#f5f6f7',
                            padding: '10px 12px',
                            borderRadius: '4px',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            gap: '12px',
                          }}
                        >
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                            <div>
                              <strong>Parceiro de Negócios:</strong>{' '}
                              {sug.journalLine.cardCode ? `${sug.journalLine.cardCode} — ` : ''}
                              <strong>{sug.journalLine.cardName || sug.cardName || '—'}</strong>
                              {sug.journalLine.nif ? ` (NIF ${sug.journalLine.nif})` : ''}
                            </div>
                            <div style={{ color: '#556b82' }}>
                              Nº Documento:{' '}
                              <strong>
                                {sug.journalLine.sourceDocNum ||
                                  sug.journalLine.ref1 ||
                                  sug.journalLine.ref2 ||
                                  '—'}
                              </strong>{' '}
                              • Nº Lançamento (OJDT): <strong>#{sug.journalLine.transId}</strong> • Data:{' '}
                              <strong>{sug.journalLine.refDate}</strong>
                              {sug.journalLine.memo ? ` • Obs: ${sug.journalLine.memo}` : ''}
                            </div>
                          </div>
                          <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                            <div style={{ fontSize: '11px', color: '#556b82' }}>Valor no Razão</div>
                            <strong style={{ fontSize: '14px', color: '#1d2d3e' }}>
                              {formatEur(Math.abs(sug.journalLine.signedAmount))}
                            </strong>
                          </div>
                        </div>
                      )}

                      {sug.glAccountMatch && (
                        <div
                          style={{
                            fontSize: '12px',
                            background: '#f5f6f7',
                            padding: '8px 10px',
                            borderRadius: '4px',
                            display: 'flex',
                            justifyContent: 'space-between',
                          }}
                        >
                          <span>
                            Conta do Razão SAP B1: <strong>{sug.glAccountMatch.glAccountCode}</strong> —{' '}
                            {sug.glAccountMatch.glAccountName}
                          </span>
                          <strong>{formatEur(sug.matchedAmount)}</strong>
                        </div>
                      )}

                      {sug.allocations && (
                        <table
                          style={{
                            width: '100%',
                            borderCollapse: 'collapse',
                            fontSize: '12px',
                            background: '#fafafa',
                            border: '1px solid #ededed',
                          }}
                        >
                          <thead>
                            <tr style={{ background: '#f0f1f2', textAlign: 'left' }}>
                              <th style={{ padding: '6px 10px' }}>Documento</th>
                              <th style={{ padding: '6px 10px' }}>Vencimento</th>
                              <th style={{ padding: '6px 10px', textAlign: 'right' }}>Montante a Liquidar</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sug.allocations.map((a) => (
                              <tr key={`${a.docType}-${a.docEntry}`} style={{ borderTop: '1px solid #ededed' }}>
                                <td style={{ padding: '6px 10px' }}>
                                  <strong>{a.atDocNumber || `DocNum #${a.docNum}`}</strong>
                                </td>
                                <td style={{ padding: '6px 10px', color: '#556b82' }}>{a.dueDate}</td>
                                <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 700 }}>
                                  {formatEur(a.allocatedAmount)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}

                      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <Button
                          design="Emphasized"
                          disabled={busy || Math.abs(sug.differenceAmount) > 0.01}
                          onClick={() => void handleApproveSuggestion(sug)}
                        >
                          Lançar &amp; Reconciliar
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* TAB 2: OPEN INVOICES & CREDIT MEMOS (FULL SAP B1 PAYMENT DOCUMENT TABLE) */}
            {activeTab === 'OPEN_DOCS' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {/* Filter & Search Toolbar */}
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <Select
                    onChange={(e) => {
                      const sr = e.detail.selectedOption?.getAttribute('data-series');
                      if (sr) {
                        setSelectedSeries(sr);
                        setDocPage(1);
                      }
                    }}
                  >
                    <Option data-series="ALL" selected={selectedSeries === 'ALL'}>
                      Todas as Séries ({openDocs.length})
                    </Option>
                    {availableSeries.map((s) => (
                      <Option key={s.name} data-series={s.name} selected={selectedSeries === s.name}>
                        {s.name} ({s.count})
                      </Option>
                    ))}
                  </Select>

                  <Input
                    placeholder="Filtrar por Nº Doc, Ref. Parceiro, CardCode, Nome, NIF ou Valor..."
                    value={manualSearch}
                    style={{ flex: 1, minWidth: '200px' }}
                    onInput={(e) => {
                      setManualSearch((e.target as unknown as { value: string }).value);
                      setDocPage(1);
                    }}
                  />

                  <Button
                    design="Transparent"
                    onClick={() => {
                      setManualSearch(line.amount.toFixed(2).replace('.', ','));
                      setDocPage(1);
                    }}
                  >
                    Valor ({formatEur(line.amount)})
                  </Button>
                  <Button
                    design="Transparent"
                    disabled={manualLoading}
                    onClick={() => loadCandidates(true)}
                  >
                    Atualizar
                  </Button>
                  {(manualSearch || selectedSeries !== 'ALL') && (
                    <Button
                      design="Transparent"
                      onClick={() => {
                        setManualSearch('');
                        setSelectedSeries('ALL');
                        setDocPage(1);
                      }}
                    >
                      Limpar
                    </Button>
                  )}
                </div>

                {manualLoading ? (
                  <div style={{ padding: '24px', textAlign: 'center' }}>
                    <BusyIndicator active size="M" />
                  </div>
                ) : (
                  <>
                    {/* Table Subheader + Pagination Bar */}
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: '8px',
                        fontSize: '12px',
                        color: '#556b82',
                      }}
                    >
                      <span>
                        Documentos em Aberto (<strong>{filteredOpenDocs.length}</strong> de {openDocs.length})
                      </span>
                      {filteredOpenDocs.length > DOCS_PAGE_SIZE && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          {!showAllDocs && (
                            <>
                              <Button
                                design="Transparent"
                                disabled={safeDocPage <= 1}
                                onClick={() => setDocPage((p) => Math.max(1, p - 1))}
                              >
                                ◀
                              </Button>
                              <span>
                                Pág. <strong>{safeDocPage}</strong> / <strong>{totalDocPages}</strong>
                              </span>
                              <Button
                                design="Transparent"
                                disabled={safeDocPage >= totalDocPages}
                                onClick={() => setDocPage((p) => Math.min(totalDocPages, p + 1))}
                              >
                                ▶
                              </Button>
                            </>
                          )}
                          <Button design="Transparent" onClick={() => setShowAllDocs((v) => !v)}>
                            {showAllDocs ? `${DOCS_PAGE_SIZE}/pág` : `Ver Todos (${filteredOpenDocs.length})`}
                          </Button>
                        </div>
                      )}
                    </div>

                    {/* SAP B1 Web Client Incoming/Outgoing Payment Document Selection Table */}
                    <div
                      style={{
                        maxHeight: '380px',
                        overflowY: 'auto',
                        border: '1px solid #d9d9d9',
                        borderRadius: '4px',
                      }}
                    >
                      {filteredOpenDocs.length === 0 ? (
                        <div style={{ padding: '24px', fontSize: '12.5px', color: '#556b82', textAlign: 'center' }}>
                          Nenhum documento em aberto encontrado para &quot;{manualSearch}&quot;.
                        </div>
                      ) : (
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                          <thead>
                            <tr
                              style={{
                                background: '#f5f6f7',
                                borderBottom: '1px solid #d9d9d9',
                                textAlign: 'left',
                                position: 'sticky',
                                top: 0,
                                zIndex: 1,
                              }}
                            >
                              <th style={{ padding: '6px 8px', width: '32px' }} />
                              <th style={{ padding: '6px 8px' }}>Série / Nº Doc.</th>
                              <th style={{ padding: '6px 8px' }}>Parceiro de Negócios</th>
                              <th style={{ padding: '6px 8px' }}>Vencimento</th>
                              <th style={{ padding: '6px 8px', textAlign: 'right' }}>Saldo Aberto</th>
                              <th style={{ padding: '6px 8px', textAlign: 'right', width: '120px' }}>
                                Pagamento Total
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {visibleOpenDocs.map((d) => {
                              const checked = allocatedByDocEntry[d.docEntry] !== undefined;
                              const isCreditMemo =
                                d.docType === 'AR_CREDIT_MEMO' || d.docType === 'AP_CREDIT_MEMO';
                              return (
                                <tr
                                  key={`${d.docType}-${d.docEntry}`}
                                  onClick={() => {
                                    if (!checked) toggleDocumentSelection(d);
                                  }}
                                  style={{
                                    borderBottom: '1px solid #efefef',
                                    background: checked ? '#ebf5fe' : '#ffffff',
                                    cursor: checked ? 'default' : 'pointer',
                                  }}
                                >
                                  <td
                                    style={{ padding: '4px 6px', textAlign: 'center' }}
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <CheckBox
                                      checked={checked}
                                      onChange={() => toggleDocumentSelection(d)}
                                    />
                                  </td>
                                  <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
                                    <div>
                                      {d.seriesName ? (
                                        <span style={{ color: '#556b82', marginRight: '4px' }}>
                                          {d.seriesName}
                                        </span>
                                      ) : null}
                                      <strong>#{d.docNum}</strong>
                                      {isCreditMemo && (
                                        <span style={{ color: '#e9730c', marginLeft: '4px', fontWeight: 600 }}>
                                          (NC)
                                        </span>
                                      )}
                                    </div>
                                    {d.atDocNumber && d.atDocNumber !== `${d.seriesName}/${d.docNum}` && (
                                      <div style={{ fontSize: '11px', color: '#6a6d70' }}>
                                        Ref: {d.atDocNumber}
                                      </div>
                                    )}
                                  </td>
                                  <td style={{ padding: '6px 8px' }}>
                                    <div style={{ fontWeight: 600, color: '#1d2d3e' }}>{d.cardName}</div>
                                    <div style={{ fontSize: '11px', color: '#6a6d70' }}>{d.cardCode}</div>
                                  </td>
                                  <td style={{ padding: '6px 8px', whiteSpace: 'nowrap', color: '#556b82' }}>
                                    {d.dueDate}
                                  </td>
                                  <td
                                    style={{
                                      padding: '6px 8px',
                                      textAlign: 'right',
                                      whiteSpace: 'nowrap',
                                      fontWeight: 600,
                                    }}
                                  >
                                    {formatEur(d.openAmount)}
                                  </td>
                                  <td
                                    style={{ padding: '4px 8px', textAlign: 'right' }}
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    {checked ? (
                                      <Input
                                        accessibleName={`Valor a liquidar no documento ${d.docNum}`}
                                        value={
                                          allocatedTextByDocEntry[d.docEntry] ??
                                          String(allocatedByDocEntry[d.docEntry] ?? d.openAmount)
                                        }
                                        style={{ width: '110px', textAlign: 'right' }}
                                        onInput={(e) => {
                                          const raw = (e.target as unknown as { value: string }).value;
                                          setAllocatedTextByDocEntry((prev) => ({
                                            ...prev,
                                            [d.docEntry]: raw,
                                          }));
                                          const normalized = raw.replace(/\s/g, '').replace(',', '.');
                                          const num = parseFloat(normalized);
                                          setAllocatedByDocEntry((prev) => ({
                                            ...prev,
                                            [d.docEntry]: Number.isFinite(num) ? num : 0,
                                          }));
                                        }}
                                      />
                                    ) : (
                                      <span style={{ color: '#adb5bd' }}>—</span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      )}
                    </div>

                    {selectedDocs.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
                        {selectedDocs.map((sd) => (
                          <Tag key={sd.docEntry} design="Set2" colorScheme="6" hideStateIcon>
                            {sd.atDocNumber || `#${sd.docNum}`} • {sd.cardCode} (
                            {formatEur(allocatedByDocEntry[sd.docEntry] ?? sd.openAmount)})
                          </Tag>
                        ))}
                      </div>
                    )}

                    {selectedDocs.length > 0 && manualDiff > 0.009 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
                        <CheckBox
                          checked={allowPaymentOnAccount}
                          onChange={() => setAllowPaymentOnAccount((v) => !v)}
                        />
                        <span>
                          Lançar excedente de <strong>{formatEur(manualDiff)}</strong> como{' '}
                          <strong>Pagamento por Conta</strong> no Parceiro ({selectedDocs[0].cardCode})
                        </span>
                      </div>
                    )}

                    {/* Object Page Sticky Footer Bar */}
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '10px 12px',
                        background: '#f5f6f7',
                        border: '1px solid #d9d9d9',
                        borderRadius: '4px',
                      }}
                    >
                      <div style={{ fontSize: '12.5px' }}>
                        <span>
                          Montante Selecionado:{' '}
                          <strong>{formatEur(manualSelectedTotal + effectiveOnAccount)}</strong>
                        </span>
                        <span style={{ margin: '0 8px', color: '#d9d9d9' }}>|</span>
                        <span
                          style={{
                            color: canSubmitManualInvoices ? '#107e3e' : '#bb0000',
                            fontWeight: 600,
                          }}
                        >
                          Diferença: {formatEur(manualDiff - effectiveOnAccount)}
                        </span>
                      </div>
                      <Button
                        design="Emphasized"
                        disabled={busy || !canSubmitManualInvoices}
                        onClick={() => void handleManualInvoicesApprove()}
                      >
                        Criar Pagamento &amp; Reconciliar
                      </Button>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* TAB 3: UNRECONCILED JOURNAL ENTRIES (JDT1) */}
            {activeTab === 'JOURNAL' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <Input
                    placeholder="Filtrar lançamentos por Nº Doc, TransId, Parceiro, Observações ou Valor..."
                    value={manualSearch}
                    style={{ flex: 1 }}
                    onInput={(e) => setManualSearch((e.target as unknown as { value: string }).value)}
                  />
                  <Button
                    design="Transparent"
                    onClick={() => setManualSearch(line.amount.toFixed(2).replace('.', ','))}
                  >
                    Valor ({formatEur(line.amount)})
                  </Button>
                  {manualSearch && (
                    <Button design="Transparent" onClick={() => setManualSearch('')}>
                      Limpar
                    </Button>
                  )}
                </div>

                {manualLoading ? (
                  <BusyIndicator active size="M" />
                ) : filteredJournalLines.length === 0 ? (
                  <div
                    style={{
                      padding: '24px',
                      border: '1px solid #e5e5e5',
                      borderRadius: '4px',
                      textAlign: 'center',
                      fontSize: '12.5px',
                      color: '#556b82',
                    }}
                  >
                    Nenhum lançamento contabilístico pendente encontrado na Conta G/L {line.glAccountCode}.
                  </div>
                ) : (
                  <div
                    style={{
                      maxHeight: '380px',
                      overflowY: 'auto',
                      border: '1px solid #d9d9d9',
                      borderRadius: '4px',
                    }}
                  >
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                      <thead>
                        <tr style={{ background: '#f5f6f7', borderBottom: '1px solid #d9d9d9', textAlign: 'left' }}>
                          <th style={{ padding: '8px' }}>Nº Doc. / TransId</th>
                          <th style={{ padding: '8px' }}>Data</th>
                          <th style={{ padding: '8px' }}>Parceiro / Observações</th>
                          <th style={{ padding: '8px', textAlign: 'right' }}>Montante</th>
                          <th style={{ padding: '8px', textAlign: 'right' }}>Ação</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredJournalLines.map((je) => {
                          const amountMatches = Math.abs(je.signedAmount - line.signedAmount) < 0.01;
                          return (
                            <tr
                              key={`${je.transId}-${je.lineId}`}
                              style={{
                                borderBottom: '1px solid #efefef',
                                background: amountMatches ? '#f9fef9' : '#ffffff',
                              }}
                            >
                              <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>
                                <div>
                                  <strong>Doc. #{je.sourceDocNum || je.ref1 || je.ref2 || '—'}</strong>
                                </div>
                                <div style={{ fontSize: '11px', color: '#6a6d70' }}>OJDT #{je.transId}</div>
                              </td>
                              <td style={{ padding: '8px', whiteSpace: 'nowrap', color: '#556b82' }}>
                                {je.refDate}
                              </td>
                              <td style={{ padding: '8px' }}>
                                <div style={{ fontWeight: 600, color: '#1d2d3e' }}>
                                  {je.cardCode ? `${je.cardCode} — ` : ''}
                                  {je.cardName || je.memo || '—'}
                                </div>
                                {je.memo && je.cardName && (
                                  <div style={{ fontSize: '11px', color: '#6a6d70' }}>{je.memo}</div>
                                )}
                              </td>
                              <td
                                style={{
                                  padding: '8px',
                                  textAlign: 'right',
                                  whiteSpace: 'nowrap',
                                  fontWeight: 700,
                                  color: amountMatches ? '#107e3e' : '#556b82',
                                }}
                              >
                                {formatEur(Math.abs(je.signedAmount))}
                              </td>
                              <td style={{ padding: '8px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                                <Button
                                  design={amountMatches ? 'Emphasized' : 'Default'}
                                  disabled={busy || !amountMatches}
                                  onClick={() => void handleManualJournalReconcile(je)}
                                >
                                  Reconciliar
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
            )}

            {/* TAB 4: DIRECT G/L ACCOUNT POSTING */}
            {activeTab === 'DIRECT_GL' && (
              <div
                style={{
                  border: '1px solid #e5e5e5',
                  borderRadius: '4px',
                  padding: '14px',
                  background: '#fafafa',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                }}
              >
                <div style={{ fontSize: '12.5px', color: '#556b82' }}>
                  Contabiliza um Pagamento ou Recebimento direto em Conta do Razão (SAP B1{' '}
                  <code>DocType = rAccount</code>) para despesas bancárias, comissões, imposto do selo ou juros, e
                  reconcilia automaticamente a linha do extrato.
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr auto', gap: '10px', alignItems: 'end' }}>
                  <div>
                    <Label style={{ display: 'block', marginBottom: '4px' }}>Regra / Conta Predefinida</Label>
                    <Select
                      style={{ width: '100%' }}
                      onChange={(e) => {
                        const code = e.detail.selectedOption?.getAttribute('data-gl');
                        if (code) setDirectGlCode(code);
                      }}
                    >
                      {glRules.map((r) => (
                        <Option
                          key={r.id}
                          data-gl={r.glAccountCode}
                          selected={directGlCode === r.glAccountCode}
                        >
                          {r.glAccountCode} — {r.glAccountName}
                        </Option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <Label style={{ display: 'block', marginBottom: '4px' }}>Conta do Razão (G/L)</Label>
                    <Input
                      placeholder="Ex: 622701"
                      value={directGlCode}
                      style={{ width: '100%' }}
                      onInput={(e) => setDirectGlCode((e.target as unknown as { value: string }).value)}
                    />
                  </div>
                  <Button
                    design="Emphasized"
                    disabled={busy || !directGlCode.trim()}
                    onClick={() => void handleManualDirectGlReconcile()}
                  >
                    Lançar &amp; Reconciliar ({formatEur(line.amount)})
                  </Button>
                </div>
              </div>
            )}
          </>
        )}

        {/* Expandable Raw Statement Record Footer */}
        <div style={{ borderTop: '1px solid #efefef', paddingTop: '6px' }}>
          <Button design="Transparent" onClick={() => setShowRaw((v) => !v)}>
            {showRaw ? '▾ Ocultar Registo Original do Extrato' : '▸ Ver Registo Original do Extrato'}
          </Button>
          {showRaw && (
            <pre
              style={{
                marginTop: '6px',
                marginBottom: 0,
                padding: '10px',
                background: '#f5f6f7',
                color: '#32363a',
                border: '1px solid #d9d9d9',
                borderRadius: '4px',
                fontSize: '11px',
                overflowX: 'auto',
              }}
            >
              {`SHA-256: ${line.fingerprint}\n${line.rawNarrative || line.description}`}
            </pre>
          )}
        </div>
      </div>
    </section>
  );
};
