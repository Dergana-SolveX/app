/** A position as [lat, lng] in degrees. */
export type LatLng = [number, number];

function encodeNumber(value: number): string {
  let v = value < 0 ? ~(value << 1) : value << 1;
  let out = "";
  while (v >= 0x20) {
    out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
    v >>= 5;
  }
  return out + String.fromCharCode(v + 63);
}

/**
 * Packs a list of positions into a short ASCII string (Google's "encoded polyline" format, 5 decimals,
 * about 1 m). Each point is stored as the difference from the previous one, which is what keeps it small.
 */
export function encodePolyline(points: readonly LatLng[]): string {
  let out = "";
  let prevLat = 0;
  let prevLng = 0;
  for (const [lat, lng] of points) {
    const latE5 = Math.round(lat * 1e5);
    const lngE5 = Math.round(lng * 1e5);
    out += encodeNumber(latE5 - prevLat) + encodeNumber(lngE5 - prevLng);
    prevLat = latE5;
    prevLng = lngE5;
  }
  return out;
}

/** The positions packed by `encodePolyline`. */
export function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  const readNumber = () => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };

  while (index < encoded.length) {
    lat += readNumber();
    lng += readNumber();
    points.push([lat / 1e5, lng / 1e5]);
  }
  return points;
}
