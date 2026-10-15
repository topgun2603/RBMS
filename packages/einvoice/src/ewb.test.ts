import { describe, expect, it } from "vitest";
import {
  buildCancelEwb,
  buildCancelIrn,
  buildEwbByIrn,
  buildStandaloneEwb,
  ewbValidTill,
  ewbValidityDays,
  isValidVehicleNo,
  normalizeVehicleNo,
  validateEwbInput,
  validateStandaloneEwb,
  withinHours,
  type EwbInput,
} from "./ewb";
import { gstin, invoice, line } from "./test-fixtures";

const TODAY = "2026-10-15";
const TRANSPORTER = gstin("33AAACT4321P1Z");
const errs = (i: EwbInput, docDate = "2026-10-14") =>
  validateEwbInput(i, { today: TODAY, docDate }).issues.filter((x) => x.severity === "error").map((x) => x.code);

describe("vehicle numbers", () => {
  it("accepts regular, Bharat, temporary and defence formats", () => {
    for (const v of ["TN01AB1234", "tn 01 ab 1234", "TN-09-A-1234", "KA051234", "DL1CAB1234", "22BH1234AB", "TR33AB12345", "DF12345A"]) {
      expect(isValidVehicleNo(v), v).toBe(true);
    }
  });
  it("rejects malformed numbers", () => {
    for (const v of ["TN01AB123", "1234TN", "TN01ABCD1234", "AB", "", "TN01AB12345"]) expect(isValidVehicleNo(v), v).toBe(false);
  });
  it("normalises", () => expect(normalizeVehicleNo("tn-01 ab.1234")).toBe("TN01AB1234"));
});

describe("validateEwbInput (Part-B rules)", () => {
  it("road with a vehicle is fine; mode defaults to road when only a vehicle is given", () => {
    expect(errs({ distance: 120, transMode: 1, vehicleNo: "TN01AB1234" })).toEqual([]);
    expect(errs({ distance: 120, vehicleNo: "TN01AB1234" })).toEqual([]);
  });
  it("Part-A only needs a transporter id", () => {
    expect(errs({ distance: 300, transporterId: TRANSPORTER, transporterName: "Fast Movers" })).toEqual([]);
    expect(errs({ distance: 300 })).toEqual(["part_b_required"]);
    expect(errs({ distance: 300, transporterId: "33AAACT4321P1ZZ" })).toContain("transporter_id");
  });
  it("road without vehicle needs a transporter", () => {
    expect(errs({ distance: 10, transMode: 1 })).toEqual(["vehicle_required"]);
    expect(errs({ distance: 10, transMode: 1, transporterId: TRANSPORTER })).toEqual([]);
  });
  it("rail / air / ship need the transport document", () => {
    expect(errs({ distance: 900, transMode: 2 })).toEqual(["trans_doc_required"]);
    expect(errs({ distance: 900, transMode: 3, transDocNo: "AWB1234", transDocDate: "2026-10-15" })).toEqual([]);
    expect(errs({ distance: 900, transMode: 4, transDocNo: "BL-77" })).toContain("trans_doc_date_missing");
    expect(errs({ distance: 900, transMode: 2, transDocDate: "2026-10-15" })).toEqual(expect.arrayContaining(["trans_doc_no_missing", "trans_doc_required"]));
  });
  it("checks the distance range", () => {
    expect(errs({ distance: 4001, vehicleNo: "TN01AB1234" })).toContain("distance");
    expect(errs({ distance: -1, vehicleNo: "TN01AB1234" })).toContain("distance");
    expect(errs({ distance: 12.5, vehicleNo: "TN01AB1234" })).toContain("distance");
    expect(errs({ distance: 0, vehicleNo: "TN01AB1234" })).toEqual([]);
    expect(errs({ distance: 4000, vehicleNo: "TN01AB1234" })).toEqual([]);
  });
  it("checks transport document dates", () => {
    expect(errs({ distance: 5, transMode: 2, transDocNo: "RR1", transDocDate: "2026-10-16" })).toContain("trans_doc_date_future");
    expect(errs({ distance: 5, transMode: 2, transDocNo: "RR1", transDocDate: "2026-10-01" })).toContain("trans_doc_date_before_invoice");
    expect(errs({ distance: 5, transMode: 2, transDocNo: "RR 1", transDocDate: "2026-10-14" })).toContain("trans_doc_no");
  });
  it("vehicle type and ODC rules", () => {
    expect(errs({ distance: 5, vehicleNo: "TN01AB1234", vehicleType: "X" as never })).toContain("vehicle_type");
    expect(errs({ distance: 5, transMode: 3, transDocNo: "A1", transDocDate: "2026-10-14", vehicleType: "O" })).toContain("odc_not_road");
    expect(errs({ distance: 5, vehicleNo: "BAD" })).toContain("vehicle_no");
    expect(errs({ distance: 5, transMode: 7 as never, transporterId: TRANSPORTER })).toContain("trans_mode");
  });
});

