import { describe, expect, it } from "vitest";
import { htmlToText, maskTarget, placeholders, render, renderEmailHtml } from "./render";

describe("render", () => {
  it("replaces placeholders, tolerating whitespace", () => {
    expect(render("Hi {{name}}, code {{ code }}", { name: "Gowtham", code: 1234 })).toBe("Hi Gowtham, code 1234");
  });

  it("renders missing vars as empty strings", () => {
    expect(render("Hi {{name}}!", {})).toBe("Hi !");
  });

  it("escapes values in html mode only", () => {
    const vars = { name: `<b>"x" & 'y'</b>` };
    expect(render("{{name}}", vars)).toBe(`<b>"x" & 'y'</b>`);
    expect(render("<p>{{name}}</p>", vars, { html: true })).toBe("<p>&lt;b&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/b&gt;</p>");
  });

  it("handles Tamil text", () => {
    expect(render("{{code}} என்பது உங்கள் குறியீடு", { code: "4821" })).toBe("4821 என்பது உங்கள் குறியீடு");
  });

  it("lists placeholders in order of first appearance", () => {
    expect(placeholders("{{code}} for {{app}} ({{code}}) in {{minutes}}")).toEqual(["code", "app", "minutes"]);
  });
});

describe("email html", () => {
  it("escapes plain-text templates and converts newlines", () => {
    expect(renderEmailHtml("A < B\n{{x}}", { x: "<i>" })).toBe("A &lt; B<br>\n&lt;i&gt;");
  });

  it("keeps html templates and escapes only values", () => {
    expect(renderEmailHtml("<p>Hello {{x}}</p>", { x: "<script>" })).toBe("<p>Hello &lt;script&gt;</p>");
  });

  it("derives a text alternative", () => {
    expect(htmlToText("<p>Hello &amp; welcome</p><p>Bye<br>now</p>")).toBe("Hello & welcome\nBye\nnow");
  });
});

describe("maskTarget", () => {
  it("masks Indian mobile numbers keeping country code and last 4", () => {
    expect(maskTarget("+919876543210")).toBe("+91******3210");
  });

  it("masks emails keeping first and last char of the local part", () => {
    expect(maskTarget("gowtham@x.com")).toBe("g*****m@x.com");
    expect(maskTarget("ab@x.com")).toBe("a*@x.com");
  });

  it("masks bare numbers and opaque tokens", () => {
    expect(maskTarget("9876543210")).toBe("******3210");
    expect(maskTarget("fcm-token-abcdefghijklmnop")).toBe("fcm-…mnop");
  });
});
