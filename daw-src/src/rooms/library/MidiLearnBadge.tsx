import { midiRouter } from "../../audio/midi";
import { useStore } from "../../store/store";

/** Visible whenever MIDI learn is waiting for a controller, wherever it was started from. */
export function MidiLearnBadge() {
  const targetId = useStore(midiRouter.learn, (s) => s.targetId);
  const targets = useStore(midiRouter.targets, (t) => t);
  if (targetId === null) return null;
  const label = targets.find((t) => t.id === targetId)?.label ?? "a control";
  return (
    <span className="learn-badge" role="status">
      MIDI learn: move a knob or press a key for {label}
      <button type="button" className="learn-cancel" onClick={() => midiRouter.cancelLearn()}>Cancel</button>
    </span>
  );
}
