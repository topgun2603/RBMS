import { describe, expect, it } from "vitest";
import { gstinCheckChar } from "@srirealtime/gst";
import {
  cancelWindow,
  decodeSignedQr,
  defaultGstr1Period,
  einvoiceTimeline,
  emptyEwbForm,
  ewbRequestBody,
  gstr1Periods,
  isValidTransporterId,
  isValidVehicleNo,
  normalizeVehicleNo,
  splitDuration,
  splitIssues,
  truncateMiddle,
  validateEwbForm,
  type EInvoiceRecord,
  type EwbForm,
} from "./einvoice";
import { billingMessages } from "./messages";
import { en as growthEn, ta as growthTa } from "./messages/growth";

const b64url = (o: unknown) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o), "utf8").toString("base64url");

const QR = {
  SellerGstin: "33AABFR1234K1ZI",
  BuyerGstin: "29AAGCK4821M1Z4",
  DocNo: "EB/26-27/0143",
  DocTyp: "INV",
  DocDt: "16/10/2026",
  TotInvVal: 2678,
  ItemCnt: 1,
  MainHsnCode: "5208",
  Irn: "43289e198a4e435b619ef75b15b6e827d489f03099a16f2741e40a17036180d0",
  IrnDt: "2026-10-16 00:27:07",
};

describe("decodeSignedQr", () => {
  it("reads the test provider's plain base64url JSON (as served by the API)", () => {
    const live =
      "eyJTZWxsZXJHc3RpbiI6IjMzQUFCRlIxMjM0SzFaSSIsIkJ1eWVyR3N0aW4iOiIyOUFBR0NLNDgyMU0xWjQiLCJEb2NObyI6IkVCLzI2LTI3LzAxNDMiLCJEb2NUeXAiOiJJTlYiLCJEb2NEdCI6IjE2LzEwLzIwMjYiLCJUb3RJbnZWYWwiOjI2NzgsIkl0ZW1DbnQiOjEsIk1haW5Ic25Db2RlIjoiNTIwOCIsIklybiI6IjQzMjg5ZTE5OGE0ZTQzNWI2MTllZjc1YjE1YjZlODI3ZDQ4OWYwMzA5OWExNmYyNzQxZTQwYTE3MDM2MTgwZDAiLCJJcm5EdCI6IjIwMjYtMTAtMTYgMDA6Mjc6MDciLCJtb2NrIjp0cnVlfQ";
    expect(decodeSignedQr(live)).toEqual({ ...QR, mock: true });
  });

  it("reads a NIC JWT whose data is a JSON string", () => {
    const jwt = `${b64url({ alg: "RS256" })}.${b64url({ data: JSON.stringify(QR), iss: "NIC" })}.c2ln`;
    expect(decodeSignedQr(jwt)).toEqual(QR);
  });

  it("reads a JWT whose data is an object, and non-ASCII text", () => {
    const jwt = `h.${b64url({ data: { ...QR, DocNo: "பில்/1" } })}.s`;
    expect(decodeSignedQr(jwt)?.DocNo).toBe("பில்/1");
  });

  it("returns null for junk", () => {
    expect(decodeSignedQr(null)).toBeNull();
    expect(decodeSignedQr("")).toBeNull();
    expect(decodeSignedQr("not base64 !!")).toBeNull();
    expect(decodeSignedQr(b64url({ hello: 1 }))).toBeNull();
  });

  it("truncates long ids in the middle", () => {
    expect(truncateMiddle(QR.Irn)).toBe("43289e198a…036180d0");
    expect(truncateMiddle("short")).toBe("short");
  });
});

describe("vehicle and transporter ids", () => {
  it("normalises and checks vehicle numbers like the server", () => {
    expect(normalizeVehicleNo("tn 01 ab-1234")).toBe("TN01AB1234");
    for (const v of ["TN01AB1234", "tn-01-a-1234", "TN011234", "DL1CAB1234", "22BH1234AB", "TR12AB34CD", "DF12345A"]) expect(isValidVehicleNo(v), v).toBe(true);
    for (const v of ["", "1234", "TN01ABCD1234", "XX", null, undefined]) expect(isValidVehicleNo(v as string), String(v)).toBe(false);
  });

  it("checks transporter GSTIN / TRANSIN with the mod-36 check character", () => {
    expect(isValidTransporterId("33AABFR1234K1ZI")).toBe(true);
    expect(isValidTransporterId("33aabfr1234k1zi")).toBe(true);
    const transin = `29ABCDE12345F6${gstinCheckChar("29ABCDE12345F6")}`;
    expect(isValidTransporterId(transin)).toBe(true);
    expect(isValidTransporterId("33AABFR1234K1ZX")).toBe(false);
    expect(isValidTransporterId("33AABFR1234K1Z")).toBe(false);
    expect(isValidTransporterId(null)).toBe(false);
  });
});

