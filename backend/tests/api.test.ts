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

    // Legacy scenarios below use a single reviewer; two-person review has its own suite.
    config.moderation.requiredApprovals = 1;

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

  describe('Robust moderation', () => {
    const modPassword = 'moderator-password-123';
    const secondPassword = 'second-moderator-pass-123';
    let modToken: string;
    let secondToken: string;
    let modId: string;

    const createSignal = async (title: string): Promise<string> => {
      const res = await request(app)
        .post('/api/signals')
        .set('x-bypass-ratelimit', 'true')
        .send({
          title,
          description: 'Description suffisamment longue pour la modération.',
          incidentDate: '2026-06-10T11:00:00.000Z',
          incidentType: 'violence_physique',
          latitude: 48.8566,
          longitude: 2.3522,
          city: 'Paris',
          department: '75',
          gdprConsent: true,
        });
      expect(res.status).toBe(201);
      return res.body.signalId;
    };

    const login = async (email: string, password: string) =>
      request(app).post('/api/auth/login').send({ email, password });

    beforeAll(async () => {
      config.moderation.requiredApprovals = 2;
      const first = await request(app)
        .post('/api/admin/validators')
        .set('Authorization', 'Bearer ' + adminToken)
        .send({ email: 'mod1@akab.local', password: modPassword, name: 'Modérateur 1' });
      expect(first.status).toBe(201);
      modId = first.body.validator.id;
      const second = await request(app)
        .post('/api/admin/validators')
        .set('Authorization', 'Bearer ' + adminToken)
        .send({ email: 'mod2@akab.local', password: secondPassword, name: 'Modérateur 2' });
      expect(second.status).toBe(201);
      modToken = (await login('mod1@akab.local', modPassword)).body.token;
      secondToken = (await login('mod2@akab.local', secondPassword)).body.token;
    });

    afterAll(() => {
      config.moderation.requiredApprovals = 1;
    });

    it('rejects weak passwords and invalid emails for new accounts', async () => {
      const weak = await request(app)
        .post('/api/admin/validators')
        .set('Authorization', 'Bearer ' + adminToken)
        .send({ email: 'weak@akab.local', password: 'short', name: 'Faible' });
      expect(weak.status).toBe(400);
      const badEmail = await request(app)
        .post('/api/admin/validators')
        .set('Authorization', 'Bearer ' + adminToken)
        .send({ email: 'not-an-email', password: 'long-enough-password', name: 'X' });
      expect(badEmail.status).toBe(400);
    });

    it('publishes only after two distinct moderators approve', async () => {
      const id = await createSignal('Double validation');

      const first = await request(app)
        .patch(`/api/admin/signals/${id}/validate`)
        .set('Authorization', 'Bearer ' + modToken);
      expect(first.status).toBe(200);
      expect(first.body.finalized).toBe(false);
      expect(first.body.signal.status).toBe('pending');

      const repeat = await request(app)
        .patch(`/api/admin/signals/${id}/validate`)
        .set('Authorization', 'Bearer ' + modToken);
      expect(repeat.status).toBe(409);

      const listed = await request(app)
        .get('/api/admin/signals?status=pending')
        .set('Authorization', 'Bearer ' + modToken);
      const entry = listed.body.signals.find((signal: any) => signal.id === id);
      expect(entry.moderation).toMatchObject({ approvals: 1, required: 2, approvedByMe: true });

      const second = await request(app)
        .patch(`/api/admin/signals/${id}/validate`)
        .set('Authorization', 'Bearer ' + secondToken);
      expect(second.status).toBe(200);
      expect(second.body.finalized).toBe(true);
      expect(second.body.signal.status).toBe('validated');

      const again = await request(app)
        .patch(`/api/admin/signals/${id}/validate`)
        .set('Authorization', 'Bearer ' + adminToken);
      expect(again.status).toBe(409);
    });

    it('lets only administrators force publication and records it in the audit log', async () => {
      const id = await createSignal('Publication forcée');

      const denied = await request(app)
        .patch(`/api/admin/signals/${id}/validate`)
        .set('Authorization', 'Bearer ' + modToken)
        .send({ force: true });
      expect(denied.status).toBe(403);

      const forced = await request(app)
        .patch(`/api/admin/signals/${id}/validate`)
        .set('Authorization', 'Bearer ' + adminToken)
        .send({ force: true });
      expect(forced.status).toBe(200);
      expect(forced.body.signal.status).toBe('validated');

      const audit = await request(app)
        .get('/api/admin/audit?action=signal_force_published')
        .set('Authorization', 'Bearer ' + adminToken);
      expect(audit.status).toBe(200);
      expect(audit.body.entries.some((entry: any) => entry.targetId === id)).toBe(true);

      const forbidden = await request(app).get('/api/admin/audit').set('Authorization', 'Bearer ' + modToken);
      expect(forbidden.status).toBe(403);
    });

    it('keeps the original rejector away from the appeal and makes a second appeal impossible', async () => {
      const id = await createSignal('Recours encadré');

      const rejected = await request(app)
        .patch(`/api/admin/signals/${id}/reject`)
        .set('Authorization', 'Bearer ' + modToken)
        .send({ reason: 'Preuves insuffisantes pour publier.' });
      expect(rejected.status).toBe(200);

      const appeal = await request(app)
        .post(`/api/signals/${id}/appeal`)
        .set('x-bypass-ratelimit', 'true')
        .send({ reason: 'Un témoin supplémentaire confirme les faits décrits.' });
      expect(appeal.status).toBe(200);

      const sameModerator = await request(app)
        .patch(`/api/admin/signals/${id}/validate`)
        .set('Authorization', 'Bearer ' + modToken);
      expect(sameModerator.status).toBe(403);

      const final = await request(app)
        .patch(`/api/admin/signals/${id}/reject`)
        .set('Authorization', 'Bearer ' + secondToken)
        .send({ reason: 'Recours examiné, preuves toujours insuffisantes.' });
      expect(final.status).toBe(200);

      const secondAppeal = await request(app)
        .post(`/api/signals/${id}/appeal`)
        .set('x-bypass-ratelimit', 'true')
        .send({ reason: 'Nouvelle tentative de recours après décision.' });
      expect(secondAppeal.status).toBe(409);
    });

    it('locks an account after repeated failures and audits it', async () => {
      for (let attempt = 0; attempt < config.moderation.maxFailedLogins; attempt += 1) {
        const res = await login('mod2@akab.local', 'wrong-password-value');
        expect(res.status).toBe(401);
      }
      const blocked = await login('mod2@akab.local', secondPassword);
      expect(blocked.status).toBe(429);

      getDatabase().prepare('UPDATE validators SET lockedUntil = NULL WHERE email = ?').run('mod2@akab.local');
      const ok = await login('mod2@akab.local', secondPassword);
      expect(ok.status).toBe(200);

      const audit = await request(app)
        .get('/api/admin/audit?action=account_locked')
        .set('Authorization', 'Bearer ' + adminToken);
      expect(audit.body.total).toBeGreaterThan(0);
    });

    it('manages accounts safely: deactivation, password reset and last-admin protection', async () => {
      const me = await request(app).get('/api/auth/me').set('Authorization', 'Bearer ' + adminToken);
      const adminId = me.body.user.id;

      const selfDemote = await request(app)
        .patch(`/api/admin/validators/${adminId}`)
        .set('Authorization', 'Bearer ' + adminToken)
        .send({ role: 'moderator' });
      expect(selfDemote.status).toBe(400);

      const notAdmin = await request(app)
        .patch(`/api/admin/validators/${modId}`)
        .set('Authorization', 'Bearer ' + modToken)
        .send({ isActive: false });
      expect(notAdmin.status).toBe(403);

      const reset = await request(app)
        .patch(`/api/admin/validators/${modId}`)
        .set('Authorization', 'Bearer ' + adminToken)
        .send({ password: 'brand-new-password-456' });
      expect(reset.status).toBe(200);
      expect(reset.body.validator.passwordHash).toBeUndefined();

      const staleSession = await request(app).get('/api/auth/me').set('Authorization', 'Bearer ' + modToken);
      expect(staleSession.status).toBe(401);
      expect((await login('mod1@akab.local', 'brand-new-password-456')).status).toBe(200);

      const deactivate = await request(app)
        .patch(`/api/admin/validators/${modId}`)
        .set('Authorization', 'Bearer ' + adminToken)
        .send({ isActive: false });
      expect(deactivate.status).toBe(200);
      expect((await login('mod1@akab.local', 'brand-new-password-456')).status).toBe(403);
    });
  });
});
