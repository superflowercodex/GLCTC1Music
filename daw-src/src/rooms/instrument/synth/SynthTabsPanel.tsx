import { useState, type ReactNode } from "react";
import type { Instrument } from "../../../audio/types";
import { useInstrument } from "../../../ui/hooks";
import { ParamControl } from "./ParamControls";
import { PresetFileButtons } from "./PresetFileButtons";

export interface SynthTab {
  name: string;
  groups: readonly string[];
  /** Extra content under the controls, e.g. a hold-to-sweep button. */
  footer?: ReactNode;
  /** Hide parameters a custom surface already edits. */
  hide?: readonly string[];
}

export function SynthTabsPanel({ instrument, tabs, initialTab = 0, children }: { instrument: Instrument; tabs: readonly SynthTab[]; initialTab?: number; children?: ReactNode }) {
  useInstrument(instrument);
  const [index, setIndex] = useState(initialTab);
  const tab = tabs[index];
  const labelled = tab.groups.length > 1;
  return (
    <div className="sy-panel">
      <div className="sy-tabs" role="tablist" aria-label="Sound sections">
        {tabs.map((t, i) => (
          <button key={t.name} type="button" role="tab" aria-selected={i === index} className={i === index ? "on" : ""} onClick={() => setIndex(i)}>
            {t.name}
          </button>
        ))}
      </div>
      {children}
      <div className="sy-params scroll-y" role="tabpanel" aria-label={tab.name}>
        {tab.groups.map((group) => (
          <section key={group} className="sy-group">
            {labelled && <h3 className="sy-subhead">{group}</h3>}
            {instrument.params
              .filter((p) => p.group === group && !tab.hide?.includes(p.id))
              .map((def) => (
                <ParamControl key={def.id} instrument={instrument} def={def} />
              ))}
          </section>
        ))}
        {tab.footer}
      </div>
      <div className="sy-foot">
        <PresetFileButtons instrument={instrument} />
      </div>
    </div>
  );
}
