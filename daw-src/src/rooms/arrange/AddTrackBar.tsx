import { useRef, useState } from "react";
import { INSTRUMENTS } from "../../audio/instruments/registry";
import { PopMenu } from "./TrackHeader";
import { addInstrumentTrack, addPlainTrack, importAndPlace } from "./ops";

type Group = "Drums" | "Instrument";

/** The "Add" chips. Instrument and Drums open a short list because Arrange needs to know which machine to create. */
export function AddTrackBar() {
  const [open, setOpen] = useState<{ group: Group; anchor: DOMRect } | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const choices = open ? INSTRUMENTS.filter((i) => (open.group === "Drums" ? i.section === "Drums" : i.section !== "Drums")) : [];

  const trigger = (group: Group) => (e: React.MouseEvent<HTMLButtonElement>) => setOpen({ group, anchor: e.currentTarget.getBoundingClientRect() });

  return (
    <div className="arr-add" role="group" aria-label="Add a track">
      <span className="arr-add-label">Add</span>
      <button type="button" className="chip" onClick={() => addPlainTrack("audio")}>
        Audio
      </button>
      <button type="button" className="chip" aria-haspopup="menu" onClick={trigger("Instrument")}>
        Instrument
      </button>
      <button type="button" className="chip" aria-haspopup="menu" onClick={trigger("Drums")}>
        Drums
      </button>
      <button type="button" className="chip" onClick={() => addPlainTrack("video")}>
        Video
      </button>
      <button type="button" className="chip" onClick={() => picker.current?.click()}>
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
        <PopMenu anchor={open.anchor} onClose={() => setOpen(null)} label={`Add ${open.group.toLowerCase()} track`}>
          {choices.map((i) => (
            <button
              key={i.kind}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(null);
                void addInstrumentTrack(i.kind);
              }}
            >
              <strong>{i.name}</strong>
              <small>{i.tagline}</small>
            </button>
          ))}
        </PopMenu>
      )}
    </div>
  );
}
