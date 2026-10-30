"use client";

import { useTheme } from "next-themes";
import { cn } from "@rbms/ui";
import { useBranding } from "@/lib/branding";

/** Tenant logo (dark variant in dark mode) or a primary-coloured monogram, plus the app name. */
export function BrandMark({ showName = true, className, size = "md" }: { showName?: boolean; className?: string; size?: "md" | "lg" }) {
  const { branding } = useBranding();
  const { resolvedTheme } = useTheme();
  const name = branding?.appName || "Srikit";
  const logo = resolvedTheme === "dark" ? (branding?.logoDarkUrl ?? branding?.logoUrl) : branding?.logoUrl;
  const box = size === "lg" ? "size-10 text-base" : "size-8 text-sm";

  return (
    <div className={cn("flex min-w-0 items-center gap-2.5", className)}>
      {logo ? (
        // eslint-disable-next-line @next/next/no-img-element -- tenant-hosted logos are arbitrary URLs
        <img src={logo} alt={name} className={cn("shrink-0 rounded-md object-contain", box)} />
      ) : (
        <div
          aria-hidden
          className={cn(
            "flex shrink-0 items-center justify-center rounded-md bg-primary font-heading font-bold text-primary-foreground shadow-sm",
            box,
          )}
        >
          {Array.from(name)[0]?.toUpperCase()}
        </div>
      )}
      {showName && <span className="truncate font-heading text-sm font-semibold tracking-tight">{name}</span>}
    </div>
  );
}
