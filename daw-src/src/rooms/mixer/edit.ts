import { updateTrack } from "../../project/actions";
import { newId, type Insert, type InsertType, type MasterSettings, type Project } from "../../project/model";
import { defaultParams, EFFECT_DEFS, EffectError } from "../../audio/effects";

export const MAX_INSERTS = 4;

function mapInserts(project: Project, trackId: string, fn: (inserts: Insert[]) => Insert[]): Project {
  const track = project.tracks.find((t) => t.id === trackId);
  if (!track) return project;
  const next = fn(track.inserts);
  return next === track.inserts ? project : updateTrack(project, trackId, { inserts: next });
}

export function addInsert(project: Project, trackId: string, type: InsertType): Project {
  return mapInserts(project, trackId, (inserts) =>
    inserts.length >= MAX_INSERTS ? inserts : [...inserts, { id: newId("fx"), type, params: defaultParams(type), bypass: false }],
  );
}

export function removeInsert(project: Project, trackId: string, insertId: string): Project {
  return mapInserts(project, trackId, (inserts) => (inserts.some((i) => i.id === insertId) ? inserts.filter((i) => i.id !== insertId) : inserts));
}

/** Moves an insert one place earlier (-1) or later (1) in the chain. */
export function moveInsert(project: Project, trackId: string, insertId: string, direction: -1 | 1): Project {
  return mapInserts(project, trackId, (inserts) => {
    const from = inserts.findIndex((i) => i.id === insertId);
    const to = from + direction;
    if (from === -1 || to < 0 || to >= inserts.length) return inserts;
    const next = [...inserts];
    [next[from], next[to]] = [next[to], next[from]];
    return next;
  });
}

export function setInsertBypass(project: Project, trackId: string, insertId: string, bypass: boolean): Project {
  return mapInserts(project, trackId, (inserts) => inserts.map((i) => (i.id === insertId ? { ...i, bypass } : i)));
}

export function setInsertParam(project: Project, trackId: string, insertId: string, param: string, value: number): Project {
  return mapInserts(project, trackId, (inserts) =>
    inserts.map((i) => {
      if (i.id !== insertId) return i;
      const def = EFFECT_DEFS[i.type].params.find((p) => p.id === param);
      if (!def) throw new EffectError(`${EFFECT_DEFS[i.type].label} has no parameter "${param}".`);
      return { ...i, params: { ...i.params, [param]: Math.min(def.max, Math.max(def.min, value)) } };
    }),
  );
}

export function setSend(project: Project, trackId: string, which: "reverb" | "delay", amount: number): Project {
  const track = project.tracks.find((t) => t.id === trackId);
  if (!track) return project;
  return updateTrack(project, trackId, { sends: { ...track.sends, [which]: Math.min(1, Math.max(0, amount)) } });
}

export function setMaster(project: Project, patch: Partial<MasterSettings>): Project {
  return { ...project, master: { ...project.master, ...patch }, updatedAt: Date.now() };
}
