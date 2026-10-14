import crypto from 'crypto';
import { getDatabase } from '../config';

export type IncidentType =
  | 'violence_physique'
  | 'violence_verbale'
  | 'tir_lbd'
  | 'gaz_lacrymo'
  | 'interpellation_violente'
  | 'grenade_desencerclement'
  | 'materiel_detruit'
  | 'autre';

export type SignalStatus = 'pending' | 'validated' | 'rejected' | 'under_appeal';

export type EventType =
  | 'none'
  | 'demonstration'
  | 'march'
  | 'rally'
  | 'strike'
  | 'blockade'
  | 'occupation'
  | 'other';

export type VictimAgeGroup = 'minor' | 'adult' | 'mixed' | 'unknown';

export interface EvidenceItem {
  id: string;
  cid: string;
  originalName: string;
  mimeType: string;
  size: number;
  url: string;
  anonymized: boolean;
  isVideo: boolean;
}

export interface SignalRecord {
  id: string;
  title: string;
  description: string;
  incidentDate: string;
  incidentType: IncidentType;
  eventType: EventType;
  eventName: string | null;
  victimAgeGroup: VictimAgeGroup;
  latitude: number;
  longitude: number;
  locationAccuracyMeters: number | null;
  address: string | null;
  city: string | null;
  postalCode: string | null;
  department: string | null;
  evidence: EvidenceItem[];
  status: SignalStatus;
  rejectionReason: string | null;
  appealReason: string | null;
  appealedAt: string | null;
  validationScore: number;
  validatedBy: string | null;
  validatedAt: string | null;
  trustPointsAwarded: number;
  reporterEmail: string | null;
  reporterPhone: string | null;
  forgetToken: string;
  anonymizedAt: string | null;
  createdAt: string;
  updatedAt: string;
  retentionExpiresAt: string;
}

export type PublicSignalRecord = Omit<SignalRecord, 'victimAgeGroup'>;

export interface CreateSignalInput {
  title: string;
  description: string;
  incidentDate: string;
  incidentType: IncidentType;
  eventType?: EventType;
  eventName?: string;
  victimAgeGroup?: VictimAgeGroup;
  latitude: number;
  longitude: number;
  locationAccuracyMeters?: number;
  address?: string;
  city?: string;
  postalCode?: string;
  department?: string;
  evidence?: EvidenceItem[];
  reporterEmail?: string;
  reporterPhone?: string;
}

export class SignalModel {
  static create(input: CreateSignalInput): SignalRecord {
    const db = getDatabase();
    const id = 'sig_' + crypto.randomBytes(8).toString('hex');
    const forgetToken = 'fgt_' + crypto.randomBytes(16).toString('hex');
    const now = new Date();
    const createdAt = now.toISOString();
    const updatedAt = createdAt;

    // Retention expires 30 days from creation
    const retentionDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const retentionExpiresAt = retentionDate.toISOString();

    const evidenceJson = JSON.stringify(input.evidence || []);

    db.prepare(`
      INSERT INTO signals (
        id, title, description, incidentDate, incidentType,
        eventType, eventName, victimAgeGroup, latitude, longitude, locationAccuracyMeters,
        address, city, postalCode, department,
        evidence, status, validationScore, trustPointsAwarded,
        reporterEmail, reporterPhone, forgetToken,
        createdAt, updatedAt, retentionExpiresAt
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, 'pending', 0, 0,
        ?, ?, ?,
        ?, ?, ?
      )
    `).run(
      id,
      input.title,
      input.description,
      input.incidentDate,
      input.incidentType,
      input.eventType || 'none',
      input.eventName || null,
      input.victimAgeGroup || 'unknown',
      input.latitude,
      input.longitude,
      input.locationAccuracyMeters ?? null,
      input.address || null,
      input.city || null,
      input.postalCode || null,
      input.department || null,
      evidenceJson,
      input.reporterEmail || null,
      input.reporterPhone || null,
      forgetToken,
      createdAt,
      updatedAt,
      retentionExpiresAt
    );

    return this.findById(id)!;
  }

