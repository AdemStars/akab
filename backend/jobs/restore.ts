/**
 * Disaster recovery: node dist/jobs/restore.js <destination.sqlite>
 * Needs STORAGE_NODES and STORAGE_ENCRYPTION_KEY, and nothing else.
 */
import { StorageService } from '../services/storage';

async function main(): Promise<void> {
  const destination = process.argv[2];
  if (!destination) {
    console.error('Usage : node dist/jobs/restore.js <fichier-de-destination.sqlite>');
    process.exit(2);
  }
  if (!StorageService.isEnabled()) {
    console.error('STORAGE_NODES et STORAGE_ENCRYPTION_KEY sont requis.');
    process.exit(2);
  }
  const restored = await StorageService.restoreLatestBackup(destination);
  console.log(`Base restaurée depuis la sauvegarde du ${restored.createdAt} vers ${destination}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
