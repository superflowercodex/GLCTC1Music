import { barSeconds, clipRate } from "../project/actions";
import type { Clip, Project } from "../project/model";
import { dbToGain } from "./bus";
import { stepDuration } from "./clock";
import { getWarpedBuffer, type WarpParams } from "./warpCache";

/** Which pattern an instrument should play at a 16th step, from the pattern clips on its track; null means silent. */
export function patternAtStep(project: Project, slotId: string, step: number): number | null {
  const slot = project.instruments.find((s) => s.id === slotId);
  const track = project.tracks.find((t) => t.id === slot?.trackId);
  if (!track) return null;
  const barPos = step / (project.beatsPerBar * 4) + 1;
  let best: Clip | undefined;
  for (const c of track.clips) {
    if (c.kind !== "pattern" || barPos < c.startBar || barPos >= c.startBar + c.lengthBars) continue;
    // Where clips overlap, the one that started last wins, like the top layer.
    if (!best || c.startBar >= best.startBar) best = c;
  }
  return best ? (best.patternIndex ?? 0) : null;
}

/** True when the arrangement decides what this instrument plays; otherwise the instrument keeps running its own pattern. */
export function slotIsArranged(project: Project, slotId: string): boolean {
  const slot = project.instruments.find((s) => s.id === slotId);
  const track = project.tracks.find((t) => t.id === slot?.trackId);
  return !!track && track.clips.some((c) => c.kind === "pattern");
}

export interface ScheduledClips {
  /** Stops everything; with a time, at that audio-clock moment (used to cut cleanly at a loop wrap). */
  stop(atTime?: number): void;
}

export interface ScheduleOptions {
  destinationFor(trackId: string): AudioNode;
  buffers: ReadonlyMap<string, AudioBuffer>;
  /** Project time in seconds to start from; clips already running are joined part-way. */
  fromSec: number;
  /** Audio-clock time that corresponds to fromSec. */
  atTime: number;
  /**
   * Time-stretched or pitch-shifted buffers by clip id, from prepareWarpedBuffers. When given, nothing is
   * processed during scheduling, which is what an offline render needs. When omitted, such clips start
   * with a plain-speed fallback and switch over as soon as the processed buffer is ready.
   */
  warped?: ReadonlyMap<string, AudioBuffer>;
  /** Skip muted tracks and, when anything is soloed, tracks that are not. Live playback leaves this to the track buses. */
  honorMuteSolo?: boolean;
}

const reversedWindows = new WeakMap<AudioBuffer, Map<string, AudioBuffer>>();

/**
 * The part of `source` a clip plays, written backwards, so Reverse works with trim, warp and pitch unchanged.
 * Built with the source's own constructor because prepareWarpedBuffers has no context to create buffers from.
 */
export function reversedWindow(source: AudioBuffer, offsetSec: number, windowSec: number): AudioBuffer {
  const from = Math.min(source.length, Math.max(0, Math.round(offsetSec * source.sampleRate)));
  const to = Math.min(source.length, Math.max(from, Math.round((offsetSec + windowSec) * source.sampleRate)));
  const key = `${from}:${to}`;
  const perSource = reversedWindows.get(source) ?? new Map<string, AudioBuffer>();
  reversedWindows.set(source, perSource);
  const hit = perSource.get(key);
  if (hit) return hit;
  const Ctor = source.constructor as new (o: { length: number; numberOfChannels: number; sampleRate: number }) => AudioBuffer;
  const out = new Ctor({ length: Math.max(1, to - from), numberOfChannels: source.numberOfChannels, sampleRate: source.sampleRate });
  for (let c = 0; c < source.numberOfChannels; c++) {
    const src = source.getChannelData(c);
    const dst = out.getChannelData(c);
    for (let i = 0; i < to - from; i++) dst[i] = src[to - 1 - i];
  }
  perSource.set(key, out);
  return out;
}

/** What actually gets processed and played for a clip: the source, or its reversed trim window with the offset folded in. */
export function playbackSource(project: Project, clip: Clip, buffer: AudioBuffer): { buffer: AudioBuffer; clip: Clip } {
  if (!clip.reversed) return { buffer, clip };
  const window = clip.lengthBars * barSeconds(project) * clipRate(project, clip);
  return { buffer: reversedWindow(buffer, clip.offsetSec, window), clip: { ...clip, offsetSec: 0 } };
}

export function needsWarp(clip: Clip): boolean {
  return clip.warp || clip.pitchSemitones !== 0 || clip.fineCents !== 0;
}

export function warpParams(project: Project, clip: Clip): WarpParams {
  return { tempoRatio: clipRate(project, clip), semitones: clip.pitchSemitones, cents: clip.fineCents, keyLock: clip.keyLock };
}

/** Processes every clip that needs it, so an offline render can pass the result as `warped` and stay synchronous. */
export async function prepareWarpedBuffers(project: Project, buffers: ReadonlyMap<string, AudioBuffer>): Promise<Map<string, AudioBuffer>> {
  const out = new Map<string, AudioBuffer>();
  const jobs: Array<Promise<void>> = [];
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      const raw = clip.kind === "audio" && clip.assetId ? buffers.get(clip.assetId) : undefined;
      if (!raw || !needsWarp(clip)) continue;
      jobs.push(getWarpedBuffer(playbackSource(project, clip, raw).buffer, warpParams(project, clip)).then((b) => void out.set(clip.id, b)));
    }
  }
  await Promise.all(jobs);
  return out;
}

