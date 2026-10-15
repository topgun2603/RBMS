import { describe, expect, it } from "vitest";
import { aggregateSubject, latestByType, referenceName, type CheckFacts } from "./aggregate";

const t = (min: number) => new Date(Date.UTC(2026, 9, 15, 6, min));
const c = (over: Partial<CheckFacts> & Pick<CheckFacts, "type" | "status">, min = 0): CheckFacts => ({ createdAt: t(min), ...over });

const pan = (status: CheckFacts["status"] = "verified", name = "GOWTHAM KUMAR S", min = 0) => c({ type: "pan", status, nameOnRecord: name }, min);
const bank = (over: Partial<CheckFacts> = {}, min = 1) => c({ type: "bank_account", status: "verified", nameOnRecord: "S GOWTHAM KUMAR", ...over }, min);

describe("vendor rules", () => {
  it("PAN + bank with a matching name → verified", () => {
    const s = aggregateSubject("vendor", [pan(), bank()]);
    expect(s).toEqual({ status: "verified", verified: true, verifiedName: "GOWTHAM KUMAR S", badges: ["pan", "bank", "verified"], missing: [] });
  });

  it("UPI can stand in for the bank account", () => {
    const s = aggregateSubject("vendor", [pan(), c({ type: "upi", status: "verified", nameOnRecord: "GOWTHAM KUMAR" }, 2)]);
    expect(s.verified).toBe(true);
    expect(s.badges).toEqual(["pan", "upi", "verified"]);
  });

  it("name match is recomputed against the PAN name, whatever order the checks ran in", () => {
    const early = bank({ nameOnRecord: "SOMEONE ELSE", nameMatchScore: 100 }, 0); // stored score vs a typed name
    const s = aggregateSubject("vendor", [early, pan("verified", "GOWTHAM KUMAR S", 5)]);
    expect(s.verified).toBe(false);
    expect(s.status).toBe("pending");
    expect(s.missing).toEqual(["Bank or UPI name matching the PAN (80%+)"]);
  });

  it("a reviewer's approval overrides a low name match", () => {
    const s = aggregateSubject("vendor", [pan(), bank({ nameOnRecord: "SOMEONE ELSE", approved: true })]);
    expect(s.verified).toBe(true);
  });

  it("threshold is configurable", () => {
    const facts = [pan("verified", "GOWTHAM KUMAR"), bank({ nameOnRecord: "GOWTHAM" })]; // 67
    expect(aggregateSubject("vendor", facts).verified).toBe(false);
    expect(aggregateSubject("vendor", facts, { nameMatchThreshold: 60 }).verified).toBe(true);
  });

  it("without names the stored score decides", () => {
    expect(aggregateSubject("vendor", [pan("verified", ""), bank({ nameOnRecord: null, nameMatchScore: 85 })]).verified).toBe(true);
    expect(aggregateSubject("vendor", [pan("verified", ""), bank({ nameOnRecord: null, nameMatchScore: null })]).verified).toBe(false);
  });

  it("PAN alone is pending with what is missing", () => {
    const s = aggregateSubject("vendor", [pan()]);
    expect(s).toMatchObject({ status: "pending", verified: false, badges: ["pan"], missing: ["Bank account or UPI ID"] });
  });

  it("bank alone lists PAN as missing", () => {
    expect(aggregateSubject("vendor", [bank()]).missing).toEqual(["PAN"]);
  });

  it("only the newest check of a type counts", () => {
    const s = aggregateSubject("vendor", [pan("failed", "", 0), pan("verified", "GOWTHAM KUMAR S", 3), bank({}, 4)]);
    expect(s.verified).toBe(true);
    const later = aggregateSubject("vendor", [pan(), bank({}, 1), bank({ status: "failed" }, 9)]);
    expect(later).toMatchObject({ verified: false, status: "failed" });
  });
});

describe("status precedence when not verified", () => {
  it("manual_review > pending > failed > partially verified > none", () => {
    expect(aggregateSubject("vendor", []).status).toBe("none");
    expect(aggregateSubject("vendor", [pan("failed")]).status).toBe("failed");
    expect(aggregateSubject("vendor", [pan("failed"), c({ type: "upi", status: "pending" })]).status).toBe("pending");
    expect(aggregateSubject("vendor", [pan("pending"), bank({ status: "manual_review" })]).status).toBe("manual_review");
    expect(aggregateSubject("vendor", [pan()]).status).toBe("pending");
  });
});

describe("shop and user rules", () => {
  it("shop: GSTIN or PAN", () => {
    expect(aggregateSubject("shop", [c({ type: "gstin", status: "verified", nameOnRecord: "RAJA STORES" })])).toMatchObject({
      verified: true,
      verifiedName: "RAJA STORES",
      badges: ["gstin", "verified"],
    });
    expect(aggregateSubject("shop", [pan()]).verified).toBe(true);
    expect(aggregateSubject("shop", [bank()])).toMatchObject({ verified: false, missing: ["GSTIN or PAN"], status: "pending" });
  });

  it("user: PAN or DigiLocker", () => {
    expect(aggregateSubject("user", [c({ type: "digilocker_aadhaar", status: "verified", nameOnRecord: "PRIYA" })])).toMatchObject({
      verified: true,
      verifiedName: "PRIYA",
      badges: ["aadhaar", "verified"],
    });
    expect(aggregateSubject("user", [c({ type: "selfie", status: "verified" })])).toMatchObject({ verified: false, badges: ["selfie"] });
  });

  it("verified name prefers PAN over GSTIN over others", () => {
    const s = aggregateSubject("shop", [c({ type: "gstin", status: "verified", nameOnRecord: "LEGAL" }), pan("verified", "PAN NAME")]);
    expect(s.verifiedName).toBe("PAN NAME");
  });
});

describe("helpers", () => {
  it("latestByType keeps the newest; ties go to the later entry", () => {
    const a = pan("failed", "A", 1);
    const b = pan("verified", "B", 1);
    expect(latestByType([a, b]).get("pan")).toBe(b);
  });
  it("referenceName: verified PAN name, else the expected name", () => {
    expect(referenceName([pan()], "Typed Name")).toBe("GOWTHAM KUMAR S");
    expect(referenceName([pan("failed")], " Typed Name ")).toBe("Typed Name");
    expect(referenceName([], "  ")).toBeNull();
  });
});
