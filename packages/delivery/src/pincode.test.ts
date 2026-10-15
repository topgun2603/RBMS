import { describe, expect, it, vi } from "vitest";
import {
  fallbackPincodeInfo,
  isValidPincode,
  normalizePincode,
  parsePostalPincodeResponse,
  PIN_PREFIX_STATES,
  PincodeLookupError,
  PostalPincodeDriver,
  stateCodeFromPincode,
} from "./pincode";
import { STATE_NAMES, stateCodeFromName } from "./states";

describe("pincode validation", () => {
  it("accepts six digits starting 1–9", () => {
    expect(isValidPincode("600001")).toBe(true);
    expect(isValidPincode("110001")).toBe(true);
    expect(isValidPincode(560001)).toBe(true);
    expect(normalizePincode(" 600 001 ")).toBe("600001");
    expect(normalizePincode("600-001")).toBe("600001");
  });

  it("rejects everything else", () => {
    for (const bad of ["060001", "60001", "6000011", "60000a", "", null, undefined, {}, "000000"]) {
      expect(isValidPincode(bad)).toBe(false);
    }
  });
});

describe("offline prefix table", () => {
  it.each([
    ["110001", "07"], // Delhi
    ["122001", "06"], // Gurugram
    ["160017", "04"], // Chandigarh
    ["141001", "03"], // Ludhiana
    ["171001", "02"], // Shimla
    ["190001", "01"], // Srinagar
    ["194101", "38"], // Leh
    ["226001", "09"], // Lucknow
    ["248001", "05"], // Dehradun
    ["263001", "05"], // Nainital
    ["302001", "08"], // Jaipur
    ["380001", "24"], // Ahmedabad
    ["396210", "26"], // Daman
    ["396230", "26"], // Silvassa
    ["362520", "26"], // Diu
    ["400001", "27"], // Mumbai
    ["403001", "30"], // Panaji
    ["452001", "23"], // Indore
    ["492001", "22"], // Raipur
    ["500001", "36"], // Hyderabad
    ["520001", "37"], // Vijayawada
    ["560001", "29"], // Bengaluru
    ["600001", "33"], // Chennai
    ["641001", "33"], // Coimbatore
    ["605001", "34"], // Puducherry
    ["609602", "34"], // Karaikal
    ["682001", "32"], // Kochi
    ["682555", "31"], // Lakshadweep
    ["673310", "34"], // Mahe
    ["700001", "19"], // Kolkata
    ["737101", "11"], // Gangtok
    ["744101", "35"], // Port Blair
    ["751001", "21"], // Bhubaneswar
    ["781001", "18"], // Guwahati
    ["791111", "12"], // Itanagar
    ["793001", "17"], // Shillong
    ["795001", "14"], // Imphal
    ["796001", "15"], // Aizawl
    ["797001", "13"], // Kohima
    ["799001", "16"], // Agartala
    ["800001", "10"], // Patna
    ["834001", "20"], // Ranchi
    ["826001", "20"], // Dhanbad
    ["814112", "20"], // Dumka
    ["823001", "10"], // Gaya
  ])("%s → %s", (pin, code) => {
    expect(stateCodeFromPincode(pin)).toBe(code);
  });

  it("returns null for APS and unused ranges", () => {
    expect(stateCodeFromPincode("900001")).toBeNull();
    expect(stateCodeFromPincode("999999")).toBeNull();
    expect(stateCodeFromPincode("550001")).toBeNull();
    expect(stateCodeFromPincode("abc")).toBeNull();
  });

  it("covers every first digit 1–8 and maps only to known states", () => {
    for (const code of Object.values(PIN_PREFIX_STATES)) expect(STATE_NAMES[code]).toBeDefined();
    for (const d of "12345678") expect(Object.keys(PIN_PREFIX_STATES).some((p) => p.startsWith(d))).toBe(true);
    for (const p of Object.keys(PIN_PREFIX_STATES)) expect(p).toMatch(/^[1-9]\d{1,4}$/);
  });

  it("builds an approximate answer", () => {
    expect(fallbackPincodeInfo("600001")).toEqual({
      pincode: "600001",
      city: "",
      district: "",
      state: "Tamil Nadu",
      stateCode: "33",
      approximate: true,
    });
    expect(fallbackPincodeInfo("900001")).toBeNull();
  });
});

describe("state names", () => {
  it.each([
    ["Tamil Nadu", "33"],
    ["TAMILNADU", "33"],
    ["Andaman & Nicobar Islands", "35"],
    ["Jammu & Kashmir", "01"],
    ["Pondicherry", "34"],
    ["Orissa", "21"],
    ["Chattisgarh", "22"],
    ["Uttaranchal", "05"],
    ["NCT of Delhi", "07"],
    ["Dadra & Nagar Haveli", "26"],
    ["Daman & Diu", "26"],
    ["The Dadra And Nagar Haveli And Daman And Diu", "26"],
    ["Telangana", "36"],
    ["Ladakh", "38"],
  ])("%s → %s", (name, code) => {
    expect(stateCodeFromName(name)).toBe(code);
  });

  it("unknown → null", () => {
    expect(stateCodeFromName("Atlantis")).toBeNull();
    expect(stateCodeFromName("")).toBeNull();
  });
});

