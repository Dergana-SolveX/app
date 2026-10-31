import {
  route,
  type HospitalMatch,
  type LatLng,
  type MatchHospital,
  type RoadGraph,
} from "@solvex-dergana/shared";
import { divIcon, latLngBounds } from "leaflet";
import { MapIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";

export type SuggestedHospital = {
  rank: number;
  hospital: MatchHospital;
  match: HospitalMatch;
};

const minutes = (value: number) => `${Math.max(1, Math.round(value))} min`;
const km = (metres: number) =>
  `${(metres / 1000).toFixed(1).replace(".", ",")} km`;

function markerIcon(
  label: string,
  accessibleName: string,
  kind: "scene" | "recommended" | "hospital",
) {
  const element = document.createElement("span");
  element.textContent = label;
  element.setAttribute("aria-label", accessibleName);
  const color =
    kind === "scene"
      ? "--sev-red"
      : kind === "recommended"
        ? "--brand"
        : "--info";
  element.style.cssText = [
    "background:var(--card)",
    `color:var(${color})`,
    `border:3px solid var(${color})`,
    "display:grid",
    "place-items:center",
    "width:38px",
    "height:38px",
    "border-radius:9999px",
    "font-weight:800",
    "font-size:14px",
    "font-family:var(--font-sans)",
    "box-shadow:var(--shadow-md)",
  ].join(";");
  return divIcon({
    className: "hospital-route-map-marker",
    html: element,
    iconSize: [38, 38],
    iconAnchor: [19, 19],
    popupAnchor: [0, -20],
  });
}

function MapViewport({ points }: { points: LatLng[] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length > 1) {
      map.fitBounds(latLngBounds(points), {
        padding: [32, 32],
        maxZoom: 14,
        animate: false,
      });
    }
  }, [map, points]);
  useEffect(() => {
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);
  return null;
}

/** Road map for the top hospital suggestions, using the same local A* routes as the ETA ranking. */
export function HospitalRouteMap({
  scene,
  graph,
  suggestions,
  recommendedId,
  chosenId,
  onChoose,
}: {
  scene: LatLng;
  graph: RoadGraph;
  suggestions: SuggestedHospital[];
  recommendedId: string | null;
  chosenId: string | null;
  onChoose: (hospitalId: string) => void;
}) {
  const [tilesFailed, setTilesFailed] = useState(false);
  const routes = useMemo(
    () =>
      suggestions.map((suggestion) => ({
        ...suggestion,
        road: route(graph, scene, [
          suggestion.hospital.lat,
          suggestion.hospital.lng,
        ]),
      })),
    [graph, scene, suggestions],
  );
  const viewportPoints = useMemo(
    () => [
      scene,
      ...routes.flatMap(
        ({ hospital, road }) =>
          road?.polyline ?? ([[hospital.lat, hospital.lng]] as LatLng[]),
      ),
    ],
    [routes, scene],
  );

  return (
    <section
      aria-label="Carte des hôpitaux suggérés"
      className="overflow-hidden rounded-lg border bg-card shadow-sm"
    >
      <div className="border-b p-3 sm:p-4">
        <h3 className="flex items-center gap-2 text-base font-bold">
          <MapIcon className="size-5 text-primary" aria-hidden="true" />
          Hôpitaux suggérés sur la carte
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Les trois meilleures options, avec leur itinéraire routier depuis
          l'accident. Touchez un hôpital pour le retenir.
        </p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
          <span className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1">
            <span
              className="size-2.5 rounded-full bg-sev-red"
              aria-hidden="true"
            />
            Accident
          </span>
          {routes.map(({ rank, hospital, match }) => (
            <span
              key={hospital.id}
              className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1"
            >
              <span
                className={`size-2.5 rounded-full ${hospital.id === recommendedId ? "bg-primary" : "bg-info"}`}
                aria-hidden="true"
              />
              {rank}. {hospital.shortName} · {minutes(match.etaMin)}
            </span>
          ))}
        </div>
      </div>

      <MapContainer
        center={scene}
        zoom={12}
        scrollWheelZoom={false}
        className="isolate z-0 h-[360px] w-full sm:h-[440px]"
        aria-label="Routes entre l'accident et les hôpitaux suggérés"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributeurs'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          eventHandlers={{ tileerror: () => setTilesFailed(true) }}
        />
        <MapViewport points={viewportPoints} />

        {routes.map(({ hospital, road }) => {
          const selected = hospital.id === chosenId;
          const recommended = hospital.id === recommendedId;
          const positions =
            road?.polyline ??
            ([scene, [hospital.lat, hospital.lng]] as LatLng[]);
          return (
            <Polyline
              key={`route-${hospital.id}`}
              positions={positions}
              pathOptions={{
                color: selected || recommended ? "var(--brand)" : "var(--info)",
                weight: selected ? 7 : recommended ? 6 : 4,
                opacity: selected || recommended ? 0.95 : 0.65,
                dashArray: road ? undefined : "8 8",
              }}
            >
              <Tooltip sticky>
                {hospital.name} ·{" "}
                {road ? "route calculée" : "estimation directe"}
              </Tooltip>
            </Polyline>
          );
        })}

        <Marker
          position={scene}
          icon={markerIcon("A", "Lieu de l'accident", "scene")}
          title="Lieu de l'accident"
          alt="Lieu de l'accident"
          zIndexOffset={1000}
        >
          <Popup>
            <strong>Lieu de l'accident</strong>
          </Popup>
        </Marker>

        {routes.map(({ rank, hospital, match }) => {
          const recommended = hospital.id === recommendedId;
          return (
            <Marker
              key={hospital.id}
              position={[hospital.lat, hospital.lng]}
              icon={markerIcon(
                String(rank),
                `${rank}. ${hospital.name}, ${minutes(match.etaMin)}`,
                recommended ? "recommended" : "hospital",
              )}
              title={`${rank}. ${hospital.name}`}
              alt={`${rank}. ${hospital.name}`}
              eventHandlers={{ click: () => onChoose(hospital.id) }}
              zIndexOffset={recommended ? 800 : 500}
            >
              <Popup>
                <strong>
                  {rank}. {hospital.name}
                </strong>
                <br />
                {minutes(match.etaMin)} · {km(match.distanceM)}
                <br />
                {recommended ? "Hôpital recommandé" : "Alternative suggérée"}
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>

      <p
        role={tilesFailed ? "status" : undefined}
        className="border-t px-3 py-2 text-xs text-muted-foreground sm:px-4"
      >
        {tilesFailed
          ? "Fond de carte indisponible : les itinéraires calculés restent visibles."
          : "Routes calculées localement sur le réseau OSM · sans trafic en temps réel."}
      </p>
    </section>
  );
}
