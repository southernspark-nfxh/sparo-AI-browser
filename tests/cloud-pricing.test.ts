import { describe, expect, it } from "vitest";
import { isCloudPlanId, sanitizePlans } from "../src/main/cloud/pricing.js";

describe("cloud pricing catalog", () => {
  it("only accepts known plan ids", () => {
    expect(isCloudPlanId("monthly")).toBe(true);
    expect(isCloudPlanId("intro")).toBe(true);
    expect(isCloudPlanId("hack")).toBe(false);
  });

  it("sanitizes /plans payload", () => {
    const plans = sanitizePlans([
      { id: "intro", money: "5.00", points: 50, kind: "timed", days: 7 },
      { id: "monthly", money: "19.90", points: 400, kind: "subscription", days: 30 },
      { id: "nope", money: "1", points: 1, kind: "timed" },
    ]);
    expect(plans.map((p) => p.id)).toEqual(["intro", "monthly"]);
    expect(plans[0]?.points).toBe(50);
    expect(plans[0]?.kind).toBe("timed");
    expect(plans[1]?.days).toBe(30);
  });
});
