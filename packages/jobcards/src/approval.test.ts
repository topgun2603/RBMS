import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import {
  allowedMoves,
  approvalText,
  canMove,
  canRespondOnline,
  currentApproval,
  joinFields,
  lineSerialsProblem,
  META_KEY,
  moveBlock,
  nextSteps,
  phoneLast4,
  phoneMatches,
  splitFields,
  type JobApproval,
} from "./logic";
import { PublicLimiter } from "./routes";
import { approvalInput, findJobInput, lineInput, linePatch, publicApprovalInput } from "./service";

const approval = (over: Partial<JobApproval> = {}): JobApproval => ({
  decision: "approved",
  by: "Ravi",
  channel: "phone",
  at: "2026-10-22T05:00:00.000Z",
  amount: 180_000,
  note: null,
  recordedBy: null,
  ...over,
});

describe("estimate approval in the flow", () => {
  it("goes into approved only with the customer's approval recorded", () => {
    expect(moveBlock("awaiting_approval", "approved")).toBe("needs_approval");
    expect(moveBlock("awaiting_approval", "approved", { approval: "declined" })).toBe("needs_approval");
    expect(canMove("awaiting_approval", "approved", { approval: "approved" })).toBe(true);
    expect(moveBlock("received", "approved")).toBe("needs_approval");
  });

  it("doesn't skip past a pending approval", () => {
    expect(moveBlock("awaiting_approval", "in_progress")).toBe("needs_approval");
    expect(moveBlock("awaiting_approval", "ready")).toBe("needs_approval");
    expect(canMove("awaiting_approval", "in_progress", { approval: "approved" })).toBe(true);
    // Back to diagnosed (estimate revised) and cancel stay open.
    expect(canMove("awaiting_approval", "diagnosed")).toBe(true);
    expect(canMove("awaiting_approval", "cancelled")).toBe(true);
    expect(nextSteps("awaiting_approval")).toEqual([]);
    expect(allowedMoves("awaiting_approval")).toEqual(["diagnosed", "cancelled"]);
  });

  it("lets jobs that need no approval skip it, and approved jobs go on", () => {
    expect(canMove("received", "in_progress")).toBe(true);
    expect(canMove("diagnosed", "in_progress")).toBe(true);
    expect(nextSteps("diagnosed")).toEqual(["awaiting_approval"]);
    expect(nextSteps("approved", { approval: "approved" })).toEqual(["in_progress"]);
  });

  it("can ask again when extra work turns up mid-repair, and undo a mis-tap only with an approval", () => {
    expect(canMove("in_progress", "awaiting_approval")).toBe(true);
    expect(canMove("approved", "awaiting_approval")).toBe(true);
    expect(moveBlock("in_progress", "approved")).toBe("needs_approval");
    expect(canMove("in_progress", "approved", { approval: "approved" })).toBe(true);
  });
});

describe("approval record", () => {
  it("keeps the service's _meta out of the template fields and puts it back", () => {
    const stored = { brand: "Dell", issue: "No power", [META_KEY]: { approval: approval(), serials: { l1: ["SN1"] } } };
    const { fields, meta } = splitFields(stored);
    expect(fields).toEqual({ brand: "Dell", issue: "No power" });
    expect(meta.serials).toEqual({ l1: ["SN1"] });
    expect(joinFields({ brand: "HP", issue: "Fan" }, meta)).toEqual({ brand: "HP", issue: "Fan", [META_KEY]: { approval: approval(), serials: { l1: ["SN1"] } } });
    // Empty meta (and empty serial lists) are left out; a client-sent _meta is never kept.
    expect(joinFields({ issue: "x", [META_KEY]: { hacked: true } }, { serials: { l1: [] } })).toEqual({ issue: "x" });
    expect(splitFields(null)).toEqual({ fields: {}, meta: {} });
    expect(splitFields({ [META_KEY]: "junk" }).meta).toEqual({});
  });

  it("only counts an answer given after the job was last sent for approval", () => {
    expect(currentApproval({ approval: approval() })).toEqual(approval());
    expect(currentApproval({ approval: approval(), approvalRequestedAt: "2026-10-22T04:00:00.000Z" })).toEqual(approval());
    expect(currentApproval({ approval: approval(), approvalRequestedAt: "2026-10-22T06:00:00.000Z" })).toBeNull();
    expect(currentApproval({})).toBeNull();
  });

  it("lets the customer answer online only while a priced estimate waits", () => {
    expect(canRespondOnline("awaiting_approval", 180_000, null)).toBe(true);
    expect(canRespondOnline("awaiting_approval", 0, null)).toBe(false);
    expect(canRespondOnline("awaiting_approval", 180_000, approval())).toBe(false);
    expect(canRespondOnline("in_progress", 180_000, null)).toBe(false);
  });

  it("writes the timeline line", () => {
    expect(approvalText(approval())).toBe("Approved by Ravi · phone · ₹1,800.00");
    expect(approvalText(approval({ decision: "declined", channel: "in_person", by: "Meena" }))).toBe("Declined by Meena · in person · ₹1,800.00");
  });

  it("validates the staff and customer answers", () => {
    expect(approvalInput.parse({ decision: "approved" })).toMatchObject({ decision: "approved", channel: "in_person", by: null, note: null });
    expect(approvalInput.parse({ decision: "declined", by: " Son ", channel: "whatsapp", at: "2026-10-22T10:00:00+05:30" }).at).toEqual(new Date("2026-10-22T04:30:00Z"));
    // "online" is the tracking page's own channel.
    expect(() => approvalInput.parse({ decision: "approved", channel: "online" })).toThrow(ZodError);
    expect(() => approvalInput.parse({ decision: "maybe" })).toThrow(ZodError);
    expect(publicApprovalInput.parse({ decision: "approve" })).toEqual({ decision: "approve", note: null });
    expect(() => publicApprovalInput.parse({ decision: "approved" })).toThrow(ZodError);
  });
});