const SUCCESS = [
  {
    Message: "Number of pincode(s) found:2",
    Status: "Success",
    PostOffice: [
      { Name: "Some BO", BranchType: "Branch Post Office", DeliveryStatus: "Non-Delivery", District: "Coimbatore", Block: "NA", State: "Tamil Nadu", Pincode: "641001" },
      {
        Name: "Coimbatore H.O",
        BranchType: "Head Post Office",
        DeliveryStatus: "Delivery",
        Circle: "Tamilnadu",
        District: "Coimbatore",
        Division: "Coimbatore",
        Block: "Coimbatore North",
        State: "Tamil Nadu",
        Country: "India",
        Pincode: "641001",
      },
    ],
  },
];

describe("parsePostalPincodeResponse", () => {
  it("picks the delivery post office and maps the state", () => {
    expect(parsePostalPincodeResponse("641001", SUCCESS)).toEqual({
      pincode: "641001",
      city: "Coimbatore North",
      district: "Coimbatore",
      state: "Tamil Nadu",
      stateCode: "33",
      approximate: false,
    });
  });

  it("falls back to the district when Block is NA", () => {
    const json = [{ Status: "Success", PostOffice: [{ DeliveryStatus: "Delivery", District: "Central Delhi", Block: "NA", State: "Delhi" }] }];
    expect(parsePostalPincodeResponse("110001", json)).toMatchObject({ city: "Central Delhi", stateCode: "07", state: "Delhi" });
  });

  it("normalises old state spellings to ours", () => {
    const json = [{ Status: "Success", PostOffice: [{ DeliveryStatus: "Delivery", District: "Puducherry", Block: "NA", State: "Pondicherry" }] }];
    expect(parsePostalPincodeResponse("605001", json)).toMatchObject({ state: "Puducherry", stateCode: "34" });
  });

  it("uses the prefix table for an unknown state name", () => {
    const json = [{ Status: "Success", PostOffice: [{ DeliveryStatus: "Delivery", District: "X", State: "Weird Name" }] }];
    expect(parsePostalPincodeResponse("600001", json)).toMatchObject({ state: "Tamil Nadu", stateCode: "33" });
  });

  it("returns null for no records", () => {
    expect(parsePostalPincodeResponse("999999", [{ Message: "No records found", Status: "Error", PostOffice: null }])).toBeNull();
    expect(parsePostalPincodeResponse("999999", [{ Message: "No records found", Status: "404", PostOffice: null }])).toBeNull();
    expect(parsePostalPincodeResponse("999999", [{ Status: "Success", PostOffice: [] }])).toBeNull();
  });

  it("throws on garbage", () => {
    expect(() => parsePostalPincodeResponse("600001", [])).toThrow(PincodeLookupError);
    expect(() => parsePostalPincodeResponse("600001", "oops")).toThrow(PincodeLookupError);
    expect(() => parsePostalPincodeResponse("600001", [{ Status: "Weird" }])).toThrow(PincodeLookupError);
  });
});

describe("PostalPincodeDriver", () => {
  const respond = (status: number, body: unknown) =>
    vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify(body), { status }));

  it("calls the API with a timeout and parses the result", async () => {
    const fetch = respond(200, SUCCESS);
    const info = await new PostalPincodeDriver({ fetch: fetch as unknown as typeof globalThis.fetch }).lookup("641001");
    expect(info?.stateCode).toBe("33");
    expect(fetch.mock.calls[0]![0]).toBe("https://api.postalpincode.in/pincode/641001");
    expect(fetch.mock.calls[0]![1]!.signal).toBeInstanceOf(AbortSignal);
  });

  it("not found → null; outages → PincodeLookupError", async () => {
    const asFetch = (f: unknown) => f as typeof globalThis.fetch;
    expect(await new PostalPincodeDriver({ fetch: asFetch(respond(200, [{ Status: "Error", PostOffice: null }])) }).lookup("999999")).toBeNull();
    await expect(new PostalPincodeDriver({ fetch: asFetch(respond(503, {})) }).lookup("600001")).rejects.toBeInstanceOf(PincodeLookupError);
    const down = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(new PostalPincodeDriver({ fetch: asFetch(down) }).lookup("600001")).rejects.toBeInstanceOf(PincodeLookupError);
    const html = vi.fn(async () => new Response("<html>", { status: 200 }));
    await expect(new PostalPincodeDriver({ fetch: asFetch(html) }).lookup("600001")).rejects.toBeInstanceOf(PincodeLookupError);
  });

  it("does not call the API for invalid pincodes", async () => {
    const fetch = respond(200, SUCCESS);
    expect(await new PostalPincodeDriver({ fetch: fetch as unknown as typeof globalThis.fetch }).lookup("012345")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
