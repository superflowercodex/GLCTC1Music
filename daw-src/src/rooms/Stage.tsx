import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getEngine, peekEngine } from "../audio/engine";
import { stepDuration } from "../audio/clock";
import { barBeat, togglePlay } from "../audio/transport";
import { getAssetBlob } from "../project/db";
import type { Asset, Clip } from "../project/model";
import { lsGet, lsSet } from "../storage";
import { projectStore, uiStore } from "../store/project";
import { useStore } from "../store/store";
import { Button, Seg } from "../ui/controls";
import { Caption } from "../ui/Caption";
import { Knob } from "../ui/Knob";
import { LedMeter } from "../ui/LedMeter";
import { prefersReducedMotion, useRaf } from "../ui/hooks";
import { Icon } from "../ui/Icon";
import { RoomFrame } from "../ui/RoomFrame";
import { CaptureError, startCapture, type StageRecording } from "./stage/capture";
import "./stage/stage.css";
import {
  addStageClip,
  barSeconds,
  clipRangeSec,
  formatClock,
  frameAspect,
  MAX_SHOW_BARS,
  MAX_SPEED,
  MIN_SPEED,
  stageClips,
  stageOptions,
  timelineEndBar,
  updateStageClip,
} from "./stage/stageModel";
import type { StageScene } from "./stage/stageScene";

// masterLevel() is RMS; the transport lifts it by sqrt(2) so the LEDs sit near true peak.
const masterPeak = (): number => (peekEngine()?.masterLevel() ?? 0) * Math.SQRT2;

function toast(text: string): void {
  uiStore.set((s) => ({ ...s, toast: { id: Date.now(), text } }));
}

