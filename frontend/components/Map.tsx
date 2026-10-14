import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { API, Signal, SignalFilters } from '../utils/api';
import { getCurrentGPSPosition } from '../utils/geolocation';
import { EVENT_TYPE_LABELS } from '../utils/signalLabels';
import { Layers, List, Navigation } from 'lucide-react';

interface MapProps {
  signals?: Signal[];
  filters?: SignalFilters;
  onFilterChange?: (filters: SignalFilters) => void;
  onSelectSignal: (signal: Signal) => void;
  focusSignal?: Signal | null;
  onFocusHandled?: () => void;
}

export const MapComponent: React.FC<MapProps> = ({
  signals: propSignals,
  filters: propFilters,
  onFilterChange: propOnFilterChange,
  onSelectSignal,
  focusSignal,
  onFocusHandled,
}) => {
  const focusRef = useRef<Signal | null>(null);
  focusRef.current = focusSignal ?? null;
  const [internalSignals, setInternalSignals] = useState<Signal[]>([]);
  const [internalFilters, setInternalFilters] = useState<SignalFilters>({});
  const [loading, setLoading] = useState<boolean>(false);

  const signals = propSignals !== undefined ? propSignals : internalSignals;
  const filters = propFilters !== undefined ? propFilters : internalFilters;

  const handleFilterChange = (newFilters: SignalFilters) => {
    if (propOnFilterChange) {
      propOnFilterChange(newFilters);
    } else {
      setInternalFilters(newFilters);
    }
  };

  // If running standalone without propSignals, load signals
  useEffect(() => {
    if (propSignals !== undefined) return;
    let isMounted = true;
    const fetchSignals = async () => {
      try {
        setLoading(true);
        const res = await API.getSignals(filters);
        if (isMounted) {
          setInternalSignals(res.signals);
        }
      } catch (err) {
        console.error('Failed to load signals for map:', err);
      } finally {
        if (isMounted) setLoading(false);
      }
    };
    fetchSignals();
    return () => {
      isMounted = false;
    };
  }, [propSignals, filters.incidentType, filters.city, filters.startDate, filters.endDate]);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersGroupRef = useRef<L.LayerGroup | null>(null);
  const [viewMode, setViewMode] = useState<'map' | 'list'>('map');
  const [geoLocating, setGeoLocating] = useState(false);
  const [tileError, setTileError] = useState(false);

  // Initialize Leaflet map
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    // Default center: France
    const map = L.map(mapContainerRef.current, {
      center: [46.603354, 1.888334],
      zoom: 6,
      zoomControl: true,
    });

    const tileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      subdomains: 'abc',
      maxZoom: 19,
    });
    tileLayer.on('tileerror', () => setTileError(true));
    tileLayer.on('tileload', () => setTileError(false));
    tileLayer.addTo(map);

    const markersGroup = L.layerGroup().addTo(map);
    markersGroupRef.current = markersGroup;
    mapInstanceRef.current = map;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // Update markers when signals change
  useEffect(() => {
    if (!mapInstanceRef.current || !markersGroupRef.current) return;

    markersGroupRef.current.clearLayers();

    const customIcon = L.divIcon({
      className: 'custom-map-marker',
      html: `
        <div style="
          background-color: #e63946;
          width: 28px;
          height: 28px;
          border-radius: 50%;
          border: 2px solid #ffffff;
          box-shadow: 0 2px 8px rgba(0,0,0,0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          font-weight: bold;
          font-size: 14px;
        ">!</div>
      `,
      iconSize: [28, 28],
      iconAnchor: [14, 14],
      popupAnchor: [0, -14],
    });

    signals.forEach((signal) => {
      if (typeof signal.latitude !== 'number' || typeof signal.longitude !== 'number') return;

      const marker = L.marker([signal.latitude, signal.longitude], { icon: customIcon });

      const evidenceCount = signal.evidence?.length || 0;
      const formattedDate = new Date(signal.incidentDate).toLocaleString('fr-FR', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });

      const popupContent = document.createElement('div');
      popupContent.className = 'map-popup';

      const title = document.createElement('h4');
      title.className = 'map-popup-title';
      title.textContent = signal.title;

      const location = document.createElement('div');
      location.className = 'map-popup-location';
      location.textContent = `${formattedDate} · ${signal.city || 'Lieu non précisé'}`;

      const incident = document.createElement('div');
      incident.className = 'map-popup-event';
      incident.textContent = `Incident : ${signal.incidentType.replace(/_/g, ' ')}`;

      const description = document.createElement('p');
      description.className = 'map-popup-description';
      description.textContent = signal.description;

      const evidence = document.createElement('div');
      evidence.className = 'map-popup-evidence';
      evidence.textContent = `${evidenceCount} preuve(s) jointe(s)`;

      popupContent.append(title, location, incident);
      if (signal.eventType && signal.eventType !== 'none') {
        const event = document.createElement('div');
        event.className = 'map-popup-event';
        event.textContent = `Contexte : ${EVENT_TYPE_LABELS[signal.eventType] || signal.eventType}${
          signal.eventName ? ` · ${signal.eventName}` : ''
        }`;
        popupContent.appendChild(event);
      }
      popupContent.append(description, evidence);

      const btn = document.createElement('button');
      btn.textContent = 'Détails du signalement';
      btn.className = 'map-popup-button';
      btn.onclick = () => onSelectSignal(signal);
      popupContent.appendChild(btn);

      marker.bindPopup(popupContent);
      marker.addTo(markersGroupRef.current!);
    });

    // Auto-fit bounds if signals exist
    const focus = focusRef.current;
    if (focus && signals.length > 0 && mapInstanceRef.current) {
      mapInstanceRef.current.setView([focus.latitude, focus.longitude], 18);
      onFocusHandled?.();
    } else if (signals.length > 0 && mapInstanceRef.current) {
      if (signals.length === 1) {
        const signal = signals[0];
        mapInstanceRef.current.setView([signal.latitude, signal.longitude], 19);
      } else {
        const bounds = L.latLngBounds(
          signals.map((s) => [s.latitude, s.longitude] as [number, number])
        );
        mapInstanceRef.current.fitBounds(bounds, { padding: [40, 40], maxZoom: 17 });
      }
    }
  }, [signals, onSelectSignal]);

  const handleCenterOnUser = async () => {
    try {
      setGeoLocating(true);
      const coords = await getCurrentGPSPosition();
      if (mapInstanceRef.current) {
        mapInstanceRef.current.setView([coords.latitude, coords.longitude], 14);
      }
    } catch (err: any) {
      alert(err.message || 'Impossible d’obtenir votre géolocalisation');
    } finally {
      setGeoLocating(false);
    }
  };

  return (
    <section className="map-page">
      <div className="map-heading">
        <div>
          <p className="map-eyebrow">OBSERVATOIRE CITOYEN</p>
          <h1>Carte des signalements</h1>
          <p className="map-heading-description">
            Consultez les faits documentés et validés par la communauté.
          </p>
        </div>
        <div className="map-total" aria-live="polite">
          <span className="map-total-number">{signals.length}</span>
          <span>signalement{signals.length === 1 ? '' : 's'} validé{signals.length === 1 ? '' : 's'}</span>
        </div>
      </div>

      {/* Search and Filter Controls */}
      <div className="map-filter-bar">
        <div className="map-filter-fields">
          <select
            className="form-select"
            aria-label="Filtrer par type de violence"
            value={filters.incidentType || ''}
            onChange={(e) => handleFilterChange({ ...filters, incidentType: e.target.value || undefined })}
          >
            <option value="">Tous types de violences</option>
            <option value="violence_physique">Violence physique</option>
            <option value="violence_verbale">Violence verbale / insultes</option>
            <option value="tir_lbd">Tir de LBD / lanceur</option>
            <option value="gaz_lacrymo">Gaz lacrymogène massif</option>
            <option value="grenade_desencerclement">Grenade de désencerclement</option>
            <option value="interpellation_violente">Interpellation violente</option>
            <option value="materiel_detruit">Matériel détruit (téléphone, etc.)</option>
            <option value="autre">Autre incident</option>
          </select>

          <input
            type="text"
            className="form-input"
            aria-label="Filtrer par ville"
            placeholder="Filtrer par ville..."
            value={filters.city || ''}
            onChange={(e) => handleFilterChange({ ...filters, city: e.target.value || undefined })}
          />
          {loading && (
            <span className="map-loading" role="status">
              Chargement...
            </span>
          )}
        </div>

        <div className="map-actions">
          <button
            className={`btn btn-secondary ${viewMode === 'map' ? 'active' : ''}`}
            onClick={() => setViewMode(viewMode === 'map' ? 'list' : 'map')}
            aria-label={`Afficher la vue ${viewMode === 'map' ? 'liste' : 'carte'}`}
            aria-pressed={viewMode === 'map'}
          >
            {viewMode === 'map' ? <List size={18} /> : <Layers size={18} />}
            <span>{viewMode === 'map' ? 'Liste' : 'Carte'}</span>
          </button>

          {viewMode === 'map' && (
            <button
              className="btn btn-secondary"
              onClick={handleCenterOnUser}
              disabled={geoLocating}
              aria-label="Centrer la carte sur ma position GPS"
            >
              <Navigation size={18} />
              <span>{geoLocating ? 'GPS...' : 'Ma position'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Map View */}
      {viewMode === 'map' ? (
        <div className="map-card">
          <div ref={mapContainerRef} className="map-container" />
          {tileError && (
            <div className="map-error" role="status">
              Le fond de carte n’a pas pu être chargé. Vérifiez votre connexion Internet.
            </div>
          )}
          <div className="map-caption">
            <span className="map-caption-dot" />
            <span>
              {signals.length === 0
                ? 'Aucun signalement validé pour le moment'
                : `${signals.length} signalement${signals.length === 1 ? '' : 's'} affiché${signals.length === 1 ? '' : 's'} sur la carte`}
            </span>
            <span className="map-caption-source">Fond de carte OpenStreetMap</span>
          </div>
        </div>
      ) : (
        /* Accessible List View */
        <div className="card map-list-card">
          <h3 className="card-title">
            <List size={20} /> Liste des signalements validés ({signals.length})
          </h3>
          {signals.length === 0 ? (
            <p style={{ color: 'var(--text-muted)' }}>Aucun signalement ne correspond à vos critères.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {signals.map((signal) => (
                <div
                  key={signal.id}
                  style={{
                    backgroundColor: 'var(--bg-input)',
                    padding: '0.75rem 1rem',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-color)',
                    cursor: 'pointer',
                  }}
                  onClick={() => onSelectSignal(signal)}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h4 style={{ fontSize: '1rem', fontWeight: 600 }}>{signal.title}</h4>
                    <span className="badge badge-red">{signal.incidentType.replace(/_/g, ' ')}</span>
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0.25rem 0' }}>
                    📅 {new Date(signal.incidentDate).toLocaleString('fr-FR')} | 📍{' '}
                    {signal.city || 'Ville non précisée'} {signal.address ? `(${signal.address})` : ''}
                  </div>
                  {signal.eventType && signal.eventType !== 'none' && (
                    <div style={{ fontSize: '0.8rem', color: 'var(--accent-blue)', marginBottom: '0.25rem' }}>
                      {EVENT_TYPE_LABELS[signal.eventType] || signal.eventType}
                      {signal.eventName ? ` · ${signal.eventName}` : ''}
                    </div>
                  )}
                  <p style={{ fontSize: '0.9rem', color: 'var(--text-main)' }}>{signal.description}</p>
                  {signal.evidence?.length > 0 && (
                    <div style={{ fontSize: '0.75rem', color: 'var(--accent-blue)', marginTop: '0.25rem' }}>
                      🔗 {signal.evidence.length} preuve(s) décentralisée(s) IPFS
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
};
