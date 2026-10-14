import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { AdminValidatorModel } from '../models/AdminValidator';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'moderator';
  trustPoints: number;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentification requise (Token JWT manquant).' });
    return;
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, config.jwtSecret) as any;
    const validator = AdminValidatorModel.findById(decoded.id);

    if (!validator || !validator.isActive) {
      res.status(401).json({ error: 'Compte modérateur introuvable ou désactivé.' });
      return;
    }

    if ((decoded.tv ?? 0) !== validator.tokenVersion) {
      res.status(401).json({ error: 'Session invalidée : reconnectez-vous.' });
      return;
    }

    req.user = {
      id: validator.id,
      email: validator.email,
      name: validator.name,
      role: validator.role,
      trustPoints: validator.trustPoints,
    };

    next();
  } catch {
    res.status(401).json({ error: 'Token JWT invalide ou expiré.' });
  }
}

export function requireRole(roles: ('admin' | 'moderator')[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Non authentifié.' });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Permissions insuffisantes pour cette action.' });
      return;
    }

    next();
  };
}
