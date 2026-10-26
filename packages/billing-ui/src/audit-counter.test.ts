import { describe, expect, it } from "vitest";
import { counterLabel } from "./lib/audit-counter";
import { en, ta } from "./lib/messages/stock-depth";

const labels = { owner: "Owner", member: "Team member" };
const me = { id: "0a1b2c3d-1111-4111-8111-111111111111", name: null, email: "gowtham@x.in" };

describe("counterLabel", () => {
  it("never shows the raw user-<id>", () => {
    expect(counterLabel("user-0a1b2c3d", me, labels)).toBe("gowtham@x.in");
    expect(counterLabel("user-0a1b2c3d", { ...me, name: "Gowtham" }, labels)).toBe("Gowtham");
    expect(counterLabel("user-0a1b2c3d", { id: me.id }, labels)).toBe("Owner");
    expect(counterLabel("user-ffffffff", me, labels)).toBe("Team member");
  });
  it("keeps names people typed", () => {
    expect(counterLabel("Ravi", me, labels)).toBe("Ravi");
    expect(counterLabel("counter", me, labels)).toBe("counter");
  });
  it("has the labels in English and Tamil", () => {
    for (const k of ["billing.audit.counterOwner", "billing.audit.counterMember"]) {
      expect(en[k]).toBeTruthy();
      expect(ta[k]).toBeTruthy();
    }
  });
});
