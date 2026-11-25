import fs from 'node:fs';
import path from 'node:path';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  filterManualJournalLines,
  filterManualOpenDocuments,
} from '@b1-recon/shared';
import {
  LiveHanaReadRepository,
  MockHanaReadRepository,
  type IB1ReadRepository,
} from './b1/hanaReadRepository.js';
import { ReconciliationWorkflowService } from './b1/reconciliationWorkflow.js';
import {
  LiveServiceLayerClient,
  MockServiceLayerClient,
  type IB1ServiceLayerClient,
} from './b1/serviceLayerClient.js';
import { StatementIngestionService } from './banks/ingestionService.js';
import { loadConfig, type AppConfig } from './config/env.js';
import { SecretVault } from './config/vault.js';
import { ReconciliationDatabase } from './db/database.js';
import { ReconciliationMatchingEngine } from './matching/engine.js';

export interface AppContext {
  app: FastifyInstance;
  config: AppConfig;
  vault: SecretVault;
  repo: ReconciliationDatabase;
  hanaRepo: IB1ReadRepository;
  slClient: IB1ServiceLayerClient;
  ingestion: StatementIngestionService;
  matching: ReconciliationMatchingEngine;
  workflow: ReconciliationWorkflowService;
}

const ApproveSchema = z.object({
  bankLineId: z.string().min(1),
  targetType: z.enum([
    'EXISTING_JOURNAL_ENTRY',
    'OPEN_AR_INVOICE',
    'OPEN_AP_INVOICE',
    'MULTI_INVOICE_BUNDLE',
    'DIRECT_GL_ACCOUNT',
  ]),
  journalSelection: z
    .object({
      transId: z.number().int(),
      lineId: z.number().int(),
    })
    .optional(),
  invoiceSelection: z
    .object({
      cardCode: z.string().min(1),
      allocations: z
        .array(
          z.object({
            docType: z.enum([
              'AR_INVOICE',
              'AR_CREDIT_MEMO',
              'AP_INVOICE',
              'AP_CREDIT_MEMO',
            ]),
            docEntry: z.number().int(),
            allocatedAmount: z.number().refine((v) => Math.abs(v) > 0, {
              message: 'allocatedAmount must be non-zero',
            }),
          })
        )
        .min(1),
      paymentOnAccountAmount: z.number().min(0).optional(),
    })
    .optional(),
  glAccountSelection: z
    .object({
      glAccountCode: z.string().min(1),
      glAccountName: z.string().optional(),
    })
    .optional(),
});

const GlRuleSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(2),
  direction: z.enum(['CREDIT', 'DEBIT']),
  keywordsPattern: z.string().min(2),
  glAccountCode: z.string().min(2),
  glAccountName: z.string().min(2),
  confidence: z.number().int().min(55).max(99).default(92),
});

const ConnectionSettingsSchema = z.object({
  mode: z.enum(['mock', 'live']),
  hanaHost: z.string().min(1),
  hanaPort: z.number().int().positive(),
  hanaSchema: z.string().min(1),
  hanaReadonlyUser: z.string().min(1),
  hanaReadonlyPassword: z.string().optional(),
  hanaEncrypt: z.boolean(),
  hanaSslValidateCert: z.boolean(),
  b1ServiceLayerUrl: z.string().url(),
  b1CompanyDb: z.string().min(1),
  b1TechUser: z.string().optional(),
  b1TechPassword: z.string().optional(),
  b1RejectUnauthorizedTls: z.boolean(),
});

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

