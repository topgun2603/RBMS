import { cn } from "@rbms/ui/lib/utils";

/** The bill the product starts from: a thermal slip with its torn edge. Same paths in app/icon.svg. */
export const LOGO_SLIP = "M8 2h24a3 3 0 0 1 3 3v33l-3.75-3-3.75 3-3.75-3L20 38l-3.75-3-3.75 3-3.75-3L5 38V5a3 3 0 0 1 3-3Z";
export const LOGO_R = "M14 8h8.6c4.5 0 7.4 2.6 7.4 6.6 0 2.9-1.5 5.1-4 6.1l4.7 8.3h-5.3l-4.2-7.7H18.6V29H14V8Zm4.6 4v5.3h3.6c1.9 0 3.1-1 3.1-2.7S24.1 12 22.2 12h-3.6Z";

/** RBMS mark: an R printed on a bill. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" aria-hidden="true" className={cn("size-9", className)}>
      <path d={LOGO_SLIP} fill="oklch(0.56 0.235 29)" />
      <path d={LOGO_R} fill="white" fillRule="evenodd" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <LogoMark />
      <span className="font-poster text-[1.85rem] leading-none font-black tracking-wide">RBMS</span>
    </span>
  );
}
