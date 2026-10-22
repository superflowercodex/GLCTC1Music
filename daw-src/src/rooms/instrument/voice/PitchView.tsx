import { useRef } from "react";
import { TRAIL_LENGTH, type Vox } from "../../../audio/instruments/vox";
import { NOTE_NAMES, scaleNotes } from "../../../audio/instruments/voice/scales";
import { Meter } from "../../../ui/Meter";
import { prefersReducedMotion, useRaf } from "../../../ui/hooks";
import { useCanvas } from "./hooks";

const LABEL_GUTTER = 56;
const SPAN = 16;

/** Pitch history: white dots are what you sang, green blocks are where the voice ended up. Drawn straight to the canvas every frame. */
export function PitchView({ vox, status, dropping }: { vox: Vox; status: string; dropping: boolean }) {
  const center = useRef(60);
  const canvasRef = useCanvas(() => undefined, []);
  const reduced = useRef(prefersReducedMotion());

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
    const y = (midi: number) => height - 14 - ((midi - low) / SPAN) * (height - 28);
    const key = vox.key;
    g.font = "15px DM Mono, monospace";
    g.textBaseline = "middle";
    for (const note of scaleNotes(key, Math.floor(low), Math.ceil(low + SPAN))) {
      const ly = y(note);
      if (ly < 8 || ly > height - 8) continue;
      g.fillStyle = note % 12 === key.root ? "rgba(255,255,255,.2)" : "rgba(255,255,255,.08)";
      g.fillRect(LABEL_GUTTER, ly, width - LABEL_GUTTER, 1);
      g.fillStyle = "#a9b4d6";
      g.fillText(NOTE_NAMES[note % 12], 14, ly);
    }

    const plotWidth = width - LABEL_GUTTER - 8;
    const step = plotWidth / TRAIL_LENGTH;
    for (let i = 0; i < TRAIL_LENGTH; i++) {
      const idx = (head + i) % TRAIL_LENGTH;
      const x = LABEL_GUTTER + i * step;
      const t = tuned[idx];
      if (!Number.isNaN(t)) {
        g.fillStyle = "#7cf0c0";
        g.shadowColor = "rgba(124,240,192,.6)";
        g.shadowBlur = 12;
        g.beginPath();
        g.roundRect(x, y(t) - 4.5, Math.max(3, step + 1), 9, 4.5);
        g.fill();
        g.shadowBlur = 0;
      }
    }
    g.fillStyle = "#fff";
    for (let i = 0; i < TRAIL_LENGTH; i++) {
      const r = raw[(head + i) % TRAIL_LENGTH];
      if (Number.isNaN(r)) continue;
      g.beginPath();
      g.arc(LABEL_GUTTER + i * step + step / 2, y(r), 3, 0, Math.PI * 2);
      g.fill();
    }
  });

  return (
    <div className={dropping ? "pitch-box drop" : "pitch-box"}>
      <canvas ref={canvasRef} aria-label="Pitch you sang and the tuned pitch" role="img" />
      <div className="pitch-status">{status}</div>
      <div style={{ position: "absolute", right: 16, top: 14, display: "flex", gap: 14, fontSize: 15, color: "var(--soft)" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#fff" }} />
          You
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 18, height: 8, borderRadius: 4, background: "var(--mint)" }} />
          Tuned
        </span>
      </div>
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
      <span className="voice-label">Level</span>
      <Meter horizontal getLevel={() => vox.inputLevel * vox.inputLevel * 16} />
      <span ref={readout} className="level-db mono" aria-label="Input level">
        −∞ dB
      </span>
    </div>
  );
}
