import React, { useCallback, useEffect, useState } from 'react';
import { Download, MapPin, ShieldAlert, FileSpreadsheet, Globe, RefreshCw, CalendarDays } from 'lucide-react';
import { API } from '../utils/api';
import { EVENT_TYPE_LABELS } from '../utils/signalLabels';

export const Statistics: React.FC = () => {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadStatistics = useCallback(async () => {
    try {
      setLoading(true);
      setLoadError(null);
      setStats(await API.getStatistics());
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Impossible de charger les statistiques.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatistics();
  }, [loadStatistics]);

  const typeLabels: Record<string, string> = {
    violence_physique: 'Violences physiques',
    violence_verbale: 'Violences verbales / insultes',
    tir_lbd: 'Tirs de LBD / lanceurs',
    gaz_lacrymo: 'Usage massif gaz lacrymogène',
    grenade_desencerclement: 'Grenades de désencerclement',
    interpellation_violente: 'Interpellations violentes',
    materiel_detruit: 'Matériel détruit',
    autre: 'Autres incidents',
  };

  if (loading && !stats) {
    return (
      <div className="page-shell page-shell-wide">
        <div className="page-heading">
          <p className="page-eyebrow">DONNÉES PUBLIQUES</p>
          <h1>Statistiques</h1>
          <p>Repères synthétiques sur les signalements examinés par la modération.</p>
        </div>
        <p className="feedback-loading" role="status">Chargement des statistiques publiques...</p>
      </div>
    );
  }

  return (
    <section className="page-shell page-shell-wide">
      <header className="page-heading">
        <p className="page-eyebrow">DONNÉES PUBLIQUES</p>
        <h1>Statistiques des signalements</h1>
        <p>Repères synthétiques sur les signalements examinés par la modération citoyenne.</p>
      </header>

      {loadError && (
        <div className="feedback-error" role="alert">
          <span>{loadError}</span>
          <button className="btn btn-outline" onClick={loadStatistics} disabled={loading}>
            <RefreshCw size={16} /> Réessayer
          </button>
        </div>
      )}

      {/* Stat Grid */}
      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-number">{stats?.totalValidated || 0}</div>
          <div className="stat-label">Signalements validés</div>
        </div>
        <div className="stat-card">
          <div className="stat-number" style={{ color: 'var(--accent-yellow)' }}>
            {stats?.totalPending || 0}
          </div>
          <div className="stat-label">En cours d'examen</div>
        </div>
        <div className="stat-card">
          <div className="stat-number" style={{ color: 'var(--accent-blue)' }}>
            {stats?.totalAppeals || 0}
          </div>
          <div className="stat-label">Recours citoyens</div>
        </div>
        <div className="stat-card">
          <div className="stat-number" style={{ color: 'var(--accent-green)' }}>
            {stats?.totalSubmitted || 0}
          </div>
          <div className="stat-label">Total transmis</div>
        </div>
      </div>

      {/* Event Context Breakdown */}
      <div className="card">
        <h3 className="card-title">
          <CalendarDays size={20} /> Par type de manifestation ou mouvement
        </h3>
        <p className="page-section-description">
          Les catégories sont facultatives et ne comprennent pas les événements sans contexte collectif renseigné.
        </p>
        {stats?.byEventType?.length ? (
          <div className="event-stat-list">
            {stats.byEventType.map((item: { eventType: string; count: number }) => (
              <div className="event-stat-item" key={item.eventType}>
                <span>{EVENT_TYPE_LABELS[item.eventType] || item.eventType}</span>
                <strong>{item.count}</strong>
              </div>
            ))}
          </div>
        ) : (
          <p className="feedback-empty">Aucun mouvement collectif renseigné parmi les signalements validés.</p>
        )}
      </div>

      {/* Incident Types Breakdown */}
      <div className="card">
        <h3 className="card-title">
          <ShieldAlert size={20} /> Répartition par type de violences
        </h3>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
          Données basées sur les signalements validés par la modération citoyenne.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {stats?.byType && stats.byType.length > 0 ? (
            stats.byType.map((item: any) => {
              const maxCount = stats.totalValidated || 1;
              const pct = Math.round((item.count / maxCount) * 100);
              return (
                <div key={item.incidentType}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.2rem' }}>
                    <span>{typeLabels[item.incidentType] || item.incidentType}</span>
                    <strong>
                      {item.count} ({pct}%)
                    </strong>
                  </div>
                  <div
                    style={{
                      height: '8px',
                      backgroundColor: 'var(--bg-input)',
                      borderRadius: '4px',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        width: `${pct}%`,
                        height: '100%',
                        backgroundColor: 'var(--primary-red)',
                        borderRadius: '4px',
                      }}
                    />
                  </div>
                </div>
              );
            })
          ) : (
            <p style={{ color: 'var(--text-muted)' }}>Aucune donnée disponible pour le moment.</p>
          )}
        </div>
      </div>

      {/* Zone Statistics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
        {/* Top Departments */}
        <div className="card">
          <h3 className="card-title">
            <MapPin size={20} /> Par département
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {stats?.byDepartment && stats.byDepartment.length > 0 ? (
              stats.byDepartment.map((dept: any) => (
                <div
                  key={dept.department}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: '0.4rem 0.6rem',
                    backgroundColor: 'var(--bg-input)',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '0.85rem',
                  }}
                >
                  <span>Dép. {dept.department}</span>
                  <span className="badge badge-red">{dept.count}</span>
                </div>
              ))
            ) : (
              <p style={{ color: 'var(--text-muted)' }}>Aucun département renseigné.</p>
            )}
          </div>
        </div>

        {/* Top Cities */}
        <div className="card">
          <h3 className="card-title">
            <Globe size={20} /> Par ville
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {stats?.byCity && stats.byCity.length > 0 ? (
              stats.byCity.map((city: any) => (
                <div
                  key={city.city}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: '0.4rem 0.6rem',
                    backgroundColor: 'var(--bg-input)',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '0.85rem',
                  }}
                >
                  <span>{city.city}</span>
                  <span className="badge badge-red">{city.count}</span>
                </div>
              ))
            ) : (
              <p style={{ color: 'var(--text-muted)' }}>Aucune ville renseignée.</p>
            )}
          </div>
        </div>
      </div>

      {/* Open Data Export Section for Journalists & Researchers */}
      <div className="card" style={{ marginTop: '1rem' }}>
        <h3 className="card-title">
          <Download size={20} /> Export Open Data (Journalistes, Avocats, Chercheurs)
        </h3>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
          Toutes les données publiques validées et anonymisées sont mises à disposition sous licence libre
          AGPL-3.0 / Open Data. Les coordonnées personnelles des citoyens en sont strictement exclues conformément
          au RGPD.
        </p>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
          <a
            href="/api/export/signals?format=json"
            download="akab_signals.json"
            className="btn btn-secondary"
            style={{ flex: 1, minWidth: '160px' }}
          >
            <Download size={16} /> Format JSON
          </a>
          <a
            href="/api/export/signals?format=csv"
            download="akab_signals.csv"
            className="btn btn-secondary"
            style={{ flex: 1, minWidth: '160px' }}
          >
            <FileSpreadsheet size={16} /> Tableur CSV
          </a>
          <a
            href="/api/export/signals?format=geojson"
            download="akab_signals.geojson"
            className="btn btn-secondary"
            style={{ flex: 1, minWidth: '160px' }}
          >
            <Globe size={16} /> SIG GeoJSON
          </a>
        </div>
      </div>
    </section>
  );
};