export async function buildApp(overrides?: Partial<AppConfig>): Promise<AppContext> {
  const config = { ...loadConfig(), ...overrides };
  const vault = new SecretVault(config.VAULT_MASTER_KEY);
  const repo = new ReconciliationDatabase(config.SQLITE_DB_PATH);

  // Restore any persisted encrypted runtime settings from the vault
  const savedConfigCipher = repo.getEncryptedSecret('runtime_b1_connection_config');
  if (savedConfigCipher && !overrides?.B1_MODE) {
    try {
      const saved = JSON.parse(vault.decrypt(savedConfigCipher)) as Partial<AppConfig>;
      Object.assign(config, saved);
    } catch {
      // Ignore if master key rotated
    }
  }

  const mockHana = new MockHanaReadRepository();
  let hanaRepo: IB1ReadRepository =
    config.B1_MODE === 'live' ? new LiveHanaReadRepository(config) : mockHana;
  let slClient: IB1ServiceLayerClient =
    config.B1_MODE === 'live' ? new LiveServiceLayerClient(config) : new MockServiceLayerClient(mockHana);

  const ingestion = new StatementIngestionService(repo);
  let matching = new ReconciliationMatchingEngine(hanaRepo);
  let workflow = new ReconciliationWorkflowService(repo, slClient);

  const rebuildProviders = () => {
    if (config.B1_MODE === 'live') {
      hanaRepo = new LiveHanaReadRepository(config);
      slClient = new LiveServiceLayerClient(config);
    } else {
      hanaRepo = mockHana;
      slClient = new MockServiceLayerClient(mockHana);
    }
    matching = new ReconciliationMatchingEngine(hanaRepo);
    workflow = new ReconciliationWorkflowService(repo, slClient);
  };

  const app = Fastify({ logger: false });

  await app.register(cors, {
    origin: true, // Allow requests from the SAP B1 Web Client origin with credentials
    credentials: true,
  });
  await app.register(cookie);
  await app.register(multipart, {
    limits: {
      fileSize: 15 * 1024 * 1024,
    },
  });

  app.get('/api/health', async () => ({
    ok: true,
    mode: config.B1_MODE,
    service: 'sap-b1-pt-bank-reconciliation',
  }));

  app.get('/api/settings/connection', async () => ({
    mode: config.B1_MODE,
    hanaHost: config.HANA_HOST,
    hanaPort: config.HANA_PORT,
    hanaSchema: config.HANA_SCHEMA,
    hanaReadonlyUser: config.HANA_READONLY_USER,
    hasHanaPassword: Boolean(config.HANA_READONLY_PASSWORD),
    hanaEncrypt: config.HANA_ENCRYPT,
    hanaSslValidateCert: config.HANA_SSL_VALIDATE_CERT,
    b1ServiceLayerUrl: config.B1_SERVICE_LAYER_URL,
    b1CompanyDb: config.B1_COMPANY_DB,
    b1TechUser: config.B1_TECH_USER ?? '',
    hasB1TechPassword: Boolean(config.B1_TECH_PASSWORD),
    b1RejectUnauthorizedTls: config.B1_REJECT_UNAUTHORIZED_TLS,
  }));

  app.post('/api/settings/connection', async (req, reply) => {
    const parsed = ConnectionSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues.map((i) => i.message).join('; ') });
    }
    const d = parsed.data;
    config.B1_MODE = d.mode;
    config.HANA_HOST = d.hanaHost;
    config.HANA_PORT = d.hanaPort;
    config.HANA_SCHEMA = d.hanaSchema;
    config.HANA_READONLY_USER = d.hanaReadonlyUser;
    if (d.hanaReadonlyPassword && d.hanaReadonlyPassword.trim()) {
      config.HANA_READONLY_PASSWORD = d.hanaReadonlyPassword;
    }
    config.HANA_ENCRYPT = d.hanaEncrypt;
    config.HANA_SSL_VALIDATE_CERT = d.hanaSslValidateCert;
    config.B1_SERVICE_LAYER_URL = d.b1ServiceLayerUrl;
    config.B1_COMPANY_DB = d.b1CompanyDb;
    if (d.b1TechUser !== undefined) config.B1_TECH_USER = d.b1TechUser;
    if (d.b1TechPassword && d.b1TechPassword.trim()) {
      config.B1_TECH_PASSWORD = d.b1TechPassword;
    }
    config.B1_REJECT_UNAUTHORIZED_TLS = d.b1RejectUnauthorizedTls;

    // Persist encrypted in the local AES-256-GCM vault
    repo.setEncryptedSecret(
      'runtime_b1_connection_config',
      vault.encrypt(
        JSON.stringify({
          B1_MODE: config.B1_MODE,
          HANA_HOST: config.HANA_HOST,
          HANA_PORT: config.HANA_PORT,
          HANA_SCHEMA: config.HANA_SCHEMA,
          HANA_READONLY_USER: config.HANA_READONLY_USER,
          HANA_READONLY_PASSWORD: config.HANA_READONLY_PASSWORD,
          HANA_ENCRYPT: config.HANA_ENCRYPT,
          HANA_SSL_VALIDATE_CERT: config.HANA_SSL_VALIDATE_CERT,
          B1_SERVICE_LAYER_URL: config.B1_SERVICE_LAYER_URL,
          B1_COMPANY_DB: config.B1_COMPANY_DB,
          B1_TECH_USER: config.B1_TECH_USER,
          B1_TECH_PASSWORD: config.B1_TECH_PASSWORD,
          B1_REJECT_UNAUTHORIZED_TLS: config.B1_REJECT_UNAUTHORIZED_TLS,
        })
      )
    );

    rebuildProviders();
    repo.recordAudit('admin', 'CONNECTION_CONFIG_UPDATED', {
      details: {
        mode: config.B1_MODE,
        hanaHost: config.HANA_HOST,
        hanaSchema: config.HANA_SCHEMA,
        b1ServiceLayerUrl: config.B1_SERVICE_LAYER_URL,
      },
    });

    return { ok: true, mode: config.B1_MODE };
  });

  app.post('/api/settings/test-connection', async (req) => {
    const cookieHeader = req.headers.cookie;

    let hanaStatus: {
      ok: boolean;
      latencyMs?: number;
      schema?: string;
      houseBanksCount?: number;
      openDocumentsCount?: number;
      error?: string;
    };
    try {
      hanaStatus = await hanaRepo.testConnection();
    } catch (err) {
      hanaStatus = {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    let slStatus: {
      ok: boolean;
      latencyMs?: number;
      authenticatedUser?: string;
      companyDb?: string;
      error?: string;
    };
    try {
      slStatus = await slClient.testConnection(cookieHeader);
    } catch (err) {
      slStatus = {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    return {
      mode: config.B1_MODE,
      hana: hanaStatus,
      serviceLayer: slStatus,
    };
  });

  app.get('/api/dashboard', async (req) => {
    const query = req.query as { houseBankId?: string };
    if (config.B1_MODE === 'live') {
      try {
        const liveBanks = await hanaRepo.getHouseBanks();
        if (liveBanks.length > 0) repo.upsertHouseBanks(liveBanks);
      } catch {
        // Keep cached house banks if HANA house bank sync is unavailable
      }
    }
    const houseBanks = repo.listHouseBanks();
    const summary = repo.getDashboardSummary(config.B1_MODE, query.houseBankId);
    return { houseBanks, summary };
  });

  app.get('/api/lines', async (req) => {
    const query = req.query as {
      houseBankId?: string;
      statusGroup?: 'PENDING' | 'RECONCILED' | 'IGNORED' | 'ALL';
      search?: string;
    };

    const lines = repo.listLines({
      houseBankId: query.houseBankId,
      statusGroup: query.statusGroup ?? 'PENDING',
      search: query.search,
    });

    const glRules = repo.listGlRules();
    const suggestionsByLine = await matching.generateSuggestionsForLines(lines, glRules);

    const enriched = lines.map((line) => {
      const suggestions = suggestionsByLine.get(line.id) ?? [];
      const topConfidence = suggestions[0]?.confidence ?? 0;
      if (line.status === 'UNMATCHED' || line.status === 'SUGGESTED') {
        repo.updateLineConfidence(line.id, topConfidence);
        line.topConfidence = topConfidence;
        line.status = topConfidence >= 50 ? 'SUGGESTED' : 'UNMATCHED';
      }
      return {
        ...line,
        suggestions,
      };
    });

    return { lines: enriched };
  });

  app.get('/api/b1/candidates', async (req) => {
    const query = req.query as {
      direction?: 'CREDIT' | 'DEBIT';
      glAccountCode?: string;
      search?: string;
    };
    const direction = query.direction ?? 'CREDIT';
    const glAccountCode = query.glAccountCode ?? '120101';

    const [openDocuments, journalLines] = await Promise.all([
      hanaRepo.getOpenDocuments(direction),
      hanaRepo.getUnreconciledJournalLines(glAccountCode),
    ]);

    return {
      openDocuments: query.search
        ? filterManualOpenDocuments(openDocuments, query.search)
        : openDocuments,
      journalLines: query.search
        ? filterManualJournalLines(journalLines, query.search)
        : journalLines,
    };
  });

  app.get('/api/gl-rules', async () => ({
    rules: repo.listGlRules(),
  }));

  app.post('/api/gl-rules', async (req, reply) => {
    const parsed = GlRuleSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues.map((i) => i.message).join('; ') });
    }
    const cookieHeader = req.headers.cookie;
    const userHeader = req.headers['x-b1-user'] as string | undefined;
    const b1User = await slClient.resolveSessionUser(cookieHeader, userHeader);

    const rule = repo.upsertGlRule({
      ...parsed.data,
      id: parsed.data.id?.trim() || `rule-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    });
    repo.recordAudit(b1User, 'GL_RULE_SAVED', { details: { ...rule } });
    return { rule };
  });

  app.delete('/api/gl-rules/:id', async (req) => {
    const params = req.params as { id: string };
    const cookieHeader = req.headers.cookie;
    const userHeader = req.headers['x-b1-user'] as string | undefined;
    const b1User = await slClient.resolveSessionUser(cookieHeader, userHeader);

    repo.deleteGlRule(params.id);
    repo.recordAudit(b1User, 'GL_RULE_DELETED', { details: { ruleId: params.id } });
    return { ok: true };
  });

  app.post('/api/statements/preview', async (req, reply) => {
    const filePart = await req.file();
    if (!filePart) {
      return reply.code(400).send({ error: 'Missing bank statement file upload.' });
    }
    const buffer = await filePart.toBuffer();
    try {
      const preview = ingestion.previewStatement(buffer, filePart.filename);
      return preview;
    } catch (err) {
      return reply.code(400).send({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  app.post('/api/statements/import', async (req, reply) => {
    const cookieHeader = req.headers.cookie;
    const userHeader = req.headers['x-b1-user'] as string | undefined;
    const b1User = await slClient.resolveSessionUser(cookieHeader, userHeader);

    const filePart = await req.file();
    if (!filePart) {
      return reply.code(400).send({ error: 'Missing bank statement file upload.' });
    }
    const fields = filePart.fields as Record<string, { value?: string } | undefined>;
    const houseBankId = fields?.houseBankId?.value;
    const buffer = await filePart.toBuffer();

    try {
      const result = ingestion.importStatement(buffer, {
        fileName: filePart.filename,
        houseBankId: houseBankId && houseBankId !== 'AUTO' ? houseBankId : undefined,
        b1User,
      });

      const pendingLines = repo.listLines({
        houseBankId: result.houseBankId,
        statusGroup: 'PENDING',
      });
      const glRules = repo.listGlRules();
      const sugMap = await matching.generateSuggestionsForLines(pendingLines, glRules);
      let autoSuggestedCount = 0;
      for (const l of pendingLines) {
        const top = sugMap.get(l.id)?.[0]?.confidence ?? 0;
        repo.updateLineConfidence(l.id, top);
        if (top >= 85) autoSuggestedCount++;
      }

      return { ...result, autoSuggestedCount };
    } catch (err) {
      return reply.code(400).send({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  app.post('/api/statements/import-samples', async (req, reply) => {
    const cookieHeader = req.headers.cookie;
    const userHeader = req.headers['x-b1-user'] as string | undefined;
    const b1User = await slClient.resolveSessionUser(cookieHeader, userHeader);

    const candidates = [
      path.resolve(process.cwd(), 'samples'),
      path.resolve(process.cwd(), '../../samples'),
    ];
    const samplesDir = candidates.find((d) => fs.existsSync(d));
    if (!samplesDir) {
      return reply.code(404).send({ error: 'Sample statements directory not found.' });
    }

    const sampleFiles = ['statement_2026_11.mt940', 'statement_2026_11.n43'];
    let importedLinesCount = 0;
    let skippedDuplicateCount = 0;

    for (const fname of sampleFiles) {
      const fullPath = path.join(samplesDir, fname);
      if (!fs.existsSync(fullPath)) continue;
      const buf = fs.readFileSync(fullPath);
      const res = ingestion.importStatement(buf, { fileName: fname, b1User });
      importedLinesCount += res.importedLinesCount;
      skippedDuplicateCount += res.skippedDuplicateCount;
    }

    const pendingLines = repo.listLines({ statusGroup: 'PENDING' });
    const glRules = repo.listGlRules();
    const sugMap = await matching.generateSuggestionsForLines(pendingLines, glRules);
    for (const l of pendingLines) {
      const top = sugMap.get(l.id)?.[0]?.confidence ?? 0;
      repo.updateLineConfidence(l.id, top);
    }

    return { importedLinesCount, skippedDuplicateCount };
  });

  app.post('/api/reconciliations/approve', async (req, reply) => {
    const parsed = ApproveSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues.map((i) => i.message).join('; ') });
    }

    const cookieHeader = req.headers.cookie;
    const userHeader = req.headers['x-b1-user'] as string | undefined;
    try {
      const b1User = await slClient.resolveSessionUser(cookieHeader, userHeader);
      const updated = await workflow.approveAndReconcile(parsed.data, b1User, cookieHeader);
      return { line: updated };
    } catch (err) {
      return reply.code(422).send({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  app.post('/api/reconciliations/batch-approve', async (req, reply) => {
    const bodySchema = z.object({
      houseBankId: z.string().optional(),
      minConfidence: z.number().min(70).max(100).default(90),
    });
    const parsed = bodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid batch-approve parameters.' });
    }

    const cookieHeader = req.headers.cookie;
    const userHeader = req.headers['x-b1-user'] as string | undefined;
    const b1User = await slClient.resolveSessionUser(cookieHeader, userHeader);

    const pending = repo.listLines({
      houseBankId: parsed.data.houseBankId,
      statusGroup: 'PENDING',
    });
    const glRules = repo.listGlRules();
    const sugMap = await matching.generateSuggestionsForLines(pending, glRules);

    let reconciledCount = 0;
    const errors: Array<{ bankLineId: string; error: string }> = [];

    const consumedDocEntries = new Set<string>();
    const consumedJournalKeys = new Set<string>();

    for (const line of pending) {
      const top = (sugMap.get(line.id) ?? [])[0];
      if (!top || top.confidence < parsed.data.minConfidence || Math.abs(top.differenceAmount) > 0.009) {
        continue;
      }

      if (top.targetType === 'EXISTING_JOURNAL_ENTRY' && top.journalLine) {
        const jeKey = `${top.journalLine.transId}:${top.journalLine.lineId}`;
        if (consumedJournalKeys.has(jeKey)) continue;

        try {
          await workflow.approveAndReconcile(
            {
              bankLineId: line.id,
              targetType: 'EXISTING_JOURNAL_ENTRY',
              journalSelection: {
                transId: top.journalLine.transId,
                lineId: top.journalLine.lineId,
              },
            },
            b1User,
            cookieHeader
          );
          consumedJournalKeys.add(jeKey);
          reconciledCount++;
        } catch (err) {
          errors.push({
            bankLineId: line.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      } else if (top.targetType === 'DIRECT_GL_ACCOUNT' && top.glAccountMatch) {
        try {
          await workflow.approveAndReconcile(
            {
              bankLineId: line.id,
              targetType: 'DIRECT_GL_ACCOUNT',
              glAccountSelection: {
                glAccountCode: top.glAccountMatch.glAccountCode,
                glAccountName: top.glAccountMatch.glAccountName,
              },
            },
            b1User,
            cookieHeader
          );
          reconciledCount++;
        } catch (err) {
          errors.push({
            bankLineId: line.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      } else if (top.allocations && top.allocations.length > 0 && top.cardCode) {
        const conflict = top.allocations.some((a) =>
          consumedDocEntries.has(`${a.docType}:${a.docEntry}`)
        );
        if (conflict) continue;

        try {
          await workflow.approveAndReconcile(
            {
              bankLineId: line.id,
              targetType: top.targetType,
              invoiceSelection: {
                cardCode: top.cardCode,
                allocations: top.allocations.map((a) => ({
                  docType: a.docType,
                  docEntry: a.docEntry,
                  allocatedAmount: a.allocatedAmount,
                })),
              },
            },
            b1User,
            cookieHeader
          );
          top.allocations.forEach((a) => consumedDocEntries.add(`${a.docType}:${a.docEntry}`));
          reconciledCount++;
        } catch (err) {
          errors.push({
            bankLineId: line.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    return { reconciledCount, errors };
  });

  app.post('/api/reconciliations/:id/ignore', async (req, reply) => {
    const params = req.params as { id: string };
    const body = (req.body ?? {}) as { reason?: string };
    const cookieHeader = req.headers.cookie;
    const userHeader = req.headers['x-b1-user'] as string | undefined;

    try {
      const b1User = await slClient.resolveSessionUser(cookieHeader, userHeader);
      const updated = workflow.markLineIgnored(params.id, b1User, body.reason);
      return { line: updated };
    } catch (err) {
      return reply.code(400).send({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  app.post('/api/reconciliations/:id/reopen', async (req, reply) => {
    const params = req.params as { id: string };
    const cookieHeader = req.headers.cookie;
    const userHeader = req.headers['x-b1-user'] as string | undefined;

    try {
      const b1User = await slClient.resolveSessionUser(cookieHeader, userHeader);
      const updated = workflow.reopenLine(params.id, b1User);
      return { line: updated };
    } catch (err) {
      return reply.code(400).send({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  app.get('/api/audit-logs', async () => ({
    logs: repo.listAuditLogs(100),
  }));

  // Serve built React Frontend directly when packages/frontend/dist is present
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
      const candidateFile = path.resolve(frontendDistDir, cleanPath);

      // Prevent directory traversal outside frontendDistDir
      if (
        candidateFile.startsWith(frontendDistDir) &&
        fs.existsSync(candidateFile) &&
        fs.statSync(candidateFile).isFile()
      ) {
        const ext = path.extname(candidateFile).toLowerCase();
        reply.header('Content-Type', MIME_TYPES[ext] ?? 'application/octet-stream');
        return reply.send(fs.readFileSync(candidateFile));
      }

      const indexHtml = path.join(frontendDistDir, 'index.html');
      if (fs.existsSync(indexHtml)) {
        reply.header('Content-Type', 'text/html; charset=utf-8');
        return reply.send(fs.readFileSync(indexHtml));
      }
      return reply.code(404).send({ error: 'Not found' });
    });
  }

  return {
    app,
    config,
    vault,
    repo,
    get hanaRepo() {
      return hanaRepo;
    },
    get slClient() {
      return slClient;
    },
    ingestion,
    get matching() {
      return matching;
    },
    get workflow() {
      return workflow;
    },
  };
}
