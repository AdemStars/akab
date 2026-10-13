import React, { useState } from 'react';
import { HelpCircle, Send, CheckCircle2 } from 'lucide-react';
import { API, Signal } from '../utils/api';

export const AppealPage: React.FC = () => {
  const [signalId, setSignalId] = useState('');
  const [signal, setSignal] = useState<Signal | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [appealReason, setAppealReason] = useState('');
  const [submittingAppeal, setSubmittingAppeal] = useState(false);
  const [appealSuccess, setAppealSuccess] = useState(false);

  const handleSearchSignal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!signalId.trim()) return;

    try {
      setSearching(true);
      setSearchError(null);
      setSignal(null);
      setAppealSuccess(false);

      const res = await API.getSignalById(signalId.trim());
      setSignal(res);
    } catch (err: any) {
      setSearchError(err.message || 'Signalement introuvable. Vérifiez l’identifiant.');
    } finally {
      setSearching(false);
    }
  };

  const handleSendAppeal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!signal || !appealReason.trim()) return;

    try {
      setSubmittingAppeal(true);
      await API.submitAppeal(signal.id, appealReason.trim());
      setAppealSuccess(true);
      setSignal({ ...signal, status: 'under_appeal', appealReason: appealReason.trim() });
    } catch (err: any) {
      alert(err.message || 'Erreur lors du dépôt du recours');
    } finally {
      setSubmittingAppeal(false);
    }
  };

  return (
    <div className="container" style={{ maxWidth: '650px' }}>
      <div className="card">
        <h2 className="card-title">
          <HelpCircle size={22} /> Droit de Recours Citoyen
        </h2>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
          Si votre signalement a été rejeté par notre équipe de modération, vous disposez d'un droit de contestation
          pour apporter des précisions factuelles ou clarifier le contexte des violences constatées.
        </p>

        <form onSubmit={handleSearchSignal}>
          <div className="form-group">
            <label className="form-label">Identifiant de votre signalement (ex: sig_...)</label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                type="text"
                className="form-input"
                placeholder="sig_xxxxxxxx"
                value={signalId}
                onChange={(e) => setSignalId(e.target.value)}
                required
              />
              <button type="submit" className="btn btn-primary" disabled={searching}>
                {searching ? 'Recherche...' : 'Consulter'}
              </button>
            </div>
          </div>
        </form>

        {searchError && (
          <div style={{ color: '#ff6b6b', fontSize: '0.85rem', marginTop: '0.5rem' }}>
            ⚠️ {searchError}
          </div>
        )}
      </div>

      {/* Signal Status and Appeal Form */}
      {signal && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>{signal.title}</h3>
            <span
              className={`badge ${
                signal.status === 'validated'
                  ? 'badge-green'
                  : signal.status === 'under_appeal'
                  ? 'badge-yellow'
                  : 'badge-red'
              }`}
            >
              {signal.status === 'under_appeal'
                ? 'RECOURS EN COURS'
                : signal.status === 'rejected'
                ? 'REJETÉ'
                : signal.status === 'validated'
                ? 'VALIDÉ'
                : 'EN ATTENTE'}
            </span>
          </div>

          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
            📅 {new Date(signal.incidentDate).toLocaleString('fr-FR')} | 📍 {signal.city}
          </p>

          <p style={{ fontSize: '0.9rem', marginBottom: '1rem' }}>{signal.description}</p>

          {signal.rejectionReason && (
            <div
              style={{
                backgroundColor: 'rgba(230, 57, 70, 0.15)',
                borderLeft: '4px solid var(--primary-red)',
                padding: '0.75rem',
                borderRadius: 'var(--radius-sm)',
                marginBottom: '1.25rem',
                fontSize: '0.9rem',
              }}
            >
              <strong>Motif du rejet par les modérateurs :</strong>
              <div style={{ marginTop: '0.25rem' }}>{signal.rejectionReason}</div>
            </div>
          )}

          {appealSuccess ? (
            <div
              style={{
                backgroundColor: 'rgba(42, 157, 143, 0.2)',
                border: '1px solid var(--accent-green)',
                color: '#2ec4b6',
                padding: '1rem',
                borderRadius: 'var(--radius-md)',
                textAlign: 'center',
              }}
            >
              <CheckCircle2 size={32} style={{ margin: '0 auto 0.5rem' }} />
              <h4 style={{ fontWeight: 700 }}>Votre recours a bien été transmis</h4>
              <p style={{ fontSize: '0.85rem', marginTop: '0.25rem' }}>
                Un modérateur réexaminera votre signalement avec vos nouvelles explications.
              </p>
            </div>
          ) : signal.status === 'rejected' ? (
            <form onSubmit={handleSendAppeal}>
              <div className="form-group">
                <label className="form-label">Motif détaillé de votre recours *</label>
                <textarea
                  className="form-textarea"
                  rows={4}
                  placeholder="Expliquez pourquoi le signalement doit être réévalué (nouveaux éléments, précisions d'horaires, compléments d'informations...)"
                  value={appealReason}
                  onChange={(e) => setAppealReason(e.target.value)}
                  minLength={10}
                  maxLength={2000}
                  required
                />
              </div>

              <button type="submit" className="btn btn-primary btn-block" disabled={submittingAppeal}>
                <Send size={18} />
                {submittingAppeal ? 'Transmission...' : 'Déposer mon recours'}
              </button>
            </form>
          ) : signal.status === 'under_appeal' ? (
            <div
              style={{
                backgroundColor: 'rgba(233, 196, 106, 0.15)',
                border: '1px solid var(--accent-yellow)',
                padding: '0.75rem',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.85rem',
              }}
            >
              ⏳ Ce signalement fait déjà l'objet d'un recours en cours d'examen par la modération.
            </div>
          ) : (
            <div style={{ color: 'var(--accent-green)', fontSize: '0.9rem' }}>
              ✓ Ce signalement est validé et publié sur la carte publique. Aucun recours n'est nécessaire.
            </div>
          )}
        </div>
      )}
    </div>
  );
};