function reason(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const thumbCache = new Map<string, string>();

async function makeThumb(assetId: string, kind: "video" | "image"): Promise<string | undefined> {
  const cached = thumbCache.get(assetId);
  if (cached) return cached;
  const blob = await getAssetBlob(assetId);
  if (!blob) return undefined;
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 180;
  const g = canvas.getContext("2d");
  if (!g) return undefined;
  if (kind === "image") {
    const bitmap = await createImageBitmap(blob);
    const scale = Math.max(320 / bitmap.width, 180 / bitmap.height);
    g.drawImage(bitmap, (320 - bitmap.width * scale) / 2, (180 - bitmap.height * scale) / 2, bitmap.width * scale, bitmap.height * scale);
    bitmap.close();
  } else {
    const url = URL.createObjectURL(blob);
    try {
      const video = document.createElement("video");
      video.muted = true;
      video.preload = "auto";
      video.src = url;
      await new Promise<void>((resolve, reject) => {
        video.onloadeddata = () => resolve();
        video.onerror = () => reject(new Error("unsupported video"));
      });
      video.currentTime = Math.min(0.1, (video.duration || 1) / 2);
      await new Promise<void>((resolve) => {
        video.onseeked = () => resolve();
      });
      const scale = Math.max(320 / video.videoWidth, 180 / video.videoHeight);
      g.drawImage(video, (320 - video.videoWidth * scale) / 2, (180 - video.videoHeight * scale) / 2, video.videoWidth * scale, video.videoHeight * scale);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  const data = canvas.toDataURL("image/jpeg", 0.7);
  thumbCache.set(assetId, data);
  return data;
}

function useThumb(assetId: string | undefined, kind: "video" | "image"): string | undefined {
  const [src, setSrc] = useState<string | undefined>(assetId ? thumbCache.get(assetId) : undefined);
  useEffect(() => {
    if (!assetId) return;
    let alive = true;
    // A thumbnail is decoration: when decoding fails the card keeps its gradient and the preview reports the real error.
    makeThumb(assetId, kind).then((s) => alive && setSrc(s), () => undefined);
    return () => {
      alive = false;
    };
  }, [assetId, kind]);
  return src;
}

function ClipCard({ clip, selected, onPick }: { clip: Clip; selected: boolean; onPick: () => void }) {
  const thumb = useThumb(clip.assetId, clip.kind === "image" ? "image" : "video");
  return (
    <button type="button" className={`stage-clip ${selected ? "sel" : ""}`} aria-pressed={selected} onClick={onPick}>
      <span className="stage-thumb" style={thumb ? { backgroundImage: `url(${thumb})` } : undefined}>
        <span className="tag">{clip.kind === "image" ? "Image" : "Video"}</span>
      </span>
      <span className="stage-clip-text">
        <b>{clip.name}</b>
        <small>
          bar {clip.startBar} to {clip.startBar + clip.lengthBars}
        </small>
      </span>
    </button>
  );
}

export default function Stage() {
  const name = useStore(projectStore, (p) => p.name);
  const aspect = useStore(projectStore, (p) => p.stageAspect);
  const tracks = useStore(projectStore, (p) => p.tracks);
  const assets = useStore(projectStore, (p) => p.assets);
  const selectedId = useStore(uiStore, (s) => s.selectedClipId);

  const clips = useMemo(() => stageClips(projectStore.get()), [tracks]);
  const selected = clips.find((c) => c.id === selectedId) ?? clips[0];

  const viewRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<StageScene | null>(null);
  const recordingRef = useRef<StageRecording | null>(null);
  const [sceneReady, setSceneReady] = useState(false);
  const [sceneError, setSceneError] = useState<string | null>(null);
  const [visuals, setVisuals] = useState(() => lsGet("stage.visuals", true));
  const [fullscreen, setFullscreen] = useState(false);
  const [picker, setPicker] = useState(false);
  const [recording, setRecording] = useState(false);
  const [playing, setPlaying] = useState(false);

  const timeRef = useRef<HTMLSpanElement>(null);
  const endRef = useRef<HTMLSpanElement>(null);
  const scrubRef = useRef<HTMLInputElement>(null);
  const scrubbing = useRef(false);
  const lastError = useRef({ text: "", at: 0 });

  const reportError = useCallback((text: string) => {
    const now = Date.now();
    if (lastError.current.text === text && now - lastError.current.at < 5000) return;
    lastError.current = { text, at: now };
    toast(text);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const canvas = canvasRef.current;
    if (!canvas) return;
    (async () => {
      const [THREE, { StageScene: Scene }] = await Promise.all([import("three"), import("./stage/stageScene")]);
      if (cancelled) return;
      try {
        const scene = new Scene(
          THREE,
          canvas,
          {
            project: () => projectStore.get(),
            timeSec: () => {
              const p = projectStore.get();
              const engine = peekEngine();
              return engine ? engine.clock.position() * stepDuration(p.bpm) : 0;
            },
            playing: () => peekEngine()?.clock.playing ?? false,
            spectrum: (out) => {
              const engine = peekEngine();
              if (!engine) return false;
              engine.analyser.getByteFrequencyData(out);
              return true;
            },
            loadBlob: getAssetBlob,
            onError: reportError,
          },
          { reducedMotion: prefersReducedMotion(), small: window.innerWidth < 700 },
        );
        sceneRef.current = scene;
        scene.setVisuals(lsGet("stage.visuals", true));
        scene.start();
        setSceneReady(true);
      } catch (e) {
        setSceneError(`The 3D stage could not start: ${reason(e)}`);
      }
    })().catch((e: unknown) => setSceneError(`The 3D stage could not load: ${reason(e)}`));
    return () => {
      cancelled = true;
      sceneRef.current?.dispose();
      sceneRef.current = null;
      setSceneReady(false);
      const rec = recordingRef.current;
      recordingRef.current = null;
      void rec?.stop().catch(() => undefined);
    };
  }, [reportError]);

  useEffect(() => {
    if (sceneReady) sceneRef.current?.setClips(clips);
  }, [clips, sceneReady]);

  useEffect(() => {
    sceneRef.current?.setVisuals(visuals);
    lsSet("stage.visuals", visuals);
  }, [visuals, sceneReady]);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === viewRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const endBar = Math.max(timelineEndBar(projectStore.get()), 9);

  useRaf(() => {
    const p = projectStore.get();
    const engine = peekEngine();
    const step = engine ? engine.clock.position() : 0;
    const sec = step * stepDuration(p.bpm);
    const total = (Math.max(timelineEndBar(p), 9) - 1) * barSeconds(p.bpm, p.beatsPerBar);
    // Only write when the text changes: a repaint under the glass transport re-runs its blur.
    const now = formatClock(sec);
    const end = formatClock(total);
    if (timeRef.current && timeRef.current.textContent !== now) timeRef.current.textContent = now;
    if (endRef.current && endRef.current.textContent !== end) endRef.current.textContent = end;
    const scrub = scrubRef.current;
    if (scrub && !scrubbing.current) {
      scrub.max = String(total);
      scrub.value = String(Math.min(sec, total));
      scrub.style.setProperty("--pct", `${total > 0 ? (Math.min(sec, total) / total) * 100 : 0}%`);
    }
    const isPlaying = engine?.clock.playing ?? false;
    setPlaying((prev) => (prev === isPlaying ? prev : isPlaying));
  });

  function seekTo(sec: number): void {
    const p = projectStore.get();
    getEngine().clock.seek(sec / stepDuration(p.bpm));
    sceneRef.current?.invalidate();
    scrubRef.current?.style.setProperty("--pct", `${(sec / Math.max(0.001, Number(scrubRef.current.max))) * 100}%`);
  }

  async function toggleFullscreen(): Promise<void> {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (viewRef.current?.requestFullscreen) await viewRef.current.requestFullscreen();
      else toast("This browser does not allow fullscreen for the stage.");
    } catch (e) {
      toast(`Fullscreen was refused: ${reason(e)}`);
    }
  }

  async function toggleCapture(): Promise<void> {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      if (recordingRef.current) {
        const rec = recordingRef.current;
        recordingRef.current = null;
        setRecording(false);
        const blob = await rec.stop();
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `${projectStore.get().name || "stage"}.${rec.extension}`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
        toast("Stage video saved to your downloads.");
        return;
      }
      await getEngine().resume();
      recordingRef.current = startCapture(canvas, peekEngine());
      setRecording(true);
      toast("Recording the stage. Press play, then stop the recording to save it.");
    } catch (e) {
      recordingRef.current = null;
      setRecording(false);
      toast(e instanceof CaptureError ? e.message : `Recording failed: ${reason(e)}`);
    }
  }

  function addAsset(asset: Asset): void {
    try {
      const p = projectStore.get();
      const bar = barBeat(peekEngine()?.clock.position() ?? 0, p.beatsPerBar).bar;
      const next = addStageClip(p, asset, bar);
      projectStore.set(next);
      const added = stageClips(next).find((c) => c.assetId === asset.id && c.startBar === bar);
      if (added) uiStore.set((s) => ({ ...s, selectedClipId: added.id }));
      setPicker(false);
    } catch (e) {
      toast(reason(e));
    }
  }

  function edit(change: (c: Clip) => Clip): void {
    if (selected) projectStore.set((p) => updateStageClip(p, selected.id, change));
  }

  function removeSelected(): void {
    if (!selected) return;
    projectStore.set((p) => ({ ...p, tracks: p.tracks.map((t) => ({ ...t, clips: t.clips.filter((c) => c.id !== selected.id) })) }));
    uiStore.set((s) => ({ ...s, selectedClipId: null }));
  }

  const options = selected ? stageOptions(selected) : undefined;
  const mediaAssets = assets.filter((a) => a.kind === "video" || a.kind === "image");
  const wide = aspect === "wide";
  const bpm = projectStore.get().bpm;
  const span = Math.max(1, endBar - 1);
  const selThumb = useThumb(selected?.assetId, selected?.kind === "image" ? "image" : "video");

  return (
    <RoomFrame
      eyebrow="Visuals follow the playhead"
      title="Stage"
      hideTransport
      actions={
        <div className="stage-tools">
          <Seg
            label="Stage shape"
            value={aspect}
            onChange={(v) => projectStore.set((p) => ({ ...p, stageAspect: v }))}
            options={[
              { value: "wide", label: "16:9" },
              { value: "phone", label: "9:16" },
            ]}
          />
          <div className="stage-rail" role="toolbar" aria-label="Stage controls">
            <button type="button" className={`stage-rail-b ${visuals ? "on" : ""}`} aria-pressed={visuals} title="Galaxy visuals that listen to the music" onClick={() => setVisuals(!visuals)}>
              <span className="stage-led" />
              Visuals
            </button>
            <button type="button" className={`stage-rail-b ${recording ? "rec" : ""}`} aria-pressed={recording} onClick={() => void toggleCapture()}>
              <span className="stage-recdot" />
              {recording ? "Stop and save" : "Capture"}
            </button>
            <button type="button" className="stage-rail-b" onClick={() => void toggleFullscreen()}>
              <Icon name="fullscreen" size={18} />
              Fullscreen
            </button>
          </div>
        </div>
      }
    >
      <div className="stage-body frost-sheet">
        <section className="stage-main" aria-label="Preview">
          <div className="stage-view" ref={viewRef} data-aspect={aspect}>
            <div className="stage-frame" style={{ "--ar": frameAspect(aspect) } as React.CSSProperties}>
              <canvas ref={canvasRef} aria-label={`Stage preview, ${wide ? "widescreen" : "phone"} shape`} role="img" />
              {sceneError ? (
                <div className="stage-title">
                  <div className="stage-error" role="alert">
                    {sceneError}
                  </div>
                </div>
              ) : (
                clips.length === 0 && (
                  <div className="stage-title">
                    <span className="stage-eyebrow">Now showing</span>
                    <strong>{name.toUpperCase()}</strong>
                    <button type="button" className="btn btn-primary stage-title-cta" onClick={() => setPicker(true)}>
                      <Icon name="plus" size={18} />
                      Add a video or picture
                    </button>
                  </div>
                )
              )}
              {recording && <span className="stage-live">REC</span>}
            </div>
            {fullscreen && (
              <button type="button" className="btn stage-fs-exit" onClick={() => void toggleFullscreen()}>
                Exit fullscreen
              </button>
            )}
          </div>

          <div className={`transport stage-bar ${playing ? "is-playing" : ""}`}>
            <button type="button" className="play-btn" aria-label={playing ? "Pause" : "Play preview"} onClick={() => void togglePlay()}>
              <Icon name={playing ? "pause" : "play"} size={20} />
            </button>
            <span className="mono transport-pos" ref={timeRef}>
              00:00
            </span>
            <div className="stage-scrub-wrap">
              <div className="stage-marks" aria-hidden="true">
                {clips.map((c) => {
                  const { start, end } = clipRangeSec(c, bpm, projectStore.get().beatsPerBar);
                  const total = span * barSeconds(bpm, projectStore.get().beatsPerBar);
                  return <i key={c.id} className={c.id === selected?.id ? "sel" : ""} style={{ left: `${(start / total) * 100}%`, width: `${Math.max(0.5, ((Math.min(end, total) - start) / total) * 100)}%` }} />;
                })}
              </div>
              <input
                ref={scrubRef}
                className="stage-scrub"
                type="range"
                min={0}
                max={(endBar - 1) * 2}
                step={0.01}
                defaultValue={0}
                aria-label="Position"
                onPointerDown={() => (scrubbing.current = true)}
                onPointerUp={() => (scrubbing.current = false)}
                onBlur={() => (scrubbing.current = false)}
                onChange={(e) => seekTo(Number(e.target.value))}
              />
            </div>
            <span className="mono tp-end" ref={endRef}>
              00:00
            </span>
            <LedMeter getLevel={masterPeak} label="Master output level" horizontal className="tp-meter" scale={{ segments: 20 }} />
          </div>

          <div className="stage-strip" aria-label="Clips">
            {clips.map((c) => (
              <ClipCard key={c.id} clip={c} selected={c.id === selected?.id} onPick={() => uiStore.set((s) => ({ ...s, selectedClipId: c.id }))} />
            ))}
            <button type="button" className="stage-add" aria-expanded={picker} onClick={() => setPicker((v) => !v)}>
              <Icon name="plus" size={20} />
              Add
            </button>
            {picker && (
              <div className="stage-picker" role="menu" aria-label="Add a video or picture">
                {mediaAssets.length === 0 ? (
                  <p>
                    No videos or pictures yet. Import some in <a href="#/library" style={{ color: "var(--cyan)" }}>Library</a>, then add them here.
                  </p>
                ) : (
                  mediaAssets.map((a) => (
                    <button key={a.id} type="button" role="menuitem" onClick={() => addAsset(a)}>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</span>
                      <span className="tag">{a.kind}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </section>

        <aside className="stage-side" aria-label="Clip">
          <Caption aside={selected ? (selected.kind === "image" ? "Image" : "Video") : "None selected"}>Clip</Caption>
          {selected && options ? (
            <>
              <div className="stage-sel">
                <span className="stage-sel-thumb" style={selThumb ? { backgroundImage: `url(${selThumb})` } : undefined} />
                <div className="stage-sel-t">
                  <h2>{selected.name}</h2>
                  <span className="mono">
                    bar {selected.startBar} to {selected.startBar + selected.lengthBars}
                  </span>
                </div>
              </div>
              <div className="stage-field">
                <Caption>Fit</Caption>
                <Seg
                  label="Fit"
                  value={options.fit}
                  onChange={(fit) => edit((c) => ({ ...c, stage: { ...stageOptions(c), fit } }))}
                  options={[
                    { value: "fill", label: "Fill" },
                    { value: "fit", label: "Fit" },
                    { value: "stretch", label: "Stretch" },
                  ]}
                />
              </div>
              <div className="well stage-knobs">
                <Knob label="Opacity" size="lg" value={options.opacity} min={0} max={1} step={0.01} defaultValue={1} format={(v) => `${Math.round(v * 100)}%`} onChange={(opacity) => edit((c) => ({ ...c, stage: { ...stageOptions(c), opacity } }))} />
                <Knob label="Speed" size="lg" disabled={selected.kind !== "video"} value={options.speed} min={MIN_SPEED} max={MAX_SPEED} step={0.05} defaultValue={1} format={(v) => `${v.toFixed(2)}×`} onChange={(speed) => edit((c) => ({ ...c, stage: { ...stageOptions(c), speed } }))} />
                <Knob label="Show for" size="lg" value={selected.lengthBars} min={1} max={MAX_SHOW_BARS} step={1} defaultValue={4} format={(v) => `${v} bar${v === 1 ? "" : "s"}`} onChange={(lengthBars) => edit((c) => ({ ...c, lengthBars }))} />
              </div>
              <p className="hint">{selected.kind === "image" ? "Pictures stay on screen for as long as their clip lasts on the timeline." : "Videos play in time with the transport and loop if the clip is longer than the file."}</p>
              <Button variant="danger" onClick={removeSelected}>
                Remove from stage
              </Button>
            </>
          ) : (
            <div className="stage-side-empty">
              <div className="well stage-knobs ghost" aria-hidden="true">
                <Knob label="Opacity" size="lg" disabled value={1} min={0} max={1} onChange={() => undefined} format={() => "100%"} />
                <Knob label="Speed" size="lg" disabled value={1} min={MIN_SPEED} max={MAX_SPEED} onChange={() => undefined} format={() => "1.00×"} />
                <Knob label="Show for" size="lg" disabled value={4} min={1} max={MAX_SHOW_BARS} onChange={() => undefined} format={() => "4 bars"} />
              </div>
              <p className="hint">Pick a clip below to change how it fills the stage, how see-through it is and how long it shows. The galaxy behind it listens to the music.</p>
            </div>
          )}
        </aside>
      </div>
    </RoomFrame>
  );
}
