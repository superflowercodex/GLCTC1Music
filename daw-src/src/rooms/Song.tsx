import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { peekEngine, getEngine } from "../audio/engine";
import { getSongPlayer } from "../audio/songPlayer";
import { instrumentInfo } from "../audio/instruments/registry";
import type { InstrumentKind } from "../audio/types";
import { ensureInstrument } from "../project/instruments";
import type { Song as SongData, SongPattern } from "../project/model";
import { projectStore, uiStore } from "../store/project";
import { useStore } from "../store/store";
import { Button, InfoChip, Seg, BPM_CHIP_SLOT } from "../ui/controls";
import { ProjectHeader } from "../ui/ProjectHeader";
import { Caption } from "../ui/Caption";
import { Knob } from "../ui/Knob";
import { LedMeter } from "../ui/LedMeter";
import { Icon } from "../ui/Icon";
import { RoomFrame } from "../ui/RoomFrame";
import { useEdgeFade } from "../ui/useEdgeFade";
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

// masterLevel() is RMS; the transport lifts it by sqrt(2) so the LEDs sit near true peak.
const masterPeak = (): number => (peekEngine()?.masterLevel() ?? 0) * Math.SQRT2;

function curvePath(values: readonly number[], close: boolean): string {
  const n = values.length - 1;
  const pts = values.map((v, k) => `${((k / n) * 100).toFixed(2)},${(100 - v * 88).toFixed(2)}`);
  return close ? `M0,100 L${pts.join(" L")} L100,100 Z` : `M${pts.join(" L")}`;
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
  const player = getSongPlayer();
  const playState = useSyncExternalStore((l) => player.subscribe(l), () => player.getState());

  const [ready, setReady] = useState(0);
  const [selected, setSelected] = useState(0);
  const [prompt, setPrompt] = useState("");
  const matrixRef = useRef<HTMLDivElement>(null);
  const hscrollRef = useRef<HTMLDivElement>(null);
  useEdgeFade(matrixRef, "y");
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
  useEdgeFade(hscrollRef, "x", lanes.length > 0);
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
  // Room for the longest thing the preview readout can show (a section name or the length), capped.
  const nowSlot = Math.min(14, Math.max(formatDuration(totalSec).length, ...sections.map((s) => [...s.name].length)));
  // Columns stay proportional to their bars but never narrower than a full section name; the matrix scrolls sideways instead of clipping.
  const columns = sections.map((s) => `minmax(var(--min-col), ${s.bars}fr)`).join(" ");
  const hasAnyCell = lanes.some((l) => (song.matrix[l.slotId] ?? []).some((v) => v > 0));
  const selSection = sections[safeSelected];
  const statusText = note ?? "Tap a pad to cycle its pattern A to D or off. Tap a section card to hear it alone.";

  return (
    <RoomFrame
      title="Song"
      head={
        <ProjectHeader
          room="Song"
          chips={
            <>
              <InfoChip>{key}</InfoChip>
              <InfoChip color="var(--a2)" slot={BPM_CHIP_SLOT}>{Math.round(bpm * 10) / 10} BPM</InfoChip>
              {sections.length > 0 && <InfoChip color="var(--a3)" slot={5}>{formatDuration(totalSec)}</InfoChip>}
            </>
          }
        />
      }
      hideTransport
      actions={<Seg label="Song length" className="song-templates" options={TEMPLATES.map((t) => ({ value: t.id, label: t.label }))} value={activeTemplate as TemplateId} onChange={chooseTemplate} />}
    >
      <div className="song-body frost-sheet">
        <form
          className="song-compose"
          onSubmit={(e) => {
            e.preventDefault();
            runCompose();
          }}
        >
          <div className="song-compose-row">
            <span className="song-compose-ic">
              <Icon name="song" size={20} />
            </span>
            <input type="text" aria-label="Describe your track" placeholder="Dark techno, 128 bpm, slow build, big drop, then ease out" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
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
            <button type="submit" className="btn btn-primary" disabled={lanes.length === 0}>
              Compose
            </button>
          </div>
          <div className="song-status" role="status">
            <span className="tag" title="Keywords for genre, scale, tempo, length and which instruments sit out choose the arrangement. No AI model is involved.">
              Rule-based
            </span>
            <span className="song-status-t">{statusText}</span>
          </div>
        </form>

        <section className="song-panel" aria-label="Sections">
          <div className="song-scroll fade-y" ref={matrixRef}>
          {lanes.length === 0 ? (
            <div className="song-empty">
              <span className="song-empty-ic">
                <Icon name="song" size={28} />
              </span>
              <Caption>The stage is set, the band is missing</Caption>
              <p>Add an instrument with patterns, such as the 80LA8 drum machine or 30LEE, and it gets a row here. Each row picks which pattern plays in each section.</p>
              <a className="btn btn-primary" href="#/play">
                Open Play
              </a>
            </div>
          ) : (
            <>
              <div className="song-matrix" style={{ "--cols": sections.length, "--rows": lanes.length } as React.CSSProperties}>
              <div className="song-corner">
                <Caption>Arrangement</Caption>
              </div>
              {lanes.map((lane, r) => {
                const level = song.levels?.[lane.slotId] ?? DEFAULT_LEVEL;
                return (
                  <div className="song-name" key={lane.slotId} role="group" aria-label={lane.name} style={{ "--c": lane.color, gridRow: r + 2 } as React.CSSProperties}>
                    <span className="song-dot" />
                    <span className="t">{lane.name}</span>
                    <Knob
                      label={`${lane.name} level`}
                      hideLabel
                      size="sm"
                      color={lane.color}
                      value={level}
                      min={0}
                      max={1}
                      step={0.01}
                      defaultValue={DEFAULT_LEVEL}
                      format={(v) => `${Math.round(v * 100)}`}
                      onChange={(v) => setLevel(lane.slotId, v)}
                    />
                  </div>
                );
              })}
              <div className="song-hscroll fade-x" ref={hscrollRef} role="group" aria-label="Pattern matrix">
                <div className="song-lane" style={{ gridTemplateColumns: columns }}>
                  {sections.map((s, i) => {
                    const c = KIND_COLOR[s.kind ?? "drop"];
                    const curve = energyCurve(s, 24);
                    const alone = playState.mode === "section" && playState.section === i;
                    const live = playing && playState.section === i;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        className={`song-ribbon ${i === safeSelected ? "sel" : ""} ${live ? "live" : ""}`}
                        style={{ "--c": c } as React.CSSProperties}
                        aria-pressed={alone}
                        aria-label={`${s.name}, ${s.bars} bars. ${alone ? "Stop" : "Play this section alone"}`}
                        data-tip={`${s.name} · ${s.bars} bars`}
                        onClick={() => pickSection(i)}
                      >
                        <svg className="song-curve" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                          <defs>
                            <linearGradient id={`sg-${s.id}`} x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0" stopColor={c} stopOpacity="0.5" />
                              <stop offset="1" stopColor={c} stopOpacity="0" />
                            </linearGradient>
                          </defs>
                          <path d={curvePath(curve, true)} fill={`url(#sg-${s.id})`} />
                          <path d={curvePath(curve, false)} fill="none" stroke={c} strokeWidth="2" vectorEffect="non-scaling-stroke" />
                        </svg>
                        <span className="song-ribbon-text">
                          <span className="song-ribbon-name">{s.name}</span>
                          <span className="song-ribbon-bars">{s.bars}<span className="song-bars-u"> bars</span></span>
                        </span>
                        <span className="song-ribbon-go" aria-hidden="true">
                          <Icon name={alone ? "stop" : "play"} size={14} />
                        </span>
                      </button>
                    );
                  })}
                </div>
                {lanes.map((lane, r) => (
                  <div className="song-cells" key={lane.slotId} style={{ "--c": lane.color, gridRow: r + 2, gridTemplateColumns: columns } as React.CSSProperties}>
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
                          {v ? PATTERN_LETTERS[v] : <span className="song-off" />}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
              </div>
            </>
          )}
          </div>
        </section>

        <footer className={`transport song-transport ${playing ? "is-playing" : ""}`}>
          <div className="tp-ctrls">
            <button type="button" className="play-btn" aria-label={playState.mode === "song" ? "Stop preview" : "Preview whole song"} disabled={lanes.length === 0} onClick={() => (playState.mode === "song" ? player.stop() : void startPreview())}>
              <Icon name={playState.mode === "song" ? "stop" : "play"} size={20} />
            </button>
          </div>
          <div className="tp-readout song-now" style={{ "--slot": nowSlot } as CSSProperties}>
            <span className="tp-cap tp-cap-swap">
              <span aria-hidden={playState.mode === "section" ? undefined : true}>Section preview</span>
              <span aria-hidden={playState.mode === "section" ? true : undefined}>Song preview</span>
            </span>
            <span className="mono transport-pos" title={playState.mode === "section" && selSection ? selSection.name : undefined}>{playState.mode === "section" && selSection ? selSection.name : formatDuration(totalSec)}</span>
          </div>
          <div className="tp-readout">
            <span className="tp-cap">Length</span>
            <span className="mono transport-pos">{formatDuration(totalSec)}</span>
          </div>
          <LedMeter getLevel={masterPeak} label="Master output level" horizontal className="tp-meter" scale={{ segments: 20 }} />
          <span className="spacer" />
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
