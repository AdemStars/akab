import React, { useCallback, useEffect, useState } from 'react';
import { DatabaseBackup, HardDrive, RefreshCw, Wrench } from 'lucide-react';
import { API } from '../utils/api';

interface StoragePanelProps {
  token: string;
  onError: (err: unknown, fallback: string) => void;
}

function formatBytes(bytes?: number): string {
  if (!bytes) return '0 o';
  const units = ['o', 'Ko', 'Mo', 'Go', 'To'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** exponent).toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

export const StoragePanel: React.FC<StoragePanelProps> = ({ token, onError }) => {
  const [status, setStatus] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setStatus(await API.getStorageStatus(token));
    } catch (err) {
      onError(err, 'Impossible de lire l’état du stockage.');
    }
  }, [token, onError]);

  useEffect(() => {
    load();
  }, [load]);

  const run = async (action: () => Promise<any>, describe: (res: any) => string) => {
    setBusy(true);
    setMessage(null);
    setActionError(null);
    try {
      setMessage(describe(await action()));
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Action impossible.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h3 className="card-title">
        <HardDrive size={20} /> Nœuds de stockage chiffrés
      </h3>

      {!status ? (
        <p style={{ color: 'var(--text-muted)' }}>Chargement…</p>
      ) : !status.enabled ? (
        <p style={{ color: 'var(--text-muted)' }}>
          Aucun nœud configuré : les preuves sont conservées localement (IPFS / stockage de secours). Renseignez
          STORAGE_NODES et STORAGE_ENCRYPTION_KEY pour activer le stockage chiffré et répliqué.
        </p>
      ) : (
        <>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
            Chaque preuve est chiffrée avant l'envoi et copiée sur {status.replicas} nœud(s) ; l'écriture est validée
            dès {status.writeQuorum} copie(s).
          </p>
          {message && <div className="feedback-success" role="status">✓ {message}</div>}
          {actionError && <div className="feedback-error" role="alert">{actionError}</div>}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem' }}>
            {status.nodes.map((node: any) => (
              <div
                key={node.name}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: '0.5rem',
                  padding: '0.75rem 1rem',
                  backgroundColor: 'var(--bg-input)',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-color)',
                }}
              >
                <div>
                  <div style={{ fontWeight: 600 }}>
                    {node.name}{' '}
                    <span className={`badge ${node.reachable ? 'badge-green' : 'badge-red'}`}>
                      {node.reachable ? 'En ligne' : 'Hors ligne'}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{node.url}</div>
                </div>
                <div style={{ fontSize: '0.85rem', textAlign: 'right' }}>
                  {node.reachable ? (
                    <>
                      {node.blobs} bloc(s) · {formatBytes(node.bytes)}
                      {node.quotaBytes > 0 && ` / ${formatBytes(node.quotaBytes)}`}
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{node.latencyMs} ms</div>
                    </>
                  ) : (
                    <span style={{ color: '#ff6b6b' }}>{node.error}</span>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button className="btn btn-outline" disabled={busy} onClick={load}>
              <RefreshCw size={16} /> Actualiser
            </button>
            <button
              className="btn btn-outline"
              disabled={busy}
              onClick={() =>
                run(
                  () => API.repairStorage(token),
                  (res) =>
                    `Réplication vérifiée : ${res.report.scanned} bloc(s), ${res.report.copied} copie(s) ajoutée(s)` +
                    (res.report.failed ? `, ${res.report.failed} échec(s)` : '') +
                    (res.report.unreachableNodes.length ? ` — hors ligne : ${res.report.unreachableNodes.join(', ')}` : '')
                )
              }
            >
              <Wrench size={16} /> Réparer la réplication
            </button>
            <button
              className="btn btn-outline"
              disabled={busy}
              onClick={() =>
                run(
                  () => API.backupStorage(token),
                  (res) => `Base sauvegardée (chiffrée) sur ${res.report.storedOn.join(', ')}.`
                )
              }
            >
              <DatabaseBackup size={16} /> Sauvegarder la base
            </button>
          </div>
        </>
      )}
    </div>
  );
};
