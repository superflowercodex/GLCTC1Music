import { useRef, useState } from "react";
import { Acid30lee, ACID_PATTERNS, ACID_STEPS } from "../../../audio/instruments/acid30lee";
import { noteName } from "../../../audio/instruments/synth/scales";
import type { Instrument } from "../../../audio/types";
import { Button, Seg, Switch } from "../../../ui/controls";
import { useInstrument, useRaf } from "../../../ui/hooks";
import { InstrumentShell } from "../InstrumentShell";
import { bounceToTrack } from "../synth/bounceToTrack";
import { BarsSelect } from "../synth/BarsSelect";
import { SynthTabsPanel, type SynthTab } from "../synth/SynthTabsPanel";
import "../synth/synth.css";

const PATTERN_NAMES = ["A", "B", "C", "D"] as const;
const OCT_LABEL = { "-1": "−1", "0": "·", "1": "+1" } as const;
const NEXT_OCT = { "-1": 0, "0": 1, "1": -1 } as const;

function asAcid(instrument: Instrument): Acid30lee {
  if (!(instrument instanceof Acid30lee)) throw new TypeError("The 30LEE room needs a 30LEE instrument.");
  return instrument;
}

export default function Acid30leeRoom({ instrument }: { instrument: Instrument }) {
  const synth = asAcid(instrument);
  const [bars, setBars] = useState(2);
  const [busy, setBusy] = useState(false);

  const tabs: SynthTab[] = [
    {
      name: "Sound",
      groups: ["Sound"],
      footer: <FreezeButton synth={synth} />,
    },
    { name: "Effects", groups: ["Effects"] },
    { name: "Feel", groups: ["Feel", "Arp"], hide: ["arpOn", "arpMode"] },
  ];

  const onBounce = async () => {
    setBusy(true);
    await bounceToTrack({ instrument: synth, create: (ctx) => new Acid30lee(ctx), name: "30LEE", color: "#8e7cff", bars });
    setBusy(false);
  };

  return (
    <InstrumentShell
      instrument={synth}
      title="30LEE"
      tagline="Acid bass"
      rightPanel={<SynthTabsPanel instrument={synth} tabs={tabs} />}
      onBounce={() => void onBounce()}
      bounceBusy={busy}
      footerExtra={<BarsSelect bars={bars} onChange={setBars} />}
    >
      <Surface synth={synth} />
    </InstrumentShell>
  );
}

function FreezeButton({ synth }: { synth: Acid30lee }) {
  return (
    <button
      type="button"
      className="sy-hold"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        synth.setFreeze(true);
      }}
      onPointerUp={() => synth.setFreeze(false)}
      onPointerCancel={() => synth.setFreeze(false)}
      onKeyDown={(e) => {
        if ((e.key === " " || e.key === "Enter") && !e.repeat) synth.setFreeze(true);
      }}
      onKeyUp={() => synth.setFreeze(false)}
    >
      Filter freeze · hold to sweep
    </button>
  );
}

