import crypto from 'crypto';
import { getDatabase } from '../config';

export interface UserRecord {
  id: string;
  forgetToken: string;
  email: string | null;
  phone: string | null;
  createdAt: string;
}

export class UserModel {
  static create(email?: string, phone?: string): UserRecord {
    const db = getDatabase();
    const id = 'usr_' + crypto.randomBytes(8).toString('hex');
    const forgetToken = 'fgt_' + crypto.randomBytes(16).toString('hex');
    const createdAt = new Date().toISOString();

    db.prepare(`
      INSERT INTO users (id, forgetToken, email, phone, createdAt)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, forgetToken, email || null, phone || null, createdAt);

    return {
      id,
      forgetToken,
      email: email || null,
      phone: phone || null,
      createdAt,
    };
  }

  static findByForgetToken(forgetToken: string): UserRecord | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM users WHERE forgetToken = ?').get(forgetToken) as any;
    if (!row) return null;
    return {
      id: row.id,
      forgetToken: row.forgetToken,
      email: row.email,
      phone: row.phone,
      createdAt: row.createdAt,
    };
  }

  static deleteByForgetToken(forgetToken: string): boolean {
    const db = getDatabase();
    const result = db.prepare('DELETE FROM users WHERE forgetToken = ?').run(forgetToken);
    return result.changes > 0;
  }
}
