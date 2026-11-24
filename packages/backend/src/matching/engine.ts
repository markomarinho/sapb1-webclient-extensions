import type {
  B1OpenDocument,
  B1UnreconciledJournalLine,
  ConfidenceTier,
  GlMatchingRule,
  MatchSuggestion,
  StagedBankLine,
} from '@b1-recon/shared';
import type { IB1ReadRepository } from '../b1/hanaReadRepository.js';

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

/**
 * Bounded subset-sum solver (2..maxDocs documents for the same Business Partner)
 * operating in exact integer cents. Supports netting Invoices (+) against Credit Memos (-).
 */
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

  // Limit candidate pool per BP to oldest 15 open documents to keep search instantaneous
  const pool = eligible.slice(0, 15);

  function backtrack(
    startIdx: number,
    chosen: B1OpenDocument[],
    sumCents: number
  ): B1OpenDocument[] | null {
    if (sumCents === targetCents && chosen.length >= 2) {
      return chosen;
    }
    if (chosen.length >= maxDocs) {
      return null;
    }
    if (!hasCreditMemos && sumCents > targetCents) {
      return null;
    }

    for (let i = startIdx; i < pool.length; i++) {
      const doc = pool[i];
      const res = backtrack(i + 1, [...chosen, doc], sumCents + toCents(doc.openAmount));
      if (res) return res;
    }
    return null;
  }

  return backtrack(0, [], 0);
}

export class ReconciliationMatchingEngine {
  constructor(private readonly hanaRepo: IB1ReadRepository) {}

  async generateSuggestionsForLines(
    lines: StagedBankLine[],
    glRules: GlMatchingRule[] = []
  ): Promise<Map<string, MatchSuggestion[]>> {
    const result = new Map<string, MatchSuggestion[]>();
    if (lines.length === 0) return result;

    const distinctGlCodes = Array.from(new Set(lines.map((l) => l.glAccountCode)));
    const [openCreditDocs, openDebitDocs, ...jeLists] = await Promise.all([
      this.hanaRepo.getOpenDocuments('CREDIT'),
      this.hanaRepo.getOpenDocuments('DEBIT'),
      ...distinctGlCodes.map((gl) => this.hanaRepo.getUnreconciledJournalLines(gl)),
    ]);

    const jeByGl = new Map<string, B1UnreconciledJournalLine[]>();
    distinctGlCodes.forEach((gl, idx) => {
      jeByGl.set(gl, jeLists[idx]);
    });

    for (const line of lines) {
      if (line.status === 'RECONCILED' || line.status === 'IGNORED') {
        result.set(line.id, []);
        continue;
      }
      const openDocs = line.direction === 'CREDIT' ? openCreditDocs : openDebitDocs;
      const journalLines = jeByGl.get(line.glAccountCode) ?? [];
      const suggestions = this.scoreSingleLine(line, journalLines, openDocs, glRules);
      result.set(line.id, suggestions);
    }

    return result;
  }

  scoreSingleLine(
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

    // -------------------------------------------------------------------------
    // 1. Score Existing Unreconciled Journal Entries (JDT1 on House Bank G/L)
    // -------------------------------------------------------------------------
    for (const je of journalLines) {
      if (toCents(je.signedAmount) !== signedLineCents) continue;

      const dayDiff = daysBetween(line.bookingDate, je.refDate);
      if (dayDiff > 20) continue;

      let score = 76;
      const reasons: string[] = ['Exact Bank G/L Amount'];

      if (dayDiff <= 3) {
        score += 10;
        reasons.push(`Date ±${dayDiff}d`);
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
        reasons.push(`Payment Ref #${je.ref2 || je.sourceDocNum || je.ref1}`);
      }
      if (nameTokenOverlap(line.description, je.cardName)) {
        score += 6;
        reasons.push('BP Name Match');
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

    // -------------------------------------------------------------------------
    // 2. Score Single Open AR / AP Invoices (OINV / OPCH)
    // -------------------------------------------------------------------------
    for (const doc of openDocs) {
      if (doc.openAmount <= 0) continue; // Credit memos are netted via bundles or manual selection
      const docOpenCents = toCents(doc.openAmount);
      const exactAmount = docOpenCents === lineCents;

      const mbExact =
        Boolean(meta.multibancoRef && doc.multibancoRef && meta.multibancoRef === doc.multibancoRef) &&
        (!meta.multibancoEntity || !doc.multibancoEntity || meta.multibancoEntity === doc.multibancoEntity);

      const ibanMatch = Boolean(
        meta.counterpartyIban && doc.bpIbans.some((ib) => ib.toUpperCase() === meta.counterpartyIban)
      );
      const nifMatch = Boolean(meta.counterpartyNif && doc.nif && meta.counterpartyNif === doc.nif);

      const docNumMatched =
        meta.invoiceCandidates.includes(String(doc.docNum)) ||
        Boolean(doc.atDocNumber && upperDesc.includes(doc.atDocNumber.toUpperCase()));

      const bpNameMatched = nameTokenOverlap(line.description, doc.cardName);

      if (!exactAmount && !mbExact && !(docNumMatched && (ibanMatch || nifMatch))) {
        continue;
      }

      let score = 0;
      const reasons: string[] = [];

      if (mbExact && exactAmount) {
        score = 98;
        reasons.push(`Multibanco ${doc.multibancoEntity ?? ''}/${doc.multibancoRef}`, 'Exact Amount');
      } else if (exactAmount) {
        score = 52;
        reasons.push('Exact Open Amount');

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
          reasons.push('BP Name Match');
        }

        const dueDiff = daysBetween(line.bookingDate, doc.dueDate);
        if (dueDiff <= 7) {
          score += 6;
          reasons.push(`Due ±${dueDiff}d`);
        } else if (dueDiff <= 20) {
          score += 3;
        }
      } else if (docOpenCents > lineCents && (mbExact || (docNumMatched && (ibanMatch || nifMatch)))) {
        score = 78;
        reasons.push('Partial Payment on Identified Invoice');
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

    // -------------------------------------------------------------------------
    // 3. Score Multi-Invoice / Credit Memo Bundles (2..5 Open Documents per BP)
    // -------------------------------------------------------------------------
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
          ? `Exact Net Sum (${bundle.length} Docs incl. Credit Memo)`
          : `Exact Sum of ${bundle.length} Open Invoices`,
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
        reasons.push('BP Name Match');
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
          atDocNumber: b.atDocNumber,
          cardCode: b.cardCode,
          cardName: b.cardName,
          dueDate: b.dueDate,
          openAmount: b.openAmount,
          allocatedAmount: b.openAmount,
        })),
      });
    }

    // -------------------------------------------------------------------------
    // 4. Score Direct G/L Account Rules (Bank Fees, Stamp Duty, Interest)
    // -------------------------------------------------------------------------
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
}
