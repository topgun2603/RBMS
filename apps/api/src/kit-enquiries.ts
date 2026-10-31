import { FULL_ACCESS_ROLES } from "@rbms/core";
import type { Db } from "@rbms/db";
import { createEnquiries, type EnquiryCounterPort, type EnquiryQueuePort, type ReceivedEnquiry } from "@rbms/enquiries";
import type { Logger } from "pino";
import { appUrlFor } from "./kit-batch5";

export interface EnquiriesKitDeps {
  db: Db;
  /** `APP_PUBLIC_URL` (APP=template pairs). */
  appPublicUrl: string;
  shopName(tenantId: string): Promise<string | null | undefined>;
  tenant(tenantId: string): Promise<{ appId: string | null; slug: string } | null>;
  members(tenantId: string): Promise<{ userId: string; roles: string[] }[]>;
  sendToUser(input: { tenantId: string; userId: string; template: string; vars: Record<string, string>; channels: ("push" | "whatsapp" | "email")[] }): Promise<{ status: string }[]>;
  /** The API's shared rate-limit counter (Redis, memory fallback: `sharedWindowCounter` in http-guard.ts). */
  counter: EnquiryCounterPort;
  /** Jobs, for the alert digest. */
  queue?: EnquiryQueuePort;
  now?: () => Date;
  log: Logger;
}

/** " - Admission 2027-28, Class 1 (for Kavin)": what the enquiry is about, for the owner alert. */
export function enquiryAbout(e: Pick<ReceivedEnquiry, "topic" | "option" | "studentName">): string {
  const what = [e.topic, e.option].filter(Boolean).join(", ");
  const who = e.studentName ? `(for ${e.studentName})` : "";
  const s = [what, who].filter(Boolean).join(" ");
  return s ? ` - ${s}` : "";
}

/**
 * Website enquiries (docs/school.md): the store's enquiry form posts to `/v1/enquiries/public`; every owner / admin
 * gets a push for each new one, else WhatsApp, else email, with a link to the enquiry in their app. Past
 * `ALERT_RATE` an hour per shop the single alerts stop and one `enquiry.digest` follows when the hour is over.
 */
export function createEnquiriesKit(d: EnquiriesKitDeps) {
  const appBase = async (tenantId: string) => {
    const t = await d.tenant(tenantId);
    return t ? appUrlFor(d.appPublicUrl, t.appId, t.slug).replace(/\/+$/, "") : "";
  };
  /** Push first, else WhatsApp, else email: one message per owner / admin, on the first channel that takes it. */
  const toOwners = async (tenantId: string, template: string, vars: Record<string, string>) => {
    const owners = (await d.members(tenantId)).filter((m) => m.roles.some((r) => FULL_ACCESS_ROLES.includes(r)));
    for (const { userId } of owners) {
      for (const channel of ["push", "whatsapp", "email"] as const) {
        const res = await d.sendToUser({ tenantId, userId, template, vars, channels: [channel] });
        if (res.some((r) => r.status === "sent" || r.status === "queued")) break;
      }
    }
  };
  return createEnquiries({
    db: d.db,
    counter: d.counter,
    queue: d.queue,
    now: d.now,
    log: d.log,
    notify: {
      digest: async (tenantId, { count }) => {
        const base = await appBase(tenantId);
        await toOwners(tenantId, "enquiry.digest", { shop: (await d.shopName(tenantId)) ?? "", count: String(count), link: base ? `${base}/enquiries` : "" });
      },
      received: async (tenantId, e) => {
        const base = await appBase(tenantId);
        const vars = {
          shop: (await d.shopName(tenantId)) ?? "",
          number: e.number,
          name: e.name,
          phone: e.phone,
          about: enquiryAbout(e),
          link: base ? `${base}/enquiries/${e.id}` : "",
        };
        await toOwners(tenantId, "enquiry.received", vars);
      },
    },
  });
}
