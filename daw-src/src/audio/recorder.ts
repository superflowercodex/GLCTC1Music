import { addClip, addTrack, barSeconds, makeClip, makeTrack } from "../project/actions";
import { addAudioBlobAsset, ImportError } from "../project/importMedia";
import type { Project } from "../project/model";
import { projectStore, uiStore } from "../store/project";
import { scheduleClick } from "./arrangementPlayback";
import { getEngine, type Engine } from "./engine";
import { showToast } from "./media";

export type RecordSource =
  { kind: "mic"; deviceId?: string } | { kind: "master" } | { kind: "track"; trackId: string } | { kind: "instrument"; slotId: string };

export interface RecordOptions {
  source: RecordSource;
  countInBars: 0 | 1 | 2;
  stopAfterBars: number | null;
  stems: boolean;
  punchIn: boolean;
}

export interface RecordingSession {
  readonly state: "counting" | "recording" | "stopped";
  level(): number;
  stop(): Promise<void>;
}

export class RecordingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecordingError";
  }
}

export interface RecordingPlan {
  /** Step the take starts on. */
  startStep: number;
  /** Step the take ends on, or null to run until stopped. */
  endStep: number | null;
  /** Step the transport begins from; punch-in gets a bar of lead-in so you hear what you are joining. */
  transportFrom: number;
}

/** Where a take starts and ends, from the playhead and the options. Pure so the rules are testable. */
export function planRecording(
  project: Pick<Project, "beatsPerBar" | "loop">,
  positionStep: number,
  transportPlaying: boolean,
  options: Pick<RecordOptions, "countInBars" | "stopAfterBars" | "punchIn">,
): RecordingPlan {
  const spb = project.beatsPerBar * 4;
  if (options.punchIn) {
    if (project.loop.endBar <= project.loop.startBar) throw new RecordingError("Set a loop region first: punch-in records only inside it.");
    const startStep = (project.loop.startBar - 1) * spb;
    return { startStep, endStep: (project.loop.endBar - 1) * spb, transportFrom: Math.max(0, startStep - spb) };
  }
  // Without a count-in a running transport is joined as it is; otherwise takes start on a bar line.
  const startStep = transportPlaying && options.countInBars === 0 ? positionStep : Math.floor(positionStep / spb) * spb;
  const endStep = options.stopAfterBars ? startStep + options.stopAfterBars * spb : null;
  return { startStep, endStep, transportFrom: startStep };
}

const MAX_COMPENSATION_SEC = 0.5;

/**
 * How late a microphone take lands against the timeline: what the player heard was delayed by the output
 * path and what was captured by the input path, so the take is trimmed by their sum. Only mic takes need it,
 * because taps inside the graph are already in time.
 */
export function inputLatencySec(ctx: { baseLatency?: number; outputLatency?: number }, source: RecordSource): number {
  if (source.kind !== "mic") return 0;
  const sum = (Number.isFinite(ctx.baseLatency) ? ctx.baseLatency! : 0) + (Number.isFinite(ctx.outputLatency) ? ctx.outputLatency! : 0);
  return Math.min(MAX_COMPENSATION_SEC, Math.max(0, sum));
}

const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];

export function pickMimeType(isSupported: (mime: string) => boolean): string | undefined {
  return MIME_CANDIDATES.find((m) => isSupported(m));
}

function micError(err: unknown): RecordingError {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError")
    return new RecordingError("Microphone access was blocked. Allow it for this site in your browser settings, then try again.");
  if (name === "NotFoundError" || name === "OverconstrainedError")
    return new RecordingError("That microphone was not found. Plug it in or pick another input.");
  if (name === "NotReadableError") return new RecordingError("The microphone is being used by another app. Close it and try again.");
  return new RecordingError("The microphone could not be opened.");
}

function liveContext(engine: Engine): AudioContext {
  if (!(engine.ctx instanceof AudioContext)) throw new RecordingError("Recording needs a live audio output, which is not available here.");
  return engine.ctx;
}

interface Take {
  name: string;
  recorder: MediaRecorder;
  chunks: Blob[];
  analyser: AnalyserNode;
  stopped: Promise<Blob>;
  release(): void;
}