describe("validateEwbForm", () => {
  const today = "2026-10-16";
  const form = (p: Partial<EwbForm>): EwbForm => ({ ...emptyEwbForm(), ...p });

  it("needs a vehicle number for road unless a transporter id is given", () => {
    expect(validateEwbForm(form({}), { today })).toEqual({ vehicleNo: "vehicleRequired" });
    expect(validateEwbForm(form({ vehicleNo: "TN01AB1234" }), { today })).toEqual({});
    expect(validateEwbForm(form({ transporterId: "33AABFR1234K1ZI" }), { today })).toEqual({});
    expect(validateEwbForm(form({ vehicleNo: "ABC" }), { today })).toEqual({ vehicleNo: "vehicleNo" });
  });

  it("needs the transport document for rail / air / ship", () => {
    expect(validateEwbForm(form({ transMode: 2 }), { today })).toEqual({ transDocNo: "transDocRequired" });
    expect(validateEwbForm(form({ transMode: 3, transDocNo: "AWB-1", transDocDate: "2026-10-15" }), { today })).toEqual({});
    expect(validateEwbForm(form({ transMode: 4, transDocNo: "BL 1", transDocDate: "2026-10-15" }), { today })).toEqual({ transDocNo: "transDocNo" });
  });

  it("checks distance, names and dates", () => {
    const ok = { vehicleNo: "TN01AB1234" };
    expect(validateEwbForm(form({ ...ok, distance: "4001" }), { today }).distance).toBe("distance");
    expect(validateEwbForm(form({ ...ok, distance: "12.5" }), { today }).distance).toBe("distance");
    expect(validateEwbForm(form({ ...ok, distance: "" }), { today }).distance).toBe("distance");
    expect(validateEwbForm(form({ ...ok, distance: "4000" }), { today })).toEqual({});
    expect(validateEwbForm(form({ ...ok, transporterName: "AB" }), { today })).toEqual({ transporterName: "transporterName" });
    expect(validateEwbForm(form({ ...ok, transporterId: "33AABFR1234K1ZX" }), { today })).toEqual({ transporterId: "transporterId" });
    expect(validateEwbForm(form({ ...ok, transDocNo: "LR1" }), { today })).toEqual({ transDocDate: "transDocDateMissing" });
    expect(validateEwbForm(form({ ...ok, transDocDate: "2026-10-10" }), { today })).toEqual({ transDocNo: "transDocNoMissing" });
    expect(validateEwbForm(form({ ...ok, transDocNo: "LR1", transDocDate: "2026-10-17" }), { today })).toEqual({ transDocDate: "transDocDateFuture" });
    expect(validateEwbForm(form({ ...ok, transDocNo: "LR1", transDocDate: "2026-10-01" }), { today, docDate: "2026-10-05" })).toEqual({
      transDocDate: "transDocDateBeforeBill",
    });
  });

  it("builds the request body (vehicle only for road; standalone flag)", () => {
    expect(ewbRequestBody(form({ distance: "120", vehicleNo: "tn 01 ab 1234", vehicleType: "O", transporterId: " 33aabfr1234k1zi " }), true)).toEqual({
      distance: 120,
      transMode: 1,
      transporterId: "33AABFR1234K1ZI",
      transporterName: undefined,
      transDocNo: undefined,
      transDocDate: undefined,
      vehicleNo: "TN01AB1234",
      vehicleType: "O",
      standalone: true,
    });
    const rail = ewbRequestBody(form({ transMode: 2, vehicleNo: "TN01AB1234", transDocNo: "RR1", transDocDate: "2026-10-15" }), false);
    expect(rail.vehicleNo).toBeUndefined();
    expect(rail.vehicleType).toBeUndefined();
    expect("standalone" in rail).toBe(false);
  });
});

