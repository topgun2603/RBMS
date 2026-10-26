import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const src = (p: string) => readFileSync(join(__dirname, p), "utf8");

describe("narrow-screen layout guards", () => {
  it.each(["components/content-editor.tsx", "pages/home.tsx", "pages/menus.tsx", "pages/settings-store.tsx", "pages/settings-branding.tsx", "pages/settings-appearance.tsx"])(
    "%s: form grid has a shrinkable single column",
    (f) => {
      expect(src(f)).toMatch(/<form [^>]*className="grid grid-cols-\[minmax\(0,1fr\)\]/);
    },
  );

  it("block palette buttons wrap long (Tamil) labels instead of spilling out of the button", () => {
    expect(src("components/block-editor.tsx")).toMatch(/h-auto min-h-11 min-w-0 justify-start[^"]*whitespace-normal/);
  });
});
