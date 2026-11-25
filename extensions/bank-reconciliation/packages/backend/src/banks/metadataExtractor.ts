import crypto from 'node:crypto';
import type { ExtractedPortugueseMetadata } from '@b1-recon/shared';

/**
 * Validates an IBAN using ISO 13616 Modulo-97 check.
 */
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

/**
 * Validates a 9-digit Portuguese NIF (Número de Identificação Fiscal)
 * using the official Modulo-11 check digit algorithm.
 */
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

/**
 * Decodes a statement buffer automatically detecting UTF-8 vs Windows-1252 / ISO-8859-1
 * (common in corporate banking MT940 and Norma 43 exports).
 */
export function decodeStatementBuffer(buffer: Buffer): string {
  const utf8Text = buffer.toString('utf8');
  if (utf8Text.includes('\uFFFD')) {
    return new TextDecoder('windows-1252').decode(buffer);
  }
  return utf8Text;
}

/**
 * Computes a deterministic idempotency fingerprint for a statement movement
 * so overlapping statement exports never duplicate rows.
 */
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

  return crypto.createHash('sha256').update(raw, 'utf8').digest('hex').slice(0, 32);
}

/**
 * Extracts structured Portuguese banking entities (IBAN, NIF, Multibanco Entity/Ref,
 * AT Invoice / SAP DocNum candidates, SEPA EndToEndId, Counterparty Name) from
 * unstructured SWIFT MT940 (:86:) or Norma 43 (records 22/23) narratives.
 */
export function extractPortugueseMetadata(
  narrative: string,
  ownAccountIban?: string
): ExtractedPortugueseMetadata {
  const normalizedOwnIban = (ownAccountIban ?? '').replace(/\s+/g, '').toUpperCase();
  const compact = narrative.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();

  // 1. IBAN detection (handles spaced PT50 0035 0651 ... or contiguous PT500035...)
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

  // 2. Multibanco Entity + 9-digit Reference (before NIF scan so MB ref isn't confused with NIF)
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

  // 3. Portuguese NIF (9 digits passing Mod-11 check, excluding the MB reference and IBAN digits)
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

  // 4. SEPA EndToEndId (/EREF/... or EREF+...)
  let sepaEndToEndId: string | undefined;
  const erefSlash = compact.match(/\/EREF\/([^/\s]{3,35})/i);
  const erefPlus = compact.match(/EREF\+([^\s+]{3,35})/i);
  if (erefSlash && erefSlash[1] !== 'NOTPROVIDED') {
    sepaEndToEndId = erefSlash[1];
  } else if (erefPlus && erefPlus[1] !== 'NOTPROVIDED') {
    sepaEndToEndId = erefPlus[1];
  }

  // 5. Counterparty Name (/ORDP/, /BENM/, ORD:, BEN:, DE:, A FAVOR DE)
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

  // 6. Invoice / Document Number candidates (AT format FT 2026/1042, FA 2026/55, FAT 1042, DOC 20045)
  const invoiceSet = new Set<string>();
  const atInvoiceRegex = /\b((?:FT|FA|FR|FS|NC|ND)\s*20\d{2}[/-]\d{1,8})\b/gi;
  for (const m of compact.matchAll(atInvoiceRegex)) {
    invoiceSet.add(m[1].replace(/\s+/g, ' ').toUpperCase());
    const trailingNum = m[1].split(/[/-]/)[1];
    if (trailingNum) invoiceSet.add(trailingNum);
  }

  const docNumRegex = /\b(?:FAT(?:URA)?|FAC(?:TURA)?|INV(?:OICE)?|DOC(?:UMENTO)?)[:.\s#/-]*(\d{3,10})\b/gi;
  for (const m of compact.matchAll(docNumRegex)) {
    invoiceSet.add(m[1]);
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
