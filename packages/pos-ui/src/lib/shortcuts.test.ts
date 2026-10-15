import { describe, expect, it } from "vitest";
import { isEditable, SHORTCUTS, shortcutFor } from "./shortcuts";

describe("keyboard shortcut map", () => {
  it("maps the counter keys", () => {
    expect(shortcutFor({ key: "F2" })).toBe("search");
    expect(shortcutFor({ key: "F4" })).toBe("customer");
    expect(shortcutFor({ key: "F7" })).toBe("recall");
    expect(shortcutFor({ key: "F8" })).toBe("hold");
    expect(shortcutFor({ key: "F9" })).toBe("pay");
    expect(shortcutFor({ key: "F10" })).toBe("complete");
    expect(shortcutFor({ key: "Escape" })).toBe("cancel");
    expect(shortcutFor({ key: "+" })).toBe("qtyUp");
    expect(shortcutFor({ key: "=" })).toBe("qtyUp");
    expect(shortcutFor({ key: "-" })).toBe("qtyDown");
    expect(shortcutFor({ key: "Delete" })).toBe("remove");
    expect(shortcutFor({ key: "?" })).toBe("help");
  });

  it("function keys work while typing; single keys don't", () => {
    expect(shortcutFor({ key: "F9", editable: true })).toBe("pay");
    expect(shortcutFor({ key: "Escape", editable: true })).toBe("cancel");
    expect(shortcutFor({ key: "+", editable: true })).toBeNull();
    expect(shortcutFor({ key: "-", editable: true })).toBeNull();
    expect(shortcutFor({ key: "?", editable: true })).toBeNull();
    expect(shortcutFor({ key: "F1", editable: true })).toBe("help");
  });

  it("leaves Ctrl/Alt/Meta combinations and other keys to the browser", () => {
    expect(shortcutFor({ key: "F2", ctrlKey: true })).toBeNull();
    expect(shortcutFor({ key: "-", altKey: true })).toBeNull();
    expect(shortcutFor({ key: "p", metaKey: true })).toBeNull();
    expect(shortcutFor({ key: "a" })).toBeNull();
    expect(shortcutFor({ key: "Enter" })).toBeNull();
  });

  it("has no key bound twice and a description for every shortcut", () => {
    const keys = SHORTCUTS.flatMap((s) => s.keys);
    expect(new Set(keys).size).toBe(keys.length);
    for (const s of SHORTCUTS) expect(s.description).toMatch(/^pos\.keys\./);
  });

  it("detects text fields", () => {
    const el = (tagName: string, extra: Record<string, unknown> = {}) => ({ tagName, ...extra }) as unknown as EventTarget;
    expect(isEditable(el("INPUT", { type: "text" }))).toBe(true);
    expect(isEditable(el("INPUT", { type: "checkbox" }))).toBe(false);
    expect(isEditable(el("TEXTAREA"))).toBe(true);
    expect(isEditable(el("BUTTON"))).toBe(false);
    expect(isEditable(el("DIV", { isContentEditable: true }))).toBe(true);
    expect(isEditable(null)).toBe(false);
  });
});