interface Voice {
  source: AudioBufferSourceNode;
  gain: GainNode;
  endTime: number;
}

/** Gain over a clip's own time, in seconds from its start: the clip gain with linear fades at both ends. */
export function clipEnvelope(clip: Clip, lenSec: number, stepSec: number): (t: number) => number {
  const g = dbToGain(clip.gainDb);
  const fadeIn = Math.min(clip.fadeInSteps * stepSec, lenSec);
  const fadeOut = Math.min(clip.fadeOutSteps * stepSec, lenSec);
  return (t) => {
    const up = fadeIn > 0 ? Math.min(1, t / fadeIn) : 1;
    const down = fadeOut > 0 ? Math.min(1, (lenSec - t) / fadeOut) : 1;
    return g * Math.max(0, Math.min(up, down));
  };
}

/**
 * Schedules every audio clip against the audio clock. It works on any BaseAudioContext and touches
 * no globals, so live playback and the offline mixdown use the same code.
 */
export function scheduleAudioClips(ctx: BaseAudioContext, project: Project, options: ScheduleOptions): ScheduledClips {
  const barSec = barSeconds(project);
  const stepSec = stepDuration(project.bpm);
  const anySolo = project.tracks.some((t) => t.solo);
  const voices = new Set<Voice>();
  let stopped = false;

  const startVoice = (
    clip: Clip,
    buffer: AudioBuffer,
    processed: boolean,
    whenAbs: number,
    t0: number,
    destination: AudioNode,
  ): Voice | undefined => {
    const lenSec = clip.lengthBars * barSec;
    const rate = clipRate(project, clip);
    const srcOffset = processed ? clip.offsetSec / rate + t0 : clip.offsetSec + t0 * rate;
    const speed = processed ? 1 : rate;
    const remainingSource = buffer.duration - srcOffset;
    if (remainingSource <= 0.001) return undefined;
    const playSec = Math.min(lenSec - t0, remainingSource / speed);
    if (playSec <= 0.001) return undefined;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = speed;
    if (!processed) source.detune.value = clip.pitchSemitones * 100 + clip.fineCents;
    const gain = ctx.createGain();
    const env = clipEnvelope(clip, lenSec, stepSec);
    const g = dbToGain(clip.gainDb);
    gain.gain.setValueAtTime(env(t0), whenAbs);
    const fadeIn = Math.min(clip.fadeInSteps * stepSec, lenSec);
    const fadeOut = Math.min(clip.fadeOutSteps * stepSec, lenSec);
    if (fadeIn > 0 && t0 < fadeIn) gain.gain.linearRampToValueAtTime(g, whenAbs + (fadeIn - t0));
    if (fadeOut > 0) {
      const fadeOutStart = lenSec - fadeOut;
      if (t0 < fadeOutStart) gain.gain.setValueAtTime(g, whenAbs + (fadeOutStart - t0));
      gain.gain.linearRampToValueAtTime(0, whenAbs + (lenSec - t0));
    }
    source.connect(gain).connect(destination);
    source.start(whenAbs, srcOffset);
    const endTime = whenAbs + playSec;
    source.stop(endTime);
    const voice: Voice = { source, gain, endTime };
    voices.add(voice);
    source.onended = () => {
      voices.delete(voice);
      source.disconnect();
      gain.disconnect();
    };
    return voice;
  };

  const silence = (voice: Voice, at: number): void => {
    voice.gain.gain.cancelScheduledValues(at);
    voice.gain.gain.setTargetAtTime(0, at, 0.004);
    voice.source.stop(at + 0.03);
  };

  for (const track of project.tracks) {
    if (options.honorMuteSolo && (track.muted || (anySolo && !track.solo))) continue;
    for (const clip of track.clips) {
      if (clip.kind !== "audio" || !clip.assetId) continue;
      const rawBuffer = options.buffers.get(clip.assetId);
      if (!rawBuffer) continue;
      const { buffer, clip: playClip } = playbackSource(project, clip, rawBuffer);
      const clipStart = (clip.startBar - 1) * barSec;
      const lenSec = clip.lengthBars * barSec;
      if (clipStart + lenSec <= options.fromSec) continue;
      const t0 = Math.max(0, options.fromSec - clipStart);
      const whenAbs = options.atTime + Math.max(0, clipStart - options.fromSec);
      const destination = options.destinationFor(track.id);
      const warped = needsWarp(clip) ? options.warped?.get(clip.id) : undefined;
      const voice = startVoice(playClip, warped ?? buffer, warped !== undefined, whenAbs, t0, destination);
      if (!voice || !needsWarp(clip) || warped || options.warped) continue;

      void getWarpedBuffer(buffer, warpParams(project, clip)).then((processed) => {
        if (stopped || processed === buffer) return;
        const switchAt = ctx.currentTime + 0.03;
        if (switchAt >= voice.endTime - 0.05) return;
        silence(voice, switchAt);
        const tNow = Math.max(t0, switchAt - whenAbs + t0);
        // A clip that has not started yet keeps its own start time.
        const resumeAt = whenAbs > switchAt ? whenAbs : switchAt;
        const resumeT = whenAbs > switchAt ? t0 : tNow;
        startVoice(playClip, processed, true, resumeAt, resumeT, destination);
      });
    }
  }

  return {
    stop(atTime) {
      stopped = true;
      const at = atTime ?? ctx.currentTime;
      for (const voice of [...voices]) silence(voice, at);
    },
  };
}
