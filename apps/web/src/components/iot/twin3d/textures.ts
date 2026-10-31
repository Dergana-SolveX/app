import { CanvasTexture, RepeatWrapping, SRGBColorSpace, type Texture } from "three";

/** Procedural textures: nothing is downloaded, so the twin also works offline. Cached per key. */
const cache = new Map<string, Texture>();

function make(key: string, size: [number, number], draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, color = true) {
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = document.createElement("canvas");
  [canvas.width, canvas.height] = size;
  draw(canvas.getContext("2d")!, size[0], size[1]);
  const texture = new CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.anisotropy = 8;
  if (color) texture.colorSpace = SRGBColorSpace;
  cache.set(key, texture);
  return texture;
}

/** A stable pseudo-random sequence, so textures look the same on every load. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function speckle(ctx: CanvasRenderingContext2D, w: number, h: number, count: number, alpha: number, seed: number) {
  const r = rng(seed);
  for (let i = 0; i < count; i++) {
    const shade = r() > 0.5 ? 255 : 0;
    ctx.fillStyle = `rgba(${shade},${shade},${shade},${alpha * r()})`;
    ctx.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2);
  }
}

export const asphaltTexture = (base: string) =>
  make(`asphalt-${base}`, [256, 256], (ctx, w, h) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, 9000, 0.18, 7);
    const r = rng(11);
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = `rgba(0,0,0,${0.05 + r() * 0.05})`;
      ctx.beginPath();
      ctx.ellipse(r() * w, r() * h, 20 + r() * 40, 8 + r() * 20, r() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
  });

export const grassTexture = (base: string) =>
  make(`grass-${base}`, [256, 256], (ctx, w, h) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, 14000, 0.22, 3);
  });

/** One dash and its gap along the texture's length (u). */
export const dashTexture = () =>
  make("dash", [256, 8], (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w * 0.375, h);
  });

export const plateTexture = (text: string) =>
  make(`plate-${text}`, [256, 56], (ctx, w, h) => {
    ctx.fillStyle = "#f7f7f5";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "#1a1a1a";
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, w - 4, h - 4);
    ctx.fillStyle = "#111111";
    ctx.font = "bold 34px 'Geist Mono Variable', ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, w / 2, h / 2 + 2);
  });

export const chevronTexture = (red: string) =>
  make(`chevron-${red}`, [256, 64], (ctx, w, h) => {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = red;
    for (let x = -h; x < w + h; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + 20, 0);
      ctx.lineTo(x + 20 + h, h);
      ctx.lineTo(x + h, h);
      ctx.closePath();
      ctx.fill();
    }
  });

/** Facade with windows; at night, `lit` paints a share of them as the emissive map. */
export const facadeTexture = (base: string, lit: boolean) =>
  make(`facade-${base}-${lit}`, [128, 256], (ctx, w, h) => {
    ctx.fillStyle = lit ? "#000000" : base;
    ctx.fillRect(0, 0, w, h);
    const r = rng(lit ? 21 : 5);
    for (let y = 8; y < h - 8; y += 22) {
      for (let x = 8; x < w - 8; x += 20) {
        if (lit) {
          if (r() < 0.38) {
            ctx.fillStyle = r() < 0.75 ? "#ffd89a" : "#cfe6ff";
            ctx.fillRect(x, y, 12, 14);
          }
        } else {
          ctx.fillStyle = r() < 0.5 ? "rgba(40,60,75,0.55)" : "rgba(70,95,110,0.45)";
          ctx.fillRect(x, y, 12, 14);
        }
      }
    }
  });

/** A soft white disc: particles and the pools of light under street lamps. */
export const softDiscTexture = () =>
  make(
    "soft-disc",
    [128, 128],
    (ctx, w, h) => {
      const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(0.4, "rgba(255,255,255,0.55)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    },
    false,
  );

export const potholeTexture = () =>
  make("pothole", [256, 256], (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    const r = rng(17);
    const cx = w / 2;
    const cy = h / 2;
    const ring = (radius: number, fill: string, jitter: number) => {
      ctx.fillStyle = fill;
      ctx.beginPath();
      for (let a = 0; a <= Math.PI * 2 + 0.01; a += Math.PI / 24) {
        const rr = radius * (1 - jitter / 2 + r() * jitter);
        const x = cx + Math.cos(a) * rr;
        const y = cy + Math.sin(a) * rr;
        if (a === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
    };
    ring(118, "rgba(150,150,145,0.55)", 0.12);
    ring(100, "rgba(25,25,24,0.95)", 0.18);
    ring(70, "rgba(8,8,8,1)", 0.25);
    ctx.strokeStyle = "rgba(20,20,20,0.7)";
    ctx.lineWidth = 2;
    for (let i = 0; i < 9; i++) {
      const a = r() * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * 100, cy + Math.sin(a) * 100);
      ctx.lineTo(cx + Math.cos(a + (r() - 0.5) * 0.4) * (120 + r() * 8), cy + Math.sin(a + (r() - 0.5) * 0.4) * (120 + r() * 8));
      ctx.stroke();
    }
  });
