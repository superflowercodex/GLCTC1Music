import type { Engine } from "../../audio/engine";

export class CaptureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CaptureError";
  }
}

const MIME_CANDIDATES = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"] as const;

export function pickRecordingMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m));
}

export function captureSupported(canvas: HTMLCanvasElement): boolean {
  return typeof canvas.captureStream === "function" && pickRecordingMime() !== undefined;
}

export interface StageRecording {
  mime: string;
  extension: "webm" | "mp4";
  stop(): Promise<Blob>;
}

/** Records the stage canvas, plus the master mix when an engine exists, into a video file. */
export function startCapture(canvas: HTMLCanvasElement, engine: Engine | undefined): StageRecording {
  const mime = pickRecordingMime();
  if (!mime || typeof canvas.captureStream !== "function") {
    throw new CaptureError("This browser cannot record the stage. Try a recent Chrome, Edge or Firefox on a computer.");
  }
  const stream = canvas.captureStream(30);
  let tap: MediaStreamAudioDestinationNode | undefined;
  if (engine && "createMediaStreamDestination" in engine.ctx) {
    tap = (engine.ctx as AudioContext).createMediaStreamDestination();
    engine.limiter.connect(tap);
    for (const track of tap.stream.getAudioTracks()) stream.addTrack(track);
  }
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  recorder.start(1000);

  const release = () => {
    if (tap) engine?.limiter.disconnect(tap);
    for (const track of stream.getTracks()) track.stop();
  };
  return {
    mime,
    extension: mime.startsWith("video/mp4") ? "mp4" : "webm",
    stop: () =>
      new Promise<Blob>((resolve, reject) => {
        recorder.onerror = () => {
          release();
          reject(new CaptureError("The recording failed part-way. Nothing was saved."));
        };
        recorder.onstop = () => {
          release();
          if (chunks.length === 0) reject(new CaptureError("The recording was empty. Play the stage while recording."));
          else resolve(new Blob(chunks, { type: mime }));
        };
        recorder.stop();
      }),
  };
}
