"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { HeartIcon } from "lucide-react";
import { toast } from "@srirealtime/ui/components/sonner";
import { cn } from "@srirealtime/ui/lib/utils";
import { AnimatePresence, motion, useReducedMotionSafe } from "@srirealtime/ui/motion";
import type { List, WishlistItem } from "../types";
import { call, errorMessage } from "./api";
import { siteOnly } from "../lib/site";
import { useStore } from "./store-context";

/** The shopper's wishlist (one shared query; disabled when signed out; `off` when the shop has wishlists switched off). */
export function useWishlist() {
  const { auth } = useStore();
  const q = useQuery({
    queryKey: ["wishlist"],
    queryFn: () => call<List<WishlistItem>>("/store/me/wishlist"),
    enabled: !!auth.token,
    retry: false,
  });
  const ids = React.useMemo(() => new Set((q.data?.items ?? []).map((i) => i.productId)), [q.data]);
  return { ids, count: q.data?.items.length ?? 0, off: q.isError, query: q };
}

/** Heart toggle with a pop + particle burst when saved. Signed-out shoppers are sent to sign in. */
export function WishlistHeart({ productId, className, size = "md" }: { productId: string; className?: string; size?: "sm" | "md" }) {
  const { t, auth, shell } = useStore();
  const qc = useQueryClient();
  const router = useRouter();
  const reduced = useReducedMotionSafe();
  const { ids, off } = useWishlist();
  const saved = ids.has(productId);
  const [busy, setBusy] = React.useState(false);
  const [burst, setBurst] = React.useState(0);
  // Website-only trades (schools) have no wishlist.
  if (off || siteOnly(shell.businessType)) return null;

  const toggle = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!auth.token) {
      toast.info(t("product.wishlistSignIn"));
      router.push(`/account?next=${encodeURIComponent(location.pathname)}`);
      return;
    }
    setBusy(true);
    // Optimistic: flip the cached list right away.
    const prev = qc.getQueryData<List<WishlistItem>>(["wishlist"]);
    if (prev) {
      qc.setQueryData<List<WishlistItem>>(["wishlist"], {
        ...prev,
        items: saved ? prev.items.filter((i) => i.productId !== productId) : [...prev.items, { productId } as WishlistItem],
      });
    }
    if (!saved) setBurst((b) => b + 1);
    try {
      if (saved) await call(`/store/me/wishlist/${productId}`, { method: "DELETE" });
      else await call("/store/me/wishlist", { body: { productId } });
    } catch (err) {
      if (prev) qc.setQueryData(["wishlist"], prev);
      toast.error(errorMessage(err, t));
    } finally {
      setBusy(false);
      void qc.invalidateQueries({ queryKey: ["wishlist"] });
    }
  };

  const px = size === "sm" ? "size-9" : "size-11";
  return (
    <motion.button
      type="button"
      disabled={busy}
      aria-pressed={saved}
      aria-label={saved ? t("product.wishlistRemove") : t("product.wishlistAdd")}
      title={saved ? t("product.wishlistRemove") : t("product.wishlistAdd")}
      onClick={toggle}
      whileTap={reduced ? undefined : { scale: 0.85 }}
      className={cn(
        "relative flex items-center justify-center rounded-full border bg-card/95 text-foreground/70 shadow-sm backdrop-blur transition-colors focus-ring hover:border-primary/50 hover:text-primary",
        saved && "border-primary/40 bg-primary/10 text-primary",
        px,
        className,
      )}
    >
      <motion.span key={saved ? "on" : "off"} initial={reduced || !burst ? false : { scale: 0.4 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 600, damping: 14 }} className="flex">
        <HeartIcon className={cn(size === "sm" ? "size-4" : "size-5", saved && "fill-current")} />
      </motion.span>
      <AnimatePresence>
        {!reduced && burst > 0 && saved && (
          <motion.span key={burst} className="pointer-events-none absolute inset-0" initial={{ opacity: 1 }} animate={{ opacity: 0 }} transition={{ duration: 0.7, delay: 0.2 }} aria-hidden>
            <motion.span className="absolute inset-0 rounded-full border-2 border-primary" initial={{ scale: 0.6, opacity: 0.8 }} animate={{ scale: 1.8, opacity: 0 }} transition={{ duration: 0.55, ease: "easeOut" }} />
            {Array.from({ length: 8 }, (_, i) => {
              const a = (i / 8) * Math.PI * 2;
              return (
                <motion.span
                  key={i}
                  className="absolute top-1/2 left-1/2 size-1.5 rounded-full bg-primary"
                  style={{ marginLeft: -3, marginTop: -3 }}
                  initial={{ x: 0, y: 0, scale: 1 }}
                  animate={{ x: Math.cos(a) * 24, y: Math.sin(a) * 24, scale: 0 }}
                  transition={{ duration: 0.6, ease: "easeOut" }}
                />
              );
            })}
          </motion.span>
        )}
      </AnimatePresence>
    </motion.button>
  );
}
