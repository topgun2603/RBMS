import { describe, expect, it, vi } from "vitest";
import { catalogueServicesPort } from "./kit-store";

describe("catalogueServicesPort", () => {
  const rows = [
    { id: "s1", itemId: "v1", durationMin: 45, active: true, onlineBookable: true },
    { id: "s2", itemId: "v2", durationMin: 60, active: true, onlineBookable: false },
    { id: "s3", itemId: "v3", durationMin: 30, active: false, onlineBookable: true },
  ];

  it("links variants to active booking services; online only with bookings.online and an online service", async () => {
    const services = vi.fn(async () => rows);
    const port = catalogueServicesPort(() => services, async () => true);
    expect(await port.forVariants("t", ["v1", "v2", "v3", "v9"])).toEqual([
      { variantId: "v1", serviceId: "s1", durationMin: 45, online: true },
      { variantId: "v2", serviceId: "s2", durationMin: 60, online: false },
    ]);
    const offline = catalogueServicesPort(() => services, async (_t, key) => key !== "bookings.online");
    expect((await offline.forVariants("t", ["v1"]))[0]).toMatchObject({ serviceId: "s1", online: false });
  });

  it("nothing without the bookings feature (and no lookup)", async () => {
    const services = vi.fn(async () => rows);
    const port = catalogueServicesPort(() => services, async () => false);
    expect(await port.forVariants("t", ["v1"])).toEqual([]);
    expect(await port.forVariants("t", [])).toEqual([]);
    expect(services).not.toHaveBeenCalled();
  });
});
