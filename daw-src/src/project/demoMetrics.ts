import { detectPitch } from "../audio/instruments/voice/yin";

/**
 * Listening proxies for the demo song's tests: spectral balance, pitch, true peak and envelope checks.
 * They run on plain sample arrays so the same numbers come out in Node and in the browser.
 */

export function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

export function centsBetween(hz: number, refHz: number): number {
  return 1200 * Math.log2(hz / refHz);
}

export function dbOf(x: number): number {
  return 20 * Math.log10(Math.max(x, 1e-12));
}

export function monoOf(channels: readonly Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0];
  const out = new Float32Array(channels[0].length);
  for (const ch of channels) for (let i = 0; i < out.length; i++) out[i] += ch[i] / channels.length;
  return out;
}

function fftInPlace(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr0 = Math.cos(ang);
    const wi0 = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let wr = 1;
      let wi = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * wr - im[b] * wi;
        const ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const nwr = wr * wr0 - wi * wi0;
        wi = wr * wi0 + wi * wr0;
        wr = nwr;
      }
    }
  }
}

/** Power spectrum of one Hann-windowed frame; `size` must be a power of two. */
export function powerSpectrum(samples: Float32Array, start: number, size: number): Float64Array {
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  for (let i = 0; i < size; i++) re[i] = (samples[start + i] ?? 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size));
  fftInPlace(re, im);
  const out = new Float64Array(size / 2);
  for (let k = 0; k < size / 2; k++) out[k] = re[k] * re[k] + im[k] * im[k];
  return out;
}

/** Average power spectrum over a stretch (Welch, half-overlapping frames). */
export function averageSpectrum(samples: Float32Array, from: number, to: number, size = 4096): Float64Array {
  const sum = new Float64Array(size / 2);
  let frames = 0;
  for (let start = Math.max(0, from); start + size <= Math.min(samples.length, to); start += size / 2) {
    const p = powerSpectrum(samples, start, size);
    for (let k = 0; k < p.length; k++) sum[k] += p[k];
    frames += 1;
  }
  if (frames > 0) for (let k = 0; k < sum.length; k++) sum[k] /= frames;
  return sum;
}

/** Power between two frequencies, from an averaged spectrum. */
export function bandPower(spectrum: Float64Array, sampleRate: number, loHz: number, hiHz: number): number {
  const binHz = sampleRate / (spectrum.length * 2);
  let sum = 0;
  for (let k = Math.max(1, Math.ceil(loHz / binHz)); k < spectrum.length && k * binHz < hiHz; k++) sum += spectrum[k];
  return sum;
}

export interface Balance {
  /** Share of power (0 to 1) per band. */
  sub: number; // under 60 Hz
  low: number; // 60 to 120 Hz
  lowMid: number; // 120 to 200 Hz
  mud: number; // 200 to 400 Hz
  mid: number; // 400 Hz to 2 kHz
  presence: number; // 2 to 6 kHz, where harshness lives
  air: number; // above 6 kHz
  /** Spectral centroid in Hz. */
  centroid: number;
  /** Octave-band slope in dB per octave between 500 Hz and 8 kHz; a warm mix falls, a shrill one is flat or rising. */
  slope: number;
  /** Octave band levels in dB, centred on 63 Hz to 8 kHz. */
  octaves: number[];
}

export const OCTAVE_CENTRES = [63, 125, 250, 500, 1000, 2000, 4000, 8000] as const;

export function balanceOf(samples: Float32Array, sampleRate: number, from = 0, to = samples.length): Balance {
  const spec = averageSpectrum(samples, from, to);
  const nyq = sampleRate / 2;
  const total = bandPower(spec, sampleRate, 20, nyq) || 1e-30;
  const share = (lo: number, hi: number): number => bandPower(spec, sampleRate, lo, hi) / total;
  const binHz = sampleRate / (spec.length * 2);
  let weighted = 0;
  for (let k = 1; k < spec.length; k++) weighted += k * binHz * spec[k];
  const octaves = OCTAVE_CENTRES.map((c) => 10 * Math.log10(bandPower(spec, sampleRate, c / Math.SQRT2, c * Math.SQRT2) + 1e-30));
  // Least-squares slope over the 500 Hz to 8 kHz octaves.
  const xs = [3, 4, 5, 6, 7];
  const ys = xs.map((i) => octaves[i]);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0;
  let den = 0;
  xs.forEach((x, i) => {
    num += (x - mx) * (ys[i] - my);
    den += (x - mx) ** 2;
  });
  return {
    sub: share(20, 60),
    low: share(60, 120),
    lowMid: share(120, 200),
    mud: share(200, 400),
    mid: share(400, 2000),
    presence: share(2000, 6000),
    air: share(6000, nyq),
    centroid: weighted / total,
    slope: num / den,
    octaves,
  };
}

export interface LevelStats {
  peakDb: number;
  truePeakDb: number;
  rmsDb: number;
  crestDb: number;
  /** Samples at or beyond 0.999 of full scale. */
  clipped: number;
}

