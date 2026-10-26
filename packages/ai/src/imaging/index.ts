import { defineModule, type SrModule } from "@srirealtime/core";
import { aiImageCleanups, aiTryons } from "../schema";
import { imagingRoutes } from "./routes";
import { ImagingService, type ImagingDeps } from "./service";
import type { AiService } from "../service";

export * from "./models";
export * from "./mask";
export * from "./layout";
export * from "./segment";
export * from "./cleanup";
export * from "./tryon";
export * from "./service";
export { imagingRoutes, IMAGING_PERMISSIONS } from "./routes";

export interface AiImagingDeps extends ImagingDeps {
  ai: AiService;
}

/**
 * Phase 4 part C (docs/ai.md): product photo cleanup (background removal on our own server, onnxruntime + U2-Net) and the
 * try-on setup behind the store's "Try it on". Mount `module` (routes at /v1/ai/imaging); `imaging.process` is the body of
 * the `ai.image-cleanup` job.
 */
export function createAiImaging(deps: AiImagingDeps) {
  const imaging = new ImagingService(deps);
  const module: SrModule = defineModule({
    id: "ai/imaging",
    tables: { aiImageCleanups, aiTryons },
    routes: imagingRoutes({ ai: deps.ai, imaging }),
  });
  return { module, imaging };
}
