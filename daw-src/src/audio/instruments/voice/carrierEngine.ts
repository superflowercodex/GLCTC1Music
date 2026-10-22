import { attackLevel, attackTo, releaseFrom } from "./envelope";
import { carrierLayers, type CarrierKind } from "./vocoder";
import { midiToFreq } from "./scales";

const DRONE_LEVEL = 0.35;

interface CarrierVoice {
  key: number;
  env: GainNode;
  sources: AudioScheduledSourceNode[];
  peak: number;
  start: number;
  attack: number;
}

/** Synth that feeds the vocoder's carrier input: held keys play it, and a quiet drone fills in when none are held. */
export class CarrierSynth {
  kind: CarrierKind = "Saw choir";
  private readonly voices: CarrierVoice[] = [];
  private drone: CarrierVoice | undefined;
  private noise: AudioBuffer | undefined;

  constructor(
    private readonly ctx: BaseAudioContext,
    readonly output: AudioNode,
  ) {}

  noteOn(note: number, velocity: number, time = this.ctx.currentTime): void {
    this.voices.push(this.build(note, velocity * 0.6, time, 0.01));
    this.fadeDrone(time);
  }

  noteOff(note: number, time = this.ctx.currentTime): void {
    for (const voice of this.voices.filter((v) => v.key === note)) {
      this.voices.splice(this.voices.indexOf(voice), 1);
      this.stopVoice(voice, time, 0.12);
    }
    if (this.voices.length === 0) this.rampDrone(DRONE_LEVEL, time);
  }

  /** Starts, retunes or stops the background drone. */
  setDrone(note: number | null): void {
    const now = this.ctx.currentTime;
    if (this.drone) {
      this.stopVoice(this.drone, now, 0.1);
      this.drone = undefined;
    }
    this.droneAt = DRONE_LEVEL;
    if (note !== null) this.drone = this.build(note, this.voices.length > 0 ? 0 : DRONE_LEVEL, now, 0.05);
  }

  rebuildFor(kind: CarrierKind, droneNote: number | null): void {
    this.kind = kind;
    const old = this.voices.splice(0);
    for (const v of old) this.stopVoice(v, this.ctx.currentTime, 0.05);
    const held = old.map((v) => v.key);
    this.setDrone(droneNote);
    for (const key of held) this.voices.push(this.build(key, 0.4, this.ctx.currentTime, 0.02));
  }

  allNotesOff(time = this.ctx.currentTime): void {
    for (const voice of this.voices.splice(0)) this.stopVoice(voice, time, 0.05);
  }

  dispose(): void {
    this.allNotesOff();
    if (this.drone) this.stopVoice(this.drone, this.ctx.currentTime, 0.02);
    this.drone = undefined;
  }

  private droneAt = DRONE_LEVEL;

  /** Moves the drone to a new level; it is only ever at rest (a known level) when this is called. */
  private rampDrone(to: number, time: number): void {
    const drone = this.drone;
    if (!drone) return;
    drone.env.gain.cancelScheduledValues(time);
    drone.env.gain.setValueAtTime(this.droneAt, time);
    drone.env.gain.linearRampToValueAtTime(to, time + 0.1);
    drone.env.gain.setValueAtTime(to, time + 0.1);
    this.droneAt = to;
  }

  private fadeDrone(time: number): void {
    this.rampDrone(0, time);
  }

  private build(note: number, level: number, time: number, attack: number): CarrierVoice {
    const env = this.ctx.createGain();
    attackTo(env.gain, level, time, attack);
    env.connect(this.output);
    const sources: AudioScheduledSourceNode[] = [];
    const layers = carrierLayers(this.kind);
    if (layers.length === 0) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer();
      src.loop = true;
      src.connect(env);
      sources.push(src);
    }
    for (const [type, multiple, cents, gain] of layers) {
      const osc = this.ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = midiToFreq(note) * multiple;
      osc.detune.value = cents;
      const g = this.ctx.createGain();
      g.gain.value = gain;
      osc.connect(g).connect(env);
      sources.push(osc);
    }
    for (const s of sources) s.start(time);
    return { key: note, env, sources, peak: level, start: time, attack };
  }

  private stopVoice(voice: CarrierVoice, time: number, release: number): void {
    const stopAt = releaseFrom(voice.env.gain, attackLevel(voice.peak, voice.start, voice.attack, time), time, release);
    for (const s of voice.sources) s.stop(stopAt);
    voice.sources[0].onended = () => {
      voice.env.disconnect();
      for (const s of voice.sources) s.disconnect();
    };
  }

  private noiseBuffer(): AudioBuffer {
    if (!this.noise) {
      this.noise = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    return this.noise;
  }
}
