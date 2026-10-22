import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { peekEngine, getEngine } from "../audio/engine";
import { getSongPlayer } from "../audio/songPlayer";
import { instrumentInfo } from "../audio/instruments/registry";
import type { InstrumentKind } from "../audio/types";
import { ensureInstrument } from "../project/instruments";
import type { Song as SongData, SongPattern } from "../project/model";
import { projectStore, uiStore } from "../store/project";
import { useStore } from "../store/store";
import { Button, Seg } from "../ui/controls";
import { Icon } from "../ui/Icon";
import { RoomFrame } from "../ui/RoomFrame";
import { setProjectBpm } from "../audio/transport";
import { compose } from "./song/composer";
import "./song/song.css";
import {
  applySongToProject,
  cyclePattern,
  DEFAULT_LEVEL,
  energyCurve,
  formatDuration,
  KIND_COLOR,
  PATTERN_LETTERS,
  remapMatrix,
  songDurationSec,
  templateSections,
  TEMPLATES,
  type TemplateId,
} from "./song/songModel";

interface Lane {
  slotId: string;
  kind: InstrumentKind;
  name: string;
  color: string;
  patternCount: number;
}

function toast(text: string): void {
  uiStore.set((s) => ({ ...s, toast: { id: Date.now(), text } }));
}

function livePatternCount(slotId: string): number {
  try {
    return peekEngine()?.getInstrument(slotId).patternCount ?? 0;
  } catch {
    // The instrument's audio is not created yet; it joins the grid once ensureInstrument finishes.
    return 0;
  }
}

function sameShape(song: SongData, id: TemplateId): boolean {
  const t = templateSections(id);
  return song.sections.length === t.length && song.sections.every((s, i) => s.bars === t[i].bars && s.kind === t[i].kind);
}

