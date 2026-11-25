import type { ParsedBankStatement, ParsedStatementLine } from '@b1-recon/shared';
import {
  buildLineFingerprint,
  extractPortugueseMetadata,
} from '../metadataExtractor.js';

const ISO_NUMERIC_CURRENCY: Record<string, string> = {
  '978': 'EUR',
  '840': 'USD',
  '826': 'GBP',
  '756': 'CHF',
  '986': 'BRL',
};

function parseYyMmDd(yymmdd: string): string {
  const yy = Number(yymmdd.slice(0, 2));
  const mm = yymmdd.slice(2, 4);
  const dd = yymmdd.slice(4, 6);
  const year = yy >= 70 ? 1900 + yy : 2000 + yy;
  return `${year}-${mm}-${dd}`;
}

function parseIntegerField(raw: string, fieldName: string): number {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`Invalid numeric field ${fieldName} in Norma 43: "${raw}"`);
  }
  return parseInt(trimmed, 10);
}

interface PendingNorma43Movement {
  branch: string;
  bookingDate: string;
  valueDate: string;
  commonConcept: string;
  ownConcept: string;
  direction: 'CREDIT' | 'DEBIT';
  amountCents: number;
  signedCents: number;
  documentNumber: string;
  ref1: string;
  ref2: string;
  conceptSegments: string[];
  rawLines: string[];
}

/**
 * Parses bank statements in generic AEB Cuaderno 43 / Norma 43 (80-byte fixed-width) format.
 * Supports records:
 *   11 - Account Header
 *   22 - Main Movement
 *   23 - Complementary Concepts (01..05)
 *   24 - Optional Currency Equivalence
 *   33 - Account Footer & Control Totals
 *   88 - End of File Record
 */
