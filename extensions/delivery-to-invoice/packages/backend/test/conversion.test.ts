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
    // Delivery 501 uses Main email -> greeting uses Customer name without contact person
    assert.match(
      mockEmail.sentLog[0].textBody,
      /Exmo\.\(a\) Cliente Delta Comércio & Distribuição, Lda\.,/
    );
    // Delivery 503 has empty primary email -> falls back to contactEmail (Sofia Almeida) and puts contact name in email
    assert.equal(mockEmail.sentLog[1].to, 'contas.pagar@techlusitana.pt');
    assert.match(
      mockEmail.sentLog[1].textBody,
      /Exmo\.\(a\) Sofia Almeida \(TechLusitana Sistemas, S\.A\.\),/
    );
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

  it('allows selecting other customer master data emails (main vs contacts) and puts contact name in the email', async () => {
    const { app, emailService } = await buildApp({ dbPath: ':memory:' });
    const mockEmail = emailService as MockEmailService;

    // 1. Verify customer master data emails endpoint lists main + contacts with contactName
    const emailsRes = await app.inject({
      method: 'GET',
      url: '/api/customers/C20001/emails',
    });
    assert.equal(emailsRes.statusCode, 200);
    const { emails } = emailsRes.json();
    assert.equal(emails.length, 3);
    assert.equal(emails[0].source, 'MAIN');
    assert.equal(emails[0].email, 'faturacao@deltacomercio.pt');
    assert.equal(emails[1].source, 'CONTACT');
    assert.equal(emails[1].email, 'financeiro@deltacomercio.pt');
    assert.equal(emails[1].contactName, 'Ana Martins');
    assert.equal(emails[2].source, 'CONTACT');
    assert.equal(emails[2].email, 'logistica@deltacomercio.pt');
    assert.equal(emails[2].contactName, 'Carlos Ferreira');

    // 2. Convert delivery 501 selecting contact "Carlos Ferreira" instead of main email
    const convertRes = await app.inject({
      method: 'POST',
      url: '/api/deliveries/convert',
      payload: {
        deliveryDocEntries: [501],
        groupingMode: 'PER_DELIVERY',
        sendEmail: true,
        recipientOverrides: {
          '501': {
            email: 'logistica@deltacomercio.pt',
            contactName: 'Carlos Ferreira',
            source: 'CONTACT',
          },
        },
      },
    });
    assert.equal(convertRes.statusCode, 200);
    const body = convertRes.json();
    assert.equal(body.records[0].recipientEmail, 'logistica@deltacomercio.pt');
    assert.equal(body.records[0].recipientName, 'Carlos Ferreira');
    assert.equal(mockEmail.sentLog.length, 1);
    assert.equal(mockEmail.sentLog[0].to, 'logistica@deltacomercio.pt');
    assert.match(
      mockEmail.sentLog[0].textBody,
      /Exmo\.\(a\) Carlos Ferreira \(Delta Comércio & Distribuição, Lda\.\),/
    );

    // 3. Re-send / retry email selecting another contact ("Ana Martins") and verify contact name is used
    const conversionId = body.records[0].id;
    const retryContactRes = await app.inject({
      method: 'POST',
      url: `/api/conversions/${conversionId}/retry-email`,
      payload: {
        recipientEmail: 'financeiro@deltacomercio.pt',
      },
    });
    assert.equal(retryContactRes.statusCode, 200);
    assert.equal(retryContactRes.json().conversion.recipientEmail, 'financeiro@deltacomercio.pt');
    assert.equal(retryContactRes.json().conversion.recipientName, 'Ana Martins');
    assert.equal(mockEmail.sentLog.length, 2);
    assert.equal(mockEmail.sentLog[1].to, 'financeiro@deltacomercio.pt');
    assert.match(
      mockEmail.sentLog[1].textBody,
      /Exmo\.\(a\) Ana Martins \(Delta Comércio & Distribuição, Lda\.\),/
    );

    // 4. Re-send / retry email switching back to MAIN email -> uses Customer name without contact name
    const retryMainRes = await app.inject({
      method: 'POST',
      url: `/api/conversions/${conversionId}/retry-email`,
      payload: {
        recipientEmail: 'faturacao@deltacomercio.pt',
      },
    });
    assert.equal(retryMainRes.statusCode, 200);
    assert.equal(retryMainRes.json().conversion.recipientEmail, 'faturacao@deltacomercio.pt');
    assert.equal(retryMainRes.json().conversion.recipientName, null);
    assert.equal(mockEmail.sentLog.length, 3);
    assert.match(
      mockEmail.sentLog[2].textBody,
      /Exmo\.\(a\) Cliente Delta Comércio & Distribuição, Lda\.,/
    );

    await app.close();
  });

  it('uses defaultEmlGrpCode from settings as the default contact selection', async () => {
    const { app, emailService } = await buildApp({ dbPath: ':memory:' });
    const mockEmail = emailService as MockEmailService;

    // Update settings to use EmlGrpCode = 'FATURACAO' as default contact selection
    const settingsRes = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: {
        defaultEmlGrpCode: 'FATURACAO',
      },
    });
    assert.equal(settingsRes.statusCode, 200);
    assert.equal(settingsRes.json().settings.defaultEmlGrpCode, 'FATURACAO');

    // Verify customer C20001 email options now mark Ana Martins (emlGrpCode=FATURACAO) as isDefault=true
    const emailsRes = await app.inject({
      method: 'GET',
      url: '/api/customers/C20001/emails',
    });
    assert.equal(emailsRes.statusCode, 200);
    const { emails } = emailsRes.json();
    const defaultOpt = emails.find((e: { isDefault?: boolean }) => e.isDefault);
    assert.ok(defaultOpt);
    assert.equal(defaultOpt.email, 'financeiro@deltacomercio.pt');
    assert.equal(defaultOpt.contactName, 'Ana Martins');
    assert.equal(defaultOpt.emlGrpCode, 'FATURACAO');

    // Converting delivery 501 WITHOUT explicit recipientOverrides now defaults to the FATURACAO contact
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
    const body = convertRes.json();
    assert.equal(body.records[0].recipientEmail, 'financeiro@deltacomercio.pt');
    assert.equal(body.records[0].recipientName, 'Ana Martins');
    assert.equal(mockEmail.sentLog.length, 1);
    assert.equal(mockEmail.sentLog[0].to, 'financeiro@deltacomercio.pt');
    assert.match(
      mockEmail.sentLog[0].textBody,
      /Exmo\.\(a\) Ana Martins \(Delta Comércio & Distribuição, Lda\.\),/
    );

    await app.close();
  });

  it('supports HTML email body template with placeholders when emailBodyIsHtml is enabled', async () => {
    const { app, emailService } = await buildApp({ dbPath: ':memory:' });
    const mockEmail = emailService as MockEmailService;

    const htmlTemplate =
      '<div class="invoice-mail"><p>Exmo.(a) <strong>{{ContactName}}</strong> ({{CardName}}),</p><p>Segue a Fatura <b>#{{InvoiceDocNum}}</b> referente a {{DeliveryRefs}} no valor de <span>{{DocTotal}} {{Currency}}</span>.</p></div>';

    const settingsRes = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: {
        emailBodyIsHtml: true,
        emailBodyTemplate: htmlTemplate,
        defaultEmlGrpCode: 'FATURACAO',
      },
    });
    assert.equal(settingsRes.statusCode, 200);
    assert.equal(settingsRes.json().settings.emailBodyIsHtml, true);

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
    assert.equal(mockEmail.sentLog.length, 1);

    const sent = mockEmail.sentLog[0];
    // HTML body keeps raw HTML tags with placeholders replaced
    assert.match(
      sent.htmlBody,
      /<div class="invoice-mail"><p>Exmo\.\(a\) <strong>Ana Martins<\/strong> \(Delta Comércio & Distribuição, Lda\.\),<\/p>/
    );
    assert.match(sent.htmlBody, /<b>#20265001<\/b>/);
    assert.match(sent.htmlBody, /<span>1845\.00 EUR<\/span>/);
    // Plain-text fallback strips HTML tags cleanly
    assert.match(
      sent.textBody,
      /Exmo\.\(a\) Ana Martins \(Delta Comércio & Distribuição, Lda\.\),/
    );
    assert.ok(!sent.textBody.includes('<strong>'));

    await app.close();
  });

  it('validates delivery note item prices against last invoice and minimum item margin (averaging multiple rows of the same item)', async () => {
    const { app } = await buildApp({ dbPath: ':memory:' });

    const listRes = await app.inject({ method: 'GET', url: '/api/deliveries' });
    assert.equal(listRes.statusCode, 200);
    const { deliveries } = listRes.json();

    // Delivery 501: all prices match last invoice and markups are 53.85% and 66.67% (>= 30%)
    const d501 = deliveries.find((d: { docEntry: number }) => d.docEntry === 501);
    assert.equal(d501.validation.passed, true);
    assert.equal(d501.validation.hasPriceWarning, false);
    assert.equal(d501.validation.hasMarginWarning, false);
    assert.equal(d501.validation.lowestItemMarginPercent, 53.85);

    // Delivery 502: 2 rows of item A0088 (prices 320 and 280 -> media 300 vs lastInvoicedPrice 340;
    // markups 28% and 12% -> media 20.0% < 30%)
    const d502 = deliveries.find((d: { docEntry: number }) => d.docEntry === 502);
    assert.equal(d502.validation.passed, false);
    assert.equal(d502.validation.hasPriceWarning, true);
    assert.equal(d502.validation.hasMarginWarning, true);
    assert.equal(d502.validation.itemSummaries.length, 1);
    assert.equal(d502.validation.itemSummaries[0].itemCode, 'A0088');
    assert.equal(d502.validation.itemSummaries[0].rowCount, 2);
    assert.equal(d502.validation.itemSummaries[0].avgUnitPrice, 300);
    assert.equal(d502.validation.itemSummaries[0].lastInvoicedPrice, 340);
    assert.equal(d502.validation.itemSummaries[0].avgMarginPercent, 20);

    // Delivery 503: price 700 != lastInvoicedPrice 750, markup 53.85% >= 30%
    const d503 = deliveries.find((d: { docEntry: number }) => d.docEntry === 503);
    assert.equal(d503.validation.passed, false);
    assert.equal(d503.validation.hasPriceWarning, true);
    assert.equal(d503.validation.hasMarginWarning, false);

    // Delivery 504: price 50 == lastInvoicedPrice 50, markup 25% < 30%
    const d504 = deliveries.find((d: { docEntry: number }) => d.docEntry === 504);
    assert.equal(d504.validation.passed, false);
    assert.equal(d504.validation.hasPriceWarning, false);
    assert.equal(d504.validation.hasMarginWarning, true);

    // Update settings: disable price check and set minimumMarginPercent to 20%
    const settingsRes = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: {
        checkPriceMatchLastInvoice: false,
        checkMinimumMargin: true,
        minimumMarginPercent: 20,
      },
    });
    assert.equal(settingsRes.statusCode, 200);

    const listAfterRes = await app.inject({ method: 'GET', url: '/api/deliveries' });
    const afterDeliveries = listAfterRes.json().deliveries;
    const d502After = afterDeliveries.find((d: { docEntry: number }) => d.docEntry === 502);
    const d504After = afterDeliveries.find((d: { docEntry: number }) => d.docEntry === 504);
    assert.equal(d502After.validation.passed, true);
    assert.equal(d504After.validation.passed, true);

    await app.close();
  });
});
