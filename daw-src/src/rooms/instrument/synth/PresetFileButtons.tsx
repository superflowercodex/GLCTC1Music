import { useRef } from "react";
import type { Instrument } from "../../../audio/types";
import { exportPresetText, importPresetText } from "../../../audio/instruments/synth/presetFile";
import { Button } from "../../../ui/controls";
import { messageOf, showToast } from "./toast";

function download(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function PresetFileButtons({ instrument }: { instrument: Instrument }) {
  const input = useRef<HTMLInputElement>(null);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const name = importPresetText(instrument, await file.text());
      showToast(`Imported preset "${name}".`);
    } catch (error) {
      showToast(messageOf(error));
    }
  };

  const onExport = () => {
    const current = instrument.presets.find((p) => p.id === instrument.serialize().presetId);
    const name = current?.name ?? "Custom sound";
    download(`${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.${instrument.kind}.json`, exportPresetText(instrument, name, current?.category));
  };

  return (
    <>
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        hidden
        aria-label="Preset file"
        onChange={(e) => {
          void onFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <Button className="sy-file" onClick={() => input.current?.click()} title="Load a preset from a file">
        Import
      </Button>
      <Button className="sy-file" onClick={onExport} title="Save this sound to a file">
        Export
      </Button>
    </>
  );
}
