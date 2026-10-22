import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { detectTempoAndKey } from "../../../audio/analysis";
import { getEngine, peekEngine } from "../../../audio/engine";
import { setProjectBpm } from "../../../audio/transport";
import type { Asset, Clip } from "../../../project/model";
import { projectStore } from "../../../store/project";
import { Button,  Switch } from "../../../ui/controls";
import { Knob } from "../../../ui/Knob";
import { AudioLoadError, loadAssetBuffer } from "./audioSource";
import {
  barSeconds,
  clipSeconds,
  cutOut,
  duplicate,
  findClip,
  keepSelection,
  replaceClip,
  reverse,
  setAssetBpm,
  setFade,
  setPitch,
  splitAt,
  stepSeconds,
  trimTo,
  warpRatio,
  type TimeBase,
} from "./clipEdits";
import { OverviewStrip } from "./OverviewStrip";
import { buildPeakIndex, type PeakIndex } from "./peaks";
import { notify } from "./shared";
import { WaveformView, type Range, type View } from "./WaveformView";

interface Props {
  clip: Clip;
  asset: Asset | undefined;
  time: TimeBase;
}

type Load = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; buffer: AudioBuffer; index: PeakIndex };

/** Assets we already tried to analyse this session, so a clip that gives no answer is not re-analysed on every open. */
const analysed = new Set<string>();

const MAX_ZOOM = 16;

