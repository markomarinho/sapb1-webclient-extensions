import type { ExtensionDatabase } from '../db/database.js';
import type { ConversionWorkflowService } from '../workflow/conversionWorkflow.js';

export class AutoInvoiceScheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly db: ExtensionDatabase,
    private readonly workflow: ConversionWorkflowService
  ) {}

  public refreshSchedule(): void {
    this.stop();
    const settings = this.db.getSettings();
    if (!settings.schedulerEnabled) {
      this.db.updateSchedulerTimestamps(null, null);
      return;
    }

    const intervalMs = Math.max(1, settings.intervalMinutes) * 60_000;
    const nextRunAt = new Date(Date.now() + intervalMs).toISOString();
    this.db.updateSchedulerTimestamps(null, nextRunAt);

    this.timer = setInterval(() => {
      void this.tick();
    }, intervalMs);
    this.timer.unref?.();
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.workflow.runScheduledBatch('scheduler');
    } catch (err) {
      this.db.addAuditLog(
        'scheduler',
        'SCHEDULED_RUN_ERROR',
        err instanceof Error ? err.message : 'Erro inesperado na execução agendada'
      );
    } finally {
      this.running = false;
    }
  }
}
