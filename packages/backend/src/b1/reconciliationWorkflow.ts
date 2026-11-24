import type { ApproveReconciliationRequest, B1DocumentType, StagedBankLine } from '@b1-recon/shared';
import type { ReconciliationDatabase } from '../db/database.js';
import type {
  B1ServiceLayerInvoiceType,
  IB1ServiceLayerClient,
} from './serviceLayerClient.js';

function mapDocTypeToServiceLayer(docType: B1DocumentType): B1ServiceLayerInvoiceType {
  switch (docType) {
    case 'AR_INVOICE':
      return 'it_Invoice';
    case 'AR_CREDIT_MEMO':
      return 'it_CredItnote';
    case 'AP_INVOICE':
      return 'it_PurchaseInvoice';
    case 'AP_CREDIT_MEMO':
      return 'it_PurchaseCreditNote';
  }
}

/**
 * Crash-safe, idempotent state machine that executes SAP Business One Service Layer
 * postings in up to 3 resumable steps:
 *   Step 1 (Optional): Create IncomingPayment, VendorPayment, or Direct G/L Account Payment (rAccount)
 *   Step 2: Create external BankPage on the House Bank G/L account
 *   Step 3: Execute ExternalReconciliationsService_Reconcile linking BankPage <-> JournalEntry
 */
export class ReconciliationWorkflowService {
  constructor(
    private readonly repo: ReconciliationDatabase,
    private readonly slClient: IB1ServiceLayerClient
  ) {}

