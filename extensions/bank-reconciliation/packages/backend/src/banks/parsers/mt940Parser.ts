import type { ParsedBankStatement, ParsedStatementLine } from '@b1-recon/shared';
import {
  buildLineFingerprint,
  extractPortugueseMetadata,
  isValidIban,
} from '../metadataExtractor.js';

interface Mt940Tag {
  tag: string;
  value: string;
}

function parseYyMmDd(yymmdd: string): string {
  const yy = Number(yymmdd.slice(0, 2));
  const mm = yymmdd.slice(2, 4);
  const dd = yymmdd.slice(4, 6);
  const year = yy >= 70 ? 1900 + yy : 2000 + yy;
  return `${year}-${mm}-${dd}`;
}

function resolveEntryDate(valueDateIso: string, mmdd?: string): string {
  if (!mmdd || mmdd.length !== 4) return valueDateIso;
  const valYear = Number(valueDateIso.slice(0, 4));
  const valMonth = Number(valueDateIso.slice(5, 7));
  const entryMonth = Number(mmdd.slice(0, 2));
  const entryDay = mmdd.slice(2, 4);

  let entryYear = valYear;
  if (valMonth === 12 && entryMonth === 1) entryYear = valYear + 1;
  else if (valMonth === 1 && entryMonth === 12) entryYear = valYear - 1;

  return `${entryYear}-${mmdd.slice(0, 2)}-${entryDay}`;
}

function parseMt940AmountCents(rawAmount: string): number {
  const normalized = rawAmount.trim().replace(',', '.');
  const [intPart, decPart = ''] = normalized.split('.');
  const paddedDec = (decPart + '00').slice(0, 2);
  return Number(intPart || '0') * 100 + Number(paddedDec);
}

function parseBalanceTag(value: string): {
  signedCents: number;
  dateIso: string;
  currency: string;
} {
  const clean = value.replace(/\r?\n/g, '').trim();
  const match = clean.match(/^([CD])(\d{6})([A-Z]{3})(\d+,\d{0,2})$/);
  if (!match) {
    throw new Error(`Invalid MT940 balance tag (:60/:62): "${value}"`);
  }
  const [, cdMark, yymmdd, currency, amtStr] = match;
  const cents = parseMt940AmountCents(amtStr);
  return {
    signedCents: cdMark === 'D' ? -cents : cents,
    dateIso: parseYyMmDd(yymmdd),
    currency,
  };
}

function extractTags(content: string): Mt940Tag[] {
  let body = content;
  const block4Start = body.indexOf('{4:');
  if (block4Start !== -1) {
    const blocks: string[] = [];
    const blockRegex = /\{4:\r?\n?([\s\S]*?)\r?\n?-\}/g;
    for (const m of body.matchAll(blockRegex)) {
      blocks.push(m[1]);
    }
    if (blocks.length > 0) {
      body = blocks.join('\n');
    }
  }

  const lines = body.split(/\r?\n/);
  const tags: Mt940Tag[] = [];
  let current: Mt940Tag | null = null;

  for (const rawLine of lines) {
    if (rawLine.trim() === '-' || rawLine.startsWith('{5:')) continue;
    const tagMatch = rawLine.match(/^:(\d{2}[A-Z]?):(.*)$/);
    if (tagMatch) {
      if (current) tags.push(current);
      current = { tag: tagMatch[1], value: tagMatch[2] };
    } else if (current) {
      current.value += `\n${rawLine}`;
    }
  }
  if (current) tags.push(current);
  return tags;
}

/**
 * Parses generic SWIFT MT940 bank statements.
 * Supports single and multi-page statements (:60F:/:60M: .. :62M:/:62F:),
 * credit/debit reversals (RC/RD), multi-line :86: narratives, and mathematical balance checks.
 */
