import { useEffect, useMemo, useRef, useState } from "react";
import { metronomeStore } from "../audio/arrangementPlayback";
import { peekEngine } from "../audio/engine";
import { INSTRUMENTS } from "../audio/instruments/registry";
import { runAppAction, selectedClipBpm } from "../shortcuts";
import { projectStore, uiStore } from "../store/project";
import { Icon } from "../ui/Icon";
import { Sheet } from "./Sheet";
import { buildPaletteItems, GROUP_ORDER, searchPalette, type PaletteContext, type PaletteItem } from "./palette";
import { displayKeys, isMacPlatform } from "./shortcutList";

function livePresets(): PaletteContext["presets"] {
  const engine = peekEngine();
  if (!engine) return [];
  const out: Array<PaletteContext["presets"][number]> = [];
  for (const slot of projectStore.get().instruments) {
    let instrument;
    try {
      instrument = engine.getInstrument(slot.id);
    } catch {
      // The instrument's room has not been opened yet, so its presets are not loaded.
      continue;
    }
    const info = INSTRUMENTS.find((i) => i.kind === slot.kind);
    for (const preset of instrument.presets) {
      out.push({
        id: `${slot.id}-${preset.id}`,
        name: preset.name,
        instrumentName: info?.name ?? slot.kind,
        load: () => {
          instrument.loadPreset(preset.id);
          location.hash = `#/play/${slot.kind}`;
        },
      });
    }
  }
  return out;
}

export function PaletteSheet({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const mac = isMacPlatform();

  const items = useMemo(() => {
    const project = projectStore.get();
    return buildPaletteItems({
      mac,
      run: runAppAction,
      clipBpm: selectedClipBpm(),
      tempo: project.bpm,
      instruments: INSTRUMENTS,
      openInstrument: (kind) => {
        location.hash = `#/play/${kind}`;
      },
      presets: livePresets(),
      loopOn: project.loop.on,
      metronomeOn: metronomeStore.get().on,
    });
  }, [mac]);

  const results = useMemo(() => searchPalette(items, query), [items, query]);
  const current = Math.min(active, Math.max(0, results.length - 1));

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [current, results]);

  const run = (item: PaletteItem | undefined): void => {
    if (!item) return;
    // Close first: some actions open another sheet, and that must win.
    uiStore.set((s) => (s.sheet === "palette" ? { ...s, sheet: null } : s));
    item.run();
  };

  let lastGroup = "";
  return (
    <Sheet title="Search and commands" width={640} placement="top" hideHead onClose={onClose}>
      <div className="palette-input">
        <Icon name="search" size={22} />
        <input
          data-autofocus
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={results[current] ? `palette-${results[current].id}` : undefined}
          aria-label="Search rooms, instruments, presets and actions"
          placeholder="Search rooms, instruments, presets, actions"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((current + 1) % Math.max(1, results.length));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((current - 1 + Math.max(1, results.length)) % Math.max(1, results.length));
            } else if (e.key === "Enter") {
              e.preventDefault();
              run(results[current]);
            }
          }}
        />
        <span className="kbd">esc</span>
      </div>
      <div id="palette-list" ref={listRef} className="palette-list" role="listbox" aria-label="Results" tabIndex={-1}>
        {results.length === 0 && <div className="palette-empty">Nothing answers to “{query}”. Try another word?</div>}
        {results.map((item, i) => {
          const heading = item.group !== lastGroup;
          lastGroup = item.group;
          return (
            <div key={item.id} role="presentation">
              {heading && (
                <div className="palette-group" role="presentation">
                  {GROUP_ORDER.includes(item.group) ? item.group : ""}
                </div>
              )}
              <button
                id={`palette-${item.id}`}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={i === current}
                className="palette-item"
                onMouseMove={() => setActive(i)}
                onClick={() => run(item)}
              >
                <span className="label">{item.label}</span>
                {item.hint && <span className="hint">{item.hint}</span>}
              </button>
            </div>
          );
        })}
      </div>
      <div className="palette-foot">
        <span>↑↓ choose</span>
        <span>↵ run</span>
        <span>{displayKeys("mod+/", mac)} all shortcuts</span>
      </div>
    </Sheet>
  );
}
