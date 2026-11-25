import crypto from 'node:crypto';
import {
  applyDefaultEmlGrpCode,
  evaluateDeliveryNoteChecks,
  filterEligibleDeliveries,
  getDeliveryEmailOptions,
  groupDeliveriesForInvoicing,
  renderEmailTemplate,
  type ConversionRecord,
  type ConvertDeliveriesResponse,
  type CustomerEmailOption,
  type DeliveryGroup,
  type GroupingMode,
  type OpenDeliveryNote,
  type RecipientSelection,
  type TriggerSource,
} from '@b1-d2i/shared';
import type { IB1ServiceLayerClient } from '../b1/serviceLayerClient.js';
import type { AppConfig } from '../config/env.js';
import type { ExtensionDatabase } from '../db/database.js';
import type { IEmailService } from '../email/emailService.js';
import type { IGatewayCrystalPdfClient } from '../pdf/gatewayCrystalPdfClient.js';
import { generateInvoicePdf, type InvoicePdfInput } from '../pdf/invoicePdf.js';

export interface RunConversionOptions {
  deliveryDocEntries: number[];
  groupingMode: GroupingMode;
  sendEmail: boolean;
  invoiceDate?: string;
  recipientOverrides?: Record<string, RecipientSelection>;
  triggerSource: TriggerSource;
  actor: string;
  cookieHeader?: string;
}

export class ConversionWorkflowService {
  constructor(
    private readonly db: ExtensionDatabase,
    private readonly b1Client: IB1ServiceLayerClient,
    private readonly emailService: IEmailService,
    private readonly config: AppConfig,
    private readonly gatewayPdfClient?: IGatewayCrystalPdfClient
  ) {}

  private async resolveInvoicePdfBuffer(
    invoiceDocEntry: number,
    fallbackInput: InvoicePdfInput
  ): Promise<Buffer> {
    const settings = this.db.getSettings();
    if (settings.pdfSource === 'gateway' && this.gatewayPdfClient) {
      try {
        return await this.gatewayPdfClient.exportInvoicePdf(
          {
            docEntry: invoiceDocEntry,
            objectId: 13,
            docCode: settings.invoiceDocCode,
          },
          settings
        );
      } catch (err) {
        if (!settings.gatewayFallbackToBuiltin) {
          throw err;
        }
        this.db.addAuditLog(
          'system',
          'GATEWAY_PDF_FALLBACK',
          `Crystal Reports Gateway falhou para Fatura DocEntry=${invoiceDocEntry} (${
            err instanceof Error ? err.message : 'erro desconhecido'
          }); a usar PDF built-in.`
        );
      }
    }
    return generateInvoicePdf(fallbackInput);
  }

  public async listOpenDeliveries(cookieHeader?: string): Promise<OpenDeliveryNote[]> {
    const deliveries = await this.b1Client.listOpenDeliveries(cookieHeader);
    const processed = this.db.getProcessedDeliveryEntries();
    const settings = this.db.getSettings();
    return deliveries.map((d) => ({
      ...d,
      availableEmails: applyDefaultEmlGrpCode(
        getDeliveryEmailOptions(d),
        settings.defaultEmlGrpCode
      ),
      validation: evaluateDeliveryNoteChecks(d, {
        checkPriceMatchLastInvoice: settings.checkPriceMatchLastInvoice,
        checkMinimumMargin: settings.checkMinimumMargin,
        minimumMarginPercent: settings.minimumMarginPercent,
      }),
      alreadyProcessed: processed.has(d.docEntry),
    }));
  }

  public async getCustomerEmails(
    cardCode: string,
    cookieHeader?: string
  ): Promise<CustomerEmailOption[]> {
    const emails = await this.b1Client.getCustomerEmails(cardCode, cookieHeader);
    const { defaultEmlGrpCode } = this.db.getSettings();
    return applyDefaultEmlGrpCode(emails, defaultEmlGrpCode);
  }

