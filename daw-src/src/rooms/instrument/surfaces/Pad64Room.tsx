import { useCallback, useRef, useState } from "react";
import { peekEngine } from "../../../audio/engine";
import { PATTERN_NAMES } from "../../../audio/instruments/drums/drumBase";
import { notify } from "../../../audio/instruments/drums/notify";
import { PAD_COLORS, PAD_KINDS } from "../../../audio/instruments/drums/voicesPad";
import { PAD_COUNT, Pad64, SCENE_COUNT } from "../../../audio/instruments/pad64";
import type { Instrument } from "../../../audio/types";
import { Seg } from "../../../ui/controls";
import { PadButton } from "../../../ui/hardware";
import { useInstrument } from "../../../ui/hooks";
import { InstrumentShell } from "../InstrumentShell";
import { SampleDrop } from "../drums/SampleSlot";
import { StepGrid } from "../drums/StepGrid";
import { DrumLcd } from "../drums/DrumLcd";
import { VoicePanel } from "../drums/VoicePanel";
import { useBounce } from "../drums/useBounce";
import "../drums/drums.css";

const create = (ctx: BaseAudioContext) => new Pad64(ctx);
type Mode = "voices" | "samples";

export default function Pad64Room({ instrument }: { instrument: Instrument }) {
  const d = instrument as Pad64;
  useInstrument(d);
  const [mode, setMode] = useState<Mode>("voices");
  const [storing, setStoring] = useState(false);
  const [hits, setHits] = useState(5);
  const pressed = useRef(false);
  const bars = useCallback(() => d.bars, [d]);
  const bounce = useBounce(d, create, "PAD-64", bars);

  const sel = d.selectedVoice;
  const kind = d.getParam(`v${sel}.kind`);
  const loopBars = d.bars;
  const sample = d.sampleRef(sel);
  const laneRows = Array.from({ length: 4 }, (_, b) => ({ key: `bar${b}`, label: String(b * 16 + 1).padStart(2, "0"), color: PAD_COLORS[kind], dim: b >= loopBars }));

  const needPlaying = (): boolean => {
    if (peekEngine()?.clock.playing) return true;
    notify("Press play first: Drop and Build work on the running groove.");
    return false;
  };

  return (
    <InstrumentShell
      instrument={instrument}
      title="PAD-64"
      tagline="Pads and sequencer"
      onBounce={() => void bounce.run()}
      bounceBusy={bounce.busy}
      rightPanel={
        <VoicePanel
          instrument={d}
          voice={sel}
          slot={sel}
          name={sample ? sample.name : PAD_KINDS[kind]}
          color={PAD_COLORS[kind]}
          subtitle={`Pad ${String(sel + 1).padStart(2, "0")} · ${sample ? "sample" : "synth voice"}`}
          keys={["kind", "tune", "decay", "tone", "level", "pan"]}
          swapLabel={sample ? "Replace sample" : "Swap for a sample"}
        />
      }
    >
      <div className="drum">
        <div className="pads64">
          <div>
            <div className="drum-bar" style={{ marginBottom: 10 }}>
              <DrumLcd cells={[{ label: "PAD", value: String(sel + 1).padStart(2, "0") }, { label: "SCN", value: d.currentScene >= 0 ? d.sceneName(d.currentScene) : "-" }, { label: "BARS", value: String(loopBars) }]} />
              <Seg label="Pad type" value={mode} onChange={setMode} options={[{ value: "voices" as Mode, label: "Synth voices" }, { value: "samples" as Mode, label: "Samples" }]} />
              <span className="drum-spacer" />
              <div className="btn-group tools" role="group" aria-label="Performance">
                <button type="button" title="Break the groove for one beat, then hit everything" onClick={() => needPlaying() && d.drop()}>
                  Drop
                </button>
                <button type="button" title="Two bars of rising snare roll" onClick={() => needPlaying() && d.startBuild()}>
                  Build
                </button>
                <button type="button" className={d.chaining ? "on" : ""} aria-pressed={d.chaining} title="Move through the scenes, two bars each" onClick={() => d.setChain(!d.chaining)}>
                  Chain
                </button>
              </div>
            </div>
            <div className="scenes" role="group" aria-label="Scenes">
              {Array.from({ length: SCENE_COUNT }, (_, i) => (
                <button
                  key={i}
                  type="button"
                  className={`scene ${d.currentScene === i ? "on" : ""} ${d.queuedScene === i ? "queued" : ""}`}
                  aria-pressed={d.currentScene === i}
                  title={storing ? `Store the current pattern choices in scene ${i + 1}` : `Scene ${i + 1}: switches on the next bar`}
                  onClick={() => {
                    if (storing) {
                      d.storeScene(i);
                      setStoring(false);
                    } else d.recallScene(i, !peekEngine()?.clock.playing);
                  }}
                >
                  {d.sceneName(i)}
                </button>
              ))}
            </div>
          </div>

          <div className="pads64-pads" style={{ gridColumn: 1 }}>
            {Array.from({ length: PAD_COUNT }, (_, i) => {
              const ref = d.sampleRef(i);
              const k = d.getParam(`v${i}.kind`);
              return (
                <PadButton
                  key={i}
                  label={ref ? ref.name : PAD_KINDS[k]}
                  sub={String(i + 1).padStart(2, "0")}
                  color={PAD_COLORS[k]}
                  lit={!(mode === "samples" && !ref)}
                  selected={i === sel}
                  onPress={() => {
                    pressed.current = true;
                    d.hitVoice(i, 1);
                    d.selectVoice(i);
                  }}
                  onClick={() => {
                    if (!pressed.current) d.hitVoice(i, 1);
                    pressed.current = false;
                    d.selectVoice(i);
                  }}
                />
              );
            })}
          </div>

          {mode === "voices" ? (
            <div className="lanes">
              <div className="drum-tools">
                <div className="drum-grp">
                  <span className="hw-leg">Pattern</span>
                  <div className="btn-group sq" role="group" aria-label="Pad pattern">
                    {PATTERN_NAMES.map((n, i) => (
                      <button key={n} type="button" className={d.lanePattern(sel) === i ? "on" : ""} aria-pressed={d.lanePattern(sel) === i} aria-label={`Pad ${sel + 1} plays pattern ${n}`} onClick={() => d.setLanePattern(sel, i)}>
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="drum-stepper" role="group" aria-label="Euclid hits">
                  <button type="button" aria-label="Fewer hits" onClick={() => setHits(Math.max(1, hits - 1))}>
                    −
                  </button>
                  <span>{hits}</span>
                  <button type="button" aria-label="More hits" onClick={() => setHits(Math.min(16, hits + 1))}>
                    +
                  </button>
                </div>
                <div className="btn-group tools" role="group" aria-label="Pad tools">
                  <button type="button" onClick={() => d.applyTool("euclid", sel, hits)}>
                    Euclid
                  </button>
                  <button type="button" aria-label="Shift this pad one step earlier" onClick={() => d.applyTool("left", sel)}>
                    ◀
                  </button>
                  <button type="button" aria-label="Shift this pad one step later" onClick={() => d.applyTool("right", sel)}>
                    ▶
                  </button>
                  <button type="button" onClick={() => d.randomize(sel)}>
                    Random
                  </button>
                  <button type="button" onClick={() => d.applyTool("clear", sel)}>
                    Clear
                  </button>
                  <button type="button" className={storing ? "on" : ""} aria-pressed={storing} title="Then tap a scene to store which pattern each pad plays" onClick={() => setStoring(!storing)}>
                    Store scene
                  </button>
                </div>
              </div>
              <StepGrid
                rows={laneRows}
                cols={16}
                label={`Steps for pad ${sel + 1}`}
                labelWidth={34}
                getCell={(r, c) => ({ state: d.stepValue(sel, r * 16 + c) as 0 | 1 | 2 })}
                onCell={(r, c) => {
                  d.selectVoice(sel);
                  if (d.cycleStep(sel, r * 16 + c) > 0) d.hitVoice(sel, 0.74);
                }}
                playhead={(step) => {
                  const ix = step % d.loopSteps;
                  return { row: Math.floor(ix / 16), col: ix % 16 };
                }}
              />
              <p className="drum-note">Tap a step once for a hit, again for an accent, a third time to clear it.</p>
            </div>
          ) : (
            <SampleDrop instrument={d} slot={sel} title={`Pad ${sel + 1} has no sample`} hint="Drop an audio file here, choose one, or record from the microphone. It is saved with the project." />
          )}
        </div>
      </div>
    </InstrumentShell>
  );
}
