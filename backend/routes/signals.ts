import { Router, Request, Response } from 'express';
import multer from 'multer';
import { SignalModel, EvidenceItem } from '../models/Signal';
import { UserModel } from '../models/User';
import { ModerationVoteModel } from '../models/ModerationVote';
import { StorageService, StorageUnavailableError } from '../services/storage';
import { IpfsService } from '../services/ipfs';
import { AnonymizationService } from '../services/anonymization';
import { GdprService } from '../services/gdpr';
import { EmailService } from '../services/email';
import { validateSignalInput, validateAppealInput } from '../middleware/validation';
import { rateLimitSubmissions } from '../middleware/rateLimit';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max per proof
    files: 5,
  },
});

/**
 * POST /api/signals/upload-proof
 * Upload a photo/video evidence directly to IPFS with automatic EXIF stripping.
 */
router.post(
  '/upload-proof',
  rateLimitSubmissions,
  upload.single('file'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      if (!req.file) {
        res.status(400).json({ error: 'Aucun fichier fourni' });
        return;
      }

      const originalName = req.file.originalname;
      const mimeType = req.file.mimetype;
      const isVideo = mimeType.startsWith('video/');
      const isAnonymized = req.body.anonymized === 'true' || req.body.anonymized === true;

      // Strip EXIF metadata to ensure privacy
      const sanitizedBuffer = AnonymizationService.stripExif(req.file.buffer, mimeType);
      const safeFilename = AnonymizationService.sanitizeFilename(originalName);

      // Encrypted storage nodes when configured, IPFS / local content store otherwise
      let ipfsResult: { cid: string; url: string; gatewayUrl: string; size: number };
      if (StorageService.isEnabled()) {
        const stored = await StorageService.store(sanitizedBuffer, { mimeType });
        ipfsResult = {
          cid: stored.ref,
          url: `akab://${stored.ref.slice(5)}`,
          gatewayUrl: `/api/ipfs/${stored.ref}`,
          size: sanitizedBuffer.length,
        };
      } else {
        ipfsResult = await IpfsService.upload(sanitizedBuffer, safeFilename, mimeType);
      }

      const evidenceItem: EvidenceItem = {
        id: 'ev_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
        cid: ipfsResult.cid,
        originalName: safeFilename,
        mimeType,
        size: ipfsResult.size,
        url: ipfsResult.url,
        anonymized: isAnonymized,
        isVideo,
      };

      res.status(201).json({
        success: true,
        evidence: evidenceItem,
        gatewayUrl: ipfsResult.gatewayUrl,
      });
    } catch (err: any) {
      console.error('[UPLOAD ERROR]', err);
      if (err instanceof StorageUnavailableError) {
        res.status(503).json({ error: 'Stockage temporairement indisponible, veuillez réessayer.' });
        return;
      }
      res.status(500).json({ error: 'Échec de l’envoi décentralisé vers IPFS', message: err.message });
    }
  }
);

/**
 * POST /api/signals
 * Submit a new incident report with GPS coordinates and optional proof.
 */
router.post(
  '/',
  rateLimitSubmissions,
  validateSignalInput,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const {
        title,
        description,
        incidentDate,
        incidentType,
        eventType,
        eventName,
        victimAgeGroup,
        latitude,
        longitude,
        locationAccuracyMeters,
        address,
        city,
        postalCode,
        department,
        evidence,
        reporterEmail,
        reporterPhone,
      } = req.body;

      // Create signal in database
      const signal = SignalModel.create({
        title,
        description,
        incidentDate,
        incidentType,
        eventType,
        eventName,
        victimAgeGroup,
        latitude,
        longitude,
        locationAccuracyMeters,
        address,
        city,
        postalCode,
        department,
        evidence: evidence || [],
        reporterEmail: reporterEmail || undefined,
        reporterPhone: reporterPhone || undefined,
      });

      // Also register in user tracking if contact was given
      if (reporterEmail || reporterPhone) {
        UserModel.create(reporterEmail, reporterPhone);
      }

      // Send confirmation email with secret tokens if email provided
      if (reporterEmail) {
        EmailService.sendSignalConfirmation(reporterEmail, signal.id, signal.forgetToken).catch((err) =>
          console.error('[EMAIL ERROR]', err)
        );
      }

      res.status(201).json({
        success: true,
        message: 'Signalement enregistré avec succès. Il sera examiné par nos modérateurs.',
        signalId: signal.id,
        forgetToken: signal.forgetToken,
        status: signal.status,
        retentionExpiresAt: signal.retentionExpiresAt,
      });
    } catch (err: any) {
      console.error('[SIGNAL CREATE ERROR]', err);
      res.status(500).json({ error: 'Erreur lors de l’enregistrement du signalement', message: err.message });
    }
  }
);

