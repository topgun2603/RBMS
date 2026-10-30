"use client";

import * as React from "react";
import QRCode from "qrcode";
import { cn } from "@rbms/ui";

/** QR code (PNG data URL) for any text, e.g. a upi://pay link. Dark-on-white so every UPI app can scan it. */
export function QrImage({ value, size = 200, className, alt }: { value: string; size?: number; className?: string; alt: string }) {
  const [src, setSrc] = React.useState<string | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(value, { margin: 1, width: size * 2, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" } })
      .then((url) => !cancelled && setSrc(url))
      .catch(() => !cancelled && setSrc(null));
    return () => {
      cancelled = true;
    };
  }, [value, size]);
  return (
    <div className={cn("shrink-0 rounded-lg bg-white p-2", className)} style={{ width: size, height: size }}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- generated data URL
        <img src={src} alt={alt} width={size - 16} height={size - 16} className="size-full" />
      ) : (
        <div className="size-full animate-pulse rounded bg-neutral-200" aria-hidden />
      )}
    </div>
  );
}
