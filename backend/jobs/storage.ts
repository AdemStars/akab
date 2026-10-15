import { config } from '../config';
import { StorageService } from '../services/storage';

const timers: NodeJS.Timeout[] = [];

function every(ms: number, label: string, task: () => Promise<unknown>): void {
  const run = () =>
    task().catch((err) => console.error(`[STORAGE ${label}]`, err instanceof Error ? err.message : err));
  const timer = setInterval(run, ms);
  timer.unref?.();
  timers.push(timer);
  setTimeout(run, 30_000).unref?.();
}

export function startStorageJobs(): void {
  if (!StorageService.isEnabled()) return;
  const { repairIntervalMinutes, backupIntervalHours } = config.storage;
  console.log(`[STORAGE] ${config.storage.nodes.length} nœud(s) chiffré(s), ${config.storage.replicas} réplique(s)`);

  if (repairIntervalMinutes > 0) {
    every(repairIntervalMinutes * 60_000, 'REPAIR', async () => {
      const report = await StorageService.repair();
      if (report.copied || report.failed) console.log('[STORAGE REPAIR]', report);
    });
  }
  if (backupIntervalHours > 0) {
    every(backupIntervalHours * 3_600_000, 'BACKUP', async () => {
      const report = await StorageService.backupDatabase();
      console.log(`[STORAGE BACKUP] ${report.blobId.slice(0, 12)}… sur ${report.storedOn.join(', ')}`);
    });
  }
}

export function stopStorageJobs(): void {
  timers.splice(0).forEach(clearInterval);
}
