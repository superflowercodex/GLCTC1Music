import type { CSSProperties, ReactNode } from "react";
import { INSTRUMENTS, type InstrumentInfo } from "../audio/instruments/registry";
import type { InstrumentKind } from "../audio/types";
import { instrumentHref } from "../rooms";
import { projectStore, uiStore } from "../store/project";
import { useStore } from "../store/store";
import { Caption } from "../ui/Caption";
import { Icon } from "../ui/Icon";
import { useLayoutMode } from "../ui/layoutMode";
import { RoomFrame } from "../ui/RoomFrame";
import "../ui/frost.css";
import "./instruments.css";

const SECTIONS = [
  { title: "Drums", hint: "Steps and pads" },
  { title: "Synths", hint: "Play, sequence, bounce" },
  { title: "Voice and samples", hint: "Sing, chop, loop" },
] as const;

type Art = "grid-a" | "grid-b" | "pads" | "steps" | "keys" | "wave";

const ART: Record<InstrumentKind, Art> = {
  drum80la8: "grid-a",
  divine09: "grid-b",
  pad64: "pads",
  acid30lee: "steps",
  lead0010110: "steps",
  galacticOne: "keys",
  vox: "wave",
  looper: "pads",
};

const GRID_A = [[1,0,0,0,1,0,0,0,1,0,0,0,1,0,1,0],[0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,1],[1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,1]];
const GRID_B = [[1,0,0,1,0,0,1,0,1,0,0,1,0,0,1,0],[0,0,1,0,0,1,0,0,0,0,1,0,0,1,0,0],[1,1,0,1,1,0,1,1,1,1,0,1,1,0,1,1]];
const STEP_HEIGHTS = [70, 28, 46, 28, 92, 28, 46, 60, 70, 28, 46, 28, 92, 36, 62, 28];
const BLACK_KEYS = [0, 1, 3, 4, 5, 7, 8, 10, 11];

/** Mini drawings in plain DOM on a flexible grid, so they stretch with the tile's width and a card costs a few dozen elements. */
function Viz({ art }: { art: Art }): ReactNode {
  let body: ReactNode;
  if (art === "grid-a" || art === "grid-b") {
    const rows = art === "grid-a" ? GRID_A : GRID_B;
    body = (
      <div className="hubx-cells" style={{ gridTemplateColumns: "repeat(16, 1fr)" }}>
        {rows.flatMap((row, r) => row.map((on, c) => <i key={`${r}-${c}`} className={on ? "on" : ""} />))}
      </div>
    );
  } else if (art === "pads") {
    body = (
      <div className="hubx-cells pads" style={{ gridTemplateColumns: "repeat(8, 1fr)" }}>
        {Array.from({ length: 16 }, (_, i) => <i key={i} className={i % 5 === 1 ? "on" : i === 12 ? "dim" : ""} />)}
      </div>
    );
  } else if (art === "steps") {
    body = (
      <div className="hubx-steps">
        {STEP_HEIGHTS.map((h, i) => <i key={i} className={i % 4 === 0 ? "on" : ""} style={{ height: `${h}%` }} />)}
      </div>
    );
  } else if (art === "keys") {
    body = (
      <div className="hubx-keys">
        {Array.from({ length: 14 }, (_, i) => <i key={i} className={i === 4 || i === 9 ? "held" : ""} />)}
        {BLACK_KEYS.map((i) => <b key={i} className={i === 4 ? "held" : ""} style={{ left: `${((i + 1) / 14) * 100}%` }} />)}
      </div>
    );
  } else {
    body = (
      <div className="hubx-wave">
        {Array.from({ length: 36 }, (_, i) => <i key={i} style={{ height: `${14 + Math.abs(Math.sin(i / 3 + 1.2)) * 70 + (i % 3) * 5}%` }} />)}
      </div>
    );
  }
  return (
    <div className="hubx-viz well" aria-hidden="true">
      {body}
      <span className="hubx-sweep" />
    </div>
  );
}

function Card({ info, trackName }: { info: InstrumentInfo; trackName: string | null }) {
  return (
    <a href={instrumentHref(info.kind)} className="hubx-card" style={{ "--c": info.color } as CSSProperties} aria-label={`Open ${info.name}`}>
      <Viz art={ART[info.kind]} />
      <div className="hubx-text">
        <div className="hubx-head">
          <div className="hubx-name">{info.name}</div>
          <span className="hubx-open">
            <span className="hubx-open-t">Open</span> <Icon name="next" size={16} />
          </span>
        </div>
        <div className="hubx-tag">{info.tagline}</div>
        <div className="hubx-meta">{info.meta}</div>
        <div className="hubx-foot">
          <span className={`hubx-badge ${trackName ? "on" : ""}`} title={trackName ? `On track “${trackName}”` : undefined}>
            <i aria-hidden="true" />
            <span className="hubx-badge-t">{trackName ? `On track “${trackName}”` : "Not in project"}</span>
          </span>
        </div>
      </div>
    </a>
  );
}

export default function Instruments() {
  const slots = useStore(projectStore, (p) => p.instruments);
  const tracks = useStore(projectStore, (p) => p.tracks);
  const phone = useLayoutMode() === "phone";

  const trackFor = (kind: InstrumentKind): string | null => {
    const slot = slots.find((s) => s.kind === kind);
    return slot ? (tracks.find((t) => t.id === slot.trackId)?.name ?? null) : null;
  };

  return (
    <RoomFrame
      eyebrow="Pick an instrument"
      title="Instruments"
      actions={
        <button type="button" className="search-pill hubx-search" onClick={() => uiStore.set((s) => ({ ...s, sheet: "palette" }))}>
          <Icon name="search" size={18} />
          <span>Search instruments and presets</span>
          <kbd>⌘K</kbd>
        </button>
      }
    >
      <div className="hubx-sheet frost-sheet">
      <div className="scroll-y hubx">
        <div className="hubx-cols">
          {SECTIONS.map((section) => (
            <section key={section.title} className="hubx-col" aria-labelledby={`hub-${section.title}`}>
              <Caption as="h2" id={`hub-${section.title}`} aside={section.hint}>{section.title}</Caption>
              <div className="hubx-stack">
                {INSTRUMENTS.filter((i) => i.section === section.title).map((i) => (
                  <Card key={i.kind} info={i} trackName={trackFor(i.kind)} />
                ))}
              </div>
            </section>
          ))}
        </div>
        <div className="hubx-help">
          <div className="hubx-help-t">
            <strong>Every instrument opens in the same room</strong>
            <span>{phone ? "Presets, play surface and sound sit one tap apart; record and bounce live in the player." : "Presets left, play surface in the middle, sound on the right, record and bounce along the bottom."}</span>
          </div>
          <a className="btn btn-sm btn-outline" href={instrumentHref("drum80la8")}>See a drum machine</a>
          <a className="btn btn-sm btn-outline" href={instrumentHref("galacticOne")}>See a synth</a>
        </div>
      </div>
      </div>
    </RoomFrame>
  );
}
