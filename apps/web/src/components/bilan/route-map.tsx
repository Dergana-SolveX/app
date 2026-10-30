import type { LatLng } from "@solvex-dergana/shared";

const WIDTH = 640;
const PAD = 36;

/**
 * The route drawn on a plain background: no map tiles, so it works with no network and needs no map key.
 * Positions are projected so that east-west and north-south distances keep their proportions at this latitude.
 */
export function RouteMap({
  polyline,
  from,
  to,
  fromLabel,
  toLabel,
  description,
}: {
  polyline: LatLng[];
  from: LatLng;
  to: LatLng;
  fromLabel: string;
  toLabel: string;
  description: string;
}) {
  const points = polyline.length >= 2 ? polyline : [from, to];
  const lats = points.map((p) => p[0]);
  const lngs = points.map((p) => p[1]);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const lngScale = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
  const spanX = Math.max((maxLng - minLng) * lngScale, 1e-4);
  const spanY = Math.max(maxLat - minLat, 1e-4);
  const scale = (WIDTH - 2 * PAD) / Math.max(spanX, spanY);
  const height = Math.round(spanY * scale + 2 * PAD);
  const width = Math.round(spanX * scale + 2 * PAD);
  const project = ([lat, lng]: LatLng) => ({
    x: PAD + (lng - minLng) * lngScale * scale,
    y: PAD + (maxLat - lat) * scale,
  });

  const path = points.map((p) => project(p)).map(({ x, y }, i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  // A label on the right half of the picture is written towards the left, so it never runs off the edge.
  const anchor = (x: number) => (x > width / 2 ? "end" : "start");
  const labelX = (x: number) => (x > width / 2 ? x - 14 : x + 14);
  const start = project(from);
  const end = project(to);

  return (
    <figure className="m-0">
      <svg
        role="img"
        aria-label={description}
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto max-h-80 w-full rounded-lg border bg-raised"
      >
        <path d={path} fill="none" className="stroke-primary" strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={start.x} cy={start.y} r={9} className="fill-sev-red stroke-card" strokeWidth={3} />
        <circle cx={end.x} cy={end.y} r={9} className="fill-primary stroke-card" strokeWidth={3} />
        <text x={labelX(start.x)} y={start.y - 14} textAnchor={anchor(start.x)} className="fill-foreground text-[16px] font-bold">
          {fromLabel}
        </text>
        <text x={labelX(end.x)} y={end.y - 14} textAnchor={anchor(end.x)} className="fill-foreground text-[16px] font-bold">
          {toLabel}
        </text>
      </svg>
    </figure>
  );
}
