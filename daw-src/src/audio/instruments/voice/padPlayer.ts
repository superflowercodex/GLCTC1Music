import { attackTo, releaseFrom } from "./envelope";
import { SYNTH_NAMES, synthBuffer, type SynthKind } from "./synthKit";
import { cachedBuffer } from "./assets";
import { sliceRange } from "./slice";

export type PadMode = "loop" | "shot" | "gate";

export interface PadData {
  name: string;
  assetId?: string;
  synth?: SynthKind;
  mode: PadMode;
  /** Linear gain, 0 to 1.5. */
  volume: number;
  /** Semitones, -24 to 24. */
  pitch: number;
  /** Trim region as fractions of the sample. */
  start: number;
  end: number;
  /** Seconds of fade at the end of a hit or on release. */
  fadeOut: number;
  /** 0 is closed, 1 is fully open. */
  filter: number;
  reverb: number;
  reverse: boolean;
  slices: number[];
  /** Loop length in bars; 0 picks the nearest whole number of bars automatically. */
  bars: number;
}

export const PAD_COUNT = 16;

export function emptyPad(): PadData {
  return { name: "", mode: "shot", volume: 1, pitch: 0, start: 0, end: 1, fadeOut: 0.02, filter: 1, reverb: 0, reverse: false, slices: [], bars: 0 };
}

export function synthPad(kind: SynthKind, overrides: Partial<PadData> = {}): PadData {
  const looping = kind === "bass" || kind === "chords";
  return { ...emptyPad(), name: SYNTH_NAMES[kind], synth: kind, mode: looping ? "loop" : "shot", ...overrides };
}

export function hasSample(pad: PadData): boolean {
  return pad.assetId !== undefined || pad.synth !== undefined;
}

/** Cleans pad data read from a saved project so one bad field cannot break playback. */
export function sanitisePad(raw: Partial<PadData> | undefined): PadData {
  const base = emptyPad();
  if (!raw) return base;
  const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
  const start = num(raw.start, 0, 0.99, 0);
  return {
    name: typeof raw.name === "string" ? raw.name : "",
    assetId: typeof raw.assetId === "string" ? raw.assetId : undefined,
    synth: raw.synth && (SYNTH_NAMES as Record<string, string>)[raw.synth] ? raw.synth : undefined,
    mode: raw.mode === "loop" || raw.mode === "gate" ? raw.mode : "shot",
    volume: num(raw.volume, 0, 1.5, base.volume),
    pitch: num(raw.pitch, -24, 24, 0),
    start,
    end: Math.max(start + 0.01, num(raw.end, 0.01, 1, 1)),
    fadeOut: num(raw.fadeOut, 0, 4, base.fadeOut),
    filter: num(raw.filter, 0, 1, 1),
    reverb: num(raw.reverb, 0, 1, 0),
    reverse: raw.reverse === true,
    slices: Array.isArray(raw.slices) ? raw.slices.filter((s): s is number => typeof s === "number" && s > 0 && s < 1).sort((a, b) => a - b) : [],
    bars: Math.round(num(raw.bars, 0, 16, 0)),
  };
}

const reversedCache = new WeakMap<AudioBuffer, AudioBuffer>();

function reversed(ctx: BaseAudioContext, buffer: AudioBuffer): AudioBuffer {
  let out = reversedCache.get(buffer);
  if (!out) {
    out = ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const src = buffer.getChannelData(c);
      const dst = out.getChannelData(c);
      for (let i = 0; i < src.length; i++) dst[i] = src[src.length - 1 - i];
    }
    reversedCache.set(buffer, out);
  }
  return out;
}

/** Frequency of the pad's low-pass filter for the 0 to 1 control: exponential from 180 Hz to 20 kHz. */
export function filterHz(amount: number): number {
  return 180 * (20000 / 180) ** Math.min(1, Math.max(0, amount));
}

export interface TriggerOptions {
  time: number;
  velocity?: number;
  /** Plays only this slice (zero-based) of the pad's sample. */
  slice?: number;
  /** Stretches the region so it lasts exactly this many seconds; used to keep loops on the grid. */
  fitSeconds?: number;
}

interface PadVoice {
  index: number;
  source: AudioBufferSourceNode;
  env: GainNode;
  loop: boolean;
  fade: number;
  /** Gain the envelope has at a given time, so a stop can fade from the right level. */
  levelAt: (time: number) => number;
}

