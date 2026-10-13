import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '4000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  jwtSecret: process.env.JWT_SECRET || 'akab_default_secret_dev_key_32_characters_long',
  corsOrigin: process.env.CORS_ORIGIN || '*',
  databaseUrl: process.env.DATABASE_URL || path.join(__dirname, '../../data/akab.sqlite'),
  ipfsApiUrl: process.env.IPFS_API_URL || 'http://localhost:5001',
  ipfsGateway: process.env.IPFS_GATEWAY || 'https://ipfs.io/ipfs/',
  ipfsFallbackLocal: process.env.IPFS_FALLBACK_LOCAL !== 'false',
  ipfsLocalStorageDir: path.join(__dirname, '../../data/ipfs'),
  uploadDir: path.join(__dirname, '../../data/uploads'),
  gdprRetentionDays: parseInt(process.env.GDPR_RETENTION_DAYS || '30', 10),
  gdprCleanupIntervalHours: parseInt(process.env.GDPR_CLEANUP_INTERVAL_HOURS || '24', 10),
  adminDefault: {
    email: process.env.ADMIN_DEFAULT_EMAIL || 'admin@akab.local',
    password: process.env.ADMIN_DEFAULT_PASSWORD || 'AdminSecurePassword123!',
    name: process.env.ADMIN_DEFAULT_NAME || 'Admin AKAB',
  },
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10), // 15 mins
    maxSubmissions: parseInt(process.env.RATE_LIMIT_MAX_SUBMISSIONS || '20', 10),
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '300', 10),
  },
};

let dbInstance: Database.Database | null = null;

export function getDatabase(): Database.Database {
  if (!dbInstance) {
    if (config.databaseUrl !== ':memory:') {
      const dir = path.dirname(config.databaseUrl);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    dbInstance = new Database(config.databaseUrl);
    dbInstance.pragma('journal_mode = WAL');
    initDatabase(dbInstance);
  }
  return dbInstance;
}

export function setTestDatabase(db: Database.Database) {
  dbInstance = db;
  initDatabase(dbInstance);
}

export function closeDatabase() {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

export function initDatabase(db: Database.Database) {
  // Ensure storage directories
  if (!fs.existsSync(config.uploadDir)) {
    fs.mkdirSync(config.uploadDir, { recursive: true });
  }
  if (!fs.existsSync(config.ipfsLocalStorageDir)) {
    fs.mkdirSync(config.ipfsLocalStorageDir, { recursive: true });
  }

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS signals (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      incidentDate TEXT NOT NULL,
      incidentType TEXT NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      address TEXT,
      city TEXT,
      postalCode TEXT,
      department TEXT,
      evidence TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'pending',
      rejectionReason TEXT,
      appealReason TEXT,
      appealedAt TEXT,
      validationScore INTEGER NOT NULL DEFAULT 0,
      validatedBy TEXT,
      validatedAt TEXT,
      trustPointsAwarded INTEGER NOT NULL DEFAULT 0,
      reporterEmail TEXT,
      reporterPhone TEXT,
      forgetToken TEXT NOT NULL,
      anonymizedAt TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      retentionExpiresAt TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_signals_status ON signals(status);
    CREATE INDEX IF NOT EXISTS idx_signals_city ON signals(city);
    CREATE INDEX IF NOT EXISTS idx_signals_department ON signals(department);
    CREATE INDEX IF NOT EXISTS idx_signals_incidentDate ON signals(incidentDate);
    CREATE INDEX IF NOT EXISTS idx_signals_retention ON signals(retentionExpiresAt);

    CREATE TABLE IF NOT EXISTS validators (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      passwordHash TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'moderator',
      trustPoints INTEGER NOT NULL DEFAULT 100,
      validationsCount INTEGER NOT NULL DEFAULT 0,
      rejectionsCount INTEGER NOT NULL DEFAULT 0,
      isActive INTEGER NOT NULL DEFAULT 1,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      forgetToken TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      createdAt TEXT NOT NULL
    );
  `);

  // Seed default admin if not exists
  const existingAdmin = db.prepare('SELECT id FROM validators WHERE email = ?').get(config.adminDefault.email);
  if (!existingAdmin) {
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(config.adminDefault.password, salt);
    db.prepare(`
      INSERT INTO validators (id, email, passwordHash, name, role, trustPoints, validationsCount, rejectionsCount, isActive, createdAt)
      VALUES (?, ?, ?, ?, 'admin', 500, 0, 0, 1, ?)
    `).run('admin-root-01', config.adminDefault.email, hash, config.adminDefault.name, new Date().toISOString());
  }
}
