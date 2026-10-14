import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { getDatabase } from '../config';

export type ValidatorRole = 'admin' | 'moderator';

export interface AdminValidatorRecord {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  role: ValidatorRole;
  trustPoints: number;
  validationsCount: number;
  rejectionsCount: number;
  isActive: boolean;
  createdAt: string;
  failedLoginAttempts: number;
  lockedUntil: string | null;
  lastLoginAt: string | null;
  tokenVersion: number;
}

export class AdminValidatorModel {
  static create(input: {
    email: string;
    password: string;
    name: string;
    role?: ValidatorRole;
    trustPoints?: number;
  }): AdminValidatorRecord {
    const db = getDatabase();
    const id = 'val_' + crypto.randomBytes(8).toString('hex');
    const salt = bcrypt.genSaltSync(10);
    const passwordHash = bcrypt.hashSync(input.password, salt);
    const role = input.role || 'moderator';
    const trustPoints = input.trustPoints !== undefined ? input.trustPoints : 100;
    const createdAt = new Date().toISOString();

    db.prepare(`
      INSERT INTO validators (id, email, passwordHash, name, role, trustPoints, validationsCount, rejectionsCount, isActive, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, 0, 0, 1, ?)
    `).run(id, input.email.toLowerCase(), passwordHash, input.name, role, trustPoints, createdAt);

    return this.findById(id)!;
  }

  static findById(id: string): AdminValidatorRecord | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM validators WHERE id = ?').get(id) as any;
    if (!row) return null;
    return this.mapRow(row);
  }

  static findByEmail(email: string): AdminValidatorRecord | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM validators WHERE LOWER(email) = LOWER(?)').get(email) as any;
    if (!row) return null;
    return this.mapRow(row);
  }

  static listAll(): Omit<AdminValidatorRecord, 'passwordHash'>[] {
    const db = getDatabase();
    const rows = db.prepare('SELECT * FROM validators ORDER BY trustPoints DESC').all() as any[];
    return rows.map((r) => {
      const v = this.mapRow(r);
      const { passwordHash, ...rest } = v;
      return rest;
    });
  }

  static incrementValidations(id: string, pointsAwarded = 10): void {
    const db = getDatabase();
    db.prepare(`
      UPDATE validators
      SET validationsCount = validationsCount + 1,
          trustPoints = trustPoints + ?
      WHERE id = ?
    `).run(pointsAwarded, id);
  }

  static incrementRejections(id: string): void {
    const db = getDatabase();
    db.prepare(`
      UPDATE validators
      SET rejectionsCount = rejectionsCount + 1
      WHERE id = ?
    `).run(id);
  }

  static update(
    id: string,
    changes: { name?: string; role?: ValidatorRole; isActive?: boolean; password?: string }
  ): AdminValidatorRecord | null {
    const db = getDatabase();
    const current = this.findById(id);
    if (!current) return null;

    const name = changes.name ?? current.name;
    const role = changes.role ?? current.role;
    const isActive = changes.isActive ?? current.isActive;
    const sessionAffected = role !== current.role || isActive !== current.isActive || !!changes.password;
    db.prepare(
      'UPDATE validators SET name = ?, role = ?, isActive = ?, tokenVersion = tokenVersion + ? WHERE id = ?'
    ).run(name, role, isActive ? 1 : 0, sessionAffected ? 1 : 0, id);

    if (changes.password) {
      db.prepare(
        `UPDATE validators
         SET passwordHash = ?, failedLoginAttempts = 0, lockedUntil = NULL
         WHERE id = ?`
      ).run(bcrypt.hashSync(changes.password, bcrypt.genSaltSync(10)), id);
    }
    return this.findById(id);
  }

  static countActiveAdmins(): number {
    const row = getDatabase()
      .prepare(`SELECT COUNT(*) AS count FROM validators WHERE role = 'admin' AND isActive = 1`)
      .get() as { count: number };
    return row.count;
  }

  static isLocked(validator: AdminValidatorRecord): boolean {
    return !!validator.lockedUntil && new Date(validator.lockedUntil).getTime() > Date.now();
  }

  static recordFailedLogin(id: string, maxAttempts: number, lockoutMinutes: number): boolean {
    const db = getDatabase();
    const row = db.prepare('SELECT failedLoginAttempts FROM validators WHERE id = ?').get(id) as any;
    const attempts = (row?.failedLoginAttempts ?? 0) + 1;
    if (attempts >= maxAttempts) {
      db.prepare('UPDATE validators SET failedLoginAttempts = 0, lockedUntil = ? WHERE id = ?').run(
        new Date(Date.now() + lockoutMinutes * 60_000).toISOString(),
        id
      );
      return true;
    }
    db.prepare('UPDATE validators SET failedLoginAttempts = ? WHERE id = ?').run(attempts, id);
    return false;
  }

  static recordSuccessfulLogin(id: string): void {
    getDatabase()
      .prepare('UPDATE validators SET failedLoginAttempts = 0, lockedUntil = NULL, lastLoginAt = ? WHERE id = ?')
      .run(new Date().toISOString(), id);
  }

  static verifyPassword(plain: string, hash: string): boolean {
    return bcrypt.compareSync(plain, hash);
  }

  private static mapRow(row: any): AdminValidatorRecord {
    return {
      id: row.id,
      email: row.email,
      passwordHash: row.passwordHash,
      name: row.name,
      role: row.role as ValidatorRole,
      trustPoints: row.trustPoints,
      validationsCount: row.validationsCount,
      rejectionsCount: row.rejectionsCount,
      isActive: Boolean(row.isActive),
      createdAt: row.createdAt,
      failedLoginAttempts: row.failedLoginAttempts ?? 0,
      lockedUntil: row.lockedUntil ?? null,
      lastLoginAt: row.lastLoginAt ?? null,
      tokenVersion: row.tokenVersion ?? 0,
    };
  }
}
