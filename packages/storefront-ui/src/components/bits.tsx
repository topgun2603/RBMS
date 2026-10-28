import * as React from "react";
import Link from "next/link";
import { ArrowRightIcon, StarIcon } from "lucide-react";
import { cn } from "@srirealtime/ui/lib/utils";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@srirealtime/ui/components/breadcrumb";
import { serializeJsonLd, type JsonLd as JsonLdData } from "@srirealtime/cms/seo";
import { hashHue, imageUrl, initialsOf, money, percentOff } from "../lib/format";

type T = (key: string, vars?: Record<string, string | number | null | undefined>) => string;

/** The Indian food mark: a green dot in a square for veg, brown for egg, red for non-veg (dishes only). */
export function FoodMark({ diet, t, className }: { diet?: "veg" | "egg" | "non-veg" | null; t: T; className?: string }) {
  if (!diet) return null;
  const colour = diet === "veg" ? "border-emerald-600 text-emerald-600" : diet === "egg" ? "border-amber-700 text-amber-700" : "border-red-600 text-red-600";
  const label = t(diet === "veg" ? "food.veg" : diet === "egg" ? "food.egg" : "food.nonVeg");
  return (
    <span role="img" aria-label={label} title={label} data-testid="food-mark" data-diet={diet} className={cn("me-1.5 inline-flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border-[1.5px] bg-white align-[-1px]", colour, className)}>
      <span className="size-1.5 rounded-full bg-current" />
    </span>
  );
}

/** Product / content image; a branded placeholder (initials on a soft brand tint) when there's none. */
export function StoreImage({
  src,
  alt,
  name,
  className,
  eager,
  sizes,
}: {
  src: string | null | undefined;
  alt: string;
  /** For the placeholder initials (defaults to alt). */
  name?: string;
  className?: string;
  eager?: boolean;
  sizes?: string;
}) {
  const url = imageUrl(src);
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={alt}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        {...(eager ? { fetchPriority: "high" as const } : {})}
        sizes={sizes}
        className={cn("size-full object-cover", className)}
      />
    );
  }
  const label = name ?? alt;
  // Brand-tinted, warm placeholder; the angle and depth vary per product so a grid doesn't look flat.
  const h = hashHue(label);
  const angle = 120 + (h % 90);
  const depth = 10 + (h % 14);
  return (
    <div
      role="img"
      aria-label={alt}
      className={cn("@container relative flex size-full items-center justify-center overflow-hidden", className)}
      style={{
        // sRGB mixing keeps the brand hue (oklch mixing drifts purple towards pink).
        backgroundColor: "color-mix(in srgb, var(--primary) 7%, var(--sf-placeholder, #fbf8f4))",
        backgroundImage: `radial-gradient(color-mix(in srgb, var(--primary) 20%, transparent) 1px, transparent 1.6px), linear-gradient(${angle}deg, color-mix(in srgb, var(--primary) ${depth - 4}%, var(--sf-placeholder, #fdfbf8)) 0%, color-mix(in srgb, var(--primary) ${depth + 6}%, var(--sf-placeholder-2, #f6f0ea)) 100%)`,
        backgroundSize: "14px 14px, 100% 100%",
      }}
    >
      <span aria-hidden className="absolute -right-[12%] -bottom-[12%] size-[55%] rounded-full bg-white/25 blur-2xl" />
      <span className="relative font-heading text-[clamp(1rem,22cqw,6rem)] font-bold tracking-tight text-primary/55 select-none">{initialsOf(label)}</span>
    </div>
  );
}

/** Price, MRP struck through and % off (tabular figures; the MRP is announced as such to screen readers). */
export function Price({
  price,
  priceMax,
  mrp,
  t,
  size = "md",
  className,
}: {
  price: number;
  priceMax?: number;
  mrp?: number | null;
  t: T;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const pct = percentOff(price, mrp);
  const range = priceMax !== undefined && priceMax > price;
  // No price at all (a school programme, a quote-only service): say so instead of showing "₹0".
  if (price <= 0 && !range) {
    return (
      <div className={cn("sf-price flex flex-wrap items-baseline gap-x-2 gap-y-0.5", className)}>
        <span className={cn("font-semibold text-muted-foreground", size === "lg" ? "text-lg sm:text-xl" : size === "sm" ? "text-[13px]" : "text-sm")}>{t("product.priceOnRequest")}</span>
      </div>
    );
  }
  return (
    <div className={cn("sf-price flex flex-wrap items-baseline gap-x-2 gap-y-0.5", className)}>
      <span className={cn("font-bold text-foreground", size === "lg" ? "text-2xl sm:text-3xl" : size === "sm" ? "text-[15px]" : "text-base")}>
        {range ? t("product.from", { price: money(price) }) : money(price)}
      </span>
      {pct > 0 && (
        <>
          <s className={cn("text-muted-foreground decoration-muted-foreground/60", size === "lg" ? "text-base" : "text-xs")}>
            <span className="sr-only">{t("product.mrp")} </span>
            {money(mrp)}
          </s>
          <span className={cn("font-bold text-sale", size === "lg" ? "text-base" : "text-xs")}>{t("product.off", { pct })}</span>
        </>
      )}
    </div>
  );
}

/** 0–5 stars (half precision rounded to the nearest whole for display), accessible label. */
export function Stars({ value, count, t, size = "sm", className }: { value: number; count?: number; t: T; size?: "sm" | "md" | "lg"; className?: string }) {
  const full = Math.round(value);
  const px = size === "lg" ? "size-5" : size === "md" ? "size-4" : "size-3.5";
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      <span className="inline-flex" role="img" aria-label={t("reviews.stars", { n: Math.round(value * 10) / 10 })}>
        {[1, 2, 3, 4, 5].map((i) => (
          <StarIcon key={i} aria-hidden className={cn(px, i <= full ? "fill-amber-400 text-amber-400" : "fill-muted text-muted-foreground/30")} />
        ))}
      </span>
      {count !== undefined && <span className="text-xs text-muted-foreground tabular-nums">({count})</span>}
    </span>
  );
}

