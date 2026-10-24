import type { HookId } from "../profiles";
import type { IndustryHook } from "../context";
import { kiranaHook } from "./kirana";
import { bookingsHook } from "./bookings";
import { electronicsHook } from "./electronics";
import { jewelleryHook } from "./jewellery";
import { jobcardsHook } from "./jobcards";
import { pharmacyHook } from "./pharmacy";
import { restaurantHook } from "./restaurant";

/** Trades with no special flow (textiles, hardware, services) use the engine's standard billing. */
const noneHook: IndustryHook = { id: "none" };

const HOOKS: Record<HookId, IndustryHook> = {
  kirana: kiranaHook,
  pharmacy: pharmacyHook,
  restaurant: restaurantHook,
  jewellery: jewelleryHook,
  jobcards: jobcardsHook,
  bookings: bookingsHook,
  electronics: electronicsHook,
  none: noneHook,
};

export const hookFor = (id: HookId): IndustryHook => HOOKS[id];