function makeTake(engine: Engine, name: string, stream: MediaStream, tap: AudioNode, release: () => void): Take {
  const mimeType = pickMimeType((m) => MediaRecorder.isTypeSupported(m));
  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  } catch (err) {
    release();
    throw new RecordingError(`Recording could not start: ${err instanceof Error ? err.message : "the browser refused."}`);
  }
  const analyser = engine.ctx.createAnalyser();
  analyser.fftSize = 1024;
  tap.connect(analyser);
  const chunks: Blob[] = [];
  const stopped = new Promise<Blob>((resolve, reject) => {
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/webm" }));
    recorder.onerror = () => reject(new RecordingError("The browser stopped recording because of an error."));
  });
  return {
    name,
    recorder,
    chunks,
    analyser,
    stopped,
    release: () => {
      tap.disconnect(analyser);
      release();
    },
  };
}

function tapTake(engine: Engine, name: string, node: AudioNode): Take {
  const dest = liveContext(engine).createMediaStreamDestination();
  node.connect(dest);
  return makeTake(engine, name, dest.stream, node, () => node.disconnect(dest));
}

async function micTake(engine: Engine, deviceId: string | undefined): Promise<Take> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia)
    throw new RecordingError("This browser can't use a microphone here. Use HTTPS and a current browser.");
  let stream: MediaStream;
  try {
    // Processing off: it is meant for calls and makes music sound pumped and thin.
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId && deviceId !== "default" ? { exact: deviceId } : undefined,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
  } catch (err) {
    throw micError(err);
  }
  const source = liveContext(engine).createMediaStreamSource(stream);
  return makeTake(engine, "Mic", stream, source, () => {
    source.disconnect();
    for (const t of stream.getTracks()) t.stop();
  });
}

async function buildTakes(engine: Engine, options: RecordOptions, project: Project): Promise<Take[]> {
  const { source } = options;
  if (source.kind === "mic") return [await micTake(engine, source.deviceId)];
  if (source.kind === "master") {
    const takes = [tapTake(engine, "Master", engine.master)];
    if (options.stems) for (const t of project.tracks) takes.push(tapTake(engine, t.name, engine.bus(t.id).output));
    return takes;
  }
  if (source.kind === "track") {
    const track = project.tracks.find((t) => t.id === source.trackId);
    if (!track) throw new RecordingError("That track no longer exists.");
    return [tapTake(engine, track.name, engine.bus(track.id).output)];
  }
  const slot = project.instruments.find((s) => s.id === source.slotId);
  if (!slot) throw new RecordingError("That instrument is not in this project.");
  try {
    return [tapTake(engine, project.tracks.find((t) => t.id === slot.trackId)?.name ?? "Instrument", engine.getInstrument(slot.id).output)];
  } catch {
    throw new RecordingError("That instrument is not loaded yet. Open it once, then record.");
  }
}

/** Calls `fn` near an audio-clock moment; the recorder cannot be scheduled sample-exactly, so a timer is the closest honest tool. */
function atAudioTime(engine: Engine, time: number, fn: () => void): ReturnType<typeof setTimeout> {
  return setTimeout(fn, Math.max(0, (time - engine.ctx.currentTime) * 1000));
}

