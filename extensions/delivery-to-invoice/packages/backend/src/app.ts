import fs from 'node:fs';
import path from 'node:path';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { filterEligibleDeliveries, type DashboardSummary } from '@b1-d2i/shared';
import {
  LiveServiceLayerClient,
  MockServiceLayerClient,
  type IB1ServiceLayerClient,
} from './b1/serviceLayerClient.js';
import { loadConfig, type AppConfig } from './config/env.js';
import { ExtensionDatabase } from './db/database.js';
import {
  MockEmailService,
  SmtpEmailService,
  type IEmailService,
} from './email/emailService.js';
import {
  GatewayCrystalPdfClient,
  type IGatewayCrystalPdfClient,
} from './pdf/gatewayCrystalPdfClient.js';
import { AutoInvoiceScheduler } from './scheduler/autoInvoiceScheduler.js';
import { ConversionWorkflowService } from './workflow/conversionWorkflow.js';

export interface BuildAppOptions {
  configOverrides?: Partial<Record<string, string | number | boolean>>;
  dbPath?: string;
  b1Client?: IB1ServiceLayerClient;
  emailService?: IEmailService;
  gatewayPdfClient?: IGatewayCrystalPdfClient;
}

const ConvertSchema = z.object({
  deliveryDocEntries: z.array(z.number().int().positive()).min(1),
  groupingMode: z.enum(['PER_DELIVERY', 'CONSOLIDATED_BY_CUSTOMER']).default('PER_DELIVERY'),
  sendEmail: z.boolean().default(true),
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const RetryEmailSchema = z.object({
  recipientEmail: z.string().email().optional(),
});

const SettingsPatchSchema = z.object({
  schedulerEnabled: z.boolean().optional(),
  intervalMinutes: z.number().int().min(1).max(10080).optional(),
  groupingMode: z.enum(['PER_DELIVERY', 'CONSOLIDATED_BY_CUSTOMER']).optional(),
  onlyAutoInvoiceCustomers: z.boolean().optional(),
  minDeliveryAgeDays: z.number().int().min(0).max(365).optional(),
  sendEmailAutomatically: z.boolean().optional(),
  emailSubjectTemplate: z.string().min(1).optional(),
  emailBodyTemplate: z.string().min(1).optional(),
  ccAddresses: z.string().optional(),
  replyToAddress: z.string().optional(),
  smtpHost: z.string().optional(),
  smtpPort: z.number().int().min(1).max(65535).optional(),
  smtpSecure: z.boolean().optional(),
  smtpUser: z.string().optional(),
  smtpPassword: z.string().optional(),
  smtpFrom: z.string().optional(),
  pdfSource: z.enum(['builtin', 'gateway']).optional(),
  gatewayUrl: z.string().optional(),
  invoiceDocCode: z.string().min(1).optional(),
  gatewayFallbackToBuiltin: z.boolean().optional(),
});

export async function buildApp(opts: BuildAppOptions = {}): Promise<{
  app: FastifyInstance;
  config: AppConfig;
  db: ExtensionDatabase;
  workflow: ConversionWorkflowService;
  scheduler: AutoInvoiceScheduler;
  b1Client: IB1ServiceLayerClient;
  emailService: IEmailService;
}> {
  const config = loadConfig(opts.configOverrides);
  const db = new ExtensionDatabase(opts.dbPath ?? config.SQLITE_DB_PATH, config);
  const b1Client =
    opts.b1Client ??
    (config.B1_MODE === 'live'
      ? new LiveServiceLayerClient(config)
      : new MockServiceLayerClient(config));
  const emailService =
    opts.emailService ??
    (config.EMAIL_MODE === 'smtp' ? new SmtpEmailService() : new MockEmailService());
  const gatewayPdfClient = opts.gatewayPdfClient ?? new GatewayCrystalPdfClient(config);

  const workflow = new ConversionWorkflowService(
    db,
    b1Client,
    emailService,
    config,
    gatewayPdfClient
  );
  const scheduler = new AutoInvoiceScheduler(db, workflow);
  scheduler.refreshSchedule();

  const app = Fastify({ logger: false });
  await app.register(cors, {
    origin: config.CORS_ORIGIN === '*' ? true : [config.CORS_ORIGIN, 'http://localhost:5174', 'http://127.0.0.1:5174'],
    credentials: true,
  });
  await app.register(cookie);

  app.addHook('onClose', async () => {
    scheduler.stop();
  });

  app.get('/api/health', async () => ({
    ok: true,
    b1Mode: config.B1_MODE,
    emailMode: config.EMAIL_MODE,
  }));

  app.get('/api/dashboard', async (req) => {
    const cookieHeader = req.headers.cookie;
    const deliveries = await workflow.listOpenDeliveries(cookieHeader);
    const settings = db.getSettings();
    const eligible = filterEligibleDeliveries(deliveries, {
      onlyAutoInvoiceCustomers: settings.onlyAutoInvoiceCustomers,
      minDeliveryAgeDays: settings.minDeliveryAgeDays,
    });
    const stats = db.getStatsToday();

    const summary: DashboardSummary = {
      openDeliveriesCount: deliveries.filter((d) => !d.alreadyProcessed).length,
      eligibleAutoCount: eligible.length,
      openDeliveriesTotal: deliveries
        .filter((d) => !d.alreadyProcessed)
        .reduce((s, d) => s + d.docTotal, 0),
      invoicedTodayCount: stats.invoicedTodayCount,
      emailsSentCount: stats.emailsSentCount,
      emailFailedCount: stats.emailFailedCount,
      schedulerEnabled: settings.schedulerEnabled,
      lastRunAt: settings.lastRunAt ?? null,
      nextRunAt: settings.nextRunAt ?? null,
      b1Mode: config.B1_MODE,
      emailMode: config.EMAIL_MODE,
    };
    return summary;
  });

  app.get('/api/deliveries', async (req) => {
    const deliveries = await workflow.listOpenDeliveries(req.headers.cookie);
    return { deliveries };
  });

  app.post('/api/deliveries/convert', async (req, reply) => {
    const parsed = ConvertSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Pedido inválido', details: parsed.error.flatten() });
    }
    const actor = String(req.headers['x-b1-user'] ?? 'webclient-user');
    const result = await workflow.convertDeliveries({
      ...parsed.data,
      triggerSource: 'MANUAL',
      actor,
      cookieHeader: req.headers.cookie,
    });
    return result;
  });

  app.post('/api/scheduler/run-now', async (req) => {
    const actor = String(req.headers['x-b1-user'] ?? 'webclient-user');
    return workflow.runScheduledBatch(actor);
  });

  app.get('/api/conversions', async () => ({
    conversions: db.listConversions(150),
  }));

  app.post('/api/conversions/:id/retry-email', async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = RetryEmailSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Email inválido' });
    }
    try {
      const actor = String(req.headers['x-b1-user'] ?? 'webclient-user');
      const updated = await workflow.retryEmail(
        id,
        parsed.data.recipientEmail,
        actor,
        req.headers.cookie
      );
      return { conversion: updated };
    } catch (err) {
      return reply
        .code(400)
        .send({ error: err instanceof Error ? err.message : 'Erro ao reenviar email' });
    }
  });

  app.get('/api/emails', async () => ({
    emails: db.listSentEmails(100),
  }));

  app.get('/api/settings', async () => ({
    settings: db.getSettings(),
  }));

  app.put('/api/settings', async (req, reply) => {
    const parsed = SettingsPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Definições inválidas', details: parsed.error.flatten() });
    }
    const updated = db.updateSettings(parsed.data);
    scheduler.refreshSchedule();
    const actor = String(req.headers['x-b1-user'] ?? 'webclient-user');
    db.addAuditLog(
      actor,
      'SETTINGS_UPDATED',
      `Scheduler=${updated.schedulerEnabled} (${updated.intervalMinutes}m), Grouping=${updated.groupingMode}, AutoEmail=${updated.sendEmailAutomatically}`
    );
    return { settings: db.getSettings() };
  });

  app.post('/api/settings/test-connections', async (req) => {
    const settings = db.getSettings();
    const [b1, smtp, gateway] = await Promise.all([
      b1Client.testConnection(req.headers.cookie),
      emailService.verifyConnection(settings, db.getSmtpPassword()),
      gatewayPdfClient.testConnection(settings),
    ]);
    return { b1, smtp, gateway };
  });

  app.get('/api/audit-logs', async () => ({
    logs: db.listAuditLogs(100),
  }));

  // Serve built frontend if present (Docker / standalone mode)
  const distCandidates = [
    path.resolve(process.cwd(), 'packages/frontend/dist'),
    path.resolve(process.cwd(), '../frontend/dist'),
  ];
  const frontendDistDir = distCandidates.find((d) => fs.existsSync(d));

  if (frontendDistDir) {
    app.setNotFoundHandler(async (req, reply) => {
      if (req.url.startsWith('/api/')) {
        return reply.code(404).send({ error: `API route not found: ${req.url}` });
      }
      const cleanPath = req.url.split('?')[0].replace(/^\/+/, '') || 'index.html';
      const candidate = path.resolve(frontendDistDir, cleanPath);
      const target =
        candidate.startsWith(frontendDistDir) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()
          ? candidate
          : path.join(frontendDistDir, 'index.html');

      const ext = path.extname(target).toLowerCase();
      const mimeMap: Record<string, string> = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
      };
      reply.header('Content-Type', mimeMap[ext] ?? 'application/octet-stream');
      return reply.send(fs.readFileSync(target));
    });
  }

  return { app, config, db, workflow, scheduler, b1Client, emailService };
}
