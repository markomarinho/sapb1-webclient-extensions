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
});
