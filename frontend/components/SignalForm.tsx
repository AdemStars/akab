import React, { useState } from 'react';
import { MapPin, Navigation, Send, AlertCircle, Shield, CheckCircle2, Lock, Copy } from 'lucide-react';
import { getCurrentGPSPosition, reverseGeocode } from '../utils/geolocation';
import { PhotoUpload, UploadedEvidence } from './PhotoUpload';
import { LocationPicker } from './LocationPicker';
import { API } from '../utils/api';

function toLocalDateTimeInput(date: Date): string {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 16);
}

interface SignalFormProps {
  onSuccess: (signalId: string, forgetToken: string) => void;
}

export const SignalForm: React.FC<SignalFormProps> = ({ onSuccess }) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [incidentDate, setIncidentDate] = useState(() => toLocalDateTimeInput(new Date()));
  const [incidentType, setIncidentType] = useState('violence_physique');
  const [eventType, setEventType] = useState('none');
  const [eventName, setEventName] = useState('');
  const [victimAgeGroup, setVictimAgeGroup] = useState('unknown');
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [locationAccuracyMeters, setLocationAccuracyMeters] = useState<number | null>(null);
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [department, setDepartment] = useState('');
  const [evidenceList, setEvidenceList] = useState<UploadedEvidence[]>([]);
  const [reporterEmail, setReporterEmail] = useState('');
  const [reporterPhone, setReporterPhone] = useState('');
  const [gdprConsent, setGdprConsent] = useState(false);

  const [loadingGps, setLoadingGps] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [submittedData, setSubmittedData] = useState<{ signalId: string; forgetToken: string } | null>(null);
  const [copiedToken, setCopiedToken] = useState(false);

  // Trigger GPS Geolocation
  const handleGetLocation = async () => {
    try {
      setLoadingGps(true);
      setFormError(null);
      const coords = await getCurrentGPSPosition();
      setLatitude(coords.latitude);
      setLongitude(coords.longitude);
      setLocationAccuracyMeters(coords.accuracy ?? null);

      // Perform reverse geocoding to prefill street address and city
      const geoAddr = await reverseGeocode(coords.latitude, coords.longitude);
      if (geoAddr.address || geoAddr.street) {
        setAddress(geoAddr.address || geoAddr.street || '');
      }
      if (geoAddr.city) setCity(geoAddr.city);
      if (geoAddr.postalCode) setPostalCode(geoAddr.postalCode);
      if (geoAddr.department) setDepartment(geoAddr.department);
    } catch (err: any) {
      setFormError(err.message || 'Impossible d’obtenir votre position GPS');
    } finally {
      setLoadingGps(false);
    }
  };

  const handleCoordinateChange = (nextLatitude: number | null, nextLongitude: number | null) => {
    setLatitude(nextLatitude);
    setLongitude(nextLongitude);
    setLocationAccuracyMeters(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (latitude === null || longitude === null) {
      setFormError('Choisissez un point sur la carte ou saisissez les coordonnées du lieu.');
      return;
    }

    if (!gdprConsent) {
      setFormError('Vous devez accepter les conditions RGPD de traitement des données.');
      return;
    }

    try {
      setSubmitting(true);
      const payload = {
        title,
        description,
        incidentDate: new Date(incidentDate).toISOString(),
        incidentType,
        eventType,
        eventName: eventName.trim() || undefined,
        victimAgeGroup,
        latitude,
        longitude,
        locationAccuracyMeters: locationAccuracyMeters ?? undefined,
        address: address || undefined,
        city: city || undefined,
        postalCode: postalCode || undefined,
        department: department || undefined,
        evidence: evidenceList,
        reporterEmail: reporterEmail.trim() || undefined,
        reporterPhone: reporterPhone.trim() || undefined,
        gdprConsent: true,
      };

      const result = await API.submitSignal(payload);
      setSubmittedData({
        signalId: result.signalId,
        forgetToken: result.forgetToken,
      });
      onSuccess(result.signalId, result.forgetToken);
    } catch (err: any) {
      setFormError(err.message || 'Erreur lors de la transmission du signalement');
    } finally {
      setSubmitting(false);
    }
  };

  const copyForgetToken = () => {
    if (submittedData?.forgetToken) {
      navigator.clipboard.writeText(submittedData.forgetToken);
      setCopiedToken(true);
      setTimeout(() => setCopiedToken(false), 3000);
    }
  };

  if (submittedData) {
    return (
      <section className="page-shell page-shell-wide">
        <header className="page-heading">
          <p className="page-eyebrow">SIGNALEMENT CITOYEN</p>
          <h1>Votre signalement</h1>
        </header>
        <div className="card report-success">
          <CheckCircle2 size={56} style={{ color: 'var(--accent-green)', margin: '0 auto 1rem' }} />
          <h2 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>Signalement envoyé avec succès !</h2>
          <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
            Votre signalement porte l'identifiant <strong>#{submittedData.signalId}</strong>. Il est désormais en
            cours d'examen par notre collège de modération citoyenne.
          </p>

        <div
          style={{
            backgroundColor: 'var(--bg-input)',
            border: '1px solid var(--accent-yellow)',
            borderRadius: 'var(--radius-md)',
            padding: '1.25rem',
            textAlign: 'left',
            marginBottom: '1.5rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <Lock size={18} style={{ color: 'var(--accent-yellow)' }} />
            <h4 style={{ color: 'var(--accent-yellow)', fontSize: '1rem', fontWeight: 700 }}>
              Jeton de Droit à l'Oubli & Recours (RGPD)
            </h4>
          </div>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
            Conservez précieusement ce jeton secret. Il vous permet de supprimer immédiatement vos coordonnées ou
            de déposer un recours si votre signalement était contesté.
          </p>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              backgroundColor: 'var(--bg-card)',
              padding: '0.5rem 0.75rem',
              borderRadius: 'var(--radius-sm)',
              wordBreak: 'break-all',
              fontFamily: 'monospace',
              fontSize: '0.9rem',
            }}
          >
            <span style={{ flex: 1 }}>{submittedData.forgetToken}</span>
            <button
              type="button"
              className="btn btn-outline"
              onClick={copyForgetToken}
              style={{ minHeight: '32px', padding: '0.2rem 0.6rem', marginLeft: '0.5rem' }}
            >
              <Copy size={14} /> {copiedToken ? 'Copié !' : 'Copier'}
            </button>
          </div>
        </div>

          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setSubmittedData(null);
              setTitle('');
              setDescription('');
              setEvidenceList([]);
              setLatitude(null);
              setLongitude(null);
              setLocationAccuracyMeters(null);
              setEventType('none');
              setEventName('');
              setVictimAgeGroup('unknown');
            }}
          >
            Effectuer un autre signalement
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="page-shell page-shell-wide">
      <header className="page-heading">
        <p className="page-eyebrow">SIGNALEMENT CITOYEN</p>
        <h1>Documenter un fait</h1>
        <p>Renseignez le lieu, la date et les éléments utiles à l’examen du signalement.</p>
      </header>
      <form className="report-form" onSubmit={handleSubmit}>
      {/* Geolocation Section */}
      <div className="card">
        <h3 className="card-title">
          <MapPin size={20} /> 1. Géolocalisation précise (Rue / GPS)
        </h3>
        <p className="location-privacy-notice">
          Après validation, le point GPS exact sera visible sur la carte publique. Le cercle indique la marge
          d’erreur estimée par votre appareil ; il ne garantit pas une précision au mètre.
        </p>

        <button
          type="button"
          className="btn btn-primary btn-block"
          onClick={handleGetLocation}
          disabled={loadingGps}
          style={{ marginBottom: '1rem' }}
        >
          <Navigation size={18} />
          {loadingGps ? 'Détection GPS en cours...' : 'Activer la géolocalisation GPS'}
        </button>

        {locationAccuracyMeters !== null && (
          <p className="location-accuracy" role="status">
            Précision GPS estimée : ±{Math.round(locationAccuracyMeters)} m
          </p>
        )}

        <LocationPicker
          latitude={latitude}
          longitude={longitude}
          accuracyMeters={locationAccuracyMeters}
          onChange={(nextLatitude, nextLongitude) => handleCoordinateChange(nextLatitude, nextLongitude)}
        />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <div className="form-group">
            <label className="form-label" htmlFor="signal-latitude">Latitude *</label>
            <input
              id="signal-latitude"
              type="number"
              step="any"
              min={-90}
              max={90}
              className="form-input"
              placeholder="ex: 48.8566"
              value={latitude !== null ? latitude : ''}
              onChange={(e) => handleCoordinateChange(e.target.value === '' ? null : Number(e.target.value), longitude)}
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="signal-longitude">Longitude *</label>
            <input
              id="signal-longitude"
              type="number"
              step="any"
              min={-180}
              max={180}
              className="form-input"
              placeholder="ex: 2.3522"
              value={longitude !== null ? longitude : ''}
              onChange={(e) => handleCoordinateChange(latitude, e.target.value === '' ? null : Number(e.target.value))}
              required
            />
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Adresse / Rue / Carrefour</label>
          <input
            type="text"
            className="form-input"
            placeholder="ex: 12 boulevard Voltaire ou angle rue de Turbigo"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '0.75rem' }}>
          <div className="form-group">
            <label className="form-label">Ville</label>
            <input
              type="text"
              className="form-input"
              placeholder="ex: Paris, Lyon, Nantes..."
              value={city}
              onChange={(e) => setCity(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Département</label>
            <input
              type="text"
              className="form-input"
              placeholder="ex: 75, 69, 44..."
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Incident Details */}
      <div className="card">
        <h3 className="card-title">
          <AlertCircle size={20} /> 2. Description des faits
        </h3>

        <div className="form-group">
          <label className="form-label">Type de violence constatée *</label>
          <select
            className="form-select"
            value={incidentType}
            onChange={(e) => setIncidentType(e.target.value)}
            required
          >
            <option value="violence_physique">Violence physique (coups, matraque, plaquage)</option>
            <option value="violence_verbale">Violence verbale / insultes / humiliations</option>
            <option value="tir_lbd">Tir de LBD / lanceur de balles de défense</option>
            <option value="gaz_lacrymo">Usage massif / injustifié de gaz lacrymogène</option>
            <option value="grenade_desencerclement">Grenade de désencerclement / GLI / GM2L</option>
            <option value="interpellation_violente">Interpellation violente / arrestation arbitraire</option>
            <option value="materiel_detruit">Matériel détruit (téléphone, caméra de journaliste)</option>
            <option value="autre">Autre comportement abusif</option>
          </select>
        </div>

        <div className="form-group">
          <label className="form-label">Titre concis du signalement *</label>
          <input
            type="text"
            className="form-input"
            placeholder="ex: Tir tendu de LBD sur manifestant pacifique"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            minLength={3}
            maxLength={150}
            required
          />
        </div>

        <div className="form-group">
          <label className="form-label">Date et heure des faits *</label>
          <input
            type="datetime-local"
            className="form-input"
            value={incidentDate}
            onChange={(e) => setIncidentDate(e.target.value)}
            required
          />
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="signal-event-type">Type de manifestation ou mouvement</label>
          <select
            id="signal-event-type"
            className="form-select"
            value={eventType}
            onChange={(e) => setEventType(e.target.value)}
          >
            <option value="none">Aucun événement collectif / non concerné</option>
            <option value="demonstration">Manifestation</option>
            <option value="march">Marche</option>
            <option value="rally">Rassemblement</option>
            <option value="strike">Grève</option>
            <option value="blockade">Blocage</option>
            <option value="occupation">Occupation</option>
            <option value="other">Autre mouvement</option>
          </select>
        </div>

        {eventType !== 'none' && (
          <div className="form-group">
            <label className="form-label" htmlFor="signal-event-name">Nom ou précision sur le mouvement (facultatif)</label>
            <input
              id="signal-event-name"
              type="text"
              className="form-input"
              maxLength={120}
              placeholder="Ex. : rassemblement contre la réforme..."
              value={eventName}
              onChange={(e) => setEventName(e.target.value)}
            />
          </div>
        )}

        <div className="form-group">
          <label className="form-label" htmlFor="signal-victim-age">La ou les victimes étaient-elles mineures ?</label>
          <select
            id="signal-victim-age"
            className="form-select"
            value={victimAgeGroup}
            onChange={(e) => setVictimAgeGroup(e.target.value)}
          >
            <option value="unknown">Je ne sais pas / je préfère ne pas préciser</option>
            <option value="minor">Au moins une victime mineure</option>
            <option value="adult">Victime(s) majeure(s) uniquement</option>
            <option value="mixed">Victimes mineures et majeures</option>
          </select>
          <div className="form-help">Cette information est visible uniquement par les modérateurs, pas sur la carte publique.</div>
        </div>

        <div className="form-group">
          <label className="form-label">Récit détaillé de l'incident *</label>
          <textarea
            className="form-textarea"
            rows={5}
            placeholder="Décrivez les circonstances exactes : déroulement, comportement des forces de l'ordre, matricule (RIO) visible ou masqué, conséquences physiques, blessures constatées..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            minLength={10}
            maxLength={5000}
            required
          />
        </div>
      </div>

      {/* Photo / Video Upload with Anonymization */}
      <PhotoUpload
        existingEvidence={evidenceList}
        onEvidenceAdded={(ev) => setEvidenceList((prev) => [...prev, ev])}
        onEvidenceRemoved={(id) => setEvidenceList((prev) => prev.filter((e) => e.id !== id))}
      />

      {/* Contact & GDPR */}
      <div className="card">
        <h3 className="card-title">
          <Shield size={20} /> 3. Contact & Protection RGPD
        </h3>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
          Vos coordonnées sont <strong>strictement confidentielles</strong> et ne seront jamais publiées ni
          transmises à des tiers. Elles permettent uniquement aux modérateurs de vous contacter en cas de besoin
          d'authentification des preuves.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <div className="form-group">
            <label className="form-label">Email (facultatif)</label>
            <input
              type="email"
              className="form-input"
              placeholder="votre-email@exemple.org"
              value={reporterEmail}
              onChange={(e) => setReporterEmail(e.target.value)}
            />
            <div className="form-help">Supprimé automatiquement après 30 jours.</div>
          </div>

          <div className="form-group">
            <label className="form-label">Téléphone (facultatif)</label>
            <input
              type="tel"
              className="form-input"
              placeholder="+33 6 12 34 56 78"
              value={reporterPhone}
              onChange={(e) => setReporterPhone(e.target.value)}
            />
            <div className="form-help">Supprimé automatiquement après 30 jours.</div>
          </div>
        </div>

        {/* GDPR Checkbox */}
        <div style={{ marginTop: '0.5rem', display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
          <input
            type="checkbox"
            id="gdpr"
            checked={gdprConsent}
            onChange={(e) => setGdprConsent(e.target.checked)}
            style={{ width: '20px', height: '20px', marginTop: '2px', accentColor: 'var(--primary-red)' }}
            required
          />
          <label htmlFor="gdpr" style={{ fontSize: '0.85rem', color: 'var(--text-main)', cursor: 'pointer' }}>
            J'accepte que ce signalement soit examiné et publié sur la plateforme AKAB. Après validation, sa
            date, son type d’incident, le contexte du mouvement et son point GPS exact pourront apparaître sur
            la carte publique. Le statut mineur/majeur reste réservé aux modérateurs. J'ai
            bien noté que mes coordonnées personnelles (email/téléphone) seront{' '}
            <strong>automatiquement et irréversiblement purgées au bout de 30 jours</strong>, et que je peux
            exercer mon <em>droit à l'oubli</em> à tout moment via mon jeton secret (Art. 17 RGPD).
          </label>
        </div>
      </div>

      {formError && (
        <div
          role="alert"
          style={{
            backgroundColor: 'rgba(230, 57, 70, 0.2)',
            border: '1px solid var(--primary-red)',
            borderRadius: 'var(--radius-md)',
            padding: '0.75rem 1rem',
            marginBottom: '1rem',
            color: '#ff6b6b',
            fontSize: '0.9rem',
          }}
        >
          ⚠️ {formError}
        </div>
      )}

      <button
        type="submit"
        className="btn btn-primary btn-block"
        style={{ minHeight: '52px', fontSize: '1.1rem' }}
        disabled={submitting}
      >
        <Send size={22} />
        {submitting ? 'Transmission sécurisée en cours...' : 'Envoyer le signalement'}
      </button>
      </form>
    </section>
  );
};
