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
  MessageStrip,
  ObjectStatus,
  Option,
  SegmentedButton,
  SegmentedButtonItem,
  Select,
  Tag,
} from '@ui5/webcomponents-react';
import { api, formatEur } from '../api';

interface Props {
  line: StagedBankLine;
  onActionSuccess: (msg: string) => void;
}

export const SuggestionInspector: React.FC<Props> = ({ line, onActionSuccess }) => {
  const [mode, setMode] = useState<'SUGGESTIONS' | 'MANUAL'>('SUGGESTIONS');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  // Manual candidate picker state
  const [manualLoading, setManualLoading] = useState(false);
  const [manualSearch, setManualSearch] = useState<string>('');
  const [selectedSeries, setSelectedSeries] = useState<string>('ALL');
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
    setAllocatedByDocEntry({});
    setAllocatedTextByDocEntry({});
    setAllowPaymentOnAccount(false);
    setShowRaw(false);
    setMode('SUGGESTIONS');
  }, [line.id]);

  useEffect(() => {
    if (mode !== 'MANUAL') return;
    setManualLoading(true);
    Promise.all([
      api.getManualCandidates(line.direction, line.glAccountCode),
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
  }, [mode, line.direction, line.glAccountCode]);

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
      // Smart partial payment default: if invoice is larger than remaining bank amount, prefill remaining bank amount
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

  return (
    <div
      style={{
        background: '#ffffff',
        border: '1px solid #d9d9d9',
        borderRadius: '10px',
        padding: '18px',
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
        height: '100%',
        boxSizing: 'border-box',
      }}
    >
      {/* Movement Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <Tag colorScheme="6">
              Banco {line.bankCode} • {line.transactionCode}
            </Tag>
            <span style={{ fontSize: '12px', color: '#556b82' }}>
              Data Valor: {line.valueDate} • Conta G/L: {line.glAccountCode}
            </span>
          </div>
          <div style={{ fontWeight: 700, fontSize: '15px', color: '#1d2d3e' }}>{line.description}</div>
        </div>
        <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
          <div
            style={{
              fontSize: '20px',
              fontWeight: 700,
              color: line.direction === 'CREDIT' ? '#188918' : '#aa0808',
            }}
          >
            {line.direction === 'CREDIT' ? '+' : '-'}
            {formatEur(line.amount)}
          </div>
          <div style={{ fontSize: '11px', color: '#556b82' }}>
            {line.direction === 'CREDIT' ? 'Entrada (Crédito Bancário)' : 'Saída (Débito Bancário)'}
          </div>
        </div>
      </div>

      {/* Extracted Portuguese Entities */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '6px',
          background: '#f5f6f7',
          padding: '10px 12px',
          borderRadius: '6px',
          fontSize: '12px',
        }}
      >
        {line.extracted.multibancoRef && (
          <Tag colorScheme="8">
            MB Ent: {line.extracted.multibancoEntity ?? '—'} / Ref: {line.extracted.multibancoRef}
          </Tag>
        )}
        {line.extracted.counterpartyNif && <Tag colorScheme="5">NIF: {line.extracted.counterpartyNif}</Tag>}
        {line.extracted.counterpartyIban && <Tag colorScheme="7">IBAN: {line.extracted.counterpartyIban}</Tag>}
        {line.extracted.invoiceCandidates.map((inv) => (
          <Tag key={inv} colorScheme="3">
            Doc Detetado: {inv}
          </Tag>
        ))}
        {line.bankReference && (
          <span style={{ color: '#556b82', alignSelf: 'center' }}>Ref Banco: {line.bankReference}</span>
        )}
      </div>

      {(error || line.errorMessage) && (
        <MessageStrip design="Negative" hideCloseButton>
          {error || line.errorMessage}
        </MessageStrip>
      )}

      {line.status === 'RECONCILED' ? (
        <MessageStrip design="Positive" hideCloseButton>
          Reconciliado no SAP B1 por <strong>{line.reconciledBy}</strong> — TransId #{line.b1TransId}, Extrato
          BankPage Seq #{line.b1BankPageSequence}
          {line.b1PaymentDocEntry ? `, Pagamento DocEntry #${line.b1PaymentDocEntry}` : ''}.
        </MessageStrip>
      ) : (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <SegmentedButton
              onSelectionChange={(e) => {
                const key = e.detail.selectedItems?.[0]?.getAttribute('data-mode') as
                  | 'SUGGESTIONS'
                  | 'MANUAL'
                  | undefined;
                if (key) setMode(key);
              }}
            >
              <SegmentedButtonItem data-mode="SUGGESTIONS" selected={mode === 'SUGGESTIONS'}>
                Sugestões SAP HANA ({line.suggestions?.length ?? 0})
              </SegmentedButtonItem>
              <SegmentedButtonItem data-mode="MANUAL" selected={mode === 'MANUAL'}>
                Seleção Manual SAP B1
              </SegmentedButtonItem>
            </SegmentedButton>

            {line.status === 'IGNORED' || line.status === 'ERROR' ? (
              <Button design="Default" onClick={() => void handleReopen()} disabled={busy}>
                Reativar Movimento
              </Button>
            ) : (
              <Button design="Transparent" onClick={() => void handleIgnore()} disabled={busy}>
                Ignorar Movimento
              </Button>
            )}
          </div>

          {busy && (
            <div style={{ textAlign: 'center', padding: '8px' }}>
              <BusyIndicator active size="S" />
            </div>
          )}

          {mode === 'SUGGESTIONS' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', overflowY: 'auto' }}>
              {(!line.suggestions || line.suggestions.length === 0) && (
                <MessageStrip design="Information" hideCloseButton>
                  Nenhuma correspondência automática encontrada no SAP HANA. Utilize o separador &quot;Seleção
                  Manual SAP B1&quot; para selecionar faturas abertas, notas de crédito, lançamentos no Razão ou
                  contabilizar diretamente numa Conta G/L.
                </MessageStrip>
              )}

              {line.suggestions?.map((sug) => (
                <div
                  key={sug.id}
                  style={{
                    border: sug.confidence >= 85 ? '1.5px solid #188918' : '1px solid #d9d9d9',
                    borderRadius: '8px',
                    padding: '14px',
                    background: sug.confidence >= 85 ? '#f9fef9' : '#ffffff',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '14px' }}>
                        {sug.targetType === 'EXISTING_JOURNAL_ENTRY' &&
                          `Reconciliar Lançamento Existente (OJDT #${sug.journalLine?.transId})`}
                        {sug.targetType === 'OPEN_AR_INVOICE' && 'Criar Recebimento de Cliente + Reconciliar'}
                        {sug.targetType === 'OPEN_AP_INVOICE' && 'Criar Pagamento a Fornecedor + Reconciliar'}
                        {sug.targetType === 'MULTI_INVOICE_BUNDLE' &&
                          `Criar Pagamento Agrupado (${sug.allocations?.length} Documentos) + Reconciliar`}
                        {sug.targetType === 'DIRECT_GL_ACCOUNT' &&
                          'Contabilização Direta em Conta G/L (Despesas / Juros) + Reconciliar'}
                      </div>
                      <div style={{ fontSize: '13px', color: '#556b82' }}>
                        {sug.cardCode ? `${sug.cardCode} — ` : ''}
                        <strong>{sug.cardName}</strong>
                        {sug.nif ? ` (NIF ${sug.nif})` : ''}
                      </div>
                    </div>

                    <ObjectStatus
                      state={
                        sug.confidence >= 85 ? 'Positive' : sug.confidence >= 70 ? 'Critical' : 'Information'
                      }
                      showDefaultIcon
                    >
                      Confiança {sug.confidence}%
                    </ObjectStatus>
                  </div>

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {sug.reasons.map((r) => (
                      <Tag key={r} colorScheme="8">
                        {r}
                      </Tag>
                    ))}
                  </div>

                  {sug.journalLine && (
                    <div
                      style={{
                        fontSize: '12px',
                        background: '#f5f6f7',
                        padding: '8px 10px',
                        borderRadius: '6px',
                      }}
                    >
                      TransId <strong>#{sug.journalLine.transId}</strong> • Data {sug.journalLine.refDate} • Ref:{' '}
                      {sug.journalLine.ref2 || sug.journalLine.ref1 || '—'} • {sug.journalLine.memo}
                    </div>
                  )}

                  {sug.glAccountMatch && (
                    <div
                      style={{
                        fontSize: '12px',
                        background: '#f5f6f7',
                        padding: '8px 10px',
                        borderRadius: '6px',
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
                    <div
                      style={{
                        fontSize: '12px',
                        background: '#f5f6f7',
                        padding: '8px 10px',
                        borderRadius: '6px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px',
                      }}
                    >
                      {sug.allocations.map((a) => (
                        <div
                          key={`${a.docType}-${a.docEntry}`}
                          style={{ display: 'flex', justifyContent: 'space-between' }}
                        >
                          <span>
                            <strong>{a.atDocNumber || `DocNum #${a.docNum}`}</strong> (Venc: {a.dueDate})
                          </span>
                          <strong>{formatEur(a.allocatedAmount)}</strong>
                        </div>
                      ))}
                    </div>
                  )}

                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <Button
                      design={sug.confidence >= 85 ? 'Positive' : 'Emphasized'}
                      disabled={busy || Math.abs(sug.differenceAmount) > 0.01}
                      onClick={() => void handleApproveSuggestion(sug)}
                    >
                      Aprovar &amp; Reconciliar no SAP B1
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {mode === 'MANUAL' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', overflowY: 'auto' }}>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <Select
                  onChange={(e) => {
                    const sr = e.detail.selectedOption?.getAttribute('data-series');
                    if (sr) setSelectedSeries(sr);
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
                  placeholder="Pesquisar Série, Nº Doc, CardCode, CardName ou Valor (ex: 1042, C10010, 1845,00)..."
                  value={manualSearch}
                  style={{ flex: 1, minWidth: '220px' }}
                  onInput={(e) => setManualSearch((e.target as unknown as { value: string }).value)}
                />
                <Button
                  design="Transparent"
                  onClick={() => setManualSearch(line.amount.toFixed(2).replace('.', ','))}
                >
                  Valor Exato ({formatEur(line.amount)})
                </Button>
                {(manualSearch || selectedSeries !== 'ALL') && (
                  <Button
                    design="Transparent"
                    onClick={() => {
                      setManualSearch('');
                      setSelectedSeries('ALL');
                    }}
                  >
                    Limpar
                  </Button>
                )}
              </div>

              {manualLoading ? (
                <BusyIndicator active size="M" />
              ) : (
                <>
                  <div style={{ fontWeight: 600, fontSize: '13px' }}>
                    1. Faturas &amp; Notas de Crédito em Aberto ({line.direction === 'CREDIT' ? 'Clientes OINV/ORIN' : 'Fornecedores OPCH/ORPC'} — {filteredOpenDocs.length})
                  </div>
                  <div
                    style={{
                      maxHeight: '210px',
                      overflowY: 'auto',
                      border: '1px solid #e5e5e5',
                      borderRadius: '6px',
                    }}
                  >
                    {filteredOpenDocs.length === 0 ? (
                      <div style={{ padding: '14px', fontSize: '12px', color: '#556b82', textAlign: 'center' }}>
                        Nenhum documento em aberto encontrado para &quot;{manualSearch}&quot;.
                      </div>
                    ) : (
                      filteredOpenDocs.map((d) => {
                        const checked = allocatedByDocEntry[d.docEntry] !== undefined;
                        const isCreditMemo =
                          d.docType === 'AR_CREDIT_MEMO' || d.docType === 'AP_CREDIT_MEMO';
                        return (
                          <div
                            key={`${d.docType}-${d.docEntry}`}
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              padding: '6px 10px',
                              borderBottom: '1px solid #f0f0f0',
                              background: checked ? '#f0f7ff' : '#ffffff',
                              fontSize: '12px',
                              gap: '8px',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1 }}>
                              <CheckBox
                                checked={checked}
                                onChange={() => toggleDocumentSelection(d)}
                              />
                              <div>
                                {d.seriesName && (
                                  <Tag colorScheme="7" style={{ marginRight: '6px' }}>
                                    {d.seriesName}
                                  </Tag>
                                )}
                                <strong>#{d.docNum}</strong>
                                {d.atDocNumber && d.atDocNumber !== `${d.seriesName}/${d.docNum}`
                                  ? ` (${d.atDocNumber})`
                                  : ''}
                                {isCreditMemo ? ' [Nota de Crédito]' : ''} — {d.cardName}{' '}
                                <span style={{ color: '#556b82' }}>({d.cardCode})</span>
                              </div>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span style={{ color: '#556b82', fontSize: '11px' }}>
                                Saldo: {formatEur(d.openAmount)}
                              </span>
                              {checked && (
                                <Input
                                  accessibleName={`Valor a liquidar no documento ${d.docNum}`}
                                  value={
                                    allocatedTextByDocEntry[d.docEntry] ??
                                    String(allocatedByDocEntry[d.docEntry] ?? d.openAmount)
                                  }
                                  style={{ width: '115px', textAlign: 'right' }}
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
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>

                  {selectedDocs.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
                      {selectedDocs.map((sd) => (
                        <Tag key={sd.docEntry} colorScheme="6">
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
                        <strong>Pagamento por Conta</strong> no Parceiro de Negócios ({selectedDocs[0].cardCode})
                      </span>
                    </div>
                  )}

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span
                      style={{
                        fontSize: '12px',
                        color: canSubmitManualInvoices ? '#188918' : '#556b82',
                      }}
                    >
                      Liquidado: <strong>{formatEur(manualSelectedTotal + effectiveOnAccount)}</strong> (Diferença:{' '}
                      {formatEur(manualDiff - effectiveOnAccount)})
                    </span>
                    <Button
                      design="Emphasized"
                      disabled={busy || !canSubmitManualInvoices}
                      onClick={() => void handleManualInvoicesApprove()}
                    >
                      Criar Pagamento &amp; Reconciliar
                    </Button>
                  </div>

                  <div style={{ fontWeight: 600, fontSize: '13px', marginTop: '4px' }}>
                    2. Lançamentos Não Reconciliados na Conta G/L {line.glAccountCode} (JDT1 —{' '}
                    {filteredJournalLines.length})
                  </div>
                  {filteredJournalLines.length === 0 ? (
                    <div style={{ fontSize: '12px', color: '#556b82' }}>
                      Nenhum lançamento contabilístico pendente encontrado nesta conta G/L.
                    </div>
                  ) : (
                    filteredJournalLines.map((je) => {
                      const amountMatches = Math.abs(je.signedAmount - line.signedAmount) < 0.01;
                      return (
                        <div
                          key={`${je.transId}-${je.lineId}`}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '8px 10px',
                            border: '1px solid #e5e5e5',
                            borderRadius: '6px',
                            fontSize: '12px',
                            gap: '8px',
                          }}
                        >
                          <div>
                            <strong>TransId #{je.transId}</strong>
                            {je.sourceDocNum ? ` (Doc #${je.sourceDocNum})` : ''} • {je.refDate} —{' '}
                            {je.cardName || je.memo}{' '}
                            {je.cardCode ? <span style={{ color: '#556b82' }}>({je.cardCode})</span> : null}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', whiteSpace: 'nowrap' }}>
                            <strong style={{ color: amountMatches ? '#188918' : '#556b82' }}>
                              {formatEur(Math.abs(je.signedAmount))}
                            </strong>
                            <Button
                              design={amountMatches ? 'Emphasized' : 'Default'}
                              disabled={busy || !amountMatches}
                              onClick={() => void handleManualJournalReconcile(je)}
                            >
                              Reconciliar
                            </Button>
                          </div>
                        </div>
                      );
                    })
                  )}

                  {/* 3. Direct G/L Account Booking (Bank Fees, Stamp Duty, Interest) */}
                  <div style={{ fontWeight: 600, fontSize: '13px', marginTop: '4px' }}>
                    3. Contabilização Direta em Conta do Razão G/L (Comissões, Imposto do Selo, Juros)
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      gap: '8px',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      background: '#f8f9fa',
                      padding: '10px',
                      borderRadius: '6px',
                      border: '1px solid #e5e5e5',
                    }}
                  >
                    <Select
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
                    <Input
                      placeholder="Código Conta G/L"
                      value={directGlCode}
                      style={{ width: '130px' }}
                      onInput={(e) => setDirectGlCode((e.target as unknown as { value: string }).value)}
                    />
                    <Button
                      design="Default"
                      disabled={busy || !directGlCode.trim()}
                      onClick={() => void handleManualDirectGlReconcile()}
                    >
                      Lançar em Conta G/L &amp; Reconciliar
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}

      {/* Expandable Raw Statement Record Footer */}
      <div style={{ borderTop: '1px solid #efefef', paddingTop: '8px' }}>
        <Button design="Transparent" onClick={() => setShowRaw((v) => !v)}>
          {showRaw ? '▾ Ocultar Registo Bruto do Extrato' : '▸ Ver Registo Bruto do Extrato & Chave SHA-256'}
        </Button>
        {showRaw && (
          <pre
            style={{
              marginTop: '8px',
              marginBottom: 0,
              padding: '10px',
              background: '#1d2d3e',
              color: '#e5f0ff',
              borderRadius: '6px',
              fontSize: '11px',
              overflowX: 'auto',
            }}
          >
            {`SHA-256 Fingerprint: ${line.fingerprint}\n${line.rawNarrative || line.description}`}
          </pre>
        )}
      </div>
    </div>
  );
};
