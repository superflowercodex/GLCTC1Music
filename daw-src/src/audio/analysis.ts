export interface Detected {
  bpm?: number;
  /** For example "A♭ minor". */
  key?: string;
}

const ANALYSIS_RATE = 11025;
const MAX_ANALYSIS_SEC = 240;
const MIN_BPM = 60;
const MAX_BPM = 200;
const ENV_HOP = 128;
const ENV_FRAME = 512;
const KEY_FFT = 8192;
const KEY_FRAMES = 40;
const MIN_KEY_CORRELATION = 0.6;
/** Normalised autocorrelation below this means the envelope has no steady pulse. */
const MIN_TEMPO_CONFIDENCE = 0.18;

const NOTE_NAMES_MAJOR = ["C", "D♭", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"] as const;
const NOTE_NAMES_MINOR = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "G♯", "A", "B♭", "B"] as const;

// Krumhansl-Schmuckler probe-tone profiles, tonic first.
const KS_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KS_MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Gives the UI a turn roughly every 12 ms of work, so a 5-minute file does not freeze the page. */
function makeYielder(): () => Promise<void> {
  let last = performance.now();
  return async () => {
    if (performance.now() - last < 12) return;
    await yieldToEventLoop();
    last = performance.now();
  };
}

/** Mono, decimated copy; averaging each block is a crude low-pass that is enough for tempo and key. */
async function downmix(buffer: AudioBuffer, maxSec: number, maybeYield: () => Promise<void>): Promise<Float32Array> {
  const factor = Math.max(1, Math.round(buffer.sampleRate / ANALYSIS_RATE));
  const available = Math.min(buffer.length, Math.floor(maxSec * buffer.sampleRate));
  const out = new Float32Array(Math.floor(available / factor));
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  const scale = 1 / (factor * channels.length);
  for (let i = 0; i < out.length; i++) {
    let sum = 0;
    const base = i * factor;
    for (const data of channels) for (let k = 0; k < factor; k++) sum += data[base + k];
    out[i] = sum * scale;
    if ((i & 0x3fff) === 0) await maybeYield();
  }
  return out;
}

/** In-place radix-2 FFT; `re` and `im` must have a power-of-two length. */
export function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci;
        const xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

/** Positive change in log energy per hop: percussive attacks stand out, sustained tones do not. */
async function onsetEnvelope(mono: Float32Array, maybeYield: () => Promise<void>): Promise<Float32Array> {
  const frames = Math.floor((mono.length - ENV_FRAME) / ENV_HOP);
  if (frames < 8) return new Float32Array(0);
  const env = new Float32Array(frames);
  let prev = 0;
  for (let f = 0; f < frames; f++) {
    const start = f * ENV_HOP;
    let energy = 0;
    // First difference emphasises the high end, where clicks and hats carry their attack.
    for (let i = start + 1; i < start + ENV_FRAME; i++) {
      const d = mono[i] - mono[i - 1];
      energy += d * d;
    }
    const level = Math.log(1 + 1e4 * (energy / ENV_FRAME));
    env[f] = Math.max(0, level - prev);
    prev = level;
    if ((f & 0x7ff) === 0) await maybeYield();
  }
  return env;
}

function lerpAt(a: Float32Array, x: number): number {
  const i = Math.floor(x);
  const frac = x - i;
  return a[i] * (1 - frac) + a[i + 1] * frac;
}

/** Log-Gaussian preference around 120 BPM settles the double/half-time ambiguity. */
function tempoPrior(bpm: number): number {
  const octaves = Math.log2(bpm / 120);
  return Math.exp(-(octaves * octaves) / (2 * 1.2 * 1.2));
}

async function estimateBpm(env: Float32Array, hopSec: number, maybeYield: () => Promise<void>): Promise<number | undefined> {
  if (env.length === 0) return undefined;
  let mean = 0;
  for (const v of env) mean += v;
  mean /= env.length;
  const x = new Float32Array(env.length);
  let energy = 0;
  for (let i = 0; i < env.length; i++) {
    x[i] = env[i] - mean;
    energy += x[i] * x[i];
  }
  if (energy < 1e-9) return undefined;

  const step = 0.25;
  const count = Math.round((MAX_BPM - MIN_BPM) / step) + 1;
  const scores = new Float32Array(count);
  const raw = new Float32Array(count);
  for (let c = 0; c < count; c++) {
    const lag = 60 / (MIN_BPM + c * step) / hopSec;
    const usable = x.length - Math.ceil(lag) - 1;
    if (usable < x.length / 4) continue;
    let sum = 0;
    for (let i = 0; i < usable; i++) sum += x[i] * lerpAt(x, i + lag);
    // Dividing by overlap keeps long lags from losing to short ones simply because they see less data.
    raw[c] = sum / usable / (energy / x.length);
    scores[c] = raw[c] * tempoPrior(MIN_BPM + c * step);
    if ((c & 0xf) === 0) await maybeYield();
  }

  let best = 0;
  for (let c = 1; c < count; c++) if (scores[c] > scores[best]) best = c;
  if (raw[best] < MIN_TEMPO_CONFIDENCE) return undefined;

  // The peak must stand clear of the surrounding floor, otherwise it is just the broad hump of a noisy envelope.
  const sorted = Array.from(raw).sort((p, q) => p - q);
  const median = sorted[Math.floor(sorted.length / 2)];
  if (raw[best] < median + 0.12) return undefined;

  let refined = MIN_BPM + best * step;
  if (best > 0 && best < count - 1) {
    const l = raw[best - 1];
    const r = raw[best + 1];
    const m = raw[best];
    const denom = l - 2 * m + r;
    if (denom < 0) refined += (0.5 * (l - r)) / denom * step;
  }
  return refined;
}

