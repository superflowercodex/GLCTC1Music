import { describe, expect, it } from "vitest";
import { makeTrack } from "../../project/actions";
import { newProject, type Project } from "../../project/model";
import { addInsert, MAX_INSERTS, moveInsert, removeInsert, setInsertBypass, setInsertParam, setMaster, setSend } from "./edit";

function withTrack(): { project: Project; id: string } {
  const base = newProject("t");
  const track = makeTrack(base, "audio");
  return { project: { ...base, tracks: [track] }, id: track.id };
}

const types = (p: Project, id: string): string[] => p.tracks.find((t) => t.id === id)!.inserts.map((i) => i.type);

describe("insert editing", () => {
  it("adds with defaults and stops at the cap", () => {
    let { project, id } = withTrack();
    for (let i = 0; i < MAX_INSERTS + 2; i++) project = addInsert(project, id, "eq");
    expect(types(project, id)).toHaveLength(MAX_INSERTS);
    expect(project.tracks[0].inserts[0].params.midFreq).toBe(1000);
    expect(project.tracks[0].inserts[0].bypass).toBe(false);
  });

  it("reorders, bypasses and removes", () => {
    let { project, id } = withTrack();
    project = addInsert(addInsert(addInsert(project, id, "compressor"), id, "eq"), id, "reverb");
    expect(types(project, id)).toEqual(["compressor", "eq", "reverb"]);
    const eq = project.tracks[0].inserts[1].id;
    project = moveInsert(project, id, eq, -1);
    expect(types(project, id)).toEqual(["eq", "compressor", "reverb"]);
    expect(moveInsert(project, id, eq, -1)).toBe(project);
    project = moveInsert(project, id, project.tracks[0].inserts[2].id, 1);
    expect(types(project, id)).toEqual(["eq", "compressor", "reverb"]);
    project = setInsertBypass(project, id, eq, true);
    expect(project.tracks[0].inserts[0].bypass).toBe(true);
    project = removeInsert(project, id, eq);
    expect(types(project, id)).toEqual(["compressor", "reverb"]);
  });

  it("clamps parameters and refuses unknown ones", () => {
    let { project, id } = withTrack();
    project = addInsert(project, id, "delay");
    const insert = project.tracks[0].inserts[0].id;
    expect(setInsertParam(project, id, insert, "feedback", 5).tracks[0].inserts[0].params.feedback).toBe(0.9);
    expect(() => setInsertParam(project, id, insert, "nope", 1)).toThrow();
  });

  it("ignores unknown tracks", () => {
    const { project } = withTrack();
    expect(addInsert(project, "missing", "eq")).toBe(project);
    expect(setSend(project, "missing", "reverb", 1)).toBe(project);
  });
});

describe("sends and master", () => {
  it("clamps sends to 0..1", () => {
    const { project, id } = withTrack();
    expect(setSend(project, id, "reverb", 3).tracks[0].sends.reverb).toBe(1);
    expect(setSend(project, id, "delay", -1).tracks[0].sends.delay).toBe(0);
  });

  it("master values live in the project", () => {
    const { project } = withTrack();
    const next = setMaster(project, { filterHz: 800, filterOn: true, reverbMix: 0.5 });
    expect(next.master).toMatchObject({ filterHz: 800, filterOn: true, reverbMix: 0.5, limiter: true });
    expect(JSON.parse(JSON.stringify(next)).master.filterHz).toBe(800);
  });
});
