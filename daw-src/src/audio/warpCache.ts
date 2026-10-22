export interface WarpParams {
  /** Playback speed relative to the source: 1 leaves tempo alone, 2 plays twice as fast. */
  tempoRatio: number;
  semitones: number;
  cents: number;
  /** Keep the original pitch while the tempo changes. */
  keyLock: boolean;
}

export class WarpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WarpError";
  }
}

const MIN_RATIO = 0.25;
const MAX_RATIO = 4;
const MAX_CACHE_BYTES = 256 * 1024 * 1024;
const MAX_CACHE_ENTRIES = 32;

const FRAME = 2048;
const HOP_OUT = FRAME / 2;
const SEARCH = 512;
const COARSE = 4;

const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function makeYielder(): () => Promise<void> {
  let last = performance.now();
  return async () => {
    if (performance.now() - last < 12) return;
    await yieldToEventLoop();
    last = performance.now();
  };
}

/** Final playback pitch ratio and the duration ratio (output seconds per source second). */
export function warpPlan(params: WarpParams): { pitch: number; durationScale: number } {
  const { tempoRatio, semitones, cents, keyLock } = params;
  if (!Number.isFinite(tempoRatio) || tempoRatio < MIN_RATIO || tempoRatio > MAX_RATIO) {
    throw new WarpError(`Tempo ratio ${tempoRatio} is outside ${MIN_RATIO} to ${MAX_RATIO}.`);
  }
  if (!Number.isFinite(semitones) || !Number.isFinite(cents)) throw new WarpError("Pitch must be a number.");
  const shift = 2 ** ((semitones + cents / 100) / 12);
  // Without key lock the tempo change behaves like a record speeding up, so it also moves the pitch.
  const pitch = shift * (keyLock ? 1 : tempoRatio);
  return { pitch, durationScale: 1 / tempoRatio };
}

function isNeutral(p: WarpParams): boolean {
  return p.tempoRatio === 1 && p.semitones === 0 && p.cents === 0;
}

/**
 * Waveform-similarity overlap-add. The best join point is searched on the mono mix and applied to every
 * channel, so the stereo image cannot drift between channels.
 */
async function wsola(channels: Float32Array[], scale: number, maybeYield: () => Promise<void>): Promise<Float32Array[]> {
  const length = channels[0].length;
  const outLength = Math.max(1, Math.round(length * scale));
  const out = channels.map(() => new Float32Array(outLength + FRAME));
  const norm = new Float32Array(outLength + FRAME);
  const window = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FRAME);

  const mono = new Float32Array(length);
  for (const c of channels) for (let i = 0; i < length; i++) mono[i] += c[i] / channels.length;

  const frames = Math.ceil(outLength / HOP_OUT) + 1;
  let prevStart = 0;
  for (let k = 0; k < frames; k++) {
    const outPos = k * HOP_OUT;
    const target = Math.round(outPos / scale);
    let start = target;
    if (k > 0) {
      // What the previous frame would have played next is the best guide to what should come after it.
      const ref = prevStart + HOP_OUT;
      start = bestOffset(mono, ref, target, HOP_OUT);
    }
    for (let c = 0; c < channels.length; c++) {
      const src = channels[c];
      const dst = out[c];
      for (let i = 0; i < FRAME; i++) {
        const s = start + i;
        if (s >= 0 && s < length) dst[outPos + i] += src[s] * window[i];
      }
    }
    for (let i = 0; i < FRAME; i++) norm[outPos + i] += window[i];
    prevStart = start;
    if ((k & 0x3f) === 0) await maybeYield();
  }

  return out.map((dst) => {
    const trimmed = new Float32Array(outLength);
    for (let i = 0; i < outLength; i++) trimmed[i] = norm[i] > 1e-5 ? dst[i] / norm[i] : 0;
    return trimmed;
  });
}

/** Start position near `target` whose first `overlap` samples best match the samples starting at `ref`. */
function bestOffset(mono: Float32Array, ref: number, target: number, overlap: number): number {
  const length = mono.length;
  if (ref < 0 || ref + overlap >= length) return Math.min(Math.max(0, target), Math.max(0, length - 1));
  const lo = Math.max(0, target - SEARCH);
  const hi = Math.min(length - overlap - 1, target + SEARCH);
  if (hi <= lo) return Math.min(Math.max(0, target), length - 1);

  const score = (cand: number, stride: number): number => {
    let dot = 0;
    let energy = 1e-9;
    for (let i = 0; i < overlap; i += stride) {
      const v = mono[cand + i];
      dot += v * mono[ref + i];
      energy += v * v;
    }
    return dot / Math.sqrt(energy);
  };

  let best = Math.min(hi, Math.max(lo, target));
  let bestScore = -Infinity;
  for (let cand = lo; cand <= hi; cand += COARSE) {
    const s = score(cand, COARSE);
    if (s > bestScore) {
      bestScore = s;
      best = cand;
    }
  }
  const fineLo = Math.max(lo, best - COARSE);
  const fineHi = Math.min(hi, best + COARSE);
  bestScore = -Infinity;
  for (let cand = fineLo; cand <= fineHi; cand++) {
    const s = score(cand, 2);
    if (s > bestScore) {
      bestScore = s;
      best = cand;
    }
  }
  return best;
}

