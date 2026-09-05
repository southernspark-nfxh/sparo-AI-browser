import { describe, expect, it } from "vitest";
import {
  chromeUserAgent,
  isOauthLoginUrl,
  shouldAllowOauthPopup,
} from "../src/main/oauth-popups.js";

describe("isOauthLoginUrl", () => {
  it("matches Google and Apple sign-in", () => {
    expect(
      isOauthLoginUrl(
        "https://accounts.google.com/gsi/select?client_id=abc",
      ),
    ).toBe(true);
    expect(
      isOauthLoginUrl(
        "https://appleid.apple.com/auth/authorize?client_id=com.twitter.twitter.siwa",
      ),
    ).toBe(true);
  });

  it("does not match ordinary browsing", () => {
    expect(isOauthLoginUrl("https://www.google.com/search?q=itch")).toBe(false);
    expect(isOauthLoginUrl("https://x.com/home")).toBe(false);
  });
});

describe("shouldAllowOauthPopup", () => {
  it("allows Google GIS as a real popup", () => {
    expect(
      shouldAllowOauthPopup({
        url: "https://accounts.google.com/gsi/select?client_id=x",
        disposition: "new-window",
        features: "width=500,height=600",
      }),
    ).toBe(true);
  });

  it("allows about:blank sized popups (GIS often starts there)", () => {
    expect(
      shouldAllowOauthPopup({
        url: "about:blank",
        features: "popup=yes,width=500,height=600",
      }),
    ).toBe(true);
  });

  it("does not treat a normal new tab as a popup", () => {
    expect(
      shouldAllowOauthPopup({
        url: "https://x.com/i/status/1",
        disposition: "foreground-tab",
      }),
    ).toBe(false);
  });
});

describe("chromeUserAgent", () => {
  it("does not advertise Electron", () => {
    expect(chromeUserAgent()).not.toMatch(/Electron/i);
    expect(chromeUserAgent()).toMatch(/Chrome\//);
  });
});
