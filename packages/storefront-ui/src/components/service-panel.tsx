import * as React from "react";
import Link from "next/link";
import { CalendarCheck2Icon, Clock3Icon, MessageCircleIcon } from "lucide-react";
import { cn } from "@srirealtime/ui/lib/utils";
import type { Product } from "../types";
import { durationLabel, serviceAction } from "../lib/service-item";
import { Price } from "./bits";

type T = (key: string, vars?: Record<string, string | number | null | undefined>) => string;

/**
 * The product page's buy box for a service (a haircut, a repair): price ("from" when it varies), how long it takes,
 * one main button — "Book now" (→ /book?service=<id>, preselected) or "Enquire on WhatsApp" when it can't be booked
 * online — and a short "how booking works". No cart, stock, PIN-code check or shipping.
 */
export function ServicePanel({ product, t, contact, className }: { product: Product; t: T; contact: { whatsapp?: string | null; phone?: string | null }; className?: string }) {
  const action = serviceAction(product, contact, t);
  const def = product.variants.find((v) => v.isDefault) ?? product.variants[0];
  // Bookings' duration first; else the shop's own "Duration" detail ("1 hr").
  const duration = durationLabel(product.service?.durationMin, t) ?? (product.attributes?.Duration || product.attributes?.duration || null);
  const varies = product.priceMax > product.priceMin;
  const book = action.kind === "book";
  // No price at all (a school programme): the enquiry steps talk about the fee, not a bill after the service.
  const quote = !book && product.priceMin <= 0;
  const steps = book ? [t("service.how1"), t("service.how2"), t("service.how3")] : quote ? [t("service.quote1"), t("service.quote2"), t("service.quote3")] : [t("service.enquire1"), t("service.enquire2"), t("service.enquire3")];
  const button = (
    <>
      {book ? <CalendarCheck2Icon className="size-5" /> : <MessageCircleIcon className="size-5" />}
      {book ? t("service.book") : t("service.enquire")}
    </>
  );
  const btnCls = "sf-btn inline-flex h-12 w-full items-center justify-center gap-2 bg-primary px-6 text-base font-semibold text-primary-foreground shadow-sm transition-colors focus-ring hover:bg-primary/90 sm:w-auto sm:min-w-64";
  return (
    <div className={cn("grid gap-5", className)} data-testid="service-panel" data-service-action={action.kind}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Price price={product.priceMin} priceMax={product.priceMax} mrp={def?.mrp ?? null} t={t} size="lg" />
        {duration && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-tint-1 px-3 py-1 text-sm font-medium" data-testid="service-duration">
            <Clock3Icon className="size-4 text-primary" />
            {t("service.duration", { time: duration })}
          </span>
        )}
      </div>
      {varies && <p className="-mt-2 text-sm text-muted-foreground">{t("service.priceVaries")}</p>}
      {action.kind === "book" ? (
        <Link href={action.href} className={btnCls} data-testid="service-book">
          {button}
        </Link>
      ) : (
        <a href={action.href} className={btnCls} data-testid="service-enquire" {...(action.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
          {button}
        </a>
      )}
      <section aria-labelledby="svc-how" className="rounded-2xl border bg-card p-4 text-card-foreground shadow-xs sm:p-5">
        <h2 id="svc-how" className="mb-3 text-base font-semibold">
          {book ? t("service.howTitle") : quote ? t("service.quoteTitle") : t("service.enquireTitle")}
        </h2>
        <ol className="grid gap-2.5 text-[15px] text-foreground/80">
          {steps.map((s, i) => (
            <li key={i} className="flex gap-3">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-bold text-primary">{i + 1}</span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
