import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import { MapPin } from 'lucide-react';

interface LocationPickerProps {
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
  onChange: (latitude: number, longitude: number) => void;
}

export const LocationPicker: React.FC<LocationPickerProps> = ({
  latitude,
  longitude,
  accuracyMeters,
  onChange,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const accuracyCircleRef = useRef<L.Circle | null>(null);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [46.603354, 1.888334],
      zoom: 6,
      zoomControl: true,
      scrollWheelZoom: false,
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      subdomains: 'abc',
      maxZoom: 19,
    }).addTo(map);

    map.on('click', (event: L.LeafletMouseEvent) => {
      onChangeRef.current(event.latlng.lat, event.latlng.lng);
    });
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
      accuracyCircleRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (latitude === null || longitude === null) {
      if (markerRef.current) map.removeLayer(markerRef.current);
      if (accuracyCircleRef.current) map.removeLayer(accuracyCircleRef.current);
      markerRef.current = null;
      accuracyCircleRef.current = null;
      return;
    }

    const position: L.LatLngExpression = [latitude, longitude];
    if (!markerRef.current) {
      markerRef.current = L.marker(position, { draggable: true }).addTo(map);
      markerRef.current.on('dragend', () => {
        const point = markerRef.current?.getLatLng();
        if (point) onChangeRef.current(point.lat, point.lng);
      });
      map.setView(position, 19);
    } else {
      markerRef.current.setLatLng(position);
      if (map.getZoom() < 16) map.setView(position, 19);
    }

    if (accuracyMeters && accuracyMeters > 0) {
      if (!accuracyCircleRef.current) {
        accuracyCircleRef.current = L.circle(position, {
          radius: accuracyMeters,
          color: '#2563eb',
          weight: 2,
          fillColor: '#3b82f6',
          fillOpacity: 0.14,
        }).addTo(map);
      } else {
        accuracyCircleRef.current.setLatLng(position);
        accuracyCircleRef.current.setRadius(accuracyMeters);
      }
    } else if (accuracyCircleRef.current) {
      map.removeLayer(accuracyCircleRef.current);
      accuracyCircleRef.current = null;
    }
  }, [latitude, longitude, accuracyMeters]);

  return (
    <div className="location-picker">
      <div ref={containerRef} className="location-picker-map" role="application" aria-label="Carte de choix de la localisation" />
      <p className="location-picker-help">
        <MapPin size={15} />
        Cliquez sur la carte ou déplacez le repère pour préciser le lieu. Vous pouvez aussi saisir les coordonnées GPS.
      </p>
    </div>
  );
};
