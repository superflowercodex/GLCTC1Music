import { BAR_CHOICES } from "./bounceToTrack";

export function BarsSelect({ bars, onChange }: { bars: number; onChange: (bars: number) => void }) {
  return (
    <select className="sy-select inline" aria-label="Bounce length" value={bars} onChange={(e) => onChange(Number(e.target.value))}>
      {BAR_CHOICES.map((b) => (
        <option key={b} value={b}>
          {b} {b === 1 ? "bar" : "bars"}
        </option>
      ))}
    </select>
  );
}
