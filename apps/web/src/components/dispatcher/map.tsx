import { useEffect, useState } from "react";
import { divIcon } from "leaflet";
import { Circle, GeoJSON, MapContainer, Marker, Popup, TileLayer, Tooltip, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { Button } from "@solvex-dergana/ui/components/button";
import { MapIcon, XIcon } from "lucide-react";
import { incidentRef } from "@/lib/time";
import type { Incident, MapLayers } from "./types";

type MapIncident = Pick<Incident, "id" | "lat" | "lng" | "locationUncertaintyM" | "recSeverity" | "commune">;

export const SEVERITY_WORD = { red: "Rouge", yellow: "Jaune", green: "Vert", unknown: "Inconnue" } as const;
const SEVERITY_LETTER = { red: "R", yellow: "J", green: "V", unknown: "?" } as const;

/** Where the map should look, and why: hovering only pans when the alert is off-screen, locating zooms in. */
export type MapFocus = { id: string; mode: "hover" | "locate"; nonce: number } | null;

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

const icon = (label: string, color: string, accessibleName: string, highlighted = false) => {
  const element = document.createElement("span");
  element.textContent = label;
  element.setAttribute("aria-label", accessibleName);
  const size = highlighted ? 44 : 32;
  element.style.cssText = [
    `background:${highlighted ? `var(--${color})` : "var(--card)"}`,
    `color:${highlighted ? "var(--card)" : `var(--${color})`}`,
    `border:2px solid var(--${color})`,
    "display:grid",
    "place-items:center",
    `width:${size}px`,
    `height:${size}px`,
    "border-radius:8px",
    "font-weight:700",
    `font-size:${highlighted ? 16 : 12}px`,
    "font-family:var(--font-sans)",
    highlighted
      ? `box-shadow:0 0 0 6px color-mix(in srgb, var(--${color}) 30%, transparent), var(--shadow-md)`
      : "box-shadow:var(--shadow-sm)",
  ].join(";");
  return divIcon({
    className: "dispatcher-map-marker",
    html: element,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
};

const incidentName = (i: MapIncident) =>
  `Incident ${i.commune ?? incidentRef(i.id)} — ${SEVERITY_WORD[i.recSeverity]}`;

function FollowFocus({ focus, incidents }: { focus: MapFocus; incidents: MapIncident[] }) {
  const map = useMap();
  const target = focus ? incidents.find((i) => i.id === focus.id) : undefined;
  useEffect(() => {
    if (!focus || target?.lat == null || target.lng == null) return;
    const point: [number, number] = [target.lat, target.lng];
    const animate = !prefersReducedMotion();
    if (focus.mode === "locate") {
      map.setView(point, Math.max(map.getZoom(), 15), { animate });
    } else if (!map.getBounds().pad(-0.15).contains(point)) {
      map.panTo(point, { animate, duration: 0.4 });
    }
  }, [map, focus?.id, focus?.mode, focus?.nonce, target?.lat, target?.lng]);
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
  highlightedId = null,
  onHighlight,
  focus = null,
  onClose,
}: {
  incidents: MapIncident[];
  layers: MapLayers;
  selectedId: string | null;
  onSelect: (id: string) => void;
  highlightedId?: string | null;
  onHighlight?: (id: string | null) => void;
  focus?: MapFocus;
  onClose?: () => void;
}) {
  const [tilesFailed, setTilesFailed] = useState(false);
  const placed = incidents.filter((i) => i.lat !== null && i.lng !== null);
  const effectiveFocus: MapFocus = focus ?? (selectedId ? { id: selectedId, mode: "hover", nonce: 0 } : null);
  return (
    <section aria-label="Carte opérationnelle" className="min-w-0 overflow-hidden rounded-lg border bg-card shadow-sm">
      <div className="flex items-start justify-between gap-3 border-b p-4">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <MapIcon className="size-5 text-primary" aria-hidden="true" />
            Carte opérationnelle
          </h2>
          <p className="text-sm text-muted-foreground">
            Survolez une alerte pour la repérer. R / J / V / ? : gravité · U : unité · H : hôpital
          </p>
        </div>
        {onClose && (
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Masquer la carte">
            <XIcon />
          </Button>
        )}
      </div>
      <MapContainer
        center={[36.73, 3.12]}
        zoom={11}
        scrollWheelZoom={false}
        className="isolate z-0 h-[360px] w-full lg:h-[420px]"
        aria-label="Carte des incidents"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributeurs'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          eventHandlers={{ tileerror: () => setTilesFailed(true) }}
        />
        <FollowFocus focus={effectiveFocus} incidents={placed} />
        {layers.zones.map((zone) => (
          <GeoJSON key={zone.id} data={zone.polygon} style={{ color: "var(--brand)", weight: 1, fillOpacity: 0.05 }}>
            <Tooltip>{zone.name}</Tooltip>
          </GeoJSON>
        ))}
        {placed
          .filter((i) => (i.locationUncertaintyM ?? 0) > 0)
          .map((i) => (
            <Circle
              key={`accuracy-${i.id}`}
              center={[i.lat!, i.lng!]}
              radius={i.locationUncertaintyM!}
              pathOptions={{
                color: `var(--sev-${i.recSeverity})`,
                weight: highlightedId === i.id ? 2 : 1,
                fillOpacity: highlightedId === i.id ? 0.16 : 0.08,
              }}
            >
              <Tooltip>Incertitude : {i.locationUncertaintyM} m</Tooltip>
            </Circle>
          ))}
        {layers.units.map((unit) => (
          <Marker
            key={unit.id}
            position={[unit.lat, unit.lng]}
            icon={icon("U", unit.available ? "primary" : "muted-foreground", `Unité ${unit.callSign}`)}
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
            icon={icon("H", "info", hospital.name)}
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
        {placed.map((i) => {
          const highlighted = highlightedId === i.id || selectedId === i.id;
          return (
            <Marker
              key={i.id}
              position={[i.lat!, i.lng!]}
              icon={icon(SEVERITY_LETTER[i.recSeverity], `sev-${i.recSeverity}`, incidentName(i), highlighted)}
              zIndexOffset={highlighted ? 1000 : 500}
              alt={incidentName(i)}
              title={incidentName(i)}
              eventHandlers={{
                click: () => onSelect(i.id),
                mouseover: () => onHighlight?.(i.id),
                mouseout: () => onHighlight?.(null),
              }}
            >
              <Tooltip
                key={highlightedId === i.id ? "pinned" : "hover"}
                permanent={highlightedId === i.id}
                direction="top"
                offset={[0, -18]}
              >
                {i.commune ?? `#${incidentRef(i.id)}`} · {SEVERITY_WORD[i.recSeverity]}
                <br />
                <span className="tabular">
                  {i.lat!.toFixed(5)}, {i.lng!.toFixed(5)}
                </span>
              </Tooltip>
            </Marker>
          );
        })}
      </MapContainer>
      <p role={tilesFailed ? "status" : undefined} className="border-t px-4 py-3 text-xs text-muted-foreground">
        {tilesFailed
          ? "Fond de carte indisponible. Les alertes et leurs coordonnées restent accessibles dans la file."
          : `${placed.length} alerte${placed.length > 1 ? "s" : ""} localisée${placed.length > 1 ? "s" : ""} · fond OpenStreetMap (connexion Internet requise).`}
      </p>
    </section>
  );
}
