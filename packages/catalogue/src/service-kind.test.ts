import { describe, expect, it, vi } from "vitest";
import { dietOf, itemKind } from "./logic";
import { CatalogueService, type BookableServicesPort } from "./service";

describe("itemKind", () => {
  it("tells services from goods by unit, SAC code or tag", () => {
    expect(itemKind({ unit: "pcs", hsn: "3304", tags: [] })).toBe("product");
    expect(itemKind({ unit: "service", hsn: null, tags: [] })).toBe("service");
    expect(itemKind({ unit: "Session", hsn: null })).toBe("service");
    expect(itemKind({ unit: "job" })).toBe("service");
    // GST SAC codes (services) start with 99; HSN goods codes never do.
    expect(itemKind({ unit: "pcs", hsn: "9987" })).toBe("service");
    expect(itemKind({ unit: "pcs", hsn: "999721" })).toBe("service");
    expect(itemKind({ unit: "pcs", hsn: "8471" })).toBe("product");
    expect(itemKind({ unit: "pcs", tags: ["Service", "repair"] })).toBe("service");
    expect(itemKind({ unit: "kg", tags: ["servicing-kit"] })).toBe("product");
  });
});

describe("food is sold, not booked", () => {
  it("restaurant food and drink (SAC 99633x) is a product that goes in the cart", () => {
    expect(itemKind({ unit: "plate", hsn: "996331", tags: ["veg"] })).toBe("product");
    expect(itemKind({ unit: "cup", hsn: "996332" })).toBe("product");
    expect(itemKind({ unit: "pcs", hsn: "9963 31" })).toBe("product");
    // other 9963 services (rooms) and a service tag or unit still read as services
    expect(itemKind({ unit: "night", hsn: "996311" })).toBe("service");
    expect(itemKind({ unit: "plate", hsn: "996331", tags: ["service"] })).toBe("service");
  });
  it("reads the veg mark from tags", () => {
    expect(dietOf(["tiffin", "Veg"])).toBe("veg");
    expect(dietOf(["non-veg", "veg"])).toBe("non-veg");
    expect(dietOf(["Non Veg"])).toBe("non-veg");
    expect(dietOf(["egg", "bakery"])).toBe("egg");
    expect(dietOf(["bestseller"])).toBeNull();
    expect(dietOf(null)).toBeNull();
  });
});

describe("CatalogueService.withServices", () => {
  const svc = (services?: BookableServicesPort) => new CatalogueService({ db: {} as never, services });

  it("marks items linked to a bookable service, preferring an online link", async () => {
    const port: BookableServicesPort = {
      forVariants: vi.fn(async () => [
        { variantId: "v2", serviceId: "s-offline", durationMin: 30, online: false },
        { variantId: "v3", serviceId: "s-online", durationMin: 45, online: true },
      ]),
    };
    const out = await svc(port).withServices("t", [
      { id: "a", kind: "product" as const, variantIds: ["v1"] },
      { id: "b", kind: "product" as const, variantIds: ["v2", "v3"] },
      { id: "c", kind: "service" as const, variantIds: ["v4"] },
    ]);
    expect(port.forVariants).toHaveBeenCalledWith("t", ["v1", "v2", "v3", "v4"]);
    expect(out[0]).toEqual({ id: "a", kind: "product", variantIds: ["v1"] });
    expect(out[1]).toMatchObject({ kind: "service", service: { serviceId: "s-online", durationMin: 45, bookable: true } });
    // A service item (unit / SAC) not linked to bookings: enquire only.
    expect(out[2]).toMatchObject({ kind: "service", service: { serviceId: null, durationMin: null, bookable: false } });
  });

  it("consultation-only (not online-bookable) services are not bookable", async () => {
    const port: BookableServicesPort = { forVariants: async () => [{ variantId: "v1", serviceId: "s1", durationMin: 60, online: false }] };
    const [x] = await svc(port).withServices("t", [{ id: "a", kind: "product" as const, variantIds: ["v1"] }]);
    expect(x).toMatchObject({ kind: "service", service: { serviceId: "s1", durationMin: 60, bookable: false } });
  });

  it("works without the port and survives a failing one", async () => {
    const items = [{ id: "a", kind: "product" as const, variantIds: ["v1"] }];
    expect(await svc().withServices("t", items)).toEqual(items);
    const broken: BookableServicesPort = { forVariants: async () => Promise.reject(new Error("down")) };
    expect(await svc(broken).withServices("t", items)).toEqual(items);
  });
});
