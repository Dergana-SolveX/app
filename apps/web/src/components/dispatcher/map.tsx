import { useEffect, useState } from "react";
import { divIcon } from "leaflet";
import {
  Circle,
  GeoJSON,
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { incidentRef } from "@/lib/time";
import type { Incident, MapLayers } from "./types";

type MapIncident = Pick<
  Incident,
  "id" | "lat" | "lng" | "locationUncertaintyM" | "recSeverity" | "commune"
>;
const icon = (label: string, color: string, accessibleName: string) => {
  const element = document.createElement("span");
  element.textContent = label;
  element.setAttribute("aria-label", accessibleName);
  element.style.cssText = `background:var(--card);color:var(--${color});border:2px solid currentColor;display:grid;place-items:center;min-width:32px;height:32px;border-radius:8px;font-weight:800;font-size:12px`;
  return divIcon({
    className: "dispatcher-map-marker",
    html: element,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
};
function FocusIncident({ incident }: { incident: MapIncident | undefined }) {
  const map = useMap();
  useEffect(() => {
    if (incident?.lat != null && incident.lng != null)
      map.setView([incident.lat, incident.lng], Math.max(map.getZoom(), 12), {
        animate: false,
      });
  }, [map, incident?.id, incident?.lat, incident?.lng]);
  useEffect(() => {
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);
  return null;
}
export function DispatcherMap({
  incidents,
  layers,
  selectedId,
  onSelect,
}: {
  incidents: MapIncident[];
  layers: MapLayers;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [tilesFailed, setTilesFailed] = useState(false);
  return (
    <section
      aria-label="Carte opérationnelle"
      className="min-w-0 overflow-hidden rounded-lg border bg-card"
    >
      <div className="border-b p-3">
        <h2 className="font-bold">Carte opérationnelle</h2>
        <p className="text-xs text-muted-foreground">
          R / J / V / ? : gravité · U : unité · H : hôpital · périmètres urbains
        </p>
      </div>
      <MapContainer
        center={[36.73, 3.12]}
        zoom={11}
        scrollWheelZoom={false}
        className="isolate z-0 h-[420px] w-full xl:h-[calc(100vh-20rem)]"
        aria-label="Carte des incidents"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributeurs'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          eventHandlers={{ tileerror: () => setTilesFailed(true) }}
        />
        <FocusIncident incident={incidents.find((i) => i.id === selectedId)} />
        {layers.zones.map((zone) => (
          <GeoJSON
            key={zone.id}
            data={zone.polygon}
            style={{ color: "var(--primary)", weight: 1, fillOpacity: 0.06 }}
          >
            <Tooltip>{zone.name}</Tooltip>
          </GeoJSON>
        ))}
        {incidents
          .filter((i) => i.lat !== null && i.lng !== null)
          .map((i) => (
            <Marker
              key={i.id}
              position={[i.lat!, i.lng!]}
              icon={icon(
                { red: "R", yellow: "J", green: "V", unknown: "?" }[
                  i.recSeverity
                ],
                `sev-${i.recSeverity}`,
                `Incident ${i.commune ?? incidentRef(i.id)} — ${i.recSeverity.toUpperCase()}`,
              )}
              alt={`Incident ${i.commune ?? incidentRef(i.id)} — ${i.recSeverity.toUpperCase()}`}
              title={`Incident ${i.commune ?? incidentRef(i.id)} — ${i.recSeverity.toUpperCase()}`}
              eventHandlers={{ click: () => onSelect(i.id) }}
            >
              <Tooltip>
                {i.commune ?? `#${incidentRef(i.id)}`} ·{" "}
                {i.recSeverity.toUpperCase()}
              </Tooltip>
            </Marker>
          ))}
        {incidents
          .filter(
            (i) =>
              i.lat !== null &&
              i.lng !== null &&
              (i.locationUncertaintyM ?? 0) > 0,
          )
          .map((i) => (
            <Circle
              key={`accuracy-${i.id}`}
              center={[i.lat!, i.lng!]}
              radius={i.locationUncertaintyM!}
              pathOptions={{
                color: `var(--sev-${i.recSeverity})`,
                weight: 1,
                fillOpacity: 0.08,
              }}
            >
              <Tooltip>Incertitude : {i.locationUncertaintyM} m</Tooltip>
            </Circle>
          ))}
        {layers.units.map((unit) => (
          <Marker
            key={unit.id}
            position={[unit.lat, unit.lng]}
            icon={icon(
              "U",
              unit.available ? "primary" : "muted-foreground",
              `Unité ${unit.callSign}`,
            )}
            title={`Unité ${unit.callSign}`}
            alt={`Unité ${unit.callSign}`}
          >
            <Popup>
              <strong>{unit.callSign}</strong>
              <br />
              {unit.baseName}
              <br />
              {unit.available ? "Disponible" : "Engagée"}
            </Popup>
          </Marker>
        ))}
        {layers.hospitals.map((hospital) => (
          <Marker
            key={hospital.id}
            position={[hospital.lat, hospital.lng]}
            icon={icon("H", "primary", hospital.name)}
            title={hospital.name}
            alt={hospital.name}
          >
            <Popup>
              <strong>{hospital.name}</strong>
              <br />
              {hospital.commune}
              <br />
              {hospital.verified ? "Données vérifiées" : "Données à vérifier"}
            </Popup>
          </Marker>
        ))}
      </MapContainer>
      <p
        role={tilesFailed ? "status" : undefined}
        className="border-t p-3 text-xs text-muted-foreground"
      >
        {tilesFailed
          ? "Fond de carte indisponible. Les incidents et les coordonnées restent accessibles dans la file."
          : "Le fond OpenStreetMap nécessite une connexion Internet."}
      </p>
    </section>
  );
}
