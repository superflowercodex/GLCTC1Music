import { useRef, type CSSProperties } from "react";
import { peekEngine } from "../../audio/engine";
import { FILTER_MAX_HZ, FILTER_MIN_HZ, formatDb, hzToPosition, positionToHz } from "../../audio/mixMath";
import { projectStore, uiStore } from "../../store/project";
import { useStore } from "../../store/store";
import { Button, Switch } from "../../ui/controls";
import { useRaf } from "../../ui/hooks";
import { Meter } from "../../ui/Meter";
import { Fader } from "./Fader";
import { setMaster } from "./edit";

function FxRow({ label, on, onToggle, value, text, min, max, onValue }: { label: string; on: boolean; onToggle: (on: boolean) => void; value: number; text: string; min: number; max: number; onValue: (v: number) => void }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="mfx-row">
      <button type="button" className={`mfx-chip ${on ? "on" : ""}`} aria-pressed={on} onClick={() => onToggle(!on)}>
        {label}
      </button>
      <label className="mfx-slider" style={{ "--pct": `${pct}%` } as CSSProperties}>
        <input type="range" min={min} max={max} step={(max - min) / 400} value={value} aria-label={`${label} amount`} aria-valuetext={text} onChange={(e) => onValue(Number(e.target.value))} />
      </label>
      <span className="mfx-value mono">{text}</span>
    </div>
  );
}

export function MasterStrip() {
  const master = useStore(projectStore, (p) => p.master);
  const clipLamp = useRef<HTMLButtonElement>(null);
  const peakText = useRef<HTMLSpanElement>(null);
  const latched = useRef(false);
  const shownPeak = useRef(-120);

  useRaf(() => {
    const section = peekEngine()?.section;
    const peak = section ? section.peak() : 0;
    shownPeak.current = Math.max(peak > 0 ? 20 * Math.log10(peak) : -120, shownPeak.current - 0.6);
    if (peak >= 0.99) latched.current = true;
    if (peakText.current) peakText.current.textContent = shownPeak.current <= -60 ? "−∞" : formatDb(shownPeak.current);
    if (clipLamp.current) clipLamp.current.dataset.clip = latched.current ? "1" : "0";
  });

  const set = (patch: Parameters<typeof setMaster>[1]): void => projectStore.set((p) => setMaster(p, patch));
  const levelOf = (side: 0 | 1) => (): number => peekEngine()?.section.levels()[side] ?? 0;

  return (
    <aside className="master-strip panel glass" aria-label="Master">
      <h2>Master</h2>
      <div className="master-body">
        <div className="master-meters">
          <Meter getLevel={levelOf(0)} />
          <Meter getLevel={levelOf(1)} />
        </div>
        <Fader db={master.gainDb} onChange={(db) => set({ gainDb: db })} label="Master volume" color="var(--cyan)" glow="rgba(142, 124, 255, .7)" />
        <div className="master-read">
          <span className="mono master-db">{formatDb(master.gainDb)} dB</span>
          <button
            ref={clipLamp}
            type="button"
            className="clip-lamp"
            data-clip="0"
            title="Peak level. The lamp lights when the master reaches full scale; click to reset."
            aria-label="Reset clip indicator"
            onClick={() => {
              latched.current = false;
              if (clipLamp.current) clipLamp.current.dataset.clip = "0";
            }}
          >
            <span className="mono">
              Peak <span ref={peakText}>−∞</span>
            </span>
          </button>
        </div>
      </div>
      <div className="master-fx">
        <div className="mixer-label">Master effects</div>
        <FxRow
          label="Filter"
          on={master.filterOn}
          onToggle={(on) => set({ filterOn: on })}
          value={hzToPosition(master.filterHz)}
          min={0}
          max={1}
          text={master.filterHz >= 1000 ? `${(master.filterHz / 1000).toFixed(1)}k` : `${Math.round(master.filterHz)}`}
          onValue={(p) => set({ filterHz: Math.round(positionToHz(p, FILTER_MIN_HZ, FILTER_MAX_HZ)) })}
        />
        <FxRow label="Delay" on={master.delayOn} onToggle={(on) => set({ delayOn: on })} value={master.delayMix} min={0} max={1} text={`${Math.round(master.delayMix * 100)}%`} onValue={(v) => set({ delayMix: v })} />
        <FxRow label="Reverb" on={master.reverbOn} onToggle={(on) => set({ reverbOn: on })} value={master.reverbMix} min={0} max={1} text={`${Math.round(master.reverbMix * 100)}%`} onValue={(v) => set({ reverbMix: v })} />
        <Switch label="Limiter" checked={master.limiter} onChange={(on) => set({ limiter: on })} />
      </div>
      <Button variant="primary" className="master-export" onClick={() => uiStore.set((s) => ({ ...s, sheet: "export" }))}>
        Export mix as WAV
      </Button>
    </aside>
  );
}
