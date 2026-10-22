import { useRef, useState, type CSSProperties } from "react";
import { Lead0010110, LEAD_MAX_DEGREE, LEAD_STEPS } from "../../../audio/instruments/lead0010110";
import { NOTE_NAMES, SCALE_NAMES, scaleNote } from "../../../audio/instruments/synth/scales";
import type { Instrument } from "../../../audio/types";
import { putAssetBlob } from "../../../project/db";
import { newId } from "../../../project/model";
import { projectStore } from "../../../store/project";
import { Button } from "../../../ui/controls";
import { useInstrument } from "../../../ui/hooks";
import { InstrumentShell } from "../InstrumentShell";
import { BarsSelect } from "../synth/BarsSelect";
import { bounceToTrack } from "../synth/bounceToTrack";
import { levelDb } from "../synth/format";
import { PIANO_ROW, useComputerKeys, useMidiInput } from "../synth/inputs";
import { lightKey, PianoKeys } from "../synth/PianoKeys";
import { PlayheadBand } from "../synth/PlayheadBand";
import { SynthTabsPanel, type SynthTab } from "../synth/SynthTabsPanel";
import { messageOf, showToast } from "../synth/toast";
import "../synth/synth.css";

const WAVE_LABELS = ["Saw", "Square", "Triangle", "Sine"] as const;
const LAYER_COLORS = ["#ff63d8", "#8e7cff", "#ffb86b", "#79ebff"] as const;
const TABS: SynthTab[] = [
  { name: "Sound", groups: ["Sound", "Layers"] },
  { name: "Arp", groups: ["Arp", "Pattern"], hide: ["root", "scale", "loop"] },
  { name: "Effects", groups: ["Effects"] },
  { name: "Glitch", groups: ["Glitch"] },
];

function asLead(instrument: Instrument): Lead0010110 {
  if (!(instrument instanceof Lead0010110)) throw new TypeError("The 0010110 room needs a 0010110 instrument.");
  return instrument;
}

function shapeBars(wave: number): number[] {
  return Array.from({ length: 20 }, (_, i) => {
    const t = i / 19;
    if (wave === 0) return 6 + t * 16;
    if (wave === 1) return i % 10 < 5 ? 20 : 6;
    if (wave === 2) return 4 + (1 - Math.abs(t * 2 - 1)) * 18;
    return 4 + Math.abs(Math.sin(t * Math.PI * 2)) * 18;
  });
}

export default function Lead0010110Room({ instrument }: { instrument: Instrument }) {
  const synth = asLead(instrument);
  const [bars, setBars] = useState(2);
  const [busy, setBusy] = useState(false);

  const onBounce = async () => {
    setBusy(true);
    await bounceToTrack({ instrument: synth, create: (ctx) => withSample(new Lead0010110(ctx), synth), name: "0010110", color: "#ff63d8", bars });
    setBusy(false);
  };

  return (
    <InstrumentShell
      instrument={synth}
      title="0010110"
      tagline="Lead synth"
      rightPanel={<SynthTabsPanel instrument={synth} tabs={TABS} />}
      onBounce={() => void onBounce()}
      bounceBusy={busy}
      footerExtra={<BarsSelect bars={bars} onChange={setBars} />}
    >
      <Surface synth={synth} />
    </InstrumentShell>
  );
}

/** A bounce builds a second instrument; hand it the decoded sample so the render does not wait on storage. */
function withSample(copy: Lead0010110, live: Lead0010110): Lead0010110 {
  const buffer = live.sampleBuffer;
  const info = live.sampleInfo;
  if (buffer && info.assetId) copy.setSample(buffer, info.assetId, info.name);
  return copy;
}