/** Inter-sample peak by 4x windowed-sinc interpolation, which is what a DAC or a lossy encoder will see. */
export function truePeak(samples: Float32Array): number {
  const taps = 8;
  const phases = [0.25, 0.5, 0.75];
  const kernels = phases.map((ph) => {
    const k = new Float64Array(taps * 2);
    for (let j = -taps + 1; j <= taps; j++) {
      const x = j - ph;
      const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
      const w = 0.5 + 0.5 * Math.cos((Math.PI * x) / (taps + 1));
      k[j + taps - 1] = sinc * w;
    }
    return k;
  });
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]);
    if (a > peak) peak = a;
    // Only loud neighbourhoods can hide a higher peak between samples.
    if (a < peak * 0.7) continue;
    for (const k of kernels) {
      let y = 0;
      for (let j = -taps + 1; j <= taps; j++) y += (samples[i + j] ?? 0) * k[j + taps - 1];
      if (Math.abs(y) > peak) peak = Math.abs(y);
    }
  }
  return peak;
}

export function levelStats(channels: readonly Float32Array[], from = 0, to = channels[0].length): LevelStats {
  let peak = 0;
  let sum = 0;
  let count = 0;
  let clipped = 0;
  let tp = 0;
  for (const ch of channels) {
    const part = ch.subarray(from, to);
    for (const v of part) {
      const a = Math.abs(v);
      if (a > peak) peak = a;
      if (a >= 0.999) clipped += 1;
      sum += v * v;
      count += 1;
    }
    tp = Math.max(tp, truePeak(part));
  }
  const rms = Math.sqrt(sum / Math.max(1, count));
  return { peakDb: dbOf(peak), truePeakDb: dbOf(tp), rmsDb: dbOf(rms), crestDb: dbOf(peak) - dbOf(rms), clipped };
}

export function rmsDbOf(samples: Float32Array, from: number, to: number): number {
  let sum = 0;
  const a = Math.max(0, Math.floor(from));
  const b = Math.min(samples.length, Math.floor(to));
  for (let i = a; i < b; i++) sum += samples[i] * samples[i];
  return dbOf(Math.sqrt(sum / Math.max(1, b - a)));
}

/** One-pole low-pass, run forwards; enough to separate a kick or a bass from everything above it. */
export function lowPassed(samples: Float32Array, sampleRate: number, hz: number): Float32Array {
  const alpha = 1 - Math.exp((-2 * Math.PI * hz) / sampleRate);
  const out = new Float32Array(samples.length);
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < samples.length; i++) {
    // Two poles: 12 dB per octave keeps the 2nd harmonic of a bass out of a "sub only" reading.
    y1 += alpha * (samples[i] - y1);
    y2 += alpha * (y1 - y2);
    out[i] = y2;
  }
  return out;
}

export interface PitchReading {
  /** Detected frequency, or null when nothing periodic was found. */
  hz: number | null;
  /** Distance from the intended note in cents, folded into one octave (-600 to 600). */
  pitchClassCents: number | null;
  /** Whole octaves between what sounds and what was intended (a sub oscillator reads as -1). */
  octave: number | null;
  clarity: number;
}

/**
 * Fundamental of a monophonic stretch compared with the note that was meant to sound there.
 * YIN finds the period; the reading is folded to a pitch class because a sub oscillator legitimately
 * makes the true period an octave longer.
 */
export function readPitch(samples: Float32Array, sampleRate: number, start: number, length: number, expectedMidi: number): PitchReading {
  const expected = midiToHz(expectedMidi);
  const frame = samples.subarray(Math.max(0, Math.floor(start)), Math.min(samples.length, Math.floor(start + length)));
  const est = detectPitch(frame, sampleRate, Math.max(25, expected / 2.6), Math.min(4000, expected * 2.6), 0.3);
  if (!est) return { hz: null, pitchClassCents: null, octave: null, clarity: 0 };
  const cents = centsBetween(est.freq, expected);
  const octave = Math.round(cents / 1200);
  return { hz: est.freq, pitchClassCents: cents - octave * 1200, octave, clarity: est.clarity };
}

export interface SpectralPeak {
  hz: number;
  db: number;
  midi: number;
  /** Distance from the nearest equal-tempered note in cents. */
  cents: number;
}

/** Local maxima of a long-window spectrum between two frequencies, with parabolic interpolation. */
export function spectralPeaks(samples: Float32Array, sampleRate: number, start: number, size: number, loHz: number, hiHz: number, withinDb = 18): SpectralPeak[] {
  const p = powerSpectrum(samples, Math.max(0, Math.floor(start)), size);
  const binHz = sampleRate / size;
  const db = Array.from(p, (v) => 10 * Math.log10(v + 1e-30));
  const lo = Math.max(2, Math.floor(loHz / binHz));
  const hi = Math.min(p.length - 2, Math.ceil(hiHz / binHz));
  let max = -Infinity;
  for (let k = lo; k <= hi; k++) max = Math.max(max, db[k]);
  const peaks: SpectralPeak[] = [];
  for (let k = lo; k <= hi; k++) {
    if (db[k] < max - withinDb || db[k] < db[k - 1] || db[k] < db[k + 1]) continue;
    // A peak must stand out from its surroundings, not ride the skirt of a neighbour.
    if (db[k] - Math.min(db[k - 3] ?? db[k], db[k + 3] ?? db[k]) < 4) continue;
    const a = db[k - 1];
    const b = db[k];
    const c = db[k + 1];
    const shift = a - 2 * b + c === 0 ? 0 : (0.5 * (a - c)) / (a - 2 * b + c);
    const hz = (k + shift) * binHz;
    const midiFloat = 69 + 12 * Math.log2(hz / 440);
    const midi = Math.round(midiFloat);
    peaks.push({ hz, db: b, midi, cents: (midiFloat - midi) * 100 });
  }
  return peaks;
}

interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

function runBiquad(input: Float32Array, f: Biquad): Float32Array {
  const out = new Float32Array(input.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const x = input[i];
    const y = f.b0 * x + f.b1 * x1 + f.b2 * x2 - f.a1 * y1 - f.a2 * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    out[i] = y;
  }
  return out;
}

/** The two K-weighting stages of ITU-R BS.1770 (a +4 dB shelf above ~1.5 kHz and a 38 Hz high-pass), at any rate. */
function kWeight(samples: Float32Array, sampleRate: number): Float32Array {
  const shelfK = Math.tan((Math.PI * 1681.974450955533) / sampleRate);
  const vh = 10 ** (3.999843853973347 / 20);
  const vb = vh ** 0.4996667741545416;
  const q1 = 0.7071752369554196;
  const d1 = 1 + shelfK / q1 + shelfK * shelfK;
  const shelf: Biquad = {
    b0: (vh + (vb * shelfK) / q1 + shelfK * shelfK) / d1,
    b1: (2 * (shelfK * shelfK - vh)) / d1,
    b2: (vh - (vb * shelfK) / q1 + shelfK * shelfK) / d1,
    a1: (2 * (shelfK * shelfK - 1)) / d1,
    a2: (1 - shelfK / q1 + shelfK * shelfK) / d1,
  };
  const hpK = Math.tan((Math.PI * 38.13547087602444) / sampleRate);
  const q2 = 0.5003270373238773;
  const d2 = 1 + hpK / q2 + hpK * hpK;
  const highpass: Biquad = { b0: 1 / d2, b1: -2 / d2, b2: 1 / d2, a1: (2 * (hpK * hpK - 1)) / d2, a2: (1 - hpK / q2 + hpK * hpK) / d2 };
  return runBiquad(runBiquad(samples, shelf), highpass);
}

/**
 * Integrated loudness in LUFS (BS.1770 K-weighting with the absolute and relative gates), summed over channels.
 * It tracks how loud a part sounds far better than RMS, which low notes inflate.
 */
export function loudness(channels: readonly Float32Array[], sampleRate: number, from = 0, to = channels[0].length): number {
  const weighted = channels.map((c) => kWeight(c.subarray(from, to), sampleRate));
  const block = Math.floor(0.4 * sampleRate);
  const hop = Math.floor(0.1 * sampleRate);
  const blocks: number[] = [];
  for (let s = 0; s + block <= weighted[0].length; s += hop) {
    let z = 0;
    for (const w of weighted) {
      let sum = 0;
      for (let i = s; i < s + block; i++) sum += w[i] * w[i];
      z += sum / block;
    }
    blocks.push(z);
  }
  const lufs = (z: number): number => -0.691 + 10 * Math.log10(Math.max(z, 1e-20));
  const gated = blocks.filter((z) => lufs(z) > -70);
  if (gated.length === 0) return -70;
  const mean = gated.reduce((a, b) => a + b, 0) / gated.length;
  const relative = gated.filter((z) => lufs(z) > lufs(mean) - 10);
  return lufs(relative.reduce((a, b) => a + b, 0) / Math.max(1, relative.length));
}

/** The loudest 100 ms in LUFS-like units: how loud a single hit sounds, where integrated loudness averages it away. */
export function hitLoudness(channels: readonly Float32Array[], sampleRate: number, from = 0, to = channels[0].length): number {
  const weighted = channels.map((c) => kWeight(c.subarray(from, to), sampleRate));
  const win = Math.floor(0.1 * sampleRate);
  const hop = Math.floor(0.01 * sampleRate);
  let best = 0;
  for (let s = 0; s + win <= weighted[0].length; s += hop) {
    let z = 0;
    for (const w of weighted) {
      let sum = 0;
      for (let i = s; i < s + win; i++) sum += w[i] * w[i];
      z += sum / win;
    }
    best = Math.max(best, z);
  }
  return -0.691 + 10 * Math.log10(Math.max(best, 1e-20));
}

/** RMS envelope in dB with one value per window. */
export function envelopeDb(samples: Float32Array, sampleRate: number, windowSec: number): number[] {
  const w = Math.max(1, Math.floor(windowSec * sampleRate));
  const out: number[] = [];
  for (let s = 0; s + w <= samples.length; s += w) out.push(rmsDbOf(samples, s, s + w));
  return out;
}
