import { describe, expect, it } from "vitest";
import { describeCloudError, isValidEmail } from "../src/main/cloud/validate.js";
import { accountUrl, cloudApiBase } from "../src/main/cloud/config.js";

describe("cloud validate", () => {
  it("accepts ordinary emails", () => {
    expect(isValidEmail("a@b.com")).toBe(true);
    expect(isValidEmail("  user@mail.co  ")).toBe(true);
    expect(isValidEmail("")).toBe(false);
    expect(isValidEmail("not-an-email")).toBe(false);
    expect(isValidEmail("a@b")).toBe(false);
  });

  it("maps network and field errors", () => {
    expect(describeCloudError(new Error("EMAIL"))).toBe("email");
    expect(describeCloudError(new Error("CODE"))).toBe("code");
    expect(describeCloudError(new Error("NETWORK"))).toBe("network");
    expect(describeCloudError(new Error("connect ECONNREFUSED 127.0.0.1:3940"))).toBe("network");
    expect(describeCloudError(new Error("quota"))).toBe("other");
  });

  it("opens Chinese account page for zh locale", () => {
    expect(accountUrl("zh")).toContain("/zh/sparo/account");
    expect(accountUrl("en")).toMatch(/\/sparo\/account$/);
    expect(accountUrl("en")).not.toContain("/zh/");
  });

  it("defaults to local proxy outside a packaged app", () => {
    expect(cloudApiBase()).toBe("http://127.0.0.1:3940");
  });
});
