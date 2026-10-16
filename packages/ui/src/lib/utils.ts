import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/** tailwind-merge that knows the kit's named theme steps (globals.css), so `px-card` vs `px-4` resolves like `px-6` vs `px-4`. */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      spacing: ["card", "card-gap", "section", "page", "page-y"],
      text: ["meta"],
    },
  },
});

/** Merges class names, resolving Tailwind conflicts (later classes win). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
