import { useState, type CSSProperties } from "react";
import { Button, Seg } from "../../../ui/controls";
import { Icon } from "../../../ui/Icon";
import { AudioTab } from "./AudioTab";
import { NotesTab } from "./NotesTab";
import { PatternTab } from "./PatternTab";
import { useClipContext } from "./shared";
import { useStore } from "../../../store/store";
import { projectStore } from "../../../store/project";
import { clipsUsingPattern, patternLetter } from "../patternEdit";
import "./editor.css";

type Tab = "audio" | "notes" | "pattern";

const TAB_FOR: Record<string, Tab> = { audio: "audio", midi: "notes", pattern: "pattern" };

function barRange(startBar: number, lengthBars: number): string {
  const end = startBar + lengthBars;
  const fmt = (n: number) => String(Math.round(n * 100) / 100);
  return `Bar ${fmt(startBar)}–${fmt(end)}`;
}

/**
 * The clip editor dialog over the arrangement: waveform tools for audio clips, a piano roll for midi clips and the
 * instrument's step grid for pattern clips. `multi` names a selection of several clips that cannot share one editor.
 */
export default function ClipEditor({ clipId, multi, onClose }: { clipId: string; multi?: number; onClose: () => void }) {
  const { clip, track, asset, time } = useClipContext(clipId);
  const [chosen, setChosen] = useState<{ id: string; tab: Tab } | null>(null);
  const [toolbar, setToolbar] = useState<HTMLElement | null>(null);
  const [footer, setFooter] = useState<HTMLElement | null>(null);
  const users = useStore(projectStore, (p) => (clip?.kind === "pattern" && track ? clipsUsingPattern(p, track.id, clip.patternIndex ?? 0).length : 0));

  if (!clip) {
    return (
      <section className="ce" aria-label="Editor">
        <div className="ce-empty">This clip is gone. Close the editor and pick another.</div>
        <Button onClick={onClose}>Close editor</Button>
      </section>
    );
  }

  if (multi && multi > 1) {
    return (
      <section className="ce" aria-label="Editor">
        <div className="ce-head">
          <div className="ce-title">
            <b>{multi} clips selected</b>
            <span>They play different things</span>
          </div>
          <div className="ce-tools" />
          <button type="button" className="icon-btn" aria-label="Close editor" title="Close editor" onClick={onClose}>
            <Icon name="close" size={22} />
          </button>
        </div>
        <div className="ce-multi">
          <b>{multi} clips selected</b>
          <span>Pick one clip, or clips that play the same pattern, to edit them here.</span>
        </div>
      </section>
    );
  }

  // The tab follows the clip: opening another clip shows the view for its kind.
  const tab: Tab = chosen?.id === clip.id ? chosen.tab : (TAB_FOR[clip.kind] ?? "audio");

  return (
    <section className="ce" aria-label="Editor" style={{ "--a1": track?.color ?? "var(--cyan)" } as CSSProperties}>
      <div className="ce-head">
        <Seg<Tab>
          label="Editor view"
          value={tab}
          onChange={(t) => setChosen({ id: clip.id, tab: t })}
          options={[
            { value: "audio", label: "Audio" },
            { value: "notes", label: "Notes" },
            { value: "pattern", label: "Pattern" },
          ]}
        />
        {tab === "pattern" && clip.kind === "pattern" ? (
          <div className="ce-title pe-title">
            <b>
              Editing pattern {patternLetter(clip.patternIndex ?? 0)} of {track?.name ?? "this track"}
            </b>
            {users > 1 ? (
              <span className="pe-warn" role="note">
                <span className="pe-warn-dot" aria-hidden="true" />
                Changes every clip that plays pattern {patternLetter(clip.patternIndex ?? 0)} ({users} clips)
              </span>
            ) : (
              <span>
                {clip.name} · {barRange(clip.startBar, clip.lengthBars)} · the only clip on this pattern
              </span>
            )}
          </div>
        ) : (
          <div className="ce-title">
            <b>{clip.name}</b>
            <span>
              {track?.name ?? "No track"} · {barRange(clip.startBar, clip.lengthBars)}
            </span>
          </div>
        )}
        <div className="ce-tools" ref={setToolbar} />
        <button type="button" className="icon-btn" aria-label="Close editor" title="Close editor" onClick={onClose}>
          <Icon name="close" size={22} />
        </button>
      </div>

      {tab === "audio" &&
        (clip.kind === "audio" ? (
          <AudioTab clip={clip} asset={asset} time={time} />
        ) : (
          <Unavailable text={clip.kind === "pattern" ? "This clip plays a pattern, not audio. Switch to Pattern to edit its steps." : "This clip holds notes, not audio. Switch to Notes to edit it."} />
        ))}
      {tab === "notes" &&
        (clip.kind === "midi" ? (
          <NotesTab clip={clip} track={track} time={time} toolbar={toolbar} />
        ) : (
          <Unavailable text={clip.kind === "pattern" ? "This clip plays a pattern. Switch to Pattern to edit its steps." : "Only MIDI clips have notes. Switch to Audio to edit this clip."} />
        ))}
      {tab === "pattern" &&
        (clip.kind === "pattern" ? (
          <PatternTab key={clip.id} clip={clip} track={track} toolbar={toolbar} footer={footer} />
        ) : (
          <Unavailable text={clip.kind === "midi" ? "This clip holds notes. Switch to Notes to edit them." : "Only pattern clips have steps. Switch to Audio to edit this clip."} />
        ))}
      <div className="ce-foot">
        <div className="ce-foot-actions" ref={setFooter} />
        <Button variant="primary" onClick={onClose} className="ce-done">
          Done
        </Button>
      </div>
    </section>
  );
}

function Unavailable({ text }: { text: string }) {
  return <div className="ce-empty">{text}</div>;
}
