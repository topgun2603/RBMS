import { defineModule } from "@srirealtime/core";
import { paymentsRoutes } from "./routes";
import { paymentAccounts, paymentEvents, paymentOrders } from "./schema";
import { PAYMENTS_FEATURE, PaymentsService, type PaymentsDeps } from "./service";

export * from "./schema";
export * from "./ports";
export * from "./service";
export * from "./logic";
export * from "./crypto";
export * from "./signature";
export * from "./razorpay";
export { paymentsRoutes } from "./routes";

/** Online collection through each shop's own Razorpay account (plus a mock provider for development). */
export function createPayments(deps: PaymentsDeps) {
  const service = new PaymentsService(deps);
  const module = defineModule({
    id: "payments",
    tables: { paymentAccounts, paymentOrders, paymentEvents },
    routes: paymentsRoutes(service),
    features: [
      {
        key: PAYMENTS_FEATURE,
        module: "payments",
        label: "Online payments (Razorpay)",
        description: "Customers pay bills online by UPI, card or net banking through the shop's Razorpay account.",
        shopToggle: true,
      },
    ],
  });
  return { service, module };
}
