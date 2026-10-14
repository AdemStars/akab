import { getDatabase } from '../config';

export type VoteDecision = 'approve' | 'reject';

export class ModerationVoteModel {
  static cast(signalId: string, validatorId: string, decision: VoteDecision, reason?: string): boolean {
    const result = getDatabase()
      .prepare(
        `INSERT OR IGNORE INTO moderation_votes (signalId, validatorId, decision, reason, createdAt)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(signalId, validatorId, decision, reason ?? null, new Date().toISOString());
    return result.changes > 0;
  }

  static approverIds(signalId: string): string[] {
    const rows = getDatabase()
      .prepare(`SELECT validatorId FROM moderation_votes WHERE signalId = ? AND decision = 'approve'`)
      .all(signalId) as Array<{ validatorId: string }>;
    return rows.map((row) => row.validatorId);
  }

  static clear(signalId: string): void {
    getDatabase().prepare('DELETE FROM moderation_votes WHERE signalId = ?').run(signalId);
  }
}
