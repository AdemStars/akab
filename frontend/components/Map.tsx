import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { API, Signal, SignalFilters } from '../utils/api';
import { getCurrentGPSPosition } from '../utils/geolocation';
import { Layers, List, Navigation } from 'lucide-react';

interface MapProps {
  signals?: Signal[];
  filters?: SignalFilters;
  onFilterChange?: (filters: SignalFilters) => void;
  onSelectSignal: (signal: Signal) => void;
}

export const MapComponent: React.FC<MapProps> = ({
  signals: propSignals,
  filters: propFilters,
  onFilterChange: propOnFilterChange,
  onSelectSignal,
}) => {
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

  // Initialize Leaflet map
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    // Default center: France
    const map = L.map(mapContainerRef.current, {
      center: [46.603354, 1.888334],
      zoom: 6,
      zoomControl: true,
    });

    // CartoDB Dark Matter tiles or OSM standard tiles
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, &copy; <a href="https://carto.com/attributions">CARTO</a>',
      maxZoom: 19,
    }).addTo(map);

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
      const formattedDate = new Date(signal.incidentDate).toLocaleDateString('fr-FR', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });

      const popupContent = document.createElement('div');
      popupContent.style.color = '#121418';
      popupContent.style.maxWidth = '240px';
      popupContent.innerHTML = `
        <h4 style="margin: 0 0 4px; font-size: 14px; font-weight: bold;">${signal.title}</h4>
        <div style="font-size: 12px; color: #666; margin-bottom: 4px;">
          📅 ${formattedDate} | 📍 ${signal.city || 'Lieu non précisé'}
        </div>
        <p style="margin: 4px 0 8px; font-size: 12px; max-height: 60px; overflow: hidden; text-overflow: ellipsis;">
          ${signal.description}
        </p>
        <div style="font-size: 11px; color: #457b9d; margin-bottom: 8px;">
          📷 ${evidenceCount} preuve(s) IPFS
        </div>
      `;

      const btn = document.createElement('button');
      btn.textContent = 'Détails du signalement';
      btn.style.cssText =
        'background: #e63946; color: white; border: none; padding: 4px 8px; border-radius: 4px; font-size: 12px; cursor: pointer; width: 100%;';
      btn.onclick = () => onSelectSignal(signal);
      popupContent.appendChild(btn);

      marker.bindPopup(popupContent);
      marker.addTo(markersGroupRef.current!);
    });

    // Auto-fit bounds if signals exist
    if (signals.length > 0 && mapInstanceRef.current) {
      const bounds = L.latLngBounds(
        signals.map((s) => [s.latitude, s.longitude] as [number, number])
      );
      mapInstanceRef.current.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
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
    <div>
      {/* Search and Filter Controls */}
      <div className="card map-filter-bar">
        <div style={{ display: 'flex', gap: '0.5rem', flex: 1, minWidth: '220px' }}>
          <select
            className="form-select"
            value={filters.incidentType || ''}
            onChange={(e) => handleFilterChange({ ...filters, incidentType: e.target.value || undefined })}
            style={{ flex: 1 }}
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
            placeholder="Filtrer par ville..."
            value={filters.city || ''}
            onChange={(e) => handleFilterChange({ ...filters, city: e.target.value || undefined })}
            style={{ flex: 1 }}
          />
          {loading && (
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', alignSelf: 'center' }}>
              Chargement...
            </span>
          )}
        </div>

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            className={`btn btn-secondary ${viewMode === 'map' ? 'active' : ''}`}
            onClick={() => setViewMode(viewMode === 'map' ? 'list' : 'map')}
            title="Basculer vue carte / liste"
          >
            {viewMode === 'map' ? <List size={18} /> : <Layers size={18} />}
            <span style={{ fontSize: '0.85rem' }}>{viewMode === 'map' ? 'Liste' : 'Carte'}</span>
          </button>

          {viewMode === 'map' && (
            <button
              className="btn btn-secondary"
              onClick={handleCenterOnUser}
              disabled={geoLocating}
              title="Centrer sur ma position GPS"
            >
              <Navigation size={18} />
              <span style={{ fontSize: '0.85rem' }}>{geoLocating ? 'GPS...' : 'Moi'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Map View */}
      {viewMode === 'map' ? (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div ref={mapContainerRef} className="map-container" />
          <div style={{ padding: '0.5rem 1rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            📍 <strong>{signals.length}</strong> signalement(s) validé(s) affiché(s) sur la carte
          </div>
        </div>
      ) : (
        /* Accessible List View */
        <div className="card">
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
                    📅 {new Date(signal.incidentDate).toLocaleDateString('fr-FR')} | 📍{' '}
                    {signal.city || 'Ville non précisée'} {signal.address ? `(${signal.address})` : ''}
                  </div>
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
    </div>
  );
};
