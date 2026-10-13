import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';

export const SignalSchema = z.object({
  title: z
    .string({ required_error: 'Le titre est obligatoire' })
    .min(3, 'Le titre doit contenir au moins 3 caractères')
    .max(150, 'Le titre ne peut excéder 150 caractères'),
  description: z
    .string({ required_error: 'La description est obligatoire' })
    .min(10, 'La description doit contenir au moins 10 caractères')
    .max(5000, 'La description ne peut excéder 5000 caractères'),
  incidentDate: z
    .string({ required_error: "La date de l'incident est obligatoire" })
    .refine((dateStr) => {
      const d = new Date(dateStr);
      return !isNaN(d.getTime()) && d.getTime() <= Date.now() + 60000;
    }, "La date de l'incident doit être valide et ne peut pas être dans le futur"),
  incidentType: z.enum(
    [
      'violence_physique',
      'violence_verbale',
      'tir_lbd',
      'gaz_lacrymo',
      'interpellation_violente',
      'grenade_desencerclement',
      'materiel_detruit',
      'autre',
    ],
    {
      required_error: "Le type d'incident est obligatoire",
    }
  ),
  latitude: z
    .number({ required_error: 'La latitude est obligatoire' })
    .min(-90)
    .max(90),
  longitude: z
    .number({ required_error: 'La longitude est obligatoire' })
    .min(-180)
    .max(180),
  address: z.string().optional(),
  city: z.string().optional(),
  postalCode: z.string().optional(),
  department: z.string().optional(),
  evidence: z
    .array(
      z.object({
        id: z.string(),
        cid: z.string(),
        originalName: z.string(),
        mimeType: z.string(),
        size: z.number(),
        url: z.string(),
        anonymized: z.boolean(),
        isVideo: z.boolean(),
      })
    )
    .optional(),
  reporterEmail: z.string().email('Format email invalide').optional().or(z.literal('')),
  reporterPhone: z
    .string()
    .regex(/^[+0-9\s.-]{6,20}$/, 'Format de téléphone invalide')
    .optional()
    .or(z.literal('')),
  gdprConsent: z.boolean().refine((val) => val === true, {
    message: 'Vous devez accepter la politique de confidentialité RGPD',
  }),
});

export function validateSignalInput(req: Request, res: Response, next: NextFunction): void {
  // If request contains stringified JSON in multipart, parse it if needed
  if (typeof req.body.latitude === 'string') {
    req.body.latitude = parseFloat(req.body.latitude);
  }
  if (typeof req.body.longitude === 'string') {
    req.body.longitude = parseFloat(req.body.longitude);
  }
  if (typeof req.body.gdprConsent === 'string') {
    req.body.gdprConsent = req.body.gdprConsent === 'true' || req.body.gdprConsent === '1';
  }
  if (typeof req.body.evidence === 'string') {
    try {
      req.body.evidence = JSON.parse(req.body.evidence);
    } catch {
      req.body.evidence = [];
    }
  }

  const result = SignalSchema.safeParse(req.body);
  if (!result.success) {
    const errors = result.error.errors.map((e) => ({
      field: e.path.join('.'),
      message: e.message,
    }));
    res.status(400).json({ error: 'Données de formulaire invalides', details: errors });
    return;
  }

  req.body = result.data;
  next();
}

export const AppealSchema = z.object({
  reason: z
    .string({ required_error: 'Le motif de recours est obligatoire' })
    .min(10, 'Le motif doit comporter au moins 10 caractères')
    .max(2000, 'Le motif ne peut excéder 2000 caractères'),
});

export function validateAppealInput(req: Request, res: Response, next: NextFunction): void {
  const result = AppealSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({
      error: 'Motif de recours invalide',
      details: result.error.errors.map((e) => e.message),
    });
    return;
  }
  next();
}
