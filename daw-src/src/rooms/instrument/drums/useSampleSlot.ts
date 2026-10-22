import { useCallback, useRef, useState, type DragEvent } from "react";
import type { DrumBase } from "../../../audio/instruments/drums/drumBase";
import { notify } from "../../../audio/instruments/drums/notify";
import { addSampleToSlot, startSampleRecording, type SampleRecording } from "../../../audio/instruments/drums/sampleIO";

/** File choose, drag-and-drop and microphone recording for one sample slot; every failure becomes a toast. */
export function useSampleSlot(instrument: DrumBase, slot: number) {
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [recording, setRecording] = useState(false);
  const recorder = useRef<SampleRecording | null>(null);

  const load = useCallback(
    async (file: Blob, name: string) => {
      setBusy(true);
      try {
        await addSampleToSlot(instrument, slot, file, name);
        instrument.hitVoice(slot, 0.9);
      } catch (err) {
        notify(err instanceof Error ? err.message : "That sample could not be loaded.");
      } finally {
        setBusy(false);
      }
    },
    [instrument, slot],
  );

  const choose = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "audio/*,.wav,.mp3,.ogg,.m4a,.aif,.aiff,.flac";
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) void load(file, file.name);
    };
    input.click();
  }, [load]);

  const toggleRecord = useCallback(async () => {
    if (recorder.current) {
      const active = recorder.current;
      recorder.current = null;
      setRecording(false);
      try {
        await load(await active.stop(), `Recording ${new Date().toLocaleTimeString()}`);
      } catch (err) {
        notify(err instanceof Error ? err.message : "The recording failed.");
      }
      return;
    }
    try {
      recorder.current = await startSampleRecording();
      setRecording(true);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Recording could not start.");
    }
  }, [load]);

  const dropProps = {
    onDragOver: (e: DragEvent) => {
      e.preventDefault();
      setOver(true);
    },
    onDragLeave: () => setOver(false),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      setOver(false);
      const file = e.dataTransfer.files[0];
      if (file) void load(file, file.name);
      else notify("Drop an audio file to use it as a sample.");
    },
  };

  return { busy, over, recording, choose, toggleRecord, dropProps, clear: () => instrument.clearSample(slot) };
}
