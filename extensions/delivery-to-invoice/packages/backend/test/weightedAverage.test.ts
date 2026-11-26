import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateDeliveryNoteChecks, type OpenDeliveryNote } from '@b1-d2i/shared';

describe('Same item on several rows', () => {
  it('uses the quantity-weighted average price, cost and margin', () => {
    const line = (lineNum: number, quantity: number, discountPercent: number) => ({
      lineNum,
      itemCode: 'ECO2',
      itemDescription: 'eco v2',
      quantity,
      unitPrice: 26.57,
      discountPercent,
      taxCode: 'IVA23',
      taxRate: 23,
      lineTotal: 0,
      unitCost: 10,
    });
    const delivery = { lines: [line(0, 2, 0), line(1, 1, 100)] } as unknown as OpenDeliveryNote;
    const v = evaluateDeliveryNoteChecks(delivery);
    const s = v.itemSummaries[0];
    assert.equal(s.avgUnitPrice, 17.71); // (26.57 * 2) / 3
    assert.equal(s.avgUnitCost, 10);
    assert.equal(s.avgMarginPercent, 77.1);
  });

  it('treats different numeric prices as matching when both use the same price list source', () => {
    const baseLine = {
      lineNum: 0,
      itemCode: 'ITEM1',
      itemDescription: 'Item 1',
      quantity: 1,
      unitPrice: 110,
      discountPercent: 0,
      taxCode: 'IVA23',
      taxRate: 23,
      lineTotal: 110,
      unitCost: 50,
      lastInvoicedPrice: 100,
    };

    const sameList = evaluateDeliveryNoteChecks({
      lines: [
        {
          ...baseLine,
          priceSource: 'dpsActivePriceList',
          priceList: 1,
          lastInvoicedPriceSource: 'dpsActivePriceList',
          lastInvoicedPriceList: 1,
        },
      ],
    } as unknown as OpenDeliveryNote);
    assert.equal(sameList.hasPriceWarning, false);
    assert.equal(sameList.itemSummaries[0].priceMatchesLastInvoice, true);

    const diffList = evaluateDeliveryNoteChecks({
      lines: [
        {
          ...baseLine,
          priceSource: 'dpsActivePriceList',
          priceList: 2,
          lastInvoicedPriceSource: 'dpsActivePriceList',
          lastInvoicedPriceList: 1,
        },
      ],
    } as unknown as OpenDeliveryNote);
    assert.equal(diffList.hasPriceWarning, true);
    assert.equal(diffList.itemSummaries[0].priceMatchesLastInvoice, false);

    const manual = evaluateDeliveryNoteChecks({
      lines: [
        {
          ...baseLine,
          priceSource: 'dpsManual',
          priceList: 1,
          lastInvoicedPriceSource: 'dpsActivePriceList',
          lastInvoicedPriceList: 1,
        },
      ],
    } as unknown as OpenDeliveryNote);
    assert.equal(manual.hasPriceWarning, true);
    assert.equal(manual.itemSummaries[0].priceMatchesLastInvoice, false);
  });
});
