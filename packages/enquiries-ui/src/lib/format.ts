import type { StatusTone } from "@rbms/ui";
import type { EnquiryStatus } from "./types";

export const STATUS_TONE: Record<EnquiryStatus, StatusTone> = { new: "brand", contacted: "info", follow_up: "warning", converted: "success", closed: "neutral" };

/** "+919876543210" → "98765 43210" (other formats unchanged). */
export function phoneLabel(phone: string | null | undefined): string {
  if (!phone) return "";
  const m = phone.match(/^\+91(\d{5})(\d{5})$/);
  return m ? `${m[1]} ${m[2]}` : phone;
}

/** WhatsApp link from an E.164 number ("+919876543210" → https://wa.me/919876543210). */
export const whatsappUrl = (phone: string) => `https://wa.me/${phone.replace(/\D/g, "")}`;

export const telUrl = (phone: string) => `tel:${phone.replace(/[^\d+]/g, "")}`;

/** Message key and count for "5 min ago" style times. */
export function ago(iso: string, now = Date.now()): { key: "justNow" | "minutes" | "hours" | "days"; count: number } | null {
  const ms = now - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return null;
  const min = Math.floor(ms / 60_000);
  if (min < 1) return { key: "justNow", count: 0 };
  if (min < 60) return { key: "minutes", count: min };
  if (min < 24 * 60) return { key: "hours", count: Math.floor(min / 60) };
  const days = Math.floor(min / (24 * 60));
  return days < 7 ? { key: "days", count: days } : null;
}

/** What an enquiry is about: "Admission 2027-28 · Class 1 · Kavin". */
export const aboutLine = (e: { topic: string | null; option: string | null; studentName: string | null }) => [e.topic, e.option, e.studentName].filter(Boolean).join(" · ");