  async approveAndReconcile(
    request: ApproveReconciliationRequest,
    b1User: string,
    cookieHeader?: string
  ): Promise<StagedBankLine> {
    let line = this.repo.getLineById(request.bankLineId);
    if (!line) {
      throw new Error(`Bank statement line "${request.bankLineId}" not found.`);
    }
    if (line.status === 'RECONCILED') {
      return line;
    }

    try {
      // -----------------------------------------------------------------------
      // STEP 1: Resolve or Create Payment / Journal Entry in SAP B1
      // -----------------------------------------------------------------------
      let transId = line.b1TransId;
      let transLineId = line.b1TransLineId ?? 0;
      let paymentDocEntry = line.b1PaymentDocEntry;

      if (transId == null) {
        const ref = line.bankReference || line.customerReference || line.id.slice(-12);
        const remarks = `[B1-Recon ${line.bankCode}] ${line.description}`.slice(0, 240);

        if (request.targetType === 'EXISTING_JOURNAL_ENTRY') {
          if (!request.journalSelection) {
            throw new Error('journalSelection is required for EXISTING_JOURNAL_ENTRY.');
          }
          transId = request.journalSelection.transId;
          transLineId = request.journalSelection.lineId;
        } else if (request.targetType === 'DIRECT_GL_ACCOUNT') {
          if (!request.glAccountSelection?.glAccountCode) {
            throw new Error('glAccountSelection.glAccountCode is required for DIRECT_GL_ACCOUNT.');
          }

          const created = await this.slClient.createDirectGlAccountPayment(
            {
              direction: line.direction,
              docDate: line.bookingDate,
              transferAccount: line.glAccountCode,
              transferSum: line.amount,
              transferDate: line.valueDate,
              transferReference: ref,
              expenseOrRevenueGlAccount: request.glAccountSelection.glAccountCode,
              remarks,
            },
            cookieHeader
          );
          paymentDocEntry = created.docEntry;
          transId = created.transId;
          transLineId = created.transLineId;

          this.repo.updateLineProgress(line.id, {
            status: 'PAYMENT_CREATED',
            b1PaymentDocEntry: paymentDocEntry,
            b1TransId: transId,
            b1TransLineId: transLineId,
            errorMessage: null,
          });
        } else {
          if (!request.invoiceSelection || request.invoiceSelection.allocations.length === 0) {
            throw new Error('invoiceSelection with at least one document allocation is required.');
          }

          const allocSum = request.invoiceSelection.allocations.reduce((sum, a) => {
            const isCreditMemo = a.docType === 'AR_CREDIT_MEMO' || a.docType === 'AP_CREDIT_MEMO';
            const signedAlloc = isCreditMemo ? -Math.abs(a.allocatedAmount) : Math.abs(a.allocatedAmount);
            return sum + signedAlloc;
          }, 0);

          const onAccount = request.invoiceSelection.paymentOnAccountAmount ?? 0;
          if (Math.abs(allocSum + onAccount - line.amount) > 0.01) {
            throw new Error(
              `Allocated invoice total (${(allocSum + onAccount).toFixed(2)} EUR) must match bank line amount (${line.amount.toFixed(2)} EUR).`
            );
          }

          const invoicesPayload = request.invoiceSelection.allocations.map((a) => ({
            docEntry: a.docEntry,
            sumApplied: Math.abs(a.allocatedAmount),
            invoiceType: mapDocTypeToServiceLayer(a.docType),
          }));

          if (line.direction === 'CREDIT') {
            const created = await this.slClient.createIncomingPayment(
              {
                cardCode: request.invoiceSelection.cardCode,
                docDate: line.bookingDate,
                transferAccount: line.glAccountCode,
                transferSum: line.amount,
                transferDate: line.valueDate,
                transferReference: ref,
                remarks,
                invoices: invoicesPayload,
              },
              cookieHeader
            );
            paymentDocEntry = created.docEntry;
            transId = created.transId;
            transLineId = created.transLineId;
          } else {
            const created = await this.slClient.createVendorPayment(
              {
                cardCode: request.invoiceSelection.cardCode,
                docDate: line.bookingDate,
                transferAccount: line.glAccountCode,
                transferSum: line.amount,
                transferDate: line.valueDate,
                transferReference: ref,
                remarks,
                invoices: invoicesPayload,
              },
              cookieHeader
            );
            paymentDocEntry = created.docEntry;
            transId = created.transId;
            transLineId = created.transLineId;
          }

          this.repo.updateLineProgress(line.id, {
            status: 'PAYMENT_CREATED',
            b1PaymentDocEntry: paymentDocEntry,
            b1TransId: transId,
            b1TransLineId: transLineId,
            errorMessage: null,
          });
        }
      }

      // -----------------------------------------------------------------------
      // STEP 2: Create External Bank Statement Page (BankPages) if not created
      // -----------------------------------------------------------------------
      line = this.repo.getLineById(line.id)!;
      let bankPageSeq = line.b1BankPageSequence;

      if (bankPageSeq == null) {
        const bpResult = await this.slClient.createBankPage(
          {
            accountCode: line.glAccountCode,
            dueDate: line.valueDate,
            debitAmount: line.direction === 'DEBIT' ? line.amount : 0,
            creditAmount: line.direction === 'CREDIT' ? line.amount : 0,
            paymentReference: line.bankReference || line.customerReference || line.transactionCode,
            details: line.description,
          },
          cookieHeader
        );
        bankPageSeq = bpResult.sequence;

        this.repo.updateLineProgress(line.id, {
          status: 'BANKPAGE_CREATED',
          b1TransId: transId,
          b1TransLineId: transLineId,
          b1BankPageSequence: bankPageSeq,
          errorMessage: null,
        });
      }

      // -----------------------------------------------------------------------
      // STEP 3: Reconcile BankPage <-> Journal Entry Line in SAP B1
      // -----------------------------------------------------------------------
      await this.slClient.reconcileExternalBankStatement(
        {
          glAccountCode: line.glAccountCode,
          bankPageSequence: bankPageSeq,
          journalTransId: transId!,
          journalLineId: transLineId,
        },
        cookieHeader
      );

      const now = new Date().toISOString();
      this.repo.updateLineProgress(line.id, {
        status: 'RECONCILED',
        b1PaymentDocEntry: paymentDocEntry,
        b1TransId: transId,
        b1TransLineId: transLineId,
        b1BankPageSequence: bankPageSeq,
        errorMessage: null,
        reconciledAt: now,
        reconciledBy: b1User,
      });

      this.repo.recordAudit(b1User, 'LINE_RECONCILED', {
        bankLineId: line.id,
        statementId: line.statementId,
        details: {
          targetType: request.targetType,
          amount: line.amount,
          direction: line.direction,
          glAccountCode: line.glAccountCode,
          b1PaymentDocEntry: paymentDocEntry,
          b1TransId: transId,
          b1BankPageSequence: bankPageSeq,
        },
      });

      return this.repo.getLineById(line.id)!;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.repo.updateLineProgress(request.bankLineId, {
        status: 'ERROR',
        errorMessage: msg,
      });
      this.repo.recordAudit(b1User, 'RECONCILIATION_ERROR', {
        bankLineId: request.bankLineId,
        details: { error: msg },
      });
      throw err;
    }
  }

  markLineIgnored(bankLineId: string, b1User: string, reason?: string): StagedBankLine {
    const line = this.repo.getLineById(bankLineId);
    if (!line) throw new Error(`Bank statement line "${bankLineId}" not found.`);
    if (line.status === 'RECONCILED') {
      throw new Error('Cannot ignore an already reconciled statement line.');
    }

    this.repo.updateLineProgress(bankLineId, {
      status: 'IGNORED',
      errorMessage: null,
    });
    this.repo.recordAudit(b1User, 'LINE_IGNORED', {
      bankLineId,
      statementId: line.statementId,
      details: { reason: reason || 'Manually excluded from reconciliation' },
    });
    return this.repo.getLineById(bankLineId)!;
  }

  reopenLine(bankLineId: string, b1User: string): StagedBankLine {
    return this.repo.reopenLine(bankLineId, b1User);
  }
}