export default function Song() {
  const song = useStore(projectStore, (p) => p.song);
  const instruments = useStore(projectStore, (p) => p.instruments);
  const bpm = useStore(projectStore, (p) => p.bpm);
  const beatsPerBar = useStore(projectStore, (p) => p.beatsPerBar);
  const key = useStore(projectStore, (p) => p.key);
  const name = useStore(projectStore, (p) => p.name);
  const player = getSongPlayer();
  const playState = useSyncExternalStore((l) => player.subscribe(l), () => player.getState());

  const [ready, setReady] = useState(0);
  const [selected, setSelected] = useState(0);
  const [prompt, setPrompt] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [undo, setUndo] = useState<SongData | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all(instruments.map((s) => ensureInstrument(s.kind)))
      .then(() => alive && setReady((n) => n + 1))
      .catch((e: unknown) => toast(`Could not load instruments: ${e instanceof Error ? e.message : String(e)}`));
    return () => {
      alive = false;
    };
  }, [instruments.length]);

  // The Song room owns the preview, so leaving it must hand the instruments back.
  useEffect(() => () => player.stop(), [player]);

  const lanes: Lane[] = useMemo(
    () =>
      instruments
        .map((slot) => ({ slot, patternCount: livePatternCount(slot.id) }))
        .filter((x) => x.patternCount > 0)
        .map(({ slot, patternCount }) => {
          const info = instrumentInfo(slot.kind);
          return { slotId: slot.id, kind: slot.kind, name: info.name, color: info.color, patternCount };
        }),
    [instruments, ready],
  );

  useEffect(() => {
    if (song.sections.length > 0) return;
    projectStore.set((p) => (p.song.sections.length > 0 ? p : { ...p, song: { ...p.song, sections: templateSections("club") } }));
  }, [song.sections.length]);

  const sections = song.sections;
  const counts = useMemo(() => Object.fromEntries(lanes.map((l) => [l.slotId, l.patternCount])), [lanes]);
  const activeTemplate = TEMPLATES.find((t) => sameShape(song, t.id))?.id ?? "";
  const safeSelected = Math.min(selected, Math.max(0, sections.length - 1));
  const playing = playState.mode !== "idle";

  function updateSong(change: (s: SongData) => SongData): void {
    projectStore.set((p) => ({ ...p, updatedAt: Date.now(), song: change(p.song) }));
  }

  function chooseTemplate(id: TemplateId): void {
    player.stop();
    const next = templateSections(id);
    updateSong((s) => ({ ...s, sections: next, matrix: remapMatrix(s.sections, next, s.matrix, counts) }));
    setSelected(0);
  }

  function cycle(slotId: string, index: number, patternCount: number): void {
    updateSong((s) => {
      const row = s.matrix[slotId] ? [...s.matrix[slotId]] : sections.map((): SongPattern => 0);
      while (row.length < s.sections.length) row.push(0);
      row[index] = cyclePattern(row[index], patternCount);
      return { ...s, matrix: { ...s.matrix, [slotId]: row } };
    });
  }

  function setLevel(slotId: string, level: number): void {
    updateSong((s) => ({ ...s, levels: { ...s.levels, [slotId]: level } }));
    player.setLevel(slotId, level);
  }

  function runCompose(): void {
    if (prompt.trim() === "") {
      setNote("Type a description first, for example: Dark techno, 128 bpm, slow build, big drop, then ease out.");
      return;
    }
    const result = compose(prompt, lanes.map((l) => ({ id: l.slotId, kind: l.kind, patternCount: l.patternCount })), (activeTemplate || "club") as TemplateId);
    player.stop();
    setUndo(song);
    const matrix: SongData["matrix"] = {};
    for (const l of lanes) matrix[l.slotId] = result.matrix[l.slotId] ?? result.sections.map((): SongPattern => 0);
    updateSong((s) => ({ ...s, sections: result.sections, matrix, levels: { ...s.levels, ...result.levels } }));
    setProjectBpm(result.bpm);
    projectStore.set((p) => ({ ...p, key: result.key }));
    setNote(result.summary);
    setSelected(0);
  }

  async function startPreview(section?: number): Promise<void> {
    try {
      await getEngine().resume();
      player.play(projectStore.get().song, section);
    } catch (e) {
      toast(`Could not start the preview: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function pickSection(i: number): void {
    setSelected(i);
    if (playState.mode === "section" && playState.section === i) player.stop();
    else void startPreview(i);
  }

  function sendToArrange(): void {
    player.stop();
    projectStore.set(applySongToProject);
    toast("Song sent to Arrange as pattern clips.");
  }

  const totalSec = songDurationSec(song, bpm, beatsPerBar);
  const columns = sections.map((s) => `minmax(0, ${s.bars}fr)`).join(" ");
  const hasAnyCell = lanes.some((l) => (song.matrix[l.slotId] ?? []).some((v) => v > 0));

  return (
    <RoomFrame
      eyebrow={`${name} · ${Math.round(bpm * 10) / 10} BPM · ${key}`}
      title="Song"
      hideTransport
      actions={<Seg label="Song length" className="song-templates" options={TEMPLATES.map((t) => ({ value: t.id, label: t.label }))} value={activeTemplate as TemplateId} onChange={chooseTemplate} />}
    >
      <div className="song-body">
        <form
          className="song-compose"
          onSubmit={(e) => {
            e.preventDefault();
            runCompose();
          }}
        >
          <Icon name="song" size={22} />
          <input type="text" aria-label="Describe your track" placeholder="Dark techno, 128 bpm, slow build, big drop, then ease out" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
          <span className="tag" title="Keywords for genre, scale, tempo, length and which instruments sit out choose the arrangement. No AI model is involved.">
            Rule-based, not AI
          </span>
          {undo && (
            <Button
              variant="outline"
              onClick={() => {
                updateSong(() => undo);
                setUndo(null);
                setNote("Brought back your arrangement from before Compose.");
              }}
            >
              Undo
            </Button>
          )}
          <button type="submit" className="btn btn-compose" disabled={lanes.length === 0}>
            Compose
          </button>
        </form>

        <section className="song-panel" aria-label="Sections">
          {lanes.length === 0 ? (
            <div className="song-empty">
              <p style={{ margin: 0, maxWidth: 520 }}>
                Add an instrument with patterns, such as the 80LA8 drum machine or 30LEE, and it gets a row here. Each row picks which pattern plays in each section.
              </p>
              <a className="btn btn-primary" href="#/play">
                Open Play
              </a>
            </div>
          ) : (
            <>
              <div className="song-grid">
                <div />
                <div className="song-lane" style={{ gridTemplateColumns: columns }}>
                  {sections.map((s, i) => {
                    const c = KIND_COLOR[s.kind ?? "drop"];
                    const curve = energyCurve(s, s.bars * 3);
                    const live = playing && playState.section === i;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        className={`song-ribbon ${i === safeSelected ? "sel" : ""} ${live ? "live" : ""}`}
                        style={{ "--c": c } as React.CSSProperties}
                        aria-pressed={playState.mode === "section" && playState.section === i}
                        aria-label={`${s.name}, ${s.bars} bars. ${playState.mode === "section" && playState.section === i ? "Stop" : "Play this section alone"}`}
                        onClick={() => pickSection(i)}
                      >
                        <span className="song-curve" aria-hidden="true">
                          {curve.map((h, k) => (
                            <i key={k} style={{ height: `${Math.round(h * 78)}%` }} />
                          ))}
                        </span>
                        <span className="song-ribbon-text">
                          <div className="song-ribbon-name">{s.name}</div>
                          <div className="song-ribbon-bars">{s.bars} bars</div>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="song-rows scroll-y" role="group" aria-label="Pattern matrix">
                {lanes.map((lane) => {
                  const level = song.levels?.[lane.slotId] ?? DEFAULT_LEVEL;
                  return (
                    <div className="song-row" key={lane.slotId} style={{ "--c": lane.color } as React.CSSProperties}>
                      <div className="song-name">
                        <span className="song-dot" />
                        <span className="t">{lane.name}</span>
                        <input
                          className="song-level"
                          type="range"
                          min={0}
                          max={1}
                          step={0.01}
                          value={level}
                          aria-label={`${lane.name} level`}
                          style={{ "--pct": `${level * 100}%` } as React.CSSProperties}
                          onChange={(e) => setLevel(lane.slotId, Number(e.target.value))}
                        />
                      </div>
                      <div className="song-cells" style={{ gridTemplateColumns: columns }}>
                        {sections.map((s, i) => {
                          const v = song.matrix[lane.slotId]?.[i] ?? 0;
                          return (
                            <button
                              key={s.id}
                              type="button"
                              className={`song-cell ${v ? "on" : ""} ${i === safeSelected ? "col" : ""}`}
                              aria-label={`${lane.name}, ${s.name}, ${v ? `pattern ${PATTERN_LETTERS[v]}` : "off"}`}
                              onClick={() => cycle(lane.slotId, i, lane.patternCount)}
                            >
                              {PATTERN_LETTERS[v]}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="song-note" role="status">
                {note ?? "Tap a cell to cycle its pattern: A, B, C, D, off. Tap a section above to hear it alone."}
              </div>
            </>
          )}
        </section>

        <footer className="song-foot">
          <button type="button" className="play-btn" aria-label={playState.mode === "song" ? "Stop preview" : "Preview whole song"} disabled={lanes.length === 0} onClick={() => (playState.mode === "song" ? player.stop() : void startPreview())}>
            <Icon name={playState.mode === "song" ? "stop" : "play"} size={22} />
          </button>
          <strong style={{ fontSize: 16 }}>{playState.mode === "section" ? "Stop section preview" : "Preview whole song"}</strong>
          <span className="mono" style={{ fontSize: 16, color: "var(--muted)" }}>
            {formatDuration(totalSec)}
          </span>
          <span className="note">Sections stay in time even when this tab is in the background</span>
          <Button
            disabled={!hasAnyCell}
            onClick={() => {
              sendToArrange();
              uiStore.set((s) => ({ ...s, sheet: "export" }));
            }}
          >
            Export WAV
          </Button>
          <Button
            variant="primary"
            disabled={!hasAnyCell}
            onClick={() => {
              sendToArrange();
              location.hash = "#/arrange";
            }}
          >
            Send to Arrange
          </Button>
        </footer>
      </div>
    </RoomFrame>
  );
}