  public async convertDeliveries(opts: RunConversionOptions): Promise<ConvertDeliveriesResponse> {
    const runId = crypto.randomUUID();
    const invoiceDate = opts.invoiceDate || new Date().toISOString().slice(0, 10);
    const allOpen = await this.listOpenDeliveries(opts.cookieHeader);
    const requestedSet = new Set(opts.deliveryDocEntries);
    const { defaultEmlGrpCode } = this.db.getSettings();

    const eligible = allOpen.filter((d) => requestedSet.has(d.docEntry) && !d.alreadyProcessed);
    const groups = groupDeliveriesForInvoicing(
      eligible,
      opts.groupingMode,
      opts.recipientOverrides,
      defaultEmlGrpCode
    );

    const records: ConversionRecord[] = [];
    let invoicesCreated = 0;
    let emailsSent = 0;
    let failedCount = 0;

    for (const group of groups) {
      const record = await this.processGroup({
        runId,
        group,
        groupingMode: opts.groupingMode,
        sendEmail: opts.sendEmail,
        invoiceDate,
        triggerSource: opts.triggerSource,
        actor: opts.actor,
        cookieHeader: opts.cookieHeader,
      });
      records.push(record);
      if (record.invoiceDocEntry !== null) invoicesCreated++;
      if (record.status === 'INVOICED_AND_EMAILED') emailsSent++;
      if (record.status === 'FAILED' || record.status === 'INVOICED_EMAIL_FAILED') failedCount++;
    }

    this.db.addAuditLog(
      opts.actor,
      opts.triggerSource === 'SCHEDULED' ? 'SCHEDULED_CONVERSION_RUN' : 'MANUAL_CONVERSION_RUN',
      `Run ${runId.slice(0, 8)}: ${eligible.length} guias -> ${invoicesCreated} faturas, ${emailsSent} emails enviados, ${failedCount} falhas (${opts.groupingMode})`
    );

    return {
      runId,
      processedCount: eligible.length,
      invoicesCreated,
      emailsSent,
      failedCount,
      records,
    };
  }

  public async runScheduledBatch(actor = 'scheduler'): Promise<ConvertDeliveriesResponse> {
    const settings = this.db.getSettings();
    const allOpen = await this.listOpenDeliveries();
    const eligible = filterEligibleDeliveries(allOpen, {
      onlyAutoInvoiceCustomers: settings.onlyAutoInvoiceCustomers,
      minDeliveryAgeDays: settings.minDeliveryAgeDays,
    });

    const nowIso = new Date().toISOString();
    const nextIso = settings.schedulerEnabled
      ? new Date(Date.now() + settings.intervalMinutes * 60_000).toISOString()
      : null;
    this.db.updateSchedulerTimestamps(nowIso, nextIso);

    if (eligible.length === 0) {
      this.db.addAuditLog(actor, 'SCHEDULED_RUN_EMPTY', 'Nenhuma guia elegível encontrada.');
      return {
        runId: crypto.randomUUID(),
        processedCount: 0,
        invoicesCreated: 0,
        emailsSent: 0,
        failedCount: 0,
        records: [],
      };
    }

    return this.convertDeliveries({
      deliveryDocEntries: eligible.map((d) => d.docEntry),
      groupingMode: settings.groupingMode,
      sendEmail: settings.sendEmailAutomatically,
      triggerSource: 'SCHEDULED',
      actor,
    });
  }

