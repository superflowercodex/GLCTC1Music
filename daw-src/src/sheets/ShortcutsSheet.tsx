import { Sheet } from "./Sheet";
import { displayKeys, isMacPlatform, SHORTCUT_GROUPS } from "./shortcutList";

export function ShortcutsSheet({ onClose }: { onClose: () => void }) {
  const mac = isMacPlatform();
  return (
    <Sheet title="Shortcuts" subtitle={`Press ${displayKeys("mod+/", mac)} any time`} width={720} onClose={onClose}>
      {SHORTCUT_GROUPS.map((group) => (
        <section key={group.name} className="shortcut-group" aria-label={group.name}>
          <h3>{group.name}</h3>
          <div className="shortcut-grid">
            {group.items.map((s) => (
              <div key={s.what} className="shortcut-row">
                <span>{s.what}</span>
                <span className="kbd">{displayKeys(s.keys, mac)}</span>
              </div>
            ))}
          </div>
        </section>
      ))}
      <p className="field-help">Number keys play pads only while an instrument room is open, so they never fire by accident in other rooms.</p>
      <button type="button" className="btn btn-ghost" data-autofocus onClick={onClose}>
        Close
      </button>
    </Sheet>
  );
}
