import { encodeSvx, type SvxAlert } from "@solvex-dergana/shared";

export type SmsPreset = {
  label: string;
  hint: string;
  /** Built when clicked, so the event time is "now". */
  build: () => string;
};

const nowMinutes = () => Math.floor(Date.now() / 60_000);

const base = (): SvxAlert => ({
  layer: 2,
  geohash: "snd2bmtf", // Bab Ezzouar
  eventMinutes: nowMinutes(),
  peakG: null,
  rollover: null,
  fire: false,
  victims: 2,
  conscious: 1,
  trapped: false,
  bleeding: false,
  profileCode: null,
  deltaVKmh: null,
  cell: null,
});

/** Ready-made messages for the demo. They are real SVX v1 strings built with the shared encoder. */
export const SMS_PRESETS: SmsPreset[] = [
  {
    label: "Témoin",
    hint: "2 victimes, coincées, feu",
    build: () => encodeSvx({ ...base(), fire: true, trapped: true }),
  },
  {
    label: "Puce (choc)",
    hint: "8,5 g, tonneau, 3 victimes",
    build: () =>
      encodeSvx({
        ...base(),
        layer: 1,
        geohash: "snd2vrp3", // Autoroute Est-Ouest
        peakG: 8.5,
        rollover: true,
        fire: true,
        victims: 3,
        conscious: 0,
        trapped: true,
        deltaVKmh: 42,
      }),
  },
  {
    label: "Checksum faux",
    hint: "corrompu en route: doit être reçu quand même",
    // The payload changes after the checksum was computed.
    build: () => encodeSvx(base()).replace("#V:2#", "#V:5#"),
  },
  {
    label: "Texte libre",
    hint: "pas un message SVX: archivé, sans incident",
    build: () => "Bonjour, accident à Rouiba",
  },
];
