import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
vi.mock("./api", () => ({ posApi: { get: (...a: unknown[]) => get(...a) } }));

const { fetchBatchPick } = await import("./batches");

const pick = (tracked: boolean, id: string) => ({ itemId: "i1", tracked, rule: "fefo", expiredPolicy: "block", batches: [], suggestion: [], short: 0, id });

describe("fetchBatchPick (pharmacy counter)", () => {
  beforeEach(() => get.mockReset());

  it("uses the generic batches when the item has them", async () => {
    get.mockResolvedValueOnce(pick(true, "generic"));
    expect(await fetchBatchPick("i1", 2, true)).toMatchObject({ id: "generic" });
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("falls back to the medicine batches for an item Pharmacy manages", async () => {
    get.mockResolvedValueOnce(pick(false, "generic")).mockResolvedValueOnce(pick(true, "medicine"));
    expect(await fetchBatchPick("i1", 2, true)).toMatchObject({ id: "medicine" });
    expect(get).toHaveBeenLastCalledWith("/medicines/batches/pick", { itemId: "i1", qty: 2 });
  });

  it("never calls the medicine route when the shop has no pharmacy", async () => {
    get.mockResolvedValueOnce(pick(false, "generic"));
    expect(await fetchBatchPick("i1", 2)).toMatchObject({ id: "generic" });
    expect(get).toHaveBeenCalledTimes(1);
  });
});
