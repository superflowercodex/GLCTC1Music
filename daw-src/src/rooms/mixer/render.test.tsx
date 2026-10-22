import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeTrack } from "../../project/actions";
import { newProject } from "../../project/model";
import { projectStore, uiStore } from "../../store/project";

// Server rendering has no external-store snapshot of its own; reuse the client one so the real components can be rendered in Node.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const patched = { ...actual, useSyncExternalStore: (subscribe: (cb: () => void) => () => void, get: () => unknown, server?: () => unknown) => actual.useSyncExternalStore(subscribe, get, server ?? get) };
  return { ...patched, default: patched };
});

const { default: Mixer } = await import("../Mixer");
const { EffectsTab } = await import("./EffectsTab");
const { OutputsTab } = await import("./OutputsTab");
const { MasterStrip } = await import("./MasterStrip");
const { ExportSheet } = await import("../../sheets/ExportSheet");
const { ShortcutsSheet } = await import("../../sheets/ShortcutsSheet");
const { ConfirmSheet } = await import("../../sheets/ConfirmSheet");
const { PaletteSheet } = await import("../../sheets/PaletteSheet");
const { ToastRegion } = await import("../../sheets/Toast");
const { confirmSheet, confirmQueue } = await import("../../sheets/confirm");

function seed(trackCount: number): void {
  let project = newProject("Cosmic Lift");
  for (let i = 0; i < trackCount; i++) {
    const t = makeTrack(project, "audio", {
      name: `Track ${i + 1}`,
      inserts: i === 0 ? [{ id: "i1", type: "compressor", bypass: false, params: { threshold: -20 } }, { id: "i2", type: "filter", bypass: true, params: {} }] : [],
      sends: { reverb: 0.3, delay: 0.1 },
    });
    project = { ...project, tracks: [...project.tracks, t] };
  }
  projectStore.set(project);
}

beforeEach(() => {
  seed(5);
  uiStore.set((s) => ({ ...s, sheet: null, toast: null }));
  confirmQueue.set({ requests: [] });
});

describe("mixer room renders", () => {
  it("shows a strip with controls for every track", () => {
    const html = renderToStaticMarkup(<Mixer />);
    expect(html).toContain("Mixer");
    for (let i = 1; i <= 5; i++) expect(html).toContain(`Mute Track ${i}`);
    expect(html).toContain('aria-label="Track 1 volume"');
    expect(html).toContain("Master");
    expect(html).toContain("Limiter");
  });

  it("copes with no tracks and with twelve", () => {
    projectStore.set(newProject("Empty"));
    expect(renderToStaticMarkup(<Mixer />)).toContain("No tracks yet");
    seed(12);
    expect((renderToStaticMarkup(<Mixer />).match(/class="strip /g) ?? []).length).toBe(12);
  });

  it("effects tab lists inserts and sends", () => {
    const html = renderToStaticMarkup(<EffectsTab />);
    expect(html).toContain("Compressor");
    expect(html).toContain("Filter");
    expect(html).toContain("+ Add");
    expect(html).toContain("Track 1 reverb send");
  });

  it("outputs tab explains missing browser support and lists routes", () => {
    const html = renderToStaticMarkup(<OutputsTab />);
    expect(html).toContain("Headphones");
    expect(html).toContain("Booth");
    expect(html).toContain("Cue Track 1 in the headphones");
    expect(html).toContain("This browser cannot");
  });

  it("master strip shows the saved master values", () => {
    projectStore.set((p) => ({ ...p, master: { ...p.master, filterOn: true, filterHz: 1234 } }));
    const html = renderToStaticMarkup(<MasterStrip />);
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("1.2k");
  });
});

describe("sheets render", () => {
  it("export sheet shows the estimate, the Coming soon label and a disabled publish button", () => {
    projectStore.set((p) => ({ ...p, tracks: p.tracks.map((t, i) => (i === 0 ? { ...t, clips: [{ id: "c", kind: "audio" as const, name: "c", startBar: 1, lengthBars: 8, assetId: "a", offsetSec: 0, gainDb: 0, pitchSemitones: 0, fineCents: 0, warp: false, keyLock: false, fadeInSteps: 0, fadeOutSteps: 0 }] } : t)) }));
    const html = renderToStaticMarkup(<ExportSheet onClose={() => undefined} />);
    expect(html).toContain("Export WAV");
    expect(html).toContain("Coming soon");
    expect(html).toContain("0:16");
    expect(html).toContain('role="dialog"');
  });

  it("export sheet on an empty project says why it cannot export", () => {
    projectStore.set(newProject("Empty"));
    const html = renderToStaticMarkup(<ExportSheet onClose={() => undefined} />);
    expect(html).toContain("nothing to export");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Export WAV/);
  });

  it("shortcuts sheet lists the groups", () => {
    const html = renderToStaticMarkup(<ShortcutsSheet onClose={() => undefined} />);
    for (const word of ["Playback", "Editing", "Rooms", "Everywhere", "Tap tempo"]) expect(html).toContain(word);
  });

  it("palette lists actions and rooms", () => {
    const html = renderToStaticMarkup(<PaletteSheet onClose={() => undefined} />);
    expect(html).toContain('role="combobox"');
    expect(html).toContain("Tap tempo");
  });

  it("confirm sheet shows the question and its buttons", () => {
    void confirmSheet({ title: "You already have “Cosmic Lift”", message: "Same name.", confirmLabel: "Replace", cancelLabel: "Keep both" });
    const html = renderToStaticMarkup(<ConfirmSheet />);
    expect(html).toContain("You already have");
    expect(html).toContain("Replace");
    expect(html).toContain("Keep both");
  });

  it("toast region is a polite live region", () => {
    uiStore.set((s) => ({ ...s, toast: { id: 1, text: "Saved." } }));
    const html = renderToStaticMarkup(<ToastRegion />);
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("Saved.");
  });
});