export async function startRecording(options: RecordOptions): Promise<RecordingSession> {
  if (typeof MediaRecorder === "undefined")
    throw new RecordingError("This browser can't record audio. Try a current version of Chrome, Edge, Firefox or Safari.");
  const engine = getEngine();
  await engine.resume();
  const { clock, ctx } = engine;
  const project = projectStore.get();
  const plan = planRecording(project, clock.position(), clock.playing, options);
  const takes = await buildTakes(engine, options, project);

  const previousLoop = clock.loop;
  const startedTransport = !clock.playing || options.countInBars > 0 || options.punchIn;
  let state: RecordingSession["state"] = options.countInBars > 0 || options.punchIn ? "counting" : "recording";
  let begun = false;
  let finished: Promise<void> | undefined;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let unsubscribe: (() => void) | undefined;

  const beginTakes = (): void => {
    if (begun) return;
    begun = true;
    for (const t of takes) t.recorder.start();
    state = "recording";
  };

  const session: RecordingSession = {
    get state() {
      return state;
    },
    level() {
      const analyser = takes[0].analyser;
      const buf = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      return Math.sqrt(sum / buf.length);
    },
    stop() {
      finished ??= finish();
      return finished;
    },
  };

  const fail = (err: unknown): never => {
    const message = err instanceof Error ? err.message : "Recording failed.";
    showToast(message);
    throw err instanceof RecordingError ? err : new RecordingError(message);
  };

  const finish = async (): Promise<void> => {
    unsubscribe?.();
    for (const t of timers) clearTimeout(t);
    timers.clear();
    if (startedTransport) clock.stop();
    clock.loop = previousLoop;
    const wasRecording = begun;
    const blobs: Promise<Blob>[] = [];
    if (wasRecording) {
      for (const t of takes) {
        if (t.recorder.state !== "inactive") t.recorder.stop();
        blobs.push(t.stopped);
      }
    }
    state = "stopped";
    try {
      const results = await Promise.all(blobs);
      if (wasRecording) await place(results);
    } catch (err) {
      fail(err);
    } finally {
      for (const t of takes) t.release();
    }
  };

  const place = async (blobs: Blob[]): Promise<void> => {
    const added: Array<{ name: string; assetId: string; seconds: number }> = [];
    for (let i = 0; i < blobs.length; i++) {
      if (blobs[i].size === 0) {
        if (i === 0) throw new RecordingError("Nothing was recorded. Check the input level and try again.");
        continue;
      }
      const stamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      const name = i === 0 ? `Recording ${stamp}` : `${takes[i].name} stem`;
      try {
        const { asset, buffer } = await addAudioBlobAsset(blobs[i], name);
        added.push({ name: i === 0 ? name : `${takes[i].name} stem`, assetId: asset.id, seconds: buffer.duration });
      } catch (err) {
        throw new RecordingError(err instanceof ImportError ? err.message : "The recording could not be read back.");
      }
    }
    const startBar = plan.startStep / (project.beatsPerBar * 4) + 1;
    const compensation = inputLatencySec(ctx as BaseAudioContext & { baseLatency?: number; outputLatency?: number }, options.source);
    let firstClipId: string | undefined;
    projectStore.set((p) => {
      let next = p;
      for (const [i, a] of added.entries()) {
        const track = makeTrack(next, "audio", { name: a.name });
        const trim = i === 0 ? Math.min(compensation, Math.max(0, a.seconds - 0.1)) : 0;
        const clip = makeClip({
          kind: "audio",
          name: a.name,
          startBar,
          lengthBars: Math.max(0.25, (a.seconds - trim) / barSeconds(next)),
          assetId: a.assetId,
          offsetSec: trim,
        });
        firstClipId ??= clip.id;
        next = addClip(addTrack(next, track), track.id, clip);
      }
      return next;
    });
    if (firstClipId) uiStore.set((s) => ({ ...s, selectedClipId: firstClipId ?? null }));
  };

  clock.loop = null;
  const endOnStep = plan.endStep;
  unsubscribe = clock.subscribe((step, time) => {
    if (state === "stopped") return;
    if (options.punchIn && !begun && step >= plan.startStep) timers.add(atAudioTime(engine, time, beginTakes));
    if (endOnStep !== null && step >= endOnStep && finished === undefined) {
      timers.add(
        atAudioTime(engine, time, () => {
          void session.stop().catch(() => undefined);
        }),
      );
    }
  });

  if (options.countInBars > 0) {
    clock.stop();
    clock.seek(plan.transportFrom);
    const beats = options.countInBars * project.beatsPerBar;
    const beatSec = 60 / clock.bpm;
    const first = ctx.currentTime + 0.1;
    for (let i = 0; i < beats; i++) scheduleClick(ctx, first + i * beatSec, i % project.beatsPerBar === 0);
    const downbeat = first + beats * beatSec;
    clock.start(plan.transportFrom, downbeat);
    if (!options.punchIn) timers.add(atAudioTime(engine, downbeat, beginTakes));
  } else {
    if (startedTransport) {
      clock.seek(plan.transportFrom);
      clock.start(plan.transportFrom);
    }
    if (!options.punchIn) beginTakes();
  }

  return session;
}