const SINC_HALF_WIDTH = 8;
const TABLE_RES = 64;

/** Windowed-sinc kernel table for reading the signal `pitch` times faster, low-passed so nothing folds back when pitch > 1. */
function makeKernel(pitch: number): { table: Float32Array; reach: number } {
  const cutoff = Math.min(1, 1 / pitch);
  const reach = SINC_HALF_WIDTH / cutoff;
  const size = Math.ceil(reach * TABLE_RES) + 2;
  const table = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const x = i / TABLE_RES;
    const arg = Math.PI * x * cutoff;
    const sinc = x === 0 ? 1 : Math.sin(arg) / arg;
    const w = x >= reach ? 0 : 0.5 + 0.5 * Math.cos((Math.PI * x) / reach);
    table[i] = cutoff * sinc * w;
  }
  return { table, reach };
}

async function resample(channels: Float32Array[], pitch: number, maybeYield: () => Promise<void>): Promise<Float32Array[]> {
  const length = channels[0].length;
  const outLength = Math.max(1, Math.round(length / pitch));
  const { table, reach } = makeKernel(pitch);
  const out = channels.map(() => new Float32Array(outLength));
  const last = table.length - 2;
  for (let n = 0; n < outLength; n++) {
    const pos = n * pitch;
    const first = Math.max(0, Math.ceil(pos - reach));
    const end = Math.min(length - 1, Math.floor(pos + reach));
    for (let c = 0; c < channels.length; c++) {
      const src = channels[c];
      let sum = 0;
      for (let s = first; s <= end; s++) {
        const f = Math.abs(s - pos) * TABLE_RES;
        const idx = Math.min(last, Math.floor(f));
        const frac = f - idx;
        sum += src[s] * (table[idx] * (1 - frac) + table[idx + 1] * frac);
      }
      out[c][n] = sum;
    }
    if ((n & 0x3fff) === 0) await maybeYield();
  }
  return out;
}

function buildBuffer(like: AudioBuffer, data: Float32Array[]): AudioBuffer {
  // Node's test AudioContext has no global AudioBuffer, so make the output with the source's own class.
  const Ctor = (typeof AudioBuffer !== "undefined" ? AudioBuffer : like.constructor) as new (o: AudioBufferOptions) => AudioBuffer;
  const buffer = new Ctor({ length: data[0].length, numberOfChannels: data.length, sampleRate: like.sampleRate });
  data.forEach((channel, c) => {
    for (let i = 0; i < channel.length; i++) {
      const v = channel[i];
      channel[i] = v > 1 ? 1 : v < -1 ? -1 : v;
    }
    buffer.copyToChannel(channel as Float32Array<ArrayBuffer>, c);
  });
  return buffer;
}

async function render(source: AudioBuffer, params: WarpParams): Promise<AudioBuffer> {
  const { pitch, durationScale } = warpPlan(params);
  const maybeYield = makeYielder();
  let channels: Float32Array[] = Array.from({ length: source.numberOfChannels }, (_, c) => source.getChannelData(c));
  // Stretch first (to a length that resampling then brings to the target), so the anti-aliasing filter sees the final bandwidth.
  const stretch = durationScale * pitch;
  if (Math.abs(stretch - 1) > 1e-4) channels = await wsola(channels, stretch, maybeYield);
  if (Math.abs(pitch - 1) > 1e-4) channels = await resample(channels, pitch, maybeYield);
  return buildBuffer(source, channels);
}

interface Entry {
  promise: Promise<AudioBuffer>;
  bytes: number;
}

const cache = new Map<string, Entry>();
const sourceIds = new WeakMap<AudioBuffer, number>();
let nextSourceId = 1;

function keyFor(source: AudioBuffer, p: WarpParams): string {
  let id = sourceIds.get(source);
  if (id === undefined) {
    id = nextSourceId++;
    sourceIds.set(source, id);
  }
  return [id, p.tempoRatio.toFixed(5), p.semitones, p.cents, p.keyLock ? 1 : 0].join("|");
}

function evict(): void {
  let total = 0;
  for (const e of cache.values()) total += e.bytes;
  for (const [key, entry] of cache) {
    if (cache.size <= MAX_CACHE_ENTRIES && total <= MAX_CACHE_BYTES) break;
    if (cache.size === 1) break;
    cache.delete(key);
    total -= entry.bytes;
  }
}

export function clearWarpCache(): void {
  cache.clear();
}

/**
 * The source stretched to the tempo ratio and shifted by the pitch, cached per source and settings.
 * Neutral settings return the source itself, so unwarped clips cost nothing.
 */
export async function getWarpedBuffer(source: AudioBuffer, params: WarpParams): Promise<AudioBuffer> {
  if (isNeutral(params)) return source;
  warpPlan(params);
  const key = keyFor(source, params);
  const hit = cache.get(key);
  if (hit) {
    // Re-insert so the entry counts as recently used.
    cache.delete(key);
    cache.set(key, hit);
    return hit.promise;
  }
  const estimate = Math.round((source.length * source.numberOfChannels * 4) / params.tempoRatio);
  const promise = render(source, params);
  const entry: Entry = { promise, bytes: estimate };
  cache.set(key, entry);
  promise.catch(() => cache.delete(key));
  evict();
  return promise;
}
