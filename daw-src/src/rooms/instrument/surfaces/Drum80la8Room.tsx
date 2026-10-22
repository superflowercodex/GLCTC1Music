import { useCallback, useRef, useState, type CSSProperties } from "react";
import { Drum80la8, STEPS_80LA8 } from "../../../audio/instruments/drum80la8";
import { PATTERN_NAMES } from "../../../audio/instruments/drums/drumBase";
import { VOICES_80LA8 } from "../../../audio/instruments/drums/voices80la8";
import type { Instrument } from "../../../audio/types";
import { Button, Pad, Seg, Slider } from "../../../ui/controls";
import { useInstrument } from "../../../ui/hooks";
import { tapTempo } from "../../../audio/transport";
import { InstrumentShell } from "../InstrumentShell";
import { StepGrid } from "../drums/StepGrid";
import { VoicePanel } from "../drums/VoicePanel";
import { useBounce } from "../drums/useBounce";
import { useSampleSlot } from "../drums/useSampleSlot";
import "../drums/drums.css";

type Tab = "seq" | "pads" | "sounds";

const create = (ctx: BaseAudioContext) => new Drum80la8(ctx);
const BOUNCE_LABELS = ["1", "2", "4", "8"] as const;
const rowsFor = (d: Drum80la8) =>
  VOICES_80LA8.map((v, i) => ({
    key: v.id,
    label: v.name,
    color: v.color,
    selected: i === d.selectedVoice,
    dim: d.getParam(`v${i}.mute`) === 1,
    onSelect: () => d.selectVoice(i),
  }));
const playhead = (step: number) => ({ col: step % STEPS_80LA8 });

