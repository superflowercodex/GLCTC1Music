import { useRef } from "react";
import { peekEngine } from "../../audio/engine";
import { FILTER_MAX_HZ, FILTER_MIN_HZ, formatDb, hzToPosition, positionToHz } from "../../audio/mixMath";
import { projectStore, uiStore } from "../../store/project";
import { useStore } from "../../store/store";
import { Caption } from "../../ui/Caption";
import { Button } from "../../ui/controls";
import { DB_TICKS, Fader } from "../../ui/Fader";
import { useRaf } from "../../ui/hooks";
import { Faceplate, GlassWindow } from "../../ui/hardware";
import { Knob } from "../../ui/Knob";
import { LedMeter } from "../../ui/LedMeter";
import { padReadout } from "../../ui/kitMath";
import { setMaster } from "./edit";

const METER_SCALE = { segments: 40 };
const GR_FULL_DB = 12;

function FxKnob({ label, on, onToggle, children }: { label: string; on: boolean; onToggle: (on: boolean) => void; children: React.ReactNode }) {
  return (
    <div className={`mfx ${on ? "on" : ""}`}>
      {children}
      <button type="button" className={`pill mfx-toggle ${on ? "on" : ""}`} aria-pressed={on} aria-label={`${label} on`} onClick={() => onToggle(!on)}>
        {on ? "On" : "Off"}
      </button>
    </div>
  );
}

export function MasterStrip() {
  const master = useStore(projectStore, (p) => p.master);
  const clipLamp = useRef<HTMLButtonElement>(null);
  const peakText = useRef<HTMLSpanElement>(null);
  const grBar = useRef<HTMLSpanElement>(null);
  const grText = useRef<HTMLSpanElement>(null);
  const grLed = useRef<HTMLSpanElement>(null);
  const latched = useRef(false);
  const shownPeak = useRef(-120);

  useRaf(() => {
    const engine = peekEngine();
    const peak = engine ? engine.section.peak() : 0;
    shownPeak.current = Math.max(peak > 0 ? 20 * Math.log10(peak) : -120, shownPeak.current - 0.6);
    if (peak >= 0.99) latched.current = true;
    // Only touch the DOM when the text changes: a repaint under the glass re-runs the backdrop blur.
    const peakStr = padReadout(shownPeak.current <= -60 ? "−∞" : formatDb(shownPeak.current), 5);
    if (peakText.current && peakText.current.textContent !== peakStr) peakText.current.textContent = peakStr;
    const clip = latched.current ? "1" : "0";
    if (clipLamp.current && clipLamp.current.dataset.clip !== clip) clipLamp.current.dataset.clip = clip;

    const reduction = engine && projectStore.get().master.limiter ? Math.min(0, engine.limiter.reduction) : 0;
    const gr = -reduction;
    const grScale = `scaleX(${Math.min(1, gr / GR_FULL_DB).toFixed(3)})`;
    if (grBar.current && grBar.current.dataset.s !== grScale) {
      grBar.current.dataset.s = grScale;
      grBar.current.style.transform = grScale;
    }
    const grOn = gr > 0.3 ? "1" : "0";
    if (grLed.current && grLed.current.dataset.on !== grOn) grLed.current.dataset.on = grOn;
    const grStr = padReadout(gr > 0.05 ? `−${gr.toFixed(1)} dB` : "0.0 dB", 7);
    if (grText.current && grText.current.textContent !== grStr) grText.current.textContent = grStr;
  });

  const set = (patch: Parameters<typeof setMaster>[1]): void => projectStore.set((p) => setMaster(p, patch));
  const levels = (): number[] => {
    const lv = peekEngine()?.section.levels() ?? [0, 0];
    return [lv[0] * Math.SQRT2, lv[1] * Math.SQRT2];
  };
  const filterText = master.filterHz >= 1000 ? `${(master.filterHz / 1000).toFixed(1)}k` : `${Math.round(master.filterHz)}`;

  return (
    <Faceplate as="aside" className="master-strip" label="Master" color="var(--a1)">
      <div className="master-head">
        <Caption as="h2">Master</Caption>
        <button
          ref={clipLamp}
          type="button"
          className="clip-lamp"
          data-clip="0"
          data-tip="Peak level. Lights at full scale; click to reset."
          aria-label="Reset clip indicator"
          onClick={() => {
            latched.current = false;
            if (clipLamp.current) clipLamp.current.dataset.clip = "0";
          }}
        >
          <i />
          <span className="mono">
            Peak <span ref={peakText} className="peak-val">{padReadout("−∞", 5)}</span>
          </span>
        </button>
      </div>
      <div className="master-main">
        <div className="master-vu">
          <GlassWindow className="master-meter-win">
            <LedMeter getLevel={levels} label="Master level" scale={METER_SCALE} segmentPx={3} />
          </GlassWindow>
          <div className="vu-lr" aria-hidden="true">
            <span>L</span>
            <span>R</span>
          </div>
        </div>
        <Fader label="Master volume" value={master.gainDb} min={-60} max={6} step={0.1} defaultValue={0} ticks={DB_TICKS} format={(v) => (v <= -60 ? "−∞" : `${formatDb(v)} dB`)} onChange={(db) => set({ gainDb: db })} hideLabel />
      </div>
      <div className="master-fx">
        <Caption>Master effects</Caption>
        <div className="mfx-row">
          <FxKnob label="Filter" on={master.filterOn} onToggle={(on) => set({ filterOn: on })}>
            <Knob
              size="lg"
              label="Filter"
              value={hzToPosition(master.filterHz)}
              min={0}
              max={1}
              step={0.001}
              defaultValue={1}
              format={() => filterText}
              onChange={(p) => set({ filterHz: Math.round(positionToHz(p, FILTER_MIN_HZ, FILTER_MAX_HZ)) })}
              disabled={!master.filterOn}
            />
          </FxKnob>
          <FxKnob label="Delay" on={master.delayOn} onToggle={(on) => set({ delayOn: on })}>
            <Knob size="lg" label="Delay" value={master.delayMix} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ delayMix: v })} disabled={!master.delayOn} />
          </FxKnob>
          <FxKnob label="Reverb" on={master.reverbOn} onToggle={(on) => set({ reverbOn: on })}>
            <Knob size="lg" label="Reverb" value={master.reverbMix} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ reverbMix: v })} disabled={!master.reverbOn} />
          </FxKnob>
        </div>
      </div>
      <div className={`master-lim ${master.limiter ? "on" : ""}`}>
        <button type="button" role="switch" aria-checked={master.limiter} className="lim-switch" onClick={() => set({ limiter: !master.limiter })}>
          <span className="caption-t">Limiter</span>
          <span className={`switch ${master.limiter ? "on" : ""}`}>
            <span className="knob" />
          </span>
        </button>
        <div className="lim-gr" data-tip="Gain reduction applied by the limiter">
          <span ref={grLed} className="gr-led" data-on="0" />
          <span className="gr-track">
            <span ref={grBar} className="gr-bar" />
          </span>
          <span ref={grText} className="mono gr-text">
            {padReadout("0.0 dB", 7)}
          </span>
        </div>
      </div>
      <Button variant="primary" className="master-export" onClick={() => uiStore.set((s) => ({ ...s, sheet: "export" }))}>
        Export mix as WAV
      </Button>
    </Faceplate>
  );
}
