import { useEffect, useMemo, useRef, useState } from "react";
import { showToast } from "../audio/media";
import { LONG_EXPORT_SEC, MixdownCancelled, MixdownError, mixdownProject, mixdownStems } from "../audio/mixdown";
import { audioBufferToWav, WavError, type WavBitDepth } from "../audio/wav";
import { projectStore } from "../store/project";
import { useStore } from "../store/store";
import { Seg, Switch } from "../ui/controls";
import { downloadBlob, safeFileName } from "./download";
import { EXPORT_SAMPLE_RATE, formatBytes, formatDuration, formatRenderTime, mixdownOptionsFor, summarizeExport, type ExportChoices, type ExportWhat } from "./exportModel";
import { Sheet } from "./Sheet";

const WHAT: ReadonlyArray<{ value: ExportWhat; label: string }> = [
  { value: "song", label: "Whole song" },
  { value: "loop", label: "Loop region" },
  { value: "tracks", label: "Each track" },
];

const DEPTH: ReadonlyArray<{ value: WavBitDepth; label: string }> = [
  { value: 16, label: "16-bit" },
  { value: 24, label: "24-bit" },
];

const SOURCE: ReadonlyArray<{ value: ExportChoices["source"]; label: string }> = [
  { value: "arrangement", label: "Arrangement" },
  { value: "song", label: "Song room" },
];

