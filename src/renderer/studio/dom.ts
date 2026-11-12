/** 渲染层只用这些 DOM 工具。页面不碰 Node，也不拼用户内容进 HTML。 */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export function clear(node: HTMLElement): void {
  node.replaceChildren();
}

export function on<T extends EventTarget>(
  target: T,
  type: string,
  fn: (event: Event) => void,
): () => void {
  target.addEventListener(type, fn);
  return () => target.removeEventListener(type, fn);
}

export type PageSession = {
  track: (stop: () => void) => void;
  later: (fn: () => void, ms: number) => void;
  destroy: () => void;
  readonly destroyed: boolean;
};

/** 页面卸载时清掉监听和定时器。重复调用无副作用。 */
export function createPageSession(): PageSession {
  const stops: Array<() => void> = [];
  let destroyed = false;
  return {
    track(stop) {
      if (destroyed) {
        stop();
        return;
      }
      stops.push(stop);
    },
    later(fn, ms) {
      const id = setTimeout(fn, ms);
      this.track(() => clearTimeout(id));
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const stop of stops.splice(0)) stop();
    },
    get destroyed() {
      return destroyed;
    },
  };
}

export function field(label: string, control: HTMLElement): HTMLElement {
  const wrap = el("label", "field");
  wrap.append(el("span", "field-label", label), control);
  return wrap;
}

export function icon(name: "home" | "compose" | "metrics" | "comments" | "accounts" | "tasks"): SVGElement {
  const paths: Record<typeof name, string> = {
    home: "M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z",
    compose: "M4 20h4l10-10-4-4L4 16zM13 7l4 4",
    metrics: "M5 19V10M12 19V5M19 19v-7",
    comments: "M5 6h14v9H8l-3 3z",
    accounts: "M12 12a3.5 3.5 0 1 0-3.5-3.5A3.5 3.5 0 0 0 12 12zM5 20a7 7 0 0 1 14 0",
    tasks: "M8 6h11M8 12h11M8 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01",
  };
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "20");
  svg.setAttribute("height", "20");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.75");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", paths[name]);
  svg.append(path);
  return svg;
}
