import React from 'react';
import { X, ExternalLink, ShieldCheck } from 'lucide-react';
import { Signal } from '../utils/api';
import { formatIpfsGatewayUrl } from '../utils/ipfs';

interface SignalDetailModalProps {
  signal: Signal | null;
  onClose: () => void;
}

export const SignalDetailModal: React.FC<SignalDetailModalProps> = ({ signal, onClose }) => {
  if (!signal) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
          <div>
            <span className="badge badge-red" style={{ marginBottom: '0.4rem' }}>
              {signal.incidentType.replace(/_/g, ' ')}
            </span>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 800 }}>{signal.title}</h2>
          </div>
          <button className="btn btn-outline" style={{ minHeight: '36px', padding: '0.2rem 0.5rem' }} onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <div>📅 Date des faits : {new Date(signal.incidentDate).toLocaleString('fr-FR')}</div>
          <div>📍 Localisation : {signal.address ? `${signal.address}, ` : ''}{signal.city} ({signal.department})</div>
          <div>🌐 Coordonnées GPS : {signal.latitude.toFixed(5)}, {signal.longitude.toFixed(5)}</div>
        </div>

        <div style={{ marginBottom: '1.25rem' }}>
          <h4 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.4rem' }}>Récit des faits</h4>
          <p style={{ whiteSpace: 'pre-line', fontSize: '0.9rem', lineHeight: 1.6, color: 'var(--text-main)' }}>
            {signal.description}
          </p>
        </div>

        {/* Evidence / Proofs */}
        {signal.evidence && signal.evidence.length > 0 && (
          <div style={{ marginBottom: '1.25rem' }}>
            <h4 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.4rem' }}>
              Preuves décentralisées IPFS ({signal.evidence.length})
            </h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {signal.evidence.map((ev) => (
                <div
                  key={ev.id}
                  style={{
                    backgroundColor: 'var(--bg-input)',
                    padding: '0.5rem 0.75rem',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-color)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontSize: '0.85rem',
                  }}
                >
                  <div>
                    <div>{ev.originalName}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      CID: {ev.cid.substring(0, 18)}...
                    </div>
                  </div>
                  <a
                    href={formatIpfsGatewayUrl(ev.cid)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-outline"
                    style={{ minHeight: '32px', padding: '0.2rem 0.6rem', fontSize: '0.8rem' }}
                  >
                    <ExternalLink size={14} /> Voir
                  </a>
                </div>
              ))}
            </div>
          </div>
        )}

        <div
          style={{
            borderTop: '1px solid var(--border-color)',
            paddingTop: '0.75rem',
            fontSize: '0.75rem',
            color: 'var(--text-dim)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem',
          }}
        >
          <ShieldCheck size={14} style={{ color: 'var(--accent-green)' }} />
          Signalement vérifié par la modération citoyenne AKAB et conservé de façon immuable.
        </div>
      </div>
    </div>
  );
};