function Surface({ synth }: { synth: Acid30lee }) {
  useInstrument(synth);
  const columns = useRef<(HTMLDivElement | null)[]>([]);
  const lastNow = useRef(-1);
  const active = synth.activePattern;
  const pattern = active ?? 0;
  const arpOn = synth.getParam("arpOn") === 1;

  useRaf(() => {
    const ph = synth.playhead();
    const now = ph && synth.getParam("arpOn") !== 1 ? ph.a : -1;
    if (now === lastNow.current) return;
    columns.current[lastNow.current]?.classList.remove("now");
    columns.current[now]?.classList.add("now");
    lastNow.current = now;
  });

  const preview = (note: number) => synth.noteOn({ note, velocity: 0.8, duration: 0.2 });

  return (
    <div className="ac">
      <div className="ac-bar">
        <div className="sy-chips" role="radiogroup" aria-label="Pattern">
          {PATTERN_NAMES.slice(0, ACID_PATTERNS).map((name, i) => (
            <button key={name} type="button" role="radio" aria-checked={active === i} className={`sy-square ${active === i ? "on" : ""}`} onClick={() => synth.setPattern(i)}>
              {name}
            </button>
          ))}
          <button type="button" role="radio" aria-checked={active === null} className={`sy-pill ${active === null ? "on" : ""}`} onClick={() => synth.setPattern(null)} title="Stop the pattern; the keys still play">
            Off
          </button>
        </div>
        <span className="spacer" />
        <Button onClick={() => synth.randomise(pattern)}>Random</Button>
        <button type="button" className="btn sq" aria-label="Shift left" title="Shift the pattern one step left" onClick={() => synth.shiftPattern(pattern, -1)}>
          ←
        </button>
        <button type="button" className="btn sq" aria-label="Shift right" title="Shift the pattern one step right" onClick={() => synth.shiftPattern(pattern, 1)}>
          →
        </button>
      </div>

      <div className="ac-grid">
        <div className="ac-labels" aria-hidden="true">
          <span className="ac-l-num">Step</span>
          <span className="ac-l-play">Play</span>
          <span className="ac-l-note">Note</span>
          <span className="ac-l-oct">Octave</span>
          <span className="ac-l-small">Accent</span>
          <span className="ac-l-small">Slide</span>
        </div>
        <div className="ac-cols">
          {Array.from({ length: ACID_STEPS }, (_, i) => {
            const st = synth.getStep(pattern, i);
            const n = String(i + 1).padStart(2, "0");
            return (
              <div key={i} className={`ac-col ${st.on ? "on" : ""}`} ref={(el) => void (columns.current[i] = el)}>
                <span className="ac-num mono">{n}</span>
                <button type="button" className={`ac-play ${st.on ? "on" : ""}`} aria-pressed={st.on} aria-label={`Step ${n} play`} onClick={() => synth.setStep(pattern, i, { on: !st.on })} />
                <button
                  type="button"
                  className="ac-note mono"
                  aria-label={`Step ${n} note ${noteName(st.note)}; click to raise, shift-click to lower`}
                  onClick={(e) => {
                    const note = Math.max(24, Math.min(60, st.note + (e.shiftKey ? -1 : 1)));
                    synth.setStep(pattern, i, { note });
                    preview(note + st.oct * 12);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    synth.setStep(pattern, i, { note: Math.max(24, st.note - 1) });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                      e.preventDefault();
                      synth.setStep(pattern, i, { note: Math.max(24, Math.min(60, st.note + (e.key === "ArrowUp" ? 1 : -1))) });
                    }
                  }}
                >
                  {noteName(st.note)}
                </button>
                <button type="button" className="ac-oct mono" aria-label={`Step ${n} octave ${OCT_LABEL[st.oct]}; click to change`} onClick={() => synth.setStep(pattern, i, { oct: NEXT_OCT[st.oct] })}>
                  {OCT_LABEL[st.oct]}
                </button>
                <button type="button" className={`ac-flag accent ${st.accent ? "on" : ""}`} aria-pressed={st.accent} aria-label={`Step ${n} accent`} onClick={() => synth.setStep(pattern, i, { accent: !st.accent })} />
                <button type="button" className={`ac-flag slide ${st.slide ? "on" : ""}`} aria-pressed={st.slide} aria-label={`Step ${n} slide`} onClick={() => synth.setStep(pattern, i, { slide: !st.slide })} />
              </div>
            );
          })}
        </div>
      </div>

      <div className="ac-arp">
        <div className="ac-arp-switch">
          <Switch label="Arpeggiator" checked={arpOn} onChange={(on) => synth.setParam("arpOn", on ? 1 : 0)} />
        </div>
        <Seg
          label="Arpeggiator pattern"
          value={Math.round(synth.getParam("arpMode"))}
          onChange={(v) => synth.setParam("arpMode", v)}
          options={["Up", "Down", "Up and down", "As played", "Random"].map((label, value) => ({ value, label }))}
          className="sy-seg-compact"
        />
        <span className="eyebrow">{arpOn ? "Hold keys to play chords; with none held it walks the pattern" : "Turn it on to play chords from the keys"}</span>
      </div>
    </div>
  );
}
