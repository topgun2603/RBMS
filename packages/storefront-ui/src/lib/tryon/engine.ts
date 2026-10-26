/**
 * Browser side of "Try it on": loads MediaPipe Face Landmarker (@mediapipe/tasks-vision, Apache-2.0) from the store's own
 * static path (`/tryon/wasm` and `/tryon/face_landmarker.task`, put there by apps/store/scripts/tryon-assets.mjs) and draws the
 * overlays. Imported lazily, only when a shopper taps "Try it on". Nothing here sends a camera frame or a photo anywhere.
 */
import type { FaceLandmarker } from "@mediapipe/tasks-vision";
import { drawParams, type ImageSize, type Landmark, type Overlay } from "./transform";

export const TRYON_BASE = "/tryon";

export type LandmarkerMode = "VIDEO" | "IMAGE";

/** Creates the landmarker (GPU first, CPU if that fails). Throws if the assets are missing. */
export async function createLandmarker(mode: LandmarkerMode): Promise<FaceLandmarker> {
  const { FaceLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");
  const fileset = await FilesetResolver.forVisionTasks(`${TRYON_BASE}/wasm`);
  const make = (delegate: "GPU" | "CPU") =>
    FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: `${TRYON_BASE}/face_landmarker.task`, delegate },
      runningMode: mode,
      numFaces: 1,
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: false,
    });
  try {
    return await make("GPU");
  } catch {
    return await make("CPU");
  }
}

/** Is the try-on model installed on this store (a cheap HEAD)? The button is hidden when not. */
export async function assetsInstalled(): Promise<boolean> {
  try {
    const r = await fetch(`${TRYON_BASE}/face_landmarker.task`, { method: "HEAD" });
    return r.ok;
  } catch {
    return false;
  }
}

/** The product image as a same-origin bitmap (through the store's /api proxy), so the canvas is never tainted and can be saved. */
export async function loadProductBitmap(url: string): Promise<ImageBitmap> {
  let src = url;
  try {
    const u = new URL(url, window.location.origin);
    if (u.origin !== window.location.origin && u.pathname.startsWith("/v1/")) src = `${window.location.origin}/api${u.pathname}`;
  } catch {
    /* keep the url as given */
  }
  const res = await fetch(src, { credentials: "omit" });
  if (!res.ok) throw new Error(`image ${res.status}`);
  return createImageBitmap(await res.blob());
}

/** Draws the overlays over whatever is already on the canvas. */
export function drawOverlays(ctx: CanvasRenderingContext2D, bitmap: ImageBitmap, overlays: readonly Overlay[]): void {
  const size: ImageSize = { w: bitmap.width, h: bitmap.height };
  for (const o of overlays) {
    const p = drawParams(o, size);
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, o.alpha));
    ctx.translate(p.tx, p.ty);
    ctx.rotate(p.rotation);
    ctx.scale(p.scale, p.scale);
    ctx.drawImage(bitmap, p.dx, p.dy, p.w, p.h);
    ctx.restore();
  }
}

/** First face's landmarks from a result, or null. */
export const firstFace = (r: { faceLandmarks?: Landmark[][] } | undefined): Landmark[] | null => r?.faceLandmarks?.[0] ?? null;
