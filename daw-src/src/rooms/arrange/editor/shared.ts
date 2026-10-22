import { useStore } from "../../../store/store";
import { projectStore, uiStore } from "../../../store/project";
import { findClip, type TimeBase } from "./clipEdits";
import type { Asset, Clip, Track } from "../../../project/model";

export function notify(text: string): void {
  uiStore.set((u) => ({ ...u, toast: { id: Date.now(), text } }));
}

export interface ClipContext {
  clip: Clip | undefined;
  track: Track | undefined;
  asset: Asset | undefined;
  time: TimeBase;
}

/** The clip being edited with its track and asset; each field only changes when that object does. */
export function useClipContext(clipId: string): ClipContext {
  const clip = useStore(projectStore, (p) => findClip(p, clipId)?.clip);
  const track = useStore(projectStore, (p) => p.tracks.find((t) => t.clips.some((c) => c.id === clipId)));
  const asset = useStore(projectStore, (p) => {
    const assetId = findClip(p, clipId)?.clip.assetId;
    return assetId ? p.assets.find((a) => a.id === assetId) : undefined;
  });
  const bpm = useStore(projectStore, (p) => p.bpm);
  const beatsPerBar = useStore(projectStore, (p) => p.beatsPerBar);
  return { clip, track, asset, time: { bpm, beatsPerBar } };
}

/** 1 step is a 16th, so 2 steps read "1/8", 4 steps "1/4", and anything else "n/16". */
export function fadeLabel(steps: number): string {
  if (steps <= 0) return "off";
  let num = steps;
  let den = 16;
  while (num % 2 === 0 && den > 1) {
    num /= 2;
    den /= 2;
  }
  return den === 1 ? (num === 1 ? "1 bar" : `${num} bars`) : `${num}/${den}`;
}

export function formatSeconds(sec: number): string {
  return sec < 10 ? `${sec.toFixed(2)} s` : `${sec.toFixed(1)} s`;
}

/** The clip's track colour, read from the editor's --a1, with an alpha for the waveform body. */
export function accent(el: HTMLElement, alpha: string): string {
  const c = getComputedStyle(el).getPropertyValue("--a1").trim();
  if (/^#[0-9a-f]{6}$/i.test(c)) return `${c}${alpha}`;
  return c ? `color-mix(in srgb, ${c} ${Math.round((parseInt(alpha, 16) / 255) * 100)}%, transparent)` : "rgba(121,235,255,0.7)";
}
