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
    };
  }
}
