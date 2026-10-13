import { Router, Request, Response } from 'express';
import { SignalModel } from '../models/Signal';
import { AdminValidatorModel } from '../models/AdminValidator';
import { authenticate, requireRole } from '../middleware/auth';
import { runGdprCleanup } from '../jobs/cleanup';

const router = Router();

// Protect all admin endpoints with authentication
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

    res.json({
      success: true,
      signals: result.signals,
      total: result.total,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Erreur lors de la récupération des signalements', message: err.message });
  }
});

/**
 * PATCH /api/admin/signals/:id/validate
 * Manually validate an incident report and award trust points to the moderator.
 */
router.patch('/signals/:id/validate', (req: Request, res: Response): void => {
  try {
    const { id } = req.params;
    const validator = req.user!;

    // Trust points calculation: standard +10 points, bonus for detailed review
    const pointsAwarded = validator.trustPoints >= 200 ? 15 : 10;

    const signal = SignalModel.validate(id, validator.id, pointsAwarded);
    if (!signal) {
      res.status(404).json({ error: 'Signalement introuvable' });
      return;
    }

    // Increment validator counter and trust points
    AdminValidatorModel.incrementValidations(validator.id, pointsAwarded);

    res.json({
      success: true,
      message: 'Signalement validé avec succès et publié sur la carte.',
      signal,
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

    const signal = SignalModel.reject(id, validator.id, reason.trim());
    if (!signal) {
      res.status(404).json({ error: 'Signalement introuvable' });
      return;
    }

    AdminValidatorModel.incrementRejections(validator.id);

    res.json({
      success: true,
      message: 'Signalement rejeté. Le citoyen pourra déposer un recours avec son identifiant.',
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

    if (!email || !password || !name) {
      res.status(400).json({ error: 'Email, mot de passe et nom sont obligatoires.' });
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
      name,
      role: role === 'admin' ? 'admin' : 'moderator',
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
 * POST /api/admin/cleanup
 * Trigger immediate GDPR cleanup job.
 */
router.post('/cleanup', requireRole(['admin']), (req: Request, res: Response): void => {
  try {
    const result = runGdprCleanup();
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