export function AudioTab({ clip, asset, time }: Props) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [selection, setSelection] = useState<Range | null>(null);
  const [view, setView] = useState<View>({ start: 0, span: Number.POSITIVE_INFINITY });
  const [analysing, setAnalysing] = useState(false);
  const assetId = clip.assetId;
  const total = clipSeconds(clip, time);
  const ratio = warpRatio(clip, asset?.detectedBpm, time.bpm);

  useEffect(() => {
    if (!assetId) return;
    let cancelled = false;
    setLoad({ state: "loading" });
    loadAssetBuffer(assetId).then(
      (buffer) => {
        if (!cancelled) setLoad({ state: "ready", buffer, index: buildPeakIndex(buffer) });
      },
      (err: unknown) => {
        if (!cancelled) setLoad({ state: "error", message: err instanceof AudioLoadError ? err.message : "This audio could not be opened." });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [assetId]);

  const buffer = load.state === "ready" ? load.buffer : undefined;
  useEffect(() => {
    if (!buffer || !asset || asset.detectedBpm !== undefined || asset.detectedKey !== undefined || analysed.has(asset.id)) return;
    analysed.add(asset.id);
    setAnalysing(true);
    detectTempoAndKey(buffer)
      .then((found) => {
        if (found.bpm === undefined && found.key === undefined) return;
        projectStore.set((p) => ({
          ...p,
          assets: p.assets.map((a) => (a.id === asset.id ? { ...a, detectedBpm: found.bpm ?? a.detectedBpm, detectedKey: found.key ?? a.detectedKey } : a)),
        }));
      })
      .catch(() => notify("Tempo and key could not be analysed for this clip."))
      .finally(() => setAnalysing(false));
  }, [buffer, asset]);

  const effView = useMemo<View>(() => {
    const span = Math.min(total, Math.max(total / MAX_ZOOM, view.span));
    return { span, start: Math.min(total - span, Math.max(0, Number.isFinite(view.start) ? view.start : 0)) };
  }, [view, total]);
  const zoom = total / effView.span;

  const setZoom = useCallback(
    (next: number) => {
      const span = total / Math.min(MAX_ZOOM, Math.max(1, next));
      const centre = effView.start + effView.span / 2;
      setView({ span, start: Math.min(total - span, Math.max(0, centre - span / 2)) });
    },
    [total, effView],
  );

  const selectionInRange = selection && selection.b > 0 && selection.a < total ? selection : null;

  const current = (p: ReturnType<typeof projectStore.get>) => findClip(p, clip.id)?.clip;
  const edit = (fn: (c: Clip) => Clip | undefined) =>
    projectStore.set((p) => {
      const c = current(p);
      const next = c && fn(c);
      return next ? replaceClip(p, clip.id, [next]) : p;
    });

  const onSplit = () => {
    const engine = peekEngine();
    if (!engine) {
      notify("Press play or click the waveform first so there is a playhead to split at.");
      return;
    }
    const at = engine.clock.position() * stepSeconds(time) - (clip.startBar - 1) * barSeconds(time);
    const parts = splitAt(clip, at, ratio, time);
    if (!parts) {
      notify("Move the playhead inside the clip to split it.");
      return;
    }
    projectStore.set((p) => replaceClip(p, clip.id, parts));
    setSelection(null);
  };

  const onCut = () => {
    if (!selectionInRange) return;
    const pieces = cutOut(clip, selectionInRange.a, selectionInRange.b, ratio, time);
    if (!pieces) {
      notify("Select a little more of the waveform to cut out.");
      return;
    }
    projectStore.set((p) => replaceClip(p, clip.id, pieces));
    setSelection(null);
  };

  const onKeep = () => {
    if (!selectionInRange) return;
    const kept = keepSelection(clip, selectionInRange.a, selectionInRange.b, ratio, time);
    if (!kept) {
      notify("Select a little more of the waveform to keep.");
      return;
    }
    projectStore.set((p) => replaceClip(p, clip.id, [kept]));
    setSelection(null);
  };

  const onDuplicate = () => {
    projectStore.set((p) => {
      const c = current(p);
      return c ? replaceClip(p, clip.id, [c, duplicate(c)]) : p;
    });
    notify("Duplicated after this clip.");
  };

  const onSeek = (sec: number) => {
    const clock = getEngine().clock;
    clock.seek(((clip.startBar - 1) * barSeconds(time) + sec) / stepSeconds(time));
  };

  const duration = buffer?.duration ?? 0;
  const bpm = asset?.detectedBpm;
  const bpmLabel = bpm ? `${bpm.toFixed(1)} detected` : analysing ? "Analysing…" : "Not sure";
  const keyLabel = asset?.detectedKey ? `${asset.detectedKey} detected` : analysing ? "Analysing…" : "Not sure";

  const setBpm = (next: number) => assetId && projectStore.set((p) => setAssetBpm(p, assetId, next));

  return (
    <>
      <div className="ce-actions" role="group" aria-label="Clip actions">
        <Button onClick={onSplit}>Split at playhead</Button>
        <Button onClick={onCut} disabled={!selectionInRange} title="Remove the selected range and close the gap">
          Cut out selection
        </Button>
        <Button onClick={onKeep} disabled={!selectionInRange} title="Keep only the selected range">
          Keep selection
        </Button>
        <Button onClick={onDuplicate}>Duplicate</Button>
        <Button onClick={() => edit(reverse)}>{clip.reversed ? "Play forwards" : "Reverse"}</Button>
        <span className="spacer" />
        <label className="ce-zoom">
          <span>Zoom</span>
          <input
            type="range"
            min={1}
            max={MAX_ZOOM}
            step={0.25}
            value={Math.min(MAX_ZOOM, zoom)}
            aria-label="Zoom"
            onChange={(e) => setZoom(Number(e.target.value))}
            style={{ "--pct": `${((Math.min(MAX_ZOOM, zoom) - 1) / (MAX_ZOOM - 1)) * 100}%` } as CSSProperties}
          />
        </label>
      </div>

      <div className="ce-body">
        <div className="ce-wave-col">
          {!assetId && <div className="ce-empty">This clip has no audio yet. Record or drop a file onto it.</div>}
          {assetId && load.state === "loading" && <div className="ce-empty" role="status">Opening the audio…</div>}
          {assetId && load.state === "error" && <div className="ce-empty ce-error" role="alert">{load.message}</div>}
          {load.state === "ready" && assetId && (
            <>
              <WaveformView
                clip={clip}
                buffer={load.buffer}
                index={load.index}
                ratio={ratio}
                time={time}
                view={effView}
                selection={selectionInRange}
                onSelection={setSelection}
                onSeek={onSeek}
                onFade={(side, steps) => edit((c) => setFade(c, side, steps, time))}
                onView={setView}
              />
              {zoom > 1.01 && (
                <input
                  className="ce-scroll"
                  type="range"
                  aria-label="Scroll the waveform"
                  min={0}
                  max={Math.max(0.001, total - effView.span)}
                  step={total / 500}
                  value={effView.start}
                  onChange={(e) => setView({ span: effView.span, start: Number(e.target.value) })}
                />
              )}
              <OverviewStrip
                clip={clip}
                buffer={load.buffer}
                index={load.index}
                ratio={ratio}
                time={time}
                view={effView}
                onTrim={(base, from, to) =>
                  projectStore.set((p) => (current(p) ? replaceClip(p, clip.id, [trimTo(base, from, to, ratio, duration, time)]) : p))
                }
              />
              <p className="ce-hint">Only the part between the gold handles plays.</p>
            </>
          )}
        </div>

        <div className="ce-cards">
          <section className="ce-card" aria-label="Tempo">
            <div className="ce-card-head">
              <h3>Tempo</h3>
              <span className="ce-badge ce-badge-cyan mono">{bpmLabel}</span>
            </div>
            <div className="ce-row">
              <Button className="ce-grow" disabled={!bpm} onClick={() => bpm && setProjectBpm(bpm)}>
                Use for project
              </Button>
              <Button disabled={!bpm} title="Half the detected tempo" onClick={() => bpm && setBpm(bpm / 2)}>
                ½
              </Button>
              <Button disabled={!bpm} title="Double the detected tempo" onClick={() => bpm && setBpm(bpm * 2)}>
                ×2
              </Button>
            </div>
            <Switch
              label={`Follow project tempo (${Math.round(time.bpm * 10) / 10})`}
              checked={clip.warp}
              onChange={(on) => {
                if (on && !bpm) {
                  notify("No tempo was found in this audio, so it cannot follow the project tempo.");
                  return;
                }
                edit((c) => ({ ...c, warp: on }));
              }}
            />
          </section>

          <section className="ce-card" aria-label="Key">
            <div className="ce-card-head">
              <h3>Key</h3>
              <span className="ce-badge ce-badge-pink mono">{keyLabel}</span>
            </div>
            <Switch label="Keep the key when tempo changes" checked={clip.keyLock} onChange={(on) => edit((c) => ({ ...c, keyLock: on }))} />
          </section>

          <section className="ce-card ce-tune" aria-label="Level">
            <h3>Pitch and level</h3>
            <div className="knob-grid ce-knobs">
            <Knob
              label="Pitch"
              min={-12}
              max={12}
              step={1}
              value={clip.pitchSemitones}
              format={(v) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v)} st`}
              defaultValue={0}
              onChange={(v) => edit((c) => setPitch(c, v, c.fineCents))}
            />
            <Knob
              label="Fine tune"
              min={-50}
              max={50}
              step={1}
              value={clip.fineCents}
              format={(v) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v)} ct`}
              defaultValue={0}
              onChange={(v) => edit((c) => setPitch(c, c.pitchSemitones, v))}
            />
            <Knob
              size="lg"
              label="Gain"
              defaultValue={0}
              min={-24}
              max={12}
              step={0.5}
              value={clip.gainDb}
              format={(v) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)} dB`}
              onChange={(v) => edit((c) => ({ ...c, gainDb: v }))}
            />
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