export function parseMt940(content: string): ParsedBankStatement {
  const tags = extractTags(content);
  if (tags.length === 0) {
    throw new Error('No valid SWIFT MT940 tags found in file.');
  }

  let statementRef = '';
  let statementSeq = '';
  let accountRaw = '';
  let opening: { signedCents: number; dateIso: string; currency: string } | null = null;
  let closing: { signedCents: number; dateIso: string; currency: string } | null = null;

  const rawEntries: Array<{ tag61: string; tag86: string }> = [];

  for (const t of tags) {
    switch (t.tag) {
      case '20':
        if (!statementRef) statementRef = t.value.trim();
        break;
      case '25':
        if (!accountRaw) accountRaw = t.value.trim();
        break;
      case '28C':
      case '28':
        if (!statementSeq) statementSeq = t.value.trim();
        break;
      case '60F':
        if (!opening) opening = parseBalanceTag(t.value);
        break;
      case '60M':
        if (!opening) opening = parseBalanceTag(t.value);
        break;
      case '61':
        rawEntries.push({ tag61: t.value.trim(), tag86: '' });
        break;
      case '86':
        if (rawEntries.length > 0 && !rawEntries[rawEntries.length - 1].tag86) {
          rawEntries[rawEntries.length - 1].tag86 = t.value.trim();
        }
        break;
      case '62F':
        closing = parseBalanceTag(t.value);
        break;
      case '62M':
        if (!closing) closing = parseBalanceTag(t.value);
        break;
      default:
        break;
    }
  }

  if (!opening || !closing) {
    throw new Error('MT940 statement is missing required opening (:60F:) or closing (:62F:) balance tags.');
  }

  const strippedAccount = accountRaw.replace(/[\s/-]/g, '').toUpperCase();
  let normalizedIban: string | undefined;
  let normalizedAccountNumber = strippedAccount.replace(/[A-Z]{3}$/, '');
  let bankCode = 'MT940';

  const ibanCandidate = strippedAccount.slice(0, 25);
  if (ibanCandidate.startsWith('PT') && isValidIban(ibanCandidate)) {
    normalizedIban = ibanCandidate;
    bankCode = ibanCandidate.slice(4, 8);
    normalizedAccountNumber = ibanCandidate.slice(8, 21);
  } else if (/^\d{4}/.test(normalizedAccountNumber)) {
    bankCode = normalizedAccountNumber.slice(0, 4);
  }

  const currency = opening.currency;
  let totalCreditCents = 0;
  let totalDebitCents = 0;
  const occurrenceCounter = new Map<string, number>();
  const lines: ParsedStatementLine[] = [];

  rawEntries.forEach((entry, index) => {
    const tag61Lines = entry.tag61.split(/\r?\n/);
    const firstLine = tag61Lines[0].trim();
    const supplementary = tag61Lines.slice(1).join(' ').trim();

    const m = firstLine.match(
      /^(\d{6})(\d{4})?(RC|RD|C|D)([A-Z])?(\d+,\d{0,2})([A-Z][A-Z0-9]{3})(.*)$/
    );
    if (!m) {
      throw new Error(`Invalid MT940 :61: statement line #${index + 1}: "${firstLine}"`);
    }

    const [, valDateRaw, entryDateRaw, dcMark, , amountStr, txCode, refTail] = m;
    const valueDate = parseYyMmDd(valDateRaw);
    const bookingDate = resolveEntryDate(valueDate, entryDateRaw);
    const amountCents = parseMt940AmountCents(amountStr);

    // SWIFT MT940 standard:
    // C = Credit (+), D = Debit (-), RC = Reversal of Credit (-), RD = Reversal of Debit (+)
    const isReversal = dcMark === 'RC' || dcMark === 'RD';
    const isNetCredit = dcMark === 'C' || dcMark === 'RD';
    const direction = isNetCredit ? 'CREDIT' : 'DEBIT';
    const signedCents = isNetCredit ? amountCents : -amountCents;

    if (isNetCredit) totalCreditCents += amountCents;
    else totalDebitCents += amountCents;

    let customerReference = refTail.trim();
    let bankReference = '';
    const doubleSlashIdx = refTail.indexOf('//');
    if (doubleSlashIdx !== -1) {
      customerReference = refTail.slice(0, doubleSlashIdx).trim();
      bankReference = refTail.slice(doubleSlashIdx + 2).trim();
    }
    if (customerReference === 'NONREF') customerReference = '';

    const rawNarrative = [entry.tag86, supplementary].filter(Boolean).join('\n');
    const cleanDescription = (entry.tag86 || supplementary || `${txCode} ${customerReference}`)
      .replace(/\r?\n/g, ' ')
      .replace(/\?[0-9]{2}/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const extracted = extractPortugueseMetadata(
      `${cleanDescription} ${customerReference} ${bankReference}`,
      normalizedIban
    );

    const occKey = `${bookingDate}|${direction}|${amountCents}|${bankReference}|${customerReference}|${cleanDescription}`;
    const occ = (occurrenceCounter.get(occKey) ?? 0) + 1;
    occurrenceCounter.set(occKey, occ);

    const fingerprint = buildLineFingerprint({
      bankCode: 'MT940',
      accountKey: normalizedIban ?? normalizedAccountNumber,
      bookingDate,
      valueDate,
      direction,
      amountCents,
      bankReference,
      customerReference,
      description: cleanDescription,
      occurrenceWithinStatement: occ,
    });

    lines.push({
      lineNumber: index + 1,
      bookingDate,
      valueDate,
      direction,
      amount: amountCents / 100,
      signedAmount: signedCents / 100,
      currency,
      isReversal,
      transactionCode: txCode,
      bankReference,
      customerReference,
      description: cleanDescription,
      rawNarrative,
      extracted,
      fingerprint,
    });
  });

  const calculatedClosingCents = opening.signedCents + totalCreditCents - totalDebitCents;
  const discrepancyCents = closing.signedCents - calculatedClosingCents;

  const allDates = [
    opening.dateIso,
    closing.dateIso,
    ...lines.map((l) => l.bookingDate),
  ].sort();

  return {
    format: 'MT940',
    bankCode,
    statementId: [statementRef, statementSeq].filter(Boolean).join('/') || `MT940-${closing.dateIso}`,
    accountIdentifier: accountRaw,
    normalizedIban,
    normalizedAccountNumber,
    currency,
    periodStart: opening.dateIso || allDates[0],
    periodEnd: closing.dateIso || allDates[allDates.length - 1],
    openingBalance: opening.signedCents / 100,
    closingBalance: closing.signedCents / 100,
    calculatedClosingBalance: calculatedClosingCents / 100,
    balanceVerified: discrepancyCents === 0,
    balanceDiscrepancy: discrepancyCents / 100,
    totalCredits: totalCreditCents / 100,
    totalDebits: totalDebitCents / 100,
    lines,
  };
}
