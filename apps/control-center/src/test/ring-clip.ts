import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/postcss";
import postcss from "postcss";
import { chromium, type Browser } from "playwright";

/**
 * Selection and focus rings are box-shadows drawn OUTSIDE the card, so any
 * ancestor that clips (overflow other than visible) cuts them at its padding
 * edge unless it leaves room. jsdom has no layout, so this renders the real
 * components into the real compiled stylesheet in headless Chromium and
 * measures the painted ring against every clipping ancestor, side by side
 * (Paul, 23.10.2026, 7216: the selected theme card lost its top border).
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const globalsCss = path.join(root, "src/app/globals.css");

let stylesheet: Promise<string> | null = null;

/** The app's own stylesheet, compiled once per run from the sources on disk. */
function compiledCss(): Promise<string> {
  stylesheet ??= postcss([tailwindcss()])
    .process(readFileSync(globalsCss, "utf8"), { from: globalsCss })
    .then((result) => result.css);
  return stylesheet;
}

export type RingClip = {
  /** The container that cut the ring. */
  by: string;
  /** How many px of ring are missing. */
  cut: number;
  side: "top" | "right" | "bottom" | "left";
  /** The card, and whether it was only selected or also had keyboard focus. */
  target: string;
};

type RingOptions = {
  height: number;
  /** Cards to measure; each is checked at rest and with keyboard focus. */
  selector: string;
  width: number;
};

export async function launchRingBrowser(): Promise<Browser> {
  return chromium.launch();
}

/**
 * Loads the markup in the page shell the app has (layout.tsx: html and body
 * both clip x) and returns every side of every matched card's ring that a
 * clipping ancestor cuts. A scroll box is judged where the card sits nearest
 * its edge: the first row at scrollTop 0, the last row at the end, and a
 * focused card wherever focus scrolled it.
 */
export async function ringClips(
  browser: Browser,
  markup: string,
  { height, selector, width }: RingOptions,
): Promise<RingClip[]> {
  const page = await browser.newPage({ viewport: { width, height } });
  try {
    await page.setContent(
      `<!doctype html><html class="h-full overflow-x-hidden"><head><style>${await compiledCss()}</style></head>` +
        `<body class="flex min-h-full flex-col overflow-x-hidden">${markup}</body></html>`,
    );
    // Keyboard modality: after a key press, focus() shows :focus-visible.
    await page.keyboard.press("Tab");
    return await page.evaluate(measure, selector);
  } finally {
    await page.close();
  }
}

