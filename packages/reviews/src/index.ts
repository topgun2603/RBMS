import { defineModule } from "@rbms/core";
import { REVIEW_FEATURES, REVIEW_PERMISSIONS } from "./features";
import { reviewsRoutes } from "./routes";
import { productReviews, reviewVotes } from "./schema";
import { ReviewsService, type ReviewsDeps } from "./service";

export * from "./schema";
export * from "./logic";
export * from "./ports";
export * from "./service";
export * from "./features";
export * from "./staff";
export { reviewsRoutes } from "./routes";

/**
 * Product reviews at `/v1/reviews`: shopper reviews (one per product, verified buyers), moderation, shop replies,
 * helpful votes and rating summaries. `ratingsPort` is the catalogue's `RatingsPort` (search `sort=rating`).
 */
export function createReviews(deps: ReviewsDeps) {
  const service = new ReviewsService(deps);
  const module = defineModule({
    id: "reviews",
    tables: { productReviews, reviewVotes },
    routes: reviewsRoutes(service),
    features: REVIEW_FEATURES,
    permissions: REVIEW_PERMISSIONS,
  });
  return {
    service,
    module,
    /** Pass as `ratings` to createCatalogue. */
    ratingsPort: { ratings: (tenantId: string, productIds: string[]) => service.ratings(tenantId, productIds) },
  };
}