function Surface({ synth }: { synth: Lead0010110 }) {
  useInstrument(synth);
  const [octave, setOctave] = useState(3);
  const keysRoot = useRef<HTMLDivElement>(null);
  const root = Math.round(synth.getParam("root"));
  const scale = Math.round(synth.getParam("scale"));
  const loop = synth.loopLength;
  const degrees = synth.getDegrees();
  const accents = synth.getAccents();
  const start = (octave + 1) * 12;

  const play = (midi: number, velocity: number) => synth.noteOn({ note: midi, velocity });
  const stop = (midi: number) => synth.noteOff(midi);
  const lit = (midi: number, on: boolean) => lightKey(keysRoot.current, midi, on);

  useComputerKeys(
    [{ layout: PIANO_ROW, base: start }],
    (midi) => {
      lit(midi, true);
      play(midi, 0.85);
    },
    (midi) => {
      lit(midi, false);
      stop(midi);
    },
  );
  useMidiInput({
    noteOn: (midi, velocity) => {
      lit(midi, true);
      play(midi, velocity);
    },
    noteOff: (midi) => {
      lit(midi, false);
      stop(midi);
    },
    sustain: (on) => synth.setParam("hold", on ? 1 : 0),
  });

  const pickDegree = (step: number, degree: number, shift: boolean) => {
    if (shift) {
      if (degrees[step] > 0) synth.toggleAccent(step);
      return;
    }
    synth.setDegree(step, degrees[step] === degree ? 0 : degree);
  };

  return (
    <div className="ld">
      <div className="ld-layers">
        {[1, 2, 3].map((n) => (
          <LayerCard key={n} synth={synth} n={n} />
        ))}
        <SampleCard synth={synth} />
      </div>

      <div className="ld-bar" role="group" aria-label="Pattern">
        <select className="sy-select inline key" aria-label="Key" value={root} onChange={(e) => synth.setParam("root", Number(e.target.value))}>
          {NOTE_NAMES.map((name, i) => (
            <option key={name} value={i}>
              {name}
            </option>
          ))}
        </select>
        <select className="sy-select inline" aria-label="Scale" value={scale} onChange={(e) => synth.setParam("scale", Number(e.target.value))}>
          {SCALE_NAMES.map((name, i) => (
            <option key={name} value={i}>
              {name}
            </option>
          ))}
        </select>
        <span className="spacer" />
        <Button onClick={() => synth.setParam("loop", (Math.round(synth.getParam("loop")) + 1) % 4)} title="Cycle the loop length">
          Loop {loop} steps
        </Button>
        <Button onClick={() => synth.randomise()}>Random</Button>
        <Button onClick={() => synth.clearSteps()}>Clear</Button>
      </div>

      <div className="ld-grid">
        <div className="ld-rows" aria-hidden="true">
          {Array.from({ length: LEAD_MAX_DEGREE }, (_, r) => (
            <span key={r}>{LEAD_MAX_DEGREE - r}</span>
          ))}
        </div>
        <div className="ld-cells">
          {Array.from({ length: LEAD_MAX_DEGREE }, (_, r) => {
            const degree = LEAD_MAX_DEGREE - r;
            return (
              <div className="ld-row" key={degree}>
                {Array.from({ length: LEAD_STEPS }, (_, c) => {
                  const on = degrees[c] === degree;
                  return (
                    <button
                      key={c}
                      type="button"
                      aria-label={`Step ${c + 1} degree ${degree}`}
                      aria-pressed={on}
                      className={`ld-cell ${on ? "on" : ""} ${on && accents[c] ? "acc" : ""} ${Math.floor(c / 4) % 2 ? "alt" : ""} ${c >= loop ? "out" : ""}`}
                      onClick={(e) => {
                        pickDegree(c, degree, e.shiftKey);
                        if (!e.shiftKey && degrees[c] !== degree) synth.noteOn({ note: stepNote(synth, degree), velocity: 0.8, duration: 0.18 });
                      }}
                    />
                  );
                })}
              </div>
            );
          })}
          <PlayheadBand columns={LEAD_STEPS} gap={4} read={() => synth.playhead()?.a ?? -1} />
        </div>
      </div>

      <div className="ld-keys-head">
        <span className="sy-label" style={{ fontWeight: 700, color: "var(--text)", fontSize: 16 }}>
          Keys
        </span>
        <span className="eyebrow">Tap, or play with your computer keyboard</span>
        <span className="spacer" />
        <button type="button" className="icon-btn" aria-label="Octave down" onClick={() => setOctave((o) => Math.max(1, o - 1))}>
          −
        </button>
        <span className="mono" aria-live="polite">
          {octave}–{octave + 2}
        </span>
        <button type="button" className="icon-btn" aria-label="Octave up" onClick={() => setOctave((o) => Math.min(6, o + 1))}>
          +
        </button>
      </div>
      <div ref={keysRoot}>
        <PianoKeys start={start} whites={17} height={74} color="#ff63d8" label="Keyboard" onDown={play} onUp={stop} />
      </div>
    </div>
  );
}

function stepNote(synth: Lead0010110, degree: number): number {
  const root = (Math.round(synth.getParam("octave")) + 1) * 12 + Math.round(synth.getParam("root"));
  return scaleNote(root, Math.round(synth.getParam("scale")), degree - 1);
}

