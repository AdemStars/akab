import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  CheckCircle,
  XCircle,
  Award,
  RefreshCw,
  LogOut,
  ExternalLink,
} from 'lucide-react';
import { API, ApiError, Signal } from '../utils/api';
import { TeamPanel } from './TeamPanel';
import { AuditPanel } from './AuditPanel';
import { formatIpfsGatewayUrl } from '../utils/ipfs';
import {
  EVENT_TYPE_LABELS,
  formatGpsAccuracy,
  formatGpsCoordinates,
  VICTIM_AGE_GROUP_LABELS,
} from '../utils/signalLabels';

export const AdminDashboard: React.FC = () => {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('akab_admin_token'));
  const [user, setUser] = useState<any>(() => {
    try {
      return JSON.parse(localStorage.getItem('akab_admin_user') || 'null');
    } catch {
      return null;
    }
  });

  // Login form state
  const [email, setEmail] = useState('admin@akab.local');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);

  // Dashboard state
  const [signals, setSignals] = useState<Signal[]>([]);
  const [statusTab, setStatusTab] = useState<'pending' | 'under_appeal' | 'validated' | 'rejected' | 'validators' | 'team' | 'audit'>(
    'pending'
  );
  const [searchTerm, setSearchTerm] = useState('');
  const [loadingSignals, setLoadingSignals] = useState(false);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [validatorsList, setValidatorsList] = useState<any[]>([]);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [dashboardError, setDashboardError] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    try {
      setLoggingIn(true);
      const res = await API.adminLogin(email, password);
      setToken(res.token);
      setUser(res.user);
      localStorage.setItem('akab_admin_token', res.token);
      localStorage.setItem('akab_admin_user', JSON.stringify(res.user));
    } catch (err: any) {
      setLoginError(err.message || 'Identifiants invalides');
    } finally {
      setLoggingIn(false);
    }
  };

  const handleLogout = () => {
    setToken(null);
    setUser(null);
    localStorage.removeItem('akab_admin_token');
    localStorage.removeItem('akab_admin_user');
  };

  const handleDashboardError = (err: unknown, fallback: string) => {
    if (err instanceof ApiError && err.status === 401) {
      handleLogout();
      setLoginError('Votre session a expiré. Veuillez vous reconnecter.');
      return;
    }
    setDashboardError(err instanceof Error ? err.message : fallback);
  };

  const loadSignals = async () => {
    if (!token) return;
    try {
      setLoadingSignals(true);
      setDashboardError(null);
      if (statusTab === 'team' || statusTab === 'audit') {
        return;
      }
      if (statusTab === 'validators') {
        const valRes = await API.getValidators(token);
        setValidatorsList(valRes.validators || []);
      } else {
        const res = await API.getAdminSignals(token, statusTab, searchTerm);
        setSignals(res.signals || []);
      }
    } catch (err) {
      handleDashboardError(err, 'Impossible de charger les données de modération.');
    } finally {
      setLoadingSignals(false);
    }
  };

  useEffect(() => {
    if (token) {
      loadSignals();
    }
  }, [token, statusTab, searchTerm]);

  const handleValidate = async (signalId: string, force = false) => {
    if (!token) return;
    if (force && !window.confirm('Publier immédiatement sans second avis ? Cette action est tracée.')) return;
    try {
      const res = await API.validateSignal(token, signalId, force);
      if (res.finalized) {
        setActionSuccess(`Signalement #${signalId} publié ! (+${res.pointsAwarded || 10} points de confiance)`);
        if (user) {
          setUser({ ...user, trustPoints: (user.trustPoints || 0) + (res.pointsAwarded || 10) });
        }
      } else {
        setActionSuccess(res.message);
      }
      setTimeout(() => setActionSuccess(null), 5000);
      loadSignals();
    } catch (err) {
      handleDashboardError(err, 'Erreur de validation.');
    }
  };

  const handleReject = async (signalId: string) => {
    if (!token || !rejectReason.trim()) return;
    try {
      await API.rejectSignal(token, signalId, rejectReason.trim());
      setActionSuccess(`Signalement #${signalId} rejeté.`);
      setRejectingId(null);
      setRejectReason('');
      setTimeout(() => setActionSuccess(null), 4000);
      loadSignals();
    } catch (err) {
      handleDashboardError(err, 'Erreur lors du rejet.');
    }
  };

  // Login View
  if (!token) {
    return (
      <section className="page-shell page-shell-narrow">
        <header className="page-heading">
          <p className="page-eyebrow">ESPACE SÉCURISÉ</p>
          <h1>Modération citoyenne</h1>
          <p>Examinez les signalements et décidez de leur publication.</p>
        </header>
        <div className="card">
          <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
            <ShieldCheck size={48} style={{ color: 'var(--primary-red)', margin: '0 auto 0.5rem' }} />
            <h2 style={{ fontSize: '1.4rem' }}>Espace Modération AKAB</h2>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              Validation manuelle des signalements avec points de confiance
            </p>
          </div>

          <form onSubmit={handleLogin}>
            <div className="form-group">
              <label className="form-label">Email modérateur</label>
              <input
                type="email"
                className="form-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">Mot de passe</label>
              <input
                type="password"
                className="form-input"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            {loginError && (
              <div className="feedback-error" role="alert">
                ⚠️ {loginError}
              </div>
            )}

            <button type="submit" className="btn btn-primary btn-block" disabled={loggingIn}>
              {loggingIn ? 'Connexion en cours...' : 'Se connecter'}
            </button>
          </form>
        </div>
      </section>
    );
  }

  return (
    <section className="page-shell page-shell-wide">
      <header className="page-heading">
        <p className="page-eyebrow">ESPACE SÉCURISÉ</p>
        <h1>Modération citoyenne</h1>
        <p>Examinez les éléments, le contexte et la localisation avant chaque décision de publication.</p>
      </header>
      {/* Top Moderator Card */}
      <div
        className="card"
        style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 700 }}>{user?.name || 'Modérateur'}</h2>
            <span className="badge badge-green">{user?.role === 'admin' ? 'Administrateur' : 'Modérateur'}</span>
          </div>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Award size={16} style={{ color: 'var(--accent-yellow)' }} />
            <strong>{user?.trustPoints || 100} points de confiance</strong>
            {user?.trustPoints >= 200 && <span style={{ color: 'var(--accent-green)' }}>(Privilège validation rapide)</span>}
          </div>
        </div>

        <button className="btn btn-outline" onClick={handleLogout} style={{ minHeight: '36px', padding: '0.3rem 0.8rem' }}>
          <LogOut size={16} /> Déconnexion
        </button>
      </div>

      {actionSuccess && (
        <div
          style={{
            backgroundColor: 'rgba(42, 157, 143, 0.2)',
            border: '1px solid var(--accent-green)',
            color: '#2ec4b6',
            borderRadius: 'var(--radius-md)',
            padding: '0.75rem 1rem',
            marginBottom: '1rem',
            fontSize: '0.9rem',
          }}
        >
          ✓ {actionSuccess}
        </div>
      )}

      {dashboardError && (
        <div className="feedback-error" role="alert">
          <span>{dashboardError}</span>
          <button className="btn btn-outline" onClick={loadSignals} disabled={loadingSignals}>
            <RefreshCw size={16} /> Réessayer
          </button>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
        <button
          className={`btn ${statusTab === 'pending' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setStatusTab('pending')}
        >
          En attente
        </button>
        <button
          className={`btn ${statusTab === 'under_appeal' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setStatusTab('under_appeal')}
        >
          Recours citoyens
        </button>
        <button
          className={`btn ${statusTab === 'validated' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setStatusTab('validated')}
        >
          Validés
        </button>
        <button
          className={`btn ${statusTab === 'rejected' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setStatusTab('rejected')}
        >
          Rejetés
        </button>
        <button
          className={`btn ${statusTab === 'validators' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setStatusTab('validators')}
        >
          Classement modérateurs
        </button>
        {user?.role === 'admin' && (
          <>
            <button
              className={`btn ${statusTab === 'team' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setStatusTab('team')}
            >
              Équipe
            </button>
            <button
              className={`btn ${statusTab === 'audit' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setStatusTab('audit')}
            >
              Journal d'audit
            </button>
          </>
        )}
      </div>

      {/* Signals Queue */}
      {statusTab === 'team' ? (
        <TeamPanel token={token} currentUserId={user?.id} onError={handleDashboardError} />
      ) : statusTab === 'audit' ? (
        <AuditPanel token={token} onError={handleDashboardError} />
      ) : statusTab !== 'validators' ? (
        <div>
          {/* Search bar */}
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
            <input
              type="text"
              className="form-input"
              placeholder="Rechercher par titre, ville, mot-clé..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            <button className="btn btn-secondary" onClick={loadSignals}>
              <RefreshCw size={18} />
            </button>
          </div>

          {loadingSignals ? (
            <p style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>Chargement...</p>
          ) : signals.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
              Aucun signalement dans cette file de traitement.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {signals.map((sig) => (
                <div key={sig.id} className="card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <div>
                      <h3 style={{ fontSize: '1.15rem', fontWeight: 700 }}>{sig.title}</h3>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0.2rem 0' }}>
                        ID: #{sig.id} | 📅 {new Date(sig.incidentDate).toLocaleString('fr-FR')} | 📍 {sig.city} ({sig.department})
                        <br />
                        GPS : {formatGpsCoordinates(sig.latitude, sig.longitude)}
                        {formatGpsAccuracy(sig.locationAccuracyMeters) &&
                          ` · précision mesurée ${formatGpsAccuracy(sig.locationAccuracyMeters)}`}
                      </div>
                    </div>
                    <span className={`badge ${sig.status === 'validated' ? 'badge-green' : sig.status === 'under_appeal' ? 'badge-yellow' : 'badge-red'}`}>
                      {sig.status === 'under_appeal' ? 'RECOURS DÉPOSÉ' : sig.status}
                    </span>
                  </div>

                  <div className="admin-signal-context">
                    <span>
                      Mouvement : {EVENT_TYPE_LABELS[sig.eventType] || sig.eventType}
                      {sig.eventName ? ` · ${sig.eventName}` : ''}
                    </span>
                    <span>
                      Victime : {VICTIM_AGE_GROUP_LABELS[sig.victimAgeGroup || 'unknown'] || 'Âge non connu'}
                    </span>
                  </div>

                  {sig.appealReason && (
                    <div
                      style={{
                        backgroundColor: 'rgba(233, 196, 106, 0.15)',
                        borderLeft: '4px solid var(--accent-yellow)',
                        padding: '0.5rem 0.75rem',
                        margin: '0.75rem 0',
                        fontSize: '0.85rem',
                      }}
                    >
                      <strong>Motif du recours citoyen :</strong> {sig.appealReason}
                    </div>
                  )}

                  {sig.rejectionReason && (
                    <div
                      style={{
                        backgroundColor: 'rgba(230, 57, 70, 0.15)',
                        borderLeft: '4px solid var(--primary-red)',
                        padding: '0.5rem 0.75rem',
                        margin: '0.75rem 0',
                        fontSize: '0.85rem',
                      }}
                    >
                      <strong>Motif de rejet initial :</strong> {sig.rejectionReason}
                    </div>
                  )}

                  <p style={{ margin: '0.75rem 0', fontSize: '0.95rem' }}>{sig.description}</p>

                  {/* Evidence / IPFS Proofs */}
                  {sig.evidence && sig.evidence.length > 0 && (
                    <div style={{ margin: '0.75rem 0' }}>
                      <h4 style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
                        Preuves décentralisées IPFS ({sig.evidence.length}) :
                      </h4>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                        {sig.evidence.map((ev) => (
                          <a
                            key={ev.id}
                            href={formatIpfsGatewayUrl(ev.cid)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn btn-outline"
                            style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem', minHeight: '30px' }}
                          >
                            <ExternalLink size={14} /> CID: {ev.cid.substring(0, 12)}...
                          </a>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Actions for Pending / Appeal */}
                  {(sig.status === 'pending' || sig.status === 'under_appeal') && (
                    <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '0.75rem', marginTop: '0.75rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                      {sig.moderation && (
                        <div style={{ flexBasis: '100%', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                          Approbations : {sig.moderation.approvals}/{sig.moderation.required}
                          {sig.moderation.approvedByMe && ' · vous avez déjà approuvé'}
                          {sig.moderation.rejectedByMe && ' · vous ne pouvez pas traiter ce recours (rejet initial)'}
                        </div>
                      )}
                      <button
                        className="btn btn-success"
                        style={{ flex: 1 }}
                        disabled={sig.moderation?.approvedByMe || sig.moderation?.rejectedByMe}
                        onClick={() => handleValidate(sig.id)}
                      >
                        <CheckCircle size={18} /> Approuver ({sig.moderation?.approvals ?? 0}/{sig.moderation?.required ?? 2})
                      </button>
                      {user?.role === 'admin' && (
                        <button
                          className="btn btn-outline"
                          disabled={sig.moderation?.rejectedByMe}
                          onClick={() => handleValidate(sig.id, true)}
                        >
                          Publier (forcer)
                        </button>
                      )}

                      <button
                        className="btn btn-outline"
                        style={{ flex: 1, color: '#ff6b6b' }}
                        disabled={sig.moderation?.rejectedByMe}
                        onClick={() => setRejectingId(rejectingId === sig.id ? null : sig.id)}
                      >
                        <XCircle size={18} /> Rejeter
                      </button>
                    </div>
                  )}

                  {/* Rejection input dialog */}
                  {rejectingId === sig.id && (
                    <div style={{ marginTop: '0.75rem', padding: '0.75rem', backgroundColor: 'var(--bg-input)', borderRadius: 'var(--radius-sm)' }}>
                      <label className="form-label">Motif de rejet (obligatoire pour information du citoyen) :</label>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="ex: Preuves non vérifiables ou localisation imprécise"
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                        style={{ marginBottom: '0.5rem' }}
                      />
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button
                          className="btn btn-primary"
                          style={{ flex: 1 }}
                          onClick={() => handleReject(sig.id)}
                          disabled={!rejectReason.trim()}
                        >
                          Confirmer le rejet
                        </button>
                        <button
                          className="btn btn-outline"
                          onClick={() => {
                            setRejectingId(null);
                            setRejectReason('');
                          }}
                        >
                          Annuler
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        /* Validators Leaderboard */
        <div className="card">
          <h3 className="card-title">
            <Award size={20} /> Tableau d'honneur des modérateurs
          </h3>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
            Les points de confiance récompensent la réactivité et la précision des modérations citoyennes.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {validatorsList.map((val, idx) => (
              <div
                key={val.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '0.75rem 1rem',
                  backgroundColor: 'var(--bg-input)',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-color)',
                }}
              >
                <div>
                  <div style={{ fontWeight: 600 }}>
                    #{idx + 1} {val.name} ({val.role})
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    Validations : {val.validationsCount || 0} | Rejets : {val.rejectionsCount || 0}
                  </div>
                </div>

                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--accent-yellow)' }}>
                    {val.trustPoints} pts
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
};