describe("cancel window and periods", () => {
  it("is open until cancellableUntil", () => {
    const now = new Date("2026-10-16T10:00:00Z");
    expect(cancelWindow("2026-10-16T18:57:07.000Z", now)).toMatchObject({ open: true, msLeft: 8 * 3600_000 + 57 * 60_000 + 7000 });
    expect(cancelWindow("2026-10-16T09:59:59Z", now)).toMatchObject({ open: false, msLeft: 0 });
    expect(cancelWindow(null, now)).toEqual({ open: false, msLeft: 0, until: null });
    expect(cancelWindow("nope", now).open).toBe(false);
    expect(splitDuration(8 * 3600_000 + 57 * 60_000 + 7000)).toEqual({ hours: 8, minutes: 58 });
    expect(splitDuration(0)).toEqual({ hours: 0, minutes: 0 });
  });

  it("lists MMYYYY months newest first in IST, default last month", () => {
    // 31 Dec 2026 20:00 UTC is 1 Jan 2027 in IST.
    const now = new Date("2026-12-31T20:00:00Z");
    const list = gstr1Periods(now, 14);
    expect(list[0]).toEqual({ value: "012027", year: 2027, month: 1 });
    expect(list[1]!.value).toBe("122026");
    expect(list).toHaveLength(14);
    expect(list[13]!.value).toBe("122025");
    expect(defaultGstr1Period(now)).toBe("122026");
    expect(defaultGstr1Period(new Date("2026-10-16T05:00:00Z"))).toBe("092026");
    expect(gstr1Periods(new Date("2017-08-10T00:00:00Z"), 18).map((p) => p.value)).toEqual(["082017", "072017"]);
  });
});

describe("timeline", () => {
  const base: EInvoiceRecord = {
    id: "r1",
    invoiceId: "i1",
    provider: "mock",
    mock: true,
    docType: "INV",
    docNo: "A/1",
    docDate: "2026-10-16",
    status: "generated",
    irn: "x".repeat(64),
    ackNo: "1",
    ackDate: "2026-10-15T10:00:00Z",
    signedQrCode: null,
    qr: null,
    cancellableUntil: null,
    cancelledAt: null,
    cancelReason: null,
    cancelRemark: null,
    error: null,
    ewbNo: null,
    ewbDate: null,
    ewbValidTill: null,
    ewbStatus: null,
    ewbCancelledAt: null,
    createdAt: "2026-10-15T10:00:00Z",
  };

  it("lists generated / failed / cancelled / e-way bill events newest first", () => {
    const events = einvoiceTimeline([
      { ...base, id: "r2", status: "cancelled", ackDate: "2026-10-15T11:00:00Z", cancelledAt: "2026-10-15T12:00:00Z", cancelReason: "2", cancelRemark: "typo", ewbNo: "111", ewbDate: "2026-10-15T11:30:00Z", ewbStatus: "cancelled", ewbCancelledAt: "2026-10-15T11:45:00Z" },
      { ...base, id: "r1", status: "failed", irn: null, error: { kind: "validation", code: "2150", message: "Duplicate IRN" }, createdAt: "2026-10-15T09:00:00Z" },
      { ...base, id: "r3", status: "ewb_only", irn: null, ewbNo: "222", ewbDate: "2026-10-16T08:00:00Z", ewbStatus: "active" },
    ]);
    expect(events.map((e) => e.kind)).toEqual(["ewbGenerated", "cancelled", "ewbCancelled", "ewbGenerated", "generated", "failed"]);
    expect(events[1]).toMatchObject({ reason: 2, remark: "typo" });
    expect(events[5]!.detail).toBe("Duplicate IRN");
  });

  it("splits preview issues", () => {
    const r = splitIssues([
      { path: "a", code: "x", message: "m", severity: "error" },
      { path: "b", code: "y", message: "n", severity: "warning" },
    ]);
    expect(r.errors.map((i) => i.code)).toEqual(["x"]);
    expect(r.warnings.map((i) => i.code)).toEqual(["y"]);
    expect(splitIssues(undefined)).toEqual({ errors: [], warnings: [] });
  });
});

describe("growth messages", () => {
  it("has identical English and Tamil keys and is merged into the bundle", () => {
    expect(Object.keys(growthTa).sort()).toEqual(Object.keys(growthEn).sort());
    for (const k of Object.keys(growthEn)) expect(billingMessages.en[k], k).toBe(growthEn[k]);
  });

  it("writes Tamil in Tamil script", () => {
    const latin = Object.keys(growthEn).filter((k) => !/[஀-௿]/.test(growthTa[k]!) && !/^[A-Z0-9 ()%/.{}+·#:,–-]+$/i.test(growthTa[k]!));
    expect(latin).toEqual([]);
  });

  it("avoids Hindi / Urdu terms in Tamil", () => {
    const banned = /khata|udhaar|udhar|hisaab|hisab|bahi|rokad|कर|खाता/i;
    expect(Object.entries(growthTa).filter(([, v]) => banned.test(v)).map(([k]) => k)).toEqual([]);
  });
});
