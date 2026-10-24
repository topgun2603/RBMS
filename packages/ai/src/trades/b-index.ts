import { defineModule, type SrModule } from "@srirealtime/core";
import type { Db } from "@srirealtime/db";
import type { AiService } from "../service";
import { aiPhotoBatches, aiProductTags } from "../schema";
import { tradesBRoutes, type TradesBPorts } from "./b-routes";
import { CATALOGUE_PHOTOS_JOB, PhotoBatchService, type PhotoJobPayload } from "./catalogue/service";
import { TAGS_JOB, TagService, type TagDeps, type TagJobPayload } from "./textiles/service";

export * from "./b-common";
export * from "./b-routes";
export * from "./catalogue/photos";
export * from "./catalogue/service";
export * from "./textiles/tags";
export * from "./textiles/service";
export * from "./jewellery/huid";
export * from "./jewellery/breakup";

export interface AiTradesBDeps {
  db: Db;
  ai: AiService;
  ports: TradesBPorts;
  tagPorts: TagDeps["ports"];
  enqueuePhotos?: (payload: PhotoJobPayload) => Promise<void>;
  enqueueTags?: (payload: TagJobPayload) => Promise<void>;
  log?: { warn(o: object, m?: string): void };
}

/**
 * Phase 3 part B (docs/ai.md): catalogue from photos, product pack identify at the counter, textile photo tags, jewellery HUID
 * and price breakup. Mount `module` (routes at /v1/ai/trade); `photos.process` and `tags.process` are the bodies of the
 * `ai.catalogue-photos` and `ai.product-tags` jobs.
 */
export function createAiTradesB(deps: AiTradesBDeps) {
  const photos = new PhotoBatchService({ db: deps.db, ai: deps.ai, ports: deps.ports, enqueue: deps.enqueuePhotos, log: deps.log });
  const tags = new TagService({ db: deps.db, ai: deps.ai, ports: deps.tagPorts, enqueue: deps.enqueueTags, log: deps.log });
  const module: SrModule = defineModule({
    id: "ai/trade",
    tables: { aiPhotoBatches, aiProductTags },
    routes: tradesBRoutes({ ai: deps.ai, photos, tags, ports: deps.ports }),
  });
  return { module, photos, tags, jobs: { photos: CATALOGUE_PHOTOS_JOB, tags: TAGS_JOB } };
}
