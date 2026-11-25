import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it } from 'node:test';
import { buildApp } from '../src/app.js';
import { MockEmailService } from '../src/email/emailService.js';
import { decodeGatewayPdfPayload } from '../src/pdf/gatewayCrystalPdfClient.js';
import { generateInvoicePdf } from '../src/pdf/invoicePdf.js';

describe('Delivery-to-Invoice Conversion & Email Workflow', () => {
  it('converts individual deliveries into invoices and sends PDF emails', async () => {
    const { app, emailService } = await buildApp({ dbPath: ':memory:' });
    const mockEmail = emailService as MockEmailService;

    const listRes = await app.inject({ method: 'GET', url: '/api/deliveries' });
    assert.equal(listRes.statusCode, 200);
    const { deliveries } = listRes.json();
    assert.equal(deliveries.length, 5);

    const convertRes = await app.inject({
      method: 'POST',
      url: '/api/deliveries/convert',
      payload: {
        deliveryDocEntries: [501, 503],
        groupingMode: 'PER_DELIVERY',
        sendEmail: true,
      },
    });

    assert.equal(convertRes.statusCode, 200);
    const body = convertRes.json();
    assert.equal(body.invoicesCreated, 2);
    assert.equal(body.emailsSent, 2);
    assert.equal(body.failedCount, 0);
    assert.equal(mockEmail.sentLog.length, 2);
    assert.equal(mockEmail.sentLog[0].to, 'faturacao@deltacomercio.pt');
    // Delivery 503 has empty primary email -> falls back to contactEmail
    assert.equal(mockEmail.sentLog[1].to, 'contas.pagar@techlusitana.pt');
    assert.ok(mockEmail.sentLog[0].attachmentBuffer.toString('utf8').startsWith('%PDF-1.4'));

    // Re-running with the same deliveries must be idempotent (0 new invoices)
    const secondRes = await app.inject({
      method: 'POST',
      url: '/api/deliveries/convert',
      payload: {
        deliveryDocEntries: [501, 503],
        groupingMode: 'PER_DELIVERY',
        sendEmail: true,
      },
    });
    assert.equal(secondRes.json().invoicesCreated, 0);

    await app.close();
  });

  it('consolidates multiple open deliveries for the same customer into one invoice', async () => {
    const { app, emailService } = await buildApp({ dbPath: ':memory:' });
    const mockEmail = emailService as MockEmailService;

    const res = await app.inject({
      method: 'POST',
      url: '/api/deliveries/convert',
      payload: {
        deliveryDocEntries: [501, 502], // Both belong to C20001 (Delta Comércio)
        groupingMode: 'CONSOLIDATED_BY_CUSTOMER',
        sendEmail: true,
      },
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.processedCount, 2);
    assert.equal(body.invoicesCreated, 1);
    assert.equal(body.emailsSent, 1);
    assert.equal(body.records[0].deliveryDocEntries.length, 2);
    assert.equal(body.records[0].totalAmount, 2583);
    assert.equal(mockEmail.sentLog.length, 1);
    assert.match(mockEmail.sentLog[0].textBody, /GR 20260101, GR 20260102/);

    await app.close();
  });

  it('handles SMTP failures safely and retries email without creating a duplicate invoice', async () => {
    const mockEmail = new MockEmailService();
    mockEmail.failNextSend = true;

    const { app } = await buildApp({ dbPath: ':memory:', emailService: mockEmail });

    const convertRes = await app.inject({
      method: 'POST',
      url: '/api/deliveries/convert',
      payload: {
        deliveryDocEntries: [501],
        groupingMode: 'PER_DELIVERY',
        sendEmail: true,
      },
    });

    const first = convertRes.json();
    assert.equal(first.invoicesCreated, 1);
    assert.equal(first.emailsSent, 0);
    assert.equal(first.failedCount, 1);
    assert.equal(first.records[0].status, 'INVOICED_EMAIL_FAILED');
    const conversionId = first.records[0].id;
    const originalInvoiceDocNum = first.records[0].invoiceDocNum;

    // Retry email only
    const retryRes = await app.inject({
      method: 'POST',
      url: `/api/conversions/${conversionId}/retry-email`,
      payload: { recipientEmail: 'novo@deltacomercio.pt' },
    });
    assert.equal(retryRes.statusCode, 200);
    const updated = retryRes.json().conversion;
    assert.equal(updated.status, 'INVOICED_AND_EMAILED');
    assert.equal(updated.invoiceDocNum, originalInvoiceDocNum);
    assert.equal(updated.recipientEmail, 'novo@deltacomercio.pt');
    assert.equal(mockEmail.sentLog.length, 1);

    await app.close();
  });

  it('runs scheduled batch respecting U_AutoInvoice flag and handles customers without email', async () => {
    const { app } = await buildApp({ dbPath: ':memory:' });

    // Trigger scheduled batch (default: onlyAutoInvoiceCustomers=true, grouping=PER_DELIVERY)
    // Eligible deliveries: 501, 502, 503, 505 (504 has autoInvoiceEnabled=false)
    const runRes = await app.inject({ method: 'POST', url: '/api/scheduler/run-now' });
    assert.equal(runRes.statusCode, 200);
    const body = runRes.json();
    assert.equal(body.processedCount, 4);
    assert.equal(body.invoicesCreated, 4);
    assert.equal(body.emailsSent, 3); // 505 has no email -> INVOICED_NO_EMAIL

    const noEmailRec = body.records.find((r: { cardCode: string }) => r.cardCode === 'C20039');
    assert.equal(noEmailRec.status, 'INVOICED_NO_EMAIL');

    // Delivery 504 should still remain open
    const openRes = await app.inject({ method: 'GET', url: '/api/deliveries' });
    assert.equal(openRes.json().deliveries.length, 1);
    assert.equal(openRes.json().deliveries[0].docEntry, 504);

    await app.close();
  });

  it('generates a valid PDF 1.4 invoice document', () => {
    const pdf = generateInvoicePdf({
      companyName: 'Empresa Teste, Lda.',
      companyNif: 'PT500000000',
      companyAddress: 'Lisboa',
      invoiceDocNum: 20265001,
      invoiceDate: '2026-11-25',
      cardCode: 'C100',
      cardName: 'Cliente Exemplo',
      customerNif: 'PT501111111',
      deliveryDocNums: [20260101],
      currency: 'EUR',
      vatSum: 23,
      docTotal: 123,
      lines: [
        {
          lineNum: 0,
          itemCode: 'ITEM1',
          itemDescription: 'Artigo de Teste',
          quantity: 1,
          unitPrice: 100,
          discountPercent: 0,
          taxCode: 'IVA23',
          taxRate: 23,
          lineTotal: 100,
        },
      ],
    });
    const text = pdf.toString('utf8');
    assert.ok(text.startsWith('%PDF-1.4'));
    assert.ok(text.includes('FATURA #20265001'));
    assert.ok(text.trim().endsWith('%%EOF'));
  });

  it('exports Crystal Reports PDF via SAP B1 API Gateway (/login + /rs/v1/ExportPDFData)', async () => {
    const fakeCrystalPdf = Buffer.from('%PDF-1.4\n% Crystal Reports Layout INV20004\n%%EOF\n', 'utf8');
    const capturedRequests: Array<{ url: string; cookie?: string; body: string }> = [];

    const gatewayServer = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(Buffer.from(c)));
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (req.url === '/login' && req.method === 'POST') {
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Set-Cookie': ['SESSION=gw-test-session-123; Path=/; HttpOnly'],
          });
          res.end(JSON.stringify({ ok: true }));
          return;
        }
        if (req.url?.startsWith('/rs/v1/ExportPDFData') && req.method === 'POST') {
          capturedRequests.push({
            url: req.url,
            cookie: req.headers.cookie,
            body,
          });
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          // SAP B1 API Gateway returns base64-encoded PDF
          res.end(fakeCrystalPdf.toString('base64'));
          return;
        }
        res.writeHead(404);
        res.end('Not found');
      });
    });

    await new Promise<void>((resolve) => gatewayServer.listen(0, '127.0.0.1', () => resolve()));
    const { port } = gatewayServer.address() as AddressInfo;
    const gatewayUrl = `http://127.0.0.1:${port}`;

    try {
      const { app, emailService } = await buildApp({
        dbPath: ':memory:',
        configOverrides: {
          PDF_SOURCE: 'gateway',
          B1_GATEWAY_URL: gatewayUrl,
          B1_INVOICE_DOC_CODE: 'INV20004',
          B1_TECH_USER: 'manager',
          B1_TECH_PASSWORD: 'secret',
        },
      });
      const mockEmail = emailService as MockEmailService;

      const convertRes = await app.inject({
        method: 'POST',
        url: '/api/deliveries/convert',
        payload: {
          deliveryDocEntries: [501],
          groupingMode: 'PER_DELIVERY',
          sendEmail: true,
        },
      });

      assert.equal(convertRes.statusCode, 200);
      const result = convertRes.json();
      assert.equal(result.invoicesCreated, 1);
      assert.equal(result.emailsSent, 1);
      assert.equal(capturedRequests.length, 1);
      assert.equal(capturedRequests[0].url, '/rs/v1/ExportPDFData?DocCode=INV20004');
      assert.equal(capturedRequests[0].cookie, 'SESSION=gw-test-session-123');

      const params = JSON.parse(capturedRequests[0].body) as Array<{
        name: string;
        value: number[][];
      }>;
      assert.equal(params[0].name, 'DocKey@');
      assert.equal(params[0].value[0][0], result.records[0].invoiceDocEntry);
      assert.equal(params[1].name, 'ObjectId@');
      assert.equal(params[1].value[0][0], 13);

      // Email attachment must be the exact Crystal Reports PDF bytes from the Gateway
      assert.equal(
        mockEmail.sentLog[0].attachmentBuffer.toString('utf8'),
        fakeCrystalPdf.toString('utf8')
      );

      // Also verify JSON-quoted base64 decoding helper
      const quoted = Buffer.from(JSON.stringify(fakeCrystalPdf.toString('base64')), 'utf8');
      assert.equal(decodeGatewayPdfPayload(quoted).toString('utf8'), fakeCrystalPdf.toString('utf8'));

      await app.close();
    } finally {
      await new Promise<void>((resolve) => gatewayServer.close(() => resolve()));
    }
  });
});
