import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import Database from 'better-sqlite3';
import { app } from '../server';
import { setTestDatabase, closeDatabase, config, getDatabase, initDatabase, validateProductionSecrets } from '../config';
import { SignalModel } from '../models/Signal';
import { GdprService } from '../services/gdpr';
import { IpfsService } from '../services/ipfs';

describe('AKAB Backend API Test Suite', () => {
  let adminToken: string;

  beforeAll(async () => {
    // Setup in-memory test database
    const testDb = new Database(':memory:');
    setTestDatabase(testDb);

    // Login as admin
    const loginRes = await request(app).post('/api/auth/login').send({
      email: config.adminDefault.email,
      password: config.adminDefault.password,
    });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body.token).toBeDefined();
    adminToken = loginRes.body.token;
  });

  afterAll(() => {
    closeDatabase();
  });

  it('requires strong non-demo secrets in production and permits local development values', () => {
    expect(() => validateProductionSecrets('production', undefined, undefined)).toThrow(/JWT_SECRET/);
    expect(() => validateProductionSecrets('production', 'a'.repeat(32), undefined)).toThrow(
      /ADMIN_DEFAULT_PASSWORD/
    );
    expect(() =>
      validateProductionSecrets('production', 'a'.repeat(32), 'AdminSecurePassword123!')
    ).toThrow(/démonstration/);
    expect(() => validateProductionSecrets('production', 'a'.repeat(32), 'a unique password 123')).not.toThrow();
    expect(() => validateProductionSecrets('development', undefined, undefined)).not.toThrow();
  });

  it('adds report fields to an existing SQLite database without losing existing columns', () => {
    const legacyDb = new Database(':memory:');
    legacyDb.exec(`
      CREATE TABLE signals (
        id TEXT PRIMARY KEY,
        status TEXT,
        city TEXT,
        department TEXT,
        incidentDate TEXT,
        retentionExpiresAt TEXT
      );
      INSERT INTO signals (id, status, city, department, incidentDate, retentionExpiresAt)
      VALUES ('legacy-signal', 'validated', 'Paris', '75', '2026-01-01T10:00:00.000Z', '2026-02-01T10:00:00.000Z');
    `);

    initDatabase(legacyDb);
    initDatabase(legacyDb);

    const columns = new Set(
      (legacyDb.prepare('PRAGMA table_info(signals)').all() as Array<{ name: string }>).map(
        (column) => column.name
      )
    );
    expect(columns.has('incidentDate')).toBe(true);
    expect(columns.has('eventType')).toBe(true);
    expect(columns.has('eventName')).toBe(true);
    expect(columns.has('victimAgeGroup')).toBe(true);
    expect(columns.has('locationAccuracyMeters')).toBe(true);
    expect(legacyDb.prepare('SELECT city FROM signals WHERE id = ?').get('legacy-signal')).toEqual({
      city: 'Paris',
    });
    expect(
      legacyDb
        .prepare('SELECT eventType, eventName, victimAgeGroup, locationAccuracyMeters FROM signals WHERE id = ?')
        .get('legacy-signal')
    ).toEqual({
      eventType: 'none',
      eventName: null,
      victimAgeGroup: 'unknown',
      locationAccuracyMeters: null,
    });
    legacyDb.close();
  });

  it('Healthcheck returns ok', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.platform).toBe('AKAB');
  });

  it('Returns GDPR privacy policy', async () => {
    const res = await request(app).get('/api/gdpr/policy');
    expect(res.status).toBe(200);
    expect(res.body.policy.platform).toBeDefined();
    expect(res.body.policy.framework).toContain('RGPD');
  });

  it('Uploads proof directly to IPFS service with EXIF sanitization', async () => {
    // Create dummy JPEG buffer with SOI and APP1 marker
    const dummyJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x04, 0x00, 0x00, 0xff, 0xd9]);

    const res = await request(app)
      .post('/api/signals/upload-proof')
      .set('x-bypass-ratelimit', 'true')
      .attach('file', dummyJpeg, 'test_proof.jpg')
      .field('anonymized', 'true');

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.evidence.cid).toMatch(/^Qm/);
    expect(res.body.evidence.anonymized).toBe(true);
  });

  it('Creates a new signal report with validation and returns forgetToken', async () => {
    const signalData = {
      title: 'Tir de LBD injustifié en manifestation',
      description:
        'Manifestant touché à la jambe par un tir tendu alors qu’il reculait calmement.',
      incidentDate: '2026-05-01T14:30:00.000Z',
      incidentType: 'tir_lbd',
      eventType: 'demonstration',
      eventName: 'Manifestation fictive pour le test',
      victimAgeGroup: 'minor',
      latitude: 48.8566123,
      longitude: 2.3522456,
      locationAccuracyMeters: 4.7,
      address: 'Place de la République',
      city: 'Paris',
      postalCode: '75011',
      department: '75',
      reporterEmail: 'citoyen@example.org',
      reporterPhone: '+33612345678',
      gdprConsent: true,
      evidence: [
        {
          id: 'ev_123',
          cid: 'QmSampleTestCid1234567890abcdefghijklmnopqrst',
          originalName: 'photo_lbd.jpg',
          mimeType: 'image/jpeg',
          size: 1024,
          url: 'ipfs://QmSampleTestCid1234567890abcdefghijklmnopqrst',
          anonymized: true,
          isVideo: false,
        },
      ],
    };

    const res = await request(app)
      .post('/api/signals')
      .set('x-bypass-ratelimit', 'true')
      .send(signalData);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.signalId).toMatch(/^sig_/);
    expect(res.body.forgetToken).toMatch(/^fgt_/);
    expect(res.body.status).toBe('pending');
    expect(SignalModel.findById(res.body.signalId)).toMatchObject({
      eventType: 'demonstration',
      eventName: 'Manifestation fictive pour le test',
      victimAgeGroup: 'minor',
      latitude: 48.8566123,
      longitude: 2.3522456,
      locationAccuracyMeters: 4.7,
    });
  });

  it('Does not expose pending signals in public GET /api/signals', async () => {
    const res = await request(app).get('/api/signals');
    expect(res.status).toBe(200);
    expect(res.body.signals).toHaveLength(0);
  });

  it('Admin can view pending signals and validate one (+10 trust points)', async () => {
    // 1. List pending signals
    const listRes = await request(app)
      .get('/api/admin/signals?status=pending')
      .set('Authorization', 'Bearer ' + adminToken);

    expect(listRes.status).toBe(200);
    expect(listRes.body.signals.length).toBeGreaterThan(0);
    const signalToValidate = listRes.body.signals[0];
    expect(signalToValidate.victimAgeGroup).toBe('minor');
    expect(signalToValidate.latitude).toBe(48.8566123);
    expect(signalToValidate.locationAccuracyMeters).toBe(4.7);

    // 2. Validate signal
    const valRes = await request(app)
      .patch(`/api/admin/signals/${signalToValidate.id}/validate`)
      .set('Authorization', 'Bearer ' + adminToken);

    expect(valRes.status).toBe(200);
    expect(valRes.body.success).toBe(true);
    expect(valRes.body.signal.status).toBe('validated');
    expect(valRes.body.pointsAwarded).toBeGreaterThan(0);

    // 3. Check signal is now visible in public listing with sanitized contact info
    const pubRes = await request(app).get('/api/signals');
    expect(pubRes.status).toBe(200);
    expect(pubRes.body.signals).toHaveLength(1);
    expect(pubRes.body.signals[0].id).toBe(signalToValidate.id);
    expect(pubRes.body.signals[0].reporterEmail).toBeNull();
    expect(pubRes.body.signals[0].reporterPhone).toBeNull();
    expect(pubRes.body.signals[0].forgetToken).toBe('');
    expect(pubRes.body.signals[0].eventType).toBe('demonstration');
    expect(pubRes.body.signals[0].eventName).toBe('Manifestation fictive pour le test');
    expect(pubRes.body.signals[0].latitude).toBe(48.8566123);
    expect(pubRes.body.signals[0].longitude).toBe(2.3522456);
    expect(pubRes.body.signals[0]).not.toHaveProperty('victimAgeGroup');

    const exportRes = await request(app).get('/api/export/signals?format=geojson');
    const exportedFeature = exportRes.body.features.find(
      (feature: { properties: { id: string } }) => feature.properties.id === signalToValidate.id
    );
    expect(exportedFeature.properties.eventType).toBe('demonstration');
    expect(exportedFeature.geometry.coordinates).toEqual([2.3522456, 48.8566123]);
    expect(exportedFeature.properties).not.toHaveProperty('victimAgeGroup');
    const statsRes = await request(app).get('/api/export/statistics');
    expect(statsRes.body.stats.byEventType).toContainEqual({ eventType: 'demonstration', count: 1 });
  });

  it('Admin can reject a signal and user can appeal the rejection', async () => {
    // 1. Create a second signal
    const createRes = await request(app)
      .post('/api/signals')
      .set('x-bypass-ratelimit', 'true')
      .send({
        title: 'Contrôle avec injures',
        description: 'Propos dégradants tenus lors d’un contrôle d’identité.',
        incidentDate: '2026-06-10T11:00:00.000Z',
        incidentType: 'violence_verbale',
        latitude: 45.764,
        longitude: 4.8357,
        city: 'Lyon',
        department: '69',
        gdprConsent: true,
      });

    const signalId = createRes.body.signalId;

    // 2. Reject the signal with reason
    const rejectRes = await request(app)
      .patch(`/api/admin/signals/${signalId}/reject`)
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ reason: 'Preuves insuffisantes ou vidéo non exploitable.' });

    expect(rejectRes.status).toBe(200);
    expect(rejectRes.body.signal.status).toBe('rejected');

    // 3. Submit appeal by citizen
    const appealRes = await request(app)
      .post(`/api/signals/${signalId}/appeal`)
      .set('x-bypass-ratelimit', 'true')
      .send({
        reason: 'J’ai ajouté un témoignage écrit d’un passant avec pièce jointe.',
      });

    expect(appealRes.status).toBe(200);
    expect(appealRes.body.signal.status).toBe('under_appeal');
  });

  it('Right to be Forgotten: immediate erasure via forget token', async () => {
    // Create report with contact info
    const createRes = await request(app)
      .post('/api/signals')
      .set('x-bypass-ratelimit', 'true')
      .send({
        title: 'Interpellation violente gare du Nord',
        description: 'Usage disproportionné de la force lors de l’interpellation.',
        incidentDate: '2026-07-14T18:00:00.000Z',
        incidentType: 'interpellation_violente',
        latitude: 48.8809,
        longitude: 2.3553,
        city: 'Paris',
        reporterEmail: 'perso@confidentiel.fr',
        reporterPhone: '+33600112233',
        gdprConsent: true,
      });

    const { signalId, forgetToken } = createRes.body;

    // Verify contact info is present internally
    const beforeForget = SignalModel.findById(signalId);
    expect(beforeForget?.reporterEmail).toBe('perso@confidentiel.fr');

    // Execute Right to be Forgotten
    const forgetRes = await request(app).post('/api/signals/forget').send({ forgetToken });

    expect(forgetRes.status).toBe(200);
    expect(forgetRes.body.success).toBe(true);

    // Verify contact info is now permanently erased from database
    const afterForget = SignalModel.findById(signalId);
    expect(afterForget?.reporterEmail).toBeNull();
    expect(afterForget?.reporterPhone).toBeNull();
    expect(afterForget?.anonymizedAt).not.toBeNull();
  });

  it('GDPR retention cleanup purges contacts older than 30 days', () => {
    // Create an artificial signal with past retentionExpiresAt
    const signal = SignalModel.create({
      title: 'Signalement Ancien',
      description: 'Incident ancien pour tester le nettoyage automatique des 30 jours.',
      incidentDate: '2026-01-01T12:00:00.000Z',
      incidentType: 'autre',
      latitude: 43.2965,
      longitude: 5.3698,
      reporterEmail: 'old@example.com',
      reporterPhone: '0102030405',
    });

    // Manually force retention date to the past in database
    const db = getDatabase();
    db.prepare("UPDATE signals SET retentionExpiresAt = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(
      signal.id
    );

    // Run cleanup
    const cleanupResult = GdprService.cleanExpiredData();
    expect(cleanupResult.cleanedCount).toBeGreaterThanOrEqual(1);

    const checkedSignal = SignalModel.findById(signal.id);
    expect(checkedSignal?.reporterEmail).toBeNull();
    expect(checkedSignal?.reporterPhone).toBeNull();
    expect(checkedSignal?.anonymizedAt).not.toBeNull();
  });

  it('Public export API returns JSON, CSV, and GeoJSON', async () => {
    // JSON export
    const jsonRes = await request(app).get('/api/export/signals?format=json');
    expect(jsonRes.status).toBe(200);
    expect(jsonRes.body.metadata).toBeDefined();
    expect(Array.isArray(jsonRes.body.data)).toBe(true);

    // CSV export
    const csvRes = await request(app).get('/api/export/signals?format=csv');
    expect(csvRes.status).toBe(200);
    expect(csvRes.headers['content-type']).toContain('text/csv');
    expect(csvRes.text).toContain('incidentType');

    // GeoJSON export
    const geojsonRes = await request(app).get('/api/export/signals?format=geojson');
    expect(geojsonRes.status).toBe(200);
    expect(geojsonRes.body.type).toBe('FeatureCollection');
    expect(Array.isArray(geojsonRes.body.features)).toBe(true);
  });

  it('Statistics API calculates aggregates properly', async () => {
    const statsRes = await request(app).get('/api/export/statistics');
    expect(statsRes.status).toBe(200);
    expect(statsRes.body.success).toBe(true);
    expect(statsRes.body.stats.totalValidated).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(statsRes.body.stats.byType)).toBe(true);
  });

  it('Admin validators endpoint shows trust points leaderboard', async () => {
    const res = await request(app)
      .get('/api/admin/validators')
      .set('Authorization', 'Bearer ' + adminToken);

    expect(res.status).toBe(200);
    expect(res.body.validators.length).toBeGreaterThan(0);
    expect(res.body.validators[0].trustPoints).toBeGreaterThan(0);
    expect(res.body.validators[0].passwordHash).toBeUndefined(); // Password hash hidden
  });
});
