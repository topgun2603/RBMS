import { ReceiptIndianRupeeIcon } from "lucide-react";

/** Full-screen loading state while the shop is being resolved: a softly breathing brand mark. */
export function Splash({ label }: { label?: string }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-page" aria-busy="true">
      <div className="relative">
        <span className="absolute inset-0 animate-ping rounded-2xl bg-primary/25 [animation-duration:1.6s]" aria-hidden />
        <span className="relative flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/30">
          <ReceiptIndianRupeeIcon className="size-7" aria-hidden />
        </span>
      </div>
      <span className="sr-only">{label ?? "Loading"}</span>
    </div>
  );
}
