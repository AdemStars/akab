import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { AdminValidatorModel } from '../models/AdminValidator';
import { config } from '../config';
import { authenticate } from '../middleware/auth';
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

    const validator = AdminValidatorModel.findByEmail(email);
    if (!validator) {
      res.status(401).json({ error: 'Identifiants incorrects' });
      return;
    }

    const isValid = AdminValidatorModel.verifyPassword(password, validator.passwordHash);
    if (!isValid) {
      res.status(401).json({ error: 'Identifiants incorrects' });
      return;
    }

    if (!validator.isActive) {
      res.status(403).json({ error: 'Ce compte modérateur a été désactivé' });
      return;
    }

    const token = jwt.sign(
      {
        id: validator.id,
        email: validator.email,
        role: validator.role,
      },
      config.jwtSecret,
      { expiresIn: '7d' }
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
