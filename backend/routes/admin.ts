import { Router, Request, Response } from 'express';
import { SignalModel } from '../models/Signal';
import { AuditLog } from '../models/AuditLog';
import { ModerationVoteModel } from '../models/ModerationVote';
import { config } from '../config';
import { StorageService, StorageUnavailableError } from '../services/storage';
import { AdminValidatorModel } from '../models/AdminValidator';
import { authenticate, requireRole } from '../middleware/auth';
import { runGdprCleanup } from '../jobs/cleanup';
import { rateLimitAuth } from '../middleware/rateLimit';

const router = Router();

// Rate limit and protect all admin endpoints
router.use(rateLimitAuth);
router.use(authenticate);

/**
 * GET /api/admin/signals
 * List signals for admin review, with optional status and text search filters.
 */
router.get('/signals', (req: Request, res: Response): void => {
  try {
    const { status, search, limit, offset } = req.query;

    const result = SignalModel.findAllForAdmin({
      status: typeof status === 'string' ? status : undefined,
      search: typeof search === 'string' ? search : undefined,
      limit: limit ? parseInt(String(limit), 10) : undefined,
      offset: offset ? parseInt(String(offset), 10) : undefined,
    });

    const required = config.moderation.requiredApprovals;
    const signals = result.signals.map((signal) => {
      if (!MODERABLE_STATUSES.includes(signal.status)) return signal;
      const approverIds = ModerationVoteModel.approverIds(signal.id);
      return {
        ...signal,
        moderation: {
          approvals: approverIds.length,
          required,
          approvedByMe: approverIds.includes(req.user!.id),
          rejectedByMe: signal.status === 'under_appeal' && signal.validatedBy === req.user!.id,
        },
      };
    });

    res.json({
      success: true,
      signals,
      total: result.total,
      requiredApprovals: required,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Erreur lors de la récupération des signalements', message: err.message });
  }
});

function pointsFor(trustPoints: number): number {
  return trustPoints >= 200 ? 15 : 10;
}

const MIN_PASSWORD_LENGTH = 12;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MODERABLE_STATUSES = ['pending', 'under_appeal'];

/**
 * PATCH /api/admin/signals/:id/validate
 * Cast an approval. The signal is published once enough distinct moderators approved it.
 * An administrator may publish immediately with { force: true } (audited).
 */
router.patch('/signals/:id/validate', (req: Request, res: Response): void => {
  try {
    const { id } = req.params;
    const validator = req.user!;
    const force = req.body?.force === true;

    const signal = SignalModel.findById(id);
    if (!signal) {
      res.status(404).json({ error: 'Signalement introuvable' });
      return;
    }
    if (!MODERABLE_STATUSES.includes(signal.status)) {
      res.status(409).json({ error: 'Ce signalement n’est plus en attente de décision.', currentStatus: signal.status });
      return;
    }
    if (force && validator.role !== 'admin') {
      res.status(403).json({ error: 'Seul un administrateur peut forcer une publication.' });
      return;
    }
    if (signal.status === 'under_appeal' && signal.validatedBy === validator.id) {
      res.status(403).json({ error: 'Le modérateur à l’origine du rejet ne peut pas traiter le recours.' });
      return;
    }

    const recorded = ModerationVoteModel.cast(id, validator.id, 'approve');
    if (!recorded) {
      res.status(409).json({ error: 'Vous avez déjà donné votre avis sur ce signalement.' });
      return;
    }

    const required = config.moderation.requiredApprovals;
    const approverIds = ModerationVoteModel.approverIds(id);
    const finalized = force || approverIds.length >= required;

    if (!finalized) {
      AuditLog.record({
        action: 'signal_approval_vote',
        targetType: 'signal',
        targetId: id,
        details: { approvals: approverIds.length, required },
        req,
      });
      res.json({
        success: true,
        finalized: false,
        message: `Approbation enregistrée (${approverIds.length}/${required}). Une validation supplémentaire est nécessaire.`,
        signal,
        approvals: approverIds.length,
        requiredApprovals: required,
        pointsAwarded: 0,
      });
      return;
    }

    const pointsAwarded = pointsFor(validator.trustPoints);
    const published = SignalModel.validate(id, validator.id, pointsAwarded);
    for (const approverId of approverIds) {
      const approver = AdminValidatorModel.findById(approverId);
      if (approver) AdminValidatorModel.incrementValidations(approver.id, pointsFor(approver.trustPoints));
    }
    ModerationVoteModel.clear(id);
    AuditLog.record({
      action: force ? 'signal_force_published' : 'signal_published',
      targetType: 'signal',
      targetId: id,
      details: { approvers: approverIds, required },
      req,
    });

    res.json({
      success: true,
      finalized: true,
      message: 'Signalement validé avec succès et publié sur la carte.',
      signal: published,
      approvals: approverIds.length,
      requiredApprovals: required,
      pointsAwarded,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Erreur de validation', message: err.message });
  }
});

/**
 * PATCH /api/admin/signals/:id/reject
 * Reject an incident report with mandatory explanation.
 */
router.patch('/signals/:id/reject', (req: Request, res: Response): void => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const validator = req.user!;

    if (!reason || typeof reason !== 'string' || reason.trim().length < 5) {
      res.status(400).json({ error: 'Un motif d’au moins 5 caractères est obligatoire pour rejeter un signalement.' });
      return;
    }

    const existing = SignalModel.findById(id);
    if (!existing) {
      res.status(404).json({ error: 'Signalement introuvable' });
      return;
    }
    if (!MODERABLE_STATUSES.includes(existing.status)) {
      res.status(409).json({ error: 'Ce signalement n’est plus en attente de décision.', currentStatus: existing.status });
      return;
    }
    if (existing.status === 'under_appeal' && existing.validatedBy === validator.id) {
      res.status(403).json({ error: 'Le modérateur à l’origine du rejet ne peut pas traiter le recours.' });
      return;
    }

    const signal = SignalModel.reject(id, validator.id, reason.trim());
    if (!signal) {
      res.status(404).json({ error: 'Signalement introuvable' });
      return;
    }

    AdminValidatorModel.incrementRejections(validator.id);
    ModerationVoteModel.clear(id);
    AuditLog.record({
      action: existing.status === 'under_appeal' ? 'appeal_rejected' : 'signal_rejected',
      targetType: 'signal',
      targetId: id,
      details: { reason: reason.trim() },
      req,
    });

    res.json({
      success: true,
      message:
        existing.status === 'under_appeal'
          ? 'Recours rejeté. La décision est définitive.'
          : 'Signalement rejeté. Le citoyen pourra déposer un recours avec son identifiant.',
      signal,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Erreur lors du rejet', message: err.message });
  }
});

/**
 * GET /api/admin/validators
 * List moderators and trust points leaderboard.
 */
router.get('/validators', (req: Request, res: Response): void => {
  try {
    const validators = AdminValidatorModel.listAll();
    res.json({
      success: true,
      validators,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Erreur', message: err.message });
  }
});

/**
 * POST /api/admin/validators
 * Create a new moderator account (Admin only).
 */
router.post('/validators', requireRole(['admin']), (req: Request, res: Response): void => {
  try {
    const { email, password, name, role } = req.body;

    if (typeof email !== 'string' || typeof password !== 'string' || typeof name !== 'string' || !email || !name.trim()) {
      res.status(400).json({ error: 'Email, mot de passe et nom sont obligatoires.' });
      return;
    }
    if (!EMAIL_PATTERN.test(email)) {
      res.status(400).json({ error: 'Adresse email invalide.' });
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      res.status(400).json({ error: `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères.` });
      return;
    }

    const existing = AdminValidatorModel.findByEmail(email);
    if (existing) {
      res.status(409).json({ error: 'Un modérateur existe déjà avec cet email.' });
      return;
    }

    const created = AdminValidatorModel.create({
      email,
      password,
      name: name.trim(),
      role: role === 'admin' ? 'admin' : 'moderator',
    });
    AuditLog.record({
      action: 'validator_created',
      targetType: 'validator',
      targetId: created.id,
      details: { email: created.email, role: created.role },
      req,
    });

    const { passwordHash, ...safeRecord } = created;
    res.status(201).json({
      success: true,
      validator: safeRecord,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Erreur lors de la création du modérateur', message: err.message });
  }
});

/**
 * PATCH /api/admin/validators/:id
 * Update a moderator account: role, activation, name or password (Admin only).
 */
router.patch('/validators/:id', requireRole(['admin']), (req: Request, res: Response): void => {
  try {
    const { id } = req.params;
    const { role, isActive, name, password } = req.body ?? {};
    const target = AdminValidatorModel.findById(id);
    if (!target) {
      res.status(404).json({ error: 'Modérateur introuvable' });
      return;
    }

    if (role !== undefined && role !== 'admin' && role !== 'moderator') {
      res.status(400).json({ error: 'Rôle invalide.' });
      return;
    }
    if (isActive !== undefined && typeof isActive !== 'boolean') {
      res.status(400).json({ error: 'Valeur d’activation invalide.' });
      return;
    }
    if (name !== undefined && (typeof name !== 'string' || !name.trim())) {
      res.status(400).json({ error: 'Nom invalide.' });
      return;
    }
    if (password !== undefined && (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH)) {
      res.status(400).json({ error: `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères.` });
      return;
    }

    const isSelf = target.id === req.user!.id;
    const losesAdmin =
      target.role === 'admin' && target.isActive && (role === 'moderator' || isActive === false);
    if (isSelf && losesAdmin) {
      res.status(400).json({ error: 'Vous ne pouvez pas retirer vos propres droits ni désactiver votre compte.' });
      return;
    }
    if (losesAdmin && AdminValidatorModel.countActiveAdmins() <= 1) {
      res.status(400).json({ error: 'Il doit rester au moins un administrateur actif.' });
      return;
    }

    const updated = AdminValidatorModel.update(id, {
      role,
      isActive,
      name: typeof name === 'string' ? name.trim() : undefined,
      password,
    });
    const changed = [
      role !== undefined && role !== target.role ? 'role' : null,
      isActive !== undefined && isActive !== target.isActive ? 'isActive' : null,
      name !== undefined ? 'name' : null,
      password !== undefined ? 'password' : null,
    ].filter(Boolean);
    AuditLog.record({
      action: 'validator_updated',
      targetType: 'validator',
      targetId: id,
      details: { email: target.email, changed, role, isActive },
      req,
    });

    const { passwordHash, ...safeRecord } = updated!;
    res.json({ success: true, validator: safeRecord });
  } catch (err: any) {
    res.status(500).json({ error: 'Erreur lors de la mise à jour du modérateur', message: err.message });
  }
});

/**
 * GET /api/admin/audit
 * Moderation audit trail (Admin only).
 */
router.get('/audit', requireRole(['admin']), (req: Request, res: Response): void => {
  try {
    const { action, limit, offset } = req.query;
    const result = AuditLog.list({
      action: typeof action === 'string' && action ? action : undefined,
      limit: limit ? parseInt(String(limit), 10) : undefined,
      offset: offset ? parseInt(String(offset), 10) : undefined,
    });
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ error: 'Erreur de lecture du journal d’audit', message: err.message });
  }
});

/**
 * GET /api/admin/storage
 * Health of the encrypted storage nodes (Admin only).
 */
router.get('/storage', requireRole(['admin']), async (_req: Request, res: Response): Promise<void> => {
  try {
    res.json({ success: true, ...(await StorageService.status()) });
  } catch (err: any) {
    res.status(500).json({ error: 'Erreur de lecture de l’état du stockage', message: err.message });
  }
});

/**
 * POST /api/admin/storage/repair
 * Re-replicate blobs to the nodes they belong on (Admin only).
 */
router.post('/storage/repair', requireRole(['admin']), async (req: Request, res: Response): Promise<void> => {
  if (!StorageService.isEnabled()) {
    res.status(409).json({ error: 'Aucun nœud de stockage configuré.' });
    return;
  }
  try {
    const report = await StorageService.repair();
    AuditLog.record({ action: 'storage_repair', details: { ...report }, req });
    res.json({ success: true, report });
  } catch (err: any) {
    res.status(500).json({ error: 'Erreur de réparation du stockage', message: err.message });
  }
});

/**
 * POST /api/admin/storage/backup
 * Encrypted database snapshot replicated on the nodes (Admin only).
 */
router.post('/storage/backup', requireRole(['admin']), async (req: Request, res: Response): Promise<void> => {
  if (!StorageService.isEnabled()) {
    res.status(409).json({ error: 'Aucun nœud de stockage configuré.' });
    return;
  }
  try {
    const report = await StorageService.backupDatabase();
    AuditLog.record({ action: 'storage_backup', details: { blobId: report.blobId, storedOn: report.storedOn }, req });
    res.json({ success: true, report });
  } catch (err: any) {
    const status = err instanceof StorageUnavailableError ? 503 : 500;
    res.status(status).json({ error: 'Échec de la sauvegarde chiffrée', message: err.message });
  }
});

/**
 * POST /api/admin/cleanup
 * Trigger immediate GDPR cleanup job.
 */
router.post('/cleanup', requireRole(['admin']), (req: Request, res: Response): void => {
  try {
    const result = runGdprCleanup();
    AuditLog.record({ action: 'gdpr_cleanup', details: { cleanedCount: result.cleanedCount }, req });
    res.json({
      success: true,
      message: `Nettoyage RGPD exécuté : ${result.cleanedCount} contact(s) purgé(s).`,
      result,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Erreur de nettoyage RGPD', message: err.message });
  }
});

export default router;
