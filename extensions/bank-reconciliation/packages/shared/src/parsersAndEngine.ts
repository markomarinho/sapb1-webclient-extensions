import type {
  B1OpenDocument,
  B1UnreconciledJournalLine,
  ConfidenceTier,
  ExtractedPortugueseMetadata,
  GlMatchingRule,
  MatchSuggestion,
  ParsedBankStatement,
  ParsedStatementLine,
  StagedBankLine,
  StatementFormat,
} from './index.js';

// Pure TypeScript SHA-256 (works identically in Browser & Node.js without node:crypto)
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(n: number, x: number): number {
  return (x >>> n) | (x << (32 - n));
}

export function sha256Hex(asciiOrUtf8: string): string {
  const bytes = new TextEncoder().encode(asciiOrUtf8);
  const bitLen = bytes.length * 8;
  const totalLen = (((bytes.length + 8) >> 6) + 1) << 6;
  const padded = new Uint8Array(totalLen);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(totalLen - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(totalLen - 4, bitLen >>> 0, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const w = new Uint32Array(64);
  for (let offset = 0; offset < totalLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(7, w[i - 15]) ^ rotr(18, w[i - 15]) ^ (w[i - 15] >>> 3);
      const s1 = rotr(17, w[i - 2]) ^ rotr(19, w[i - 2]) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(6, e) ^ rotr(11, e) ^ rotr(25, e);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(2, a) ^ rotr(13, a) ^ rotr(22, a);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((v) => v.toString(16).padStart(8, '0'))
    .join('');
}

export function isValidIban(raw: string): boolean {
  const iban = raw.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  if (iban.startsWith('PT') && iban.length !== 25) return false;

  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let numeric = '';
  for (const ch of rearranged) {
    const code = ch.charCodeAt(0);
    if (code >= 65 && code <= 90) {
      numeric += String(code - 55);
    } else {
      numeric += ch;
    }
  }

  let remainder = 0;
  for (let i = 0; i < numeric.length; i++) {
    remainder = (remainder * 10 + Number(numeric[i])) % 97;
  }
  return remainder === 1;
}

export function isValidPortugueseNif(nif: string): boolean {
  if (!/^[12356789]\d{8}$/.test(nif)) return false;
  let sum = 0;
  for (let i = 0; i < 8; i++) {
    sum += Number(nif[i]) * (9 - i);
  }
  const remainder = sum % 11;
  const expectedCheck = remainder < 2 ? 0 : 11 - remainder;
  return Number(nif[8]) === expectedCheck;
}

export function decodeStatementBytes(bytes: Uint8Array): string {
  const utf8Text = new TextDecoder('utf-8').decode(bytes);
  if (utf8Text.includes('\uFFFD')) {
    return new TextDecoder('windows-1252').decode(bytes);
  }
  return utf8Text;
}

export function buildLineFingerprint(parts: {
  bankCode: string;
  accountKey: string;
  bookingDate: string;
  valueDate: string;
  direction: string;
  amountCents: number;
  bankReference: string;
  customerReference: string;
  description: string;
  occurrenceWithinStatement: number;
}): string {
  const raw = [
    parts.bankCode,
    parts.accountKey.replace(/\s+/g, '').toUpperCase(),
    parts.bookingDate,
    parts.valueDate,
    parts.direction,
    String(parts.amountCents),
    parts.bankReference.trim(),
    parts.customerReference.trim(),
    parts.description.trim().replace(/\s+/g, ' '),
    String(parts.occurrenceWithinStatement),
  ].join('|');

  return sha256Hex(raw).slice(0, 32);
}

export function extractPortugueseMetadata(
  narrative: string,
  ownAccountIban?: string
): ExtractedPortugueseMetadata {
  const normalizedOwnIban = (ownAccountIban ?? '').replace(/\s+/g, '').toUpperCase();
  const compact = narrative.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();

  let counterpartyIban: string | undefined;
  const ptSpacedRegex = /\b(PT\d{2}(?:\s?\d{4}){5}\s?\d{1})\b/gi;
  const generalIbanRegex = /\b([A-Z]{2}\d{2}[A-Z0-9]{11,30})\b/g;

  for (const match of compact.matchAll(ptSpacedRegex)) {
    const candidate = match[1].replace(/\s+/g, '').toUpperCase();
    if (candidate !== normalizedOwnIban && isValidIban(candidate)) {
      counterpartyIban = candidate;
      break;
    }
  }
  if (!counterpartyIban) {
    for (const match of compact.matchAll(generalIbanRegex)) {
      const candidate = match[1].replace(/\s+/g, '').toUpperCase();
      if (candidate !== normalizedOwnIban && isValidIban(candidate)) {
        counterpartyIban = candidate;
        break;
      }
    }
  }

  let multibancoEntity: string | undefined;
  let multibancoRef: string | undefined;
  const mbPattern =
    /(?:ENT(?:IDADE)?|MB)[:.\s/-]*(\d{5})[\s,;/|-]*(?:REF(?:ERENCIA)?[:.\s/-]*)?(\d{3}\s?\d{3}\s?\d{3}|\d{9})\b/i;
  const mbMatch = compact.match(mbPattern);
  if (mbMatch) {
    multibancoEntity = mbMatch[1];
    multibancoRef = mbMatch[2].replace(/\s+/g, '');
  } else {
    const refOnlyMatch = compact.match(/\bREF\s*MB[:.\s/-]*(\d{3}\s?\d{3}\s?\d{3}|\d{9})\b/i);
    if (refOnlyMatch) {
      multibancoRef = refOnlyMatch[1].replace(/\s+/g, '');
    }
  }

  let counterpartyNif: string | undefined;
  const strippedForNif = counterpartyIban ? compact.replace(counterpartyIban, ' ') : compact;
  const explicitNifMatch = strippedForNif.match(/\b(?:NIF|NIPC|CONTRIB)[:.\s/-]*(\d{9})\b/i);
  if (explicitNifMatch && isValidPortugueseNif(explicitNifMatch[1])) {
    counterpartyNif = explicitNifMatch[1];
  } else {
    for (const m of strippedForNif.matchAll(/\b([12356789]\d{8})\b/g)) {
      const cand = m[1];
      if (cand !== multibancoRef && isValidPortugueseNif(cand)) {
        counterpartyNif = cand;
        break;
      }
    }
  }

  let sepaEndToEndId: string | undefined;
  const erefSlash = compact.match(/\/EREF\/([^/\s]{3,35})/i);
  const erefPlus = compact.match(/EREF\+([^\s+]{3,35})/i);
  if (erefSlash && erefSlash[1] !== 'NOTPROVIDED') {
    sepaEndToEndId = erefSlash[1];
  } else if (erefPlus && erefPlus[1] !== 'NOTPROVIDED') {
    sepaEndToEndId = erefPlus[1];
  }

  let counterpartyName: string | undefined;
  const namePatterns = [
    /\/(?:ORDP|BENM)\/\/NAME\/([^/]+)/i,
    /(?:ORDENANTE|BENEFICIARIO|DE|FAVOR)[:\s]+([A-ZÀ-ÿ0-9 .,&-]{4,45}?)(?=\s+(?:IBAN|PT50|NIF|FT|FAT|REF|DOC|$))/i,
  ];
  for (const pat of namePatterns) {
    const nm = compact.match(pat);
    if (nm) {
      counterpartyName = nm[1].trim();
      break;
    }
  }

  const invoiceSet = new Set<string>();
  // Match any document series pattern (e.g. FT 2026/1042, FTB 2026/105, FA 2026A/5021, SERIE2/1080, 2026/1042)
  const atInvoiceRegex = /\b((?:[A-Z]{1,6}\s*)?(?:20\d{2}[A-Z0-9]*|[A-Z0-9]{1,8})[/-]\d{1,10})\b/gi;
  for (const m of compact.matchAll(atInvoiceRegex)) {
    const token = m[1].replace(/\s+/g, ' ').toUpperCase();
    // Skip dates like 11/2026 or IBAN fragments
    const parts = token.split(/[/-]/);
    const trailingNum = parts[parts.length - 1];
    if (trailingNum && /^\d{1,10}$/.test(trailingNum)) {
      invoiceSet.add(token);
      invoiceSet.add(trailingNum);
    }
  }

  const docNumRegex = /\b(?:FAT(?:URA)?|FAC(?:TURA)?|INV(?:OICE)?|DOC(?:UMENTO)?|FT|FA|FR|FS|NC|ND|VD|VF|RC|OP)[:.\s#/-]*([A-Z0-9_-]*?[/-])?(\d{1,10})\b/gi;
  for (const m of compact.matchAll(docNumRegex)) {
    invoiceSet.add(m[2]);
    if (m[1]) {
      invoiceSet.add(`${m[1]}${m[2]}`.toUpperCase());
    }
  }

  return {
    counterpartyIban,
    counterpartyNif,
    counterpartyName,
    multibancoEntity,
    multibancoRef,
    invoiceCandidates: Array.from(invoiceSet),
    sepaEndToEndId,
  };
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

export function parseMt940(content: string): ParsedBankStatement {
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

  const rawLines = body.split(/\r?\n/);
  const tags: Array<{ tag: string; value: string }> = [];
  let current: { tag: string; value: string } | null = null;

  for (const rawLine of rawLines) {
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
  const allDates = [opening.dateIso, closing.dateIso, ...lines.map((l) => l.bookingDate)].sort();

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

const ISO_NUMERIC_CURRENCY: Record<string, string> = {
  '978': 'EUR',
  '840': 'USD',
  '826': 'GBP',
  '756': 'CHF',
  '986': 'BRL',
};

function parseIntegerField(raw: string, fieldName: string): number {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`Invalid numeric field ${fieldName} in Norma 43: "${raw}"`);
  }
  return parseInt(trimmed, 10);
}

export function parseNorma43(content: string): ParsedBankStatement {
  const rawLines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
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

  interface PendingN43 {
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

  const movements: PendingN43[] = [];
  let activeMovement: PendingN43 | null = null;

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
          const openSign = rec.slice(32, 33);
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
        if (activeMovement) movements.push(activeMovement);
        const movBranch = rec.slice(6, 10).trim();
        const bookingDate = parseYyMmDd(rec.slice(10, 16));
        const valueDate = parseYyMmDd(rec.slice(16, 22));
        const commonConcept = rec.slice(22, 24).trim();
        const ownConcept = rec.slice(24, 27).trim();
        const movSign = rec.slice(27, 28);
        if (movSign !== '1' && movSign !== '2') {
          throw new Error(`Invalid Norma 43 movement sign "${movSign}" at line ${idx + 1}.`);
        }
        const amountCents = parseIntegerField(rec.slice(28, 42), `MovementAmount(22@${idx + 1})`);
        const cleanZero = (v: string) => (/^0+$/.test(v) ? '' : v);

        activeMovement = {
          branch: movBranch,
          bookingDate,
          valueDate,
          commonConcept,
          ownConcept,
          direction: movSign === '2' ? 'CREDIT' : 'DEBIT',
          amountCents,
          signedCents: movSign === '2' ? amountCents : -amountCents,
          documentNumber: cleanZero(rec.slice(42, 52).trim()),
          ref1: cleanZero(rec.slice(52, 64).trim()),
          ref2: cleanZero(rec.slice(64, 80).trim()),
          conceptSegments: [],
          rawLines: [rec.trimEnd()],
        };
        break;
      }
      case '23': {
        if (!activeMovement) {
          throw new Error(`Orphan Norma 43 complementary record 23 at line ${idx + 1}.`);
        }
        const c1 = rec.slice(4, 42).trim();
        const c2 = rec.slice(42, 80).trim();
        if (c1) activeMovement.conceptSegments.push(c1);
        if (c2) activeMovement.conceptSegments.push(c2);
        activeMovement.rawLines.push(rec.trimEnd());
        break;
      }
      case '24': {
        if (activeMovement) activeMovement.rawLines.push(rec.trimEnd());
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
        const closeSign = rec.slice(58, 59);
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

  if (activeMovement) movements.push(activeMovement);
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
    balanceVerified: discrepancyCents === 0 && footerTotalsMatch,
    balanceDiscrepancy: discrepancyCents / 100,
    totalCredits: totalCreditCents / 100,
    totalDebits: totalDebitCents / 100,
    lines,
  };
}

export function detectStatementFormat(text: string, fileName?: string): StatementFormat {
  const trimmed = text.trimStart();
  if (
    trimmed.includes(':20:') &&
    (trimmed.includes(':60F:') || trimmed.includes(':60M:')) &&
    (trimmed.includes(':62F:') || trimmed.includes(':62M:'))
  ) {
    return 'MT940';
  }
  const firstLine = trimmed.split(/\r?\n/)[0] ?? '';
  if (firstLine.startsWith('11') && firstLine.length >= 50 && /^\d+$/.test(firstLine.slice(0, 33))) {
    return 'NORMA43';
  }
  const lowerName = (fileName ?? '').toLowerCase();
  if (lowerName.endsWith('.mt940') || lowerName.endsWith('.sta') || lowerName.endsWith('.940')) {
    return 'MT940';
  }
  if (lowerName.endsWith('.n43') || lowerName.endsWith('.c43') || lowerName.endsWith('.aeb')) {
    return 'NORMA43';
  }
  throw new Error(
    'Unrecognized statement format. Expected SWIFT MT940 (:20:/:60F:) or Norma 43 / AEB Cuaderno 43 (record 11).'
  );
}

// ---------------------------------------------------------------------------
// Shared Pure-TS Matching / Scoring Function (Browser & Node.js)
// ---------------------------------------------------------------------------
function daysBetween(dateA: string, dateB: string): number {
  const msA = Date.parse(`${dateA}T00:00:00Z`);
  const msB = Date.parse(`${dateB}T00:00:00Z`);
  if (Number.isNaN(msA) || Number.isNaN(msB)) return 999;
  return Math.abs(Math.round((msA - msB) / 86_400_000));
}

function toCents(amount: number): number {
  return Math.round(amount * 100);
}

function tierForScore(score: number): ConfidenceTier {
  if (score >= 85) return 'HIGH';
  if (score >= 70) return 'MEDIUM';
  return 'LOW';
}

function normalizeAsciiUpper(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

function normalizeWords(text: string): string[] {
  return normalizeAsciiUpper(text)
    .replace(/[^A-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(
      (w) =>
        w.length >= 4 &&
        !['LDA', 'SA', 'SOCIEDADE', 'UNIPESSOAL', 'COMERCIO', 'PORTUGAL'].includes(w)
    );
}

function nameTokenOverlap(description: string, cardName?: string): boolean {
  if (!cardName) return false;
  const descUpper = normalizeAsciiUpper(description);
  const bpTokens = normalizeWords(cardName);
  return bpTokens.some((tok) => descUpper.includes(tok));
}

function findExactInvoiceBundle(
  docs: B1OpenDocument[],
  targetCents: number,
  maxDocs = 5
): B1OpenDocument[] | null {
  const hasCreditMemos = docs.some((d) => toCents(d.openAmount) < 0);
  const eligible = docs.filter((d) => {
    const c = toCents(d.openAmount);
    if (c === 0) return false;
    if (!hasCreditMemos && c >= targetCents) return false;
    return true;
  });

  if (eligible.length < 2) return null;
  const pool = eligible.slice(0, 15);

  function backtrack(
    startIdx: number,
    chosen: B1OpenDocument[],
    sumCents: number
  ): B1OpenDocument[] | null {
    if (sumCents === targetCents && chosen.length >= 2) return chosen;
    if (chosen.length >= maxDocs) return null;
    if (!hasCreditMemos && sumCents > targetCents) return null;

    for (let i = startIdx; i < pool.length; i++) {
      const doc = pool[i];
      const res = backtrack(i + 1, [...chosen, doc], sumCents + toCents(doc.openAmount));
      if (res) return res;
    }
    return null;
  }

  return backtrack(0, [], 0);
}

export function scoreSingleBankLine(
  line: StagedBankLine,
  journalLines: B1UnreconciledJournalLine[],
  openDocs: B1OpenDocument[],
  glRules: GlMatchingRule[] = []
): MatchSuggestion[] {
  const suggestions: MatchSuggestion[] = [];
  const lineCents = toCents(line.amount);
  const signedLineCents = toCents(line.signedAmount);
  const meta = line.extracted;
  const upperDesc = `${line.description} ${line.customerReference} ${line.bankReference}`.toUpperCase();
  const normDesc = normalizeAsciiUpper(upperDesc);

  for (const je of journalLines) {
    if (toCents(je.signedAmount) !== signedLineCents) continue;
    const dayDiff = daysBetween(line.bookingDate, je.refDate);
    if (dayDiff > 20) continue;

    let score = 76;
    const reasons: string[] = ['Montante Exato no Razão (G/L)'];
    if (dayDiff <= 3) {
      score += 10;
      reasons.push(`Data ±${dayDiff}d`);
    } else if (dayDiff <= 10) {
      score += 5;
    }
    if (meta.counterpartyNif && je.nif && meta.counterpartyNif === je.nif) {
      score += 10;
      reasons.push(`NIF ${je.nif}`);
    }
    if (
      (je.sourceDocNum && upperDesc.includes(String(je.sourceDocNum))) ||
      (je.ref2 && je.ref2.length >= 4 && upperDesc.includes(je.ref2.toUpperCase())) ||
      (je.ref1 && je.ref1.length >= 4 && upperDesc.includes(je.ref1.toUpperCase()))
    ) {
      score += 10;
      reasons.push(`Ref. Pagamento #${je.ref2 || je.sourceDocNum || je.ref1}`);
    }
    if (nameTokenOverlap(line.description, je.cardName)) {
      score += 6;
      reasons.push('Nome do Parceiro Coincidente');
    }

    const capped = Math.min(98, score);
    suggestions.push({
      id: `sug-je-${line.id}-${je.transId}-${je.lineId}`,
      bankLineId: line.id,
      targetType: 'EXISTING_JOURNAL_ENTRY',
      confidence: capped,
      tier: tierForScore(capped),
      reasons,
      cardCode: je.cardCode,
      cardName: je.cardName || je.memo,
      nif: je.nif,
      matchedAmount: line.amount,
      differenceAmount: 0,
      journalLine: je,
    });
  }

  for (const doc of openDocs) {
    if (doc.openAmount <= 0) continue;
    const docOpenCents = toCents(doc.openAmount);
    const exactAmount = docOpenCents === lineCents;

    const mbExact =
      Boolean(meta.multibancoRef && doc.multibancoRef && meta.multibancoRef === doc.multibancoRef) &&
      (!meta.multibancoEntity || !doc.multibancoEntity || meta.multibancoEntity === doc.multibancoEntity);
    const ibanMatch = Boolean(
      meta.counterpartyIban && doc.bpIbans.some((ib) => ib.toUpperCase() === meta.counterpartyIban)
    );
    const nifMatch = Boolean(meta.counterpartyNif && doc.nif && meta.counterpartyNif === doc.nif);
    const seriesDocToken = doc.seriesName ? `${doc.seriesName}/${doc.docNum}`.toUpperCase() : '';
    const seriesSpaceDocToken = doc.seriesName ? `${doc.seriesName} ${doc.docNum}`.toUpperCase() : '';
    const docNumMatched =
      meta.invoiceCandidates.includes(String(doc.docNum)) ||
      (seriesDocToken !== '' && upperDesc.includes(seriesDocToken)) ||
      (seriesSpaceDocToken !== '' && upperDesc.includes(seriesSpaceDocToken)) ||
      Boolean(doc.atDocNumber && upperDesc.includes(doc.atDocNumber.toUpperCase()));
    const bpNameMatched = nameTokenOverlap(line.description, doc.cardName);

    if (!exactAmount && !mbExact && !(docNumMatched && (ibanMatch || nifMatch))) {
      continue;
    }

    let score = 0;
    const reasons: string[] = [];

    if (mbExact && exactAmount) {
      score = 98;
      reasons.push(`Multibanco ${doc.multibancoEntity ?? ''}/${doc.multibancoRef}`, 'Montante Exato');
    } else if (exactAmount) {
      score = 52;
      reasons.push('Montante em Aberto Exato');
      if (ibanMatch) {
        score += 26;
        reasons.push(`IBAN ${meta.counterpartyIban?.slice(0, 8)}...`);
      }
      if (nifMatch) {
        score += 20;
        reasons.push(`NIF ${doc.nif}`);
      }
      if (docNumMatched) {
        score += 26;
        reasons.push(`Doc ${doc.atDocNumber || doc.docNum}`);
      }
      if (bpNameMatched) {
        score += 10;
        reasons.push('Nome do Parceiro Coincidente');
      }
      const dueDiff = daysBetween(line.bookingDate, doc.dueDate);
      if (dueDiff <= 7) {
        score += 6;
        reasons.push(`Vencimento ±${dueDiff}d`);
      } else if (dueDiff <= 20) {
        score += 3;
      }
    } else if (docOpenCents > lineCents && (mbExact || (docNumMatched && (ibanMatch || nifMatch)))) {
      score = 78;
      reasons.push('Pagamento Parcial de Fatura Identificada');
      if (docNumMatched) reasons.push(`Doc ${doc.atDocNumber || doc.docNum}`);
      if (nifMatch) reasons.push(`NIF ${doc.nif}`);
    }

    if (score >= 52) {
      const capped = Math.min(98, score);
      const allocated = Math.min(line.amount, doc.openAmount);
      suggestions.push({
        id: `sug-doc-${line.id}-${doc.docType}-${doc.docEntry}`,
        bankLineId: line.id,
        targetType: doc.docType === 'AR_INVOICE' ? 'OPEN_AR_INVOICE' : 'OPEN_AP_INVOICE',
        confidence: capped,
        tier: tierForScore(capped),
        reasons,
        cardCode: doc.cardCode,
        cardName: doc.cardName,
        nif: doc.nif,
        matchedAmount: allocated,
        differenceAmount: Math.round((line.amount - allocated) * 100) / 100,
        allocations: [
          {
            docType: doc.docType,
            docEntry: doc.docEntry,
            docNum: doc.docNum,
            seriesCode: doc.seriesCode,
            seriesName: doc.seriesName,
            atDocNumber: doc.atDocNumber,
            cardCode: doc.cardCode,
            cardName: doc.cardName,
            dueDate: doc.dueDate,
            openAmount: doc.openAmount,
            allocatedAmount: allocated,
          },
        ],
      });
    }
  }

  const docsByBp = new Map<string, B1OpenDocument[]>();
  for (const d of openDocs) {
    const arr = docsByBp.get(d.cardCode) ?? [];
    arr.push(d);
    docsByBp.set(d.cardCode, arr);
  }

  for (const [cardCode, bpDocs] of docsByBp.entries()) {
    if (bpDocs.length < 2) continue;
    const bundle = findExactInvoiceBundle(bpDocs, lineCents);
    if (!bundle) continue;

    const sampleDoc = bundle[0];
    const hasCreditMemo = bundle.some((b) => b.openAmount < 0);
    const ibanMatch = Boolean(
      meta.counterpartyIban && sampleDoc.bpIbans.some((ib) => ib.toUpperCase() === meta.counterpartyIban)
    );
    const nifMatch = Boolean(meta.counterpartyNif && sampleDoc.nif && meta.counterpartyNif === sampleDoc.nif);
    const bpNameMatched = nameTokenOverlap(line.description, sampleDoc.cardName);

    let score = 62;
    const reasons: string[] = [
      hasCreditMemo
        ? `Soma Líquida Exata (${bundle.length} Docs incl. Credit Memo)`
        : `Soma Exata de ${bundle.length} Faturas em Aberto`,
    ];
    if (ibanMatch) {
      score += 18;
      reasons.push(`IBAN ${meta.counterpartyIban?.slice(0, 8)}...`);
    }
    if (nifMatch) {
      score += 14;
      reasons.push(`NIF ${sampleDoc.nif}`);
    }
    if (bpNameMatched) {
      score += 6;
      reasons.push('Nome do Parceiro Coincidente');
    }

    const capped = Math.min(95, score);
    suggestions.push({
      id: `sug-bundle-${line.id}-${cardCode}`,
      bankLineId: line.id,
      targetType: 'MULTI_INVOICE_BUNDLE',
      confidence: capped,
      tier: tierForScore(capped),
      reasons,
      cardCode,
      cardName: sampleDoc.cardName,
      nif: sampleDoc.nif,
      matchedAmount: line.amount,
      differenceAmount: 0,
      allocations: bundle.map((b) => ({
        docType: b.docType,
        docEntry: b.docEntry,
        docNum: b.docNum,
        seriesCode: b.seriesCode,
        seriesName: b.seriesName,
        atDocNumber: b.atDocNumber,
        cardCode: b.cardCode,
        cardName: b.cardName,
        dueDate: b.dueDate,
        openAmount: b.openAmount,
        allocatedAmount: b.openAmount,
      })),
    });
  }

  for (const rule of glRules) {
    if (rule.direction !== line.direction) continue;
    const keywords = rule.keywordsPattern
      .split(',')
      .map((k) => normalizeAsciiUpper(k).trim())
      .filter(Boolean);
    const matchedKeyword = keywords.find((kw) => normDesc.includes(kw));
    if (!matchedKeyword) continue;

    const score = Math.min(97, Math.max(55, rule.confidence));
    suggestions.push({
      id: `sug-gl-${line.id}-${rule.id}`,
      bankLineId: line.id,
      targetType: 'DIRECT_GL_ACCOUNT',
      confidence: score,
      tier: tierForScore(score),
      reasons: [`Regra G/L: "${matchedKeyword}"`, `Conta ${rule.glAccountCode} (${rule.glAccountName})`],
      cardCode: rule.glAccountCode,
      cardName: `${rule.glAccountCode} — ${rule.glAccountName}`,
      matchedAmount: line.amount,
      differenceAmount: 0,
      glAccountMatch: {
        ruleId: rule.id,
        glAccountCode: rule.glAccountCode,
        glAccountName: rule.glAccountName,
      },
    });
  }

  return suggestions.sort((a, b) => b.confidence - a.confidence);
}
