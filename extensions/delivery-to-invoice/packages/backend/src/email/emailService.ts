import nodemailer from 'nodemailer';
import type { AutomationSettings } from '@b1-d2i/shared';

export interface SendInvoiceEmailInput {
  to: string;
  cc?: string;
  replyTo?: string;
  subject: string;
  textBody: string;
  htmlBody: string;
  attachmentFilename: string;
  attachmentBuffer: Buffer;
}

export interface SendEmailResult {
  messageId: string;
  accepted: string[];
}

export interface IEmailService {
  sendInvoiceEmail(
    input: SendInvoiceEmailInput,
    settings: AutomationSettings,
    smtpPassword: string
  ): Promise<SendEmailResult>;
  verifyConnection(settings: AutomationSettings, smtpPassword: string): Promise<{ ok: boolean; message: string }>;
}

export class MockEmailService implements IEmailService {
  public failNextSend = false;
  public readonly sentLog: SendInvoiceEmailInput[] = [];

  async sendInvoiceEmail(input: SendInvoiceEmailInput): Promise<SendEmailResult> {
    if (this.failNextSend) {
      this.failNextSend = false;
      throw new Error('Simulated SMTP transient failure (connection reset by peer)');
    }
    this.sentLog.push(input);
    return {
      messageId: `<mock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@b1-d2i.local>`,
      accepted: [input.to],
    };
  }

  async verifyConnection(): Promise<{ ok: boolean; message: string }> {
    return { ok: true, message: 'Modo Mock ativo — emails são registados localmente sem envio SMTP externo.' };
  }
}

export class SmtpEmailService implements IEmailService {
  private createTransport(settings: AutomationSettings, smtpPassword: string) {
    if (!settings.smtpHost) {
      throw new Error('SMTP host não configurado nas definições.');
    }
    return nodemailer.createTransport({
      host: settings.smtpHost,
      port: settings.smtpPort || 587,
      secure: settings.smtpSecure,
      auth: settings.smtpUser
        ? {
            user: settings.smtpUser,
            pass: smtpPassword,
          }
        : undefined,
    });
  }

  async sendInvoiceEmail(
    input: SendInvoiceEmailInput,
    settings: AutomationSettings,
    smtpPassword: string
  ): Promise<SendEmailResult> {
    const transport = this.createTransport(settings, smtpPassword);
    const info = await transport.sendMail({
      from: settings.smtpFrom || settings.smtpUser || 'no-reply@sapb1.local',
      to: input.to,
      cc: input.cc || undefined,
      replyTo: input.replyTo || undefined,
      subject: input.subject,
      text: input.textBody,
      html: input.htmlBody,
      attachments: [
        {
          filename: input.attachmentFilename,
          content: input.attachmentBuffer,
          contentType: 'application/pdf',
        },
      ],
    });
    return {
      messageId: String(info.messageId ?? ''),
      accepted: (info.accepted ?? []).map(String),
    };
  }

  async verifyConnection(
    settings: AutomationSettings,
    smtpPassword: string
  ): Promise<{ ok: boolean; message: string }> {
    try {
      const transport = this.createTransport(settings, smtpPassword);
      await transport.verify();
      return { ok: true, message: `Ligação SMTP verificada com sucesso (${settings.smtpHost}:${settings.smtpPort}).` };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : 'Erro desconhecido ao verificar SMTP.',
      };
    }
  }
}