/** Short loops are almost always a whole number of beats long, so a close fit is a better answer than the raw estimate. */
function snapToWholeBeats(bpm: number, durationSec: number): number {
  if (durationSec > 40) return bpm;
  const beats = (durationSec * bpm) / 60;
  const nearest = Math.round(beats / 2) * 2;
  if (nearest >= 2 && nearest <= 64 && Math.abs(beats - nearest) / nearest < 0.03) return (nearest * 60) / durationSec;
  return bpm;
}

function pitchClassName(index: number, minor: boolean): string {
  return `${(minor ? NOTE_NAMES_MINOR : NOTE_NAMES_MAJOR)[index]} ${minor ? "minor" : "major"}`;
}

function correlation(a: readonly number[], b: readonly number[]): number {
  const n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da === 0 || db === 0 ? 0 : num / Math.sqrt(da * db);
}

async function estimateKey(mono: Float32Array, maybeYield: () => Promise<void>): Promise<string | undefined> {
  if (mono.length < KEY_FFT) return undefined;
  const window = new Float32Array(KEY_FFT);
  for (let i = 0; i < KEY_FFT; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (KEY_FFT - 1));
  const chroma = new Array<number>(12).fill(0);
  const re = new Float32Array(KEY_FFT);
  const im = new Float32Array(KEY_FFT);
  const hz = ANALYSIS_RATE / KEY_FFT;
  const lo = Math.ceil(70 / hz);
  const hi = Math.floor(1800 / hz);
  const binClass = new Int8Array(hi + 1).fill(-1);
  for (let k = lo; k <= hi; k++) binClass[k] = (((Math.round(12 * Math.log2((k * hz) / 440)) + 9) % 12) + 12) % 12;

  const frames = Math.min(KEY_FRAMES, Math.floor(mono.length / KEY_FFT));
  const span = mono.length - KEY_FFT;
  for (let f = 0; f < frames; f++) {
    const start = frames === 1 ? 0 : Math.floor((f * span) / (frames - 1));
    for (let i = 0; i < KEY_FFT; i++) {
      re[i] = mono[start + i] * window[i];
      im[i] = 0;
    }
    fft(re, im);
    const frame = new Array<number>(12).fill(0);
    let total = 0;
    for (let k = lo; k <= hi; k++) {
      const mag = Math.hypot(re[k], im[k]);
      frame[binClass[k]] += mag;
      total += mag;
    }
    // Normalising per frame stops one loud passage from deciding the whole key.
    if (total > 0) for (let p = 0; p < 12; p++) chroma[p] += frame[p] / total;
    await maybeYield();
  }

  let bestScore = -Infinity;
  let bestName: string | undefined;
  for (let tonic = 0; tonic < 12; tonic++) {
    const rotated = chroma.map((_, i) => chroma[(i + tonic) % 12]);
    for (const minor of [false, true]) {
      const score = correlation(rotated, minor ? KS_MINOR : KS_MAJOR);
      if (score > bestScore) {
        bestScore = score;
        bestName = pitchClassName(tonic, minor);
      }
    }
  }
  return bestScore >= MIN_KEY_CORRELATION ? bestName : undefined;
}

/**
 * Tempo (60 to 200 BPM, one decimal) and key of a recording. Either is left out when the audio gives no
 * confident answer, so callers can show "not sure" instead of a wrong number.
 */
export async function detectTempoAndKey(buffer: AudioBuffer): Promise<Detected> {
  const maybeYield = makeYielder();
  const mono = await downmix(buffer, MAX_ANALYSIS_SEC, maybeYield);
  const hopSec = ENV_HOP / (buffer.sampleRate / Math.max(1, Math.round(buffer.sampleRate / ANALYSIS_RATE)));
  const env = await onsetEnvelope(mono, maybeYield);
  const rawBpm = await estimateBpm(env, hopSec, maybeYield);
  const key = await estimateKey(mono, maybeYield);
  const result: Detected = {};
  if (rawBpm !== undefined) {
    const snapped = snapToWholeBeats(rawBpm, buffer.duration);
    result.bpm = Math.round(Math.min(MAX_BPM, Math.max(MIN_BPM, snapped)) * 10) / 10;
  }
  if (key) result.key = key;
  return result;
}
