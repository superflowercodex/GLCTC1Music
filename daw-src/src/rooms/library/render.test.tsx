import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import Instruments from "../Instruments";
import Library from "../Library";
import { newProject } from "../../project/model";
import { projectStore } from "../../store/project";
import { MediaTab } from "./MediaTab";
import { PluginsTab } from "./PluginsTab";
import { ProjectsTab } from "./ProjectsTab";

// Server rendering needs a server snapshot that the shared hook does not provide; reading the store directly is equivalent here.
vi.mock("../../store/store", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../store/store")>();
  return { ...real, useStore: <T, S>(store: { get(): T }, selector: (s: T) => S) => selector(store.get()) };
});

describe("Library room markup", () => {
  it("shows the three tabs, search, import tile and storage readout", () => {
    projectStore.set({
      ...newProject("Cosmic Lift"),
      assets: [
        { id: "a1", kind: "audio", name: "Vocal chop 3.wav", mime: "audio/wav", bytes: 10, durationSec: 4, detectedBpm: 128, detectedKey: "A♭m", addedAt: 2 },
        { id: "a2", kind: "midi", name: "Acid loop", mime: "audio/midi", bytes: 10, detectedBpm: 130, durationSec: 7, addedAt: 1 },
      ],
    });
    const html = renderToString(<Library />);
    for (const text of ["Media", "Projects", "Plugins and MIDI", "Import files", "Vocal chop 3.wav", "128 BPM", "A♭m", "0:04", "Acid loop", "Add to timeline", "Delete Vocal chop 3.wav", "Checking storage"]) {
      expect(html).toContain(text);
    }
    for (const filter of ["All", "Audio", "MIDI", "Video", "Images"]) expect(html).toContain(`>${filter}<`);
  });

  it("filters media by the search text", () => {
    const html = renderToString(<MediaTab query="acid" openPicker={() => undefined} />);
    expect(html).toContain("Acid loop");
    expect(html).not.toContain("Vocal chop");
  });

  it("projects tab offers new, open file, old-studio import, autosave and a disabled publish card", () => {
    const html = renderToString(<ProjectsTab query="" openProjectPicker={() => undefined} />);
    for (const text of ["New project", "Open a project file", "Import from the old studio", "Autosave", "Publish to GLCTC1", "Coming soon"]) expect(html).toContain(text);
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Publish a track/);
  });

  it("plugins tab shows the plugin form, the MIDI state and the empty link list", () => {
    const html = renderToString(<PluginsTab />);
    for (const text of ["Plugin address", "Only add ones you trust", "Controls you&#x27;ve linked", "Nothing linked yet", "Link"]) expect(html).toContain(text);
    // jsdom-free environment has no Web MIDI, which must read as a plain statement and not a crash.
    expect(html).toContain("Not supported in this browser");
  });
});

describe("Instruments hub markup", () => {
  it("lists all eight instruments with project badges", () => {
    const base = newProject("Cosmic Lift");
    projectStore.set({
      ...base,
      tracks: [{ id: "t1", name: "Drums", kind: "instrument", color: "#fff", slotId: "s1", muted: false, solo: false, gainDb: 0, pan: 0, sends: { reverb: 0, delay: 0 }, inserts: [], cue: false, toMaster: true, clips: [], automation: [] }],
      instruments: [{ id: "s1", kind: "drum80la8", trackId: "t1", state: { kind: "drum80la8", values: {} } }],
    });
    const html = renderToString(<Instruments />);
    for (const name of ["80LA8", "Divine09", "PAD-64", "30LEE", "0010110", "Galactic One", "Galactic Vox", "Looper"]) expect(html).toContain(name);
    expect(html).toContain("On track “Drums”");
    expect(html.match(/Not in project/g)).toHaveLength(7);
    expect(html).toContain("Search instruments and presets");
  });
});
