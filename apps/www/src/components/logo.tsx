import { cn } from "@rbms/ui/lib/utils";

/** RBMS mark: a rounded tile with a kolam-style loop (four dots joined by one line). */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" aria-hidden="true" className={cn("size-8", className)}>
      <defs>
        <linearGradient id="sr-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="oklch(0.5 0.2 272)" />
          <stop offset="1" stopColor="oklch(0.62 0.19 330)" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="11" fill="url(#sr-mark)" />
      <path
        d="M20 9c4 0 6 3 6 5.5S24 19 20 20s-6 3-6 5.5S16 31 20 31s6-2.5 6-5"
        fill="none"
        stroke="white"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <circle cx="12.5" cy="13" r="2" fill="oklch(0.85 0.15 75)" />
      <circle cx="27.5" cy="27" r="2" fill="oklch(0.85 0.15 75)" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark />
      <span className="font-display text-lg font-bold tracking-tight">RBMS</span>
    </span>
  );
}
