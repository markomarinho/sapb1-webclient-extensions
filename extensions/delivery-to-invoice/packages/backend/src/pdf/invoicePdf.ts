import type { DeliveryLine } from '@b1-d2i/shared';

export interface InvoicePdfInput {
  companyName: string;
  companyNif: string;
  companyAddress: string;
  invoiceDocNum: number;
  invoiceDate: string;
  cardCode: string;
  cardName: string;
  customerNif: string;
  deliveryDocNums: number[];
  currency: string;
  lines: DeliveryLine[];
  vatSum: number;
  docTotal: number;
}

function pdfEscape(input: string): string {
  // Replace non-ASCII accented Portuguese characters with clean WinAnsi / ASCII equivalents for Helvetica Type1
  const normalized = input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, ' ');
  return normalized.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function formatMoney(amount: number, currency: string): string {
  return `${amount.toFixed(2)} ${currency}`;
}

/**
 * Generates a self-contained, standards-compliant PDF 1.4 invoice buffer
 * without requiring native binary dependencies.
 */
export function generateInvoicePdf(input: InvoicePdfInput): Buffer {
  const ops: string[] = [];
  const text = (x: number, y: number, size: number, value: string, bold = false) => {
    const font = bold ? '/F2' : '/F1';
    ops.push(`BT ${font} ${size} Tf ${x} ${y} Td (${pdfEscape(value)}) Tj ET`);
  };
  const line = (x1: number, y1: number, x2: number, y2: number) => {
    ops.push(`${x1} ${y1} m ${x2} ${y2} l S`);
  };

  // Header
  text(45, 790, 16, input.companyName, true);
  text(45, 774, 9, `NIF: ${input.companyNif}  |  ${input.companyAddress}`);

  text(390, 790, 14, `FATURA #${input.invoiceDocNum}`, true);
  text(390, 774, 9, `Data: ${input.invoiceDate}`);
  text(390, 760, 9, `Guias Ref.: ${input.deliveryDocNums.map((n) => `GR ${n}`).join(', ')}`);

  line(45, 748, 550, 748);

  // Customer block
  text(45, 730, 10, 'Cliente:', true);
  text(45, 716, 10, `${input.cardName} (${input.cardCode})`);
  text(45, 702, 9, `NIF: ${input.customerNif || 'N/A'}`);

  // Table header
  let y = 670;
  line(45, y + 12, 550, y + 12);
  text(48, y, 9, 'Artigo', true);
  text(130, y, 9, 'Descricao', true);
  text(345, y, 9, 'Qtd', true);
  text(395, y, 9, 'Preco Unit.', true);
  text(475, y, 9, 'Total', true);
  line(45, y - 6, 550, y - 6);

  y -= 22;
  const maxRows = 24;
  const visibleLines = input.lines.slice(0, maxRows);
  for (const row of visibleLines) {
    text(48, y, 8.5, row.itemCode.slice(0, 14));
    text(130, y, 8.5, row.itemDescription.slice(0, 38));
    text(345, y, 8.5, String(row.quantity));
    text(395, y, 8.5, row.unitPrice.toFixed(2));
    text(475, y, 8.5, row.lineTotal.toFixed(2));
    y -= 16;
  }
  if (input.lines.length > maxRows) {
    text(48, y, 8.5, `... +${input.lines.length - maxRows} linhas adicionais`);
    y -= 16;
  }

  // Totals
  line(340, y + 4, 550, y + 4);
  const netSubtotal = Math.max(0, input.docTotal - input.vatSum);
  text(350, y - 14, 9.5, 'Subtotal (s/ IVA):');
  text(465, y - 14, 9.5, formatMoney(netSubtotal, input.currency));
  text(350, y - 30, 9.5, 'IVA:');
  text(465, y - 30, 9.5, formatMoney(input.vatSum, input.currency));
  text(350, y - 48, 11, 'TOTAL:', true);
  text(465, y - 48, 11, formatMoney(input.docTotal, input.currency), true);

  // Footer
  line(45, 55, 550, 55);
  text(45, 40, 8, 'Documento gerado automaticamente pela extensao SAP Business One Web Client (Delivery-to-Invoice).');

  const streamContent = ops.join('\n');
  const streamBytes = Buffer.byteLength(streamContent, 'utf8');

  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>\nendobj\n',
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n',
    `6 0 obj\n<< /Length ${streamBytes} >>\nstream\n${streamContent}\nendstream\nendobj\n`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += obj;
  }

  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, 'utf8');
}
