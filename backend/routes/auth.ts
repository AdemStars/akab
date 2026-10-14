import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { AdminValidatorModel } from '../models/AdminValidator';
import { config } from '../config';
import { authenticate } from '../middleware/auth';
import { AuditLog } from '../models/AuditLog';
import { rateLimitAuth } from '../middleware/rateLimit';

const router = Router();

// Apply auth rate limiting to all auth endpoints
router.use(rateLimitAuth);

/**
 * POST /api/auth/login
 * Moderator and administrator login.
 */
router.post('/login', (req: Request, res: Response): void => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: 'Email et mot de passe requis' });
      return;
    }

    const validator = typeof email === 'string' ? AdminValidatorModel.findByEmail(email) : null;
    if (!validator) {
      AuditLog.record({ actorEmail: String(email).slice(0, 200), action: 'login_failed', details: { reason: 'unknown_account' }, req });
      res.status(401).json({ error: 'Identifiants incorrects' });
      return;
    }

    if (AdminValidatorModel.isLocked(validator)) {
      AuditLog.record({ actorId: validator.id, actorEmail: validator.email, action: 'login_blocked', req });
      res.status(429).json({ error: 'Compte temporairement verrouillé après plusieurs échecs. Réessayez plus tard.' });
      return;
    }

    const isValid = AdminValidatorModel.verifyPassword(String(password), validator.passwordHash);
    if (!isValid) {
      const locked = AdminValidatorModel.recordFailedLogin(
        validator.id,
        config.moderation.maxFailedLogins,
        config.moderation.lockoutMinutes
      );
      AuditLog.record({
        actorId: validator.id,
        actorEmail: validator.email,
        action: locked ? 'account_locked' : 'login_failed',
        req,
      });
      res.status(401).json({ error: 'Identifiants incorrects' });
      return;
    }

    if (!validator.isActive) {
      res.status(403).json({ error: 'Ce compte modérateur a été désactivé' });
      return;
    }

    AdminValidatorModel.recordSuccessfulLogin(validator.id);
    AuditLog.record({ actorId: validator.id, actorEmail: validator.email, action: 'login', req });

    const token = jwt.sign(
      {
        id: validator.id,
        email: validator.email,
        role: validator.role,
        tv: validator.tokenVersion,
      },
      config.jwtSecret,
      { expiresIn: '12h' }
    );

    res.json({
      success: true,
      token,
      user: {
        id: validator.id,
        email: validator.email,
        name: validator.name,
        role: validator.role,
        trustPoints: validator.trustPoints,
        validationsCount: validator.validationsCount,
        rejectionsCount: validator.rejectionsCount,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Erreur d’authentification', message: err.message });
  }
});

/**
 * GET /api/auth/me
 * Check current logged in user.
 */
router.get('/me', authenticate, (req: Request, res: Response): void => {
  res.json({
    success: true,
    user: req.user,
  });
});

export default router;
