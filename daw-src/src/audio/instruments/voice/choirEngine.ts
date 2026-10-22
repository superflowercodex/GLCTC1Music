import { attackLevel, attackTo, releaseFrom } from "./envelope";
import { formantsFor, VOICE_OCTAVE, VOICE_TYPES, vowelMorph } from "./choir";
import { onsetKind, parseLyrics, type Syllable } from "./lyrics";
import { midiToFreq } from "./scales";

export interface ChoirSettings {
  /** Which of Soprano, Alto, Tenor, Bass sing. */
  layers: readonly boolean[];
  morph: number;
  useLyrics: boolean;
  vibrato: number;
  vibratoRate: number;
  breath: number;
  /** Detune between the voices of a note, in cents. */
  spread: number;
  voices: number;
  attack: number;
  release: number;
  level: number;
}

export const DEFAULT_CHOIR: ChoirSettings = {
  layers: [true, true, false, true],
  morph: 0,
  useLyrics: true,
  vibrato: 0.35,
  vibratoRate: 5.2,
  breath: 0.12,
  spread: 12,
  voices: 2,
  attack: 0.12,
  release: 0.9,
  level: 0.8,
};

interface ActiveNote {
  note: number;
  env: GainNode;
  sources: AudioScheduledSourceNode[];
  started: number;
  peak: number;
  attack: number;
}

const MAX_NOTES = 12;

/** Typed lyrics sung by formant filters: each played note advances one syllable. */
export class Choir {
  readonly output: GainNode;
  settings: ChoirSettings = { ...DEFAULT_CHOIR };
  private syllables: Syllable[] = parseLyrics("la lo ah ooh la na ay oh");
  private cursor = 0;
  private readonly active: ActiveNote[] = [];
  private noise: AudioBuffer | undefined;

  constructor(private readonly ctx: BaseAudioContext) {
    this.output = ctx.createGain();
  }

  setLyrics(text: string): void {
    this.syllables = parseLyrics(text);
    this.cursor = 0;
  }

  /** The syllable the next note will sing, for display. */
  upcoming(): Syllable | undefined {
    return this.syllables.length > 0 ? this.syllables[this.cursor % this.syllables.length] : undefined;
  }

  noteOn(note: number, velocity: number, time = this.ctx.currentTime): void {
    const s = this.settings;
    const layers = VOICE_TYPES.filter((_, i) => s.layers[i]);
    if (layers.length === 0) return;
    while (this.active.length >= MAX_NOTES) this.kill(this.active[0], time);

    const syllable = s.useLyrics && this.syllables.length > 0 ? this.syllables[this.cursor++ % this.syllables.length] : undefined;
    const morph = syllable ? vowelMorph(syllable.vowel) : s.morph;
    const env = this.ctx.createGain();
    const peak = (velocity * s.level * 0.5) / Math.sqrt(layers.length);
    attackTo(env.gain, peak, time, Math.max(0.005, s.attack));
    env.connect(this.output);

    const sources: AudioScheduledSourceNode[] = [];
    const vibrato = this.ctx.createOscillator();
    vibrato.frequency.value = s.vibratoRate;
    const vibratoDepth = this.ctx.createGain();
    // Vibrato fades in after the attack like a real singer settling on the note.
    attackTo(vibratoDepth.gain, s.vibrato * 35, time, 0.25 + s.attack);
    vibrato.connect(vibratoDepth);
    sources.push(vibrato);

    const glide = syllable ? onsetKind(syllable.onset) === "glide" : false;
    for (const type of layers) {
      const bank = this.ctx.createGain();
      const freq = midiToFreq(note + VOICE_OCTAVE[type] + (type === "Soprano" ? -12 : 0));
      const count = Math.max(1, Math.round(s.voices));
      for (let v = 0; v < count; v++) {
        const osc = this.ctx.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.value = freq;
        osc.detune.value = count === 1 ? 0 : (v / (count - 1) - 0.5) * 2 * s.spread;
        vibratoDepth.connect(osc.detune);
        osc.connect(bank);
        sources.push(osc);
      }
      bank.gain.value = 1 / count;
      const startMorph = glide ? 1 : morph;
      const target = formantsFor(type, morph);
      const begin = formantsFor(type, startMorph);
      target.forEach((f, i) => {
        const filter = this.ctx.createBiquadFilter();
        filter.type = "bandpass";
        filter.Q.value = f.q;
        filter.frequency.setValueAtTime(begin[i].freq, time);
        if (glide) filter.frequency.linearRampToValueAtTime(f.freq, time + 0.09);
        else filter.frequency.value = f.freq;
        const g = this.ctx.createGain();
        g.gain.value = f.gain * 2.5;
        bank.connect(filter).connect(g).connect(env);
      });
    }

    if (s.breath > 0) sources.push(this.breathSource(env, s.breath));
    if (syllable && onsetKind(syllable.onset) === "noise") sources.push(this.burst(time, velocity));

    for (const src of sources) src.start(time);
    this.active.push({ note, env, sources, started: time, peak, attack: Math.max(0.005, s.attack) });
  }

  noteOff(note: number, time = this.ctx.currentTime): void {
    for (const voice of this.active.filter((a) => a.note === note)) this.release(voice, time);
  }

  allNotesOff(): void {
    for (const voice of [...this.active]) this.release(voice, this.ctx.currentTime);
  }

  dispose(): void {
    for (const voice of [...this.active]) this.kill(voice, this.ctx.currentTime);
    this.output.disconnect();
  }

  private release(voice: ActiveNote, time: number): void {
    this.finish(voice, releaseFrom(voice.env.gain, attackLevel(voice.peak, voice.started, voice.attack, time), time, Math.max(0.05, this.settings.release)));
  }

  private kill(voice: ActiveNote, time: number): void {
    this.finish(voice, releaseFrom(voice.env.gain, attackLevel(voice.peak, voice.started, voice.attack, time), time, 0.03));
  }

  private finish(voice: ActiveNote, stopAt: number): void {
    const index = this.active.indexOf(voice);
    if (index < 0) return;
    this.active.splice(index, 1);
    for (const src of voice.sources) src.stop(Math.max(stopAt, voice.started + 0.01));
    voice.sources[0].onended = () => {
      voice.env.disconnect();
      for (const src of voice.sources) src.disconnect();
    };
  }

  private noiseBuffer(): AudioBuffer {
    if (!this.noise) {
      const length = Math.round(this.ctx.sampleRate * 1.5);
      this.noise = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    }
    return this.noise;
  }

  private breathSource(destination: AudioNode, amount: number): AudioScheduledSourceNode {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer();
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 2400;
    filter.Q.value = 0.7;
    const gain = this.ctx.createGain();
    gain.gain.value = amount * 0.35;
    src.connect(filter).connect(gain).connect(destination);
    return src;
  }

  private burst(time: number, velocity: number): AudioScheduledSourceNode {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer();
    const filter = this.ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 5200;
    filter.Q.value = 1.2;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.5 * velocity, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.07);
    src.connect(filter).connect(gain).connect(this.output);
    return src;
  }
}
