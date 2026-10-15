import { z } from "zod";

/**
 * Campaign audience: the union of one or more sources, deduplicated by number. `wa_contacts` and `phones` are
 * resolved by this module; every other kind goes to the `AudiencePort` the kit implements with the owning modules.
 */
export const audienceSourceSchema = z.discriminatedUnion("kind", [
  /** Opted-in WhatsApp contacts, optionally only those with any / all of `tags`. */
  z.object({
    kind: z.literal("wa_contacts"),
    tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
    match: z.enum(["any", "all"]).default("any"),
  }),
  /** Billing customers with a credit-book balance due of at least `minDue` paise (credit book). */
  z.object({ kind: z.literal("dues"), minDue: z.number().int().min(0).default(1) }),
  /** Store customers who ordered within the last `days` days. */
  z.object({ kind: z.literal("recent_orders"), days: z.number().int().min(1).max(730) }),
  /** Loyalty members in one of the tiers. */
  z.object({ kind: z.literal("loyalty_tier"), tiers: z.array(z.string().trim().min(1).max(40)).min(1).max(10) }),
  /** Every billing / store customer with a mobile number. */
  z.object({ kind: z.literal("customers") }),
  /** A pasted / uploaded list. */
  z.object({
    kind: z.literal("phones"),
    items: z
      .array(
        z.object({
          phone: z.string().trim().min(5).max(30),
          name: z.string().trim().max(120).optional(),
          variables: z.record(z.string().max(60), z.string().max(500)).optional(),
        }),
      )
      .min(1)
      .max(10_000),
  }),
]);
export type AudienceSource = z.infer<typeof audienceSourceSchema>;

export const audienceSpecSchema = z.object({
  sources: z.array(audienceSourceSchema).min(1).max(10),
  /** Leave out contacts carrying any of these WhatsApp tags. */
  excludeTags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
});
export type AudienceSpec = z.infer<typeof audienceSpecSchema>;

/** Sources the kit resolves through `AudiencePort`. */
export type ExternalAudienceSource = Exclude<AudienceSource, { kind: "wa_contacts" } | { kind: "phones" }>;
export type ExternalAudienceKind = ExternalAudienceSource["kind"];
export const EXTERNAL_AUDIENCE_KINDS: ExternalAudienceKind[] = ["dues", "recent_orders", "loyalty_tier", "customers"];

export const isExternalSource = (s: AudienceSource): s is ExternalAudienceSource =>
  (EXTERNAL_AUDIENCE_KINDS as string[]).includes(s.kind);
