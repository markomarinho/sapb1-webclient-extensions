import type { B1OpenDocument, B1UnreconciledJournalLine } from './index.js';

export function normalizeSearchString(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Parses a user-entered Portuguese or international currency query into a number, if numeric.
 * Examples:
 *   "1.845,00" -> 1845
 *   "1 845,50" -> 1845.5
 *   "1845,00"  -> 1845
 *   "1845.00"  -> 1845
 *   "750"      -> 750
 */
export function parseSearchAmount(raw: string): number | null {
  const cleaned = raw.replace(/[€\s]/g, '').trim();
  if (!cleaned || !/^[-+]?[\d.,]+$/.test(cleaned)) return null;

  let normalized = cleaned;
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');

  if (lastComma !== -1 && lastDot !== -1) {
    if (lastComma > lastDot) {
      // Portuguese / European: 1.845,00
      normalized = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      // US / UK: 1,845.00
      normalized = cleaned.replace(/,/g, '');
    }
  } else if (lastComma !== -1) {
    // Comma decimal: 1845,00
    normalized = cleaned.replace(',', '.');
  }

  const num = Number(normalized);
  return Number.isFinite(num) ? Math.abs(num) : null;
}

export function matchesAmountValue(targetAmount: number, rawQuery: string): boolean {
  const absTarget = Math.abs(targetAmount);
  const fixedDot = absTarget.toFixed(2);               // "1845.00"
  const fixedComma = fixedDot.replace('.', ',');       // "1845,00"
  const ptFormatted = new Intl.NumberFormat('pt-PT', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(absTarget);                                 // "1 845,00" or "1.845,00"

  const qTrim = rawQuery.replace(/[€]/g, '').trim();
  if (!qTrim) return true;

  if (
    fixedDot.includes(qTrim) ||
    fixedComma.includes(qTrim) ||
    ptFormatted.includes(qTrim)
  ) {
    return true;
  }

  const parsedNum = parseSearchAmount(qTrim);
  if (parsedNum !== null) {
    if (Math.abs(absTarget - parsedNum) < 0.009) return true;
    // Also support integer/prefix numeric typing like "1845" matching 1845.00
    if (/^\d+$/.test(qTrim) && fixedDot.startsWith(qTrim)) return true;
  }

  return false;
}

/**
 * Filters open SAP B1 AR/AP Invoices across all Document Numbering Series by
 * Document Number (DocNum / SeriesName+DocNum / AT Number / NumAtCard / DocEntry),
 * Series Name, CardCode, CardName, or Value (OpenAmount / DocTotal).
 */
export function filterManualOpenDocuments(
  docs: B1OpenDocument[],
  query: string,
  seriesFilter?: string
): B1OpenDocument[] {
  const seriesFiltered =
    seriesFilter && seriesFilter !== 'ALL'
      ? docs.filter(
          (d) =>
            (d.seriesName && d.seriesName === seriesFilter) ||
            (d.seriesCode != null && String(d.seriesCode) === seriesFilter)
        )
      : docs;

  const qNorm = normalizeSearchString(query);
  if (!qNorm) return seriesFiltered;

  const qStripHash = qNorm.replace(/^#/, '');

  return seriesFiltered.filter((doc) => {
    const seriesLabel = doc.seriesName ?? (doc.seriesCode != null ? String(doc.seriesCode) : '');
    const numberFields = [
      String(doc.docNum),
      String(doc.docEntry),
      doc.atDocNumber ?? '',
      seriesLabel,
      seriesLabel ? `${seriesLabel}/${doc.docNum}` : '',
      seriesLabel ? `${seriesLabel} ${doc.docNum}` : '',
      seriesLabel ? `${seriesLabel}-${doc.docNum}` : '',
    ]
      .map(normalizeSearchString)
      .join(' ');

    const bpCode = normalizeSearchString(doc.cardCode);
    const bpName = normalizeSearchString(doc.cardName);

    if (numberFields.includes(qStripHash)) return true;
    if (bpCode.includes(qNorm)) return true;
    if (bpName.includes(qNorm)) return true;
    if (matchesAmountValue(doc.openAmount, query) || matchesAmountValue(doc.docTotal, query)) {
      return true;
    }

    return false;
  });
}

/**
 * Filters unreconciled SAP B1 Journal Entry lines by Number (TransId / SourceDocNum / Ref1 / Ref2),
 * CardCode, CardName / Memo, or Value.
 */
export function filterManualJournalLines(
  lines: B1UnreconciledJournalLine[],
  query: string
): B1UnreconciledJournalLine[] {
  const qNorm = normalizeSearchString(query);
  if (!qNorm) return lines;

  const qStripHash = qNorm.replace(/^#/, '');

  return lines.filter((je) => {
    const numberFields = [
      String(je.transId),
      je.sourceDocNum != null ? String(je.sourceDocNum) : '',
      je.ref1 ?? '',
      je.ref2 ?? '',
    ]
      .map(normalizeSearchString)
      .join(' ');

    const bpCode = normalizeSearchString(`${je.cardCode ?? ''} ${je.contraAct ?? ''}`);
    const bpNameOrMemo = normalizeSearchString(`${je.cardName ?? ''} ${je.memo ?? ''}`);

    if (numberFields.includes(qStripHash)) return true;
    if (bpCode.includes(qNorm)) return true;
    if (bpNameOrMemo.includes(qNorm)) return true;
    if (matchesAmountValue(Math.abs(je.signedAmount), query)) return true;

    return false;
  });
}