/** Runs in the page. */
function measure(selector: string): RingClip[] {
  type Box = { bottom: number; left: number; right: number; top: number };
  const px = (value: string) => Number.parseFloat(value) || 0;

  const shadows = (value: string) => {
    const parts: string[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < value.length; i += 1) {
      if (value[i] === "(") depth += 1;
      else if (value[i] === ")") depth -= 1;
      else if (value[i] === "," && depth === 0) {
        parts.push(value.slice(start, i));
        start = i + 1;
      }
    }
    parts.push(value.slice(start));
    return parts.flatMap((part) => {
      if (/^\s*none\s*$/.test(part)) return [];
      const color = part.match(/(?:rgba?|hsla?|color|oklab|oklch|lab|lch|hwb)\([^)]*\)/)?.[0] ?? "";
      const numbers = part.replace(color, "").match(/-?[\d.]+px/g)?.map(px) ?? [];
      const alpha = /\/\s*0(?:\.0+)?\s*\)/.test(color) || /^rgba\(.*,\s*0\)$/.test(color);
      return part.includes("inset") || alpha
        ? []
        : [{ blur: numbers[2] ?? 0, spread: numbers[3] ?? 0, x: numbers[0] ?? 0, y: numbers[1] ?? 0 }];
    });
  };

  /** The paint of the card's ring around its border box. */
  const ringBox = (el: Element): Box => {
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const out = { bottom: 0, left: 0, right: 0, top: 0 };
    for (const { blur, spread, x, y } of shadows(style.boxShadow)) {
      const reach = spread + blur;
      out.top = Math.max(out.top, reach - y);
      out.bottom = Math.max(out.bottom, reach + y);
      out.left = Math.max(out.left, reach - x);
      out.right = Math.max(out.right, reach + x);
    }
    if (style.outlineStyle !== "none" && px(style.outlineWidth) > 0) {
      const reach = px(style.outlineWidth) + px(style.outlineOffset);
      out.top = Math.max(out.top, reach);
      out.bottom = Math.max(out.bottom, reach);
      out.left = Math.max(out.left, reach);
      out.right = Math.max(out.right, reach);
    }
    return {
      bottom: rect.bottom + out.bottom,
      left: rect.left - out.left,
      right: rect.right + out.right,
      top: rect.top - out.top,
    };
  };

  const FOCUSABLE = 'button, a[href], input, select, textarea, [role="switch"], [tabindex]';
  /** A card by its name, a container by its label or its first classes. */
  const name = (el: Element) =>
    el.getAttribute("aria-label") || el.textContent?.trim().replace(/\s+/g, " ").slice(0, 24) || el.tagName.toLowerCase();
  const container = (el: Element) =>
    el.getAttribute("aria-label") ||
    `${el.tagName.toLowerCase()}.${(el.getAttribute("class") ?? "").split(/\s+/).slice(0, 3).join(".")}`;

  const root = document.documentElement;
  /** Where the padding box of a clipping ancestor starts; the viewport for the page itself. */
  const padding = (a: Element) => {
    if (a === root) return { left: 0, top: 0 };
    const rect = a.getBoundingClientRect();
    return { left: rect.left + a.clientLeft, top: rect.top + a.clientTop };
  };
  const scrolled = (a: Element) => (a === root ? window.scrollY : a.scrollTop);
  const scrollTo = (a: Element, y: number) => (a === root ? window.scrollTo(0, y) : void (a.scrollTop = y));

  const found: RingClip[] = [];
  const check = (el: Element, state: string, sidesOf: (ancestor: Element) => RingClip["side"][]) => {
    const ring = ringBox(el);
    for (let a = el.parentElement; a; a = a.parentElement) {
      const style = getComputedStyle(a);
      const clipsX = style.overflowX !== "visible";
      const clipsY = style.overflowY !== "visible";
      if (!clipsX && !clipsY) continue;
      const origin = padding(a);
      const clip: Box = {
        bottom: origin.top + a.clientHeight,
        left: origin.left,
        right: origin.left + a.clientWidth,
        top: origin.top,
      };
      const cuts: Record<RingClip["side"], [number, boolean]> = {
        bottom: [ring.bottom - clip.bottom, clipsY],
        left: [clip.left - ring.left, clipsX],
        right: [ring.right - clip.right, clipsX],
        top: [clip.top - ring.top, clipsY],
      };
      for (const side of sidesOf(a)) {
        const [cut, clips] = cuts[side];
        if (clips && cut > 0.5) {
          found.push({ by: container(a), cut: Math.round(cut * 10) / 10, side, target: `${name(el)} (${state})` });
        }
      }
    }
  };

  /**
   * Scrolls every scroll box around `el` to the end the card sits nearest to
   * and says, per box, which sides of the ring that position judges: the
   * sides across the scroll always, the one along it only at its own end.
   */
  const settle = (el: Element): ((ancestor: Element) => RingClip["side"][]) => {
    const judged = new Map<Element, RingClip["side"][]>();
    for (let a = el.parentElement; a; a = a.parentElement) {
      const sides: RingClip["side"][] = ["left", "right"];
      judged.set(a, sides);
      if (a.scrollHeight <= a.clientHeight + 1) {
        sides.push("top", "bottom");
        continue;
      }
      const style = getComputedStyle(a);
      if (style.overflowY === "visible") continue;
      const rect = el.getBoundingClientRect();
      const fromTop = rect.top - padding(a).top + scrolled(a);
      const fromBottom = a.scrollHeight - (fromTop + rect.height);
      if (fromTop - px(style.paddingTop) <= 1) {
        scrollTo(a, 0);
        sides.push("top");
      }
      if (fromBottom - px(style.paddingBottom) <= 1) {
        scrollTo(a, a.scrollHeight);
        sides.push("bottom");
      }
    }
    return (a) => judged.get(a) ?? [];
  };

  for (const card of document.querySelectorAll<HTMLElement>(selector)) {
    (document.activeElement as HTMLElement | null)?.blur();
    check(card, "at rest", settle(card));
    // A row that is not a control is judged by the control inside it.
    const control = card.matches(FOCUSABLE) ? card : card.querySelector<HTMLElement>(FOCUSABLE);
    if (!control || (control as HTMLButtonElement).disabled) continue;
    control.focus();
    if (!control.matches(":focus-visible")) throw new Error(`${name(control)} did not take keyboard focus`);
    check(control, "focused", settle(control));
  }
  return found;
}
