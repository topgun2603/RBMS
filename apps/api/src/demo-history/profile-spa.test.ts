import { describe, expect, it } from "vitest";
import { getProfile, profileForBusinessType } from "./profiles";
import { hookFor } from "./hooks";
import { THERAPIES } from "../demo-stores/spa-products";

describe("spa profile (Sukham Ayur Spa)", () => {
  const p = getProfile("spa");

  it("is the profile of the spa trade and uses the bookings hook", () => {
    expect(profileForBusinessType("spa")?.id).toBe("spa");
    expect(profileForBusinessType("salon")?.id).toBe("services");
    expect(p.hook).toBe("bookings");
    expect(hookFor(p.hook).id).toBe("bookings");
  });

  it("sells every therapy duration of the store at its price, 5% GST, nothing on credit", () => {
    const names = p.catalogue.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    expect(p.catalogue).toHaveLength(THERAPIES.reduce((n, t) => n + t.rows.length, 0));
    for (const c of p.catalogue) expect(c.gstRate).toBe(5);
    const swedish = p.catalogue.find((c) => c.name === "Swedish relaxation massage – 60 min")!;
    expect(Math.round(swedish.rate * 1.05)).toBe(180000);
    expect(p.customers.creditShare).toBe(0);
  });
});
