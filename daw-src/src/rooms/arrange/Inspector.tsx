import { useEffect, useState, type CSSProperties } from "react";
import { clipEndBar, GAIN_DB_RANGE, minClipBars, moveClip, PITCH_RANGE, resizeClip, updateClip, updateClips } from "../../project/actions";
import type { Clip, Project, Track } from "../../project/model";
import { projectStore } from "../../store/project";
import { Knob } from "../../ui/Knob";
import { deleteSelected, duplicateSelected, splitAtPlayhead } from "./ops";
import { selectClips } from "./selection";
import { formatBarPosition } from "./timeline";
import { Icon } from "../../ui/Icon";
import { isCompact, useLayoutMode } from "../../ui/layoutMode";

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

/** The value every item shares, or null when they differ. */
export function sharedValue<T>(items: readonly T[], read: (item: T) => number): number | null {
  const first = read(items[0]);
  return items.every((i) => read(i) === first) ? first : null;
}

interface Props {
  project: Project;
  clips: readonly Clip[];
  tracks: readonly Track[];
  onOpenEditor: (clipId: string) => void;
}

/** Sits under the timeline. Knobs act on every selected clip; the numeric fields on a single one. */
export function Inspector({ project, clips, tracks, onOpenEditor }: Props) {
  const first = clips[0];
  const single = clips.length === 1;
  const track = tracks.find((t) => t.clips.some((c) => c.id === first.id));
  const ids = clips.map((c) => c.id);
  const spb = project.beatsPerBar * 4;
  const color = track?.color ?? "#79ebff";
  const hasPitch = clips.every((c) => c.kind === "audio");
  const hasGain = clips.every((c) => c.kind === "audio" || c.kind === "video");
  const maxFade = Math.max(1, Math.min(spb, ...clips.map((c) => (c.lengthBars * spb) / 2)));
  const editable = single && first.kind !== "video" && first.kind !== "image";
  const grid = Math.max(0.0625, minClipBars(project));

  const gain = sharedValue(clips, (c) => c.gainDb);
  const pitch = sharedValue(clips, (c) => c.pitchSemitones);
  const fade = sharedValue(clips, (c) => Math.max(c.fadeInSteps, c.fadeOutSteps));
  const trackCount = new Set(tracks.filter((t) => t.clips.some((c) => ids.includes(c.id))).map((t) => t.id)).size;
  const spanFrom = Math.min(...clips.map((c) => c.startBar));
  const spanTo = Math.max(...clips.map(clipEndBar));

  const patch = (p: Partial<Omit<Clip, "id" | "startBar" | "lengthBars">>) => projectStore.set((s) => updateClips(s, ids, p));
  // On phones the inspector is a bottom sheet over the timeline, so it needs its own way out: deselect.
  const compact = isCompact(useLayoutMode());

  return (
    <aside className="arr-inspector" aria-label={single ? "Selected clip" : "Selected clips"} style={{ "--c": color } as CSSProperties}>
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
            <div className="insp-name">{clips.length} clips selected</div>
          )}
          <div className="mono insp-meta">
            {single
              ? `${track?.name ?? ""} · Bar ${formatBarPosition(first.startBar)}–${formatBarPosition(clipEndBar(first))}`
              : `${trackCount} track${trackCount === 1 ? "" : "s"} · Bar ${formatBarPosition(spanFrom)}–${formatBarPosition(spanTo)}`}
          </div>
        </div>
        {compact && (
          <button type="button" className="icon-btn insp-close" aria-label="Done, deselect" onClick={() => selectClips([])}>
            <Icon name="close" size={22} />
          </button>
        )}
      </div>

      <div className="insp-knobs">
        {hasGain && (
          <Knob
            size="sm"
            label="Gain"
            color={color}
            value={gain ?? first.gainDb}
            min={GAIN_DB_RANGE.min}
            max={GAIN_DB_RANGE.max}
            step={0.5}
            defaultValue={0}
            onChange={(v) => patch({ gainDb: v })}
            format={(v) => (gain === null ? "Mixed" : v <= GAIN_DB_RANGE.min ? "Off" : `${v > 0 ? "+" : ""}${v} dB`)}
          />
        )}
        {hasPitch && (
          <Knob
            size="sm"
            label="Pitch"
            color={color}
            value={pitch ?? first.pitchSemitones}
            min={PITCH_RANGE.min}
            max={PITCH_RANGE.max}
            step={1}
            defaultValue={0}
            onChange={(v) => patch({ pitchSemitones: v })}
            format={(v) => (pitch === null ? "Mixed" : `${v > 0 ? "+" : ""}${v} st`)}
          />
        )}
        <Knob
          size="sm"
          label="Fade"
          color={color}
          value={Math.min(maxFade, fade ?? Math.max(first.fadeInSteps, first.fadeOutSteps))}
          min={0}
          max={maxFade}
          step={1}
          defaultValue={0}
          onChange={(v) => patch({ fadeInSteps: v, fadeOutSteps: v })}
          format={(v) => (fade === null ? "Mixed" : fadeLabel(v))}
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
        {!single && (
          <button type="button" className="btn btn-sm" onClick={() => selectClips([])}>
            Deselect
          </button>
        )}
        <button type="button" className="btn btn-sm" onClick={splitAtPlayhead}>
          Split
        </button>
        <button type="button" className="btn btn-sm" onClick={duplicateSelected}>
          Duplicate
        </button>
        <button type="button" className="btn btn-danger btn-sm" onClick={deleteSelected}>
          Delete
        </button>
      </div>
    </aside>
  );
}
