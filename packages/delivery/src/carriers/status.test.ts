import { describe, expect, it } from "vitest";
import type { ShipmentEvent } from "../schema";
import { canTransition, mapShiprocketStatus, mergeEvents, nextMockStatus, parseCarrierTime } from "./status";

describe("status transitions", () => {
  it("only moves forward, with rto/cancelled as exits", () => {
    expect(canTransition("created", "in_transit")).toBe(true);
    expect(canTransition("in_transit", "created")).toBe(false);
    expect(canTransition("out_for_delivery", "in_transit")).toBe(false);
    expect(canTransition("in_transit", "in_transit")).toBe(false);
    expect(canTransition("in_transit", "rto")).toBe(true);
    expect(canTransition("created", "cancelled")).toBe(true);
    expect(canTransition("delivered", "rto")).toBe(false);
    expect(canTransition("cancelled", "in_transit")).toBe(false);
    expect(canTransition("rto", "delivered")).toBe(false);
  });

  it("steps the mock carrier along the happy path", () => {
    expect(nextMockStatus("created")).toBe("pickup_scheduled");
    expect(nextMockStatus("pickup_scheduled")).toBe("in_transit");
    expect(nextMockStatus("in_transit")).toBe("out_for_delivery");
    expect(nextMockStatus("out_for_delivery")).toBe("delivered");
    expect(nextMockStatus("delivered")).toBeNull();
    expect(nextMockStatus("cancelled")).toBeNull();
  });
});

describe("mapShiprocketStatus", () => {
  it.each([
    ["DELIVERED", "delivered"],
    ["Delivered", "delivered"],
    ["OUT FOR DELIVERY", "out_for_delivery"],
    ["IN TRANSIT", "in_transit"],
    ["In Transit", "in_transit"],
    ["SHIPPED", "in_transit"],
    ["PICKED UP", "in_transit"],
    ["REACHED AT DESTINATION HUB", "in_transit"],
    ["UNDELIVERED", "in_transit"],
    ["PICKUP SCHEDULED", "pickup_scheduled"],
    ["OUT FOR PICKUP", "pickup_scheduled"],
    ["Pickup Generated", "pickup_scheduled"],
    ["AWB ASSIGNED", "created"],
    ["NEW", "created"],
    ["RTO INITIATED", "rto"],
    ["RTO DELIVERED", "rto"],
    ["RTO_IN_TRANSIT", "rto"],
    ["CANCELED", "cancelled"],
    ["Cancelled", "cancelled"],
  ])("%s → %s", (label, status) => {
    expect(mapShiprocketStatus(label)).toBe(status);
  });

  it("no status of ours for lost / damaged / cancellation requested", () => {
    expect(mapShiprocketStatus("LOST")).toBeNull();
    expect(mapShiprocketStatus("DAMAGED")).toBeNull();
    expect(mapShiprocketStatus("CANCELLATION REQUESTED")).toBeNull();
  });

  it("falls back to the numeric code", () => {
    expect(mapShiprocketStatus("", 7)).toBe("delivered");
    expect(mapShiprocketStatus(undefined, "17")).toBe("out_for_delivery");
    expect(mapShiprocketStatus("Some new label", 18)).toBe("in_transit");
    expect(mapShiprocketStatus("??", 9999)).toBeNull();
    expect(mapShiprocketStatus(null, null)).toBeNull();
  });
});

describe("events", () => {
  const e = (at: string, label: string): ShipmentEvent => ({ at, label, status: null, source: "track" });

  it("dedupes by time + label and sorts", () => {
    const merged = mergeEvents([e("2026-01-02T00:00:00.000Z", "B")], [e("2026-01-01T00:00:00.000Z", "A"), e("2026-01-02T00:00:00.000Z", "B")]);
    expect(merged.map((x) => x.label)).toEqual(["A", "B"]);
  });

  it("caps the list at 100", () => {
    const many = Array.from({ length: 150 }, (_, i) => e(new Date(1_700_000_000_000 + i * 1000).toISOString(), `E${i}`));
    const merged = mergeEvents([], many);
    expect(merged).toHaveLength(100);
    expect(merged.at(-1)!.label).toBe("E149");
  });

  it("parses Shiprocket times as IST", () => {
    const fb = new Date("2026-01-01T00:00:00Z");
    expect(parseCarrierTime("2023-05-19 11:59:16", fb)).toBe("2023-05-19T06:29:16.000Z");
    expect(parseCarrierTime("23 05 2023 11:43:52", fb)).toBe("2023-05-23T06:13:52.000Z");
    expect(parseCarrierTime("2023-05-19T11:59:16Z", fb)).toBe("2023-05-19T11:59:16.000Z");
    expect(parseCarrierTime("garbage", fb)).toBe(fb.toISOString());
    expect(parseCarrierTime(undefined, fb)).toBe(fb.toISOString());
  });
});
