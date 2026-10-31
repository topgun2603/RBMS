/** Response shapes of the srikit HTTP API (/v1) used by the billing app. Money is integer paise. */
import type { GstRate, InvoiceTotals, LineInput, LineTotals } from "@rbms/gst";

export type { GstRate, InvoiceTotals, LineInput, LineTotals };

export type ISODate = string;

export interface User {
  id: string;
  phone: string | null;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
  locale: string;
  platformRoles: string[];
  status: "active" | "disabled" | "deleted";
  createdAt: ISODate;
}

export interface MeResponse {
  user: User;
  tenantRoles: string[];
}

export interface OtpRequestResponse {
  /** Masked for display ("+91******3210"). Never send it back to /otp/verify. */
  target: string;
  channel: "sms" | "whatsapp" | "email";
  expiresInSeconds: number;
  resendInSeconds: number;
}

export interface SignInResponse {
  token: string;
  expiresAt: ISODate;
  user: User;
  isNewUser: boolean;
}

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  appId: string | null;
  status: "active" | "suspended";
}

export interface BrandTokens {
  colors: { primary: string; secondary?: string; accent?: string; background?: string; foreground?: string };
  radius: number;
  fontSans: string;
  fontHeading?: string;
  mode: "light" | "dark" | "system";
}

export interface Branding {
  appName: string | null;
  logoUrl: string | null;
  logoDarkUrl?: string | null;
  faviconUrl?: string | null;
  tokens?: BrandTokens;
  css: string;
}

export interface Paged<T> {
  items: T[];
  total: number;
}

/** `billing` settings namespace: the seller block printed on invoices. */
export interface SellerProfile {
  legalName: string;
  gstin: string;
  address: string;
  city: string;
  pincode: string;
  stateCode: string;
  phone: string;
  email: string;
  invoicePrefix: string;
  terms: string;
  bankName: string;
  accountNumber: string;
  ifsc: string;
  upiId: string;
}

export interface SettingsValues<T> {
  namespace: string;
  values: T;
}

export interface Customer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  address: string | null;
  stateCode: string | null;
  /** Paise: issued, unpaid. */
  outstanding: number;
  createdAt: ISODate;
}

export interface CustomerInput {
  name: string;
  phone?: string;
  email?: string;
  gstin?: string;
  address?: string;
  stateCode?: string;
}

export interface Item {
  id: string;
  name: string;
  hsn: string | null;
  unit: string | null;
  rate: number;
  gstRate: GstRate;
  createdAt: ISODate;
}

export interface ItemInput {
  name: string;
  hsn?: string;
  unit?: string;
  rate: number;
  gstRate: GstRate;
}

export type InvoiceStatus = "draft" | "issued" | "partially_paid" | "paid" | "cancelled";
export const INVOICE_STATUSES: InvoiceStatus[] = ["draft", "issued", "partially_paid", "paid", "cancelled"];

export type PaymentMethod = "cash" | "upi" | "card" | "bank" | "cheque" | "other";
export const PAYMENT_METHODS: PaymentMethod[] = ["cash", "upi", "card", "bank", "cheque", "other"];

export interface InvoiceSummary {
  id: string;
  number: string | null;
  status: InvoiceStatus;
  date: string;
  dueDate: string | null;
  customerName: string;
  total: number;
  paid: number;
  balance: number;
  isOverdue: boolean;
}

export interface InvoiceParty {
  name: string;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  address: string | null;
  stateCode: string | null;
}

export interface Payment {
  id?: string;
  amount: number;
  method: PaymentMethod;
  date: string;
  reference: string | null;
  createdAt: ISODate;
}

export interface Invoice extends InvoiceSummary {
  customerId: string | null;
  customer: InvoiceParty;
  seller: Partial<SellerProfile>;
  placeOfSupply: string;
  interState: boolean;
  lines: LineTotals[];
  totals: Omit<InvoiceTotals, "lines">;
  amountInWords: string;
  notes: string | null;
  payments: Payment[];
  shareToken: string | null;
  cancelledAt: ISODate | null;
  cancelReason: string | null;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface InvoiceSummaryResponse {
  month: { invoiced: number; collected: number; count: number };
  outstanding: number;
  overdueCount: number;
  recent: InvoiceSummary[];
}

export interface InvoiceInput {
  /** null on PATCH switches a draft to a walk-in customer. */
  customerId?: string | null;
  /** Walk-in buyer (not saved to the customer list). Empty strings are treated as missing. */
  customer?: { name: string; phone?: string; email?: string; gstin?: string; address?: string; stateCode?: string } | null;
  date: string;
  /** null clears it on PATCH. */
  dueDate?: string | null;
  placeOfSupply?: string;
  lines: LineInput[];
  notes?: string | null;
  issue?: boolean;
}

export interface PublicInvoiceResponse {
  invoice: Invoice;
  branding: { appName: string | null; logoUrl: string | null; css: string };
}
