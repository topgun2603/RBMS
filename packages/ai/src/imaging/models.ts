import { existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The background-removal models the image cleanup can run. Weights are NOT in git: `pnpm --filter @srirealtime/ai models:download`
 * fetches them into a git-ignored folder (`AI_MODELS_DIR`, default `<repo>/.models`) and checks the SHA-256 below.
 *
 * Licences (docs/ai.md "Phase 4 part C"): U2-Net is by Xuebin Qin et al. and published under Apache-2.0 (repo LICENSE); the ONNX
 * conversions come from the MIT-licensed rembg release assets. onnxruntime is MIT. IS-Net/DIS "general use" is deliberately NOT
 * offered: it is trained on DIS5K, whose terms forbid commercial use.
 */
export interface SegModel {
  id: "u2netp" | "u2net";
  file: string;
  url: string;
  sha256: string;
  bytes: number;
  /** Square network input size. */
  size: number;
  mean: [number, number, number];
  std: [number, number, number];
  label: string;
  licence: string;
  source: string;
}

const REL = "https://github.com/danielgatis/rembg/releases/download/v0.0.0";

export const SEG_MODELS: readonly SegModel[] = [
  {
    id: "u2netp",
    file: "u2netp.onnx",
    url: `${REL}/u2netp.onnx`,
    sha256: "309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8",
    bytes: 4574861,
    size: 320,
    mean: [0.485, 0.456, 0.406],
    std: [0.229, 0.224, 0.225],
    label: "U2-Net small (4.6 MB, fast)",
    licence: "Apache-2.0",
    source: "https://github.com/xuebinqin/U-2-Net",
  },
  {
    id: "u2net",
    file: "u2net.onnx",
    url: `${REL}/u2net.onnx`,
    sha256: "8d10d2f3bb75ae3b6d527c77944fc5e7dcd94b29809d47a739a7a728a912b491",
    bytes: 175997641,
    size: 320,
    mean: [0.485, 0.456, 0.406],
    std: [0.229, 0.224, 0.225],
    label: "U2-Net (176 MB)",
    licence: "Apache-2.0",
    source: "https://github.com/xuebinqin/U-2-Net",
  },
];

export const DEFAULT_SEG_MODEL: SegModel["id"] = "u2net";

export const segModel = (id: string): SegModel | undefined => SEG_MODELS.find((m) => m.id === id);

/** The folder holding the weights: env AI_MODELS_DIR, else `<repo>/.models` (this file is packages/ai/src/imaging). */
export function modelsDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.AI_MODELS_DIR?.trim()) return resolve(env.AI_MODELS_DIR.trim());
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.models");
}

export const modelPath = (m: SegModel, env: NodeJS.ProcessEnv = process.env): string => join(modelsDir(env), m.file);

/** Is the weights file there with the right size (a cheap check; the download script verifies the hash)? */
export function modelInstalled(m: SegModel, env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    const p = modelPath(m, env);
    return existsSync(p) && statSync(p).size === m.bytes;
  } catch {
    return false;
  }
}

/** The model the shop's server uses: env IMAGE_CLEANUP_MODEL when valid, else the default. */
export function configuredModel(env: NodeJS.ProcessEnv = process.env): SegModel {
  return segModel(env.IMAGE_CLEANUP_MODEL?.trim() ?? "") ?? segModel(DEFAULT_SEG_MODEL)!;
}
