import type { SpeechDebugView } from "./speechDebug";

interface DebugElement<Child = unknown> {
  style: {
    background?: string;
    borderRadius?: string;
    color?: string;
    display?: string;
    fontFamily?: string;
    fontSize?: string;
    left?: string;
    lineHeight?: string;
    margin?: string;
    padding?: string;
    pointerEvents?: string;
    position?: string;
    top?: string;
    whiteSpace?: string;
    zIndex?: string;
  };
  textContent: string | null;
  appendChild(child: Child): unknown;
  remove(): void;
}

interface SpeechDebugDocument<Element extends DebugElement<Element>> {
  createElement(tagName: "div" | "pre"): Element;
  body: {
    appendChild(child: Element): unknown;
  };
}

/**
 * Build the compact DOM view. It is presentation-only and is dynamically
 * imported by development builds; release builds never construct it.
 */
export function createSpeechDebugView<Element extends DebugElement>(
  document: SpeechDebugDocument<Element>,
): SpeechDebugView {
  const container = document.createElement("div");
  const text = document.createElement("pre");

  Object.assign(container.style, {
    position: "fixed",
    top: "12px",
    left: "12px",
    display: "block",
    padding: "8px 10px",
    border: "1px solid rgba(255, 255, 255, 0.28)",
    borderRadius: "6px",
    background: "rgba(17, 24, 39, 0.82)",
    color: "rgba(248, 250, 252, 0.94)",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: "11px",
    lineHeight: "1.45",
    pointerEvents: "none",
    whiteSpace: "pre",
    zIndex: "2147483647",
  });
  Object.assign(text.style, { margin: "0" });
  container.appendChild(text);
  document.body.appendChild(container);

  return {
    setVisible(visible) {
      container.style.display = visible ? "block" : "none";
    },
    setLines(lines) {
      text.textContent = lines.join("\n");
    },
    destroy() {
      container.remove();
    },
  };
}
