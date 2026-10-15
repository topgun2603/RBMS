import { describe, expect, it } from "vitest";
import { addressParts } from "./kit-batch3";

describe("addressParts (e-invoice buyer city / PIN from a free-text address)", () => {
  it("takes the PIN code and the last named part as the city", () => {
    expect(addressParts("12, Big Bazaar Street, Coimbatore, 641001")).toEqual({ city: "Coimbatore", pincode: "641001" });
    expect(addressParts("4th Cross, Indiranagar\nBengaluru - 560038")).toEqual({ city: "Bengaluru", pincode: "560038" });
  });

  it("copes with missing parts", () => {
    expect(addressParts(null)).toEqual({ city: null, pincode: null });
    expect(addressParts("Main Road")).toEqual({ city: null, pincode: null });
    expect(addressParts("No 5, Gandhi Nagar")).toEqual({ city: "Gandhi Nagar", pincode: null });
  });
});
