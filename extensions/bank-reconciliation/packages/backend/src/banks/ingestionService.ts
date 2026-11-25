import type {
  ParsedBankStatement,
  StatementFormat,
  StatementImportResponse,
  StatementPreviewResponse,
} from '@b1-recon/shared';
import type { ReconciliationDatabase } from '../db/database.js';
import { decodeStatementBuffer } from './metadataExtractor.js';
import { parseMt940 } from './parsers/mt940Parser.js';
import { parseNorma43 } from './parsers/norma43Parser.js';

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

export function parseBankStatementBuffer(
  buffer: Buffer,
  fileName?: string,
  explicitFormat?: StatementFormat
): ParsedBankStatement {
  const decoded = decodeStatementBuffer(buffer);
  const format = explicitFormat ?? detectStatementFormat(decoded, fileName);
  return format === 'MT940' ? parseMt940(decoded) : parseNorma43(decoded);
}

export class StatementIngestionService {
  constructor(private readonly repo: ReconciliationDatabase) {}

  previewStatement(
    buffer: Buffer,
    fileName?: string,
    explicitFormat?: StatementFormat
  ): StatementPreviewResponse {
    const statement = parseBankStatementBuffer(buffer, fileName, explicitFormat);
    const matchedHouseBank = this.repo.findHouseBankForStatement(statement);
    const existing = this.repo.countExistingFingerprints(statement.lines.map((l) => l.fingerprint));

    return {
      detectedFormat: statement.format,
      bankCode: matchedHouseBank?.bankCode ?? statement.bankCode,
      matchedHouseBank,
      statement,
      duplicateLinesCount: existing.size,
      newLinesCount: statement.lines.length - existing.size,
    };
  }

  importStatement(
    buffer: Buffer,
    opts: {
      fileName?: string;
      explicitFormat?: StatementFormat;
      houseBankId?: string;
      allowUnbalanced?: boolean;
      b1User: string;
    }
  ): StatementImportResponse {
    const statement = parseBankStatementBuffer(buffer, opts.fileName, opts.explicitFormat);

    if (!statement.balanceVerified && !opts.allowUnbalanced) {
      throw new Error(
        `Statement balance integrity check failed (Opening: ${statement.openingBalance.toFixed(2)}, Calculated Closing: ${statement.calculatedClosingBalance.toFixed(2)}, Declared Closing: ${statement.closingBalance.toFixed(2)}).`
      );
    }

    const houseBanks = this.repo.listHouseBanks();
    const houseBank =
      (opts.houseBankId ? houseBanks.find((hb) => hb.id === opts.houseBankId) : undefined) ??
      this.repo.findHouseBankForStatement(statement);

    if (!houseBank) {
      throw new Error(`No SAP B1 House Bank configured for statement account ${statement.accountIdentifier}.`);
    }

    const { statementDbId, importedIds, skippedDuplicates } = this.repo.importStatement(
      statement,
      houseBank,
      opts.b1User
    );

    return {
      statementId: statementDbId,
      houseBankId: houseBank.id,
      importedLinesCount: importedIds.length,
      skippedDuplicateCount: skippedDuplicates,
      autoSuggestedCount: 0,
    };
  }
}
