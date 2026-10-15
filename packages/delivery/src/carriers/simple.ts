import { randomDigits } from "@srirealtime/core";
import { STATUS_LABELS } from "./status";
import { CarrierError, type CarrierDriver, type CreateShipmentInput, type CreatedShipment } from "./types";

/** Staff ship themselves (local courier, India Post …) and type in the courier, AWB and tracking URL. */
export class ManualDriver implements CarrierDriver {
  readonly provider = "manual" as const;

  async createShipment(input: CreateShipmentInput): Promise<CreatedShipment> {
    const courier = input.courier?.trim();
    const awb = input.awb?.trim();
    if (!courier || !awb) throw new CarrierError("manual", 400, "Enter the courier name and AWB / tracking number");
    return {
      providerOrderId: null,
      providerShipmentId: null,
      awb,
      courier,
      trackingUrl: input.trackingUrl?.trim() || null,
      labelUrl: null,
      // Staff record a manual shipment once the parcel is handed over, so it counts as shipped right away.
      status: "in_transit",
      cost: null,
      events: [{ at: input.now.toISOString(), status: "in_transit", label: `Handed over to ${courier}`, source: "staff" }],
    };
  }

  async cancel(): Promise<void> {}

  async track() {
    return { status: null, events: [] };
  }

  async label(): Promise<string | null> {
    return null;
  }
}

export const MOCK_COURIER = "Mock Express";

/** Development carrier: instant AWB; staff step it through the statuses with `POST /shipments/:id/mock-advance`. */
export class MockDriver implements CarrierDriver {
  readonly provider = "mock" as const;

  async createShipment(input: CreateShipmentInput): Promise<CreatedShipment> {
    const awb = `MOCK${randomDigits(10)}`;
    return {
      providerOrderId: `mock-order-${input.order.id.slice(0, 8)}`,
      providerShipmentId: `mock-${awb}`,
      awb,
      courier: MOCK_COURIER,
      trackingUrl: null,
      labelUrl: null,
      status: "created",
      cost: 0,
      events: [{ at: input.now.toISOString(), status: "created", label: STATUS_LABELS.created, source: "mock" }],
    };
  }

  async cancel(): Promise<void> {}

  async track() {
    return { status: null, events: [] };
  }

  async label(): Promise<string | null> {
    return null;
  }
}
