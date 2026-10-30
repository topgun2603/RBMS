import { imaging, type AiService } from "@rbms/ai";
import type { Db } from "@rbms/db";
import type { JobsService } from "@rbms/jobs";
import { allowedImageUrl } from "./kit-ai-trades-b";
import { AppError } from "@rbms/core";

/** The slice of the catalogue service photo cleanup uses. */
export interface ImagingCatalogue {
  getProduct(tenantId: string, id: string): Promise<{ id: string; name: string; images: { url: string; alt?: string | null }[] }>;
  updateProduct(tenantId: string, id: string, patch: { images: { url: string; alt?: string | null }[] }): Promise<unknown>;
}

export interface ImagingKitDeps {
  db: Db;
  ai: AiService;
  catalogue: ImagingCatalogue;
  uploads: { storeGenerated(i: { tenantId: string | null; filename: string; contentType: string; body: Buffer; visibility?: "public" | "private"; purpose?: string | null; userId?: string | null }): Promise<{ url: string }> };
  jobs: JobsService;
  /** Hosts the shop's own uploads are served from. Photos from elsewhere are never fetched. */
  uploadHosts: string[];
  production: boolean;
  /** How many photos one process cleans at once (the model itself runs one at a time). */
  concurrency?: number;
  fetchImpl?: typeof fetch;
  log: { warn(o: object, m?: string): void };
}

const MAX_BYTES = 25 * 1024 * 1024;

/** Phase 4 part C wiring (docs/ai.md): the segmenter, the ports over catalogue + uploads, the cleanup job and the module. */
export function createAiImagingKit(d: ImagingKitDeps) {
  const doFetch = d.fetchImpl ?? fetch;
  let cached: imaging.OnnxSegmenter | null = null;
  // Looked up on every call so installing the weights does not need a restart.
  const segmenter = (): imaging.Segmenter | null => {
    const m = imaging.configuredModel();
    if (!imaging.modelInstalled(m)) return null;
    if (!cached || cached.id !== m.id) cached = new imaging.OnnxSegmenter(m);
    return cached;
  };

  const ports: imaging.ImagingPorts = {
    async loadImage(tenantId, url) {
      const u = allowedImageUrl(url, tenantId, d.uploadHosts, d.production);
      if (!u) throw new AppError(422, "image_unavailable", "The photo is not stored in this shop's uploads.");
      const res = await doFetch(u, { redirect: "error", signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new AppError(422, "image_unavailable", "The photo could not be loaded.");
      if (!/^image\/(jpeg|png|webp|gif|avif)/.test(res.headers.get("content-type") ?? "")) throw new AppError(422, "image_unavailable", "The file is not a supported image.");
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > MAX_BYTES) throw new AppError(422, "image_unavailable", "The photo is too large.");
      return buf;
    },
    async store(tenantId, f) {
      const file = await d.uploads.storeGenerated({ tenantId, filename: f.filename, contentType: f.contentType, body: f.body, visibility: "public", purpose: "product-cleanup" });
      return { url: file.url };
    },
    async product(tenantId, id) {
      try {
        const p = await d.catalogue.getProduct(tenantId, id);
        return { id: p.id, name: p.name, images: p.images.map((i) => ({ url: i.url, alt: i.alt ?? null })) };
      } catch {
        return null;
      }
    },
    async setImages(tenantId, id, images) {
      await d.catalogue.updateProduct(tenantId, id, { images: images.map((i) => ({ url: i.url, alt: i.alt ?? null })) });
    },
    isOwnImage: (tenantId, url) => allowedImageUrl(url, tenantId, d.uploadHosts, d.production) !== null,
  };

  const kit = imaging.createAiImaging({
    db: d.db,
    ai: d.ai,
    ports,
    segmenter,
    modelId: () => imaging.configuredModel().id,
    enqueue: (payload) => d.jobs.enqueue(imaging.IMAGE_CLEANUP_JOB, payload),
    log: d.log,
  });
  d.jobs.define<imaging.CleanupJobPayload>(
    imaging.IMAGE_CLEANUP_JOB,
    async (data) => {
      await kit.imaging.process(data);
    },
    // A retry would charge again; a failed photo ends as "failed" and the owner can run it again.
    { attempts: 1, concurrency: d.concurrency ?? 2 },
  );
  return kit;
}
