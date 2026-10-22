import { useRef } from "react";
import type { Vox } from "../../../audio/instruments/vox";
import { NOTE_NAMES } from "../../../audio/instruments/voice/scales";
import { Button } from "../../../ui/controls";
import { ParamControl } from "./ParamControl";
import { MODULES, type ModuleId } from "./SignalChain";

const FX_MORE = ["delayDiv", "delayFb", "reverbSize", "reverbDamp", "spaceSize", "spacePre", "shimmer", "gravity", "nebula", "nebulaRate", "orbit", "orbitRate", "radiation", "radRate", "comet", "cometRate", "drive", "low", "high", "chorus"];

function InputActions({ vox }: { vox: Vox }) {
  const picker = useRef<HTMLInputElement>(null);
  return (
    <div className="module-actions">
      <Button variant={vox.micActive ? "primary" : "ghost"} onClick={() => (vox.micActive ? vox.stopMic() : void vox.startMic())}>
        {vox.micActive ? "Stop mic" : "Start mic"}
      </Button>
      <Button onClick={() => picker.current?.click()}>Load file</Button>
      {vox.hasFile && (
        <Button variant={vox.filePlaying ? "primary" : "ghost"} onClick={() => (vox.filePlaying ? vox.stopFile() : void vox.playFile())}>
          {vox.filePlaying ? "Stop file" : "Play file"}
        </Button>
      )}
      <input
        ref={picker}
        className="voice-hidden-input"
        type="file"
        accept="audio/*"
        aria-label="Choose a vocal audio file"
        tabIndex={-1}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void vox.loadInputFile(file).then(() => vox.playFile());
        }}
      />
      {vox.inputName && <div className="voice-note" style={{ flexBasis: "100%" }}>File: {vox.inputName}</div>}
      {vox.micActive && <div className="voice-note" style={{ flexBasis: "100%" }}>Use headphones, or the mic will hear the speakers.</div>}
    </div>
  );
}

/** The editor for whichever chain module is selected. Sliders come straight from the instrument's parameters. */
export function ModulePanel({ vox, module }: { vox: Vox; module: ModuleId }) {
  const info = MODULES.find((m) => m.id === module)!;
  const key = vox.key;
  const keyName = `${NOTE_NAMES[key.root]} ${key.scale}`;
  const blurb = module === "tune" ? `Snaps your voice to the project key, ${keyName}. Pitch and formant apply even when auto-tune is off.` : info.blurb;

  return (
    <>
      <div>
        <div className="voice-label">Editing</div>
        <div className="module-title">{info.name}</div>
        <div className="module-blurb">{blurb}</div>
      </div>
      <div className="module-body scroll-y mint-sliders" style={{ flex: 1 }}>
        {module === "input" && (
          <>
            <InputActions vox={vox} />
            <ParamControl instrument={vox} id="source" />
            <ParamControl instrument={vox} id="inGain" />
            <ParamControl instrument={vox} id="voiceLevel" />
            <ParamControl instrument={vox} id="monitor" />
          </>
        )}
        {module === "gate" && (
          <>
            <ParamControl instrument={vox} id="gateThresh" />
            <ParamControl instrument={vox} id="gateRelease" />
          </>
        )}
        {module === "comp" && (
          <>
            <ParamControl instrument={vox} id="compRatio" />
            <ParamControl instrument={vox} id="compThresh" />
            <ParamControl instrument={vox} id="compMakeup" />
          </>
        )}
        {module === "tune" && (
          <>
            <ParamControl instrument={vox} id="tuneSpeed" />
            <ParamControl instrument={vox} id="tuneAmount" />
            <ParamControl instrument={vox} id="tuneHumanise" />
            <ParamControl instrument={vox} id="formant" />
            <ParamControl instrument={vox} id="pitch" />
          </>
        )}
        {module === "harm" && (
          <>
            <ParamControl instrument={vox} id="harmMode" />
            <ParamControl instrument={vox} id="harmI1" />
            <ParamControl instrument={vox} id="harmI2" />
            <ParamControl instrument={vox} id="harmI3" />
            <ParamControl instrument={vox} id="harmMix" />
            <div className="module-sub">Levels and stereo position</div>
            {[1, 2, 3].map((n) => (
              <div key={n} style={{ display: "grid", gap: 16 }}>
                <ParamControl instrument={vox} id={`harmL${n}`} />
                <ParamControl instrument={vox} id={`harmP${n}`} />
              </div>
            ))}
          </>
        )}
        {module === "voc" && (
          <>
            <ParamControl instrument={vox} id="vocBands" />
            <ParamControl instrument={vox} id="vocCarrier" />
            <ParamControl instrument={vox} id="vocMix" />
            <ParamControl instrument={vox} id="vocQ" />
            <ParamControl instrument={vox} id="vocShift" />
            <ParamControl instrument={vox} id="vocResponse" />
            <ParamControl instrument={vox} id="vocSib" />
            <div className="voice-note">Hold keys to play the carrier; with none held it hums on the key&apos;s root.</div>
          </>
        )}
        {module === "fx" && (
          <>
            <ParamControl instrument={vox} id="delayMix" />
            <ParamControl instrument={vox} id="reverbMix" />
            <ParamControl instrument={vox} id="spaceMix" />
            <div className="module-sub">Shape each effect</div>
            {FX_MORE.map((id) => (
              <ParamControl key={id} instrument={vox} id={id} />
            ))}
          </>
        )}
      </div>
    </>
  );
}
