/**
 * Context colour: every project gets its own three-colour accent (the platform lets album art drive
 * --a1/--a2/--a3; the studio lets the project's tracks do it). The chosen colours light primary buttons,
 * the active nav item, chips, the nebula and the glow behind hero art.
 */
export interface Palette {
  a1: string;
  a2: string;
  a3: string;
}

export class PaletteColorError extends Error {}

/** The platform's own nebula, used before any project is known. */
export const BRAND: Palette = { a1: "#ff63d8", a2: "#8e7cff", a3: "#79ebff" };

// Moods for projects that have no tracks yet, so even an empty project has its own light from the start.
export const CURATED: readonly Palette[] = [
  BRAND,
  { a1: "#f2c14e", a2: "#ff9a5c", a3: "#ff63d8" },
  { a1: "#5fe3c8", a2: "#79ebff", a3: "#8e7cff" },
  { a1: "#ff7a8a", a2: "#f2c14e", a3: "#c47cff" },
  { a1: "#7cf0c0", a2: "#79ebff", a3: "#f2c14e" },
  { a1: "#c47cff", a2: "#ff63d8", a3: "#ffb36b" },
];

/** Two accents closer than this on the colour wheel read as one colour, so the palette skips the second. */
const MIN_HUE_GAP = 35;
/** Dark ink sits on the gradient pill and the glow has to read on black, so accents are kept this light at least. */
const MIN_LIGHTNESS = 0.6;

interface Hsl {
  h: number;
  s: number;
  l: number;
}

function parse(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new PaletteColorError(`Not a hex colour: ${hex}`);
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
}

const toHex = (rgb: readonly number[]): string => `#${rgb.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0")).join("")}`;

export function hexToHsl(hex: string): Hsl {
  const [r, g, b] = parse(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s, l };
}

export function hslToHex({ h, s, l }: Hsl): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return toHex([r + m, g + m, b + m]);
}

/** Straight mix in display space, `t` = share of `b`. */
export function mixHex(a: string, b: string, t: number): string {
  const x = parse(a);
  const y = parse(b);
  const k = Math.min(1, Math.max(0, t));
  return toHex(x.map((v, i) => v + (y[i] - v) * k));
}

export const hueGap = (a: number, b: number): number => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

function lift(hex: string): string {
  const c = hexToHsl(hex);
  return c.l >= MIN_LIGHTNESS ? toHex(parse(hex)) : hslToHex({ ...c, l: MIN_LIGHTNESS + 0.04 });
}

export function seedIndex(seed: string, n: number): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % n;
}

/**
 * Picks the project's three most vivid, clearly different track colours (earlier tracks win ties). Missing
 * slots are filled from a mood chosen by the project id, so the result is stable for a project.
 */
export function projectPalette(colors: readonly string[], seed: string): Palette {
  const valid = colors.filter((c) => /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c.trim()));
  const scored = valid
    .map((c, i) => {
      const { h, s, l } = hexToHsl(c);
      // Vivid = saturated and near a bright mid lightness; greys and near-whites score low.
      return { c, h, i, score: s * (1 - Math.min(1, Math.abs(l - 0.65) * 1.5)) };
    })
    .filter((x) => x.score > 0.15)
    .sort((a, b) => b.score - a.score || a.i - b.i);

  const picked: { c: string; h: number }[] = [];
  for (const x of scored) {
    if (picked.length === 3) break;
    if (picked.every((p) => hueGap(p.h, x.h) >= MIN_HUE_GAP)) picked.push(x);
  }
  const mood = CURATED[seedIndex(seed, CURATED.length)] ?? BRAND;
  for (const c of [mood.a1, mood.a2, mood.a3, ...CURATED.flatMap((p) => [p.a1, p.a2, p.a3])]) {
    if (picked.length === 3) break;
    const h = hexToHsl(c).h;
    if (picked.every((p) => hueGap(p.h, h) >= MIN_HUE_GAP)) picked.push({ c, h });
  }
  const [a1, a2, a3] = picked.map((p) => lift(p.c));
  return { a1: a1 ?? mood.a1, a2: a2 ?? mood.a2, a3: a3 ?? mood.a3 };
}
