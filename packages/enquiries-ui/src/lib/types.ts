export const ENQUIRY_STATUSES = ["new", "contacted", "follow_up", "converted", "closed"] as const;
export type EnquiryStatus = (typeof ENQUIRY_STATUSES)[number];

export interface Enquiry {
  id: string;
  /** "ENQ-0007" */
  number: string;
  name: string;
  /** E.164 */
  phone: string;
  email: string | null;
  topic: string | null;
  studentName: string | null;
  option: string | null;
  message: string | null;
  /** The website page the form was on. */
  source: string | null;
  noticeVersion: string | null;
  status: EnquiryStatus;
  note: string | null;
  contactedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EnquiriesSummary {
  open: number;
  today: number;
  last7Days: number;
  converted30Days: number;
}