describe("buildEwbByIrn", () => {
  it("maps to NIC field names with string mode and DD/MM/YYYY dates", () => {
    expect(
      buildEwbByIrn("abc", {
        distance: 245,
        transMode: 1,
        transporterId: TRANSPORTER.toLowerCase(),
        transporterName: " Fast Movers ",
        transDocNo: "LR-501",
        transDocDate: "2026-10-15",
        vehicleNo: "tn 01 ab 1234",
      }),
    ).toEqual({
      Irn: "abc",
      Distance: 245,
      TransMode: "1",
      TransId: TRANSPORTER,
      TransName: "Fast Movers",
      TransDocNo: "LR-501",
      TransDocDt: "15/10/2026",
      VehNo: "TN01AB1234",
      VehType: "R",
    });
  });
  it("Part-A only leaves Part-B fields out", () => {
    expect(buildEwbByIrn("abc", { distance: 0, transporterId: TRANSPORTER })).toEqual({ Irn: "abc", Distance: 0, TransId: TRANSPORTER });
  });
});

describe("validity", () => {
  it("1 day per 200 km for regular cargo, 20 km for ODC", () => {
    expect(ewbValidityDays(1)).toBe(1);
    expect(ewbValidityDays(200)).toBe(1);
    expect(ewbValidityDays(201)).toBe(2);
    expect(ewbValidityDays(1000)).toBe(5);
    expect(ewbValidityDays(45, "O")).toBe(3);
    expect(ewbValidityDays(0)).toBeNull();
  });
  it("runs to midnight of the following day (IST)", () => {
    const at = new Date("2026-10-15T04:30:00Z"); // 10:00 IST
    expect(ewbValidTill(at, 1).toISOString()).toBe("2026-10-16T18:29:59.000Z");
    const late = new Date("2026-10-15T18:45:00Z"); // 00:15 IST on 16 Oct
    expect(ewbValidTill(late, 2).toISOString()).toBe("2026-10-18T18:29:59.000Z");
  });
  it("withinHours", () => {
    const at = new Date("2026-10-15T00:00:00Z");
    expect(withinHours(at, new Date("2026-10-15T23:59:59Z"))).toBe(true);
    expect(withinHours(at, new Date("2026-10-16T00:00:01Z"))).toBe(false);
  });
});

describe("standalone e-way bill", () => {
  it("builds the NIC e-way bill API payload for an intra-state bill", () => {
    const p = buildStandaloneEwb(invoice(), { distance: 40, vehicleNo: "TN49AB1234" });
    expect(p).toMatchObject({
      supplyType: "O",
      subSupplyType: "1",
      docType: "INV",
      docNo: "INV/26-27/0042",
      docDate: "14/10/2026",
      fromTrdName: "Lakshmi Silks",
      fromPincode: 613001,
      fromStateCode: 33,
      toPincode: 612001,
      toStateCode: 33,
      actToStateCode: 33,
      totalValue: 3075.5,
      cgstValue: 100.53,
      sgstValue: 100.53,
      igstValue: 0,
      otherValue: 0.44,
      totInvValue: 3277,
      transMode: "1",
      transDistance: "40",
      vehicleNo: "TN49AB1234",
      vehicleType: "R",
    });
    expect(p.itemList[1]).toEqual({
      productName: "Silk blouse material",
      productDesc: "Silk blouse material",
      hsnCode: 50072010,
      quantity: 1.5,
      qtyUnit: "MTR",
      cgstRate: 6,
      sgstRate: 6,
      igstRate: 0,
      cessRate: 0,
      cessNonadvol: 0,
      taxableAmount: 675.5,
    });
    expect(validateStandaloneEwb(p).ok).toBe(true);
  });

  it("unregistered buyers are URP with the place of supply as state; services are left out", () => {
    const b = invoice({ inter: true });
    const src = {
      ...b,
      buyer: { ...b.buyer, gstin: null },
      lines: [...b.lines, line("Packing service", "998540", 1, "job", 10_000, 18, true)],
    };
    const p = buildStandaloneEwb(src, { distance: 360, transporterId: TRANSPORTER });
    expect(p.toGstin).toBe("URP");
    expect(p.toStateCode).toBe(29);
    expect(p.itemList).toHaveLength(2);
    expect(p.itemList[0]).toMatchObject({ igstRate: 5, cgstRate: 0 });
    expect(p.igstValue).toBe(201.06);
    expect(p.transMode).toBe("");
  });

  it("validation catches missing pincode and service-only bills", () => {
    const b = invoice();
    const p = buildStandaloneEwb({ ...b, buyer: { ...b.buyer, address: "Gandhi Road", pincode: null } }, { distance: 5, vehicleNo: "TN01AB1234" });
    expect(validateStandaloneEwb(p).issues.map((i) => i.code)).toContain("pincode");
    const s = buildStandaloneEwb(invoice({ lines: [line("Consulting", "998311", 1, "job", 100_000, 18, false)] }), { distance: 5 });
    expect(validateStandaloneEwb(s).issues.map((i) => i.code)).toContain("no_goods");
  });
});

describe("cancel payloads", () => {
  it("IRN cancel uses string reason codes and a default remark", () => {
    expect(buildCancelIrn("irn1", 2)).toEqual({ Irn: "irn1", CnlRsn: "2", CnlRem: "Data entry mistake" });
    expect(buildCancelIrn("irn1", 4, "x".repeat(150)).CnlRem).toHaveLength(100);
  });
  it("EWB cancel uses its own reason table", () => {
    expect(buildCancelEwb("123456789012", 2)).toEqual({ ewbNo: 123456789012, cancelRsnCode: 2, cancelRmrk: "Order cancelled" });
  });
});
