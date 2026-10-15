import { describe, expect, it } from "vitest";
import { buildTemplateComponents, defaultMapping, placeholders, sanitiseParam, templateSlots, type TemplateDef } from "./template";

const reminder: TemplateDef = {
  name: "payment_reminder",
  language: "en",
  components: [
    { type: "HEADER", format: "TEXT", text: "Reminder from {{1}}" },
    { type: "BODY", text: "Dear {{1}}, your balance of {{2}} is due on {{3}}. Thanks, {{1}}." },
    { type: "FOOTER", text: "Reply STOP to unsubscribe" },
    {
      type: "BUTTONS",
      buttons: [
        { type: "URL", text: "Pay now", url: "https://pay.example.com/{{1}}" },
        { type: "QUICK_REPLY", text: "Paid" },
        { type: "COPY_CODE", text: "Copy code" },
      ],
    },
  ],
};

const offer: TemplateDef = {
  name: "offer",
  language: "ta",
  parameterFormat: "NAMED",
  components: [
    { type: "HEADER", format: "IMAGE" },
    { type: "BODY", text: "வணக்கம் {{customer_name}}, {{offer}}!" },
  ],
};

const recipient = { phone: "+919876543210", name: "Ravi", variables: { amount: "₹1,250.00", due: "20 Oct", link: "inv_42", code: "DIWALI10" } };

describe("placeholders and slots", () => {
  it("orders positional placeholders numerically and dedupes", () => {
    expect(placeholders("{{2}} {{1}} {{10}} {{1}}")).toEqual(["1", "2", "10"]);
    expect(placeholders("{{ name }} and {{amount}}")).toEqual(["name", "amount"]);
    expect(placeholders(undefined)).toEqual([]);
  });
  it("lists header, body and button slots", () => {
    expect(templateSlots(reminder).map((s) => s.slot)).toEqual(["header.1", "body.1", "body.2", "body.3", "button.0.1", "button.2.code"]);
    expect(templateSlots(offer).map((s) => s.slot)).toEqual(["body.customer_name", "body.offer"]);
  });
});

describe("buildTemplateComponents", () => {
  it("maps sources to Cloud API components", () => {
    const built = buildTemplateComponents(
      reminder,
      {
        params: {
          "header.1": { from: "text", value: "Sri Stores" },
          "body.1": { from: "name", fallback: "Customer" },
          "body.2": { from: "var", key: "amount" },
          "body.3": { from: "var", key: "due" },
          "button.0.1": { from: "var", key: "link" },
          "button.2.code": { from: "var", key: "code" },
        },
      },
      recipient,
    );
    expect(built.missing).toEqual([]);
    expect(built.components).toEqual([
      { type: "header", parameters: [{ type: "text", text: "Sri Stores" }] },
      {
        type: "body",
        parameters: [
          { type: "text", text: "Ravi" },
          { type: "text", text: "₹1,250.00" },
          { type: "text", text: "20 Oct" },
        ],
      },
      { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "inv_42" }] },
      { type: "button", sub_type: "copy_code", index: "2", parameters: [{ type: "coupon_code", coupon_code: "DIWALI10" }] },
    ]);
    expect(built.text).toBe("Reminder from Sri Stores\nDear Ravi, your balance of ₹1,250.00 is due on 20 Oct. Thanks, Ravi.");
  });

  it("uses fallbacks and reports missing slots", () => {
    const built = buildTemplateComponents(
      reminder,
      { params: { "body.1": { from: "name", fallback: "Customer" }, "body.2": { from: "var", key: "nope" } } },
      { phone: "+919876543210", name: null, variables: {} },
    );
    expect(built.values["body.1"]).toBe("Customer");
    expect(built.missing).toEqual(["header.1", "body.2", "body.3", "button.0.1", "button.2.code"]);
  });

  it("named templates send parameter_name; media headers need headerMedia of the right type", () => {
    const mapping = { params: { "body.customer_name": { from: "name" as const }, "body.offer": { from: "text" as const, value: "20% off\nthis week" } } };
    const noMedia = buildTemplateComponents(offer, mapping, recipient);
    expect(noMedia.missing).toEqual(["header.media"]);
    const built = buildTemplateComponents(offer, { ...mapping, headerMedia: { type: "image", link: "https://cdn.example.com/o.jpg" } }, recipient);
    expect(built.missing).toEqual([]);
    expect(built.components).toEqual([
      { type: "header", parameters: [{ type: "image", image: { link: "https://cdn.example.com/o.jpg" } }] },
      {
        type: "body",
        parameters: [
          { type: "text", text: "Ravi", parameter_name: "customer_name" },
          { type: "text", text: "20% off this week", parameter_name: "offer" },
        ],
      },
    ]);
    expect(built.text).toBe("வணக்கம் Ravi, 20% off this week!");
  });

  it("templates without placeholders send no components", () => {
    const t: TemplateDef = { name: "hello_world", language: "en_US", components: [{ type: "BODY", text: "Hello World" }] };
    expect(buildTemplateComponents(t, { params: {} }, recipient)).toMatchObject({ components: [], missing: [], text: "Hello World" });
  });

  it("sanitises parameters the way Meta requires", () => {
    expect(sanitiseParam("a\n\tb     c ")).toBe("a b c");
  });

  it("builds a default mapping (first body slot = name)", () => {
    expect(defaultMapping(reminder).params).toEqual({
      "header.1": { from: "var", key: "1" },
      "body.1": { from: "name", fallback: "Customer" },
      "body.2": { from: "var", key: "2" },
      "body.3": { from: "var", key: "3" },
      "button.0.1": { from: "var", key: "1" },
      "button.2.code": { from: "var", key: "code" },
    });
  });
});