/** Plays pad samples. Scheduling policy (when to start, quantising, scenes) belongs to the instrument. */
export class PadPlayer {
  readonly pads: PadData[] = Array.from({ length: PAD_COUNT }, emptyPad);
  private readonly buffers: (AudioBuffer | undefined)[] = new Array<AudioBuffer | undefined>(PAD_COUNT).fill(undefined);
  private readonly voices = new Map<number, PadVoice>();

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly dry: AudioNode,
    private readonly send: AudioNode,
  ) {}

  /** Resolves a pad's audio from synth or cache; returns false while a stored sample is still loading. */
  refresh(index: number): boolean {
    const pad = this.pads[index];
    const buffer = pad.synth ? synthBuffer(this.ctx, pad.synth) : pad.assetId ? cachedBuffer(pad.assetId) : undefined;
    this.buffers[index] = buffer;
    return buffer !== undefined || !hasSample(pad);
  }

  setBuffer(index: number, buffer: AudioBuffer | undefined): void {
    this.buffers[index] = buffer;
  }

  bufferOf(index: number): AudioBuffer | undefined {
    return this.buffers[index];
  }

  isPlaying(index: number): boolean {
    return this.voices.has(index);
  }

  playingPads(): number[] {
    return [...this.voices.keys()];
  }

  /** Seconds the pad's region lasts at natural speed and pitch. */
  regionSeconds(index: number): number {
    const buffer = this.buffers[index];
    if (!buffer) return 0;
    const pad = this.pads[index];
    return buffer.duration * (pad.end - pad.start);
  }

  trigger(index: number, options: TriggerOptions): boolean {
    const pad = this.pads[index];
    const raw = this.buffers[index];
    if (!raw) return false;
    this.stop(index, options.time, 0.008);

    const buffer = pad.reverse ? reversed(this.ctx, raw) : raw;
    const [from, to] =
      options.slice !== undefined && pad.slices.length > 0
        ? (() => {
            const [a, b] = sliceRange(pad.slices, options.slice);
            return [pad.start + a * (pad.end - pad.start), pad.start + b * (pad.end - pad.start)] as const;
          })()
        : ([pad.start, pad.end] as const);
    const offset = from * buffer.duration;
    const regionSeconds = Math.max(0.005, (to - from) * buffer.duration);
    const pitchRate = 2 ** (pad.pitch / 12);
    const rate = options.fitSeconds ? Math.min(2, Math.max(0.5, regionSeconds / options.fitSeconds)) * pitchRate : pitchRate;
    const loop = pad.mode === "loop";

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    if (loop) {
      source.loop = true;
      source.loopStart = offset;
      source.loopEnd = offset + regionSeconds;
    }
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = filterHz(pad.filter);
    filter.Q.value = 0.7;
    const env = this.ctx.createGain();
    const peak = pad.volume * (options.velocity ?? 1);
    attackTo(env.gain, peak, options.time, 0.002);
    source.connect(filter).connect(env);
    env.connect(this.dry);
    if (pad.reverb > 0) {
      const sendGain = this.ctx.createGain();
      sendGain.gain.value = pad.reverb;
      env.connect(sendGain).connect(this.send);
      source.addEventListener("ended", () => sendGain.disconnect());
    }

    const playSeconds = regionSeconds / rate;
    const fade = Math.min(pad.fadeOut, playSeconds * 0.9);
    if (!loop) {
      if (fade > 0.002) {
        env.gain.setValueAtTime(peak, options.time + playSeconds - fade);
        env.gain.linearRampToValueAtTime(0, options.time + playSeconds);
        env.gain.setValueAtTime(0, options.time + playSeconds);
      }
      source.start(options.time, offset, regionSeconds);
    } else {
      source.start(options.time, offset);
    }

    const fadeStart = options.time + playSeconds - fade;
    const levelAt = (t: number): number => {
      if (t < options.time + 0.002) return (peak * Math.max(0, t - options.time)) / 0.002;
      if (!loop && fade > 0.002 && t > fadeStart) return peak * Math.max(0, 1 - (t - fadeStart) / fade);
      return peak;
    };
    const voice: PadVoice = { index, source, env, loop, fade: pad.fadeOut, levelAt };
    this.voices.set(index, voice);
    source.addEventListener("ended", () => {
      source.disconnect();
      filter.disconnect();
      env.disconnect();
      if (this.voices.get(index) === voice) this.voices.delete(index);
    });
    return true;
  }

  /** Fades a pad out and stops it. */
  stop(index: number, time: number, fade?: number): void {
    const voice = this.voices.get(index);
    if (!voice) return;
    this.voices.delete(index);
    const seconds = Math.max(0.005, fade ?? voice.fade);
    voice.source.stop(releaseFrom(voice.env.gain, voice.levelAt(time), time, seconds));
  }

  stopAll(time: number): void {
    for (const index of [...this.voices.keys()]) this.stop(index, time, 0.01);
  }
}
