import { renderToString } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import Arrange from "../Arrange";
import { addClip, addTrack, makeClip, makeTrack } from "../../project/actions";
import { newProject, type Project } from "../../project/model";
import { projectStore, uiStore } from "../../store/project";
import { selectClips } from "./selection";

// Server rendering needs a server snapshot that the shared hook does not provide; reading the store directly is equivalent here.
vi.mock("../../store/store", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../store/store")>();
  return { ...real, useStore: <T, S>(store: { get(): T }, selector: (s: T) => S) => selector(store.get()) };
});

function seeded() {
  let p: Project = {
    ...newProject("Cosmic Lift"),
    assets: [{ id: "a", kind: "audio" as const, name: "Vocal take", mime: "audio/wav", bytes: 1, durationSec: 8, addedAt: 0 }],
  };
  const names = ["Drums", "Bass", "Lead", "Vocal", "Visuals"] as const;
  const kinds = ["instrument", "instrument", "instrument", "audio", "video"] as const;
  const clipKinds = ["pattern", "pattern", "midi", "audio", "video"] as const;
  names.forEach((name, i) => {
    const track = makeTrack(p, kinds[i], { name });
    p = addTrack(p, track);
    p = addClip(
      p,
      track.id,
      makeClip({
        kind: clipKinds[i],
        name: `${name} clip`,
        startBar: 1 + i,
        lengthBars: 4,
        assetId: clipKinds[i] === "audio" ? "a" : undefined,
        notes: clipKinds[i] === "midi" ? [] : undefined,
      }),
    );
  });
  return p;
}

describe("Arrange room", () => {
  // React warns that layout effects do not run on the server; that is expected for a string render.
  const quiet = vi.spyOn(console, "error");
  beforeAll(() => quiet.mockImplementation(() => undefined));
  afterAll(() => quiet.mockRestore());

  it("renders an empty project with the add-track chips and an invitation", () => {
    projectStore.set(newProject("Empty"));
    const html = renderToString(<Arrange />);
    expect(html).toContain("A blank canvas");
    for (const label of ["Audio", "Instrument", "Drums", "Video"]) expect(html).toContain(`>${label}</button>`);
  });

  it("renders all five tracks, their clips and mute and solo buttons", () => {
    projectStore.set(seeded());
    const html = renderToString(<Arrange />);
    for (const name of ["Drums", "Bass", "Lead", "Vocal", "Visuals"]) {
      expect(html).toContain(`Mute ${name}`);
      expect(html).toContain(`Solo ${name}`);
      expect(html).toContain(`${name} clip`);
    }
    expect(html).toContain('aria-label="Loop start bar"');
  });

  it("gives every track header a volume slider tied to the track's gain, and offers Avoid overlaps", () => {
    const p = seeded();
    p.tracks[0] = { ...p.tracks[0], gainDb: -6 };
    projectStore.set(p);
    const html = renderToString(<Arrange />);
    for (const name of ["Drums", "Bass", "Lead", "Vocal", "Visuals"]) expect(html).toContain(`aria-label="${name} volume"`);
    expect(html).toContain('aria-valuetext="−6.0 dB"');
    expect(html).toContain('aria-label="Avoid overlaps"');
  });

  it("shows the floating inspector for a selected clip", () => {
    const p = seeded();
    projectStore.set(p);
    selectClips([p.tracks[3].clips[0].id]);
    const html = renderToString(<Arrange />);
    expect(html).toContain("Selected clip");
    expect(html).toContain("Open editor");
    expect(html).toContain("Duplicate");
    selectClips([]);
    uiStore.set((s) => ({ ...s, selectedTrackId: null }));
  });
});
