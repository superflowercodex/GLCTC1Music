export const PIANO_TIMBRES = ["Grand", "Bright", "Felt"] as const;
export type PianoTimbre = (typeof PIANO_TIMBRES)[number];

export const PIANO_LOW = 24;
export const PIANO_HIGH = 108;
export const PIANO_SPACING = 4;
export const PIANO_RATE = 24000;
const SECONDS = 2.6;

/** MIDI roots at which piano samples are rendered; other notes are re-pitched from the nearest one. */
export function pianoRoots(): number[] {
  const roots: number[] = [];
  for (let n = PIANO_LOW; n <= PIANO_HIGH; n += PIANO_SPACING) roots.push(n);
  return roots;
}

const PROFILE: Record<PianoTimbre, { rolloff: number; decay: number; inharm: number }> = {
  Grand: { rolloff: 1.15, decay: 1, inharm: 0.00035 },
  Bright: { rolloff: 0.7, decay: 0.8, inharm: 0.0005 },
  Felt: { rolloff: 1.8, decay: 1.25, inharm: 0.0002 },
};

/** One additive piano note: stretched partials, each decaying faster the higher it sits. */
export function renderPianoNote(root: number, timbre: PianoTimbre, sampleRate = PIANO_RATE): Float32Array {
  const out = new Float32Array(Math.round(SECONDS * sampleRate));
  const { rolloff, decay, inharm } = PROFILE[timbre];
  const f0 = 440 * 2 ** ((root - 69) / 12);
  // Low notes ring longer than high ones.
  const base = decay * (2.4 - (root - 24) / 50);
  const partials = Math.min(14, Math.floor((sampleRate / 2.2) / f0));
  let peak = 0;
  for (let k = 1; k <= partials; k++) {
    const freq = f0 * k * Math.sqrt(1 + inharm * k * k);
    const amp = 1 / k ** rolloff;
    const tau = Math.max(0.05, base / (1 + 0.45 * (k - 1)));
    const w = (2 * Math.PI * freq) / sampleRate;
    const rot = Math.exp(-1 / (tau * sampleRate));
    // Recursive oscillator and envelope avoid a sin() and exp() call per sample.
    let s = 0;
    let c = 1;
    let env = amp;
    const cw = Math.cos(w);
    const sw = Math.sin(w);
    for (let i = 0; i < out.length; i++) {
      out[i] += s * env;
      const ns = s * cw + c * sw;
      c = c * cw - s * sw;
      s = ns;
      env *= rot;
    }
  }
  for (let i = 0; i < out.length; i++) {
    // Short attack ramp removes the click of starting mid-cycle.
    const t = i / sampleRate;
    out[i] *= Math.min(1, t * 400);
    peak = Math.max(peak, Math.abs(out[i]));
  }
  if (peak > 0) for (let i = 0; i < out.length; i++) out[i] /= peak * 1.15;
  return out;
}

const rendered = new Map<string, AudioBuffer[]>();

/** All sample points for a timbre, rendered once per context sample rate. */
export function pianoBuffers(ctx: BaseAudioContext, timbre: PianoTimbre): AudioBuffer[] {
  const key = `${timbre}@${ctx.sampleRate}`;
  let list = rendered.get(key);
  if (!list) {
    list = pianoRoots().map((root) => {
      const data = renderPianoNote(root, timbre);
      const buffer = ctx.createBuffer(1, data.length, PIANO_RATE);
      buffer.getChannelData(0).set(data);
      return buffer;
    });
    rendered.set(key, list);
  }
  return list;
}

export function nearestPianoIndex(note: number): number {
  const roots = pianoRoots();
  let best = 0;
  for (let i = 1; i < roots.length; i++) if (Math.abs(roots[i] - note) < Math.abs(roots[best] - note)) best = i;
  return best;
}
