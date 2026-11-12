import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { cn } from "../lib/utils";
import { controlHeight } from "../lib/control";
import { initials } from "./avatar";
import { avatarHue, InitialsAvatar } from "./initials-avatar";
import { normalizeHex } from "./color-input";
import { isFilterActive } from "./data-table";
import { EmptyState } from "./empty-state";
import { Meter } from "./meter";
import { OtpInput } from "./otp-input";
import { Progress } from "./progress";
import { StatCard } from "./stat-card";
import { StatusPill } from "./status-pill";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);
const attr = (markup: string, name: string) => markup.match(new RegExp(`${name}="([^"]*)"`))?.[1];

describe("meter (credit used, stock level)", () => {
  const m = (value: number, max: number, extra: object = {}) => html(<Meter value={value} max={max} label="Credit used" {...extra} />);

  it("fills in proportion to value over max, and tells assistive tech the value in words", () => {
    const out = m(2_500, 10_000, { valueText: "₹25 of ₹100" });
    expect(out).toContain('width:25%');
    expect(attr(out, "aria-valuenow")).toBe("2500");
    expect(attr(out, "aria-valuemax")).toBe("10000");
    expect(attr(out, "aria-valuetext")).toBe("₹25 of ₹100");
    expect(attr(out, "aria-label")).toBe("Credit used");
  });

  it("keeps the fill between empty and full even when the value is over max or negative", () => {
    expect(m(15_000, 10_000)).toContain("width:100%");
    expect(attr(m(15_000, 10_000), "aria-valuenow")).toBe("10000");
    expect(m(-500, 10_000)).toContain("width:0%");
    expect(attr(m(-500, 10_000), "aria-valuenow")).toBe("0");
  });

  it("shows no fill when there is no maximum (no credit limit)", () => {
    expect(m(500, 0)).toContain("width:0%");
  });

  it("is brand coloured up to the warning point, warning past it, and red past 100%", () => {
    expect(m(8_000, 10_000)).toContain("bg-primary");
    expect(m(8_001, 10_000)).toContain("bg-warning");
    expect(m(10_000, 10_000)).toContain("bg-warning");
    expect(m(10_001, 10_000)).toContain("bg-destructive");
    // A caller can move the warning point, or push it out of reach.
    expect(m(5_001, 10_000, { warnAt: 0.5 })).toContain("bg-warning");
    expect(m(9_999, 10_000, { warnAt: 2 })).toContain("bg-primary");
  });
});

describe("progress", () => {
  it("clamps to 0 to 100% and shifts the bar by what is left", () => {
    expect(html(<Progress value={30} />)).toContain("translateX(-70%)");
    expect(html(<Progress value={250} />)).toContain("translateX(-0%)");
    expect(html(<Progress value={-20} />)).toContain("translateX(-100%)");
    expect(html(<Progress />)).toContain("translateX(-100%)");
  });
});

describe("stat card", () => {
  it("shows the title, value, description and trend", () => {
    const out = html(<StatCard title="Sales today" value="₹12,500" description="vs ₹10,000 yesterday" trend="+25%" trendTone="up" />);
    expect(out).toContain("Sales today");
    expect(out).toContain("₹12,500");
    expect(out).toContain("vs ₹10,000 yesterday");
    expect(out).toMatch(/text-success-ink[^>]*>\+25%/);
  });

  it("colours a falling trend as bad and a flat one as plain", () => {
    expect(html(<StatCard title="x" value="1" trend="-5%" trendTone="down" />)).toMatch(/text-danger-ink[^>]*>-5%/);
    expect(html(<StatCard title="x" value="1" trend="0%" />)).toMatch(/text-muted-foreground[^>]*>0%/);
  });

  it("hides the value, trend and footer while loading, so a stale number is never shown", () => {
    const out = html(<StatCard title="Sales today" value="₹12,500" trend="+25%" footer={<i>spark</i>} loading />);
    expect(out).toContain("Sales today");
    expect(out).not.toContain("₹12,500");
    expect(out).not.toContain("+25%");
    expect(out).not.toContain("spark");
  });
});

describe("status pill and empty state", () => {
  it("carries its tone for styling and always shows the label text", () => {
    const out = html(<StatusPill tone="danger">Overdue</StatusPill>);
    expect(attr(out, "data-tone")).toBe("danger");
    expect(out).toContain("Overdue");
    expect(attr(html(<StatusPill>Draft</StatusPill>), "data-tone")).toBe("neutral");
  });

  it("shows an icon only when given, and the larger size on request", () => {
    const Icon = (p: { className?: string }) => <svg data-testid="i" className={p.className} />;
    expect(html(<StatusPill icon={Icon}>Paid</StatusPill>)).toContain("<svg");
    expect(html(<StatusPill>Paid</StatusPill>)).not.toContain("<svg");
    expect(html(<StatusPill size="md">Paid</StatusPill>)).toContain("h-7");
  });

  it("shows title, hint and action; leaves out a hint or action that is not given", () => {
    const full = html(<EmptyState title="No bills yet" description="Create your first bill." action={<button>New bill</button>} />);
    expect(full).toContain("No bills yet");
    expect(full).toContain("Create your first bill.");
    expect(full).toContain("New bill");
    const bare = html(<EmptyState title="Nothing here" />);
    expect(bare).toContain("Nothing here");
    expect(bare).not.toContain("<button");
    expect(bare).not.toContain("max-w-sm");
  });
});

