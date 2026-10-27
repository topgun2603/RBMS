import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NoticeBody, type PublicNotice } from "../components/privacy-notice";
import { isProxyAllowed } from "../server/proxy";
import { privacyEn, privacyTa } from "./messages-privacy";
import { en, ta, translatorFor } from "./messages";

const text = (title: string) => ({ title, intro: `${title} intro`, sections: [{ id: "who", heading: "Who", paragraphs: ["We are the shop."], items: ["One", "Two"] }] });
const notice: PublicNotice = { version: 4, createdAt: "2026-10-27T00:00:00Z", content: { en: text("English"), ta: text("Tamil") } };
const ID = "123e4567-e89b-12d3-a456-426614174000";

describe("privacy strings", () => {
  it("every privacy key exists in English and Tamil, and in the merged bundles", () => {
    expect(Object.keys(privacyTa).sort()).toEqual(Object.keys(privacyEn).sort());
    for (const k of Object.keys(privacyEn)) {
      expect(en[k], k).toBe(privacyEn[k]);
      expect(ta[k], k).toBe(privacyTa[k]);
    }
  });
  it("every request type has a label", () => {
    for (const k of ["access", "correction", "erasure", "withdraw_consent", "nominate", "grievance"]) expect(privacyEn[`privacy.type.${k}`]).toBeTruthy();
  });
});

describe("notice page body", () => {
  it("renders the version and the text in the shopper's language, without the owner's review note", () => {
    const html = renderToStaticMarkup(<NoticeBody notice={notice} locale="ta" t={translatorFor("ta")} />);
    expect(html).toContain("Tamil intro");
    expect(html).toContain("<li>One</li>");
    expect(html).toContain("4");
    expect(html).not.toContain("lawyer");
  });
});

describe("store proxy", () => {
  it("lets the shopper read the notice and file their own requests only", () => {
    expect(isProxyAllowed("/v1/consent/notice", "GET")).toBe(true);
    expect(isProxyAllowed("/v1/consent", "POST")).toBe(true);
    expect(isProxyAllowed("/v1/consent/rights", "POST")).toBe(true);
    expect(isProxyAllowed("/v1/consent/rights/mine", "GET")).toBe(true);
    expect(isProxyAllowed(`/v1/consent/rights/mine/${ID}/cancel`, "POST")).toBe(true);
    expect(isProxyAllowed(`/v1/consent/rights/mine/${ID}/data`, "GET")).toBe(true);
  });
  it("keeps the staff screens out of the store", () => {
    expect(isProxyAllowed("/v1/consent/rights", "GET")).toBe(false);
    expect(isProxyAllowed(`/v1/consent/rights/${ID}/erase`, "POST")).toBe(false);
    expect(isProxyAllowed("/v1/consent/retention", "GET")).toBe(false);
    expect(isProxyAllowed("/v1/consent/breaches", "GET")).toBe(false);
    expect(isProxyAllowed("/v1/consent/requests", "GET")).toBe(false);
    expect(isProxyAllowed("/v1/consent/delete-account", "POST")).toBe(false);
  });
});
