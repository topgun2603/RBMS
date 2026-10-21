import type { AggregatorProvider, ProviderId } from "../types";
import { manualProvider } from "./manual";
import { urbanPiperProvider } from "./urbanpiper";

export { urbanPiperProvider, URBANPIPER_BASE_URL } from "./urbanpiper";
export { manualProvider, createManualProvider, type ManualWebhook } from "./manual";

/** Every provider by id. Add a connector here (and to PROVIDERS) to support another aggregator. */
export const DEFAULT_PROVIDERS: Record<ProviderId, AggregatorProvider> = {
  urbanpiper: urbanPiperProvider,
  manual: manualProvider,
};
