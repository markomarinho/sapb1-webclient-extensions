import React from 'react';
import {
  evaluateDeliveryNoteChecks,
  type OpenDeliveryNote,
} from '@b1-d2i/shared';
import {
  Bar,
  Button,
  Dialog,
  Label,
  MessageStrip,
  Tag,
  Text,
  Title,
} from '@ui5/webcomponents-react';
import { formatMoney } from '../api';

interface DeliveryDetailsDialogProps {
  delivery: OpenDeliveryNote | null;
  onClose: () => void;
}

export function DeliveryDetailsDialog({ delivery, onClose }: DeliveryDetailsDialogProps) {
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
          ? `Detalhes da Guia de Remessa GR ${delivery.docNum} — Preços e Margens`
          : 'Detalhes da Guia de Remessa'
      }
      style={{ width: '940px', maxWidth: '96vw' }}
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', padding: '0.25rem 0' }}>
          {/* Validation Status Banner */}
          {validation.passed ? (
            <MessageStrip design="Positive" hideCloseButton>
              Todas as regras de validação cumpridas (preços iguais à última fatura e margem por artigo ≥{' '}
              {validation.minMarginThreshold}%).
            </MessageStrip>
          ) : (
            <MessageStrip design="Critical" hideCloseButton>
              <div>
                <strong>Alertas de Validação Detetados ({validation.warnings.length}):</strong>
                <ul style={{ margin: '0.35rem 0 0 1.2rem', padding: 0 }}>
                  {validation.warnings.map((w, idx) => (
                    <li key={idx}>{w}</li>
                  ))}
                </ul>
              </div>
            </MessageStrip>
          )}

          {/* Document Header Details */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '0.75rem',
              padding: '0.75rem 1rem',
              background: '#f5f6f7',
              borderRadius: '6px',
              border: '1px solid #e5e5e5',
            }}
          >
            <div>
              <Label>Cliente</Label>
              <div style={{ fontWeight: 600 }}>{delivery.cardName}</div>
              <Text style={{ fontSize: '0.8rem', color: '#556b82' }}>
                {delivery.cardCode} • NIF: {delivery.federalTaxId || '—'}
              </Text>
            </div>
            <div>
              <Label>Documento</Label>
              <div style={{ fontWeight: 600 }}>
                GR {delivery.docNum} (DocEntry #{delivery.docEntry})
              </div>
              <Text style={{ fontSize: '0.8rem', color: '#556b82' }}>
                Data: {delivery.docDate} • Venc.: {delivery.docDueDate}
              </Text>
            </div>
            <div>
              <Label>Referência / Observações</Label>
              <div style={{ fontWeight: 500 }}>{delivery.numAtCard || '—'}</div>
              <Text style={{ fontSize: '0.8rem', color: '#556b82' }}>
                {delivery.comments || 'Sem observações'}
              </Text>
            </div>
            <div>
              <Label>Totais do Documento</Label>
              <div style={{ fontWeight: 600 }}>
                Total: {formatMoney(delivery.docTotal, delivery.docCurrency)}
              </div>
              <Text style={{ fontSize: '0.8rem', color: '#556b82' }}>
                Líquido: {formatMoney(netSubTotal, delivery.docCurrency)} • IVA:{' '}
                {formatMoney(delivery.vatSum, delivery.docCurrency)}
              </Text>
            </div>
          </div>

          {/* Item-level Summary Table (with multi-row average / "média") */}
          <div>
            <Title level="H5" style={{ marginBottom: '0.4rem' }}>
              Resumo por Artigo (Comparação Última Fatura & Margem Média — Mínimo:{' '}
              {validation.minMarginThreshold}%)
            </Title>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem' }}>
                <thead>
                  <tr
                    style={{
                      borderBottom: '2px solid #e5e5e5',
                      textAlign: 'left',
                      color: '#556b82',
                      background: '#fafafa',
                    }}
                  >
                    <th style={{ padding: '0.5rem' }}>Artigo</th>
                    <th style={{ padding: '0.5rem' }}>Linhas / Qtd.</th>
                    <th style={{ padding: '0.5rem', textAlign: 'right' }}>Preço Médio Atual</th>
                    <th style={{ padding: '0.5rem', textAlign: 'right' }}>Últ. Preço Faturado</th>
                    <th style={{ padding: '0.5rem' }}>Validação Preço</th>
                    <th style={{ padding: '0.5rem', textAlign: 'right' }}>Custo Médio</th>
                    <th style={{ padding: '0.5rem', textAlign: 'right' }}>Margem Média (%)</th>
                    <th style={{ padding: '0.5rem' }}>Validação Margem</th>
                  </tr>
                </thead>
                <tbody>
                  {validation.itemSummaries.map((item) => (
                    <tr key={item.itemCode} style={{ borderBottom: '1px solid #efefef' }}>
                      <td style={{ padding: '0.5rem' }}>
                        <div style={{ fontWeight: 600 }}>{item.itemCode}</div>
                        <div style={{ fontSize: '0.78rem', color: '#556b82' }}>
                          {item.itemDescription}
                        </div>
                      </td>
                      <td style={{ padding: '0.5rem' }}>
                        <div>{item.totalQuantity} un.</div>
                        {item.rowCount > 1 && (
                          <Tag design="Information">
                            {item.rowCount} linhas (média)
                          </Tag>
                        )}
                      </td>
                      <td style={{ padding: '0.5rem', textAlign: 'right', fontWeight: 600 }}>
                        {formatMoney(item.avgUnitPrice, delivery.docCurrency)}
                      </td>
                      <td style={{ padding: '0.5rem', textAlign: 'right' }}>
                        {item.lastInvoicedPrice !== null ? (
                          <div>
                            <div style={{ fontWeight: 500 }}>
                              {formatMoney(item.lastInvoicedPrice, delivery.docCurrency)}
                            </div>
                            {item.lastInvoicedDocNum && (
                              <div style={{ fontSize: '0.74rem', color: '#556b82' }}>
                                FT {item.lastInvoicedDocNum}
                                {item.lastInvoicedDate ? ` (${item.lastInvoicedDate})` : ''}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span style={{ color: '#556b82' }}>Sem histórico</span>
                        )}
                      </td>
                      <td style={{ padding: '0.5rem' }}>
                        {item.lastInvoicedPrice === null ? (
                          <Tag design="Neutral">Sem Histórico</Tag>
                        ) : item.priceMatchesLastInvoice ? (
                          <Tag design="Positive">Igual à Últ. Fatura</Tag>
                        ) : (
                          <Tag design="Critical">
                            Diferente ({item.priceDiff && item.priceDiff > 0 ? '+' : ''}
                            {formatMoney(item.priceDiff ?? 0, delivery.docCurrency)})
                          </Tag>
                        )}
                      </td>
                      <td style={{ padding: '0.5rem', textAlign: 'right' }}>
                        {formatMoney(item.avgUnitCost, delivery.docCurrency)}
                      </td>
                      <td
                        style={{
                          padding: '0.5rem',
                          textAlign: 'right',
                          fontWeight: 600,
                          color: item.marginMeetsMinimum ? '#256f3a' : '#aa0808',
                        }}
                      >
                        {item.avgMarginPercent.toFixed(1)}%
                      </td>
                      <td style={{ padding: '0.5rem' }}>
                        {item.marginMeetsMinimum ? (
                          <Tag design="Positive">
                            OK (≥ {validation.minMarginThreshold}%)
                          </Tag>
                        ) : (
                          <Tag design="Negative">
                            Abaixo de {validation.minMarginThreshold}%
                          </Tag>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Line-by-line Document Details Table */}
          <div>
            <Title level="H5" style={{ marginBottom: '0.4rem' }}>
              Linhas da Guia de Remessa ({validation.lineResults.length})
            </Title>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                <thead>
                  <tr
                    style={{
                      borderBottom: '2px solid #e5e5e5',
                      textAlign: 'left',
                      color: '#556b82',
                      background: '#fafafa',
                    }}
                  >
                    <th style={{ padding: '0.45rem' }}>#</th>
                    <th style={{ padding: '0.45rem' }}>Artigo</th>
                    <th style={{ padding: '0.45rem' }}>Arm.</th>
                    <th style={{ padding: '0.45rem', textAlign: 'right' }}>Qtd.</th>
                    <th style={{ padding: '0.45rem', textAlign: 'right' }}>Preço Líq.</th>
                    <th style={{ padding: '0.45rem', textAlign: 'right' }}>Últ. Fatura</th>
                    <th style={{ padding: '0.45rem', textAlign: 'right' }}>Custo Unit.</th>
                    <th style={{ padding: '0.45rem', textAlign: 'right' }}>Margem (€)</th>
                    <th style={{ padding: '0.45rem', textAlign: 'right' }}>Margem (%)</th>
                    <th style={{ padding: '0.45rem', textAlign: 'right' }}>Total Linha</th>
                  </tr>
                </thead>
                <tbody>
                  {validation.lineResults.map((line) => (
                    <tr key={line.lineNum} style={{ borderBottom: '1px solid #efefef' }}>
                      <td style={{ padding: '0.45rem' }}>{line.lineNum + 1}</td>
                      <td style={{ padding: '0.45rem' }}>
                        <span style={{ fontWeight: 600 }}>{line.itemCode}</span> —{' '}
                        {line.itemDescription}
                      </td>
                      <td style={{ padding: '0.45rem' }}>{line.warehouseCode || '—'}</td>
                      <td style={{ padding: '0.45rem', textAlign: 'right' }}>{line.quantity}</td>
                      <td
                        style={{
                          padding: '0.45rem',
                          textAlign: 'right',
                          fontWeight: 600,
                          color: line.priceMatchesLastInvoice ? 'inherit' : '#b95100',
                        }}
                      >
                        {formatMoney(line.netUnitPrice, delivery.docCurrency)}
                      </td>
                      <td style={{ padding: '0.45rem', textAlign: 'right' }}>
                        {line.lastInvoicedPrice !== null
                          ? formatMoney(line.lastInvoicedPrice, delivery.docCurrency)
                          : '—'}
                      </td>
                      <td style={{ padding: '0.45rem', textAlign: 'right' }}>
                        {formatMoney(line.unitCost, delivery.docCurrency)}
                      </td>
                      <td style={{ padding: '0.45rem', textAlign: 'right' }}>
                        {formatMoney(line.marginAmount, delivery.docCurrency)}
                      </td>
                      <td
                        style={{
                          padding: '0.45rem',
                          textAlign: 'right',
                          fontWeight: 600,
                          color:
                            line.marginPercent >= validation.minMarginThreshold
                              ? '#256f3a'
                              : '#aa0808',
                        }}
                      >
                        {line.marginPercent.toFixed(1)}%
                      </td>
                      <td style={{ padding: '0.45rem', textAlign: 'right', fontWeight: 600 }}>
                        {formatMoney(line.lineTotal, delivery.docCurrency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </Dialog>
  );
}