export function JsonLd({ data }: { data: JsonLdData | JsonLdData[] }) {
  // serializeJsonLd escapes <, >, & and line separators — safe inside <script>.
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }} />;
}

export function Breadcrumbs({ items, className }: { items: { name: string; href?: string }[]; className?: string }) {
  return (
    <Breadcrumb className={cn("text-xs", className)}>
      <BreadcrumbList className="gap-1 text-xs sm:gap-1.5">
        {items.map((it, i) => (
          <React.Fragment key={i}>
            {i > 0 && <BreadcrumbSeparator className="[&>svg]:size-3 opacity-60" />}
            <BreadcrumbItem>
              {it.href && i < items.length - 1 ? (
                <BreadcrumbLink asChild>
                  <Link href={it.href} className="rounded-sm focus-ring hover:underline">
                    {it.name}
                  </Link>
                </BreadcrumbLink>
              ) : (
                <BreadcrumbPage className="line-clamp-1 text-foreground/80">{it.name}</BreadcrumbPage>
              )}
            </BreadcrumbItem>
          </React.Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

export function SectionTitle({ title, eyebrow, href, linkLabel, badge, className }: { title: string; eyebrow?: string; href?: string; linkLabel?: string; badge?: React.ReactNode; className?: string }) {
  return (
    // Wraps: a long (Tamil) title keeps its width and "View all" drops below it instead of squeezing it to one word a line.
    <div className={cn("sf-section-title mb-6 flex flex-wrap items-end justify-between gap-x-4 gap-y-2 sm:mb-8", className)}>
      <div className="min-w-0 flex-[1_1_15rem]">
        {eyebrow && <p className="mb-1.5 text-xs font-semibold tracking-[0.14em] text-primary uppercase">{eyebrow}</p>}
        {/* Block (not flex), so the "underline" heading bar follows the text alignment. */}
        <h2 className="sf-heading font-display text-h2 font-semibold">
          {title}
          {badge && <span className="ms-3 inline-flex align-middle">{badge}</span>}
        </h2>
      </div>
      {href && linkLabel && (
        <Link href={href} className="group/link inline-flex shrink-0 items-center gap-1 rounded-full px-1 text-sm font-semibold text-primary focus-ring">
          <span className="bg-[linear-gradient(currentColor,currentColor)] bg-[length:0%_1.5px] bg-left-bottom bg-no-repeat transition-[background-size] duration-300 group-hover/link:bg-[length:100%_1.5px]">{linkLabel}</span>
          <ArrowRightIcon className="size-4 transition-transform duration-300 group-hover/link:translate-x-1 motion-reduce:transition-none" />
        </Link>
      )}
    </div>
  );
}

export function Empty({ icon, illustration, title, body, action, className }: { icon?: React.ReactNode; illustration?: React.ReactNode; title: string; body?: string; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center rounded-[var(--sf-radius-card)] border border-dashed bg-card/60 px-6 py-12 text-center", className)}>
      {illustration ? (
        <div className="sf-float mb-5 w-44 text-primary sm:w-52">{illustration}</div>
      ) : (
        icon && <div className="mb-4 flex size-16 items-center justify-center rounded-full bg-primary/10 text-primary [&_svg]:size-7">{icon}</div>
      )}
      <p className="font-display text-h3 font-semibold">{title}</p>
      {body && <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">{body}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

/** Page container. */
export function Container({ className, children, ...rest }: React.ComponentProps<"div">) {
  return (
    <div className={cn("sf-container mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8", className)} {...rest}>
      {children}
    </div>
  );
}

const STATUS_TONE: Record<string, string> = {
  placed: "bg-info/12 text-info-ink",
  confirmed: "bg-info/12 text-info-ink",
  packed: "bg-warning/15 text-warning-ink",
  shipped: "bg-primary/12 text-primary",
  delivered: "bg-success/15 text-success-ink",
  cancelled: "bg-destructive/12 text-danger-ink",
  returned: "bg-muted text-muted-foreground",
  paid: "bg-success/15 text-success-ink",
  cod: "bg-warning/15 text-warning-ink",
  unpaid: "bg-destructive/12 text-danger-ink",
  pending: "bg-warning/15 text-warning-ink",
  refunded: "bg-muted text-muted-foreground",
};

export function StatusChip({ status, label, className }: { status: string; label: string; className?: string }) {
  return <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold", STATUS_TONE[status] ?? "bg-muted text-muted-foreground", className)}>{label}</span>;
}
