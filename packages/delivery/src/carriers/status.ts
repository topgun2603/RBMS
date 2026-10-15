import type { ShipmentEvent, ShipmentStatus } from "../schema";

/** The normal forward path. `rto` and `cancelled` are side exits. */
export const STATUS_FLOW: readonly ShipmentStatus[] = ["created", "pickup_scheduled", "in_transit", "out_for_delivery", "delivered"];

export const TERMINAL_STATUSES: readonly ShipmentStatus[] = ["delivered", "rto", "cancelled"];
export const OPEN_STATUSES: readonly ShipmentStatus[] = ["created", "pickup_scheduled", "in_transit", "out_for_delivery"];

export const isTerminal = (s: ShipmentStatus) => TERMINAL_STATUSES.includes(s);

/** Statuses at which the parcel has left the shop (the order counts as shipped). */
export const isShippedStatus = (s: ShipmentStatus) => s === "in_transit" || s === "out_for_delivery" || s === "delivered";

/**
 * Whether a shipment may move `from` → `to`. Forward only along STATUS_FLOW (so replayed or out-of-order carrier
 * events never move it back); `rto` / `cancelled` from any open status; terminal statuses never change.
 */
export function canTransition(from: ShipmentStatus, to: ShipmentStatus): boolean {
  if (from === to || isTerminal(from)) return false;
  if (to === "rto" || to === "cancelled") return true;
  return STATUS_FLOW.indexOf(to) > STATUS_FLOW.indexOf(from);
}

/** Mock carrier: the next status on the happy path, null once delivered (or terminal). */
export function nextMockStatus(s: ShipmentStatus): ShipmentStatus | null {
  if (isTerminal(s)) return null;
  const i = STATUS_FLOW.indexOf(s);
  return STATUS_FLOW[i + 1] ?? null;
}

export const STATUS_LABELS: Readonly<Record<ShipmentStatus, string>> = {
  created: "Shipment created",
  pickup_scheduled: "Pickup scheduled",
  in_transit: "In transit",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  rto: "Returning to shop",
  cancelled: "Cancelled",
};

const MAX_EVENTS = 100;

/** Appends carrier events that aren't there yet (same time + label), keeps them sorted by time, newest last, capped. */
export function mergeEvents(existing: readonly ShipmentEvent[], incoming: readonly ShipmentEvent[]): ShipmentEvent[] {
  const key = (e: ShipmentEvent) => `${e.at}|${e.label}`;
  const seen = new Set(existing.map(key));
  const out = [...existing];
  for (const e of incoming) {
    if (seen.has(key(e))) continue;
    seen.add(key(e));
    out.push(e);
  }
  out.sort((a, b) => a.at.localeCompare(b.at));
  return out.slice(-MAX_EVENTS);
}

// ------------------------------------------------------------------ Shiprocket status mapping

/** Shiprocket `shipment_status` / `sr-status` codes we are sure about. Unknown codes fall back to the label. */
const SHIPROCKET_CODES: Readonly<Record<number, ShipmentStatus | null>> = {
  1: "created", // AWB assigned
  2: "created", // label generated
  3: "pickup_scheduled", // pickup scheduled / generated
  4: "pickup_scheduled", // pickup queued
  5: "created", // manifest generated
  6: "in_transit", // shipped
  7: "delivered",
  8: "cancelled",
  9: "rto", // RTO initiated
  10: "rto", // RTO delivered
  12: null, // lost
  13: "pickup_scheduled", // pickup error
  14: "rto", // RTO acknowledged
  15: "pickup_scheduled", // pickup rescheduled
  16: null, // cancellation requested
  17: "out_for_delivery",
  18: "in_transit",
  19: "pickup_scheduled", // out for pickup
  20: "pickup_scheduled", // pickup exception
  21: "in_transit", // undelivered (NDR)
  22: "in_transit", // delayed
  26: "delivered", // fulfilled
  38: "in_transit", // reached destination hub
  39: "in_transit", // misrouted
  40: "rto", // RTO NDR
  41: "rto", // RTO out for delivery
  42: "in_transit", // picked up
  43: "delivered", // self fulfilled
  45: "cancelled", // cancelled before dispatch
  46: "rto", // RTO in transit
  48: "in_transit", // reached warehouse
  50: "in_transit", // in flight
  51: "in_transit", // handed over to courier
  52: "created", // shipment booked
};

/**
 * Shiprocket status label ("IN TRANSIT", "Out For Delivery", "RTO Initiated", "PICKED UP" …) and/or numeric code → ours.
 * The label wins when it is recognisable; null = no matching status of ours (lost, damaged, unknown) → leave as is.
 */
export function mapShiprocketStatus(label: unknown, code?: unknown): ShipmentStatus | null {
  const fromLabel = mapShiprocketLabel(typeof label === "string" ? label : "");
  if (fromLabel !== undefined) return fromLabel;
  const n = typeof code === "number" ? code : typeof code === "string" && /^\d+$/.test(code.trim()) ? Number(code) : NaN;
  if (Number.isFinite(n) && n in SHIPROCKET_CODES) return SHIPROCKET_CODES[n] ?? null;
  return null;
}

/** undefined = label not recognised (try the code). */
function mapShiprocketLabel(raw: string): ShipmentStatus | null | undefined {
  const s = raw.toUpperCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return undefined;
  if (/\bRTO\b|RETURN TO ORIGIN|RETURNED TO ORIGIN/.test(s)) return "rto";
  if (s.includes("CANCELLATION REQUESTED")) return null;
  if (s.includes("CANCEL")) return "cancelled";
  if (/\b(LOST|DAMAGED|DESTROYED|DISPOSED)\b/.test(s)) return null;
  if (s.includes("OUT FOR DELIVERY")) return "out_for_delivery";
  if (s.includes("UNDELIVERED") || s.includes("NOT DELIVERED")) return "in_transit";
  if (s.includes("DELIVERED") || s.includes("FULFILLED")) return "delivered";
  if (s.includes("PICKED UP") || s.includes("PICKUP DONE")) return "in_transit";
  if (s.includes("PICKUP")) return "pickup_scheduled";
  if (/IN TRANSIT|SHIPPED|REACHED|HUB|DESTINATION|DELAYED|MISROUTED|IN FLIGHT|HANDOVER|HANDED OVER|DISPATCHED/.test(s))
    return "in_transit";
  if (/AWB ASSIGNED|LABEL GENERATED|MANIFEST|SHIPMENT BOOKED|^NEW$|READY TO SHIP|INVOICED/.test(s)) return "created";
  return undefined;
}

/** "2023-05-19 11:59:16" / "23 05 2023 11:43:52" / ISO → ISO; Shiprocket times without a zone are IST. */
export function parseCarrierTime(value: unknown, fallback: Date): string {
  if (typeof value === "string") {
    const s = value.trim();
    let m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s);
    if (m) return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? "00"}+05:30`).toISOString();
    m = /^(\d{2})[ /-](\d{2})[ /-](\d{4})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s);
    if (m) return new Date(`${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6] ?? "00"}+05:30`).toISOString();
    const d = new Date(s);
    if (s && !Number.isNaN(d.getTime())) return d.toISOString();
  }
  return fallback.toISOString();
}
