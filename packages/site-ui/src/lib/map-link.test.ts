import { describe, expect, it } from "vitest";
import { coordsFromText } from "./map-link";

describe("coordsFromText", () => {
  it("keeps a plain pair, normalised", () => expect(coordsFromText(" 9.9252,78.1198 ")).toBe("9.9252, 78.1198"));
  it("reads Google Maps links", () => {
    expect(coordsFromText("https://www.google.com/maps/place/Shop/@9.9252,78.1198,17z/data=!3m1")).toBe("9.9252, 78.1198");
    expect(coordsFromText("https://www.google.com/maps/place/X/data=!4m6!3d11.0016!4d76.9752")).toBe("11.0016, 76.9752");
    expect(coordsFromText("https://www.google.com/maps/search/?api=1&query=11.0016%2C76.9752")).toBe("11.0016, 76.9752");
  });
  it("reads OpenStreetMap links", () => {
    expect(coordsFromText("https://www.openstreetmap.org/#map=17/9.9252/78.1198")).toBe("9.9252, 78.1198");
    expect(coordsFromText("https://www.openstreetmap.org/?mlat=9.9252&mlon=78.1198")).toBe("9.9252, 78.1198");
  });
  it("returns null for text with no coordinates or out-of-range numbers", () => {
    expect(coordsFromText("https://maps.app.goo.gl/abc123")).toBeNull();
    expect(coordsFromText("Madurai")).toBeNull();
    expect(coordsFromText("95.1, 78.1")).toBeNull();
    expect(coordsFromText("")).toBeNull();
  });
});
