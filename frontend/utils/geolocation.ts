export interface GeoCoordinates {
  latitude: number;
  longitude: number;
  accuracy?: number;
}

export interface GeocodedAddress {
  address?: string;
  street?: string;
  city?: string;
  postalCode?: string;
  department?: string;
}

/**
 * Gets high-accuracy GPS position from device
 */
export async function getCurrentGPSPosition(): Promise<GeoCoordinates> {
  if (!('geolocation' in navigator)) {
    throw new Error('La géolocalisation n’est pas supportée par votre navigateur.');
  }

  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        });
      },
      (error) => {
        switch (error.code) {
          case error.PERMISSION_DENIED:
            reject(new Error('Permission de géolocalisation refusée par l’utilisateur.'));
            break;
          case error.POSITION_UNAVAILABLE:
            reject(new Error('Position GPS indisponible. Veuillez vérifier votre signal.'));
            break;
          case error.TIMEOUT:
            reject(new Error('Délai d’attente du signal GPS dépassé.'));
            break;
          default:
            reject(new Error('Erreur de géolocalisation inconnue.'));
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 10000,
      }
    );
  });
}

/**
 * Reverse geocodes coordinates to street-level address using OpenStreetMap Nominatim
 */
export async function reverseGeocode(latitude: number, longitude: number): Promise<GeocodedAddress> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=18&addressdetails=1`;
    const response = await fetch(url, {
      headers: {
        'Accept-Language': 'fr',
        'User-Agent': 'AKAB-Plateforme-Citoyenne',
      },
    });

    if (!response.ok) {
      return {};
    }

    const data = await response.json();
    const addr = data.address || {};

    const street = addr.road || addr.pedestrian || addr.street || addr.suburb || '';
    const houseNumber = addr.house_number ? `${addr.house_number} ` : '';
    const fullStreet = (houseNumber + street).trim();

    const city = addr.city || addr.town || addr.village || addr.municipality || '';
    const postalCode = addr.postcode || '';
    const department = addr.county || (postalCode ? postalCode.substring(0, 2) : '');

    return {
      address: data.display_name ? data.display_name.split(',').slice(0, 3).join(',') : fullStreet,
      street: fullStreet,
      city,
      postalCode,
      department,
    };
  } catch (err) {
    console.warn('[GEOCODE ERROR]', err);
    return {};
  }
}

/**
 * Calculates distance between two coordinates in kilometers (Haversine formula)
 */
export function calculateDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
