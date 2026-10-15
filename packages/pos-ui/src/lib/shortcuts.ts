/** Counter keyboard shortcuts. Function keys work everywhere; single keys only outside text fields. */

export type ShortcutAction = "search" | "customer" | "hold" | "recall" | "pay" | "complete" | "cancel" | "qtyUp" | "qtyDown" | "help" | "remove";

export interface Shortcut {
  action: ShortcutAction;
  /** KeyboardEvent.key values that trigger it. */
  keys: readonly string[];
  /** Label shown on the key cap. */
  label: string;
  /** Also fires while typing in a text field. */
  global: boolean;
  /** Message key of the description. */
  description: string;
}

export const SHORTCUTS: readonly Shortcut[] = [
  { action: "search", keys: ["F2"], label: "F2", global: true, description: "pos.keys.search" },
  { action: "customer", keys: ["F4"], label: "F4", global: true, description: "pos.keys.customer" },
  { action: "hold", keys: ["F8"], label: "F8", global: true, description: "pos.keys.hold" },
  { action: "recall", keys: ["F7"], label: "F7", global: true, description: "pos.keys.recall" },
  { action: "pay", keys: ["F9"], label: "F9", global: true, description: "pos.keys.pay" },
  { action: "complete", keys: ["F10"], label: "F10", global: true, description: "pos.keys.complete" },
  { action: "cancel", keys: ["Escape"], label: "Esc", global: true, description: "pos.keys.cancel" },
  { action: "qtyUp", keys: ["+", "="], label: "+", global: false, description: "pos.keys.qtyUp" },
  { action: "qtyDown", keys: ["-", "_"], label: "−", global: false, description: "pos.keys.qtyDown" },
  { action: "remove", keys: ["Delete"], label: "Del", global: false, description: "pos.keys.remove" },
  { action: "help", keys: ["?", "F1"], label: "?", global: false, description: "pos.keys.help" },
];

export interface KeyInput {
  key: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  /** Focus is in an input, textarea, select or contenteditable. */
  editable?: boolean;
}

/** The action for a keydown, or null. Ctrl/Alt/Meta combinations are left to the browser. */
export function shortcutFor(e: KeyInput): ShortcutAction | null {
  if (e.ctrlKey || e.altKey || e.metaKey) return null;
  for (const s of SHORTCUTS) {
    if (!s.keys.includes(e.key)) continue;
    // F1 is the one "help" key that also works in fields.
    if (s.action === "help" && e.key === "F1") return "help";
    if (!s.global && e.editable) return null;
    return s.action;
  }
  return null;
}

/** True when the element takes text input (so single-key shortcuts must not fire). */
export function isEditable(el: EventTarget | null): boolean {
  if (!el || typeof (el as HTMLElement).tagName !== "string") return false;
  const node = el as HTMLElement;
  const tag = node.tagName.toLowerCase();
  if (tag === "textarea" || tag === "select") return true;
  if (tag === "input") {
    const type = ((node as HTMLInputElement).type || "text").toLowerCase();
    return !["button", "checkbox", "radio", "submit", "reset", "range", "color", "file"].includes(type);
  }
  return node.isContentEditable === true;
}
