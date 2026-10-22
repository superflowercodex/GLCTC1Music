import { useEffect, useState, type CSSProperties } from "react";
import { clipEndBar, GAIN_DB_RANGE, minClipBars, moveClip, PITCH_RANGE, resizeClip, updateClip, updateClips } from "../../project/actions";
import type { Clip, Project, Track } from "../../project/model";
import { projectStore } from "../../store/project";
import { Slider } from "../../ui/controls";
import { deleteSelected, duplicateSelected, splitAtPlayhead } from "./ops";
import { formatBarPosition } from "./timeline";

function NumField({ label, value, step, min, onCommit }: { label: string; value: number; step: number; min: number; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  useEffect(() => setDraft(null), [value]);
  const commit = () => {
    if (draft === null) return;
    const n = Number(draft);
    setDraft(null);
    if (Number.isFinite(n)) onCommit(Math.max(min, n));
  };
  return (
    <label className="num-field">
      <span>{label}</span>
      <input
        className="mono"
        type="number"
        inputMode="decimal"
        min={min}
        step={step}
        value={draft ?? String(Math.round(value * 1000) / 1000)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setDraft(null);
        }}
        aria-label={label}
      />
    </label>
  );
}

function fadeLabel(steps: number): string {
  if (steps <= 0) return "Off";
  const beats = steps / 4;
  return `${Math.round(beats * 100) / 100} beat${beats === 1 ? "" : "s"}`;
}

interface Props {
  project: Project;
  clips: readonly Clip[];
  tracks: readonly Track[];
  onOpenEditor: (clipId: string) => void;
}

/** Floats over the bottom of the timeline. Sliders act on every selected clip; the numeric fields on a single one. */
export function Inspector({ project, clips, tracks, onOpenEditor }: Props) {
  const first = clips[0];
  const single = clips.length === 1;
  const track = tracks.find((t) => t.clips.some((c) => c.id === first.id));
  const ids = clips.map((c) => c.id);
  const spb = project.beatsPerBar * 4;
  const color = track?.color ?? "#79ebff";
  const hasPitch = clips.every((c) => c.kind === "audio");
  const hasGain = clips.every((c) => c.kind === "audio" || c.kind === "video");
  const maxFade = Math.max(1, Math.min(spb, (first.lengthBars * spb) / 2));
  const editable = single && first.kind !== "video" && first.kind !== "image";
  const grid = Math.max(0.0625, minClipBars(project));

  const patch = (p: Partial<Omit<Clip, "id" | "startBar" | "lengthBars">>) => projectStore.set((s) => updateClips(s, ids, p));

  return (
    <aside className="arr-inspector" aria-label="Selected clip" style={{ "--c": color } as CSSProperties}>
      <div className="insp-id">
        <span className="insp-dot" />
        <div>
          {single ? (
            <input
              className="insp-name"
              aria-label="Clip name"
              key={first.id + first.name}
              defaultValue={first.name}
              onBlur={(e) => e.currentTarget.value.trim() && projectStore.set((s) => updateClip(s, first.id, { name: e.currentTarget.value.trim() }))}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            />
          ) : (
            <div className="insp-name">{clips.length} clips</div>
          )}
          <div className="mono insp-meta">
            {single
              ? `${track?.name ?? ""} · Bar ${formatBarPosition(first.startBar)}–${formatBarPosition(clipEndBar(first))}`
              : "Edits apply to all"}
          </div>
        </div>
      </div>

      <div className="insp-sliders">
        {hasGain && (
          <Slider
            label="Gain"
            value={first.gainDb}
            min={GAIN_DB_RANGE.min}
            max={GAIN_DB_RANGE.max}
            step={0.5}
            onChange={(v) => patch({ gainDb: v })}
            format={(v) => (v <= GAIN_DB_RANGE.min ? "Off" : `${v > 0 ? "+" : ""}${v} dB`)}
          />
        )}
        {hasPitch && (
          <Slider
            label="Pitch"
            value={first.pitchSemitones}
            min={PITCH_RANGE.min}
            max={PITCH_RANGE.max}
            step={1}
            onChange={(v) => patch({ pitchSemitones: v })}
            format={(v) => `${v > 0 ? "+" : ""}${v} st`}
          />
        )}
        <Slider
          label="Fade"
          value={Math.min(maxFade, Math.max(first.fadeInSteps, first.fadeOutSteps))}
          min={0}
          max={maxFade}
          step={1}
          onChange={(v) => patch({ fadeInSteps: v, fadeOutSteps: v })}
          format={fadeLabel}
        />
      </div>

      {single && (
        <div className="insp-fields">
          <NumField
            label="Start (bar)"
            value={first.startBar}
            step={grid}
            min={1}
            onCommit={(v) => projectStore.set((s) => moveClip(s, first.id, { startBar: v }))}
          />
          <NumField
            label="Length (bars)"
            value={first.lengthBars}
            step={grid}
            min={minClipBars(project)}
            onCommit={(v) => projectStore.set((s) => resizeClip(s, first.id, "end", first.startBar + v))}
          />
        </div>
      )}

      <div className="insp-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={!editable}
          onClick={() => onOpenEditor(first.id)}
          title={editable ? undefined : "Video and image clips have no editor"}
        >
          Open editor
        </button>
        <button type="button" className="btn" onClick={splitAtPlayhead}>
          Split
        </button>
        <button type="button" className="btn" onClick={duplicateSelected}>
          Duplicate
        </button>
        <button type="button" className="btn btn-danger" onClick={deleteSelected}>
          Delete
        </button>
      </div>
    </aside>
  );
}
