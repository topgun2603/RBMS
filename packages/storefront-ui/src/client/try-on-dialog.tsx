"use client";

import * as React from "react";
import type { FaceLandmarker } from "@mediapipe/tasks-vision";
import { CameraIcon, DownloadIcon, ImageUpIcon, Loader2Icon, RotateCcwIcon, Share2Icon, SquareIcon } from "lucide-react";
import { Button } from "@srirealtime/ui/components/button";
import { createLandmarker, drawOverlays, firstFace, loadProductBitmap } from "../lib/tryon/engine";
import { fillText, tryonText } from "../lib/tryon/messages";
import { computeOverlays, smoothOverlay, type Overlay, type TryonAnchors, type TryonKind } from "../lib/tryon/transform";
import { useStore } from "./store-context";

type Step = "intro" | "starting" | "live" | "photo" | "snapshot";
type Problem = "denied" | "noCamera" | "failed" | "noFace" | "photoFailed" | null;

const MAX_SELFIE_EDGE = 1280;

/** The camera / selfie part of "Try it on". Everything runs in this browser tab: frames are read into a canvas, never sent. */
export function TryOnDialog({ spec, productName }: { spec: { kind: TryonKind; imageUrl: string; anchors: TryonAnchors }; productName: string }) {
  const { locale } = useStore();
  const tx = tryonText(locale);
  const [step, setStep] = React.useState<Step>("intro");
  const [problem, setProblem] = React.useState<Problem>(null);
  const [busy, setBusy] = React.useState(false);
  const [snap, setSnap] = React.useState<{ url: string; blob: Blob } | null>(null);
  const [saved, setSaved] = React.useState(false);

  const video = React.useRef<HTMLVideoElement>(null);
  const canvas = React.useRef<HTMLCanvasElement>(null);
  const stream = React.useRef<MediaStream | null>(null);
  const landmarker = React.useRef<FaceLandmarker | null>(null);
  const imageLandmarker = React.useRef<FaceLandmarker | null>(null);
  const bitmap = React.useRef<ImageBitmap | null>(null);
  const raf = React.useRef(0);
  const alive = React.useRef(true);
  const smoothed = React.useRef(new Map<string, Overlay>());
  const mirrored = React.useRef(true);
  const fileInput = React.useRef<HTMLInputElement>(null);

  const stopCamera = React.useCallback(() => {
    cancelAnimationFrame(raf.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
  }, []);

  React.useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      stopCamera();
      landmarker.current?.close();
      imageLandmarker.current?.close();
      bitmap.current?.close();
    };
  }, [stopCamera]);

  React.useEffect(
    () => () => {
      if (snap) URL.revokeObjectURL(snap.url);
    },
    [snap],
  );

  const ensureBitmap = async () => {
    if (!bitmap.current) bitmap.current = await loadProductBitmap(spec.imageUrl);
    return bitmap.current;
  };

  /** One frame: draw the picture, find the face, draw the product over it. */
  const paint = (ctx: CanvasRenderingContext2D, source: CanvasImageSource, w: number, h: number, lms: ReturnType<typeof firstFace>, bmp: ImageBitmap) => {
    ctx.drawImage(source, 0, 0, w, h);
    if (!lms) return false;
    const overlays = computeOverlays(spec.anchors, lms, { w, h }, { w: bmp.width, h: bmp.height }).map((o) => {
      const s = smoothOverlay(smoothed.current.get(o.id), o, 0.55);
      smoothed.current.set(o.id, s);
      return s;
    });
    // an overlay that disappeared (ear turned away) must not keep its old smoothing
    for (const k of [...smoothed.current.keys()]) if (!overlays.some((o) => o.id === k)) smoothed.current.delete(k);
    drawOverlays(ctx, bmp, overlays);
    return overlays.length > 0;
  };

  const startCamera = async () => {
    setProblem(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setProblem("noCamera");
      return;
    }
    setBusy(true);
    setStep("starting");
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: "user", width: { ideal: 960 }, height: { ideal: 720 } } });
      if (!alive.current) {
        media.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = media;
      const [bmp, lm] = await Promise.all([ensureBitmap(), landmarker.current ? Promise.resolve(landmarker.current) : createLandmarker("VIDEO")]);
      landmarker.current = lm;
      const v = video.current!;
      v.srcObject = media;
      await v.play();
      const c = canvas.current!;
      c.width = v.videoWidth || 640;
      c.height = v.videoHeight || 480;
      const ctx = c.getContext("2d")!;
      mirrored.current = true;
      setStep("live");
      let lastTime = -1;
      let noFaceFrames = 0;
      let frames = 0;
      let detectMs = 0;
      let windowStart = performance.now();
      const loop = () => {
        if (!alive.current || !stream.current) return;
        if (v.readyState >= 2 && v.currentTime !== lastTime) {
          lastTime = v.currentTime;
          let lms: ReturnType<typeof firstFace> = null;
          const t0 = performance.now();
          try {
            lms = firstFace(lm.detectForVideo(v, t0));
          } catch {
            lms = null;
          }
          // Frame rate and detection time, as attributes on the canvas (handy for checking a phone; no data leaves the page).
          frames++;
          detectMs += performance.now() - t0;
          if (frames % 30 === 0 && c.isConnected) {
            c.dataset.detectMs = (detectMs / 30).toFixed(1);
            c.dataset.fps = ((30 * 1000) / (performance.now() - windowStart)).toFixed(1);
            detectMs = 0;
            windowStart = performance.now();
          }
          const drew = paint(ctx, v, c.width, c.height, lms, bmp);
          noFaceFrames = drew ? 0 : noFaceFrames + 1;
          setProblem((p) => (noFaceFrames > 45 ? "noFace" : noFaceFrames === 0 && p === "noFace" ? null : p));
        }
        raf.current = requestAnimationFrame(loop);
      };
      raf.current = requestAnimationFrame(loop);
    } catch (e) {
      stopCamera();
      const name = e instanceof DOMException ? e.name : "";
      setProblem(name === "NotAllowedError" || name === "SecurityError" ? "denied" : name === "NotFoundError" || name === "NotReadableError" || name === "OverconstrainedError" ? "noCamera" : "failed");
      setStep("intro");
    } finally {
      setBusy(false);
    }
  };

  const usePhoto = async (file: File) => {
    setProblem(null);
    setBusy(true);
    stopCamera();
    try {
      const [bmp, lm] = await Promise.all([ensureBitmap(), imageLandmarker.current ? Promise.resolve(imageLandmarker.current) : createLandmarker("IMAGE")]);
      imageLandmarker.current = lm;
      let selfie: ImageBitmap;
      try {
        selfie = await createImageBitmap(file, { imageOrientation: "from-image" });
      } catch {
        setProblem("photoFailed");
        setStep("intro");
        return;
      }
      const scale = Math.min(1, MAX_SELFIE_EDGE / Math.max(selfie.width, selfie.height));
      const w = Math.round(selfie.width * scale);
      const h = Math.round(selfie.height * scale);
      const c = canvas.current!;
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(selfie, 0, 0, w, h);
      smoothed.current.clear();
      const lms = firstFace(lm.detect(c));
      const drew = paint(ctx, selfie, w, h, lms, bmp);
      selfie.close();
      mirrored.current = false;
      setStep("photo");
      if (!drew) setProblem("noFace");
    } catch {
      setProblem("failed");
      setStep("intro");
    } finally {
      setBusy(false);
    }
  };

  const takeSnapshot = async () => {
    const c = canvas.current;
    if (!c) return;
    // The picture is saved the way it looks on screen (a selfie camera is mirrored).
    const out = document.createElement("canvas");
    out.width = c.width;
    out.height = c.height;
    const ctx = out.getContext("2d")!;
    if (mirrored.current) {
      ctx.translate(out.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(c, 0, 0);
    const blob = await new Promise<Blob | null>((res) => out.toBlob(res, "image/jpeg", 0.92));
    if (!blob) return;
    stopCamera();
    setSaved(false);
    setSnap({ url: URL.createObjectURL(blob), blob });
    setStep("snapshot");
  };

  const share = async () => {
    if (!snap) return;
    const file = new File([snap.blob], "try-on.jpg", { type: "image/jpeg" });
    try {
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: productName });
    } catch {
      /* cancelled */
    }
  };
  const canShare = typeof navigator !== "undefined" && typeof navigator.canShare === "function";

  const camHidden = step === "intro" || step === "starting" || step === "snapshot";

  return (
    <div className="grid gap-3">
      {problem && (
        <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive" data-testid="try-on-problem" data-problem={problem}>
          {tx[problem === "denied" ? "tryon.denied" : problem === "noCamera" ? "tryon.noCamera" : problem === "noFace" ? "tryon.noFace" : problem === "photoFailed" ? "tryon.photoFailed" : "tryon.failed"]}
        </p>
      )}

      {(step === "intro" || step === "starting") && (
        <div className="grid gap-3">
          <p className="rounded-xl bg-tint-1 p-3 text-sm" data-testid="try-on-privacy">
            {tx["tryon.privacy"]}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="lg" disabled={busy} onClick={() => void startCamera()} data-testid="try-on-camera">
              {step === "starting" ? <Loader2Icon className="animate-spin" /> : <CameraIcon />} {step === "starting" ? tx["tryon.starting"] : tx["tryon.allow"]}
            </Button>
            <Button type="button" size="lg" variant="outline" disabled={busy} onClick={() => fileInput.current?.click()} data-testid="try-on-selfie">
              <ImageUpIcon /> {tx["tryon.selfie"]}
            </Button>
          </div>
        </div>
      )}
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        className="sr-only"
        aria-label={tx["tryon.chooseSelfie"]}
        data-testid="try-on-file"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void usePhoto(f);
        }}
      />

      {/* The video is only a source: it is drawn into the canvas, which is what the shopper sees. */}
      <video ref={video} playsInline muted className="hidden" />
      <div className={camHidden ? "hidden" : "relative overflow-hidden rounded-2xl bg-black"}>
        <canvas
          ref={canvas}
          className="block h-auto w-full"
          style={{ transform: step === "live" ? "scaleX(-1)" : undefined }}
          role="img"
          aria-label={fillText(tx["tryon.cameraLabel"], { name: productName })}
          data-testid="try-on-canvas"
        />
        <span className="absolute start-2 top-2 rounded-full bg-black/60 px-2.5 py-1 text-xs font-semibold text-white">{tx["tryon.preview"]}</span>
      </div>

      {(step === "live" || step === "photo") && (
        <div className="grid gap-2">
          <p className="text-meta text-muted-foreground">{tx[`tryon.kind.${spec.kind}`]} {tx["tryon.previewNote"]}</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => void takeSnapshot()} data-testid="try-on-snap">
              <CameraIcon /> {tx["tryon.snapshot"]}
            </Button>
            {step === "live" ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  stopCamera();
                  setStep("intro");
                }}
              >
                <SquareIcon /> {tx["tryon.stop"]}
              </Button>
            ) : (
              <Button type="button" variant="outline" onClick={() => fileInput.current?.click()}>
                <ImageUpIcon /> {tx["tryon.chooseSelfie"]}
              </Button>
            )}
          </div>
        </div>
      )}

      {step === "snapshot" && snap && (
        <div className="grid gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={snap.url} alt={fillText(tx["tryon.resultAlt"], { name: productName })} className="w-full rounded-2xl" data-testid="try-on-result" />
          <p className="text-meta text-muted-foreground">{tx["tryon.snapshotNote"]}</p>
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <a href={snap.url} download="try-on.jpg" onClick={() => setSaved(true)}>
                <DownloadIcon /> {tx["tryon.save"]}
              </a>
            </Button>
            {canShare && (
              <Button type="button" variant="outline" onClick={() => void share()}>
                <Share2Icon /> {tx["tryon.share"]}
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setSnap(null);
                setStep("intro");
                setProblem(null);
              }}
            >
              <RotateCcwIcon /> {tx["tryon.retake"]}
            </Button>
          </div>
          {saved && <p className="text-meta text-muted-foreground">{tx["tryon.saved"]}</p>}
        </div>
      )}
    </div>
  );
}
