import { useRef } from "react";
import { TRAIL_LENGTH, type Vox } from "../../../audio/instruments/vox";
import { NOTE_NAMES, scaleNotes } from "../../../audio/instruments/voice/scales";
import { LedMeter } from "../../../ui/LedMeter";
import { prefersReducedMotion, useRaf } from "../../../ui/hooks";
import { useCanvas } from "./hooks";

const LABEL_GUTTER = 56;
const SPAN = 16;
const MINT = "124,240,192";

function noteText(midi: number): string {
  const r = Math.round(midi);
  return `${NOTE_NAMES[((r % 12) + 12) % 12]}${Math.floor(r / 12) - 1}`;
}

/**
 * Oscilloscope-style pitch screen: tuned pitch as phosphor bars, what you sang as fading dots,
 * the scale as a graticule. Drawn straight to the canvas every frame; the readouts write the DOM directly.
 */
export function PitchView({ vox, status, dropping }: { vox: Vox; status: string; dropping: boolean }) {
  const center = useRef(60);
  const canvasRef = useCanvas(() => undefined, []);
  const reduced = useRef(prefersReducedMotion());
  const youEl = useRef<HTMLSpanElement>(null);
  const tunedEl = useRef<HTMLSpanElement>(null);

  useRaf(() => {
    const canvas = canvasRef.current;
    const g = canvas?.getContext("2d");
    if (!canvas || !g) return;
    const scale = window.devicePixelRatio || 1;
    const width = canvas.width / scale;
    const height = canvas.height / scale;
    if (width < 10) return;
    g.setTransform(scale, 0, 0, scale, 0, 0);
    g.clearRect(0, 0, width, height);

    const { raw, tuned, head } = vox.trail;
    let sum = 0;
    let n = 0;
    for (let i = 0; i < TRAIL_LENGTH; i++) {
      if (!Number.isNaN(raw[i])) {
        sum += raw[i];
        n += 1;
      }
    }
    // The window drifts toward where the singer is, so a high or low voice stays in view.
    if (n > 3) center.current += (sum / n - center.current) * (reduced.current ? 1 : 0.05);

    const low = center.current - SPAN / 2;
    const top = 14;
    const y = (midi: number) => height - 14 - ((midi - low) / SPAN) * (height - 14 - top - 14);
    const key = vox.key;
    const plotLeft = LABEL_GUTTER;
    const plotWidth = width - plotLeft - 12;

    // Graticule: eight vertical divisions, one horizontal line per scale note (the root brighter).
    g.fillStyle = `rgba(${MINT},.06)`;
    for (let d = 1; d < 8; d++) g.fillRect(plotLeft + (plotWidth * d) / 8, 8, 1, height - 16);
    g.font = "13px DM Mono, monospace";
    g.textBaseline = "middle";
    let lastLabel = -Infinity;
    for (const note of scaleNotes(key, Math.floor(low), Math.ceil(low + SPAN)).sort((a, b) => b - a)) {
      const ly = y(note);
      if (ly < 10 || ly > height - 10) continue;
      const root = note % 12 === key.root;
      g.fillStyle = root ? `rgba(${MINT},.28)` : `rgba(${MINT},.1)`;
      g.fillRect(plotLeft, Math.round(ly), plotWidth + 12, 1);
      // Labels thin out on a short screen so they never stack.
      if (ly - lastLabel < 15 && !root) continue;
      lastLabel = ly;
      g.fillStyle = root ? `rgba(${MINT},.9)` : "rgba(220,226,222,.6)";
      g.fillText(NOTE_NAMES[note % 12], 20, ly);
    }

    const step = plotWidth / TRAIL_LENGTH;
    // Phosphor persistence: the oldest samples are dim, the newest burn brightest.
    for (let i = 0; i < TRAIL_LENGTH; i++) {
      const t = tuned[(head + i) % TRAIL_LENGTH];
      if (Number.isNaN(t)) continue;
      const age = i / TRAIL_LENGTH;
      g.fillStyle = `rgba(${MINT},${0.25 + 0.75 * age})`;
      g.shadowColor = `rgba(${MINT},${0.7 * age})`;
      g.shadowBlur = 8;
      g.fillRect(plotLeft + i * step, y(t) - 3, Math.max(2, step + 0.5), 6);
    }
    g.shadowBlur = 0;
    for (let i = 0; i < TRAIL_LENGTH; i++) {
      const r = raw[(head + i) % TRAIL_LENGTH];
      if (Number.isNaN(r)) continue;
      const age = i / TRAIL_LENGTH;
      g.fillStyle = `rgba(255,255,255,${0.2 + 0.8 * age})`;
      g.beginPath();
      g.arc(plotLeft + i * step + step / 2, y(r), 2.4, 0, Math.PI * 2);
      g.fill();
    }

    const last = (head + TRAIL_LENGTH - 1) % TRAIL_LENGTH;
    const youMidi = raw[last];
    const tunedMidi = tuned[last];
    const you = youEl.current;
    const tun = tunedEl.current;
    if (you) {
      const text = Number.isNaN(youMidi) ? "—" : `${noteText(youMidi)} ${Math.round((youMidi - Math.round(youMidi)) * 100) >= 0 ? "+" : "−"}${Math.abs(Math.round((youMidi - Math.round(youMidi)) * 100))}¢`;
      if (you.textContent !== text) {
        you.textContent = text;
        you.parentElement?.classList.toggle("off", Number.isNaN(youMidi));
      }
    }
    if (tun) {
      const text = Number.isNaN(tunedMidi) ? "—" : noteText(tunedMidi);
      if (tun.textContent !== text) {
        tun.textContent = text;
        tun.parentElement?.classList.toggle("off", Number.isNaN(tunedMidi));
      }
    }
  });

  return (
    <div className={dropping ? "scope drop" : "scope"}>
      <canvas ref={canvasRef} aria-label="Pitch you sang and the tuned pitch" role="img" />
      <div className="scope-readout" aria-hidden="true">
        <div className="off">
          <small>
            <i className="you" />
            You
          </small>
          <span ref={youEl}>—</span>
        </div>
        <div className="off">
          <small>
            <i className="tuned" />
            Tuned
          </small>
          <span ref={tunedEl}>—</span>
        </div>
      </div>
      <div className="scope-status">{status}</div>
    </div>
  );
}

export function LevelRow({ vox }: { vox: Vox }) {
  const readout = useRef<HTMLSpanElement>(null);
  useRaf(() => {
    const el = readout.current;
    if (!el) return;
    const db = vox.inputLevel > 0.00002 ? Math.round(20 * Math.log10(vox.inputLevel)) : null;
    const text = db === null ? "−∞ dB" : `${db < 0 ? "−" : "+"}${Math.abs(db)} dB`;
    if (el.textContent !== text) el.textContent = text;
  });
  return (
    <div className="level-row">
      <span className="voice-label" style={{ width: 52 }}>
        Level
      </span>
      <LedMeter horizontal label="Input level" getLevel={() => vox.inputLevel} segmentPx={4} scale={{ floorDb: -60, ceilDb: 0 }} />
      <span ref={readout} className="level-db" aria-label="Input level">
        −∞ dB
      </span>
    </div>
  );
}
