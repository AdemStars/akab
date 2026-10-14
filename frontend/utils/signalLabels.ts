export const EVENT_TYPE_LABELS: Record<string, string> = {
  none: 'Aucun événement collectif',
  demonstration: 'Manifestation',
  march: 'Marche',
  rally: 'Rassemblement',
  strike: 'Grève',
  blockade: 'Blocage',
  occupation: 'Occupation',
  other: 'Autre mouvement',
};

export const VICTIM_AGE_GROUP_LABELS: Record<string, string> = {
  minor: 'Au moins une victime mineure',
  adult: 'Victime(s) majeure(s)',
  mixed: 'Victimes mineures et majeures',
  unknown: 'Âge non connu',
};

export function formatGpsCoordinates(latitude: number, longitude: number): string {
  return `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
}

export function formatGpsAccuracy(accuracyMeters: number | null): string | null {
  if (accuracyMeters === null || !Number.isFinite(accuracyMeters) || accuracyMeters <= 0) {
    return null;
  }
  if (accuracyMeters < 1) {
    return '±<1 m';
  }
  return `±${Math.round(accuracyMeters)} m`;
}

export const INCIDENT_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'violence_physique', label: 'Violence physique' },
  { value: 'violence_verbale', label: 'Violence verbale / insultes' },
  { value: 'tir_lbd', label: 'Tir de LBD / lanceur' },
  { value: 'gaz_lacrymo', label: 'Gaz lacrymogène massif' },
  { value: 'grenade_desencerclement', label: 'Grenade de désencerclement' },
  { value: 'interpellation_violente', label: 'Interpellation violente' },
  { value: 'materiel_detruit', label: 'Matériel détruit (téléphone, etc.)' },
  { value: 'autre', label: 'Autre incident' },
];
