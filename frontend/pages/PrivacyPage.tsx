import React, { useState } from 'react';
import { Shield, Trash2, Key, CheckCircle2, Lock } from 'lucide-react';
import { API } from '../utils/api';

export const PrivacyPage: React.FC = () => {
  const [forgetToken, setForgetToken] = useState('');
  const [forgetLoading, setForgetLoading] = useState(false);
  const [forgetResult, setForgetResult] = useState<string | null>(null);
  const [forgetError, setForgetError] = useState<string | null>(null);

  const handleForgetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!forgetToken.trim()) return;

    try {
      setForgetLoading(true);
      setForgetError(null);
      setForgetResult(null);

      const res = await API.rightToBeForgotten(forgetToken.trim());
      setForgetResult(res.message);
      setForgetToken('');
    } catch (err: any) {
      setForgetError(err.message || 'Jeton invalide ou données déjà supprimées.');
    } finally {
      setForgetLoading(false);
    }
  };

  return (
    <div className="container" style={{ maxWidth: '800px' }}>
      <div className="card">
        <h2 className="card-title">
          <Shield size={22} style={{ color: 'var(--accent-green)' }} /> Politique de Confidentialité & RGPD
        </h2>
        <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
          La plateforme AKAB est conçue selon le principe de <strong>Privacy by Design</strong>. Nous
          collectons uniquement les informations strictement nécessaires à la documentation citoyenne
          des violences et protégeons l'identité des témoins et victimes.
        </p>
      </div>

      <div className="card">
        <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Lock size={18} style={{ color: 'var(--primary-red)' }} /> Règles de rétention des données
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', fontSize: '0.9rem', lineHeight: 1.6 }}>
          <div style={{ backgroundColor: 'var(--bg-input)', padding: '0.85rem', borderRadius: 'var(--radius-sm)', borderLeft: '4px solid var(--accent-yellow)' }}>
            <strong>1. Données de contact (Email / Téléphone) :</strong>
            <p style={{ margin: '0.25rem 0 0', color: 'var(--text-muted)' }}>
              Conservées au maximum <strong>30 jours</strong> uniquement pour permettre à la modération de vous contacter
              en cas de doute ou pour vous notifier du traitement de votre signalement. Au bout de 30 jours, notre
              tâche d'arrière-plan purge automatiquement et irréversiblement ces coordonnées.
            </p>
          </div>

          <div style={{ backgroundColor: 'var(--bg-input)', padding: '0.85rem', borderRadius: 'var(--radius-sm)', borderLeft: '4px solid var(--accent-green)' }}>
            <strong>2. Signalements validés (Intérêt public - RGPD Art. 89) :</strong>
            <p style={{ margin: '0.25rem 0 0', color: 'var(--text-muted)' }}>
              Les faits vérifiés (lieu, date, description, type de violence) et les preuves anonymisées sont conservés
              indéfiniment à des fins de recherche sociologique, d'analyse statistique et de défense des droits fondamentaux.
              Aucune donnée personnelle permettant d'identifier le déclarant n'y est rattachée.
            </p>
          </div>

          <div style={{ backgroundColor: 'var(--bg-input)', padding: '0.85rem', borderRadius: 'var(--radius-sm)', borderLeft: '4px solid var(--primary-red)' }}>
            <strong>3. Anonymisation des preuves médias :</strong>
            <p style={{ margin: '0.25rem 0 0', color: 'var(--text-muted)' }}>
              Les photos et vidéos subissent un masquage des visages et plaques d'immatriculation (bandeaux noirs)
              ainsi qu'une suppression complète des métadonnées EXIF (heure précise de prise de vue, modèle de téléphone, coordonnées GPS matérielles).
            </p>
          </div>
        </div>
      </div>

      {/* Right to be Forgotten Form */}
      <div className="card">
        <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Trash2 size={18} style={{ color: 'var(--primary-red)' }} /> Exercer le droit à l'oubli (Art. 17 RGPD)
        </h3>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
          Si vous avez fourni un email ou numéro lors de votre signalement, un <strong>jeton secret d'oubli</strong> vous
          a été délivré lors de la confirmation. Utilisez-le ici pour effacer immédiatement vos données personnelles sans
          attendre l'expiration automatique des 30 jours.
        </p>

        <form onSubmit={handleForgetSubmit}>
          <div className="form-group">
            <label className="form-label">
              <Key size={14} style={{ display: 'inline', marginRight: '4px' }} />
              Jeton secret d'oubli
            </label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                type="text"
                className="form-input"
                placeholder="Ex: fgt_xxxxxxxxxxxx"
                value={forgetToken}
                onChange={(e) => setForgetToken(e.target.value)}
                required
              />
              <button type="submit" className="btn btn-outline" style={{ color: 'var(--primary-red)', borderColor: 'var(--primary-red)' }} disabled={forgetLoading}>
                {forgetLoading ? 'Suppression...' : 'Supprimer mes données'}
              </button>
            </div>
          </div>
        </form>

        {forgetResult && (
          <div
            style={{
              backgroundColor: 'rgba(42, 157, 143, 0.2)',
              border: '1px solid var(--accent-green)',
              color: '#2ec4b6',
              padding: '0.75rem',
              borderRadius: 'var(--radius-sm)',
              marginTop: '0.75rem',
              fontSize: '0.85rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
            }}
          >
            <CheckCircle2 size={18} />
            <span>{forgetResult}</span>
          </div>
        )}

        {forgetError && (
          <div style={{ color: '#ff6b6b', fontSize: '0.85rem', marginTop: '0.75rem' }}>
            ⚠️ {forgetError}
          </div>
        )}
      </div>

      <div className="card" style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
        <h4 style={{ fontWeight: 700, color: 'var(--text-main)', marginBottom: '0.5rem' }}>Stockage décentralisé IPFS</h4>
        <p style={{ lineHeight: 1.5 }}>
          Les médias certifiés sont publiés sur le réseau décentralisé IPFS (InterPlanetary File System).
          Chaque document est identifié par son empreinte cryptographique (CID), garantissant son intégrité,
          l'absence d'altération et la résilience contre toute censure ou suppression unilatérale.
        </p>
      </div>
    </div>
  );
};
