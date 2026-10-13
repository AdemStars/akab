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
  - Géolocalisation GPS précise au niveau de la rue (HTML5 Geolocation + géocodage inverse OpenStreetMap Nominatim).
  - Sélection du type d'incident (violences physiques, tirs de LBD, gaz lacrymogène massif, grenades, etc.).
- **Outil d'anonymisation visuelle intégré** :
  - Dessin interactif de bandeaux noirs sur les visages, matricules (RIO) et plaques d'immatriculation directement dans le navigateur via l'élément HTML5 `<canvas>`.
  - Bouton rapide de masquage pour téléphones mobiles.
- **Cartographie interactive (Leaflet)** :
  - Visualisation des signalements validés sur fond de carte OpenStreetMap/CartoDB.
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

---

## 🌍 Stockage décentralisé IPFS

Les preuves (photos et vidéos) sont archivées sur le réseau décentralisé **IPFS (InterPlanetary File System)** :
- Chaque fichier est identifié par son empreinte cryptographique (**CID** - Content Identifier).
- Les preuves sont immuables, résistantes à la censure et impossibles à altérer après publication.
- Le service intègre une passerelle locale de repli garantissant la consultation même en l'absence de nœud IPFS externe pendant les phases de test ou de déploiement restreint.

---

## ⚖️ Système de modération & Points de confiance

Pour garantir l'intégrité et la véracité des faits publiés :
- **Validation manuelle préalable** : aucun signalement n'apparaît sur la carte publique avant validation par un modérateur.
- **Points de confiance (Trust Points)** :
  - Chaque validation correcte augmente le capital de confiance du modérateur (`trustPoints`).
  - Le système identifie les modérateurs les plus fiables et permet d'accélérer le traitement des files d'attente.
- **Droit au recours** :
  - En cas de rejet, un motif explicite est renseigné. Le citoyen peut exercer un recours en fournissant des éléments complémentaires.

---

## 🛠️ Démarrage rapide

### Avec Docker Compose (recommandé)

Lancez l'ensemble de la pile (nœud IPFS Kubo + API Node.js + Frontend Nginx) :

```bash
# Cloner le dépôt
git clone https://github.com/AdemStars/akab.git
cd akab

# Lancer la stack complète
docker compose up -d
```

- **Frontend web** : [http://localhost:3000](http://localhost:3000)
- **API Backend** : [http://localhost:4000/api](http://localhost:4000/api)
- **Passerelle IPFS** : [http://localhost:8080/ipfs/](http://localhost:8080/ipfs/)

Compte administrateur initial (généré au premier démarrage) :
- **Email** : `admin@akab.local`
- **Mot de passe** : `AdminSecurePassword123!`

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

