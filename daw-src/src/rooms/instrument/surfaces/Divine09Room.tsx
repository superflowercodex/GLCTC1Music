import { useCallback, useState } from "react";
import { Divine09, LENGTHS } from "../../../audio/instruments/divine09";
import { PATTERN_NAMES } from "../../../audio/instruments/drums/drumBase";
import { KITS_DIVINE, PROFILE_CHOICES, SYNTH_VOICES, VOICES_DIVINE } from "../../../audio/instruments/drums/voicesDivine";
import type { Instrument } from "../../../audio/types";
import { Seg, Switch } from "../../../ui/controls";
import { useInstrument } from "../../../ui/hooks";
import { InstrumentShell } from "../InstrumentShell";
import { ParamControl } from "../drums/ParamControl";
import { SampleChip } from "../drums/SampleSlot";
import { StepGrid } from "../drums/StepGrid";
import { VoicePanel } from "../drums/VoicePanel";
import { useBounce } from "../drums/useBounce";
import "../drums/drums.css";

const create = (ctx: BaseAudioContext) => new Divine09(ctx);
const SYNTH_KEYS = ["tune", "decay", "tone", "punch", "level", "pan", "delay", "reverb"] as const;
const SAMPLE_KEYS = ["tune", "tone", "level", "pan", "delay", "reverb"] as const;

type Side = "voice" | "master";

