import { GdprService } from '../services/gdpr';
import { config } from '../config';

let intervalTimer: NodeJS.Timeout | null = null;

export function runGdprCleanup(): { cleanedCount: number; timestamp: string } {
  const result = GdprService.cleanExpiredData();
  if (result.cleanedCount > 0) {
    console.log(`[GDPR CLEANUP] Anonymized ${result.cleanedCount} signals exceeding retention period.`);
  }
  return result;
}

export function startCleanupJob(): void {
  // Run once on startup
  runGdprCleanup();

  // Schedule periodic cleanup
  const intervalMs = config.gdprCleanupIntervalHours * 60 * 60 * 1000;
  intervalTimer = setInterval(() => {
    try {
      runGdprCleanup();
    } catch (err) {
      console.error('[GDPR CLEANUP ERROR]', err);
    }
  }, intervalMs);

  // Unref timer so it doesn't prevent graceful process exit
  if (intervalTimer.unref) {
    intervalTimer.unref();
  }
}

export function stopCleanupJob(): void {
  if (intervalTimer) {
    clearInterval(intervalTimer);
    intervalTimer = null;
  }
}
