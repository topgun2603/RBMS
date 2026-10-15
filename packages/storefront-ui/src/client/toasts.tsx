"use client";

import * as React from "react";
import { CheckIcon, XIcon } from "lucide-react";
import { toast } from "@srirealtime/ui/components/sonner";
import { motion } from "@srirealtime/ui/motion";
import { StoreImage } from "../components/bits";

/** "Added to cart" toast with the product thumbnail and a View cart action. */
export function toastAddedToCart(opts: { title: string; name: string; detail?: string; image: string | null; actionLabel: string; closeLabel: string; onView: () => void }) {
  toast.custom(
    (id) => (
      <div className="pointer-events-auto flex w-[min(92vw,380px)] items-center gap-3 rounded-2xl border bg-popover p-3 text-popover-foreground shadow-[var(--elevation-2)]" role="status">
        <span className="relative size-14 shrink-0 overflow-hidden rounded-xl bg-muted">
          <StoreImage src={opts.image} alt="" name={opts.name} />
          <motion.span
            className="absolute -right-0 -bottom-0 flex size-5 items-center justify-center rounded-tl-lg bg-success text-white"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 500, damping: 18, delay: 0.15 }}
          >
            <CheckIcon className="size-3" strokeWidth={3} />
          </motion.span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">{opts.title}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {opts.name}
            {opts.detail ? ` · ${opts.detail}` : ""}
          </span>
        </span>
        <button
          type="button"
          onClick={() => {
            toast.dismiss(id);
            opts.onView();
          }}
          className="h-9 shrink-0 rounded-full bg-primary px-4 text-xs font-semibold text-primary-foreground focus-ring hover:bg-primary/90"
        >
          {opts.actionLabel}
        </button>
        <button type="button" onClick={() => toast.dismiss(id)} aria-label={opts.closeLabel} className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent">
          <XIcon className="size-3.5" />
        </button>
      </div>
    ),
    { duration: 4000 },
  );
}
