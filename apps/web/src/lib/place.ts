/** Where an incident is, as precisely as the alerts say: a geohash, else a road kilometre point, else a commune. */
export function placeLabel(place: {
  geohash8: string | null;
  roadRef: string | null;
  pkMarker: string | null;
  commune: string | null;
}) {
  if (place.geohash8) return place.geohash8;
  if (place.roadRef && place.pkMarker) return `${place.roadRef} ${place.pkMarker}`;
  return place.commune ?? "position inconnue";
}