export function parseNorma43(content: string): ParsedBankStatement {
  const rawLines = content
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);

  if (rawLines.length === 0) {
    throw new Error('Empty Norma 43 statement file.');
  }

  let bankEntity = '';
  let branchOffice = '';
  let accountNumber = '';
  let periodStart = '';
  let periodEnd = '';
  let openingSignedCents: number | null = null;
  let closingSignedCents: number | null = null;
  let currency = 'EUR';
  let footerDebitCount: number | null = null;
  let footerDebitSumCents: number | null = null;
  let footerCreditCount: number | null = null;
  let footerCreditSumCents: number | null = null;

  const movements: PendingNorma43Movement[] = [];
  let activeMovement: PendingNorma43Movement | null = null;

  for (let idx = 0; idx < rawLines.length; idx++) {
    const rec = rawLines[idx].padEnd(80, ' ');
    const code = rec.slice(0, 2);

    switch (code) {
      case '11': {
        if (openingSignedCents === null) {
          bankEntity = rec.slice(2, 6).trim();
          branchOffice = rec.slice(6, 10).trim();
          accountNumber = rec.slice(10, 20).trim();
          periodStart = parseYyMmDd(rec.slice(20, 26));
          periodEnd = parseYyMmDd(rec.slice(26, 32));
          const openSign = rec.slice(32, 33); // '1' = Debtor (-), '2' = Creditor (+)
          const openCents = parseIntegerField(rec.slice(33, 47), 'OpeningBalance(11)');
          openingSignedCents = openSign === '1' ? -openCents : openCents;
          const currNum = rec.slice(47, 50).trim();
          currency = ISO_NUMERIC_CURRENCY[currNum] ?? 'EUR';
        } else {
          periodEnd = parseYyMmDd(rec.slice(26, 32));
        }
        break;
      }

      case '22': {
        if (activeMovement) {
          movements.push(activeMovement);
        }
        const movBranch = rec.slice(6, 10).trim();
        const bookingDate = parseYyMmDd(rec.slice(10, 16));
        const valueDate = parseYyMmDd(rec.slice(16, 22));
        const commonConcept = rec.slice(22, 24).trim();
        const ownConcept = rec.slice(24, 27).trim();
        const movSign = rec.slice(27, 28); // '1' = Debit (-), '2' = Credit (+)
        if (movSign !== '1' && movSign !== '2') {
          throw new Error(`Invalid Norma 43 movement sign "${movSign}" at line ${idx + 1}.`);
        }
        const amountCents = parseIntegerField(rec.slice(28, 42), `MovementAmount(22@${idx + 1})`);
        const docNumRaw = rec.slice(42, 52).trim();
        const ref1Raw = rec.slice(52, 64).trim();
        const ref2Raw = rec.slice(64, 80).trim();

        const cleanZeroRef = (val: string) => (/^0+$/.test(val) ? '' : val);

        activeMovement = {
          branch: movBranch,
          bookingDate,
          valueDate,
          commonConcept,
          ownConcept,
          direction: movSign === '2' ? 'CREDIT' : 'DEBIT',
          amountCents,
          signedCents: movSign === '2' ? amountCents : -amountCents,
          documentNumber: cleanZeroRef(docNumRaw),
          ref1: cleanZeroRef(ref1Raw),
          ref2: cleanZeroRef(ref2Raw),
          conceptSegments: [],
          rawLines: [rec.trimEnd()],
        };
        break;
      }

      case '23': {
        if (!activeMovement) {
          throw new Error(`Orphan Norma 43 complementary record 23 at line ${idx + 1}.`);
        }
        const concept1 = rec.slice(4, 42).trim();
        const concept2 = rec.slice(42, 80).trim();
        if (concept1) activeMovement.conceptSegments.push(concept1);
        if (concept2) activeMovement.conceptSegments.push(concept2);
        activeMovement.rawLines.push(rec.trimEnd());
        break;
      }

      case '24': {
        if (activeMovement) {
          activeMovement.rawLines.push(rec.trimEnd());
        }
        break;
      }

      case '33': {
        if (activeMovement) {
          movements.push(activeMovement);
          activeMovement = null;
        }
        footerDebitCount = parseIntegerField(rec.slice(20, 25), 'DebitCount(33)');
        footerDebitSumCents = parseIntegerField(rec.slice(25, 39), 'DebitSum(33)');
        footerCreditCount = parseIntegerField(rec.slice(39, 44), 'CreditCount(33)');
        footerCreditSumCents = parseIntegerField(rec.slice(44, 58), 'CreditSum(33)');
        const closeSign = rec.slice(58, 59); // '1' = Debtor (-), '2' = Creditor (+)
        const closeCents = parseIntegerField(rec.slice(59, 73), 'ClosingBalance(33)');
        closingSignedCents = closeSign === '1' ? -closeCents : closeCents;
        break;
      }

      case '88': {
        if (activeMovement) {
          movements.push(activeMovement);
          activeMovement = null;
        }
        break;
      }

      default:
        throw new Error(`Unsupported Norma 43 record code "${code}" at line ${idx + 1}.`);
    }
  }

  if (activeMovement) {
    movements.push(activeMovement);
  }

  if (openingSignedCents === null || closingSignedCents === null) {
    throw new Error('Norma 43 file is missing required Header (11) or Account Footer (33) records.');
  }

  let totalCreditCents = 0;
  let totalDebitCents = 0;
  let creditCount = 0;
  let debitCount = 0;

  const occurrenceCounter = new Map<string, number>();
  const lines: ParsedStatementLine[] = [];

  movements.forEach((mov, index) => {
    if (mov.direction === 'CREDIT') {
      totalCreditCents += mov.amountCents;
      creditCount++;
    } else {
      totalDebitCents += mov.amountCents;
      debitCount++;
    }

    const description =
      mov.conceptSegments.join(' ').replace(/\s+/g, ' ').trim() ||
      `C${mov.commonConcept}/${mov.ownConcept} ${mov.ref1} ${mov.ref2}`.trim();

    const bankReference = mov.documentNumber || mov.ref1;
    const customerReference = [mov.ref1, mov.ref2].filter(Boolean).join(' / ');

    const extracted = extractPortugueseMetadata(
      `${description} ${mov.ref1} ${mov.ref2} ${mov.documentNumber}`
    );

    const occKey = `${mov.bookingDate}|${mov.direction}|${mov.amountCents}|${bankReference}|${customerReference}|${description}`;
    const occ = (occurrenceCounter.get(occKey) ?? 0) + 1;
    occurrenceCounter.set(occKey, occ);

    const fingerprint = buildLineFingerprint({
      bankCode: bankEntity || 'NORMA43',
      accountKey: `${bankEntity}${branchOffice}${accountNumber}`,
      bookingDate: mov.bookingDate,
      valueDate: mov.valueDate,
      direction: mov.direction,
      amountCents: mov.amountCents,
      bankReference,
      customerReference,
      description,
      occurrenceWithinStatement: occ,
    });

    lines.push({
      lineNumber: index + 1,
      bookingDate: mov.bookingDate,
      valueDate: mov.valueDate,
      direction: mov.direction,
      amount: mov.amountCents / 100,
      signedAmount: mov.signedCents / 100,
      currency,
      isReversal: false,
      transactionCode: `${mov.commonConcept}-${mov.ownConcept}`,
      bankReference,
      customerReference,
      description,
      rawNarrative: mov.rawLines.join('\n'),
      extracted,
      fingerprint,
    });
  });

  const calculatedClosingCents = openingSignedCents + totalCreditCents - totalDebitCents;
  const discrepancyCents = closingSignedCents - calculatedClosingCents;

  const footerTotalsMatch =
    (footerDebitCount === null || footerDebitCount === debitCount) &&
    (footerDebitSumCents === null || footerDebitSumCents === totalDebitCents) &&
    (footerCreditCount === null || footerCreditCount === creditCount) &&
    (footerCreditSumCents === null || footerCreditSumCents === totalCreditCents);

  const balanceVerified = discrepancyCents === 0 && footerTotalsMatch;

  return {
    format: 'NORMA43',
    bankCode: bankEntity || 'NORMA43',
    statementId: `N43-${accountNumber}-${periodStart}-${periodEnd}`,
    accountIdentifier: `${bankEntity}-${branchOffice}-${accountNumber}`,
    normalizedAccountNumber: accountNumber,
    currency,
    periodStart,
    periodEnd,
    openingBalance: openingSignedCents / 100,
    closingBalance: closingSignedCents / 100,
    calculatedClosingBalance: calculatedClosingCents / 100,
    balanceVerified,
    balanceDiscrepancy: discrepancyCents / 100,
    totalCredits: totalCreditCents / 100,
    totalDebits: totalDebitCents / 100,
    lines,
  };
}
