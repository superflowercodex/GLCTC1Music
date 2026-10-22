import { useRef, useState, type CSSProperties } from "react";
import { ARP_MODES } from "../../../audio/instruments/synth/arp";
import { GalacticOne, type GeneratorName } from "../../../audio/instruments/galacticOne";
import { BANK_COUNT, patchGroup } from "../../../audio/instruments/synth/galacticParams";
import { degreeOfOffset, offsetOfDegree, type GStep } from "../../../audio/instruments/synth/patternGen";
import { NOTE_NAMES, SCALE_NAMES, noteName } from "../../../audio/instruments/synth/scales";
import type { Instrument } from "../../../audio/types";
import { Button, Ring, Seg, Switch } from "../../../ui/controls";
import { useInstrument } from "../../../ui/hooks";
import { InstrumentShell } from "../InstrumentShell";
import { BAR_CHOICES, bounceToTrack } from "../synth/bounceToTrack";
import { ParamControl, ParamSlider } from "../synth/ParamControls";
import { LOWER_ROW, UPPER_ROW, useComputerKeys, useMidiInput } from "../synth/inputs";
import { lightKey, PianoKeys } from "../synth/PianoKeys";
import { PlayheadBand } from "../synth/PlayheadBand";
import { PresetFileButtons } from "../synth/PresetFileButtons";
import { Wheel } from "../synth/Wheel";
import "../synth/synth.css";

type View = "seq" | "keys" | "arp";
const ROWS = 8;
const COLS = 16;
const MACROS = [
  ["macro.bright", "Bright"],
  ["macro.motion", "Movement"],
  ["macro.space", "Space"],
  ["macro.grit", "Grit"],
] as const;
const SECTIONS = ["Oscillators", "Filter", "Envelopes", "Movement"] as const;
const TOOLS: readonly { id: string; label: string }[] = [
  { id: "random", label: "Random" },
  { id: "acid", label: "Acid line" },
  { id: "arp", label: "Arp line" },
  { id: "bounce", label: "Bounce" },
  { id: "trance", label: "Trance" },
  { id: "euclid3", label: "Euclid · 3 hits" },
  { id: "euclid5", label: "Euclid · 5 hits" },
  { id: "euclid7", label: "Euclid · 7 hits" },
  { id: "mutate", label: "Mutate" },
  { id: "humanize", label: "Humanise velocities" },
  { id: "quantize", label: "Snap notes to scale" },
  { id: "shiftLeft", label: "Shift left" },
  { id: "shiftRight", label: "Shift right" },
  { id: "reverse", label: "Reverse" },
  { id: "up", label: "Up an octave" },
  { id: "down", label: "Down an octave" },
  { id: "clear", label: "Clear" },
];
const GENERATOR_TOOLS = new Set<string>(["random", "acid", "arp", "bounce", "trance", "clear"]);

function asGo(instrument: Instrument): GalacticOne {
  if (!(instrument instanceof GalacticOne)) throw new TypeError("The Galactic One room needs a Galactic One instrument.");
  return instrument;
}

export default function GalacticOneRoom({ instrument }: { instrument: Instrument }) {
  const synth = asGo(instrument);
  useInstrument(synth);
  const [busy, setBusy] = useState(false);
  const bars = BAR_CHOICES[Math.round(synth.getParam("seq.bars"))];

  const onBounce = async () => {
    setBusy(true);
    await bounceToTrack({ instrument: synth, create: (ctx) => new GalacticOne(ctx), name: "Galactic One", color: "#79ebff", bars });
    setBusy(false);
  };

  return (
    <InstrumentShell
      instrument={synth}
      title="Galactic One"
      tagline="Workstation synth"
      rightPanel={<SoundPanel synth={synth} />}
      onBounce={() => void onBounce()}
      bounceBusy={busy}
      footerExtra={
        <select className="sy-select inline" aria-label="Bounce length" value={bars} onChange={(e) => synth.setParam("seq.bars", BAR_CHOICES.indexOf(Number(e.target.value) as (typeof BAR_CHOICES)[number]))}>
          {BAR_CHOICES.map((b) => (
            <option key={b} value={b}>
              {b} {b === 1 ? "bar" : "bars"}
            </option>
          ))}
        </select>
      }
    >
      <Surface synth={synth} />
    </InstrumentShell>
  );
}

// ---------- right-hand panel ----------

