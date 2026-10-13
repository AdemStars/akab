import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import { config, getDatabase } from './config';
import signalsRouter from './routes/signals';
import adminRouter from './routes/admin';
import exportRouter from './routes/export';
import authRouter from './routes/auth';
import { GdprService } from './services/gdpr';
import { IpfsService } from './services/ipfs';
import { startCleanupJob } from './jobs/cleanup';
import { rateLimitGeneral } from './middleware/rateLimit';

export const app = express();

// Security headers and CORS
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://unpkg.com'],
        imgSrc: ["'self'", 'data:', 'blob:', 'https:', 'http:'],
        connectSrc: ["'self'", 'https:', 'http:'],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);

app.use(
  cors({
    origin: [
      'http://localhost:3000',
      'http://localhost:4000',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:4000',
    ],
    credentials: true,
  })
);

app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// Global general rate limit
app.use(rateLimitGeneral);

// Health check
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    platform: 'AKAB',
    timestamp: new Date().toISOString(),
  });
});

// GDPR Privacy Policy
app.get('/api/gdpr/policy', (_req: Request, res: Response) => {
  res.json({
    success: true,
    policy: GdprService.getPrivacyPolicy(),
  });
});

// Local Content-Addressed IPFS Gateway fallback
app.get('/api/ipfs/:cid', (req: Request, res: Response) => {
  const { buffer, exists } = IpfsService.getLocalFile(req.params.cid);
  if (!exists) {
    res.status(404).json({ error: 'Contenu IPFS non trouvé localement' });
    return;
  }
  // Guess mime or fallback
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.send(buffer);
});

// API Routes
app.use('/api/signals', signalsRouter);
app.use('/api/admin', adminRouter);
app.use('/api/export', exportRouter);
app.use('/api/auth', authRouter);

// Serve frontend static build if exists (for self-hosted single container deployment)
const frontendDist = path.join(__dirname, '../frontend/dist');
app.use(express.static(frontendDist));
app.get('*', rateLimitGeneral, (req: Request, res: Response, next: NextFunction) => {
  if (req.path.startsWith('/api')) {
    return next();
  }
  const indexPath = path.resolve(frontendDist, 'index.html');
  res.sendFile(indexPath, (err) => {
    if (err) {
      next();
    }
  });
});

// 404 handler for API
app.use('/api/*', (_req: Request, res: Response) => {
  res.status(404).json({ error: 'Endpoint API introuvable' });
});

// Global error handler
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[UNHANDLED ERROR]', err);
  res.status(err.status || 500).json({
    error: 'Une erreur interne est survenue',
    message: config.nodeEnv === 'development' ? err.message : undefined,
  });
});

// Start server if not running inside test runner
if (process.env.NODE_ENV !== 'test') {
  getDatabase();
  startCleanupJob();

  app.listen(config.port, () => {
    console.log(`[AKAB SERVER] Plateforme AKAB active sur le port ${config.port}`);
    console.log(`[AKAB SERVER] Environnement : ${config.nodeEnv}`);
    console.log(`[AKAB SERVER] Base de données : ${config.databaseUrl}`);
  });
}
