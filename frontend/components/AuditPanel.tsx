import React, { useCallback, useEffect, useState } from 'react';
import { ScrollText } from 'lucide-react';
import { API } from '../utils/api';

interface AuditPanelProps {
  token: string;
  onError: (err: unknown, fallback: string) => void;
}

const ACTION_LABELS: Record<string, string> = {
  login: 'Connexion',
  login_failed: 'Échec de connexion',
  login_blocked: 'Connexion bloquée (compte verrouillé)',
  account_locked: 'Compte verrouillé',
  signal_approval_vote: 'Approbation (en attente d’un second avis)',
  signal_published: 'Signalement publié',
  signal_force_published: 'Publication forcée',
  signal_rejected: 'Signalement rejeté',
  appeal_rejected: 'Recours rejeté',
  validator_created: 'Compte créé',
  validator_updated: 'Compte modifié',
  gdpr_cleanup: 'Nettoyage RGPD',
};

export const AuditPanel: React.FC<AuditPanelProps> = ({ token, onError }) => {
  const [entries, setEntries] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [action, setAction] = useState('');
  const [offset, setOffset] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await API.getAuditLog(token, action || undefined, offset);
      setEntries(res.entries || []);
      setTotal(res.total || 0);
    } catch (err) {
      onError(err, 'Impossible de charger le journal d’audit.');
    }
  }, [token, action, offset, onError]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="card">
      <h3 className="card-title">
        <ScrollText size={20} /> Journal d'audit ({total})
      </h3>
      <select
        className="form-select"
        aria-label="Filtrer par action"
        value={action}
        onChange={(e) => {
          setAction(e.target.value);
          setOffset(0);
        }}
        style={{ marginBottom: '0.75rem' }}
      >
        <option value="">Toutes les actions</option>
        {Object.entries(ACTION_LABELS).map(([value, label]) => (
          <option key={value} value={value}>{label}</option>
        ))}
      </select>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
        {entries.length === 0 && <p style={{ color: 'var(--text-muted)' }}>Aucune entrée.</p>}
        {entries.map((entry) => (
          <div
            key={entry.id}
            style={{
              padding: '0.5rem 0.75rem',
              backgroundColor: 'var(--bg-input)',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-color)',
              fontSize: '0.85rem',
            }}
          >
            <strong>{ACTION_LABELS[entry.action] || entry.action}</strong>
            {entry.targetId && <span> · {entry.targetType} #{entry.targetId}</span>}
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              {new Date(entry.createdAt).toLocaleString('fr-FR')} · {entry.actorEmail || 'inconnu'}
              {entry.ip ? ` · ${entry.ip}` : ''}
            </div>
            {entry.details?.reason && (
              <div style={{ fontSize: '0.8rem' }}>Motif : {String(entry.details.reason)}</div>
            )}
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
        <button className="btn btn-outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>
          Précédent
        </button>
        <button className="btn btn-outline" disabled={offset + 50 >= total} onClick={() => setOffset(offset + 50)}>
          Suivant
        </button>
      </div>
    </div>
  );
};
