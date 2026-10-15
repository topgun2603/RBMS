"use client";

import { useTheme } from "next-themes";
import { cn } from "@srirealtime/ui";
import { absoluteUrl } from "../lib/api";
import { useOptionalShop } from "../lib/branding";
import { useOptionalWebApp } from "../app/navigation";

const SIZES = { sm: "size-7 text-xs", md: "size-8 text-sm", lg: "size-12 text-lg", xl: "size-16 text-2xl" } as const;

/** Logo (or a primary-coloured monogram) plus a name. Reads the shop by default; pass props to override. */
export function BrandMark({
  name: nameProp,
  logoUrl: logoProp,
  showName = true,
  size = "md",
  className,
  nameClassName,
}: {
  name?: string | null;
  logoUrl?: string | null;
  showName?: boolean;
  size?: keyof typeof SIZES;
  className?: string;
  nameClassName?: string;
}) {
  const shop = useOptionalShop();
  const app = useOptionalWebApp();
  const { resolvedTheme } = useTheme();
  const name = nameProp ?? shop?.shopName ?? app?.name ?? "";
  const darkLogo = absoluteUrl(shop?.branding?.logoDarkUrl);
  const logo = logoProp !== undefined ? absoluteUrl(logoProp) : resolvedTheme === "dark" && darkLogo ? darkLogo : (shop?.logoUrl ?? null);

  return (
    <div className={cn("flex min-w-0 items-center gap-2.5", className)}>
      {logo ? (
        // eslint-disable-next-line @next/next/no-img-element -- tenant-hosted logos are arbitrary URLs
        <img src={logo} alt={showName ? "" : name} className={cn("shrink-0 rounded-md object-contain", SIZES[size])} />
      ) : (
        <div
          aria-hidden={showName}
          aria-label={showName ? undefined : name}
          className={cn(
            "flex shrink-0 items-center justify-center rounded-md bg-primary font-heading font-bold text-primary-foreground shadow-sm",
            SIZES[size],
          )}
        >
          {Array.from(name)[0]?.toUpperCase()}
        </div>
      )}
      {showName && <span className={cn("truncate font-heading text-sm font-semibold tracking-tight", nameClassName)}>{name}</span>}
    </div>
  );
}
