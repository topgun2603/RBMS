import sharp from "sharp";
import { modelInstalled, modelPath, type SegModel } from "./models";
import { normaliseScores, type Alpha } from "./mask";

/** A decoded picture: 8-bit RGB, 3 bytes per pixel. */
export interface RgbImage {
  data: Buffer;
  width: number;
  height: number;
}

/** Anything that can say which pixels are the product. The real one runs an ONNX model; tests pass a stub. */
export interface Segmenter {
  readonly id: string;
  /** An alpha mask the same size as the input (0 background .. 255 product). */
  segment(img: RgbImage): Promise<Alpha>;
}

export class ModelNotInstalledError extends Error {
  readonly code = "image_model_missing";
  constructor(readonly model: string) {
    super(`The image cleanup model "${model}" is not installed. Run: pnpm --filter @srirealtime/ai models:download`);
  }
}

/** Builds the network input: resize to the square the model expects, divide by the max pixel, normalise, channel-first. */
export async function preprocess(img: RgbImage, m: Pick<SegModel, "size" | "mean" | "std">): Promise<Float32Array> {
  const raw = await sharp(img.data, { raw: { width: img.width, height: img.height, channels: 3 } })
    .resize(m.size, m.size, { fit: "fill", kernel: "lanczos3" })
    .raw()
    .toBuffer();
  const plane = m.size * m.size;
  let max = 1e-6;
  for (let i = 0; i < raw.length; i++) if (raw[i]! > max) max = raw[i]!;
  const out = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    for (let c = 0; c < 3; c++) out[c * plane + i] = (raw[i * 3 + c]! / max - m.mean[c]!) / m.std[c]!;
  }
  return out;
}

/** Scales a model-size mask back to the picture's size. */
export async function upscaleMask(mask: Uint8Array, from: number, width: number, height: number): Promise<Alpha> {
  const data = await sharp(Buffer.from(mask), { raw: { width: from, height: from, channels: 1 } })
    .resize(width, height, { fit: "fill", kernel: "cubic" })
    .extractChannel(0)
    .raw()
    .toBuffer();
  return { data: new Uint8Array(data.buffer, data.byteOffset, data.length), width, height };
}

type OrtModule = typeof import("onnxruntime-node");
type OrtSession = Awaited<ReturnType<OrtModule["InferenceSession"]["create"]>>;

/** onnxruntime-node (MIT) running a U2-Net / IS-Net style salient-object model on the CPU. The session is created once. */
export class OnnxSegmenter implements Segmenter {
  readonly id: string;
  private session: Promise<{ ort: OrtModule; s: OrtSession }> | null = null;
  /** Inference runs one at a time per process: the CPU threads are already busy and memory stays flat. */
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly model: SegModel,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {
    this.id = model.id;
  }

  private open() {
    if (!this.session) {
      if (!modelInstalled(this.model, this.env)) throw new ModelNotInstalledError(this.model.id);
      this.session = (async () => {
        const ort = await import("onnxruntime-node");
        const s = await ort.InferenceSession.create(modelPath(this.model, this.env), { executionProviders: ["cpu"], graphOptimizationLevel: "all" });
        return { ort, s };
      })();
      this.session.catch(() => {
        this.session = null;
      });
    }
    return this.session;
  }

  segment(img: RgbImage): Promise<Alpha> {
    const run = async (): Promise<Alpha> => {
      const { ort, s } = await this.open();
      const input = await preprocess(img, this.model);
      const tensor = new ort.Tensor("float32", input, [1, 3, this.model.size, this.model.size]);
      const out = await s.run({ [s.inputNames[0]!]: tensor });
      const first = out[s.outputNames[0]!]!;
      const mask = normaliseScores(first.data as Float32Array);
      return upscaleMask(mask, this.model.size, img.width, img.height);
    };
    const next = this.chain.then(run, run);
    this.chain = next.catch(() => undefined);
    return next;
  }
}
