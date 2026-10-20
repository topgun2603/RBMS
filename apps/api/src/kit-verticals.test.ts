import { describe, expect, it } from "vitest";
import type { FeatureDef } from "@srirealtime/core";
import { PACKS } from "@srirealtime/verticals";
import { createSolutionPresets, defaultPreset, effectivePreset, includedFor, switchableFor } from "./kit-verticals";

const def = (key: string, extra: Partial<FeatureDef> = {}): FeatureDef => ({
  key,
  module: key.split(".")[0]!,
  label: key,
  description: "",
  ...extra,
});

const REGISTRY: FeatureDef[] = [
  def("invoices"),
  def("invoices.credit-book", { shopToggle: true }),
  def("jobcards", { shopToggle: true }),
  def("jobcards.tracking", { shopToggle: true, dependsOn: ["jobcards"] }),
  def("memberships", { shopToggle: true }),
  def("bookings", { shopToggle: true }),
  def("serials", { shopToggle: true, defaultOn: false }),
  def("serials.warranty", { shopToggle: true, defaultOn: false }),
  def("scales", { shopToggle: true, defaultOn: false }),
];
const SV = ["invoices", "invoices.credit-book", "jobcards.*", "memberships.*", "bookings.*", "serials.*"];

describe("solution presets", () => {
  it("splits the app's features into switchable and always included", () => {
    expect(switchableFor(REGISTRY, SV).map((d) => d.key)).toEqual([
      "invoices.credit-book",
      "jobcards",
      "jobcards.tracking",
      "memberships",
      "bookings",
      "serials",
      "serials.warranty",
    ]);
    expect(includedFor(REGISTRY, SV).map((d) => d.key)).toEqual(["invoices"]);
    // scales isn't in the app: not switchable for its shops
    expect(switchableFor(REGISTRY, SV).some((d) => d.key === "scales")).toBe(false);
  });

  it("defaults: on-by-default features, plus the trade's engines, minus what the trade doesn't use", () => {
    const sw = switchableFor(REGISTRY, SV);
    // gym: no job cards (module id switches off the whole module)
    expect(defaultPreset(PACKS.gym, sw)).toEqual(["invoices.credit-book", "memberships", "bookings"]);
    // repair: serial numbers on, no memberships
    expect(defaultPreset(PACKS.repair, sw)).toEqual(["invoices.credit-book", "jobcards", "jobcards.tracking", "bookings", "serials", "serials.warranty"]);
  });

  it("a stored preset is narrowed to what the app can switch now", () => {
    const sw = switchableFor(REGISTRY, SV);
    expect(effectivePreset(["memberships", "scales", "gone"], PACKS.gym, sw)).toEqual(["memberships"]);
    expect(effectivePreset(undefined, PACKS.gym, sw)).toEqual(defaultPreset(PACKS.gym, sw));
  });

  it("saves, resets and turns a preset into shop switches", async () => {
    let stored: Record<string, string[]> = {};
    const presets = createSolutionPresets({
      registry: () => REGISTRY,
      profile: async (appId) => (appId === "SV" ? { features: SV } : null),
      settings: { get: async () => ({ presets: stored }), setApp: async (p) => void (stored = p.presets) },
    });
    const v = await presets.save("gym", ["memberships", "jobcards"]);
    expect(v.customised).toBe(true);
    expect(v.on).toEqual(["jobcards", "memberships"]);
    expect(await presets.toggles("gym", "SV")).toMatchObject({ jobcards: true, memberships: true, bookings: false, serials: false });
    await expect(presets.save("gym", ["scales"])).rejects.toThrow(/Not switchable/);
    const reset = await presets.save("gym", null);
    expect(reset.customised).toBe(false);
    expect(reset.switchable.find((d) => d.key === "jobcards")).toMatchObject({ on: false, byDefault: false });
    const summary = await presets.summary();
    expect(summary.gym).toEqual({ on: 3, switchable: 7, customised: false });
  });
});
