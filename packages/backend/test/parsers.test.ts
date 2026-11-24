import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  decodeStatementBuffer,
  extractPortugueseMetadata,
  isValidIban,
  isValidPortugueseNif,
} from '../src/banks/metadataExtractor.js';
import { parseMt940 } from '../src/banks/parsers/mt940Parser.js';
import { parseNorma43 } from '../src/banks/parsers/norma43Parser.js';
import { SecretVault } from '../src/config/vault.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const samplesDir = path.resolve(__dirname, '../../../samples');

describe('Security Vault & Portuguese Identifiers', () => {
  it('encrypts and decrypts secrets with AES-256-GCM and detects tampering', () => {
    const vault = new SecretVault('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');
    const cipher = vault.encrypt('SuperSecretHanaReadOnlyPwd!2026');
    assert.notEqual(cipher, 'SuperSecretHanaReadOnlyPwd!2026');
    assert.equal(vault.decrypt(cipher), 'SuperSecretHanaReadOnlyPwd!2026');

    const parts = cipher.split(':');
    const flipped = `${parts[0]}:AAAAAAAAAAAAAAAAAAAAAA==:${parts[2]}`;
    assert.throws(() => vault.decrypt(flipped));
  });

  it('validates Portuguese NIF (Modulo-11) and IBAN (Modulo-97) accurately', () => {
    assert.equal(isValidPortugueseNif('509876544'), true);
    assert.equal(isValidPortugueseNif('501234560'), true);
    assert.equal(isValidPortugueseNif('509876540'), false);

    assert.equal(isValidIban('PT50003506510008432190079'), true);
    assert.equal(isValidIban('PT50 0033 0000 4561 2345 6786 2'), true);
    assert.equal(isValidIban('PT50003506510008432190000'), false);
  });

  it('decodes Windows-1252 Portuguese diacritics cleanly when non-UTF8', () => {
    const win1252Bytes = Buffer.from([
      0x54, 0x52, 0x41, 0x4e, 0x53, 0x46, 0x45, 0x52, 0xca, 0x4e, 0x43, 0x49, 0x41, 0x20, 0xc7,
    ]);
    const decoded = decodeStatementBuffer(win1252Bytes);
    assert.equal(decoded, 'TRANSFERÊNCIA Ç');
  });
});

describe('SWIFT MT940 Statement Parser', () => {
  it('parses sample MT940 statement, verifies balances, and extracts PT metadata', () => {
    const content = fs.readFileSync(path.join(samplesDir, 'statement_2026_11.mt940'), 'utf8');
    const parsed = parseMt940(content);

    assert.equal(parsed.format, 'MT940');
    assert.equal(parsed.normalizedIban, 'PT50003506510008432190079');
    assert.equal(parsed.openingBalance, 45200.0);
    assert.equal(parsed.closingBalance, 49640.0);
    assert.equal(parsed.balanceVerified, true);
    assert.equal(parsed.balanceDiscrepancy, 0);
    assert.equal(parsed.lines.length, 4);

    // Line 1: Multibanco Entity + Ref
    const l1 = parsed.lines[0];
    assert.equal(l1.direction, 'CREDIT');
    assert.equal(l1.amount, 1845.0);
    assert.equal(l1.extracted.multibancoEntity, '21345');
    assert.equal(l1.extracted.multibancoRef, '104200890');

    // Line 2: SEPA IBAN + NIF + Invoice FT 2026/1055
    const l2 = parsed.lines[1];
    assert.equal(l2.extracted.counterpartyIban, 'PT50001800031928374650055');
    assert.equal(l2.extracted.counterpartyNif, '509876544');
    assert.ok(l2.extracted.invoiceCandidates.includes('FT 2026/1055'));
    assert.equal(l2.extracted.sepaEndToEndId, 'END2END-TL-1055');
  });

  it('handles MT940 RC/RD reversals and detects mathematical balance discrepancies', () => {
    const mt940WithReversal = `
:20:STMTREV01
:25:PT50003506510008432190079
:60F:C261101EUR1000,00
:61:2611021102CE500,00NTRFREF1//BNK1
:86:RECEBIMENTO INICIAL
:61:2611031103RCE500,00NTRFREF1//BNK2
:86:ANULACAO RECEBIMENTO
:62F:C261103EUR1000,00
`;
    const parsed = parseMt940(mt940WithReversal);
    assert.equal(parsed.balanceVerified, true);
    assert.equal(parsed.lines[1].isReversal, true);
    assert.equal(parsed.lines[1].direction, 'DEBIT');
    assert.equal(parsed.lines[1].signedAmount, -500.0);

    const corrupted = mt940WithReversal.replace('C261103EUR1000,00', 'C261103EUR1250,00');
    const badParsed = parseMt940(corrupted);
    assert.equal(badParsed.balanceVerified, false);
    assert.equal(badParsed.balanceDiscrepancy, 250.0);
  });
});

describe('Norma 43 (AEB Cuaderno 43) Statement Parser', () => {
  it('parses sample Norma 43 file and validates Record 33 control totals', () => {
    const content = fs.readFileSync(path.join(samplesDir, 'statement_2026_11.n43'), 'utf8');
    const parsed = parseNorma43(content);

    assert.equal(parsed.format, 'NORMA43');
    assert.equal(parsed.normalizedAccountNumber, '4561234567');
    assert.equal(parsed.currency, 'EUR');
    assert.equal(parsed.openingBalance, 28500.0);
    assert.equal(parsed.closingBalance, 31575.0);
    assert.equal(parsed.totalCredits, 4674.0);
    assert.equal(parsed.totalDebits, 1599.0);
    assert.equal(parsed.balanceVerified, true);
    assert.equal(parsed.lines.length, 3);

    // Line 1: Corticeira do Sul bundle inflow
    assert.equal(parsed.lines[0].direction, 'CREDIT');
    assert.equal(parsed.lines[0].amount, 3690.0);
    assert.equal(parsed.lines[0].extracted.counterpartyIban, 'PT50003302009988776650017');
    assert.equal(parsed.lines[0].extracted.counterpartyNif, '507654323');

    // Line 2: Supplier AP outflow
    assert.equal(parsed.lines[1].direction, 'DEBIT');
    assert.equal(parsed.lines[1].amount, 1599.0);
    assert.equal(parsed.lines[1].extracted.counterpartyNif, '501234560');
    assert.ok(parsed.lines[1].extracted.invoiceCandidates.includes('5021'));
  });

  it('extracts Multibanco references from unstructured Portuguese text', () => {
    const meta = extractPortugueseMetadata('PAG SERVICOS ENTIDADE: 11249 REF: 998 112 334');
    assert.equal(meta.multibancoEntity, '11249');
    assert.equal(meta.multibancoRef, '998112334');
  });
});
