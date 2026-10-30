import { describe, expect, it } from "vitest";
import { resolveConfig } from "@rbms/receipt-print";
import { posMessages } from "./messages";
import { configFromForm, DEVICE_KEYS, formFromConfig, LAYOUT_KEYS, pickKeys, validateForm, withPaperWidth } from "./printing-form";
import { failureKey } from "./printing";
import { posModule, POS_SETTINGS_PATHS } from "../module";

const base = () => formFromConfig(resolveConfig());

describe("Printing settings form", () => {
  it("round-trips the default config", () => {
    const c = configFromForm(base());
    expect(c).toMatchObject({ transport: "none", paperWidth: 80, charsPerLine: 48, widthDots: 576, cut: "partial", drawerPin: 0, openDrawerOnCash: true, showQr: true, autoPrint: false });
    expect(c.headerLines).toEqual([]);
  });

  it("header and footer text become trimmed lines, blanks dropped", () => {
    const f = { ...base(), headerText: " Open 9-9 \n\n GST inclusive ", footerText: "No exchange" };
    const c = configFromForm(f);
    expect(c.headerLines).toEqual(["Open 9-9", "GST inclusive"]);
    expect(c.footerLines).toEqual(["No exchange"]);
  });

  it("switching paper width moves characters per line and dots", () => {
    const f = withPaperWidth(base(), "58");
    expect(f).toMatchObject({ paperWidth: "58", charsPerLine: "32", widthDots: "384" });
    expect(withPaperWidth(f, "80")).toMatchObject({ charsPerLine: "48", widthDots: "576" });
  });

  it("validates numbers and line counts", () => {
    expect(validateForm(base())).toEqual({});
    expect(validateForm({ ...base(), charsPerLine: "10" }).charsPerLine).toBe(true);
    expect(validateForm({ ...base(), widthDots: "" }).widthDots).toBe(true);
    expect(validateForm({ ...base(), baudRate: "12" }).baudRate).toBe(true);
    expect(validateForm({ ...base(), headerText: "1\n2\n3\n4\n5\n6\n7" }).headerText).toBe(true);
    expect(validateForm({ ...base(), footerText: "x".repeat(65) }).footerText).toBe(true);
  });

  it("the bridge needs a loopback address and a long token", () => {
    const f = { ...base(), transport: "bridge" as const };
    expect(validateForm({ ...f, bridgeUrl: "http://127.0.0.1:9101", bridgeToken: "x".repeat(16) })).toEqual({});
    expect(validateForm({ ...f, bridgeUrl: "http://192.168.1.4:9101", bridgeToken: "x".repeat(16) }).bridgeUrl).toBe(true);
    expect(validateForm({ ...f, bridgeUrl: "http://127.0.0.1:9101", bridgeToken: "short" }).bridgeToken).toBe(true);
    // not required when another transport is picked
    expect(validateForm({ ...base(), transport: "usb", bridgeUrl: "nonsense" })).toEqual({});
  });

  it("device keys and shop-default keys do not overlap (shop defaults cannot carry the token)", () => {
    const cfg = configFromForm({ ...base(), transport: "bridge", bridgeToken: "t".repeat(20) });
    expect(Object.keys(pickKeys(cfg, DEVICE_KEYS))).toContain("bridgeToken");
    for (const k of DEVICE_KEYS) expect(LAYOUT_KEYS as readonly string[]).not.toContain(k);
  });
});

describe("Printing page wiring", () => {
  it("is a settings page behind the counter permission", () => {
    const page = posModule().settings?.find((p) => p.path === POS_SETTINGS_PATHS.printing);
    expect(page).toBeTruthy();
    expect(page?.feature).toBe("invoices");
    expect(page?.permission).toBe("invoices.create");
    expect(page?.label).toBe("pos.nav.printing");
  });

  it("English and Tamil have the same printing keys, and Tamil is not a copy of English", () => {
    const en = Object.keys(posMessages.en).filter((k) => k.startsWith("pos.printing.") || k.startsWith("pos.drawer.") || k === "pos.nav.printing");
    expect(en.length).toBeGreaterThan(50);
    for (const k of en) {
      expect(posMessages.ta[k], k).toBeTruthy();
      if (!/^pos\.printing\.(type\.usb|type\.serial|type\.bluetooth|paper58|paper80|drawerPin1)$/.test(k)) expect(posMessages.ta[k], k).not.toBe(posMessages.en[k]);
    }
  });

  it("every failure maps to a message key that exists in both languages", () => {
    for (const code of ["not_paired", "unsupported", "unsupported_url", "cancelled", "bridge_unreachable", "bridge_rejected", "no_endpoint", "io"] as const) {
      const key = failureKey(code);
      expect(posMessages.en[key], key).toBeTruthy();
      expect(posMessages.ta[key], key).toBeTruthy();
    }
  });
});