  static findById(id: string): SignalRecord | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM signals WHERE id = ?').get(id) as any;
    if (!row) return null;
    return this.mapRow(row);
  }

  static findByForgetToken(forgetToken: string): SignalRecord | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM signals WHERE forgetToken = ?').get(forgetToken) as any;
    if (!row) return null;
    return this.mapRow(row);
  }

  static findValidated(filters: {
    startDate?: string;
    endDate?: string;
    incidentType?: string;
    city?: string;
    department?: string;
    limit?: number;
    offset?: number;
  }): { signals: PublicSignalRecord[]; total: number } {
    const db = getDatabase();
    const clauses: string[] = ["status = 'validated'"];
    const params: any[] = [];

    if (filters.startDate) {
      clauses.push('incidentDate >= ?');
      params.push(filters.startDate);
    }
    if (filters.endDate) {
      clauses.push('incidentDate <= ?');
      params.push(filters.endDate);
    }
    if (filters.incidentType) {
      clauses.push('incidentType = ?');
      params.push(filters.incidentType);
    }
    if (filters.city) {
      clauses.push('LOWER(city) = LOWER(?)');
      params.push(filters.city);
    }
    if (filters.department) {
      clauses.push('department = ?');
      params.push(filters.department);
    }

    const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

    const countRow = db.prepare(`SELECT COUNT(*) as count FROM signals ${whereClause}`).get(...params) as any;
    const total = countRow.count;

    const limit = filters.limit ? Math.min(filters.limit, 200) : 50;
    const offset = filters.offset || 0;

    const rows = db.prepare(`
      SELECT * FROM signals
      ${whereClause}
      ORDER BY incidentDate DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset) as any[];

    // Strip sensitive fields from public output
    const signals = rows.map((r) => this.sanitizePublic(this.mapRow(r)));
    return { signals, total };
  }

  static findAllForAdmin(filters: {
    status?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }): { signals: SignalRecord[]; total: number } {
    const db = getDatabase();
    const clauses: string[] = [];
    const params: any[] = [];

    if (filters.status && filters.status !== 'all') {
      clauses.push('status = ?');
      params.push(filters.status);
    }
    if (filters.search) {
      clauses.push('(title LIKE ? OR description LIKE ? OR city LIKE ? OR address LIKE ?)');
      const term = `%${filters.search}%`;
      params.push(term, term, term, term);
    }

    const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const countRow = db.prepare(`SELECT COUNT(*) as count FROM signals ${whereClause}`).get(...params) as any;
    const total = countRow.count;

    const limit = filters.limit ? Math.min(filters.limit, 200) : 50;
    const offset = filters.offset || 0;

    const rows = db.prepare(`
      SELECT * FROM signals
      ${whereClause}
      ORDER BY createdAt DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset) as any[];

    return {
      signals: rows.map((r) => this.mapRow(r)),
      total,
    };
  }

  static validate(id: string, validatorId: string, trustPointsGranted = 10): SignalRecord | null {
    const db = getDatabase();
    const now = new Date().toISOString();
    const result = db.prepare(`
      UPDATE signals
      SET status = 'validated',
          validatedBy = ?,
          validatedAt = ?,
          trustPointsAwarded = ?,
          validationScore = validationScore + 1,
          updatedAt = ?
      WHERE id = ?
    `).run(validatorId, now, trustPointsGranted, now, id);

    if (result.changes === 0) return null;
    return this.findById(id);
  }

  static reject(id: string, validatorId: string, reason: string): SignalRecord | null {
    const db = getDatabase();
    const now = new Date().toISOString();
    const result = db.prepare(`
      UPDATE signals
      SET status = 'rejected',
          validatedBy = ?,
          validatedAt = ?,
          rejectionReason = ?,
          updatedAt = ?
      WHERE id = ?
    `).run(validatorId, now, reason, now, id);

    if (result.changes === 0) return null;
    return this.findById(id);
  }

  static submitAppeal(id: string, appealReason: string): SignalRecord | null {
    const db = getDatabase();
    const now = new Date().toISOString();
    const result = db.prepare(`
      UPDATE signals
      SET status = 'under_appeal',
          appealReason = ?,
          appealedAt = ?,
          updatedAt = ?
      WHERE id = ? AND status = 'rejected' AND appealedAt IS NULL
    `).run(appealReason, now, now, id);

    if (result.changes === 0) return null;
    return this.findById(id);
  }

  static anonymizeContact(id: string): boolean {
    const db = getDatabase();
    const now = new Date().toISOString();
    const result = db.prepare(`
      UPDATE signals
      SET reporterEmail = NULL,
          reporterPhone = NULL,
          anonymizedAt = ?,
          updatedAt = ?
      WHERE id = ?
    `).run(now, now, id);
    return result.changes > 0;
  }

  static anonymizeExpired(): number {
    const db = getDatabase();
    const now = new Date().toISOString();
    const result = db.prepare(`
      UPDATE signals
      SET reporterEmail = NULL,
          reporterPhone = NULL,
          anonymizedAt = ?,
          updatedAt = ?
      WHERE retentionExpiresAt <= ?
        AND (reporterEmail IS NOT NULL OR reporterPhone IS NOT NULL)
    `).run(now, now, now);
    return result.changes;
  }

  static getStatistics() {
    const db = getDatabase();
    const totalValidated = (
      db.prepare("SELECT COUNT(*) as count FROM signals WHERE status = 'validated'").get() as any
    ).count;

    const totalSubmitted = (db.prepare('SELECT COUNT(*) as count FROM signals').get() as any).count;
    const totalPending = (
      db.prepare("SELECT COUNT(*) as count FROM signals WHERE status = 'pending'").get() as any
    ).count;
    const totalAppeals = (
      db.prepare("SELECT COUNT(*) as count FROM signals WHERE status = 'under_appeal'").get() as any
    ).count;

    const byType = db.prepare(`
      SELECT incidentType, COUNT(*) as count
      FROM signals
      WHERE status = 'validated'
      GROUP BY incidentType
      ORDER BY count DESC
    `).all() as { incidentType: string; count: number }[];

    const byEventType = db.prepare(`
      SELECT eventType, COUNT(*) as count
      FROM signals
      WHERE status = 'validated' AND eventType != 'none'
      GROUP BY eventType
      ORDER BY count DESC
    `).all() as { eventType: EventType; count: number }[];

    const byDepartment = db.prepare(`
      SELECT COALESCE(department, 'Non renseigné') as department, COUNT(*) as count
      FROM signals
      WHERE status = 'validated'
      GROUP BY department
      ORDER BY count DESC
      LIMIT 20
    `).all() as { department: string; count: number }[];

    const byCity = db.prepare(`
      SELECT COALESCE(city, 'Non renseigné') as city, COUNT(*) as count
      FROM signals
      WHERE status = 'validated'
      GROUP BY city
      ORDER BY count DESC
      LIMIT 15
    `).all() as { city: string; count: number }[];

    const monthlyTimeline = db.prepare(`
      SELECT SUBSTR(incidentDate, 1, 7) as month, COUNT(*) as count
      FROM signals
      WHERE status = 'validated'
      GROUP BY month
      ORDER BY month DESC
      LIMIT 12
    `).all() as { month: string; count: number }[];

    return {
      totalValidated,
      totalSubmitted,
      totalPending,
      totalAppeals,
      byType,
      byEventType,
      byDepartment,
      byCity,
      monthlyTimeline: monthlyTimeline.reverse(),
    };
  }

  private static mapRow(row: any): SignalRecord {
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      incidentDate: row.incidentDate,
      incidentType: row.incidentType as IncidentType,
      eventType: row.eventType as EventType,
      eventName: row.eventName,
      victimAgeGroup: row.victimAgeGroup as VictimAgeGroup,
      latitude: row.latitude,
      longitude: row.longitude,
      locationAccuracyMeters: row.locationAccuracyMeters,
      address: row.address,
      city: row.city,
      postalCode: row.postalCode,
      department: row.department,
      evidence: JSON.parse(row.evidence || '[]'),
      status: row.status as SignalStatus,
      rejectionReason: row.rejectionReason,
      appealReason: row.appealReason,
      appealedAt: row.appealedAt,
      validationScore: row.validationScore,
      validatedBy: row.validatedBy,
      validatedAt: row.validatedAt,
      trustPointsAwarded: row.trustPointsAwarded,
      reporterEmail: row.reporterEmail,
      reporterPhone: row.reporterPhone,
      forgetToken: row.forgetToken,
      anonymizedAt: row.anonymizedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      retentionExpiresAt: row.retentionExpiresAt,
    };
  }

  static sanitizePublic(signal: SignalRecord): PublicSignalRecord {
    const { victimAgeGroup: _victimAgeGroup, ...publicSignal } = signal;
    return {
      ...publicSignal,
      reporterEmail: null,
      reporterPhone: null,
      forgetToken: '', // Redacted
      validatedBy: null, // Redacted
    };
  }
}
