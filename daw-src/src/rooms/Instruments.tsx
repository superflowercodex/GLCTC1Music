import type { CSSProperties, ReactNode } from "react";
import { INSTRUMENTS, type InstrumentInfo } from "../audio/instruments/registry";
import type { InstrumentKind } from "../audio/types";
import { instrumentHref } from "../rooms";
import { projectStore, uiStore } from "../store/project";
import { useStore } from "../store/store";
import { Icon } from "../ui/Icon";
import { RoomFrame } from "../ui/RoomFrame";
import "./instruments.css";

const SECTIONS = [
  { title: "Drums", hint: "Step sequencers and pads" },
  { title: "Synths", hint: "Play it, sequence it, bounce it to a track" },
  { title: "Voice and samples", hint: "Sing into it, chop it, play it back" },
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
const STEP_HEIGHTS = [34, 14, 22, 14, 44, 14, 22, 28, 34, 14, 22, 14, 44, 18, 30, 14];
const BLACK_KEYS = [0, 1, 3, 4, 5, 7, 8, 10, 11, 12];

function abs(style: CSSProperties, key: string | number): ReactNode {
  return <i key={key} style={style} />;
}

/** Small decorative drawings, plain DOM so a card costs a few dozen elements and no canvas. */
function Viz({ art, color }: { art: Art; color: string }): ReactNode {
  const out: ReactNode[] = [];
  if (art === "grid-a" || art === "grid-b") {
    (art === "grid-a" ? GRID_A : GRID_B).forEach((row, r) =>
      row.forEach((on, c) =>
        out.push(abs({ left: 14 + c * 17, top: 8 + r * 20, width: 13, height: 16, borderRadius: 4, background: on ? color : "rgba(255,255,255,.1)", boxShadow: on ? `0 0 10px ${color}88` : "none" }, `${r}-${c}`)),
      ),
    );
  } else if (art === "pads") {
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 8; c++) {
        out.push(abs({ left: 14 + c * 34, top: 8 + r * 34, width: 28, height: 28, borderRadius: 9, background: (r * 8 + c) % 5 === 1 ? color : "rgba(255,255,255,.1)" }, `${r}-${c}`));
      }
    }
  } else if (art === "steps") {
    STEP_HEIGHTS.forEach((h, i) => out.push(abs({ left: 14 + i * 17, top: 66 - h, width: 12, height: h, borderRadius: 5, background: `${color}${i % 4 === 0 ? "" : "aa"}` }, i)));
  } else if (art === "keys") {
    for (let i = 0; i < 14; i++) out.push(abs({ left: 12 + i * 19, top: 8, width: 16, height: 58, borderRadius: 5, background: `rgba(255,255,255,${i === 4 || i === 9 ? 0.4 : 0.14})` }, `w${i}`));
    BLACK_KEYS.forEach((i) => out.push(abs({ left: 12 + i * 19 + 13, top: 8, width: 12, height: 34, borderRadius: 4, background: i === 4 ? color : "#0b1020" }, `b${i}`)));
  } else {
    for (let i = 0; i < 40; i++) {
      const h = 10 + Math.abs(Math.sin(i / 3 + 1.2) * 28) + (i % 3) * 3;
      out.push(abs({ left: 14 + i * 7, top: 38 - h / 2, width: 4, height: h, borderRadius: 2, background: color }, i));
    }
  }
  return (
    <div className="hubx-viz" aria-hidden="true" style={{ "--c": color } as CSSProperties}>
      {out}
      <span className="hubx-sweep" />
    </div>
  );
}

function Card({ info, trackName }: { info: InstrumentInfo; trackName: string | null }) {
  return (
    <a href={instrumentHref(info.kind)} className="hubx-card" style={{ "--c": info.color } as CSSProperties}>
      <span className="hubx-glow" aria-hidden="true" />
      <Viz art={ART[info.kind]} color={info.color} />
      <div>
        <div className="hubx-name">{info.name}</div>
        <div className="hubx-tag">{info.tagline}</div>
        <div className="hubx-meta">{info.meta}</div>
      </div>
      <div className="hubx-foot">
        <span className={`hubx-badge ${trackName ? "on" : ""}`}>{trackName ? `On track “${trackName}”` : "Not in project"}</span>
        <span className="hubx-open">
          Open <Icon name="next" size={18} />
        </span>
      </div>
    </a>
  );
}

export default function Instruments() {
  const slots = useStore(projectStore, (p) => p.instruments);
  const tracks = useStore(projectStore, (p) => p.tracks);
  const projectName = useStore(projectStore, (p) => p.name);

  const trackFor = (kind: InstrumentKind): string | null => {
    const slot = slots.find((s) => s.kind === kind);
    return slot ? (tracks.find((t) => t.id === slot.trackId)?.name ?? null) : null;
  };

  return (
    <RoomFrame
      eyebrow={projectName}
      title="Instruments"
      actions={
        <button type="button" className="hubx-search" onClick={() => uiStore.set((s) => ({ ...s, sheet: "palette" }))}>
          <Icon name="search" size={20} />
          <span className="grow">Search instruments and presets</span>
          <kbd>⌘K</kbd>
        </button>
      }
    >
      <div className="scroll-y hubx">
        {SECTIONS.map((section) => (
          <section key={section.title} aria-labelledby={`hub-${section.title}`}>
            <div className="hubx-head">
              <h2 id={`hub-${section.title}`}>{section.title}</h2>
              <span>{section.hint}</span>
            </div>
            <div className="hubx-grid">
              {INSTRUMENTS.filter((i) => i.section === section.title).map((i) => (
                <Card key={i.kind} info={i} trackName={trackFor(i.kind)} />
              ))}
            </div>
          </section>
        ))}
        <div className="hubx-help">
          <div>
            <strong>Every instrument opens in the same room</strong>
            <p>Presets on the left, the play surface in the middle, sound on the right, and record, bounce and send-to-track along the bottom.</p>
          </div>
          <a className="hubx-link" href={instrumentHref("drum80la8")}>See a drum machine</a>
          <a className="hubx-link" href={instrumentHref("galacticOne")}>See a synth</a>
        </div>
      </div>
    </RoomFrame>
  );
}
