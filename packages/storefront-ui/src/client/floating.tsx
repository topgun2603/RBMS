"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { ArrowUpIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@srirealtime/ui/components/tooltip";
import { AnimatePresence, motion, useMotionValueEvent, useReducedMotionSafe, useScroll } from "@srirealtime/ui/motion";
import { useStore } from "./store-context";

function WhatsAppGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden fill="currentColor">
      <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.4.8 3.2.7.5-.1 1.5-.6 1.8-1.2.2-.6.2-1.1.1-1.2l-.5-.3Z" />
    </svg>
  );
}

function whatsappUrl(v: string, text: string): string {
  if (/^https?:/i.test(v)) return v;
  const d = v.replace(/\D/g, "");
  return `https://wa.me/${d.length === 10 ? `91${d}` : d}?text=${encodeURIComponent(text)}`;
}

/**
 * Bottom-right floating actions: WhatsApp chat (when the shop set a WhatsApp number) with a tooltip, and a back-to-top
 * button that appears after scrolling. Moved up on the product page so they never cover the sticky buy bar.
 */
export function FloatingActions({ whatsapp }: { whatsapp?: string | null }) {
  const { t, shell } = useStore();
  const reduced = useReducedMotionSafe();
  const pathname = usePathname();
  const { scrollY } = useScroll();
  const [showTop, setShowTop] = React.useState(false);
  useMotionValueEvent(scrollY, "change", (y) => setShowTop(y > 900));
  const lifted = pathname.startsWith("/p/");
  const hideAll = pathname === "/checkout";
  if (hideAll) return null;
  return (
    <div className={`pointer-events-none fixed right-4 z-30 flex flex-col items-end gap-3 transition-[bottom] duration-300 sm:right-6 ${lifted ? "bottom-24 lg:bottom-6" : "bottom-5 sm:bottom-6"}`}>
      <AnimatePresence>
        {showTop && (
          <motion.button
            key="top"
            type="button"
            initial={{ opacity: 0, scale: 0.6, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.6, y: 12 }}
            whileHover={reduced ? undefined : { y: -3 }}
            whileTap={{ scale: 0.9 }}
            onClick={() => window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" })}
            aria-label={t("common.backToTop")}
            className="pointer-events-auto flex size-11 items-center justify-center rounded-full border bg-background/95 text-foreground shadow-[var(--elevation-2)] backdrop-blur focus-ring"
            data-testid="back-to-top"
          >
            <ArrowUpIcon className="size-5" />
          </motion.button>
        )}
      </AnimatePresence>
      {whatsapp && (
        <Tooltip>
          <TooltipTrigger asChild>
            <motion.a
              href={whatsappUrl(whatsapp, t("whatsapp.prefill", { shop: shell.name }))}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t("whatsapp.label")}
              initial={reduced ? false : { scale: 0, rotate: -30 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: "spring", stiffness: 300, damping: 18, delay: 1 }}
              whileHover={reduced ? undefined : { scale: 1.08 }}
              whileTap={{ scale: 0.92 }}
              className="pointer-events-auto relative flex size-14 items-center justify-center rounded-full bg-[#25D366] text-white shadow-lg shadow-[#25D366]/40 focus-ring"
              data-testid="whatsapp"
            >
              {!reduced && <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-[#25D366]/40 [animation-duration:2.5s] [animation-iteration-count:3]" />}
              <WhatsAppGlyph className="relative size-7" />
            </motion.a>
          </TooltipTrigger>
          <TooltipContent side="left" sideOffset={8} className="rounded-xl px-3 py-2 text-sm">
            {t("whatsapp.tooltip")}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
