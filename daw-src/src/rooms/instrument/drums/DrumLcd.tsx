import { projectStore } from "../../../store/project";
import { useStore } from "../../../store/store";
import { Display } from "../../../ui/hardware";

export interface LcdCell {
  label: string;
  value: string;
}

/** Pattern, groove and tempo as small kit displays; the tempo cell follows the project BPM. */
export function DrumLcd({ cells }: { cells: readonly LcdCell[] }) {
  const bpm = useStore(projectStore, (p) => p.bpm);
  const all = [...cells, { label: "BPM", value: String(Math.round(bpm)) }];
  return (
    <div className="lcd" role="group" aria-label="Display">
      {all.map((c) => (
        <Display key={c.label} size="sm" label={c.label} value={c.value} />
      ))}
    </div>
  );
}
