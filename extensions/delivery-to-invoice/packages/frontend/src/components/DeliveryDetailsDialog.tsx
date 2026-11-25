import React, { useState } from 'react';
import {
  evaluateDeliveryNoteChecks,
  type OpenDeliveryNote,
} from '@b1-d2i/shared';
import {
  Bar,
  Button,
  Dialog,
  MessageStrip,
  ObjectStatus,
  Tag,
} from '@ui5/webcomponents-react';
import { formatMoney } from '../api';

interface DeliveryDetailsDialogProps {
  delivery: OpenDeliveryNote | null;
  onClose: () => void;
}

type ModalTab = 'ITEMS' | 'LINES' | 'GENERAL';

export function DeliveryDetailsDialog({ delivery, onClose }: DeliveryDetailsDialogProps) {
  const [activeTab, setActiveTab] = useState<ModalTab>('ITEMS');

  const validation = delivery
    ? (delivery.validation ?? evaluateDeliveryNoteChecks(delivery))
    : null;

  const netSubTotal = delivery
    ? delivery.lines.reduce((s, l) => s + l.lineTotal, 0)
    : 0;

  return (
    <Dialog
      open={Boolean(delivery)}
      headerText={
        delivery
          ? `Guia de remessa GR ${delivery.docNum} — ${delivery.cardName}`
          : 'Guia de remessa'
      }
      onClose={onClose}
      footer={
        <Bar
          endContent={
            <Button design="Emphasized" onClick={onClose}>
              Fechar
            </Button>
          }
        />
      }
    >
      {delivery && validation && (
        <div
          style={{
            width: '920px',
            maxWidth: '90vw',
            display: 'flex',
            flexDirection: 'column',
            background: '#f5f6f7',
            borderRadius: '8px',
            overflow: 'hidden',
            border: '1px solid #e5e8eb',
            fontFamily: '"72", "72full", Arial, Helvetica, sans-serif',
          }}
        >
          {/* SAP Fiori ObjectPage Modal Header with Facets */}
          <div style={{ background: '#ffffff', padding: '16px 28px 18px 28px' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '32px', alignItems: 'flex-start' }}>
              <div style={facetColStyle}>
                <span style={facetLabelStyle}>Parceiro de negócios</span>
                <span style={facetValueStyle}>{delivery.cardName}</span>
                <span style={facetSubStyle}>
                  {delivery.cardCode} • NIF: {delivery.federalTaxId || '—'}
                </span>
              </div>

              <div style={facetColStyle}>
                <span style={facetLabelStyle}>Datas do documento</span>
                <span style={facetValueStyle}>{delivery.docDate}</span>
                <span style={facetSubStyle}>Vencimento: {delivery.docDueDate}</span>
              </div>

              <div style={facetColStyle}>
                <span style={facetLabelStyle}>Valor líquido / Total</span>
                <span style={facetValueStyle}>
                  {formatMoney(delivery.docTotal, delivery.docCurrency)}
                </span>
                <span style={facetSubStyle}>
                  Líq.: {formatMoney(netSubTotal, delivery.docCurrency)} • IVA:{' '}
                  {formatMoney(delivery.vatSum, delivery.docCurrency)}
                </span>
              </div>

              <div style={{ ...facetColStyle, minWidth: '170px' }}>
                <span style={facetLabelStyle}>Margem mínima do documento</span>
                <span
                  style={{
                    ...facetValueStyle,
                    color: validation.hasMarginWarning ? '#aa0808' : '#256f3a',
                  }}
                >
                  {validation.lowestItemMarginPercent !== null
                    ? `${validation.lowestItemMarginPercent.toFixed(1)}%`
                    : '—'}{' '}
                  (Mín. exigido: {validation.minMarginThreshold}%)
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
                        width: `${Math.max(
                          0,
                          Math.min(100, validation.lowestItemMarginPercent ?? 0)
                        )}%`,
                        height: '100%',
                        background: validation.passed ? '#256f3a' : '#e76500',
                        borderRadius: '4px',
                      }}
                    />
                  </div>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '15px',
                      height: '15px',
                      borderRadius: '50%',
                      background: validation.passed ? '#256f3a' : '#e76500',
                      color: '#ffffff',
                      fontSize: '10px',
                      fontWeight: 700,
                    }}
                  >
                    {validation.passed ? '✓' : '!'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Fiori Anchor Tab Bar */}
          <div
            style={{
              background: '#ffffff',
              borderTop: '1px solid #eceef0',
              borderBottom: '2px solid #0032a5',
              padding: '0 28px',
              display: 'flex',
              gap: '24px',
            }}
          >
            <button
              type="button"
              onClick={() => setActiveTab('ITEMS')}
              style={modalTabStyle(activeTab === 'ITEMS')}
            >
              Análise de preços e margens por artigo ({validation.itemSummaries.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('LINES')}
              style={modalTabStyle(activeTab === 'LINES')}
            >
              Linhas do documento ({validation.lineResults.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('GENERAL')}
              style={modalTabStyle(activeTab === 'GENERAL')}
            >
              Geral
            </button>
          </div>

          {/* Section Canvas */}
          <div style={{ padding: '18px 28px 24px 28px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {!validation.passed && (
              <MessageStrip design="Critical" hideCloseButton>
                <div>
                  <strong>Alertas de validação comercial ({validation.warnings.length}):</strong>
                  <ul style={{ margin: '4px 0 0 18px', padding: 0 }}>
                    {validation.warnings.map((w, idx) => (
                      <li key={idx}>{w}</li>
                    ))}
                  </ul>
                </div>
              </MessageStrip>
            )}

            {activeTab === 'ITEMS' && (
              <div style={whiteCardStyle}>
                <div style={{ fontSize: '14px', fontWeight: 700, color: '#1d2d3e', marginBottom: '12px' }}>
                  Resumo por artigo (média calculada quando existem múltiplas linhas do mesmo artigo)
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                    <thead>
                      <tr
                        style={{
                          borderBottom: '1px solid #d9d9d9',
                          background: '#f5f6f7',
                          textAlign: 'left',
                          color: '#556b82',
                          fontSize: '12px',
                        }}
                      >
                        <th style={{ padding: '9px' }}>Artigo</th>
                        <th style={{ padding: '9px' }}>Linhas / Qtd.</th>
                        <th style={{ padding: '9px', textAlign: 'right' }}>Preço médio atual</th>
                        <th style={{ padding: '9px', textAlign: 'right' }}>Últ. preço faturado</th>
                        <th style={{ padding: '9px' }}>Controlo de preço</th>
                        <th style={{ padding: '9px', textAlign: 'right' }}>Custo médio</th>
                        <th style={{ padding: '9px', textAlign: 'right' }}>Margem média (%)</th>
                        <th style={{ padding: '9px' }}>Controlo de margem</th>
                      </tr>
                    </thead>
                    <tbody>
                      {validation.itemSummaries.map((item) => (
                        <tr key={item.itemCode} style={{ borderBottom: '1px solid #edf0f3' }}>
                          <td style={{ padding: '9px' }}>
                            <div style={{ fontWeight: 600 }}>{item.itemCode}</div>
                            <div style={{ fontSize: '11.5px', color: '#556b82' }}>
                              {item.itemDescription}
                            </div>
                          </td>
                          <td style={{ padding: '9px' }}>
                            <div>{item.totalQuantity} un.</div>
                            {item.rowCount > 1 && (
                              <Tag design="Information">{item.rowCount} linhas (média)</Tag>
                            )}
                          </td>
                          <td style={{ padding: '9px', textAlign: 'right', fontWeight: 700 }}>
                            {formatMoney(item.avgUnitPrice, delivery.docCurrency)}
                          </td>
                          <td style={{ padding: '9px', textAlign: 'right' }}>
                            {item.lastInvoicedPrice !== null ? (
                              <div>
                                <div style={{ fontWeight: 600 }}>
                                  {formatMoney(item.lastInvoicedPrice, delivery.docCurrency)}
                                </div>
                                {item.lastInvoicedDocNum && (
                                  <div style={{ fontSize: '11px', color: '#556b82' }}>
                                    FT {item.lastInvoicedDocNum}
                                    {item.lastInvoicedDate ? ` (${item.lastInvoicedDate})` : ''}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <span style={{ color: '#556b82' }}>Sem histórico</span>
                            )}
                          </td>
                          <td style={{ padding: '9px' }}>
                            {item.lastInvoicedPrice === null ? (
                              <Tag design="Neutral">Sem histórico</Tag>
                            ) : item.priceMatchesLastInvoice ? (
                              <ObjectStatus state="Positive" showDefaultIcon>
                                Igual à últ. fatura
                              </ObjectStatus>
                            ) : (
                              <ObjectStatus state="Critical" showDefaultIcon>
                                Diferente ({item.priceDiff && item.priceDiff > 0 ? '+' : ''}
                                {formatMoney(item.priceDiff ?? 0, delivery.docCurrency)})
                              </ObjectStatus>
                            )}
                          </td>
                          <td style={{ padding: '9px', textAlign: 'right' }}>
                            {formatMoney(item.avgUnitCost, delivery.docCurrency)}
                          </td>
                          <td
                            style={{
                              padding: '9px',
                              textAlign: 'right',
                              fontWeight: 700,
                              color: item.marginMeetsMinimum ? '#256f3a' : '#aa0808',
                            }}
                          >
                            {item.avgMarginPercent.toFixed(1)}%
                          </td>
                          <td style={{ padding: '9px' }}>
                            {item.marginMeetsMinimum ? (
                              <ObjectStatus state="Positive" showDefaultIcon>
                                OK (≥ {validation.minMarginThreshold}%)
                              </ObjectStatus>
                            ) : (
                              <ObjectStatus state="Negative" showDefaultIcon>
                                Abaixo de {validation.minMarginThreshold}%
                              </ObjectStatus>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {activeTab === 'LINES' && (
              <div style={whiteCardStyle}>
                <div style={{ fontSize: '14px', fontWeight: 700, color: '#1d2d3e', marginBottom: '12px' }}>
                  Detalhe das linhas da guia de remessa ({validation.lineResults.length})
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                    <thead>
                      <tr
                        style={{
                          borderBottom: '1px solid #d9d9d9',
                          background: '#f5f6f7',
                          textAlign: 'left',
                          color: '#556b82',
                          fontSize: '12px',
                        }}
                      >
                        <th style={{ padding: '8px' }}>#</th>
                        <th style={{ padding: '8px' }}>Artigo</th>
                        <th style={{ padding: '8px' }}>Armazém</th>
                        <th style={{ padding: '8px', textAlign: 'right' }}>Qtd.</th>
                        <th style={{ padding: '8px', textAlign: 'right' }}>Preço líq.</th>
                        <th style={{ padding: '8px', textAlign: 'right' }}>Últ. fatura</th>
                        <th style={{ padding: '8px', textAlign: 'right' }}>Custo unit.</th>
                        <th style={{ padding: '8px', textAlign: 'right' }}>Margem (€)</th>
                        <th style={{ padding: '8px', textAlign: 'right' }}>Margem (%)</th>
                        <th style={{ padding: '8px', textAlign: 'right' }}>Total linha</th>
                      </tr>
                    </thead>
                    <tbody>
                      {validation.lineResults.map((line) => (
                        <tr key={line.lineNum} style={{ borderBottom: '1px solid #edf0f3' }}>
                          <td style={{ padding: '8px' }}>{line.lineNum + 1}</td>
                          <td style={{ padding: '8px' }}>
                            <span style={{ fontWeight: 600 }}>{line.itemCode}</span> —{' '}
                            {line.itemDescription}
                          </td>
                          <td style={{ padding: '8px' }}>{line.warehouseCode || '—'}</td>
                          <td style={{ padding: '8px', textAlign: 'right' }}>{line.quantity}</td>
                          <td
                            style={{
                              padding: '8px',
                              textAlign: 'right',
                              fontWeight: 700,
                              color: line.priceMatchesLastInvoice ? 'inherit' : '#b95100',
                            }}
                          >
                            {formatMoney(line.netUnitPrice, delivery.docCurrency)}
                          </td>
                          <td style={{ padding: '8px', textAlign: 'right' }}>
                            {line.lastInvoicedPrice !== null
                              ? formatMoney(line.lastInvoicedPrice, delivery.docCurrency)
                              : '—'}
                          </td>
                          <td style={{ padding: '8px', textAlign: 'right' }}>
                            {formatMoney(line.unitCost, delivery.docCurrency)}
                          </td>
                          <td style={{ padding: '8px', textAlign: 'right' }}>
                            {formatMoney(line.marginAmount, delivery.docCurrency)}
                          </td>
                          <td
                            style={{
                              padding: '8px',
                              textAlign: 'right',
                              fontWeight: 700,
                              color:
                                line.marginPercent >= validation.minMarginThreshold
                                  ? '#256f3a'
                                  : '#aa0808',
                            }}
                          >
                            {line.marginPercent.toFixed(1)}%
                          </td>
                          <td style={{ padding: '8px', textAlign: 'right', fontWeight: 700 }}>
                            {formatMoney(line.lineTotal, delivery.docCurrency)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {activeTab === 'GENERAL' && (
              <div style={whiteCardStyle}>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
                    gap: '24px 40px',
                  }}
                >
                  <div>
                    <div style={{ fontSize: '14px', fontWeight: 700, marginBottom: '12px' }}>
                      Informações básicas
                    </div>
                    <div style={kvGridStyle}>
                      <span style={kvLabelStyle}>Código do cliente:</span>
                      <span style={kvValStyle}>{delivery.cardCode}</span>
                      <span style={kvLabelStyle}>Nome do cliente:</span>
                      <span style={kvValStyle}>{delivery.cardName}</span>
                      <span style={kvLabelStyle}>NIF:</span>
                      <span style={kvValStyle}>{delivery.federalTaxId || '—'}</span>
                      <span style={kvLabelStyle}>Moeda:</span>
                      <span style={kvValStyle}>{delivery.docCurrency}</span>
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: '14px', fontWeight: 700, marginBottom: '12px' }}>
                      Informações adicionais
                    </div>
                    <div style={kvGridStyle}>
                      <span style={kvLabelStyle}>Nº documento:</span>
                      <span style={kvValStyle}>
                        GR {delivery.docNum} (DocEntry #{delivery.docEntry})
                      </span>
                      <span style={kvLabelStyle}>Ref. do cliente:</span>
                      <span style={kvValStyle}>{delivery.numAtCard || '—'}</span>
                      <span style={kvLabelStyle}>E-mail principal:</span>
                      <span style={kvValStyle}>{delivery.customerEmail || '—'}</span>
                      <span style={kvLabelStyle}>Observações:</span>
                      <span style={kvValStyle}>{delivery.comments || '—'}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}

const facetColStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '2px',
};

const facetLabelStyle: React.CSSProperties = {
  fontSize: '12px',
  color: '#556b82',
};

const facetValueStyle: React.CSSProperties = {
  fontSize: '14px',
  fontWeight: 600,
  color: '#1d2d3e',
};

const facetSubStyle: React.CSSProperties = {
  fontSize: '12px',
  color: '#556b82',
};

function modalTabStyle(active: boolean): React.CSSProperties {
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

const whiteCardStyle: React.CSSProperties = {
  background: '#ffffff',
  borderRadius: '10px',
  padding: '18px 22px',
  border: '1px solid #e6ebf0',
  boxShadow: '0 1px 3px rgba(15, 35, 55, 0.04)',
};

const kvGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '150px 1fr',
  rowGap: '8px',
  columnGap: '12px',
  fontSize: '13px',
};

const kvLabelStyle: React.CSSProperties = {
  color: '#556b82',
};

const kvValStyle: React.CSSProperties = {
  color: '#1d2d3e',
  fontWeight: 500,
};
