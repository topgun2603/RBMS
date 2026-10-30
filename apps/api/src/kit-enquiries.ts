import { FULL_ACCESS_ROLES } from "@rbms/core";
import type { Db } from "@rbms/db";
import { createEnquiries, type ReceivedEnquiry } from "@rbms/enquiries";
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
 * gets a push for each new one, else WhatsApp, else email, with a link to the enquiry in their app.
 */
export function createEnquiriesKit(d: EnquiriesKitDeps) {
  return createEnquiries({
    db: d.db,
    now: d.now,
    log: d.log,
    notify: {
      received: async (tenantId, e) => {
        const t = await d.tenant(tenantId);
        const base = t ? appUrlFor(d.appPublicUrl, t.appId, t.slug).replace(/\/+$/, "") : "";
        const vars = {
          shop: (await d.shopName(tenantId)) ?? "",
          number: e.number,
          name: e.name,
          phone: e.phone,
          about: enquiryAbout(e),
          link: base ? `${base}/enquiries/${e.id}` : "",
        };
        const owners = (await d.members(tenantId)).filter((m) => m.roles.some((r) => FULL_ACCESS_ROLES.includes(r)));
        // Push first, else WhatsApp, else email: one alert per owner, on the first channel that takes it.
        for (const { userId } of owners) {
          for (const channel of ["push", "whatsapp", "email"] as const) {
            const res = await d.sendToUser({ tenantId, userId, template: "enquiry.received", vars, channels: [channel] });
            if (res.some((r) => r.status === "sent" || r.status === "queued")) break;
          }
        }
      },
    },
  });
}
