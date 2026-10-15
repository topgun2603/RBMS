import { describe, expect, it } from "vitest";
import { cleanCode, createWedgeDetector } from "./scanner";

/** Feeds `text` then Enter, one key every `gap` ms from `start`. Returns what the detector reported. */
function type(d: ReturnType<typeof createWedgeDetector>, text: string, gap: number, start = 1000, enterGap = gap) {
  let time = start;
  const out: (string | null)[] = [];
  for (const ch of text) {
    out.push(d.push({ key: ch, time }));
    time += gap;
  }
  out.push(d.push({ key: "Enter", time: time - gap + enterGap }));
  return out.at(-1);
}

describe("scanner wedge detection", () => {
  it("reports a fast burst ending with Enter as a scan", () => {
    const d = createWedgeDetector();
    expect(type(d, "8901234567890", 8)).toBe("8901234567890");
  });

  it("ignores human typing (≥ 80 ms between keys)", () => {
    const d = createWedgeDetector();
    expect(type(d, "8901234567890", 120)).toBeNull();
  });

  it("needs the Enter to follow quickly too", () => {
    const d = createWedgeDetector();
    expect(type(d, "ABC12345", 10, 0, 400)).toBeNull();
  });

  it("respects the minimum length", () => {
    const d = createWedgeDetector({ minLength: 4 });
    expect(type(d, "123", 5)).toBeNull();
    expect(type(d, "1234", 5, 5000)).toBe("1234");
  });

  it("drops slow keys typed before the burst (person typed, then scanned)", () => {
    const d = createWedgeDetector();
    d.push({ key: "s", time: 0 });
    d.push({ key: "a", time: 300 });
    // 2 s later the scanner fires
    expect(type(d, "SKU-0042", 6, 2300)).toBe("SKU-0042");
  });

  it("restarts the buffer when a pause exceeds the gap mid-code", () => {
    const d = createWedgeDetector({ maxGapMs: 50 });
    d.push({ key: "1", time: 0 });
    d.push({ key: "2", time: 10 });
    d.push({ key: "3", time: 200 }); // pause: buffer becomes "3"
    d.push({ key: "4", time: 210 });
    d.push({ key: "5", time: 220 });
    d.push({ key: "6", time: 230 });
    expect(d.push({ key: "Enter", time: 240 })).toBe("3456");
  });

  it("keeps Shift (upper-case letters) from breaking a scan", () => {
    const d = createWedgeDetector();
    let time = 0;
    for (const ch of "AB12") {
      d.push({ key: "Shift", time });
      d.push({ key: ch, time: time + 2 });
      time += 9;
    }
    expect(d.push({ key: "Enter", time })).toBe("AB12");
  });

  it("treats non-printable keys (arrows, Backspace) as a person typing", () => {
    const d = createWedgeDetector();
    d.push({ key: "1", time: 0 });
    d.push({ key: "2", time: 5 });
    d.push({ key: "Backspace", time: 10 });
    d.push({ key: "3", time: 15 });
    expect(d.push({ key: "Enter", time: 20 })).toBeNull();
  });

  it("accepts Tab as the terminator and resets after each scan", () => {
    const d = createWedgeDetector();
    let time = 0;
    for (const ch of "12345") d.push({ key: ch, time: (time += 5) });
    expect(d.push({ key: "Tab", time: time + 5 })).toBe("12345");
    expect(d.buffer).toBe("");
    expect(d.push({ key: "Enter", time: time + 10 })).toBeNull();
  });

  it("reports `scanning` after two fast keys (so shortcut keys like '-' are not triggered)", () => {
    const d = createWedgeDetector();
    d.push({ key: "A", time: 0 });
    expect(d.scanning).toBe(false);
    d.push({ key: "-", time: 4 });
    expect(d.scanning).toBe(true);
  });

  it("rejects overly long noise", () => {
    const d = createWedgeDetector({ maxLength: 10 });
    expect(type(d, "12345678901", 3)).toBeNull();
  });

  it("cleans control characters around the code", () => {
    expect(cleanCode("\u0002 8901234567890 \r")).toBe("8901234567890");
  });
});
