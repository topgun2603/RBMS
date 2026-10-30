import { defineModule } from "@rbms/core";
import { aggregatorsRoutes } from "./routes";
import { aggregatorConnections, aggregatorItemMaps, aggregatorOrders } from "./schema";
import { AggregatorsService, type AggregatorsDeps } from "./service";

export * from "./types";
export * from "./schema";
export * from "./ports";
export * from "./gst";
export * from "./mapping";
export { drizzleStore, type AggregatorStore, type ConnectionPatch, type OrderPatch } from "./store";
export { DEFAULT_PROVIDERS, urbanPiperProvider, URBANPIPER_BASE_URL, manualProvider, createManualProvider, type ManualWebhook } from "./providers";
export { signBody, maskName, maskPhone } from "./parse";
export { AggregatorsService, AGGREGATORS_FEATURE, DEFAULT_PLATFORM } from "./service";
export type { AggregatorsConfig, AggregatorsDeps, ConnectionInput, ConnectionView, OrderView, PushResult } from "./service";
export { aggregatorsRoutes } from "./routes";

/**
 * Zomato / Swiggy / ONDC orders through an aggregator (UrbanPiper first, plus a manual/test provider): verified,
 * idempotent webhooks → normalized orders → menu mapping → dining orders and KOTs → accept / reject / ready /
 * dispatched reported back; menu and stock push; GST section 9(5) treatment and summary. The feature
 * (`dining.aggregators`) and permissions are dining's.
 */
export function createAggregators(deps: AggregatorsDeps) {
  const service = new AggregatorsService(deps);
  const module = defineModule({
    id: "aggregators",
    tables: { aggregatorConnections, aggregatorItemMaps, aggregatorOrders },
    routes: aggregatorsRoutes(service),
  });
  return { service, module };
}
