// One small tooltip for the whole studio, replacing the browser's native `title` popups, which land under
// the cursor and cover captions. It shows above the element, centred, after a pointer delay, and flips
// below only when there is no room above. Elements opt in with `data-tip`; a plain `title` is adopted on
// first hover so every room gets the same behaviour.

const SHOW_DELAY_MS = 550;
const GAP_PX = 8;
const EDGE_PX = 8;

let installed = false;

export function tipPosition(
  target: { left: number; top: number; width: number; bottom: number },
  tip: { width: number; height: number },
  viewport: { width: number; height: number },
): { left: number; top: number; below: boolean } {
  const centred = target.left + target.width / 2 - tip.width / 2;
  const left = Math.min(Math.max(EDGE_PX, centred), Math.max(EDGE_PX, viewport.width - tip.width - EDGE_PX));
  const above = target.top - GAP_PX - tip.height;
  const below = above < EDGE_PX;
  return { left, top: below ? Math.min(target.bottom + GAP_PX, viewport.height - tip.height - EDGE_PX) : above, below };
}

export function installTooltips(): void {
  if (installed || typeof document === "undefined") return;
  installed = true;
  const el = document.createElement("div");
  el.className = "tip";
  el.setAttribute("role", "tooltip");
  el.setAttribute("aria-hidden", "true");
  document.body.appendChild(el);

  let timer = 0;
  let current: HTMLElement | null = null;

  const hide = (): void => {
    window.clearTimeout(timer);
    current = null;
    el.classList.remove("on");
  };

  const show = (target: HTMLElement): void => {
    const text = target.dataset.tip;
    if (!text || !target.isConnected) return;
    el.textContent = text;
    el.classList.add("on");
    const pos = tipPosition(target.getBoundingClientRect(), el.getBoundingClientRect(), { width: innerWidth, height: innerHeight });
    el.style.transform = `translate(${Math.round(pos.left)}px, ${Math.round(pos.top)}px)`;
    el.dataset.side = pos.below ? "below" : "above";
  };

  document.addEventListener(
    "pointerover",
    (e) => {
      if (e.pointerType === "touch") return;
      const target = (e.target as Element | null)?.closest<HTMLElement>("[data-tip], [title]");
      if (target === current) return;
      hide();
      if (!target) return;
      // Adopt a native title so the browser's own popup never appears on top of ours.
      const title = target.getAttribute("title");
      if (title) {
        target.dataset.tip = title;
        target.removeAttribute("title");
      }
      current = target;
      timer = window.setTimeout(() => current === target && show(target), SHOW_DELAY_MS);
    },
    true,
  );
  document.addEventListener("pointerout", (e) => {
    if (current && !current.contains(e.relatedTarget as Node | null)) hide();
  });
  for (const type of ["pointerdown", "keydown", "wheel", "scroll"]) document.addEventListener(type, hide, true);
}
