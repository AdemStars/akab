import { Request } from 'express';
import { getDatabase } from '../config';

export interface AuditEntry {
  id: number;
  createdAt: string;
  actorId: string | null;
  actorEmail: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  details: Record<string, unknown> | null;
  ip: string | null;
}

export class AuditLog {
  static record(input: {
    actorId?: string | null;
    actorEmail?: string | null;
    action: string;
    targetType?: string;
    targetId?: string;
    details?: Record<string, unknown>;
    req?: Request;
  }): void {
    getDatabase()
      .prepare(
        `INSERT INTO audit_log (createdAt, actorId, actorEmail, action, targetType, targetId, details, ip)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        new Date().toISOString(),
        input.actorId ?? input.req?.user?.id ?? null,
        input.actorEmail ?? input.req?.user?.email ?? null,
        input.action,
        input.targetType ?? null,
        input.targetId ?? null,
        input.details ? JSON.stringify(input.details) : null,
        input.req?.ip ?? null
      );
  }

  static list(options: { action?: string; limit?: number; offset?: number } = {}): {
    entries: AuditEntry[];
    total: number;
  } {
    const db = getDatabase();
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    const offset = Math.max(options.offset ?? 0, 0);
    const where = options.action ? 'WHERE action = ?' : '';
    const params = options.action ? [options.action] : [];
    const rows = db
      .prepare(`SELECT * FROM audit_log ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as any[];
    const total = (db.prepare(`SELECT COUNT(*) AS count FROM audit_log ${where}`).get(...params) as any).count;
    return {
      total,
      entries: rows.map((row) => ({
        ...row,
        details: row.details ? JSON.parse(row.details) : null,
      })),
    };
  }
}
