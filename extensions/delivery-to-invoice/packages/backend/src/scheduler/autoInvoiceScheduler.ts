import { runInCompany } from '../company/context.js';
import type { ExtensionDatabase } from '../db/database.js';
import type { ConversionWorkflowService } from '../workflow/conversionWorkflow.js';

/**
 * One timer per company: each company has its own schedule/settings. Runs execute inside that company's
 * context and authenticate with the technical user (there is no user session in a scheduled run).
 */
export class AutoInvoiceScheduler {
  private timers = new Map<string, NodeJS.Timeout>();
  private running = new Set<string>();

  constructor(
    private readonly db: ExtensionDatabase,
    private readonly workflow: ConversionWorkflowService
  ) {}

  /** Re-reads the schedule of one company, or (no argument) of every company with the scheduler enabled. */
  public refreshSchedule(companyDb?: string): void {
    if (companyDb) {
      this.refreshCompany(companyDb);
      return;
    }
    this.stop();
    for (const company of this.db.listSchedulerCompanies()) {
      this.refreshCompany(company);
    }
  }

  private refreshCompany(companyDb: string): void {
    this.stopCompany(companyDb);
    runInCompany(companyDb, () => {
      const settings = this.db.getSettings();
      if (!settings.schedulerEnabled) {
        this.db.updateSchedulerTimestamps(null, null);
        return;
      }

      const intervalMs = Math.max(1, settings.intervalMinutes) * 60_000;
      this.db.updateSchedulerTimestamps(null, new Date(Date.now() + intervalMs).toISOString());

      const timer = setInterval(() => {
        void this.tick(companyDb);
      }, intervalMs);
      timer.unref?.();
      this.timers.set(companyDb, timer);
    });
  }

  private stopCompany(companyDb: string): void {
    const timer = this.timers.get(companyDb);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(companyDb);
    }
  }

  public stop(): void {
    for (const company of [...this.timers.keys()]) this.stopCompany(company);
  }

  private async tick(companyDb: string): Promise<void> {
    if (this.running.has(companyDb)) return;
    this.running.add(companyDb);
    try {
      await runInCompany(companyDb, () => this.workflow.runScheduledBatch('scheduler'));
    } catch (err) {
      runInCompany(companyDb, () =>
        this.db.addAuditLog(
          'scheduler',
          'SCHEDULED_RUN_ERROR',
          err instanceof Error ? err.message : 'Erro inesperado na execução agendada'
        )
      );
    } finally {
      this.running.delete(companyDb);
    }
  }
}
