import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../src/app.js';
import { MockHanaReadRepository } from '../src/b1/hanaReadRepository.js';
import { ReconciliationWorkflowService } from '../src/b1/reconciliationWorkflow.js';
import { MockServiceLayerClient } from '../src/b1/serviceLayerClient.js';
import { StatementIngestionService } from '../src/banks/ingestionService.js';
import { ReconciliationDatabase } from '../src/db/database.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const samplesDir = path.resolve(__dirname, '../../../samples');

describe('End-to-End Ingestion, HANA Matching Engine & Crash-Safe Service Layer Workflow', () => {
  it('imports MT940 & Norma 43 idempotently, generates ranked suggestions, and reconciles', async () => {
    const ctx = await buildApp({
      SQLITE_DB_PATH: ':memory:',
      B1_MODE: 'mock',
    });

    try {
      const mt940Buffer = fs.readFileSync(path.join(samplesDir, 'statement_2026_11.mt940'));
      const n43Buffer = fs.readFileSync(path.join(samplesDir, 'statement_2026_11.n43'));

      // First import
      const mt940Import = ctx.ingestion.importStatement(mt940Buffer, {
        fileName: 'statement_2026_11.mt940',
        b1User: 'treasury.pt',
      });
      assert.equal(mt940Import.importedLinesCount, 4);
      assert.equal(mt940Import.skippedDuplicateCount, 0);

      // Re-importing exact same MT940 statement skips all 4 lines (strict idempotency)
      const mt940Reimport = ctx.ingestion.importStatement(mt940Buffer, {
        fileName: 'statement_2026_11.mt940',
        b1User: 'treasury.pt',
      });
      assert.equal(mt940Reimport.importedLinesCount, 0);
      assert.equal(mt940Reimport.skippedDuplicateCount, 4);

      // Import Norma 43
      const n43Import = ctx.ingestion.importStatement(n43Buffer, {
        fileName: 'statement_2026_11.n43',
        b1User: 'treasury.pt',
      });
      assert.equal(n43Import.importedLinesCount, 3);

      // Fetch lines & suggestions via HTTP API
      const linesRes = await ctx.app.inject({
        method: 'GET',
        url: '/api/lines?statusGroup=PENDING',
      });
      assert.equal(linesRes.statusCode, 200);
      const { lines } = linesRes.json() as {
        lines: Array<{
          id: string;
          bankCode: string;
          amount: number;
          direction: string;
          suggestions: Array<{
            targetType: string;
            confidence: number;
            cardCode?: string;
            allocations?: Array<{ docEntry: number; allocatedAmount: number }>;
            journalLine?: { transId: number; lineId: number };
          }>;
        }>;
      };
      assert.equal(lines.length, 7);

      // Verify 98% Multibanco suggestion on 1,845.00 EUR line
      const mbLine = lines.find((l) => l.amount === 1845.0)!;
      assert.ok(mbLine);
      assert.equal(mbLine.suggestions[0].targetType, 'OPEN_AR_INVOICE');
      assert.equal(mbLine.suggestions[0].confidence, 98);

      // Verify Existing Journal Entry suggestion on -2,460.00 EUR line
      const jeLine = lines.find((l) => l.amount === 2460.0)!;
      assert.ok(jeLine);
      assert.equal(jeLine.suggestions[0].targetType, 'EXISTING_JOURNAL_ENTRY');
      assert.ok(jeLine.suggestions[0].confidence >= 95);

      // Verify Multi-Invoice Bundle suggestion on +3,690.00 EUR (1230 + 2460)
      const bundleLine = lines.find((l) => l.amount === 3690.0)!;
      assert.ok(bundleLine);
      assert.equal(bundleLine.suggestions[0].targetType, 'MULTI_INVOICE_BUNDLE');
      assert.equal(bundleLine.suggestions[0].allocations?.length, 2);
      assert.ok(bundleLine.suggestions[0].confidence >= 88);

      // Batch approve all high-confidence (>= 88%) matches via HTTP API
      const batchRes = await ctx.app.inject({
        method: 'POST',
        url: '/api/reconciliations/batch-approve',
        payload: { minConfidence: 88 },
      });
      assert.equal(batchRes.statusCode, 200);
      const batchBody = batchRes.json() as { reconciledCount: number; errors: unknown[] };
      assert.equal(batchBody.errors.length, 0);
      assert.equal(batchBody.reconciledCount, 6);

      // Check dashboard summary
      const dashRes = await ctx.app.inject({ method: 'GET', url: '/api/dashboard' });
      const dashBody = dashRes.json() as {
        summary: { reconciledCount: number; totalUnreconciled: number };
      };
      assert.equal(dashBody.summary.reconciledCount, 6);
      assert.equal(dashBody.summary.totalUnreconciled, 1);
    } finally {
      await ctx.app.close();
    }
  });

  it('recovers cleanly without duplicate payments if Service Layer fails mid-workflow', async () => {
    const repo = new ReconciliationDatabase(':memory:');
    const mockHana = new MockHanaReadRepository();
    const baseSl = new MockServiceLayerClient(mockHana);
    const ingestion = new StatementIngestionService(repo);

    const mt940Buffer = fs.readFileSync(path.join(samplesDir, 'statement_2026_11.mt940'));
    ingestion.importStatement(mt940Buffer, { fileName: 'statement.mt940', b1User: 'tester' });
    const targetLine = repo.listLines({ statusGroup: 'PENDING' }).find((l) => l.amount === 1845.0)!;

    let incomingPaymentCallCount = 0;
    let shouldFailReconcileOnce = true;

    const flakySlClient: MockServiceLayerClient = {
      resolveSessionUser: baseSl.resolveSessionUser.bind(baseSl),
      createVendorPayment: baseSl.createVendorPayment.bind(baseSl),
      createBankPage: baseSl.createBankPage.bind(baseSl),
      async createIncomingPayment(input) {
        incomingPaymentCallCount++;
        return baseSl.createIncomingPayment(input);
      },
      async reconcileExternalBankStatement(input) {
        if (shouldFailReconcileOnce) {
          shouldFailReconcileOnce = false;
          throw new Error('Simulated transient Service Layer timeout during Reconcile');
        }
        return baseSl.reconcileExternalBankStatement(input);
      },
    } as unknown as MockServiceLayerClient;

    const workflow = new ReconciliationWorkflowService(repo, flakySlClient);

    // Attempt 1: Payment + BankPage succeed, Reconcile fails
    await assert.rejects(() =>
      workflow.approveAndReconcile(
        {
          bankLineId: targetLine.id,
          targetType: 'OPEN_AR_INVOICE',
          invoiceSelection: {
            cardCode: 'C10010',
            allocations: [{ docType: 'AR_INVOICE', docEntry: 101, allocatedAmount: 1845.0 }],
          },
        },
        'tester'
      )
    );

    const afterFail = repo.getLineById(targetLine.id)!;
    assert.equal(afterFail.status, 'ERROR');
    assert.equal(incomingPaymentCallCount, 1);
    assert.ok(afterFail.b1PaymentDocEntry);
    assert.ok(afterFail.b1BankPageSequence);

    // Attempt 2 (Retry): Resumes from saved TransId & BankPageSequence WITHOUT creating a second IncomingPayment!
    const recovered = await workflow.approveAndReconcile(
      {
        bankLineId: targetLine.id,
        targetType: 'OPEN_AR_INVOICE',
        invoiceSelection: {
          cardCode: 'C10010',
          allocations: [{ docType: 'AR_INVOICE', docEntry: 101, allocatedAmount: 1845.0 }],
        },
      },
      'tester'
    );

    assert.equal(recovered.status, 'RECONCILED');
    assert.equal(incomingPaymentCallCount, 1);
  });

  it('filters manual candidates by document number, CardCode, CardName, and formatted EUR value', async () => {
    const ctx = await buildApp({
      SQLITE_DB_PATH: ':memory:',
      B1_MODE: 'mock',
    });

    try {
      // 1. Search by DocNum ("1042")
      const byNum = await ctx.app.inject({
        method: 'GET',
        url: '/api/b1/candidates?direction=CREDIT&glAccountCode=120101&search=1042',
      });
      assert.equal(byNum.json().openDocuments.length, 1);
      assert.equal(byNum.json().openDocuments[0].docNum, 1042);

      // 2. Search by CardCode ("c10088")
      const byCardCode = await ctx.app.inject({
        method: 'GET',
        url: '/api/b1/candidates?direction=CREDIT&glAccountCode=120102&search=c10088',
      });
      assert.equal(byCardCode.json().openDocuments.length, 2);

      // 3. Search by CardName without Portuguese accents ("metalurgica")
      const byCardName = await ctx.app.inject({
        method: 'GET',
        url: '/api/b1/candidates?direction=CREDIT&glAccountCode=120101&search=metalurgica',
      });
      assert.equal(byCardName.json().openDocuments.length, 1);
      assert.equal(byCardName.json().openDocuments[0].cardCode, 'C10040');

      // 4. Search by Portuguese formatted EUR value ("1.845,00")
      const byPtValue = await ctx.app.inject({
        method: 'GET',
        url: '/api/b1/candidates?direction=CREDIT&glAccountCode=120101&search=1.845,00',
      });
      assert.equal(byPtValue.json().openDocuments.length, 1);
      assert.equal(byPtValue.json().openDocuments[0].openAmount, 1845.0);

      // 5. Search unreconciled Journal Entries by value ("2460,00")
      const byJeRef = await ctx.app.inject({
        method: 'GET',
        url: '/api/b1/candidates?direction=DEBIT&glAccountCode=120101&search=2460,00',
      });
      assert.equal(byJeRef.json().journalLines.length, 1);
      assert.equal(byJeRef.json().journalLines[0].transId, 9001);
    } finally {
      await ctx.app.close();
    }
  });

  it('auto-suggests and reconciles Direct G/L Account rules (Bank Fees & Imposto do Selo), Credit Memo netting, and Reopen Ignored lines', async () => {
    const ctx = await buildApp({
      SQLITE_DB_PATH: ':memory:',
      B1_MODE: 'mock',
    });

    try {
      const mt940FeesAndCreditMemo = Buffer.from(
        `
:20:STMTFEES01
:25:PT50003506510008432190079
:60F:C261120EUR10000,00
:61:2611211121DE15,00NMSCFEES01//BNKFEE01
:86:COMISSAO MANUTENCAO CONTA DO NOVEMBRO
:61:2611211121DE0,60NMSCIS01//BNKIS01
:86:IMPOSTO DO SELO ART 17.3.4
:62F:C261121EUR9984,40
`,
        'utf8'
      );

      ctx.ingestion.importStatement(mt940FeesAndCreditMemo, {
        fileName: 'fees.mt940',
        b1User: 'treasury.pt',
      });

      const linesRes = await ctx.app.inject({
        method: 'GET',
        url: '/api/lines?statusGroup=PENDING',
      });
      const { lines } = linesRes.json() as {
        lines: Array<{
          id: string;
          amount: number;
          suggestions: Array<{
            targetType: string;
            confidence: number;
            glAccountMatch?: { glAccountCode: string; glAccountName: string };
          }>;
        }>;
      };
      assert.equal(lines.length, 2);

      // Verify 15.00 EUR Bank Fee matches G/L 622701 (Serviços Bancários)
      const feeLine = lines.find((l) => l.amount === 15.0)!;
      assert.equal(feeLine.suggestions[0].targetType, 'DIRECT_GL_ACCOUNT');
      assert.equal(feeLine.suggestions[0].glAccountMatch?.glAccountCode, '622701');
      assert.ok(feeLine.suggestions[0].confidence >= 92);

      // Verify 0.60 EUR Stamp Duty matches G/L 681201 (Imposto do Selo)
      const stampLine = lines.find((l) => l.amount === 0.6)!;
      assert.equal(stampLine.suggestions[0].targetType, 'DIRECT_GL_ACCOUNT');
      assert.equal(stampLine.suggestions[0].glAccountMatch?.glAccountCode, '681201');
      assert.ok(stampLine.suggestions[0].confidence >= 94);

      // Approve Direct G/L Account posting on the 15.00 EUR bank fee
      const approveFeeRes = await ctx.app.inject({
        method: 'POST',
        url: '/api/reconciliations/approve',
        payload: {
          bankLineId: feeLine.id,
          targetType: 'DIRECT_GL_ACCOUNT',
          glAccountSelection: {
            glAccountCode: '622701',
            glAccountName: 'Serviços Bancários',
          },
        },
      });
      assert.equal(approveFeeRes.statusCode, 200);
      assert.equal(approveFeeRes.json().line.status, 'RECONCILED');

      // Ignore and then Reopen the 0.60 EUR line
      const ignoreRes = await ctx.app.inject({
        method: 'POST',
        url: `/api/reconciliations/${stampLine.id}/ignore`,
        payload: { reason: 'Testing ignore' },
      });
      assert.equal(ignoreRes.statusCode, 200);
      assert.equal(ignoreRes.json().line.status, 'IGNORED');

      const reopenRes = await ctx.app.inject({
        method: 'POST',
        url: `/api/reconciliations/${stampLine.id}/reopen`,
      });
      assert.equal(reopenRes.statusCode, 200);
      assert.equal(reopenRes.json().line.status, 'SUGGESTED');

      // Verify Credit Memo netting in matching engine (Invoice 1000 - Credit Memo 150 = 850 EUR)
      const netSuggestions = ctx.matching.scoreSingleLine(
        {
          id: 'line-net-cm',
          statementId: 'stmt-1',
          houseBankId: 'hb-mt940-main',
          bankCode: '0035',
          glAccountCode: '120101',
          lineNumber: 9,
          bookingDate: '2026-11-22',
          valueDate: '2026-11-22',
          direction: 'CREDIT',
          amount: 850.0,
          signedAmount: 850.0,
          currency: 'EUR',
          isReversal: false,
          transactionCode: 'NTRF',
          bankReference: 'BNKNET',
          customerReference: '',
          description: 'TRF VINHOS DO DOURO SA NIF 507654323',
          extracted: {
            counterpartyNif: '507654323',
            invoiceCandidates: [],
          },
          fingerprint: 'fp-net-1',
          status: 'UNMATCHED',
          topConfidence: 0,
        },
        [],
        [
          {
            docType: 'AR_INVOICE',
            docEntry: 301,
            docNum: 2001,
            atDocNumber: 'FT 2026/2001',
            cardCode: 'C10099',
            cardName: 'Vinhos do Douro SA',
            nif: '507654323',
            bpIbans: [],
            docDate: '2026-11-01',
            dueDate: '2026-11-20',
            currency: 'EUR',
            docTotal: 1000.0,
            openAmount: 1000.0,
          },
          {
            docType: 'AR_CREDIT_MEMO',
            docEntry: 302,
            docNum: 55,
            atDocNumber: 'NC 2026/55',
            cardCode: 'C10099',
            cardName: 'Vinhos do Douro SA',
            nif: '507654323',
            bpIbans: [],
            docDate: '2026-11-05',
            dueDate: '2026-11-20',
            currency: 'EUR',
            docTotal: -150.0,
            openAmount: -150.0,
          },
        ],
        []
      );

      assert.ok(netSuggestions.length > 0);
      assert.equal(netSuggestions[0].targetType, 'MULTI_INVOICE_BUNDLE');
      assert.equal(netSuggestions[0].allocations?.length, 2);
      assert.ok(netSuggestions[0].reasons.some((r) => r.includes('Credit Memo')));
    } finally {
      await ctx.app.close();
    }
  });
});
