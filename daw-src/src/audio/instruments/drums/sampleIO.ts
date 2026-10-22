import { addAudioBlobAsset } from "../../../project/importMedia";
import type { DrumBase } from "./drumBase";
import { DrumSampleError } from "./samples";

export const MAX_SAMPLE_SECONDS = 30;

/**
 * Stores an audio file as a project asset and puts it on a pad or voice slot. The blob lives in
 * IndexedDB; the instrument keeps only the asset id, so the project JSON stays small.
 */
export async function addSampleToSlot(instrument: DrumBase, slot: number, source: Blob, name: string): Promise<void> {
  const { asset, buffer } = await addAudioBlobAsset(source, name).catch((err: unknown) => {
    throw new DrumSampleError(err instanceof Error ? err.message : `"${name}" could not be loaded as a sample.`);
  });
  if (buffer.duration > MAX_SAMPLE_SECONDS) {
    throw new DrumSampleError(`"${name}" is ${Math.round(buffer.duration)} seconds long. Drum samples can be up to ${MAX_SAMPLE_SECONDS} seconds; trim it first.`);
  }
  instrument.setSample(slot, { assetId: asset.id, name: asset.name }, buffer);
}

export interface SampleRecording {
  stop(): Promise<Blob>;
}

/** Records the microphone into a blob; the room hands the blob to addSampleToSlot. */
export async function startSampleRecording(): Promise<SampleRecording> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    throw new DrumSampleError("This browser cannot record from a microphone.");
  }
  let stream: MediaStream;
  try {
    // Processing is off: echo cancellation and noise suppression would colour a sample.
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  } catch {
    throw new DrumSampleError("Microphone access was blocked. Allow it in the browser's address bar and try again.");
  }
  const recorder = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => chunks.push(e.data);
  recorder.start();
  return {
    stop: () =>
      new Promise<Blob>((resolve, reject) => {
        recorder.onerror = () => reject(new DrumSampleError("The recording failed."));
        recorder.onstop = () => {
          stream.getTracks().forEach((t) => t.stop());
          resolve(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }));
        };
        recorder.stop();
      }),
  };
}
