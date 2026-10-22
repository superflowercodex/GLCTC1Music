import type { Instrument } from "../../../audio/types";

export type ModuleId = "input" | "gate" | "comp" | "tune" | "harm" | "voc" | "fx";

export const MODULES: ReadonlyArray<{ id: ModuleId; name: string; short: string; power: string; blurb: string }> = [
  { id: "input", name: "Input", short: "Input", power: "monitor", blurb: "Mic or file in, with level and monitoring." },
  { id: "gate", name: "Gate", short: "Gate", power: "gateOn", blurb: "Silences the mic between phrases." },
  { id: "comp", name: "Compressor", short: "Comp", power: "compOn", blurb: "Evens out loud and quiet words." },
  { id: "tune", name: "Auto-tune", short: "Tune", power: "tuneOn", blurb: "Snaps your voice to the project key." },
  { id: "harm", name: "Harmoniser", short: "Harmony", power: "harmOn", blurb: "Up to three extra voices at set intervals." },
  { id: "voc", name: "Vocoder", short: "Vocoder", power: "vocOn", blurb: "Turns your voice into a playable synth." },
  { id: "fx", name: "Effects", short: "FX", power: "fxOn", blurb: "Delay, reverb and space modulation." },
];

/** The processing chain as routing keys: the key selects a stage for editing, the LED key beside it bypasses it. */
export function SignalChain({
  instrument,
  selected,
  onSelect,
}: {
  instrument: Instrument;
  selected: ModuleId;
  onSelect: (id: ModuleId) => void;
}) {
  return (
    <div className="chain-block">
      <div className="hw-title" style={{ marginBottom: 10 }}>
        Signal chain <em>in to out · select a stage, press its LED to bypass</em>
      </div>
      <div className="chain" role="list">
        {MODULES.map((m) => {
          const on = instrument.getParam(m.power) === 1;
          return (
            <div className="chain-item" role="listitem" key={m.id}>
              <div className={`chain-cell ${on ? "" : "off"}`}>
                <button type="button" className={`hw-key chain-main ${selected === m.id ? "on" : ""}`} aria-pressed={selected === m.id} aria-label={m.name} onClick={() => onSelect(m.id)}>
                  {m.short}
                </button>
                <button
                  type="button"
                  className={`hw-key led chain-power ${on ? "on" : ""}`}
                  role="switch"
                  aria-checked={on}
                  aria-label={`Switch ${m.name} on or off`}
                  onClick={() => instrument.setParam(m.power, on ? 0 : 1)}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
