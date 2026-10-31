import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { en, ta, translatorFor } from "../lib/messages";
import type { EnquiryFormConfig } from "../types";

vi.mock("./store-context", () => ({ useStore: () => ({ t: translatorFor("en"), locale: "en" }) }));
vi.mock("./privacy", () => ({
  useNotice: () => ({ data: { label: "v3" } }),
  NoticeLine: ({ before }: { before?: string }) => <p data-testid="privacy-notice-line">{before} <a href="/policies/privacy">privacy notice</a>.</p>,
}));

import { EnquiryForm } from "./enquiry-form";

const base: EnquiryFormConfig = { heading: "Admission enquiry", askStudent: false, options: [], askEmail: true, askMessage: true };
const html = (cfg: Partial<EnquiryFormConfig> = {}) => renderToStaticMarkup(<EnquiryForm cfg={{ ...base, ...cfg }} />);

describe("enquiry form", () => {
  it("always shows name, phone, the honeypot and the privacy line, with visible labels", () => {
    const out = html();
    expect(out).toContain("Admission enquiry");
    expect(out).toContain("Your name");
    expect(out).toContain("Mobile number");
    expect(out).toContain('inputMode="tel"');
    expect(out).toContain('autoComplete="tel"');
    expect(out).toMatch(/name="website"[^>]*tabindex="-1"|tabindex="-1"[^>]*name="website"/i);
    expect(out).toContain("By sending this you accept our");
    expect(out).toContain("/policies/privacy");
    expect(out).toContain("Send enquiry");
  });

  it("shows the optional fields only when asked for", () => {
    const min = html({ askEmail: false, askMessage: false });
    expect(min).not.toContain("Email");
    expect(min).not.toContain("Message");
    expect(min).not.toContain("<select");
    expect(min).not.toContain("Student&#x27;s name");
    const full = html({ askStudent: true, studentLabel: "Child's name", optionLabel: "Class applying for", options: ["LKG", "Class 1"], submitLabel: "Apply now", text: "We call you back", imageUrl: "/s.jpg", imageAlt: "School" });
    expect(full).toContain("Child&#x27;s name");
    expect(full).toContain("Class applying for");
    expect(full).toContain("<option value=\"LKG\">LKG</option>");
    expect(full).toContain("Apply now");
    expect(full).toContain("We call you back");
    expect(full).toContain('alt="School"');
  });

  it("has Tamil words for every enquiry message", () => {
    const keys = Object.keys(en).filter((k) => k.startsWith("enquiry."));
    expect(keys.length).toBeGreaterThan(10);
    for (const k of keys) expect(ta[k], k).toMatch(/[஀-௿]/);
  });
});
