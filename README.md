# AKAB - Plateforme Décentralisée de Signalement des Violences Policières

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4-blue)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18.3-cyan)](https://react.dev/)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-green)](https://nodejs.org/)
[![IPFS](https://img.shields.io/badge/Storage-IPFS-teal)](https://ipfs.tech/)
[![GDPR](https://img.shields.io/badge/RGPD-Compliant-brightgreen)](https://www.cnil.fr/)

Plateforme web **mobile-first et décentralisée** permettant aux citoyens et observateurs de signaler, documenter et cartographier les violences policières en France, avec preuves médias vérifiées (photos/vidéos), géolocalisation précise, modération communautaire et strict respect du RGPD.

---

## 📋 Table des matières

1. [Fonctionnalités clés](#-fonctionnalités-clés)
2. [Architecture technique](#-architecture-technique)
3. [Gestion RGPD & Protection des sources](#-gestion-rgpd--protection-des-sources)
4. [Stockage décentralisé IPFS](#-stockage-décentralisé-ipfs)
5. [Système de modération & Points de confiance](#-système-de-modération--points-de-confiance)
6. [Démarrage rapide](#-démarrage-rapide)
   - [Avec Docker Compose (recommandé)](#avec-docker-compose-recommandé)
   - [En développement local](#en-développement-local)
7. [API Publique & Open Data](#-api-publique--open-data)
8. [Tests](#-tests)
9. [Licence](#-licence)

---

## 🚀 Fonctionnalités clés

### 📱 Frontend Mobile-First
- **Interface intuitive et accessible (WCAG 2.1 AA)** : navigation fluide sur smartphone, boutons larges, thème sombre avec accents d'alerte.
- **Formulaire de signalement assisté** :
  - Choix du point exact sur carte ou géolocalisation GPS avec affichage de l'incertitude mesurée par l'appareil (HTML5 Geolocation + géocodage inverse OpenStreetMap Nominatim).
  - Sélection du type d'incident (violences physiques, tirs de LBD, gaz lacrymogène massif, grenades, etc.).
- **Outil d'anonymisation visuelle intégré** :
  - Dessin interactif de bandeaux noirs sur les visages, matricules (RIO) et plaques d'immatriculation directement dans le navigateur via l'élément HTML5 `<canvas>`.
  - Bouton rapide de masquage pour téléphones mobiles.
- **Cartographie interactive (Leaflet)** :
  - Visualisation des signalements validés sur fond de carte OpenStreetMap.
  - Position GPS publique conservée à sa précision source ; le formulaire permet de choisir le point exact sur la carte et affiche l'incertitude GPS de l'appareil.
  - La date/heure et le contexte de manifestation sont affichés sur la carte ; l'information mineur/majeur reste réservée aux modérateurs.
  - Filtres instantanés par type d'incident, ville et période.
  - Bascule en un clic entre vue Carte et vue Liste.
- **Statistiques publiques** :
  - Indicateurs clés, répartition par nature de faits et classement par département/ville.
- **Espace Recours Citoyen** :
  - Droit de contestation pour les signalements rejetés avec réexamen par les modérateurs.

---

## 🛡️ Gestion RGPD & Protection des sources

La plateforme met en œuvre les principes fondamentaux du **Privacy by Design** :

1. **Suppression automatique sous 30 jours (Rétention stricte)** :
   - Les données de contact du déclarant (email, numéro de téléphone) sont automatiquement et irréversiblement effacées par un cron job d'arrière-plan 30 jours après le dépôt (`SignalModel.anonymizeExpired()`).
2. **Droit à l'oubli immédiat (Art. 17 RGPD)** :
   - Lors de la soumission, un jeton secret (`forgetToken`) est délivré au citoyen, lui permettant d'exiger à tout instant l'effacement immédiat de ses coordonnées de contact sans attendre les 30 jours.
3. **Conservation d'intérêt public (Art. 89 RGPD)** :
   - Les signalements validés sont conservés indéfiniment sous forme anonymisée à des fins de documentation historique, statistique et juridique.
4. **Suppression matérielle des métadonnées EXIF** :
   - Lors du téléversement côté serveur, les segments EXIF/APP1 des photos JPEG sont détectés et purgés de manière à éliminer tout identifiant matériel (modèle d'appareil, date matérielle, coordonnées GPS de l'appareil).
5. **Localisation sensible** :
   - Le point GPS exact et l'adresse peuvent être publiés après validation. La précision annoncée est celle mesurée par l'appareil et ne garantit pas une exactitude au mètre.
   - L'indication qu'une victime est mineure n'est transmise qu'à l'espace de modération et n'est pas publiée dans l'API publique ni dans les exports Open Data.

---

## 🌍 Stockage décentralisé IPFS

Les preuves (photos et vidéos) sont archivées sur le réseau décentralisé **IPFS (InterPlanetary File System)** :
- Chaque fichier est identifié par son empreinte cryptographique (**CID** - Content Identifier).
- Les preuves sont immuables, résistantes à la censure et impossibles à altérer après publication.
- Le service intègre une passerelle locale de repli garantissant la consultation même en l'absence de nœud IPFS externe pendant les phases de test ou de déploiement restreint.

---

## ⚖️ Système de modération & Points de confiance

Pour garantir l'intégrité et la véracité des faits publiés :
- **Double validation** : un signalement n'est publié qu'après l'approbation de `MODERATION_REQUIRED_APPROVALS` modérateurs distincts (2 par défaut). Un administrateur peut forcer une publication ; l'action est tracée.
- **Journal d'audit** : connexions, échecs, verrouillages, votes, publications, rejets et gestion des comptes sont journalisés (consultable par les administrateurs).
- **Comptes** : mot de passe d'au moins 12 caractères, verrouillage temporaire après échecs répétés, sessions de 12 h invalidées lors d'une réinitialisation de mot de passe, impossibilité de retirer le dernier administrateur actif.
- **Points de confiance (Trust Points)** :
  - Chaque validation correcte augmente le capital de confiance du modérateur (`trustPoints`).
  - Le système identifie les modérateurs les plus fiables et permet d'accélérer le traitement des files d'attente.
- **Droit au recours** :
  - En cas de rejet, un motif explicite est renseigné. Le citoyen peut exercer un recours (un seul par signalement) en fournissant des éléments complémentaires ; le modérateur à l'origine du rejet ne peut pas le traiter.
  - Le compte administrateur local seul ne peut pas atteindre deux approbations : créez un second modérateur dans l'onglet « Équipe », ou utilisez « Publier (forcer) ».

---

## 🗄️ Stockage chiffré sur plusieurs nœuds

Les preuves (photos, vidéos) et les sauvegardes de la base peuvent être répliquées sur des **nœuds de stockage**
hébergeables n'importe où (VPS, NAS, Raspberry Pi, serveur associatif). Le backend chiffre tout avant l'envoi
(AES-256-GCM) : les nœuds ne détiennent que des blocs opaques. Voir [storage-node/README.md](storage-node/README.md).

```bash
# Essai local : 3 nœuds Podman, clé et jetons générés dans .env.local
bash scripts/local.sh nodes up 3
bash scripts/local.sh nodes status
bash scripts/local.sh nodes down     # retour au stockage local
```

Sans `STORAGE_NODES`, AKAB continue d'utiliser IPFS / le stockage local comme avant.

---

## 🛠️ Démarrage rapide

### Avec Docker Compose (recommandé)

Lancez l'ensemble de la pile (nœud IPFS Kubo + API Node.js + Frontend Nginx) :

```bash
# Créer une configuration locale avec un secret JWT et un mot de passe administrateur uniques
cp .env.example .env
python3 -c 'from pathlib import Path; import secrets; p=Path(".env"); s=p.read_text(); s=s.replace("JWT_SECRET=", "JWT_SECRET="+secrets.token_hex(32), 1); s=s.replace("ADMIN_DEFAULT_PASSWORD=", "ADMIN_DEFAULT_PASSWORD="+secrets.token_urlsafe(24), 1); p.write_text(s)'

# Lancer la pile complète
docker compose up -d
```

- **Frontend web** : [http://localhost:3000](http://localhost:3000)
- **API Backend** : [http://localhost:4000/api](http://localhost:4000/api)
- **Passerelle IPFS** : [http://localhost:8080/ipfs/](http://localhost:8080/ipfs/)

Le compte administrateur utilise l'adresse et le mot de passe définis dans `.env`. Gardez ce fichier secret. En production, le mot de passe administrateur racine défini dans `.env` est réappliqué au démarrage ; mettez à jour cette valeur pour le faire tourner. N'utilisez pas une base de développement comme base de production.

En production, l'API refuse de démarrer si le secret JWT fait moins de 32 caractères ou si le mot de passe administrateur initial fait moins de 16 caractères ou correspond au mot de passe de démonstration. Les ports Compose sont publiés sur la boucle locale par défaut ; adaptez explicitement le proxy et les ports pour un déploiement distant.

### Sur SteamOS / Steam Deck avec Podman

Le script utilise Podman directement sur l'hôte (ou `flatpak-spawn --host podman` depuis un environnement Flatpak), sans installer Node.js sur SteamOS :

```bash
# Première utilisation : construit et démarre la pile locale
bash scripts/local.sh up

# Recompiler après une modification du code
bash scripts/local.sh rebuild

# Ajouter trois signalements explicitement fictifs pour essayer la carte et la modération
bash scripts/local.sh demo

# Supprimer uniquement ces exemples de démonstration, sans toucher aux autres signalements
bash scripts/local.sh reset-demo

# Vérifier l'état, consulter les journaux, arrêter ou tester
bash scripts/local.sh status
bash scripts/local.sh logs backend
bash scripts/local.sh down
bash scripts/local.sh test
```

L'interface et l'API locales ne sont accessibles que depuis le Deck : `http://localhost:3000` et `http://localhost:4000`. Les données sont conservées dans un volume Podman quand la pile est arrêtée. Le script crée `.env.local` à la première utilisation et affiche alors le mot de passe initial ; conservez-le. Il ne supprime pas les données métier lors d'un arrêt ou d'une recompilation.

---

### En développement local

#### Prérequis
- Node.js 20+ (testé avec Node 24)
- npm 10+
- Compilateur C++ (pour le build SQLite `better-sqlite3`)

#### Installation & Lancement

```bash
# Installer les dépendances des workspaces (backend + frontend)
npm install

# Lancer le backend en mode développement (port 4000)
npm run dev --workspace=backend

# Dans un autre terminal, lancer le frontend (port 3000)
npm run dev --workspace=frontend
```

---

## 📊 API Publique & Open Data

AKAB met à disposition des journalistes, universitaires, associations et avocats des endpoints publics en accès libre :

| Endpoint | Méthode | Format | Description |
| :--- | :--- | :--- | :--- |
| `/api/signals` | `GET` | JSON | Liste des signalements validés avec filtres (type, date, ville) |
| `/api/signals/:id` | `GET` | JSON | Consultation d'un signalement |
| `/api/signals` | `POST` | JSON | Dépôt d'un nouveau signalement |
| `/api/signals/upload-proof` | `POST` | Multipart | Anonymisation EXIF et upload IPFS d'une preuve |
| `/api/signals/:id/appeal` | `POST` | JSON | Dépôt d'un recours pour un signalement rejeté |
| `/api/signals/forget` | `POST` | JSON | Droit à l'oubli immédiat (Art. 17 RGPD) |
| `/api/export/geojson` | `GET` | GeoJSON | Export cartographique SIG pour chercheurs et cartographes |
| `/api/export/csv` | `GET` | CSV | Export tabulaire compatible LibreOffice / Excel |
| `/api/export/json` | `GET` | JSON | Dump structuré de l'ensemble des données publiques |
| `/api/export/statistics` | `GET` | JSON | Statistiques consolidées (totaux, départements, types) |

---

## 🧪 Tests

```bash
# Lancer les tests unitaires et d'intégration backend
npm run test --workspace=backend

# Lancer les tests frontend
npm run test --workspace=frontend
```

---

## 📄 Licence

Ce projet est sous licence **GNU Affero General Public License v3.0 (AGPL-3.0)** - voir le fichier [LICENSE](LICENSE) pour plus de détails.
