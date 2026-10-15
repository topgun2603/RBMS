import type { Db } from "@srirealtime/db";
import { describe, expect, it, vi } from "vitest";
import {
  CUSTOM_DOMAIN_FEATURE,
  DEFAULT_CNAME_TARGET,
  domainInstructions,
  isApexDomain,
  newVerificationToken,
  shouldForceVerify,
  TENANCY_FEATURES,
  type DomainVerifier,
} from "./domains";
import type { TenantDomain } from "./schema";
import { TenancyService } from "./service";

describe("domain helpers", () => {
  it("only super-admins force verification: on request, or when there is no DNS verifier", () => {
    expect(shouldForceVerify({ superAdmin: true, requested: true, canSelfVerify: true })).toBe(true);
    expect(shouldForceVerify({ superAdmin: true, requested: undefined, canSelfVerify: true })).toBe(false);
    expect(shouldForceVerify({ superAdmin: true, requested: undefined, canSelfVerify: false })).toBe(true);
    expect(shouldForceVerify({ superAdmin: false, requested: true, canSelfVerify: true })).toBe(false);
    expect(shouldForceVerify({ superAdmin: false, requested: true, canSelfVerify: false })).toBe(false);
  });

  it("makes distinct TXT-safe tokens", () => {
    const a = newVerificationToken();
    expect(a).toMatch(/^srikit-verify-[A-Za-z0-9_-]{20,}$/);
    expect(newVerificationToken()).not.toBe(a);
  });

  it("builds TXT + CNAME instructions with status", () => {
    const i = domainInstructions({ domain: "shop.rajastores.in", verificationToken: "tok", verified: false }, "stores.example.in");
    expect(i).toEqual({
      domain: "shop.rajastores.in",
      records: [
        { type: "TXT", host: "_srikit-verify.shop.rajastores.in", value: "tok" },
        { type: "CNAME", host: "shop.rajastores.in", value: "stores.example.in" },
      ],
      status: "pending",
    });
    const v = domainInstructions({ domain: "shop.rajastores.in", verificationToken: "tok", verified: true });
    expect(v.status).toBe("verified");
    expect(v.records[1]!.value).toBe(DEFAULT_CNAME_TARGET);
  });

  it("notes that root domains need ALIAS/flattening", () => {
    expect(isApexDomain("rajastores.in")).toBe(true);
    expect(isApexDomain("rajastores.co.in")).toBe(true);
    expect(isApexDomain("shop.rajastores.in")).toBe(false);
    expect(isApexDomain("www.rajastores.co.in")).toBe(false);
    const i = domainInstructions({ domain: "rajastores.in", verificationToken: "t", verified: false });
    expect(i.records[1]!.note).toMatch(/www\.rajastores\.in/);
  });

  it("declares the custom-domain feature", () => {
    expect(TENANCY_FEATURES).toEqual([expect.objectContaining({ key: CUSTOM_DOMAIN_FEATURE, module: "tenancy" })]);
  });
});

/** In-memory stand-in for the tenant_domains queries, holding one domain row (where clauses are not evaluated). */
function fakeDb(initial: Partial<TenantDomain>) {
  let row: TenantDomain = {
    id: "d1",
    tenantId: "t1",
    domain: "shop.rajastores.in",
    verified: false,
    verificationToken: null,
    verifiedAt: null,
    checkedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...initial,
  };
  const rows = async () => [row];
  const chain = { limit: rows, orderBy: () => ({ limit: rows }) };
  const db = {
    select: () => ({ from: () => ({ where: () => chain }) }),
    update: () => ({
      set: (set: Partial<TenantDomain>) => ({
        where: () => ({
          returning: async () => {
            row = { ...row, ...set };
            return [row];
          },
        }),
      }),
    }),
  };
  return { db: db as unknown as Db, row: () => row };
}

const service = (db: Db, domainVerifier?: DomainVerifier) => new TenancyService({ db, rootDomain: "srikit.in", domainVerifier });

describe("domain verification", () => {
  it("gives old rows a token lazily when instructions are read", async () => {
    const f = fakeDb({ verificationToken: null });
    const i = await service(f.db).domainInstructions("t1", "d1");
    expect(f.row().verificationToken).toMatch(/^srikit-verify-/);
    expect(i.records[0]).toEqual({ type: "TXT", host: "_srikit-verify.shop.rajastores.in", value: f.row().verificationToken });
    expect(i.status).toBe("pending");
  });

  it("verifies when the TXT record matches the token (CNAME is guidance only)", async () => {
    const f = fakeDb({ verificationToken: "tok" });
    const verifier = vi.fn<DomainVerifier>(async () => ({ txt: true, cname: false }));
    const d = await service(f.db, verifier).verifyDomain("t1", "d1");
    expect(verifier).toHaveBeenCalledWith("shop.rajastores.in", { token: "tok" });
    expect(d.verified).toBe(true);
    expect(f.row().verifiedAt).toBeInstanceOf(Date);
    expect(f.row().checkedAt).toBeInstanceOf(Date);
  });

  it("refuses with { txt, cname } when the TXT record is missing; lookup errors count as missing", async () => {
    const f = fakeDb({ verificationToken: "tok" });
    await expect(service(f.db, async () => ({ txt: false, cname: true })).verifyDomain("t1", "d1")).rejects.toMatchObject({
      status: 400,
      details: { txt: false, cname: true },
    });
    expect(f.row().verified).toBe(false);
    expect(f.row().checkedAt).toBeInstanceOf(Date);
    await expect(
      service(f.db, async () => Promise.reject(new Error("ENOTFOUND"))).verifyDomain("t1", "d1"),
    ).rejects.toMatchObject({ status: 400, details: { txt: false, cname: false } });
  });

  it("needs a verifier unless forced (super-admin)", async () => {
    const f = fakeDb({ verificationToken: "tok" });
    await expect(service(f.db).verifyDomain("t1", "d1")).rejects.toMatchObject({ status: 403 });
    const d = await service(f.db).verifyDomain("t1", "d1", { force: true });
    expect(d.verified).toBe(true);
  });

  it("verifyPending checks pending domains and is a no-op without a verifier", async () => {
    expect(await service(fakeDb({}).db).verifyPending()).toEqual({ checked: 0, verified: 0 });
    const f = fakeDb({ verificationToken: null });
    const verifier = vi.fn<DomainVerifier>(async (_d, { token }) => ({ txt: token.startsWith("srikit-verify-"), cname: true }));
    expect(await service(f.db, verifier).verifyPending()).toEqual({ checked: 1, verified: 1 });
    expect(f.row().verified).toBe(true);
    const g = fakeDb({ verificationToken: "tok" });
    expect(await service(g.db, async () => ({ txt: false, cname: false })).verifyPending()).toEqual({ checked: 1, verified: 0 });
    expect(g.row().verified).toBe(false);
  });
});