export default function Divine09Room({ instrument }: { instrument: Instrument }) {
  const d = instrument as Divine09;
  useInstrument(d);
  const [page, setPage] = useState(0);
  const [side, setSide] = useState<Side>("voice");
  const [hits, setHits] = useState(4);
  const [accent, setAccent] = useState(false);
  const length = d.length;
  const pages = length / 16;
  const shownPage = Math.min(page, pages - 1);
  const voice = d.selectedVoice;
  const isSynth = voice < SYNTH_VOICES;
  const bars = useCallback(() => d.length / 16, [d]);
  const bounce = useBounce(d, create, "Divine09", bars);
  const profile = isSynth ? d.getParam(`v${voice}.profile`) : 0;

  const rows = VOICES_DIVINE.map((v, i) => ({
    key: v.name,
    label: v.name,
    color: v.color,
    selected: i === voice,
    dim: d.getParam(`v${i}.mute`) === 1,
    onSelect: () => d.selectVoice(i),
  }));

  const sample = isSynth ? null : d.sampleRef(voice - SYNTH_VOICES);
  const sound = (
    <VoicePanel
      instrument={d}
      voice={voice}
      slot={isSynth ? null : voice - SYNTH_VOICES}
      name={VOICES_DIVINE[voice].name}
      color={VOICES_DIVINE[voice].color}
      subtitle={isSynth ? `Voice ${String(voice + 1).padStart(2, "0")} · ${PROFILE_CHOICES[profile].label} profile` : `Voice ${String(voice + 1).padStart(2, "0")} · ${sample ? sample.name : "no sample yet"}`}
      keys={isSynth ? SYNTH_KEYS : SAMPLE_KEYS}
      swapLabel={sample ? "Replace sample" : "Load a sample"}
      before={
        isSynth ? (
          <div>
            <div className="vp-section">Profile</div>
            <div className="vp-chips">
              {PROFILE_CHOICES.map((c, i) => (
                <button key={c.id} type="button" className={`chip ${profile === i ? "on" : ""}`} aria-pressed={profile === i} onClick={() => d.setParam(`v${voice}.profile`, i)}>
                  {c.label}
                </button>
              ))}
            </div>
          </div>
        ) : undefined
      }
      after={
        <div>
          <div className="vp-section">Your samples · saved with the project</div>
          <div className="smp-grid">
            {[0, 1, 2, 3].map((s) => (
              <SampleChip key={s} instrument={d} slot={s} label={`Sample ${s + 1}`} />
            ))}
          </div>
        </div>
      }
    />
  );

  const master = (
    <div className="vp">
      <div className="vp-head">
        <div>
          <div className="vp-title">Master</div>
          <div className="vp-sub">Kit and bus for all 15 voices</div>
        </div>
      </div>
      <div className="vp-body scroll-y">
        <div>
          <div className="vp-section">Kit</div>
          <div className="vp-chips">
            {KITS_DIVINE.map((k, i) => (
              <button key={k.id} type="button" className={`chip ${d.getParam("kit") === i ? "on" : ""}`} aria-pressed={d.getParam("kit") === i} onClick={() => d.setParam("kit", i)}>
                {k.name}
              </button>
            ))}
          </div>
        </div>
        {["swing", "level", "drive", "room", "hat", "crush", "filter"].map((id) => (
          <ParamControl key={id} instrument={d} id={id} />
        ))}
        <Switch label="Stutter (locked to the beat)" checked={d.getParam("stutter") === 1} onChange={(on) => d.setParam("stutter", on ? 1 : 0)} />
      </div>
    </div>
  );

  return (
    <InstrumentShell
      instrument={instrument}
      title="Divine09"
      tagline="909-inspired drums"
      onBounce={() => void bounce.run()}
      bounceBusy={bounce.busy}
      rightPanel={
        <div className="vp">
          <Seg label="Sound panel" value={side} onChange={setSide} options={[{ value: "voice" as Side, label: "Voice" }, { value: "master" as Side, label: "Master" }]} />
          {side === "voice" ? sound : master}
        </div>
      }
    >
      <div className="drum">
        <div className="drum-bar">
          {PATTERN_NAMES.map((n, i) => (
            <button key={n} type="button" className={`drum-chip ${d.editPattern === i ? "on" : ""}`} aria-pressed={d.editPattern === i} aria-label={`Pattern ${n}`} onClick={() => d.setPattern(i)}>
              {n}
            </button>
          ))}
          <span className="drum-spacer" />
          {LENGTHS.map((n, i) => (
            <button key={n} type="button" className={`drum-chip wide ${d.getParam("length") === i ? "on" : ""}`} aria-pressed={d.getParam("length") === i} onClick={() => d.setParam("length", i)}>
              {n}
            </button>
          ))}
        </div>

        <div className="drum-tools">
          <div className="drum-stepper" role="group" aria-label="Euclid hits">
            <button type="button" aria-label="Fewer hits" onClick={() => setHits(Math.max(1, hits - 1))}>
              −
            </button>
            <span>{hits}</span>
            <button type="button" aria-label="More hits" onClick={() => setHits(Math.min(length, hits + 1))}>
              +
            </button>
          </div>
          <button type="button" className="drum-tool" onClick={() => d.applyTool("euclid", voice, hits)}>
            Euclid
          </button>
          <button type="button" className="drum-tool" onClick={() => d.applyTool("half", voice)}>
            Half
          </button>
          <button type="button" className="drum-tool" onClick={() => d.applyTool("double", voice)}>
            Double
          </button>
          <button type="button" className="drum-tool" onClick={() => d.applyTool("reverse", voice)}>
            Reverse
          </button>
          <button type="button" className="drum-tool" aria-label="Shift this voice one step earlier" onClick={() => d.applyTool("left", voice)}>
            ◀
          </button>
          <button type="button" className="drum-tool" aria-label="Shift this voice one step later" onClick={() => d.applyTool("right", voice)}>
            ▶
          </button>
          <button type="button" className="drum-tool" onClick={() => d.randomize()}>
            Random
          </button>
          <button type="button" className="drum-tool" onClick={() => d.clearPattern()}>
            Clear
          </button>
          <button type="button" className={`drum-tool ${accent ? "on" : ""}`} aria-pressed={accent} title="Taps place loud accent steps. Shift-click does the same." onClick={() => setAccent(!accent)}>
            Accent
          </button>
          {pages > 1 && (
            <>
              <span className="label" style={{ marginLeft: 6 }}>
                Page
              </span>
              {Array.from({ length: pages }, (_, p) => (
                <button key={p} type="button" className={`drum-chip wide mono ${shownPage === p ? "on" : ""}`} style={{ padding: "0 10px" }} aria-pressed={shownPage === p} aria-label={`Page ${p + 1}, steps ${p * 16 + 1} to ${p * 16 + 16}`} onClick={() => setPage(p)}>
                  {p + 1}
                </button>
              ))}
            </>
          )}
        </div>

        <StepGrid
          rows={rows}
          cols={16}
          label={`Step sequencer, steps ${shownPage * 16 + 1} to ${shownPage * 16 + 16}`}
          labelWidth={122}
          getCell={(r, c) => ({ state: d.stepValue(r, shownPage * 16 + c) as 0 | 1 | 2 })}
          onCell={(r, c, e) => {
            d.selectVoice(r);
            d.tapStep(r, shownPage * 16 + c, accent || e.shiftKey);
          }}
          playhead={(step) => {
            const ix = step % length;
            return Math.floor(ix / 16) === shownPage ? { col: ix % 16 } : null;
          }}
        />
      </div>
    </InstrumentShell>
  );
}
