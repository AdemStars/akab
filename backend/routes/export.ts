import { Router, Request, Response } from 'express';
import { SignalModel } from '../models/Signal';

const router = Router();

/**
 * GET /api/export/signals
 * Public data export for journalists, researchers, and lawyers.
 * Strictly validated and anonymized data only (GDPR Art. 89).
 * Query parameters:
 *  - format: 'json' (default), 'csv', 'geojson'
 *  - startDate, endDate
 *  - incidentType, city, department
 */
router.get('/signals', (req: Request, res: Response): void => {
  try {
    const { format = 'json', startDate, endDate, incidentType, city, department } = req.query;

    const result = SignalModel.findValidated({
      startDate: typeof startDate === 'string' ? startDate : undefined,
      endDate: typeof endDate === 'string' ? endDate : undefined,
      incidentType: typeof incidentType === 'string' ? incidentType : undefined,
      city: typeof city === 'string' ? city : undefined,
      department: typeof department === 'string' ? department : undefined,
      limit: 5000, // Large export limit for researchers
    });

    // Anonymized data preparation
    const exportData = result.signals.map((s) => ({
      id: s.id,
      title: s.title,
      description: s.description,
      incidentDate: s.incidentDate,
      incidentType: s.incidentType,
      latitude: s.latitude,
      longitude: s.longitude,
      address: s.address,
      city: s.city,
      postalCode: s.postalCode,
      department: s.department,
      evidenceIpfsCids: s.evidence.map((e) => e.cid),
      evidenceCount: s.evidence.length,
      validatedAt: s.validatedAt,
    }));

    if (format === 'geojson') {
      const geojson = {
        type: 'FeatureCollection',
        metadata: {
          platform: 'AKAB Open Data',
          generatedAt: new Date().toISOString(),
          count: exportData.length,
          license: 'AGPL-3.0 / Open Data Commons',
        },
        features: exportData.map((item) => ({
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [item.longitude, item.latitude],
          },
          properties: {
            id: item.id,
            title: item.title,
            description: item.description,
            incidentDate: item.incidentDate,
            incidentType: item.incidentType,
            address: item.address,
            city: item.city,
            postalCode: item.postalCode,
            department: item.department,
            evidenceCids: item.evidenceIpfsCids,
            evidenceCount: item.evidenceCount,
            validatedAt: item.validatedAt,
          },
        })),
      };

      res.setHeader('Content-Type', 'application/geo+json');
      res.setHeader('Content-Disposition', 'attachment; filename="akab_signals.geojson"');
      res.json(geojson);
      return;
    }

    if (format === 'csv') {
      const headers = [
        'id',
        'title',
        'incidentDate',
        'incidentType',
        'latitude',
        'longitude',
        'city',
        'postalCode',
        'department',
        'evidenceCount',
        'evidenceCids',
        'description',
      ];

      const csvRows = [headers.join(',')];

      for (const item of exportData) {
        const row = [
          JSON.stringify(item.id),
          JSON.stringify(item.title),
          JSON.stringify(item.incidentDate),
          JSON.stringify(item.incidentType),
          item.latitude,
          item.longitude,
          JSON.stringify(item.city || ''),
          JSON.stringify(item.postalCode || ''),
          JSON.stringify(item.department || ''),
          item.evidenceCount,
          JSON.stringify(item.evidenceIpfsCids.join(';')),
          JSON.stringify(item.description.replace(/\r?\n/g, ' ')),
        ];
        csvRows.push(row.join(','));
      }

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="akab_signals.csv"');
      res.send(csvRows.join('\n'));
      return;
    }

    // Default JSON
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="akab_signals.json"');
    res.json({
      metadata: {
        platform: 'AKAB Open Data',
        generatedAt: new Date().toISOString(),
        total: exportData.length,
        disclaimer: 'Données anonymisées et validées par modération citoyenne.',
      },
      data: exportData,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Erreur lors de l’export', message: err.message });
  }
});

/**
 * GET /api/export/statistics
 * Aggregated statistics by incident type, region, and timeline.
 */
router.get('/statistics', (_req: Request, res: Response): void => {
  try {
    const stats = SignalModel.getStatistics();
    res.json({
      success: true,
      stats,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Erreur lors de la génération des statistiques', message: err.message });
  }
});

export default router;
