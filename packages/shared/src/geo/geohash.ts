const ALPHABET = "0123456789bcdefghjkmnpqrstuvwxyz";

export type GeohashCell = {
  /** Centre of the cell. */
  lat: number;
  lng: number;
  /** Half the height and half the width of the cell, in degrees. */
  latError: number;
  lngError: number;
};

export type Direction = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

/** Encodes a position as a geohash. Precision 8 is a cell of about 38 m by 19 m. */
export function geohashEncode(lat: number, lng: number, precision = 8): string {
  const latRange = [-90, 90];
  const lngRange = [-180, 180];
  let hash = "";
  let bit = 0;
  let value = 0;
  let evenBit = true; // even bits refine longitude, odd bits latitude

  while (hash.length < precision) {
    const range = evenBit ? lngRange : latRange;
    const point = evenBit ? lng : lat;
    const mid = (range[0]! + range[1]!) / 2;
    if (point > mid) {
      value = value * 2 + 1;
      range[0] = mid;
    } else {
      value = value * 2;
      range[1] = mid;
    }
    evenBit = !evenBit;
    if (++bit === 5) {
      hash += ALPHABET[value];
      bit = 0;
      value = 0;
    }
  }
  return hash;
}

/** The cell a geohash stands for: its centre and half-size. Throws on an invalid geohash. */
export function geohashDecode(hash: string): GeohashCell {
  if (hash.length === 0) throw new RangeError("geohash is empty");
  const latRange = [-90, 90];
  const lngRange = [-180, 180];
  let evenBit = true;

  for (const char of hash) {
    const value = ALPHABET.indexOf(char);
    if (value < 0) throw new RangeError(`"${char}" is not a geohash character`);
    for (const mask of [16, 8, 4, 2, 1]) {
      const range = evenBit ? lngRange : latRange;
      const mid = (range[0]! + range[1]!) / 2;
      if (value & mask) range[0] = mid;
      else range[1] = mid;
      evenBit = !evenBit;
    }
  }
  return {
    lat: (latRange[0]! + latRange[1]!) / 2,
    lng: (lngRange[0]! + lngRange[1]!) / 2,
    latError: (latRange[1]! - latRange[0]!) / 2,
    lngError: (lngRange[1]! - lngRange[0]!) / 2,
  };
}

// Neighbour lookup tables of the standard geohash algorithm (index 0: odd length, 1: even length).
const NEIGHBOR: Record<"n" | "s" | "e" | "w", [string, string]> = {
  n: ["p0r21436x8zb9dcf5h7kjnmqesgutwvy", "bc01fg45238967deuvhjyznpkmstqrwx"],
  s: ["14365h7k9dcfesgujnmqp0r2twvyx8zb", "238967debc01fg45kmstqrwxuvhjyznp"],
  e: ["bc01fg45238967deuvhjyznpkmstqrwx", "p0r21436x8zb9dcf5h7kjnmqesgutwvy"],
  w: ["238967debc01fg45kmstqrwxuvhjyznp", "14365h7k9dcfesgujnmqp0r2twvyx8zb"],
};
const BORDER: Record<"n" | "s" | "e" | "w", [string, string]> = {
  n: ["prxz", "bcfguvyz"],
  s: ["028b", "0145hjnp"],
  e: ["bcfguvyz", "prxz"],
  w: ["0145hjnp", "028b"],
};

function adjacent(hash: string, direction: "n" | "s" | "e" | "w"): string {
  const last = hash[hash.length - 1]!;
  let parent = hash.slice(0, -1);
  const parity = hash.length % 2;
  if (BORDER[direction][parity]!.includes(last) && parent !== "") parent = adjacent(parent, direction);
  return parent + ALPHABET[NEIGHBOR[direction][parity]!.indexOf(last)];
}

/** The 8 cells around a geohash (same precision). */
export function geohashNeighbors(hash: string): Record<Direction, string> {
  geohashDecode(hash); // validates
  const n = adjacent(hash, "n");
  const s = adjacent(hash, "s");
  return {
    n,
    ne: adjacent(n, "e"),
    e: adjacent(hash, "e"),
    se: adjacent(s, "e"),
    s,
    sw: adjacent(s, "w"),
    w: adjacent(hash, "w"),
    nw: adjacent(n, "w"),
  };
}
