import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildInvoicePayload,
  joinNumAtCard,
  parseDeliveryExpenses,
  parseDeliveryHeaderCopy,
  type OpenDeliveryNote,
} from '@b1-d2i/shared';
import { buildApp } from '../src/app.js';
import { MockEmailService } from '../src/email/emailService.js';
import { MockServiceLayerClient } from '../src/b1/serviceLayerClient.js';

function delivery(over: Partial<OpenDeliveryNote> & { docEntry: number }): OpenDeliveryNote {
  return {
    docNum: over.docEntry + 1000,
    docDate: '2026-11-20',
    docDueDate: '2026-12-20',
    cardCode: 'C1',
    cardName: 'Cliente',
    federalTaxId: '',
    customerEmail: 'a@b.pt',
    autoInvoiceEnabled: true,
    docCurrency: 'EUR',
    docTotal: 100,
    vatSum: 23,
    lines: [
      {
        lineNum: 0, itemCode: 'I1', itemDescription: 'Item', quantity: 2, unitPrice: 10, discountPercent: 0,
        taxCode: 'IVA23', taxRate: 23, lineTotal: 20,
      },
    ],
    ...over,
  };
}

describe('Delivery -> invoice payload: freight, header values and NumAtCard', () => {
  it('copies NumAtCard, header values and freight linked to the delivery rows', () => {
    const d = delivery({
      docEntry: 7,
      numAtCard: 'ENC-8821',
      headerCopy: { SalesPersonCode: 4, PaymentGroupCode: 2, DiscountPercent: 5, ShipToCode: 'ARMAZEM' },
      additionalExpenses: [
        { lineNum: 0, expenseCode: 1, amount: 12.5, isForeignCurrency: false, taxCode: 'IVA23', remarks: 'Portes' },
      ],
    });
    const p = buildInvoicePayload({ cardCode: 'C1', docDate: '2026-11-25', deliveries: [d] });

    assert.equal(p.NumAtCard, 'ENC-8821');
    assert.equal(p.SalesPersonCode, 4);
    assert.equal(p.PaymentGroupCode, 2);
    assert.equal(p.DiscountPercent, 5);
    assert.equal(p.ShipToCode, 'ARMAZEM');
    assert.deepEqual(p.DocumentAdditionalExpenses, [
      {
        ExpenseCode: 1, LineTotal: 12.5, BaseDocType: 15, BaseDocEntry: 7, BaseDocLine: 0,
        Remarks: 'Portes', TaxCode: 'IVA23',
      },
    ]);
    assert.deepEqual((p.DocumentLines as unknown[])[0], { BaseType: 15, BaseEntry: 7, BaseLine: 0, Quantity: 2 });
  });

  it('consolidates: distinct NumAtCard joined, freight of every delivery kept, first header value wins', () => {
    const a = delivery({
      docEntry: 1, numAtCard: 'PO-1', headerCopy: { SalesPersonCode: 3 },
      additionalExpenses: [{ lineNum: 0, expenseCode: 1, amount: 5, isForeignCurrency: false }],
    });
    const b = delivery({
      docEntry: 2, numAtCard: 'PO-2', headerCopy: { SalesPersonCode: 9, PaymentGroupCode: 1 },
      additionalExpenses: [{ lineNum: 1, expenseCode: 2, amount: 7, isForeignCurrency: true }],
    });
    const c = delivery({ docEntry: 3, numAtCard: 'PO-1' }); // duplicate reference
    const p = buildInvoicePayload({ cardCode: 'C1', docDate: '2026-11-25', deliveries: [a, b, c] });

    assert.equal(p.NumAtCard, 'PO-1, PO-2');
    assert.equal(p.SalesPersonCode, 3);
    assert.equal(p.PaymentGroupCode, 1);
    const rows = p.DocumentAdditionalExpenses as Array<Record<string, unknown>>;
    assert.equal(rows.length, 2);
    assert.equal(rows[0].BaseDocEntry, 1);
    assert.equal(rows[1].BaseDocEntry, 2);
    assert.equal(rows[1].LineTotalFC, 7); // foreign-currency rows use LineTotalFC
    assert.equal('LineTotal' in rows[1], false);
  });

  it('omits NumAtCard and freight when the deliveries have none, and cuts NumAtCard to 100 chars', () => {
    const p = buildInvoicePayload({ cardCode: 'C1', docDate: '2026-11-25', deliveries: [delivery({ docEntry: 1 })] });
    assert.equal('NumAtCard' in p, false);
    assert.equal('DocumentAdditionalExpenses' in p, false);
    assert.equal(
      joinNumAtCard([{ numAtCard: 'A'.repeat(80) }, { numAtCard: 'B'.repeat(80) }]).length,
      100
    );
  });

  it('parses raw Service Layer rows: ignores "none" values and empty freight rows', () => {
    assert.deepEqual(
      parseDeliveryHeaderCopy({
        SalesPersonCode: -1, PaymentGroupCode: 3, DiscountPercent: 0, TransportationCode: null,
        ShipToCode: '', Address2: 'Rua X', ContactPersonCode: 12, Project: ' ', U_Obs: 'nota',
      }, ['U_Obs']),
      { PaymentGroupCode: 3, Address2: 'Rua X', ContactPersonCode: 12, U_Obs: 'nota' }
    );
    const rows = parseDeliveryExpenses({
      DocumentAdditionalExpenses: [
        { LineNum: 0, ExpenseCode: 1, LineTotal: 0, LineTotalFC: 0 },
        { LineNum: 1, ExpenseCode: 2, LineTotal: 9.9, Remarks: 'Portes', DistributionRule: 'CC1', DistributionRule2: null },
        { LineNum: 2, ExpenseCode: 3, LineTotal: 0, LineTotalFC: 4 },
      ],
    });
    assert.equal(rows.length, 2);
    assert.equal(rows[0].amount, 9.9);
    assert.deepEqual(rows[0].distributionRules, ['CC1', null, null, null, null]);
    assert.equal(rows[1].isForeignCurrency, true);
  });

  it('puts the delivery NumAtCard on the created invoice and exposes {{NumAtCard}} in the email', async () => {
    const { app, emailService, b1Client } = await buildApp({ dbPath: ':memory:' });
    const mock = emailService as MockEmailService;

    await app.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: {
        emailSubjectTemplate: 'Fatura {{InvoiceDocNum}} - Ref. {{NumAtCard}}',
        emailBodyTemplate: 'A sua referência: {{NumAtCard}}',
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/deliveries/convert',
      payload: { deliveryDocEntries: [501], groupingMode: 'PER_DELIVERY', sendEmail: true },
    });
    assert.equal(res.json().emailsSent, 1);

    assert.equal(mock.sentLog[0].subject.endsWith('Ref. ENC-8821'), true);
    assert.match(mock.sentLog[0].textBody, /A sua referência: ENC-8821/);
    assert.equal((b1Client as MockServiceLayerClient).invoicePayloads[0].NumAtCard, 'ENC-8821');
    await app.close();
  });
});
