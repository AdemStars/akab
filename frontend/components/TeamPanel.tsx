import React, { useCallback, useEffect, useState } from 'react';
import { KeyRound, UserPlus, UserCheck, UserX } from 'lucide-react';
import { API } from '../utils/api';

interface TeamPanelProps {
  token: string;
  currentUserId: string;
  onError: (err: unknown, fallback: string) => void;
}

const MIN_PASSWORD_LENGTH = 12;

export const TeamPanel: React.FC<TeamPanelProps> = ({ token, currentUserId, onError }) => {
  const [validators, setValidators] = useState<any[]>([]);
  const [form, setForm] = useState({ email: '', name: '', password: '', role: 'moderator' as 'admin' | 'moderator' });
  const [message, setMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [resetId, setResetId] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await API.getValidators(token);
      setValidators(res.validators || []);
    } catch (err) {
      onError(err, 'Impossible de charger l’équipe.');
    }
  }, [token, onError]);

  useEffect(() => {
    load();
  }, [load]);

  const run = async (action: () => Promise<unknown>, success: string) => {
    setFormError(null);
    setMessage(null);
    try {
      await action();
      setMessage(success);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Action impossible.');
    }
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (form.password.length < MIN_PASSWORD_LENGTH) {
      setFormError(`Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères.`);
      return;
    }
    run(async () => {
      await API.createValidator(token, form);
      setForm({ email: '', name: '', password: '', role: 'moderator' });
    }, 'Compte créé.');
  };

  return (
    <div className="card">
      <h3 className="card-title">
        <UserPlus size={20} /> Équipe de modération
      </h3>
      {message && <div className="feedback-success" role="status">✓ {message}</div>}
      {formError && <div className="feedback-error" role="alert">{formError}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.25rem' }}>
        {validators.map((val) => {
          const isSelf = val.id === currentUserId;
          const locked = val.lockedUntil && new Date(val.lockedUntil).getTime() > Date.now();
          return (
            <div
              key={val.id}
              style={{
                padding: '0.75rem 1rem',
                backgroundColor: 'var(--bg-input)',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-color)',
                opacity: val.isActive ? 1 : 0.6,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                <div>
                  <div style={{ fontWeight: 600 }}>
                    {val.name} {isSelf && '(vous)'}
                    <span className="badge" style={{ marginLeft: '0.5rem' }}>
                      {val.role === 'admin' ? 'Administrateur' : 'Modérateur'}
                    </span>
                    {!val.isActive && <span className="badge badge-red" style={{ marginLeft: '0.5rem' }}>Désactivé</span>}
                    {locked && <span className="badge badge-yellow" style={{ marginLeft: '0.5rem' }}>Verrouillé</span>}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    {val.email} · dernière connexion :{' '}
                    {val.lastLoginAt ? new Date(val.lastLoginAt).toLocaleString('fr-FR') : 'jamais'}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                  <button
                    className="btn btn-outline"
                    disabled={isSelf}
                    onClick={() =>
                      run(
                        () => API.updateValidator(token, val.id, { role: val.role === 'admin' ? 'moderator' : 'admin' }),
                        'Rôle mis à jour.'
                      )
                    }
                  >
                    {val.role === 'admin' ? 'Rétrograder' : 'Promouvoir admin'}
                  </button>
                  <button
                    className="btn btn-outline"
                    disabled={isSelf}
                    onClick={() =>
                      run(() => API.updateValidator(token, val.id, { isActive: !val.isActive }), 'Compte mis à jour.')
                    }
                  >
                    {val.isActive ? <><UserX size={14} /> Désactiver</> : <><UserCheck size={14} /> Réactiver</>}
                  </button>
                  <button className="btn btn-outline" onClick={() => setResetId(resetId === val.id ? null : val.id)}>
                    <KeyRound size={14} /> Mot de passe
                  </button>
                </div>
              </div>
              {resetId === val.id && (
                <form
                  style={{ display: 'flex', gap: '0.5rem', marginTop: '0.6rem' }}
                  onSubmit={(e) => {
                    e.preventDefault();
                    run(async () => {
                      await API.updateValidator(token, val.id, { password: newPassword });
                      setResetId(null);
                      setNewPassword('');
                    }, 'Mot de passe réinitialisé ; ses sessions ouvertes sont fermées.');
                  }}
                >
                  <input
                    type="password"
                    className="form-input"
                    autoComplete="new-password"
                    placeholder={`Nouveau mot de passe (${MIN_PASSWORD_LENGTH}+ caractères)`}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    minLength={MIN_PASSWORD_LENGTH}
                    required
                  />
                  <button type="submit" className="btn btn-primary">Valider</button>
                </form>
              )}
            </div>
          );
        })}
      </div>

      <h4 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.5rem' }}>Ajouter un compte</h4>
      <form onSubmit={handleCreate} style={{ display: 'grid', gap: '0.5rem' }}>
        <input className="form-input" placeholder="Nom" aria-label="Nom" value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        <input type="email" className="form-input" placeholder="Email" aria-label="Email" value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })} required />
        <input type="password" className="form-input" autoComplete="new-password"
          placeholder={`Mot de passe (${MIN_PASSWORD_LENGTH}+ caractères)`} aria-label="Mot de passe" value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })} required />
        <select className="form-select" aria-label="Rôle" value={form.role}
          onChange={(e) => setForm({ ...form, role: e.target.value as 'admin' | 'moderator' })}>
          <option value="moderator">Modérateur</option>
          <option value="admin">Administrateur</option>
        </select>
        <button type="submit" className="btn btn-primary">Créer le compte</button>
      </form>
    </div>
  );
};
