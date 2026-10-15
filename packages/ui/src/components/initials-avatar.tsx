import * as React from "react";
import { cn } from "../lib/utils";
import { initials } from "./avatar";

/** Eight hue angles spread around the wheel; picked deterministically from the name. */
const HUES = [25, 55, 85, 150, 190, 230, 270, 320];

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Stable hue (degrees) for a name, so the same customer always gets the same tint. */
export function avatarHue(name?: string | null): number {
  return HUES[hashString((name ?? "").trim().toLowerCase()) % HUES.length]!;
}

const SIZES = { sm: "size-8 text-xs", md: "size-10 text-sm", lg: "size-14 text-lg", xl: "size-16 text-xl" } as const;

export interface InitialsAvatarProps extends Omit<React.ComponentProps<"span">, "children"> {
  name?: string | null;
  size?: keyof typeof SIZES;
}

/**
 * Round avatar with up to two initials on a tint derived from the name. Light and dark themes get
 * their own lightness steps of the same hue so it reads well on both.
 */
function InitialsAvatar({ name, size = "md", className, style, ...props }: InitialsAvatarProps) {
  const hue = avatarHue(name);
  return (
    <span
      data-slot="initials-avatar"
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold tracking-tight select-none",
        "bg-[oklch(0.93_0.05_var(--av-h))] text-[oklch(0.38_0.1_var(--av-h))] ring-1 ring-[oklch(0.5_0.1_var(--av-h)/0.15)] ring-inset",
        "dark:bg-[oklch(0.33_0.07_var(--av-h))] dark:text-[oklch(0.9_0.07_var(--av-h))]",
        SIZES[size],
        className,
      )}
      style={{ ["--av-h" as string]: String(hue), ...style }}
      {...props}
    >
      {initials(name)}
    </span>
  );
}

export { InitialsAvatar };