describe("one-time code boxes", () => {
  const boxes = (value: string, length?: number) => [...html(<OtpInput value={value} onChange={() => undefined} length={length} />).matchAll(/<input[^>]*>/g)].map((m) => m[0]);
  const valueOf = (input: string) => attr(input, "value");

  it("shows one box per digit, six by default, each labelled with its position", () => {
    const b = boxes("");
    expect(b).toHaveLength(6);
    expect(attr(b[0]!, "aria-label")).toBe("One-time code digit 1");
    expect(attr(b[5]!, "aria-label")).toBe("One-time code digit 6");
    expect(boxes("", 4)).toHaveLength(4);
  });

  it("fills boxes from the left with only the digits, ignoring letters and extra digits", () => {
    expect(boxes("12").map(valueOf)).toEqual(["1", "2", "", "", "", ""]);
    expect(boxes("1a2-3 4").map(valueOf)).toEqual(["1", "2", "3", "4", "", ""]);
    expect(boxes("12345678").map(valueOf)).toEqual(["1", "2", "3", "4", "5", "6"]);
  });

  it("asks the phone for the SMS code on the first box only", () => {
    const b = boxes("");
    expect(attr(b[0]!, "autoComplete")).toBe("one-time-code");
    expect(attr(b[1]!, "autoComplete")).toBe("off");
  });

  it("marks every box invalid and disabled together", () => {
    const out = html(<OtpInput value="" onChange={() => undefined} invalid disabled />);
    expect(out.match(/aria-invalid="true"/g)).toHaveLength(6);
    expect(out.match(/disabled=""/g)).toHaveLength(6);
  });
});

describe("small helpers", () => {
  it("expands and lower-cases a hex colour and refuses anything else", () => {
    expect(normalizeHex("#ABC")).toBe("#aabbcc");
    expect(normalizeHex("2563EB")).toBe("#2563eb");
    expect(normalizeHex("  #2563eb ")).toBe("#2563eb");
    expect(normalizeHex("#12")).toBeNull();
    expect(normalizeHex("#12345")).toBeNull();
    expect(normalizeHex("#ggg")).toBeNull();
    expect(normalizeHex("")).toBeNull();
  });

  it("takes up to two initials from a name, in any script, and ? when empty", () => {
    expect(initials("Priya Raman")).toBe("PR");
    expect(initials("  anbu   selvan kumar ")).toBe("AK");
    expect(initials("Murugan")).toBe("M");
    expect(initials("")).toBe("?");
    expect(initials(null)).toBe("?");
  });

  // BUG: avatar.tsx:36 takes the first code point, so Tamil "முருகன்" gets "ம" (bare consonant) instead of its first letter "மு".
  it.fails("keeps the vowel sign on a Tamil initial", () => {
    expect(initials("முருகன்")).toBe("மு");
  });

  it("gives the same name the same tint every time, whatever its case or spacing", () => {
    expect(avatarHue("Priya Raman")).toBe(avatarHue("  priya raman "));
    expect([25, 55, 85, 150, 190, 230, 270, 320]).toContain(avatarHue("Anyone"));
    const out = html(<InitialsAvatar name="Priya Raman" size="lg" />);
    expect(out).toContain(`--av-h:${avatarHue("Priya Raman")}`);
    expect(out).toContain("PR");
    expect(out).toContain("size-14");
  });

  it("picks one height class per control size and defaults to 40px", () => {
    expect(controlHeight()).toBe("h-10");
    expect(controlHeight(null)).toBe("h-10");
    expect(controlHeight("sm")).toBe("h-9");
    expect(controlHeight("lg")).toBe("h-11");
  });

  it("merges class names with the later one winning, including the kit's named spacing steps", () => {
    expect(cn("px-4", "px-6")).toBe("px-6");
    expect(cn("px-4", "px-card")).toBe("px-card");
    expect(cn("text-sm", false && "x", undefined, "font-bold")).toBe("text-sm font-bold");
    expect(cn("text-xs", "text-meta")).toBe("text-meta");
  });

  it("counts a table filter as active only when it has a value", () => {
    expect(isFilterActive({ kind: "options", value: ["paid"] } as never)).toBe(true);
    expect(isFilterActive({ kind: "options", value: [] } as never)).toBe(false);
    expect(isFilterActive({ kind: "date", value: { from: "2026-11-01" } } as never)).toBe(true);
    expect(isFilterActive({ kind: "date", value: { to: "2026-11-30" } } as never)).toBe(true);
    expect(isFilterActive({ kind: "date", value: {} } as never)).toBe(false);
  });
});
