export type Rng = {
  /** A number in [0, 1). */
  next(): number;
  /** A number in [min, max). */
  between(min: number, max: number): number;
  /** A normally distributed number with the given standard deviation. */
  gaussian(sigma: number): number;
};

/** A small seeded random source (mulberry32): the same seed always gives the same simulation. */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    between: (min, max) => min + next() * (max - min),
    // Box-Muller: two uniform numbers make one normal one.
    gaussian: (sigma) => sigma * Math.sqrt(-2 * Math.log(1 - next())) * Math.cos(2 * Math.PI * next()),
  };
}
