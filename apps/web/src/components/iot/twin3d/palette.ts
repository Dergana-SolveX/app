/**
 * Colours of the 3D twin. Status colours (brand, danger, warning, success, info) and the canvas background
 * come from the design tokens at runtime, so the scene follows the theme; the rest is the landscape itself.
 */
export type ScenePalette = {
  dark: boolean;
  background: string;
  skyTop: string;
  skyHorizon: string;
  grass: string;
  asphalt: string;
  shoulder: string;
  lane: string;
  curb: string;
  building: string;
  foliage: string;
  trunk: string;
  hills: string;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  sun: string;
  sunIntensity: number;
  carPaint: string;
  brand: string;
  danger: string;
  warning: string;
  success: string;
  info: string;
};

const token = (name: string, fallback: string) => {
  if (typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
};

export function readPalette(dark: boolean): ScenePalette {
  const background = token("--card", dark ? "#09090b" : "#ffffff");
  return {
    dark,
    background,
    skyTop: dark ? "#020304" : "#c9d9e4",
    skyHorizon: dark ? "#14171c" : "#f4f7f9",
    grass: dark ? "#0d1a12" : "#a9c49b",
    asphalt: dark ? "#16191c" : "#4c5257",
    shoulder: dark ? "#1d2125" : "#5d6368",
    lane: dark ? "#d9dee2" : "#f5f7f8",
    curb: dark ? "#2a2f33" : "#c8cdd1",
    building: dark ? "#14181d" : "#d4dbe0",
    foliage: dark ? "#10261a" : "#5d8f5a",
    trunk: dark ? "#2a2119" : "#6a5442",
    hills: dark ? "#0b1410" : "#b4c7bc",
    hemiSky: dark ? "#33465c" : "#eef4f8",
    hemiGround: dark ? "#050607" : "#7f8c78",
    hemiIntensity: dark ? 0.55 : 1.05,
    sun: dark ? "#9db8ff" : "#fff3df",
    sunIntensity: dark ? 0.9 : 2.6,
    carPaint: "#c4ccd2",
    brand: token("--brand", "#16a34a"),
    danger: token("--sev-red", "#dc2626"),
    warning: token("--sev-yellow", "#d97706"),
    success: token("--sev-green", "#16a34a"),
    info: token("--info", "#2563eb"),
  };
}
