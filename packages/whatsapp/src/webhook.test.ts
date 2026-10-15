import { describe, expect, it } from "vitest";
import { describeErrors, parseWebhook, signBody, verifyChallenge, verifySignature } from "./webhook";

const SECRET = "app-secret-1234567890";

describe("verification challenge", () => {
  it("echoes the challenge only for subscribe + matching token", () => {
    const q = { "hub.mode": "subscribe", "hub.verify_token": "tok", "hub.challenge": "12345" };
    expect(verifyChallenge(q, "tok")).toBe("12345");
    expect(verifyChallenge(q, "other")).toBeNull();
    expect(verifyChallenge({ ...q, "hub.mode": "unsubscribe" }, "tok")).toBeNull();
    expect(verifyChallenge({ "hub.mode": "subscribe", "hub.verify_token": "tok" }, "tok")).toBeNull();
    expect(verifyChallenge(q, null)).toBeNull();
  });
});

describe("signature", () => {
  const raw = Buffer.from('{"object":"whatsapp_business_account","entry":[]}');
  it("accepts the HMAC of the exact raw bytes", () => {
    const sig = signBody(raw, SECRET);
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(verifySignature(raw, sig, SECRET)).toBe(true);
    expect(verifySignature(raw, sig.toUpperCase().replace("SHA256", "sha256"), SECRET)).toBe(true);
  });
  it("rejects tampering, wrong secret, missing or malformed headers", () => {
    const sig = signBody(raw, SECRET);
    expect(verifySignature(Buffer.from(raw.toString().replace("[]", "[ ]")), sig, SECRET)).toBe(false);
    expect(verifySignature(raw, sig, "another-secret")).toBe(false);
    expect(verifySignature(raw, undefined, SECRET)).toBe(false);
    expect(verifySignature(raw, "sha1=abc", SECRET)).toBe(false);
    expect(verifySignature(raw, sig, null)).toBe(false);
  });
});

const payload = {
  object: "whatsapp_business_account",
  entry: [
    {
      id: "WABA_ID",
      changes: [
        {
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { display_phone_number: "919000000000", phone_number_id: "1234567890" },
            contacts: [{ profile: { name: "Ravi Kumar" }, wa_id: "919876543210" }],
            messages: [
              { from: "919876543210", id: "wamid.A", timestamp: "1760500000", type: "text", text: { body: "STOP" } },
              {
                from: "919876543210",
                id: "wamid.B",
                timestamp: "1760500010",
                type: "image",
                image: { id: "media1", mime_type: "image/jpeg", sha256: "x", caption: "bill photo" },
                context: { from: "919000000000", id: "wamid.OUT" },
              },
              { from: "919876543210", id: "wamid.C", timestamp: "1760500020", type: "button", button: { text: "Paid", payload: "PAID" } },
              { from: "919876543210", id: "wamid.D", timestamp: "1760500030", type: "interactive", interactive: { type: "button_reply", button_reply: { id: "b1", title: "Yes" } } },
              { from: "919876543210", id: "wamid.E", timestamp: "1760500040", type: "location", location: { latitude: 13.08, longitude: 80.27, name: "Shop", address: "T Nagar" } },
              { from: "919876543210", id: "wamid.F", timestamp: "1760500050", type: "reaction", reaction: { message_id: "wamid.OUT", emoji: "👍" } },
              { from: "919876543210", id: "wamid.G", timestamp: "1760500060", type: "weird_new_type" },
              { id: "wamid.bad" },
            ],
          },
        },
        {
          field: "messages",
          value: {
            metadata: { phone_number_id: "1234567890" },
            statuses: [
              { id: "wamid.OUT", status: "delivered", timestamp: "1760500100", recipient_id: "919876543210" },
              {
                id: "wamid.OUT2",
                status: "failed",
                timestamp: "1760500200",
                recipient_id: "919876500000",
                errors: [{ code: 131047, title: "Re-engagement message", error_data: { details: "More than 24 hours have passed" } }],
              },
              { id: "wamid.OUT3", status: "deleted", timestamp: "1760500300" },
            ],
          },
        },
        { field: "account_update", value: { messages: [{ from: "1", id: "x", type: "text" }] } },
      ],
    },
  ],
};

describe("parseWebhook", () => {
  const parsed = parseWebhook(payload);

  it("collects phone number ids", () => {
    expect(parsed.phoneNumberIds).toEqual(["1234567890"]);
  });

  it("parses inbound messages of every type with the profile name", () => {
    expect(parsed.messages.map((m) => [m.providerId, m.type, m.body])).toEqual([
      ["wamid.A", "text", "STOP"],
      ["wamid.B", "image", "bill photo"],
      ["wamid.C", "button", "Paid"],
      ["wamid.D", "interactive", "Yes"],
      ["wamid.E", "location", "📍 Shop, T Nagar"],
      ["wamid.F", "reaction", "👍"],
      ["wamid.G", "unsupported", null],
    ]);
    const first = parsed.messages[0]!;
    expect(first.from).toBe("+919876543210");
    expect(first.name).toBe("Ravi Kumar");
    expect(first.timestamp.toISOString()).toBe(new Date(1760500000 * 1000).toISOString());
    expect(parsed.messages[1]).toMatchObject({ media: { id: "media1", mimeType: "image/jpeg" }, replyTo: "wamid.OUT" });
    expect(parsed.messages[2]!.extra).toEqual({ payload: "PAID" });
  });

  it("parses statuses with errors and skips unknown ones", () => {
    expect(parsed.statuses).toHaveLength(2);
    expect(parsed.statuses[0]).toMatchObject({ providerId: "wamid.OUT", status: "delivered", recipient: "+919876543210", errors: [] });
    expect(parsed.statuses[1]!.errors).toEqual([{ code: 131047, title: "Re-engagement message", message: "More than 24 hours have passed" }]);
    expect(describeErrors(parsed.statuses[1]!.errors)).toBe("131047: Re-engagement message — More than 24 hours have passed");
    expect(describeErrors([])).toBeNull();
  });

  it("tolerates garbage", () => {
    for (const p of [null, "x", 1, {}, { entry: "no" }, { entry: [{ changes: [null, { value: null }] }] }]) {
      expect(parseWebhook(p)).toEqual({ messages: [], statuses: [], phoneNumberIds: [] });
    }
  });
});