function SoundRow({ d, voice }: { d: Drum80la8; voice: number }) {
  const s = useSampleSlot(d, voice);
  const v = VOICES_80LA8[voice];
  const ref = d.sampleRef(voice);
  return (
    <div className={`sg-row ${s.over ? "over" : ""}`} style={{ "--c": v.color, gridTemplateColumns: "1fr auto" } as CSSProperties} {...s.dropProps}>
      <button type="button" className={`sg-label ${voice === d.selectedVoice ? "sel" : ""}`} onClick={() => d.selectVoice(voice)}>
        <span className="sg-dot" />
        <span className="sg-name">{v.name}</span>
        <span style={{ color: "var(--muted)", fontWeight: 500 }}>{s.busy ? "Loading…" : ref ? ref.name : "Synth"}</span>
      </button>
      <div className="drum-tools">
        <button type="button" className="drum-tool" onClick={s.choose} disabled={s.busy}>
          {ref ? "Replace" : "Load sample"}
        </button>
        {ref && (
          <button type="button" className="drum-tool" onClick={s.clear}>
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

export default function Drum80la8Room({ instrument }: { instrument: Instrument }) {
  const d = instrument as Drum80la8;
  useInstrument(d);
  const [tab, setTab] = useState<Tab>("seq");
  const [picked, setPicked] = useState<{ v: number; c: number } | null>(null);
  const [hits, setHits] = useState(4);
  const bars = useCallback(() => d.bounceBars, [d]);
  const bounce = useBounce(d, create, "80LA8", bars);
  const pressed = useRef(false);

  const voice = d.selectedVoice;
  const def = VOICES_80LA8[voice];
  const pickedVel = picked ? d.stepVelocity(picked.v, picked.c) : 0;

  return (
    <InstrumentShell
      instrument={instrument}
      title="80LA8"
      tagline="Drum machine with live tap pads"
      onBounce={() => void bounce.run()}
      bounceBusy={bounce.busy}
      footerExtra={<Button onClick={tapTempo}>Tap tempo</Button>}
      rightPanel={
        <VoicePanel
          instrument={d}
          voice={voice}
          slot={voice}
          name={def.name}
          color={def.color}
          subtitle={`Sound ${String(voice + 1).padStart(2, "0")} · ${d.sampleRef(voice) ? "sample" : "synth"}`}
          keys={["tune", "decay", "tone", "level", "pan", "drive", "delay", "reverb"]}
          swapLabel="Swap sound"
          before={
            tab !== "seq" ? undefined : picked && pickedVel > 0 ? (
              <Slider label={`${VOICES_80LA8[picked.v].name} step ${picked.c + 1} velocity`} value={pickedVel} min={0.05} max={1} step={0.01} onChange={(x) => d.setStep(picked.v, picked.c, x)} format={(x) => `${Math.round(x * 100)}%`} />
            ) : (
              <p className="drum-note">Tap a step to switch it on, then set how hard it hits here.</p>
            )
          }
        />
      }
    >
      <div className="drum">
        <div className="drum-bar">
          <Seg
            label="View"
            value={tab}
            onChange={setTab}
            options={[
              { value: "seq" as Tab, label: "Sequence" },
              { value: "pads" as Tab, label: "Pads" },
              { value: "sounds" as Tab, label: "Sounds" },
            ]}
          />
          <span className="drum-spacer" />
          {PATTERN_NAMES.map((n, i) => (
            <button key={n} type="button" className={`drum-chip ${d.editPattern === i ? "on" : ""}`} aria-pressed={d.editPattern === i} aria-label={`Pattern ${n}`} onClick={() => d.setPattern(i)}>
              {n}
            </button>
          ))}
        </div>

        {tab === "seq" && (
          <>
            <StepGrid
              rows={rowsFor(d)}
              cols={STEPS_80LA8}
              label="Step sequencer"
              labelWidth={122}
              numbers
              getCell={(r, c) => {
                const v = d.stepVelocity(r, c);
                return { state: v > 0 ? 1 : 0, level: v };
              }}
              onCell={(r, c) => {
                d.selectVoice(r);
                const on = d.toggleStep(r, c) > 0;
                setPicked(on ? { v: r, c } : null);
              }}
              playhead={playhead}
            />
            <div className="drum-tools">
              <div className="drum-stepper" role="group" aria-label="Euclid hits">
                <button type="button" aria-label="Fewer hits" onClick={() => setHits(Math.max(1, hits - 1))}>
                  −
                </button>
                <span>{hits} hits</span>
                <button type="button" aria-label="More hits" onClick={() => setHits(Math.min(16, hits + 1))}>
                  +
                </button>
              </div>
              <button type="button" className="drum-tool" onClick={() => d.applyTool("euclid", voice, hits)}>
                Euclid
              </button>
              <button type="button" className="drum-tool" aria-label="Shift this sound one step earlier" onClick={() => d.applyTool("left", voice)}>
                ◀
              </button>
              <button type="button" className="drum-tool" aria-label="Shift this sound one step later" onClick={() => d.applyTool("right", voice)}>
                ▶
              </button>
              <button type="button" className="drum-tool" onClick={() => d.randomize()}>
                Random
              </button>
              <button type="button" className="drum-tool" onClick={() => d.clearPattern()}>
                Clear
              </button>
            </div>
            <div className="drum-bar">
              <div style={{ width: 210 }}>
                <Slider label="Swing" value={d.getParam("swing")} min={0} max={0.6} step={0.01} onChange={(x) => d.setParam("swing", x)} format={(x) => `${Math.round(x * 100)}%`} />
              </div>
              <span className="drum-spacer" />
              <span className="label">Bounce</span>
              {BOUNCE_LABELS.map((b, i) => (
                <button key={b} type="button" className={`drum-chip ${d.getParam("bounceBars") === i ? "on" : ""}`} aria-pressed={d.getParam("bounceBars") === i} aria-label={`Bounce ${b} bars`} onClick={() => d.setParam("bounceBars", i)}>
                  {b}
                </button>
              ))}
            </div>
          </>
        )}

        {tab === "pads" && (
          <div className="drum-pads" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gridTemplateRows: "repeat(3, minmax(0, 1fr))" }}>
            {VOICES_80LA8.map((v, i) => (
              <Pad
                key={v.id}
                name={v.name}
                keyLabel={String(i + 1).padStart(2, "0")}
                color={v.color}
                selected={i === voice}
                onPress={() => {
                  pressed.current = true;
                  d.hitVoice(i, 0.92);
                  d.selectVoice(i);
                }}
                onSelect={() => {
                  // Keyboard activation arrives as a click with no pointer press before it.
                  if (!pressed.current) d.hitVoice(i, 0.92);
                  pressed.current = false;
                  d.selectVoice(i);
                }}
              />
            ))}
          </div>
        )}

        {tab === "sounds" && (
          <>
            <div className="sg-rows" style={{ gridTemplateRows: `repeat(${VOICES_80LA8.length}, minmax(0, 1fr))`, flex: 1, minHeight: 0, display: "grid" }}>
              {VOICES_80LA8.map((_, i) => (
                <SoundRow key={i} d={d} voice={i} />
              ))}
            </div>
            <p className="drum-note">Drop an audio file on a sound, or load one. It plays instead of the synth and is saved with the project.</p>
          </>
        )}
      </div>
    </InstrumentShell>
  );
}
