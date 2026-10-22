import { attackLevel, attackTo, releaseFrom } from "./envelope";
import { noteName } from "./scales";

export interface KeyZone {
  /** Stored sample; the buffer is resolved from the asset cache. */
  assetId: string;
  name: string;
  /** MIDI note at which the sample plays at its recorded pitch. */
  root: number;
}

export interface ZoneRange {
  lo: number;
  hi: number;
}

/**
 * Key ranges for samples, from their root notes alone: each sample covers the keys nearer to its
 * root than to a neighbour's, the lowest reaches note 0 and the highest reaches 127. Ranges never
 * overlap and never leave a gap, so any key finds exactly one sample.
 */
export function zoneRanges(roots: readonly number[]): ZoneRange[] {
  const order = roots.map((root, i) => ({ root, i })).sort((a, b) => a.root - b.root || a.i - b.i);
  const ranges: ZoneRange[] = new Array<ZoneRange>(roots.length);
  order.forEach((entry, pos) => {
    const prev = order[pos - 1];
    const next = order[pos + 1];
    const lo = prev ? Math.floor((prev.root + entry.root) / 2) + 1 : 0;
    const hi = next ? Math.floor((entry.root + next.root) / 2) : 127;
    // Equal roots collapse to an empty range for the later duplicate.
    ranges[entry.i] = lo <= hi ? { lo, hi } : { lo: hi + 1, hi };
  });
  return ranges;
}

/** Index of the zone whose range contains `note`, or -1 when there are no zones. */
export function zoneFor(roots: readonly number[], note: number): number {
  const ranges = zoneRanges(roots);
  for (let i = 0; i < ranges.length; i++) if (note >= ranges[i].lo && note <= ranges[i].hi && ranges[i].lo <= ranges[i].hi) return i;
  return -1;
}

export function describeRange(range: ZoneRange): string {
  if (range.hi >= 127) return `${noteName(range.lo)} and up`;
  return `${noteName(range.lo)} – ${noteName(range.hi)}`;
}

export interface SamplerSettings {
  attack: number;
  release: number;
  loop: boolean;
}

interface SamplerVoice {
  note: number;
  source: AudioBufferSourceNode;
  env: GainNode;
  peak: number;
  start: number;
  attack: number;
}

/** Plays a note from whichever of the given buffers covers it, re-pitched from the sample's root. */
export class KeySampler {
  private readonly voices: SamplerVoice[] = [];
  private static readonly MAX = 24;

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly destination: AudioNode,
  ) {}

  noteOn(buffer: AudioBuffer, root: number, note: number, velocity: number, time: number, settings: SamplerSettings, gainScale = 1): void {
    while (this.voices.length >= KeySampler.MAX) this.kill(this.voices[0], time);
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = 2 ** ((note - root) / 12);
    source.loop = settings.loop;
    const env = this.ctx.createGain();
    attackTo(env.gain, velocity * gainScale, time, settings.attack);
    source.connect(env).connect(this.destination);
    source.start(time);
    const voice: SamplerVoice = { note, source, env, peak: velocity * gainScale, start: time, attack: settings.attack };
    this.voices.push(voice);
    source.addEventListener("ended", () => {
      source.disconnect();
      env.disconnect();
      const i = this.voices.indexOf(voice);
      if (i >= 0) this.voices.splice(i, 1);
    });
  }

  noteOff(note: number, time: number, release: number): void {
    for (const voice of this.voices.filter((v) => v.note === note)) this.fade(voice, time, release);
  }

  allNotesOff(time: number, release = 0.05): void {
    for (const voice of [...this.voices]) this.fade(voice, time, release);
  }

  private fade(voice: SamplerVoice, time: number, release: number): void {
    voice.source.stop(releaseFrom(voice.env.gain, attackLevel(voice.peak, voice.start, voice.attack, time), time, Math.max(0.02, release)));
  }

  private kill(voice: SamplerVoice, time: number): void {
    this.fade(voice, time, 0.03);
    const i = this.voices.indexOf(voice);
    if (i >= 0) this.voices.splice(i, 1);
  }
}