export function ExportSheet({ onClose }: { onClose: () => void }) {
  const project = useStore(projectStore, (p) => p);
  const [choices, setChoices] = useState<ExportChoices>({ what: "song", source: "arrangement", instrumentsAndLimiter: true, metronome: false, bitDepth: 16 });
  const [rendering, setRendering] = useState(false);
  const [progress, setProgress] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const bar = useRef<HTMLDivElement>(null);

  const hasSongSections = project.song.sections.length > 0;
  const summary = useMemo(() => summarizeExport(project, choices), [project, choices]);
  const set = (patch: Partial<ExportChoices>): void => setChoices((c) => ({ ...c, ...patch }));

  // Progress arrives many times a second; the bar is written straight to the DOM.
  useEffect(() => {
    if (bar.current) bar.current.style.transform = `scaleX(${progress})`;
  }, [progress]);

  useEffect(() => () => controller.current?.abort(), []);

  useEffect(() => {
    if (!rendering) return;
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 500);
    return () => clearInterval(timer);
  }, [rendering]);

  const run = async (): Promise<void> => {
    const abort = new AbortController();
    controller.current = abort;
    setError(null);
    setProgress(0);
    setElapsed(0);
    setRendering(true);
    const options = { ...mixdownOptionsFor(choices), signal: abort.signal, onProgress: setProgress };
    const base = safeFileName(project.name);
    try {
      if (choices.what === "tracks") {
        const stems = await mixdownStems(project, options);
        for (const stem of stems) {
          downloadBlob(new Blob([audioBufferToWav(stem.buffer, { bitDepth: choices.bitDepth, dither: choices.bitDepth === 16 })], { type: "audio/wav" }), `${base} - ${safeFileName(stem.name, "track")}.wav`);
        }
        showToast(`Exported ${stems.length} track file${stems.length === 1 ? "" : "s"}. Your browser may ask to allow multiple downloads.`);
      } else {
        const buffer = await mixdownProject(project, options);
        const wav = audioBufferToWav(buffer, { bitDepth: choices.bitDepth, dither: choices.bitDepth === 16 });
        downloadBlob(new Blob([wav], { type: "audio/wav" }), `${base}.wav`);
        showToast(`Exported ${base}.wav (${formatBytes(wav.byteLength)}).`);
      }
      onClose();
    } catch (err) {
      if (err instanceof MixdownCancelled) showToast("Export cancelled.");
      else if (err instanceof MixdownError || err instanceof WavError) setError(err.message);
      else setError(`The export failed: ${err instanceof Error ? err.message : "unknown error"}. Try a shorter range or fewer tracks.`);
    } finally {
      controller.current = null;
      setRendering(false);
    }
  };

  const cancel = (): void => controller.current?.abort();

  return (
    <Sheet title="Export" subtitle={<span className="mono">{project.name}</span>} onClose={rendering ? cancel : onClose}>
      <div>
        <div className="field-label">What to export</div>
        <Seg className="wide" label="What to export" options={WHAT} value={choices.what} onChange={(v) => !rendering && set({ what: v })} />
        {choices.what === "tracks" && <div className="field-help">One file per track, before the master effects and limiter, so you can mix them elsewhere.</div>}
        {choices.what === "loop" && <div className="field-help">Bars {project.loop.startBar} to {project.loop.endBar - 1}, the loop region on the ruler.</div>}
      </div>
      {hasSongSections && (
        <div>
          <div className="field-label">Take the music from</div>
          <Seg className="wide" label="Take the music from" options={SOURCE} value={choices.source} onChange={(v) => !rendering && set({ source: v })} />
          <div className="field-help">{choices.source === "song" ? "Renders the sections and patterns you built in the Song room." : "Renders the clips on the Arrange timeline."}</div>
        </div>
      )}
      <div style={{ display: "grid", gap: 8 }}>
        <Switch label="Include instruments and the master limiter" checked={choices.instrumentsAndLimiter} onChange={(v) => !rendering && set({ instrumentsAndLimiter: v })} />
        <Switch label="Include the metronome" checked={choices.metronome} onChange={(v) => !rendering && set({ metronome: v })} />
      </div>
      <div>
        <div className="field-label">File</div>
        <Seg className="wide" label="Bit depth" options={DEPTH} value={choices.bitDepth} onChange={(v) => !rendering && set({ bitDepth: v })} />
      </div>
      {summary.ok ? (
        <div className="stats" aria-label="Estimate">
          <div>
            <div className="stat-value">{formatDuration(summary.seconds)}</div>
            <div className="stat-label">Length</div>
          </div>
          <div>
            <div className="stat-value">{formatBytes(summary.bytesPerFile)}</div>
            <div className="stat-label">
              {summary.files > 1 ? `each, ${summary.files} files` : "WAV"}, {EXPORT_SAMPLE_RATE / 1000} kHz
            </div>
          </div>
          <div>
            <div className="stat-value">{formatRenderTime(summary.renderSeconds)}</div>
            <div className="stat-label">To render</div>
          </div>
        </div>
      ) : (
        <p className="sheet-alert" role="alert">
          {summary.error}
        </p>
      )}
      {summary.long && (
        <div className="sheet-warn" role="alert">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 4l9 16H3zM12 10v4M12 17.5v.5" />
          </svg>
          <span>
            This is over {LONG_EXPORT_SEC / 60} minutes of audio. Rendering may use a lot of memory and keep the tab busy for a while. Keep this tab open until it finishes, or export the loop region or tracks one at a time.
          </span>
        </div>
      )}
      {error && (
        <p className="sheet-alert" role="alert">
          {error}
        </p>
      )}
      {rendering && (
        <div>
          <div className="progress" role="progressbar" aria-label="Export progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
            <div ref={bar} style={{ transform: "scaleX(0)" }} />
          </div>
          <div className="progress-text">
            <span>Rendering {Math.round(progress * 100)}%. Keep this tab open.</span>
            <span className="mono">{elapsed} s</span>
          </div>
        </div>
      )}
      <div className="sheet-actions">
        {rendering ? (
          <button type="button" data-autofocus className="btn btn-hero btn-danger" onClick={cancel}>
            Cancel export
          </button>
        ) : (
          <button type="button" data-autofocus className="btn btn-hero btn-primary" disabled={!summary.ok} onClick={() => void run()}>
            Export WAV
          </button>
        )}
        <button type="button" className="btn btn-ghost" style={{ height: 60 }} disabled title="Publishing to GLCTC1 radio and your artist page is not available yet" aria-disabled="true">
          Publish to GLCTC1<span className="coming-soon">Coming soon</span>
        </button>
      </div>
    </Sheet>
  );
}
