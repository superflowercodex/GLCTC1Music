import { useRef, useState } from "react";
import { INSTRUMENTS, type InstrumentInfo } from "../../audio/instruments/registry";
import { projectStore } from "../../store/project";
import { useStore } from "../../store/store";
import { PopGroup, PopMenu } from "./Popover";
import { addInstrumentTrack, addPlainTrack, importAndPlace } from "./ops";

type Group = "Drums" | "Instrument";

const GROUPS: Record<Group, { caption: string; sections: InstrumentInfo["section"][] }[]> = {
  Drums: [{ caption: "Drums", sections: ["Drums"] }],
  Instrument: [
    { caption: "Synths", sections: ["Synths"] },
    { caption: "Voice", sections: ["Voice and samples"] },
  ],
};

function Glyph({ name }: { name: "audio" | "keys" | "drums" | "video" | "import" }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {name === "audio" && <path d="M3 12h2M7 8v8M11 4v16M15 8v8M19 10v4M22 12h-1" />}
      {name === "keys" && (
        <>
          <rect x="3" y="6" width="18" height="12" rx="2" />
          <path d="M9 13v5M15 13v5M12 6v7" />
        </>
      )}
      {name === "drums" && (
        <>
          <ellipse cx="12" cy="10" rx="8" ry="3" />
          <path d="M4 10v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6M8 4l3 5M16 4l-3 5" />
        </>
      )}
      {name === "video" && (
        <>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M3 9h18M7 5l2 4M12 5l2 4M17 5l2 4" />
        </>
      )}
      {name === "import" && <path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19h14" />}
    </svg>
  );
}

/** Pinned under the track list so adding a track is one click away at any scroll position and any track count. */
export function AddTrackBar() {
  const [open, setOpen] = useState<{ group: Group; anchor: DOMRect } | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const slots = useStore(projectStore, (p) => p.instruments);
  const have = new Set(slots.map((s) => s.kind));

  const trigger = (group: Group) => (e: React.MouseEvent<HTMLButtonElement>) => setOpen({ group, anchor: e.currentTarget.getBoundingClientRect() });

  return (
    <div className="arr-add" role="group" aria-label="Add a track">
      <span className="arr-add-label">Add</span>
      <button type="button" className="add-key" onClick={() => addPlainTrack("audio")}>
        <Glyph name="audio" />
        Audio
      </button>
      <button type="button" className="add-key" aria-haspopup="menu" aria-expanded={open?.group === "Instrument"} onClick={trigger("Instrument")}>
        <Glyph name="keys" />
        Instrument
      </button>
      <button type="button" className="add-key" aria-haspopup="menu" aria-expanded={open?.group === "Drums"} onClick={trigger("Drums")}>
        <Glyph name="drums" />
        Drums
      </button>
      <button type="button" className="add-key" onClick={() => addPlainTrack("video")}>
        <Glyph name="video" />
        Video
      </button>
      <span className="arr-add-gap" />
      <button type="button" className="add-key quiet" onClick={() => picker.current?.click()}>
        <Glyph name="import" />
        Import files
      </button>
      <input
        ref={picker}
        type="file"
        multiple
        hidden
        accept="audio/*,video/*,image/*,.wav,.mp3,.m4a,.aac,.ogg,.flac,.aif,.aiff,.mp4,.mov,.webm"
        aria-label="Choose files to import"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          if (files.length > 0) void importAndPlace(files);
        }}
      />
      {open && (
        <PopMenu anchor={open.anchor} onClose={() => setOpen(null)} label={`Add ${open.group.toLowerCase()} track`} wide>
          {GROUPS[open.group].map((g) => (
            <PopGroup key={g.caption} caption={g.caption}>
              {INSTRUMENTS.filter((i) => g.sections.includes(i.section)).map((i) => (
                <button
                  key={i.kind}
                  type="button"
                  role="menuitem"
                  className={`pm-item${have.has(i.kind) ? " have" : ""}`}
                  data-label={i.name}
                  style={{ "--c": i.color } as React.CSSProperties}
                  title={have.has(i.kind) ? `${i.name} is already in this project. Select its track.` : undefined}
                  onClick={() => {
                    setOpen(null);
                    void addInstrumentTrack(i.kind);
                  }}
                >
                  <span className="pm-tile" aria-hidden="true">
                    {i.name[0]}
                  </span>
                  <span className="pm-text">
                    <strong>{i.name}</strong>
                    <small>{i.tagline}</small>
                  </span>
                  {have.has(i.kind) && <span className="pm-tag">In project</span>}
                </button>
              ))}
            </PopGroup>
          ))}
        </PopMenu>
      )}
    </div>
  );
}
