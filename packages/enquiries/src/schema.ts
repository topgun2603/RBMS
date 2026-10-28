import { pk, tenantId, timestamps } from "@srirealtime/db";
import { index, integer, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";

/** new → contacted → follow_up → converted (joined / admitted) or closed. Any status can be set from any other. */
export const ENQUIRY_STATUSES = ["new", "contacted", "follow_up", "converted", "closed"] as const;
export type EnquiryStatus = (typeof ENQUIRY_STATUSES)[number];

/**
 * An enquiry sent from the shop's website form (the CMS `enquiry-form` section or page block): a parent asking about
 * admission, a customer asking for a call back. No sign-in; the visitor gives a name and an Indian mobile number.
 */
export const enquiries = pgTable(
  "enquiries",
  {
    id: pk(),
    tenantId: tenantId(),
    /** 1, 2, 3 … per shop; `number` is "ENQ-0001". */
    enquiryNo: integer("enquiry_no").notNull(),
    number: text("number").notNull(),
    name: text("name").notNull(),
    /** E.164 ("+919876543210"). */
    phone: text("phone").notNull(),
    email: text("email"),
    /** What the form is about, set by the shop on the form ("Admission 2027-28"). */
    topic: text("topic"),
    /** The person the enquiry is for (a school's student), when the form asks. */
    studentName: text("student_name"),
    /** The choice on the form's list ("Class 1"), when it has one. */
    option: text("option"),
    message: text("message"),
    /** Store page the form was sent from ("/admissions"). */
    source: text("source"),
    /** Privacy notice the visitor accepted ("notice-v3"), when the store knew it. */
    noticeVersion: text("notice_version"),
    status: text("status").$type<EnquiryStatus>().notNull().default("new"),
    /** Staff's own note (call outcome, visit date); never shown to the visitor. */
    note: text("note"),
    /** First time the status left `new`. */
    contactedAt: timestamp("contacted_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    unique("enquiries_tenant_no_uq").on(t.tenantId, t.enquiryNo),
    index("enquiries_tenant_created_idx").on(t.tenantId, t.createdAt),
    index("enquiries_tenant_status_idx").on(t.tenantId, t.status),
    index("enquiries_tenant_phone_idx").on(t.tenantId, t.phone),
  ],
);

export type EnquiryRow = typeof enquiries.$inferSelect;
