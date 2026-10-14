import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Info, MapPin, Calendar, Flag } from 'lucide-react';
import { API, Signal } from '../utils/api';
import { formatIpfsGatewayUrl } from '../utils/ipfs';
import { EVENT_TYPE_LABELS, INCIDENT_TYPE_OPTIONS } from '../utils/signalLabels';

interface FeedProps {
  onSelectSignal: (signal: Signal) => void;
  onShowOnMap: (signal: Signal) => void;
}

const MAX_DESCRIPTION = 280;

export const Feed: React.FC<FeedProps> = ({ onSelectSignal, onShowOnMap }) => {
  const [allSignals, setAllSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [typeFilter, setTypeFilter] = useState('');
  const [cityFilter, setCityFilter] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    API
      .getSignals({})
      .then(({ signals: list }) =>
        setAllSignals(
          [...list].sort(
            (a, b) => new Date(b.incidentDate).getTime() - new Date(a.incidentDate).getTime()
          )
        )
      )
      .catch((err) => setError(err instanceof Error ? err.message : 'Chargement impossible'))
      .finally(() => setLoading(false));
  }, []);

  const signals = useMemo(() => {
    const city = cityFilter.trim().toLowerCase();
    return allSignals.filter(
      (sig) =>
        (!typeFilter || sig.incidentType === typeFilter) &&
        (!city || (sig.city || '').toLowerCase().includes(city))
    );
  }, [allSignals, typeFilter, cityFilter]);

  useEffect(() => {
    setIndex(0);
    if (containerRef.current) containerRef.current.scrollTop = 0;
  }, [typeFilter, cityFilter]);

  const goTo = useCallback((next: number) => {
    const container = containerRef.current;
    if (!container) return;
    const target = container.children[next] as HTMLElement | undefined;
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const handleScroll = () => {
    const container = containerRef.current;
    if (!container || container.clientHeight === 0) return;
    setIndex(Math.round(container.scrollTop / container.clientHeight));
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'PageDown') {
      event.preventDefault();
      goTo(Math.min(index + 1, signals.length - 1));
    } else if (event.key === 'ArrowUp' || event.key === 'PageUp') {
      event.preventDefault();
      goTo(Math.max(index - 1, 0));
    }
  };

  if (loading) return <div className="feed-state">Chargement du fil…</div>;
  if (error) return <div className="feed-state" role="alert">{error}</div>;
  if (allSignals.length === 0) {
    return <div className="feed-state">Aucun signalement validé pour le moment.</div>;
  }

  return (
    <div className="feed-wrapper">
      <div className="feed-filters">
        <select
          className="form-select"
          aria-label="Filtrer le fil par type de violence"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
        >
          <option value="">Tous types de violences</option>
          {INCIDENT_TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <input
          type="text"
          className="form-input"
          aria-label="Filtrer le fil par ville"
          placeholder="Ville..."
          value={cityFilter}
          onChange={(e) => setCityFilter(e.target.value)}
        />
      </div>
      {signals.length === 0 && (
        <div className="feed-state">Aucun signalement ne correspond à ces filtres.</div>
      )}
      <div
        className="feed"
        ref={containerRef}
        onScroll={handleScroll}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        aria-label="Fil des signalements"
      >
        {signals.map((signal, i) => {
          const media = signal.evidence?.find(
            (ev) => ev.isVideo || ev.mimeType?.startsWith('image/') || ev.mimeType?.startsWith('video/')
          );
          const isVideo = !!media && (media.isVideo || media.mimeType?.startsWith('video/'));
          const near = Math.abs(i - index) <= 1;
          const description =
            signal.description.length > MAX_DESCRIPTION
              ? `${signal.description.slice(0, MAX_DESCRIPTION)}…`
              : signal.description;
          return (
            <article className="feed-card" key={signal.id}>
              {media && near && (
                isVideo ? (
                  <video
                    className="feed-media"
                    src={formatIpfsGatewayUrl(media.cid)}
                    muted
                    loop
                    playsInline
                    autoPlay={i === index}
                    controls
                  />
                ) : (
                  <img className="feed-media" src={formatIpfsGatewayUrl(media.cid)} alt="" />
                )
              )}
              <div className="feed-overlay">
                <div className="feed-badges">
                  <span className="badge badge-red">{signal.incidentType.replace(/_/g, ' ')}</span>
                  {signal.eventType && signal.eventType !== 'none' && (
                    <span className="badge">
                      <Flag size={12} /> {EVENT_TYPE_LABELS[signal.eventType] || signal.eventType}
                      {signal.eventName ? ` · ${signal.eventName}` : ''}
                    </span>
                  )}
                </div>
                <h2 className="feed-title">{signal.title}</h2>
                <div className="feed-meta">
                  <span><Calendar size={14} /> {new Date(signal.incidentDate).toLocaleString('fr-FR')}</span>
                  <span>
                    <MapPin size={14} /> {[signal.city, signal.department].filter(Boolean).join(' · ') || 'Lieu précisé sur la carte'}
                  </span>
                </div>
                <p className="feed-description">{description}</p>
                <div className="feed-actions">
                  <button className="btn btn-outline" onClick={() => onSelectSignal(signal)}>
                    <Info size={16} /> Détails et preuves
                  </button>
                  <button className="btn btn-outline" onClick={() => onShowOnMap(signal)}>
                    <MapPin size={16} /> Voir sur la carte
                  </button>
                </div>
              </div>
              <div className="feed-counter">{i + 1} / {signals.length}</div>
            </article>
          );
        })}
      </div>
      <div className="feed-controls">
        <button className="feed-arrow" aria-label="Signalement précédent" disabled={index <= 0} onClick={() => goTo(index - 1)}>
          <ChevronUp size={22} />
        </button>
        <button className="feed-arrow" aria-label="Signalement suivant" disabled={index >= signals.length - 1} onClick={() => goTo(index + 1)}>
          <ChevronDown size={22} />
        </button>
      </div>
    </div>
  );
};