function SoundPanel({ synth }: { synth: GalacticOne }) {
  useInstrument(synth);
  const [edit, setEdit] = useState<0 | 1>(0);
  const [open, setOpen] = useState<string | null>("Oscillators");
  const letter = edit === 0 ? "a" : "b";
  const sections = [...SECTIONS.map((s) => ({ key: s, group: patchGroup(letter, s) })), { key: "Effects", group: "Effects" }];

  return (
    <div className="sy-panel sy-cyan">
      <Seg label="Keys play" value={Math.round(synth.getParam("key.mode"))} onChange={(v) => synth.setParam("key.mode", v)} options={["Whole", "Split", "Dual"].map((label, value) => ({ value, label }))} className="go-wide" />
      <Seg
        label="Patch being edited"
        value={edit}
        onChange={setEdit}
        options={[
          { value: 0 as const, label: `A · ${synth.patchName(0)}` },
          { value: 1 as const, label: `B · ${synth.patchName(1)}` },
        ]}
        className="go-wide go-patches"
      />
      <div className="go-macros">
        {MACROS.map(([id, label]) => (
          <Ring key={id} label={label} value={synth.getParam(id) * 100} min={0} max={100} onChange={(v) => synth.setParam(id, v / 100)} />
        ))}
      </div>
      <div className="sy-params scroll-y">
        {sections.map(({ key, group }) => {
          const isOpen = open === key;
          const defs = synth.params.filter((p) => p.group === group);
          return (
            <div className="group" key={key}>
              <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : key)}>
                <span>{key}</span>
                <span className="eyebrow">{defs.length}</span>
              </button>
              {isOpen && (
                <div className="group-body">
                  {defs.map((def) => (
                    <ParamControl key={def.id} instrument={synth} def={def} />
                  ))}
                  {key === "Oscillators" && <PatchTools synth={synth} patch={edit} />}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="sy-foot">
        <PresetFileButtons instrument={synth} />
      </div>
    </div>
  );
}

function PatchTools({ synth, patch }: { synth: GalacticOne; patch: 0 | 1 }) {
  return (
    <div className="go-tools">
      <Button onClick={() => synth.copyPatch(patch, patch === 0 ? 1 : 0)}>Copy to {patch === 0 ? "B" : "A"}</Button>
      <Button onClick={() => synth.swapPatches()}>Swap A and B</Button>
      <Button onClick={() => synth.initPatch(patch)}>Init patch</Button>
    </div>
  );
}

// ---------- play surface ----------

function Surface({ synth }: { synth: GalacticOne }) {
  useInstrument(synth);
  const [view, setView] = useState<View>("seq");
  const bank = synth.activePattern ?? 0;
  const pattern = synth.getPattern(bank);
  const scale = Math.round(synth.getParam("seq.scale"));
  const lowerRoot = useRef<HTMLDivElement>(null);
  const upperRoot = useRef<HTMLDivElement>(null);
  const [octaves, setOctaves] = useState({ lower: 2, upper: 4 });

  const rootOf = (zone: "lower" | "upper") => (octaves[zone] + 1) * 12;
  const light = (zone: "lower" | "upper", midi: number, on: boolean) => lightKey(zone === "lower" ? lowerRoot.current : upperRoot.current, midi, on);

  useComputerKeys(
    [
      { layout: UPPER_ROW, base: rootOf("upper") },
      { layout: LOWER_ROW, base: rootOf("lower") },
    ],
    (midi, layer) => {
      const zone = layer === 0 ? "upper" : "lower";
      light(zone, midi, true);
      synth.keyOn(zone, midi, 0.85);
    },
    (midi, layer) => {
      const zone = layer === 0 ? "upper" : "lower";
      light(zone, midi, false);
      synth.keyOff(zone, midi);
    },
  );
  useMidiInput({
    noteOn: (midi, velocity) => synth.keyOn(null, midi, velocity),
    noteOff: (midi) => synth.keyOff(null, midi),
    bend: (v) => synth.setBend(v),
    modWheel: (v) => synth.setModWheel(v),
    sustain: (on) => synth.setParam("perf.hold", on ? 1 : 0),
  });

  const applyTool = (id: string) => {
    if (GENERATOR_TOOLS.has(id)) synth.generate(bank, id as GeneratorName);
    else if (id.startsWith("euclid")) synth.euclidFill(bank, Number(id.slice(6)));
    else if (id === "mutate") synth.mutateBank(bank);
    else synth.transformBank(bank, id as "shiftLeft" | "shiftRight" | "reverse" | "quantize" | "humanize" | "up" | "down");
  };

  return (
    <div className="go sy-cyan">
      <div className="go-top">
        <div className="go-top-row">
          <Seg label="View" value={view} onChange={setView} options={[{ value: "seq" as View, label: "Sequence" }, { value: "keys" as View, label: "Keys" }, { value: "arp" as View, label: "Arp" }]} />
          {view === "seq" && (
            <>
              <select className="sy-select inline key" aria-label="Key" value={Math.round(synth.getParam("seq.root"))} onChange={(e) => synth.setParam("seq.root", Number(e.target.value))}>
                {NOTE_NAMES.map((n, i) => (
                  <option key={n} value={i}>
                    {n}
                  </option>
                ))}
              </select>
              <select className="sy-select inline" aria-label="Scale" value={scale} onChange={(e) => synth.setParam("seq.scale", Number(e.target.value))}>
                {SCALE_NAMES.map((n, i) => (
                  <option key={n} value={i}>
                    {n}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>
        <div className="go-top-row">
          <div className="sy-chips go-banks" role="radiogroup" aria-label="Pattern bank">
            {Array.from({ length: BANK_COUNT }, (_, i) => (
              <button key={i} type="button" role="radio" aria-checked={synth.activePattern === i} className={`sy-square go-bank ${synth.activePattern === i ? "on" : ""}`} onClick={() => synth.setPattern(i)}>
                {i + 1}
              </button>
            ))}
            <button type="button" role="radio" aria-checked={synth.activePattern === null} className={`sy-pill ${synth.activePattern === null ? "on" : ""}`} onClick={() => synth.setPattern(null)} title="Stop the sequencer; the keys still play">
              Off
            </button>
          </div>
          {view === "seq" && (
            <>
              <select className="sy-select inline steps" aria-label="Steps in pattern" value={pattern.len} onChange={(e) => synth.setLength(bank, Number(e.target.value))}>
                {[4, 8, 16, 32].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
              <select className="sy-select inline tools" aria-label="Pattern tools" value="" onChange={(e) => e.target.value && applyTool(e.target.value)}>
                <option value="">Tools…</option>
                {TOOLS.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>
      </div>

      {view === "seq" && <SequenceView synth={synth} bank={bank} scale={scale} />}
      {view === "keys" && (
        <div className="go-keys">
          <div className="go-keys-main">
            <div className="go-wheels">
              <Wheel label="Pitch" spring color="rgba(121,235,255,.6)" onChange={(v) => synth.setBend(v)} />
              <Wheel label="Mod" spring={false} color="rgba(255,99,216,.6)" onChange={(v) => synth.setModWheel(v)} />
            </div>
            <div className="go-boards">
              <Board
                title="Patch B"
                subtitle={`Upper half · from ${noteName(rootOf("upper"), true)}`}
                color="#ff63d8"
                octave={octaves.upper}
                onOctave={(o) => setOctaves((x) => ({ ...x, upper: o }))}
                rootRef={upperRoot}
                start={rootOf("upper")}
                onDown={(m, v) => synth.keyOn("upper", m, v)}
                onUp={(m) => synth.keyOff("upper", m)}
              />
              <Board
                title="Patch A"
                subtitle={`Lower half · from ${noteName(rootOf("lower"), true)}`}
                color="#79ebff"
                octave={octaves.lower}
                onOctave={(o) => setOctaves((x) => ({ ...x, lower: o }))}
                rootRef={lowerRoot}
                start={rootOf("lower")}
                onDown={(m, v) => synth.keyOn("lower", m, v)}
                onUp={(m) => synth.keyOff("lower", m)}
              />
            </div>
          </div>
          <div className="go-keys-foot">
            <span className="sy-label" style={{ color: "var(--text)", fontSize: 16 }}>
              Keys play
            </span>
            <Seg label="Keys play" value={Math.round(synth.getParam("key.mode"))} onChange={(v) => synth.setParam("key.mode", v)} options={["Split", "Whole", "Dual"].map((label) => ({ value: ["Whole", "Split", "Dual"].indexOf(label), label }))} />
            <span className="spacer" />
            <Button variant={synth.getParam("perf.hold") === 1 ? "primary" : "ghost"} onClick={() => synth.setParam("perf.hold", synth.getParam("perf.hold") === 1 ? 0 : 1)}>
              Hold
            </Button>
            <Button onClick={() => synth.allNotesOff()}>Panic</Button>
          </div>
          <span className="eyebrow">Your computer keyboard (Q and Z rows) and any MIDI keyboard work too</span>
        </div>
      )}
      {view === "arp" && <ArpView synth={synth} />}
    </div>
  );
}

function Board({ title, subtitle, color, octave, onOctave, rootRef, start, onDown, onUp }: { title: string; subtitle: string; color: string; octave: number; onOctave: (o: number) => void; rootRef: React.RefObject<HTMLDivElement>; start: number; onDown: (m: number, v: number) => void; onUp: (m: number) => void }) {
  return (
    <div>
      <div className="go-board-head">
        <span style={{ fontWeight: 700 }}>{title}</span>
        <span className="eyebrow">{subtitle}</span>
        <span className="spacer" />
        <button type="button" className="icon-btn" aria-label={`${title} octave down`} onClick={() => onOctave(Math.max(0, octave - 1))}>
          −
        </button>
        <button type="button" className="icon-btn" aria-label={`${title} octave up`} onClick={() => onOctave(Math.min(6, octave + 1))}>
          +
        </button>
      </div>
      <div ref={rootRef}>
        <PianoKeys start={start} whites={15} height={104} color={color} label={`${title} keyboard`} onDown={onDown} onUp={onUp} />
      </div>
    </div>
  );
}

function SequenceView({ synth, bank, scale }: { synth: GalacticOne; bank: number; scale: number }) {
  const pattern = synth.getPattern(bank);
  const [page, setPage] = useState(0);
  const [sel, setSel] = useState(0);
  const root = Math.round(synth.getParam("seq.root"));
  const pages = pattern.len > COLS ? pattern.len / COLS : 1;
  const shownPage = Math.min(page, pages - 1);
  const offset = shownPage * COLS;
  const index = Math.min(sel, pattern.len - 1);
  const step = pattern.steps[index];
  const chain = synth.getChain();

  const labels = Array.from({ length: ROWS }, (_, r) => noteName(root + offsetOfDegree(ROWS - 1 - r, scale)));

  const onCell = (col: number, degree: number, shift: boolean) => {
    const i = offset + col;
    if (i >= pattern.len) return;
    setSel(i);
    const st = pattern.steps[i];
    if (shift) {
      if (st.on) synth.updateStep(bank, i, { accent: !st.accent });
      return;
    }
    const same = st.on && degreeOfOffset(st.n, scale) === degree;
    if (same) synth.updateStep(bank, i, { on: false });
    else {
      const n = offsetOfDegree(degree, scale);
      synth.updateStep(bank, i, { on: true, n });
      synth.noteOn({ note: (Math.round(synth.getParam("seq.octave")) + 1) * 12 + root + n, velocity: 0.8, duration: 0.18 });
    }
  };

  return (
    <>
      {pages > 1 && (
        <div className="sy-chips" role="radiogroup" aria-label="Page">
          {Array.from({ length: pages }, (_, p) => (
            <button key={p} type="button" role="radio" aria-checked={shownPage === p} className={`sy-pill ${shownPage === p ? "on" : ""}`} onClick={() => setPage(p)}>
              Steps {p * COLS + 1}–{(p + 1) * COLS}
            </button>
          ))}
        </div>
      )}
      <div className="go-grid">
        <div className="go-rows" aria-hidden="true">
          {labels.map((l, r) => (
            <span key={r}>{l}</span>
          ))}
        </div>
        <div className="go-cells">
          {Array.from({ length: ROWS }, (_, r) => {
            const degree = ROWS - 1 - r;
            return (
              <div className="go-row" key={degree}>
                {Array.from({ length: COLS }, (_, c) => {
                  const i = offset + c;
                  const st = pattern.steps[i];
                  const inside = i < pattern.len;
                  const on = inside && st.on && degreeOfOffset(st.n, scale) === degree;
                  return (
                    <button
                      key={c}
                      type="button"
                      aria-label={`Step ${i + 1} note ${labels[r]}`}
                      aria-pressed={on}
                      disabled={!inside}
                      className={`go-cell ${on ? "on" : ""} ${on && st.accent ? "acc" : ""} ${Math.floor(c / 4) % 2 ? "alt" : ""} ${i === index ? "sel" : ""}`}
                      onClick={(e) => onCell(c, degree, e.shiftKey)}
                    />
                  );
                })}
              </div>
            );
          })}
          <PlayheadBand
            columns={COLS}
            gap={4}
            read={() => {
              const ph = synth.playhead();
              if (!ph || Math.floor(ph.a / 100) !== bank) return -1;
              const col = (ph.a % 100) - offset;
              return col >= 0 && col < COLS ? col : -1;
            }}
          />
        </div>
      </div>

      <StepDetail synth={synth} bank={bank} index={index} step={step} />

      <div className="go-chain">
        <span className="sy-label">Song chain</span>
        <button type="button" role="switch" aria-checked={synth.getParam("seq.chain") === 1} className={`sy-pill ${synth.getParam("seq.chain") === 1 ? "on" : ""}`} onClick={() => synth.setParam("seq.chain", synth.getParam("seq.chain") === 1 ? 0 : 1)}>
          {synth.getParam("seq.chain") === 1 ? "On" : "Off"}
        </button>
        {chain.map((b, i) => (
          <span className={`go-chain-item ${i === 0 ? "first" : ""}`} key={i}>
            <button type="button" className="go-chain-step" title="Remove from the chain" aria-label={`Remove bank ${b + 1} at position ${i + 1}`} onClick={() => synth.setChain(chain.filter((_, k) => k !== i))}>
              {b + 1}
            </button>
            {i < chain.length - 1 && <span className="eyebrow">→</span>}
          </span>
        ))}
        <button type="button" className="go-chain-add" aria-label={`Add bank ${bank + 1} to the chain`} disabled={chain.length >= 16} onClick={() => synth.setChain([...chain, bank])}>
          +
        </button>
      </div>
    </>
  );
}

function StepDetail({ synth, bank, index, step }: { synth: GalacticOne; bank: number; index: number; step: GStep }) {
  const set = (change: Partial<GStep>) => synth.updateStep(bank, index, change);
  return (
    <div className="go-detail">
      <div>
        <div className="eyebrow">Step</div>
        <div className="mono go-stepno">{String(index + 1).padStart(2, "0")}</div>
      </div>
      <MiniRange label="Chance" text={`${Math.round(step.p * 100)}%`} min={0} max={1} step={0.05} value={step.p} onChange={(v) => set({ p: v })} />
      <MiniRange label="Ratchet" text={`${step.r}×`} min={1} max={4} step={1} value={step.r} onChange={(v) => set({ r: v })} />
      <MiniRange label="Length" text={`${Math.round(step.g * 100)}%`} min={0.1} max={1.05} step={0.05} value={step.g} onChange={(v) => set({ g: v })} />
      <span className="go-detail-break" />
      <MiniRange label="Filter jump" text={`${step.c > 0 ? "+" : ""}${Math.round(step.c * 100)}%`} min={-1} max={1} step={0.05} value={step.c} onChange={(v) => set({ c: v })} />
      <button type="button" className={`sy-pill ${step.slide ? "on" : ""}`} role="switch" aria-checked={step.slide} onClick={() => set({ slide: !step.slide })}>
        Slide {step.slide ? "on" : "off"}
      </button>
      <button type="button" className={`sy-pill ${step.accent ? "on" : ""}`} role="switch" aria-checked={step.accent} onClick={() => set({ accent: !step.accent })}>
        Accent {step.accent ? "on" : "off"}
      </button>
    </div>
  );
}

function MiniRange({ label, text, min, max, step, value, onChange }: { label: string; text: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void }) {
  return (
    <label className="go-prop">
      <span className="go-prop-head">
        <span>{label}</span>
        <span className="mono">{text}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} style={{ "--pct": `${((value - min) / (max - min)) * 100}%` } as CSSProperties} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

function ArpView({ synth }: { synth: GalacticOne }) {
  const arpOn = Math.round(synth.getParam("seq.mode")) === 1;
  const find = (id: string) => {
    const def = synth.params.find((p) => p.id === id);
    if (!def) throw new RangeError(`Missing parameter ${id}`);
    return def;
  };
  return (
    <div className="go-arp">
      <Switch label="Arpeggiator" checked={arpOn} onChange={(on) => synth.setParam("seq.mode", on ? 1 : 0)} />
      <div>
        <div className="sy-label" style={{ marginBottom: 10 }}>
          Pattern
        </div>
        <div className="sy-chips" role="radiogroup" aria-label="Arp pattern">
          {ARP_MODES.map((m, i) => (
            <button key={m.id} type="button" role="radio" aria-checked={Math.round(synth.getParam("arp.mode")) === i} className={`sy-pill ${Math.round(synth.getParam("arp.mode")) === i ? "on" : ""}`} onClick={() => synth.setParam("arp.mode", i)}>
              {m.label}
            </button>
          ))}
        </div>
      </div>
      <div className="go-arp-sliders">
        <ParamSlider instrument={synth} def={find("seq.rate")} label="Rate" />
        <ParamSlider instrument={synth} def={find("arp.oct")} label="Range" />
        <ParamSlider instrument={synth} def={find("arp.gate")} label="Gate" />
        <ParamSlider instrument={synth} def={find("seq.swing")} label="Swing" />
      </div>
      <Switch label="Latch · keep playing after you let go" checked={synth.getParam("arp.latch") === 1} onChange={(on) => synth.setParam("arp.latch", on ? 1 : 0)} />
      <span className="eyebrow">{arpOn ? "Hold keys on the Keys view; the sequence steps set the rhythm." : "Turn it on, then hold keys to arpeggiate them."}</span>
    </div>
  );
}
