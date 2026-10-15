import type { FulfillmentOrder } from "../ports";
import type { CarrierProvider, PackageDims, ShipmentEvent, ShipmentStatus } from "../schema";

export interface CreateShipmentInput {
  order: FulfillmentOrder;
  package: PackageDims;
  /** Manual: courier name. Shiprocket: optional numeric courier company id (else Shiprocket picks). */
  courier?: string | null;
  /** Manual only. */
  awb?: string | null;
  /** Manual only. */
  trackingUrl?: string | null;
  now: Date;
}

export interface CreatedShipment {
  providerOrderId: string | null;
  providerShipmentId: string | null;
  awb: string | null;
  courier: string | null;
  trackingUrl: string | null;
  labelUrl: string | null;
  status: ShipmentStatus;
  /** Paise, when known. */
  cost: number | null;
  events: ShipmentEvent[];
}

/** What drivers get back for an existing shipment. */
export interface ShipmentRef {
  providerOrderId: string | null;
  providerShipmentId: string | null;
  awb: string | null;
  status: ShipmentStatus;
}

export interface TrackResult {
  /** Latest status in our terms; null = unknown / no change. */
  status: ShipmentStatus | null;
  events: ShipmentEvent[];
  courier?: string | null;
  trackingUrl?: string | null;
}

/** One carrier integration. Instances are per tenant (they hold the shop's credentials). */
export interface CarrierDriver {
  readonly provider: CarrierProvider;
  createShipment(input: CreateShipmentInput): Promise<CreatedShipment>;
  cancel(ref: ShipmentRef): Promise<void>;
  track(ref: ShipmentRef, now: Date): Promise<TrackResult>;
  /** URL of a printable label (generated on demand when needed); null when the carrier has none. */
  label(ref: ShipmentRef): Promise<string | null>;
}

/** A carrier refused or failed a request; the service turns it into 502 `carrier_error` (or 400 for bad credentials). */
export class CarrierError extends Error {
  constructor(
    readonly provider: CarrierProvider,
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "CarrierError";
  }
}