function LayerCard({ synth, n }: { synth: Lead0010110; n: number }) {
  const on = synth.getParam(`l${n}on`) === 1;
  const wave = Math.round(synth.getParam(`l${n}wave`));
  const level = synth.getParam(`l${n}level`);
  const color = LAYER_COLORS[n - 1];
  return (
    <div className={`ld-card ${on ? "" : "off"}`} style={{ "--c": color } as CSSProperties} role="group" aria-label={`Layer ${n}`}>
      <div className="ld-card-head">
        <span className="ld-card-name">Layer {n}</span>
        <button type="button" className={`ld-dot ${on ? "on" : ""}`} role="switch" aria-checked={on} aria-label={`Layer ${n} on`} onClick={() => synth.setParam(`l${n}on`, on ? 0 : 1)} />
      </div>
      <button type="button" className="sy-mini" aria-label={`Layer ${n} wave: ${WAVE_LABELS[wave]}; click for the next`} onClick={() => synth.setParam(`l${n}wave`, (wave + 1) % 4)}>
        {WAVE_LABELS[wave]}
      </button>
      <div className="ld-shape" aria-hidden="true">
        {shapeBars(wave).map((h, i) => (
          <span key={i} style={{ height: h * 0.7 }} />
        ))}
      </div>
      <LevelRow label={`Layer ${n} level`} level={level} onChange={(v) => synth.setParam(`l${n}level`, v)} />
    </div>
  );
}

function LevelRow({ label, level, onChange }: { label: string; level: number; onChange: (v: number) => void }) {
  return (
    <>
      <div className="ld-level" aria-hidden="true">
        <span>Level</span>
        <span className="mono">{levelDb(level)}</span>
      </div>
      <input className="ld-range" type="range" min={0} max={1} step={0.01} value={level} aria-label={label} aria-valuetext={levelDb(level)} style={{ "--pct": `${level * 100}%` } as CSSProperties} onChange={(e) => onChange(Number(e.target.value))} />
    </>
  );
}

function SampleCard({ synth }: { synth: Lead0010110 }) {
  const input = useRef<HTMLInputElement>(null);
  const info = synth.sampleInfo;
  const level = synth.getParam("sampleLevel");
  const reversed = synth.getParam("sampleReverse") === 1;

  const load = async (file: File | undefined) => {
    if (!file) return;
    try {
      const bytes = await file.arrayBuffer();
      const decoded = await synth.ctx.decodeAudioData(bytes.slice(0));
      const id = newId("asset");
      await putAssetBlob(id, file);
      projectStore.set((p) => ({ ...p, assets: [...p.assets, { id, kind: "audio", name: file.name, mime: file.type || "audio/*", bytes: file.size, durationSec: decoded.duration, addedAt: Date.now() }] }));
      synth.setSample(decoded, id, file.name.replace(/\.[^.]+$/, ""));
    } catch (error) {
      showToast(`Could not load that sample: ${messageOf(error)}`);
    }
  };

  return (
    <div className="ld-card" style={{ "--c": LAYER_COLORS[3] } as CSSProperties} role="group" aria-label="Sample layer">
      <div className="ld-card-head">
        <span className="ld-card-name">Sample</span>
        <button type="button" className="ld-rev" aria-pressed={reversed} aria-label="Play the sample backwards" title="Play the sample backwards" onClick={() => synth.setParam("sampleReverse", reversed ? 0 : 1)}>
          ⇄
        </button>
      </div>
      <div className="ld-sample-row">
        <button type="button" className="sy-mini" onClick={() => input.current?.click()} title={info.name || "Load an audio file"}>
          {info.status === "loading" ? "Loading…" : info.name || "Load…"}
        </button>
        {info.status !== "none" && (
          <button type="button" className="sy-mini" style={{ flex: "0 0 auto" }} aria-label="Remove sample" onClick={() => synth.clearSample()}>
            ✕
          </button>
        )}
      </div>
      <input ref={input} type="file" accept="audio/*" hidden aria-label="Sample file" onChange={(e) => { void load(e.target.files?.[0]); e.target.value = ""; }} />
      {info.status === "error" ? (
        <div className="ld-error" role="alert">
          {info.error}
        </div>
      ) : (
        <div className="ld-shape" aria-hidden="true">
          {shapeBars(3).map((h, i) => (
            <span key={i} style={{ height: h * 0.7 }} />
          ))}
        </div>
      )}
      <LevelRow label="Sample level" level={level} onChange={(v) => synth.setParam("sampleLevel", v)} />
    </div>
  );
}

