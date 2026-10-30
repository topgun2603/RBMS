"use client";

import * as React from "react";
import { CameraOffIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@rbms/ui";
import { useI18n } from "@rbms/web";

/** The Shape Detection API's BarcodeDetector (Chrome on Android/ChromeOS/macOS, Edge); typed here as TS lacks it. */
interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => BarcodeDetectorLike;
const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "code_93", "itf", "codabar", "qr_code"];

export const cameraScanSupported = () => typeof window !== "undefined" && "BarcodeDetector" in window && !!navigator.mediaDevices?.getUserMedia;

type State = "starting" | "scanning" | "unsupported" | "denied" | "error";

/** Camera barcode scan for the stock count; keeps scanning (one code per second) until closed, so a shelf goes quickly. */
export function ScanDialog({ open, onClose, onCode }: { open: boolean; onClose: () => void; onCode: (code: string) => void }) {
  const { t } = useI18n();
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const [state, setState] = React.useState<State>("starting");
  const onCodeRef = React.useRef(onCode);
  onCodeRef.current = onCode;

  React.useEffect(() => {
    if (!open) return;
    if (!cameraScanSupported()) {
      setState("unsupported");
      return;
    }
    setState("starting");
    let stream: MediaStream | null = null;
    let timer = 0;
    let stopped = false;
    let lastCode = "";
    let lastAt = 0;
    const Detector = (window as unknown as { BarcodeDetector: BarcodeDetectorCtor }).BarcodeDetector;
    let detector: BarcodeDetectorLike;
    try {
      detector = new Detector({ formats: FORMATS });
    } catch {
      detector = new Detector();
    }
    const tick = async () => {
      if (stopped) return;
      const video = videoRef.current;
      if (video && video.readyState >= 2) {
        try {
          const found = await detector.detect(video);
          const code = found.find((b) => b.rawValue?.trim())?.rawValue.trim();
          const now = Date.now();
          // The same label stays in view: count it once per two seconds.
          if (code && (code !== lastCode || now - lastAt > 2000)) {
            lastCode = code;
            lastAt = now;
            navigator.vibrate?.(60);
            onCodeRef.current(code);
          }
        } catch {
          // a frame that couldn't be read; keep going
        }
      }
      timer = window.setTimeout(tick, 250);
    };
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false })
      .then(async (s) => {
        if (stopped) {
          s.getTracks().forEach((tr) => tr.stop());
          return;
        }
        stream = s;
        const video = videoRef.current;
        if (video) {
          video.srcObject = s;
          await video.play().catch(() => undefined);
        }
        setState("scanning");
        void tick();
      })
      .catch((err: unknown) => setState(err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "SecurityError") ? "denied" : "error"));
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((tr) => tr.stop());
    };
  }, [open]);

  const problem = state === "unsupported" || state === "denied" || state === "error";
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("billing.audit.scan.title")}</DialogTitle>
          <DialogDescription>{t("billing.audit.scan.body")}</DialogDescription>
        </DialogHeader>
        {problem ? (
          <Alert variant="warning">
            <CameraOffIcon />
            <AlertTitle>{t(`billing.audit.scan.${state}Title`)}</AlertTitle>
            <AlertDescription>{t(`billing.audit.scan.${state}Body`)}</AlertDescription>
          </Alert>
        ) : (
          <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-black">
            <video ref={videoRef} className="size-full object-cover" playsInline muted />
            <div className="pointer-events-none absolute inset-x-8 top-1/2 h-24 -translate-y-1/2 rounded-lg border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
