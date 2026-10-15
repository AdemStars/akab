# Nœud de stockage AKAB

Un nœud est un petit coffre de blocs **sans dépendance** (Node.js ≥ 18, ou une image Docker de ~50 Mo).
Il ne voit jamais de données en clair : le backend AKAB chiffre chaque preuve et chaque sauvegarde
(AES-256-GCM, clé dérivée par bloc) avant de l'envoyer. Un nœud compromis, saisi ou hébergé chez un tiers
ne révèle donc ni le contenu, ni le type de fichier, ni les noms.

## Déployer un nœud

Sur n'importe quelle machine (VPS, Raspberry Pi, NAS, serveur associatif, SteamOS…) :

```bash
# Docker / Podman
export NODE_TOKEN="$(openssl rand -hex 32)"      # à conserver : il va dans STORAGE_NODES
docker compose up -d --build                      # écoute sur le port 7000

# ou sans conteneur
NODE_TOKEN=... DATA_DIR=/var/lib/akab-node node server.js
```

| Variable | Rôle | Défaut |
|---|---|---|
| `NODE_TOKEN` | Jeton d'accès (≥ 32 caractères, obligatoire) | — |
| `PORT` / `HOST` | Adresse d'écoute | `7000` / `0.0.0.0` |
| `DATA_DIR` | Dossier des données | `./data` |
| `MAX_BLOB_BYTES` | Taille maximale d'un bloc | 100 Mo |
| `QUOTA_BYTES` | Quota total (0 = illimité) | 0 |
| `TLS_CERT` / `TLS_KEY` | Active HTTPS directement | — |

**Hors réseau privé, exposez le nœud en HTTPS** : certificat via `TLS_CERT`/`TLS_KEY`, proxy inverse
(Caddy, Nginx), ou tunnel (WireGuard, Tailscale, Cloudflare Tunnel). Le jeton circule dans l'en-tête `Authorization`.

## Relier les nœuds à AKAB

Dans `.env` du backend :

```bash
STORAGE_ENCRYPTION_KEY=$(openssl rand -hex 32)   # SAUVEGARDEZ-LA HORS SERVEUR : sans elle, tout est illisible
STORAGE_NODES='[{"name":"paris","url":"https://node1.example.org","token":"…"},
                {"name":"nas","url":"http://192.168.1.20:7000","token":"…"},
                {"name":"vps","url":"https://node3.example.org","token":"…"}]'
STORAGE_REPLICAS=2        # copies de chaque bloc
STORAGE_WRITE_QUORUM=1    # copies nécessaires pour valider un envoi (≤ STORAGE_REPLICAS)
```

- Le placement des blocs est déterministe (hachage de rendez-vous) : ajouter un nœud ne déplace qu'une
  petite partie des blocs, et la lecture sait où chercher en premier.
- La lecture essaie les autres nœuds si une copie manque ou est corrompue (empreinte SHA-256 vérifiée).
- Une tâche périodique (`STORAGE_REPAIR_INTERVAL_MINUTES`) recopie les blocs manquants ; l'onglet
  **Modération → Stockage** montre l'état des nœuds et permet de lancer la réparation à la main.
- Si trop de nœuds sont hors ligne, l'envoi est refusé (503) : jamais de repli silencieux vers du stockage non chiffré.

## Sauvegarde et reprise après sinistre

La base SQLite est sauvegardée chiffrée sur les nœuds (`STORAGE_BACKUP_INTERVAL_HOURS`, ou bouton
« Sauvegarder la base »). Pour reconstruire un serveur neuf, il suffit de `STORAGE_NODES` et de la clé :

```bash
docker compose run --rm backend node dist/jobs/restore.js /app/data/akab.sqlite
```

## Protocole (pour écrire un autre type de nœud)

Toutes les routes, sauf `/v1/health`, demandent `Authorization: Bearer <NODE_TOKEN>`.

| Route | Rôle |
|---|---|
| `GET /v1/health` | Sonde de vie |
| `GET /v1/status` | `{ blobs, bytes, quotaBytes }` |
| `GET /v1/blobs` | `{ ids: [...] }` |
| `PUT /v1/blobs/:sha256` | Stocke un bloc ; refusé si l'empreinte ne correspond pas |
| `GET` / `HEAD` / `DELETE /v1/blobs/:sha256` | Lit, teste, supprime |
| `GET` / `PUT /v1/pointers/:nom` | Petite valeur modifiable (≤ 4 Ko), sert à retrouver la dernière sauvegarde |

## Tests

```bash
cd storage-node && npm test
```