describe("track my repair", () => {
  it("matches the last 4 digits of the phone given at intake", () => {
    expect(phoneLast4("+91 98400 12345")).toBe("2345");
    expect(phoneMatches("+91 98400 12345", "2345")).toBe(true);
    expect(phoneMatches("+91 98400 12345", "2346")).toBe(false);
    expect(phoneMatches(null, "2345")).toBe(false);
    expect(phoneMatches("123", "0123")).toBe(false);
  });

  it("validates the lookup", () => {
    expect(findJobInput.parse({ number: " JC-0007 ", phoneLast4: "2345" })).toEqual({ number: "JC-0007", phoneLast4: "2345" });
    expect(() => findJobInput.parse({ number: "JC-0007", phoneLast4: "234" })).toThrow(ZodError);
    expect(() => findJobInput.parse({ number: "", phoneLast4: "2345" })).toThrow(ZodError);
  });

  it("rate-limits per key", () => {
    let now = 0;
    const l = new PublicLimiter(2, 60_000, () => now);
    expect([l.hit("t:ip"), l.hit("t:ip"), l.hit("t:ip"), l.hit("t:other")]).toEqual([true, true, false, true]);
    now = 60_001;
    expect(l.hit("t:ip")).toBe(true);
  });
});

describe("serial numbers on part lines", () => {
  it("normalises serials and keeps them optional", () => {
    const l = lineInput.parse({ description: "Samsung 980 SSD", itemId: "11111111-1111-4111-8111-111111111111", qty: 1, rate: 450_000, serials: [" s4ev nj0 123 "] });
    expect(l.serials).toEqual(["S4EVNJ0123"]);
    expect(lineInput.parse({ description: "Labour", kind: "labour", qty: 1, rate: 50_000 }).serials).toBeUndefined();
    expect(() => lineInput.parse({ description: "SSD", qty: 1, rate: 1, serials: ["a b"] })).toThrow(ZodError); // "AB": too short
    expect(linePatch.parse({ serials: [] })).toEqual({ serials: [] });
  });

  it("allows serials only on stock parts, one per unit, not twice on the job", () => {
    const part = { kind: "part" as const, itemId: "i1", qty: 2, serials: ["SN1", "SN2"] };
    expect(lineSerialsProblem(part)).toBeNull();
    expect(lineSerialsProblem({ ...part, serials: [] })).toBeNull();
    expect(lineSerialsProblem({ ...part, kind: "labour" })).toMatch(/parts picked from stock/);
    expect(lineSerialsProblem({ ...part, itemId: null })).toMatch(/parts picked from stock/);
    expect(lineSerialsProblem({ ...part, serials: ["SN1", "SN1"] })).toMatch(/twice/);
    expect(lineSerialsProblem({ ...part, qty: 1 })).toMatch(/More serial numbers/);
    expect(lineSerialsProblem(part, ["SN2"])).toMatch(/SN2 is already on another line/);
  });
});
