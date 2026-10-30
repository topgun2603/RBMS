import { describe, expect, it } from "vitest";
import { ApiError } from "@rbms/web";
import { clampRedeemPoints, estimatedTotal, pointsValue, quotablePhone, redeemFailure } from "./loyalty";

describe("loyalty redeem helpers", () => {
  const q = { canRedeem: true, maxPoints: 500, minRedeemPoints: 100 };

  it("clamps points to [min, max] and whole numbers", () => {
    expect(clampRedeemPoints(250, q)).toBe(250);
    expect(clampRedeemPoints(50, q)).toBe(100);
    expect(clampRedeemPoints(900, q)).toBe(500);
    expect(clampRedeemPoints(120.9, q)).toBe(120);
    expect(clampRedeemPoints("1,20", q)).toBe(120);
    expect(clampRedeemPoints("", q)).toBe(500);
    expect(clampRedeemPoints(null, q)).toBe(500);
    expect(clampRedeemPoints(300, { ...q, canRedeem: false })).toBe(0);
    expect(clampRedeemPoints(300, { ...q, maxPoints: 50 })).toBe(0);
    expect(clampRedeemPoints(0, { canRedeem: true, maxPoints: 5, minRedeemPoints: 0 })).toBe(1);
  });

  it("values points and estimates the new total", () => {
    expect(pointsValue(250, 100)).toBe(25000);
    expect(pointsValue(-3, 100)).toBe(0);
    expect(estimatedTotal(100000, 25000)).toBe(75000);
    expect(estimatedTotal(1000, 5000)).toBe(0);
    expect(estimatedTotal(1000, -5)).toBe(1000);
  });

  it("accepts Indian mobile numbers only", () => {
    expect(quotablePhone("+91 99990 46819")).toBe("9999046819");
    expect(quotablePhone("09999046819")).toBe("9999046819");
    expect(quotablePhone("919999046819")).toBe("9999046819");
    expect(quotablePhone("12345")).toBeNull();
    expect(quotablePhone("5999046819")).toBeNull();
    expect(quotablePhone(null)).toBeNull();
  });

  it("recognises loyalty rejections", () => {
    expect(redeemFailure(new ApiError(409, "loyalty_redeem", "At most 300 points", { reason: "too_many_points", maxPoints: 300 }), true)).toEqual({
      code: "loyalty_redeem",
      reason: "too_many_points",
      maxPoints: 300,
      message: "At most 300 points",
    });
    expect(redeemFailure(new ApiError(409, "loyalty_redeem", "x", { reason: "no_points", maxPoints: 0 }), true)).toMatchObject({ reason: "no_points", maxPoints: null });
    expect(redeemFailure(new ApiError(400, "loyalty_unavailable", "off"), true)?.code).toBe("loyalty_unavailable");
    expect(redeemFailure(new ApiError(400, "loyalty_on_issue", "issue"), true)?.code).toBe("loyalty_on_issue");
    expect(redeemFailure(new ApiError(400, "validation_error", "loyaltyPoints: Points are whole numbers"), true)?.code).toBe("validation");
    expect(redeemFailure(new ApiError(400, "validation_error", "loyaltyPoints: bad"), false)).toBeNull();
    expect(redeemFailure(new ApiError(400, "bad_request", "Add at least one line"), true)).toBeNull();
    expect(redeemFailure(new Error("x"), true)).toBeNull();
  });
});