  public async retryEmail(
    conversionId: string,
    overrideRecipient?: string,
    overrideRecipientName?: string,
    actor = 'user',
    cookieHeader?: string
  ): Promise<ConversionRecord> {
    const rec = this.db.getConversionById(conversionId);
    if (!rec) {
      throw new Error(`Registo de conversão não encontrado: ${conversionId}`);
    }
    if (rec.invoiceDocEntry === null || rec.invoiceDocNum === null) {
      throw new Error('Não existe fatura criada para reenviar email.');
    }

    const recipient = (overrideRecipient?.trim() || rec.recipientEmail || '').trim();
    if (!recipient || !recipient.includes('@')) {
      throw new Error('Indique um endereço de email de destino válido.');
    }

    let recipientName: string | null = null;
    if (overrideRecipientName !== undefined) {
      recipientName = overrideRecipientName.trim() || null;
    } else {
      const customerOptions = await this.b1Client.getCustomerEmails(rec.cardCode, cookieHeader);
      const matched = customerOptions.find(
        (o) => o.email.toLowerCase() === recipient.toLowerCase()
      );
      if (matched) {
        recipientName = matched.source === 'CONTACT' ? (matched.contactName?.trim() || null) : null;
      } else if (!overrideRecipient || overrideRecipient.trim().toLowerCase() === (rec.recipientEmail ?? '').toLowerCase()) {
        recipientName = rec.recipientName ?? null;
      }
    }

    const invoice = await this.b1Client.getInvoiceForEmail(rec.invoiceDocEntry, cookieHeader);
    const settings = this.db.getSettings();
    const vars = {
      InvoiceDocNum: String(rec.invoiceDocNum),
      InvoiceDate: rec.invoiceDate ?? '',
      CardCode: rec.cardCode,
      CardName: rec.cardName,
      ContactName: recipientName ?? '',
      DocTotal: rec.totalAmount.toFixed(2),
      Currency: rec.currency,
      DeliveryRefs: rec.deliveryDocNums.map((n) => `GR ${n}`).join(', '),
    };
    const subject = renderEmailTemplate(settings.emailSubjectTemplate, vars);
    const renderedBody = renderEmailTemplate(settings.emailBodyTemplate, vars);
    const htmlBody = settings.emailBodyIsHtml ? renderedBody : this.buildHtmlBody(renderedBody);
    const textBody = settings.emailBodyIsHtml ? this.stripHtmlToText(renderedBody) : renderedBody;
    const filename = `Fatura_${rec.invoiceDocNum}.pdf`;

    try {
      const pdfBuffer = await this.resolveInvoicePdfBuffer(rec.invoiceDocEntry, {
        companyName: this.config.COMPANY_NAME,
        companyNif: this.config.COMPANY_NIF,
        companyAddress: this.config.COMPANY_ADDRESS,
        invoiceDocNum: rec.invoiceDocNum,
        invoiceDate: rec.invoiceDate ?? new Date().toISOString().slice(0, 10),
        cardCode: rec.cardCode,
        cardName: rec.cardName,
        customerNif: invoice?.customerNif ?? '',
        deliveryDocNums: rec.deliveryDocNums,
        currency: rec.currency,
        lines: invoice?.lines ?? [],
        vatSum: invoice?.vatSum ?? 0,
        docTotal: rec.totalAmount,
      });

      await this.emailService.sendInvoiceEmail(
        {
          to: recipient,
          cc: settings.ccAddresses || undefined,
          replyTo: settings.replyToAddress || undefined,
          subject,
          textBody,
          htmlBody,
          attachmentFilename: filename,
          attachmentBuffer: pdfBuffer,
        },
        settings,
        this.db.getSmtpPassword()
      );

      const sentAt = new Date().toISOString();
      this.db.saveSentEmail({
        id: crypto.randomUUID(),
        conversionId: rec.id,
        to: recipient,
        recipientName: recipientName ?? undefined,
        cc: settings.ccAddresses || undefined,
        subject,
        htmlBody,
        attachmentFilename: filename,
        attachmentBytes: pdfBuffer.length,
        sentAt,
      });

      this.db.updateConversionEmailStatus(rec.id, {
        status: 'INVOICED_AND_EMAILED',
        recipientEmail: recipient,
        recipientName,
        emailSubject: subject,
        emailSentAt: sentAt,
        errorMessage: null,
      });

      this.db.addAuditLog(
        actor,
        'EMAIL_RETRY_SENT',
        `Fatura #${rec.invoiceDocNum} reenviada para ${recipient}${recipientName ? ` (${recipientName})` : ''}`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro desconhecido ao enviar email';
      this.db.updateConversionEmailStatus(rec.id, {
        status: 'INVOICED_EMAIL_FAILED',
        recipientEmail: recipient,
        recipientName,
        emailSubject: subject,
        errorMessage: msg,
      });
      this.db.addAuditLog(
        actor,
        'EMAIL_RETRY_FAILED',
        `Falha ao reenviar Fatura #${rec.invoiceDocNum} para ${recipient}: ${msg}`
      );
    }

    return this.db.getConversionById(rec.id)!;
  }

  private async processGroup(params: {
    runId: string;
    group: DeliveryGroup;
    groupingMode: GroupingMode;
    sendEmail: boolean;
    invoiceDate: string;
    triggerSource: TriggerSource;
    actor: string;
    cookieHeader?: string;
  }): Promise<ConversionRecord> {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const deliveryDocEntries = params.group.deliveries.map((d) => d.docEntry);
    const deliveryDocNums = params.group.deliveries.map((d) => d.docNum);

    // Step 1: Create A/R Invoice in SAP B1 Service Layer
    let createdInvoice;
    try {
      createdInvoice = await this.b1Client.createInvoiceFromDeliveries(
        {
          cardCode: params.group.cardCode,
          docDate: params.invoiceDate,
          deliveries: params.group.deliveries,
        },
        params.cookieHeader
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao criar fatura no SAP B1';
      const failedRec: ConversionRecord = {
        id,
        runId: params.runId,
        triggerSource: params.triggerSource,
        groupingMode: params.groupingMode,
        cardCode: params.group.cardCode,
        cardName: params.group.cardName,
        deliveryDocEntries,
        deliveryDocNums,
        invoiceDocEntry: null,
        invoiceDocNum: null,
        invoiceDate: null,
        currency: params.group.currency,
        totalAmount: params.group.totalAmount,
        recipientEmail: params.group.recipientEmail,
        recipientName: params.group.recipientName ?? null,
        emailSubject: null,
        emailSentAt: null,
        status: 'FAILED',
        errorMessage: msg,
        createdBy: params.actor,
        createdAt,
      };
      this.db.saveConversion(failedRec);
      return failedRec;
    }

    // Step 2: Determine email dispatch
    if (!params.sendEmail) {
      const rec: ConversionRecord = {
        id,
        runId: params.runId,
        triggerSource: params.triggerSource,
        groupingMode: params.groupingMode,
        cardCode: params.group.cardCode,
        cardName: params.group.cardName,
        deliveryDocEntries,
        deliveryDocNums,
        invoiceDocEntry: createdInvoice.docEntry,
        invoiceDocNum: createdInvoice.docNum,
        invoiceDate: createdInvoice.docDate,
        currency: createdInvoice.currency,
        totalAmount: createdInvoice.docTotal,
        recipientEmail: params.group.recipientEmail,
        recipientName: params.group.recipientName ?? null,
        emailSubject: null,
        emailSentAt: null,
        status: 'INVOICED_ONLY',
        errorMessage: null,
        createdBy: params.actor,
        createdAt,
      };
      this.db.saveConversion(rec);
      return rec;
    }

    if (!params.group.recipientEmail) {
      const rec: ConversionRecord = {
        id,
        runId: params.runId,
        triggerSource: params.triggerSource,
        groupingMode: params.groupingMode,
        cardCode: params.group.cardCode,
        cardName: params.group.cardName,
        deliveryDocEntries,
        deliveryDocNums,
        invoiceDocEntry: createdInvoice.docEntry,
        invoiceDocNum: createdInvoice.docNum,
        invoiceDate: createdInvoice.docDate,
        currency: createdInvoice.currency,
        totalAmount: createdInvoice.docTotal,
        recipientEmail: null,
        recipientName: null,
        emailSubject: null,
        emailSentAt: null,
        status: 'INVOICED_NO_EMAIL',
        errorMessage: 'Cliente sem endereço de email configurado no Parceiro de Negócios.',
        createdBy: params.actor,
        createdAt,
      };
      this.db.saveConversion(rec);
      return rec;
    }

    const settings = this.db.getSettings();
    const vars = {
      InvoiceDocNum: String(createdInvoice.docNum),
      InvoiceDate: createdInvoice.docDate,
      CardCode: params.group.cardCode,
      CardName: params.group.cardName,
      ContactName: params.group.recipientName ?? '',
      DocTotal: createdInvoice.docTotal.toFixed(2),
      Currency: createdInvoice.currency,
      DeliveryRefs: deliveryDocNums.map((n) => `GR ${n}`).join(', '),
    };
    const subject = renderEmailTemplate(settings.emailSubjectTemplate, vars);
    const renderedBody = renderEmailTemplate(settings.emailBodyTemplate, vars);
    const htmlBody = settings.emailBodyIsHtml ? renderedBody : this.buildHtmlBody(renderedBody);
    const textBody = settings.emailBodyIsHtml ? this.stripHtmlToText(renderedBody) : renderedBody;
    const filename = `Fatura_${createdInvoice.docNum}.pdf`;

    try {
      const pdfBuffer = await this.resolveInvoicePdfBuffer(createdInvoice.docEntry, {
        companyName: this.config.COMPANY_NAME,
        companyNif: this.config.COMPANY_NIF,
        companyAddress: this.config.COMPANY_ADDRESS,
        invoiceDocNum: createdInvoice.docNum,
        invoiceDate: createdInvoice.docDate,
        cardCode: params.group.cardCode,
        cardName: params.group.cardName,
        customerNif: params.group.deliveries[0]?.federalTaxId ?? '',
        deliveryDocNums,
        currency: createdInvoice.currency,
        lines: createdInvoice.lines,
        vatSum: createdInvoice.vatSum,
        docTotal: createdInvoice.docTotal,
      });

      await this.emailService.sendInvoiceEmail(
        {
          to: params.group.recipientEmail,
          cc: settings.ccAddresses || undefined,
          replyTo: settings.replyToAddress || undefined,
          subject,
          textBody,
          htmlBody,
          attachmentFilename: filename,
          attachmentBuffer: pdfBuffer,
        },
        settings,
        this.db.getSmtpPassword()
      );

      const sentAt = new Date().toISOString();
      const rec: ConversionRecord = {
        id,
        runId: params.runId,
        triggerSource: params.triggerSource,
        groupingMode: params.groupingMode,
        cardCode: params.group.cardCode,
        cardName: params.group.cardName,
        deliveryDocEntries,
        deliveryDocNums,
        invoiceDocEntry: createdInvoice.docEntry,
        invoiceDocNum: createdInvoice.docNum,
        invoiceDate: createdInvoice.docDate,
        currency: createdInvoice.currency,
        totalAmount: createdInvoice.docTotal,
        recipientEmail: params.group.recipientEmail,
        recipientName: params.group.recipientName ?? null,
        emailSubject: subject,
        emailSentAt: sentAt,
        status: 'INVOICED_AND_EMAILED',
        errorMessage: null,
        createdBy: params.actor,
        createdAt,
      };
      this.db.saveConversion(rec);
      this.db.saveSentEmail({
        id: crypto.randomUUID(),
        conversionId: id,
        to: params.group.recipientEmail,
        recipientName: params.group.recipientName ?? undefined,
        cc: settings.ccAddresses || undefined,
        subject,
        htmlBody,
        attachmentFilename: filename,
        attachmentBytes: pdfBuffer.length,
        sentAt,
      });
      return rec;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao enviar email';
      const rec: ConversionRecord = {
        id,
        runId: params.runId,
        triggerSource: params.triggerSource,
        groupingMode: params.groupingMode,
        cardCode: params.group.cardCode,
        cardName: params.group.cardName,
        deliveryDocEntries,
        deliveryDocNums,
        invoiceDocEntry: createdInvoice.docEntry,
        invoiceDocNum: createdInvoice.docNum,
        invoiceDate: createdInvoice.docDate,
        currency: createdInvoice.currency,
        totalAmount: createdInvoice.docTotal,
        recipientEmail: params.group.recipientEmail,
        recipientName: params.group.recipientName ?? null,
        emailSubject: subject,
        emailSentAt: null,
        status: 'INVOICED_EMAIL_FAILED',
        errorMessage: msg,
        createdBy: params.actor,
        createdAt,
      };
      this.db.saveConversion(rec);
      return rec;
    }
  }

  private buildHtmlBody(textBody: string): string {
    const escaped = textBody
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br/>');
    return `<div style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: #222; line-height: 1.5;">${escaped}</div>`;
  }

  private stripHtmlToText(htmlBody: string): string {
    return htmlBody
      .replace(/<\s*br\s*\/?>/gi, '\n')
      .replace(/<\/\s*(p|div|tr|li|h[1-6])\s*>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
}