/**
 * GET /api/signals
 * List validated signals for map display and public browsing.
 */
router.get('/', (req: Request, res: Response): void => {
  try {
    const { startDate, endDate, incidentType, city, department, limit, offset } = req.query;

    const result = SignalModel.findValidated({
      startDate: typeof startDate === 'string' ? startDate : undefined,
      endDate: typeof endDate === 'string' ? endDate : undefined,
      incidentType: typeof incidentType === 'string' ? incidentType : undefined,
      city: typeof city === 'string' ? city : undefined,
      department: typeof department === 'string' ? department : undefined,
      limit: limit ? parseInt(String(limit), 10) : undefined,
      offset: offset ? parseInt(String(offset), 10) : undefined,
    });

    res.json({
      success: true,
      signals: result.signals,
      total: result.total,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Erreur de récupération des signalements', message: err.message });
  }
});

/**
 * GET /api/signals/:id
 * Retrieve details of a specific signal.
 */
router.get('/:id', (req: Request, res: Response): void => {
  try {
    const signal = SignalModel.findById(req.params.id);
    if (!signal) {
      res.status(404).json({ error: 'Signalement introuvable' });
      return;
    }

    // If signal is not yet validated and requested publicly, only allow if searching by ID
    // but sanitize personal info in all cases
    res.json({
      success: true,
      signal: SignalModel.sanitizePublic(signal),
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Erreur', message: err.message });
  }
});

/**
 * POST /api/signals/:id/appeal
 * Submit an appeal for a rejected report.
 */
router.post(
  '/:id/appeal',
  rateLimitSubmissions,
  validateAppealInput,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const { reason } = req.body;

      const signal = SignalModel.findById(id);
      if (!signal) {
        res.status(404).json({ error: 'Signalement introuvable' });
        return;
      }

      if (signal.status !== 'rejected') {
        res.status(400).json({
          error: 'Seul un signalement ayant été rejeté peut faire l’objet d’un recours.',
          currentStatus: signal.status,
        });
        return;
      }

      const updated = SignalModel.submitAppeal(id, reason);
      if (!updated) {
        res.status(409).json({ error: 'Un recours a déjà été déposé pour ce signalement.' });
        return;
      }
      ModerationVoteModel.clear(id);

      if (signal.reporterEmail) {
        EmailService.sendAppealConfirmation(signal.reporterEmail, id).catch(() => {});
      }

      res.json({
        success: true,
        message: 'Votre recours a bien été enregistré et sera réexaminé par l’équipe de modération.',
        signal: updated ? SignalModel.sanitizePublic(updated) : null,
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Erreur lors du dépôt du recours', message: err.message });
    }
  }
);

/**
 * POST /api/signals/forget
 * Exercise Right to be Forgotten (GDPR Art. 17).
 */
router.post('/forget', (req: Request, res: Response): void => {
  try {
    const { forgetToken } = req.body;
    if (!forgetToken || typeof forgetToken !== 'string') {
      res.status(400).json({ error: 'Jeton de droit à l’oubli requis' });
      return;
    }

    const result = GdprService.forgetByToken(forgetToken);
    if (!result.success) {
      res.status(404).json(result);
      return;
    }

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: 'Erreur lors de la suppression des données', message: err.message });
  }
});

/**
 * GET /api/signals/forget/inspect/:token
 * GDPR Art. 15 inspection of personal data held.
 */
router.get('/forget/inspect/:token', (req: Request, res: Response): void => {
  try {
    const data = GdprService.inspectUserData(req.params.token);
    if (!data) {
      res.status(404).json({ error: 'Aucune donnée trouvée pour ce jeton' });
      return;
    }
    res.json({ success: true, data });
  } catch (err: any) {
    res.status(500).json({ error: 'Erreur', message: err.message });
  }
});

export default router;
