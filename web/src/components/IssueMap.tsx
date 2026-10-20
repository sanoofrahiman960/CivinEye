import 'leaflet/dist/leaflet.css';

import { useEffect } from 'react';
import { CircleMarker, MapContainer, Popup, TileLayer, useMap } from 'react-leaflet';

import { PRIORITY_ORDER, PRIORITY_STYLES, STATUS_STYLES } from '../lib/styles';
import type { IssueStatus, Priority } from '../types/api';

export interface MapPoint {
  id: number;
  latitude: number;
  longitude: number;
  priority: Priority;
  status: IssueStatus;
  title: string;
  complaint_id: string;
  is_overdue?: boolean;
}

/** Default centre when there are no points (Kochi, Kerala). */
const FALLBACK: [number, number] = [9.9816, 76.2999];

function FitBounds({ points }: { points: MapPoint[] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 1) map.setView([points[0].latitude, points[0].longitude], 16);
    else if (points.length > 1) map.fitBounds(points.map((p) => [p.latitude, p.longitude] as [number, number]), { padding: [32, 32], maxZoom: 16 });
  }, [map, points]);
  return null;
}

/** OpenStreetMap with priority-coloured markers. Popups repeat priority and status as text. */
export function IssueMap({ points, className = 'map', onOpen }: { points: MapPoint[]; className?: string; onOpen?: (id: number) => void }) {
  return (
    <div className={className} role="region" aria-label="Map of issues">
      <MapContainer center={FALLBACK} zoom={13} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitBounds points={points} />
        {points.map((point) => {
          const style = PRIORITY_STYLES[point.priority];
          return (
            <CircleMarker
              key={point.id}
              center={[point.latitude, point.longitude]}
              radius={point.priority === 'CRITICAL' ? 11 : 9}
              pathOptions={{ color: point.is_overdue ? '#7f1d1d' : '#ffffff', weight: point.is_overdue ? 3 : 2, fillColor: style.color, fillOpacity: 0.95 }}
            >
              <Popup>
                <strong>{point.complaint_id}</strong>
                <div>{point.title}</div>
                <div style={{ marginTop: 4 }}>
                  {style.label} priority · {STATUS_STYLES[point.status].label}
                  {point.is_overdue ? ' · Overdue' : ''}
                </div>
                {onOpen ? (
                  <button type="button" className="btn btn-sm" style={{ marginTop: 8 }} onClick={() => onOpen(point.id)}>
                    Open issue
                  </button>
                ) : null}
              </Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>
    </div>
  );
}

export function PriorityLegend() {
  return (
    <div className="legend" aria-label="Marker colours">
      {PRIORITY_ORDER.map((priority) => (
        <span key={priority}>
          <i style={{ background: PRIORITY_STYLES[priority].color }} aria-hidden />
          {PRIORITY_STYLES[priority].label}
        </span>
      ))}
      <span>
        <i style={{ background: '#fff', border: '3px solid #7f1d1d' }} aria-hidden />
        Overdue (dark ring)
      </span>
    </div>
  );
}
