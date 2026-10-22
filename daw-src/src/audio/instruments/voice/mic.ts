import { AudioEngineError } from "../../types";

export class MicError extends AudioEngineError {
  constructor(message: string) {
    super(message);
    this.name = "MicError";
  }
}

/** Turns the browser's getUserMedia failures into messages that say what to do. */
export function micErrorFor(error: unknown): MicError {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return new MicError("Microphone access is blocked. Allow it in the browser's address bar, or load an audio file instead.");
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return new MicError("No microphone was found. Plug one in, or load an audio file instead.");
  }
  if (name === "NotReadableError") return new MicError("The microphone is in use by another app.");
  return new MicError("The microphone could not be opened.");
}

/** Raw voice for a vocal chain: all browser voice processing off, because it would fight our own gate and compressor. */
export async function openMic(): Promise<MediaStream> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw new MicError("This browser has no microphone support. Load an audio file instead.");
  }
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
  } catch (error) {
    throw micErrorFor(error);
  }
}

/** Records the microphone to a blob until stop() is called. */
export class MicRecorder {
  private recorder: MediaRecorder | undefined;
  private stream: MediaStream | undefined;
  private chunks: Blob[] = [];

  get recording(): boolean {
    return this.recorder?.state === "recording";
  }

  async start(): Promise<void> {
    if (typeof MediaRecorder === "undefined") throw new MicError("This browser cannot record audio.");
    this.stream = await openMic();
    this.chunks = [];
    this.recorder = new MediaRecorder(this.stream);
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.recorder.start();
  }

  stop(): Promise<Blob> {
    const recorder = this.recorder;
    if (!recorder || recorder.state === "inactive") return Promise.reject(new MicError("Nothing is being recorded."));
    return new Promise((resolve, reject) => {
      recorder.onstop = () => {
        this.stream?.getTracks().forEach((t) => t.stop());
        this.recorder = undefined;
        resolve(new Blob(this.chunks, { type: recorder.mimeType || "audio/webm" }));
      };
      recorder.onerror = () => reject(new MicError("The recording failed."));
      recorder.stop();
    });
  }

  cancel(): void {
    if (this.recorder && this.recorder.state !== "inactive") {
      this.recorder.onstop = null;
      this.recorder.stop();
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.recorder = undefined;
  }
}
