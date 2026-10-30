import { defineModule } from "@rbms/core";
import type { Db } from "@rbms/db";
import { uploadsRoutes } from "./routes";
import { files } from "./schema";
import { UploadsService, type LoggerPort, type UploadsConfig } from "./service";

export interface UploadsDeps {
  db: Db;
  config: UploadsConfig;
  log?: LoggerPort;
}

/**
 * Storage adapters: S3Storage (AWS S3 / Cloudflare R2) and LocalStorage (dev).
 * A Firebase Storage adapter is planned: implement `StorageAdapter` (see ./storage/types) and pass it as `config.storage`.
 */
export function createUploads(deps: UploadsDeps) {
  const service = new UploadsService(deps.db, deps.config, deps.log);
  const module = defineModule({
    id: "uploads",
    tables: { files },
    routes: uploadsRoutes(service),
  });
  return { service, module };
}

export * from "./schema";
export { UploadsService, DEFAULT_MAX_BYTES, DEFAULT_VIDEO_MAX_BYTES, THUMBNAIL_MAX_BYTES, decodeCursor, encodeCursor } from "./service";
export type { FileDto, FilePage, ListInput, LoggerPort, SignInput, SignResult, UploadsConfig } from "./service";
export type { StorageAdapter } from "./storage/types";
export { S3Storage, contentDisposition, type S3StorageConfig } from "./storage/s3";
export {
  LocalStorage,
  assertValidKey,
  isValidKey,
  signLocal,
  verifyLocalSignature,
  type LocalStorageConfig,
  type SignedMethod,
} from "./storage/local";
export {
  DEFAULT_ALLOWED_TYPES,
  buildKey,
  extFor,
  isAllowedType,
  normalizeType,
  sanitizeFilename,
  thumbKeyFor,
  withExtension,
} from "./keys";
export { STAFF_ROLES, byteRange, listQuery, uploadsRoutes } from "./routes";
export { rasterizeSvg, shrinkForVision } from "./images";
export { composeSocialImage, wrapLines, hexOr, inkOn, luminance, type SocialImageInput } from "./social-image";
