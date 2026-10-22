import { memo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from "react";
import { GlassWindow } from "../../../ui/hardware";
import { peekEngine } from "../../../audio/engine";
import { useRaf } from "../../../ui/hooks";
import { useNarrowPhone } from "../../../ui/layoutMode";
import { stepPages } from "./stepPages";
import "./drums.css";

export interface GridRow {
  key: string;
  label: string;
  color: string;
  selected?: boolean;
  dim?: boolean;
  onSelect?: () => void;
}

export interface CellInfo {
  /** 0 off, 1 on, 2 accent. */
  state: 0 | 1 | 2;
  /** 0 to 1 strength, drawn as the cell's brightness. */
  level?: number;
}

export interface Playhead {
  col: number;
  /** Which row to light; omit to light the whole column. */
  row?: number;
}

interface Props {
  rows: readonly GridRow[];
  cols: number;
  label: string;
  labelWidth?: number;
  getCell: (row: number, col: number) => CellInfo;
  onCell: (row: number, col: number, event: MouseEvent) => void;
  /** Maps the clock's current 16th step to the cell to light, or null when it is off this page. */
  playhead: (step: number) => Playhead | null;
  numbers?: boolean;
}

const GROUP = 4;
const PHONE_PAGE = 8;

/**
 * The step grid shared by the three drum machines. Rows share the available height through CSS
 * grid, so fifteen voices fit without scrolling. The playing column is lit straight from the
 * audio clock in an animation frame, never through React state.
 */
export const StepGrid = memo(function StepGrid({ rows, cols, label, labelWidth = 118, getCell, onCell, playhead, numbers }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const lit = useRef<Element[]>([]);
  const lastKey = useRef("");

  useRaf(() => {
    const el = root.current;
    if (!el) return;
    const engine = peekEngine();
    const target = engine?.clock.playing ? playhead(Math.floor(engine.clock.position())) : null;
    const key = target ? `${target.row ?? "*"}:${target.col}` : "";
    if (key === lastKey.current) return;
    lastKey.current = key;
    for (const cell of lit.current) cell.classList.remove("now");
    lit.current = [];
    if (!target) return;
    const sel = target.row === undefined ? `[data-c="${target.col}"]` : `[data-r="${target.row}"][data-c="${target.col}"]`;
    el.querySelectorAll(`.sg-cell${sel}`).forEach((cell) => {
      cell.classList.add("now");
      lit.current.push(cell);
    });
  });

  const move = (e: KeyboardEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    if (!t.classList.contains("sg-cell")) return;
    const r = Number(t.dataset.r);
    const c = Number(t.dataset.c);
    const next = e.key === "ArrowRight" ? [r, c + 1] : e.key === "ArrowLeft" ? [r, c - 1] : e.key === "ArrowDown" ? [r + 1, c] : e.key === "ArrowUp" ? [r - 1, c] : null;
    if (!next) return;
    const target = root.current?.querySelector<HTMLElement>(`.sg-cell[data-r="${next[0]}"][data-c="${next[1]}"]`);
    if (target) {
      e.preventDefault();
      target.focus();
    }
  };

  // Portrait phones show eight steps at a time (two groups of four) so each cell stays finger-sized; the pager picks the eight.
  const paged = useNarrowPhone();
  const pages = paged ? stepPages(cols, PHONE_PAGE) : [{ from: 0, to: cols }];
  const [pageAt, setPage] = useState(0);
  const page = pages[Math.min(pageAt, pages.length - 1)];
  const groups = Array.from({ length: cols / GROUP }, (_, g) => g).filter((g) => g * GROUP >= page.from && g * GROUP < page.to);
  return (
    <div className="sg" ref={root} role="group" aria-label={label} onKeyDown={move} style={{ "--lw": `${labelWidth}px`, "--sg-groups": groups.length } as CSSProperties}>
      {pages.length > 1 && (
        <div className="sg-pager seg" role="radiogroup" aria-label="Steps shown">
          {pages.map((p, i) => (
            <button key={p.from} type="button" role="radio" aria-checked={p === page} className={p === page ? "on" : ""} onClick={() => setPage(i)}>
              {p.from + 1}–{p.to}
            </button>
          ))}
        </div>
      )}
      {numbers && (
        <div className="sg-head" aria-hidden="true">
          <span />
          <div className="sg-cells">
            {groups.map((g) => (
              <span key={g} className="mono">
                {g * GROUP + 1}
              </span>
            ))}
          </div>
        </div>
      )}
      <GlassWindow className="sg-rows" style={{ gridTemplateRows: `repeat(${rows.length}, minmax(var(--sg-row-min), 1fr))` }}>
        {rows.map((row, r) => (
          <div className={`sg-row ${row.dim ? "dim" : ""}`} key={row.key} style={{ "--c": row.color } as CSSProperties}>
            {row.onSelect ? (
              <button type="button" className={`sg-label ${row.selected ? "sel" : ""}`} onClick={row.onSelect} aria-pressed={row.selected}>
                <span className="sg-dot" />
                <span className="sg-name">{row.label}</span>
              </button>
            ) : (
              <span className="sg-label plain mono">{row.label}</span>
            )}
            <div className="sg-cells">
              {groups.map((g) => (
                <div className={`sg-group ${g % 2 ? "alt" : ""}`} key={g}>
                  {Array.from({ length: GROUP }, (_, k) => {
                    const c = g * GROUP + k;
                    const cell = getCell(r, c);
                    return (
                      <button
                        key={c}
                        type="button"
                        className="sg-cell"
                        data-r={r}
                        data-c={c}
                        data-v={cell.state}
                        tabIndex={r === 0 && c === 0 ? 0 : -1}
                        aria-label={`${row.label} step ${c + 1}`}
                        aria-pressed={cell.state > 0}
                        style={cell.state ? ({ "--lv": cell.level ?? 1 } as CSSProperties) : undefined}
                        onFocus={(e) => {
                          root.current?.querySelector<HTMLElement>('.sg-cell[tabindex="0"]')?.setAttribute("tabindex", "-1");
                          e.currentTarget.tabIndex = 0;
                        }}
                        onClick={(e) => onCell(r, c, e)}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        ))}
      </GlassWindow>
    </div>
  );
});
