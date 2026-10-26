"use client";

import * as React from "react";
import { Loader2Icon, ScanFaceIcon } from "lucide-react";
import { Button } from "@srirealtime/ui/components/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@srirealtime/ui/components/dialog";
import { fillText, tryonText } from "../lib/tryon/messages";
import { isTryonSpec, type TryonAnchors, type TryonKind } from "../lib/tryon/transform";
import { call } from "./api";
import { useStore } from "./store-context";

interface Spec {
  kind: TryonKind;
  imageUrl: string;
  anchors: TryonAnchors;
}

const TryOnDialog = React.lazy(() => import("./try-on-dialog").then((m) => ({ default: m.TryOnDialog })));

/**
 * "Try it on" on a product page. Shows only when the shop has switched Try-on on, the product has a try-on image and this
 * store has the model files installed. The camera, the model and the dialog's code load only when it is tapped, and no camera
 * picture or selfie ever leaves the phone.
 */
export function TryOnButton({ productId, productName, className }: { productId: string; productName: string; className?: string }) {
  const { locale } = useStore();
  const tx = tryonText(locale);
  const [spec, setSpec] = React.useState<Spec | null>(null);
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await call<{ tryon: unknown }>(`/ai/imaging/public/tryon/${productId}`, { auth: false });
        if (cancelled || !isTryonSpec(r.tryon)) return;
        const { assetsInstalled } = await import("../lib/tryon/engine");
        if (!cancelled && (await assetsInstalled())) setSpec(r.tryon);
      } catch {
        /* not available: no button */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [productId]);

  if (!spec) return null;
  return (
    <>
      <Button type="button" variant="outline" size="lg" className={className} onClick={() => setOpen(true)} data-testid="try-on">
        <ScanFaceIcon /> {tx["tryon.button"]}
      </Button>
      {open && (
        <Dialog open onOpenChange={(o) => !o && setOpen(false)}>
          <DialogContent className="max-h-[94dvh] gap-3 overflow-y-auto rounded-3xl p-4 sm:max-w-xl" closeLabel={locale === "ta" ? "மூடு" : "Close"} data-testid="try-on-dialog">
            <DialogHeader>
              <DialogTitle className="font-display text-xl">{tx["tryon.title"]}</DialogTitle>
              <DialogDescription>{fillText(tx["tryon.intro"], { name: productName })}</DialogDescription>
            </DialogHeader>
            <React.Suspense
              fallback={
                <p className="flex items-center gap-2 text-sm" role="status">
                  <Loader2Icon className="size-4 animate-spin" /> {tx["tryon.loading"]}
                </p>
              }
            >
              <TryOnDialog spec={spec} productName={productName} />
            </React.Suspense>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
