import { useState } from "react";
import { Button, Seg } from "../../../ui/controls";
import { Icon } from "../../../ui/Icon";
import { AudioTab } from "./AudioTab";
import { NotesTab } from "./NotesTab";
import { useClipContext } from "./shared";
import "./editor.css";

type Tab = "audio" | "notes";

function barRange(startBar: number, lengthBars: number): string {
  const end = startBar + lengthBars;
  const fmt = (n: number) => String(Math.round(n * 100) / 100);
  return `Bar ${fmt(startBar)}–${fmt(end)}`;
}

/** Drawer under the Arrange timeline: waveform tools for audio clips, a piano roll for midi clips. */
export default function ClipEditor({ clipId, onClose }: { clipId: string; onClose: () => void }) {
  const { clip, track, asset, time } = useClipContext(clipId);
  const [chosen, setChosen] = useState<Tab | null>(null);

  if (!clip) {
    return (
      <section className="panel glass ce" aria-label="Editor">
        <div className="ce-empty">This clip is gone. Close the editor and pick another.</div>
        <Button onClick={onClose}>Close editor</Button>
      </section>
    );
  }

  const tab: Tab = chosen ?? (clip.kind === "midi" ? "notes" : "audio");

  return (
    <section className="panel glass ce" aria-label="Editor">
      <div className="ce-head">
        <Seg<Tab>
          label="Editor view"
          value={tab}
          onChange={setChosen}
          options={[
            { value: "audio", label: "Audio" },
            { value: "notes", label: "Notes" },
          ]}
        />
        <div className="ce-title">
          <b>{clip.name}</b>
          <span>
            {track?.name ?? "No track"} · {barRange(clip.startBar, clip.lengthBars)}
          </span>
        </div>
        <Button onClick={onClose}>
          Close editor <Icon name="close" size={18} />
        </Button>
      </div>

      {tab === "audio" && (clip.kind === "audio" ? <AudioTab clip={clip} asset={asset} time={time} /> : <Unavailable text="This clip holds notes, not audio. Switch to Notes to edit it." />)}
      {tab === "notes" &&
        (clip.kind === "midi" ? (
          <NotesTab clip={clip} track={track} time={time} />
        ) : (
          <Unavailable
            text={
              clip.kind === "pattern"
                ? "Pattern clips are edited in their instrument's room."
                : "Only MIDI clips have notes. Switch to Audio to edit this clip."
            }
          />
        ))}
    </section>
  );
}

function Unavailable({ text }: { text: string }) {
  return <div className="ce-empty">{text}</div>;
}
