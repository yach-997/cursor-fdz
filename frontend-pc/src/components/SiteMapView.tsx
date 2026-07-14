import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { createGaodeTileLayer } from '../utils/gaodeTileLayer';

export interface SiteMarker {
  id: string;
  name: string;
  city?: string;
  latitude: number;
  longitude: number;
  deviceCount?: number;
}

interface SiteMapViewProps {
  markers: SiteMarker[];
  height?: number;
}

/** 仪表盘站点分布（Leaflet + 高德瓦片） */
export default function SiteMapView({ markers, height = 360 }: SiteMapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const center: [number, number] = markers.length
      ? [markers[0].latitude, markers[0].longitude]
      : [39.9042, 116.4074];

    const map = L.map(containerRef.current).setView(center, markers.length > 1 ? 5 : 10);
    createGaodeTileLayer().addTo(map);
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    map.eachLayer((layer) => {
      if (layer instanceof L.Marker) map.removeLayer(layer);
    });

    if (!markers.length) return;

    const bounds: L.LatLngExpression[] = [];
    markers.forEach((m) => {
      const latlng: L.LatLngExpression = [m.latitude, m.longitude];
      bounds.push(latlng);
      const icon = L.divIcon({
        className: '',
        html: `<div style="width:12px;height:12px;background:#1a5f4a;border:2px solid #fff;border-radius:50%;box-shadow:0 1px 4px rgba(0,0,0,.35)"></div>`,
        iconSize: [12, 12],
        iconAnchor: [6, 6],
      });
      L.marker(latlng, { icon })
        .addTo(map)
        .bindPopup(
          `<strong>${m.name}</strong><br/>${m.city || ''}<br/>设备 ${m.deviceCount ?? 0} 台`,
        );
    });

    if (bounds.length > 1) {
      map.fitBounds(bounds as L.LatLngBoundsExpression, { padding: [40, 40] });
    } else if (bounds.length === 1) {
      map.setView(bounds[0] as L.LatLngExpression, 10);
    }
  }, [markers]);

  return (
    <div>
      {!markers.length ? (
        <div
          style={{
            height,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#999',
          }}
        >
          暂无站点坐标数据
        </div>
      ) : (
        <div ref={containerRef} style={{ height, width: '100%', borderRadius: 8 }} />
      )}
    </div>
  );
}
