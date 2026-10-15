"use client";

import * as React from "react";
import { CameraOffIcon, ScanBarcodeIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle, Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, motion } from "@srirealtime/ui";
import { useI18n } from "@srirealtime/web";

/** The Shape Detection API's BarcodeDetector (Chrome on Android/ChromeOS/macOS, Edge); typed here as TS lacks it. */
interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => BarcodeDetectorLike;

const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "code_93", "itf", "codabar", "qr_code"];

export const cameraScanSupported = () =>
  typeof window !== "undefined" && "BarcodeDetector" in window && !!navigator.mediaDevices?.getUserMedia;

type State = "starting" | "scanning" | "unsupported" | "denied" | "error";

/** Camera scan with the BarcodeDetector API; a clear message (USB scanner or typing) where the browser can't. */
export function CameraScanDialog({ open, onClose, onCode }: { open: boolean; onClose: () => void; onCode: (code: string) => void }) {
  const { t } = useI18n();
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const [state, setState] = React.useState<State>("starting");

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
          if (code && !stopped) {
            stopped = true;
            navigator.vibrate?.(60);
            onCode(code);
            onClose();
            return;
          }
        } catch {
          // a frame that couldn't be read; keep going
        }
      }
      timer = window.setTimeout(tick, 200);
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
      .catch((err: unknown) => {
        setState(err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "SecurityError") ? "denied" : "error");
      });
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((tr) => tr.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restart only when opened
  }, [open]);

  const problem = state === "unsupported" || state === "denied" || state === "error";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg" closeLabel={t("pos.common.close")}>
        <DialogHeader>
          <DialogTitle>{t("pos.scan.cameraTitle")}</DialogTitle>
          <DialogDescription>{t("pos.scan.cameraBody")}</DialogDescription>
        </DialogHeader>
        {problem ? (
          <Alert variant="warning">
            <CameraOffIcon />
            <AlertTitle>{t(`pos.scan.${state}Title`)}</AlertTitle>
            <AlertDescription>{t(`pos.scan.${state}Body`)}</AlertDescription>
          </Alert>
        ) : (
          <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-black">
            <video ref={videoRef} className="size-full object-cover" playsInline muted />
            <div className="pointer-events-none absolute inset-x-8 top-1/2 h-24 -translate-y-1/2 rounded-lg border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]">
              <motion.span
                className="absolute inset-x-2 h-0.5 bg-red-500/90"
                initial={{ top: "10%" }}
                animate={{ top: ["10%", "90%", "10%"] }}
                transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
              />
            </div>
            {state === "starting" && (
              <p className="absolute inset-x-0 bottom-3 flex items-center justify-center gap-2 text-sm text-white">
                <ScanBarcodeIcon className="size-4" /> {t("pos.scan.starting")}
              </p>
            )}
          </div>
        )}
        <Button type="button" variant="outline" size="lg" onClick={onClose}>
          {t("pos.common.close")}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
