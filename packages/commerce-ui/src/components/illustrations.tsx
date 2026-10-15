/**
 * Small inline SVG drawings for empty states. currentColor (the brand primary via EmptyState) for accents and the
 * surface/border tokens for paper, so they work in light and dark.
 */
import * as React from "react";

type P = { className?: string; size?: number };

export function ProductsIllustration({ className, size = 128 }: P) {
  return (
    <svg viewBox="0 0 128 100" width={size} height={(size * 100) / 128} className={className} aria-hidden>
      <ellipse cx="64" cy="92" rx="44" ry="5" fill="currentColor" opacity="0.08" />
      {/* shopping bag */}
      <path d="M30 34h40l4 50H26z" fill="var(--card)" stroke="var(--border)" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M40 40v-8a10 10 0 0 1 20 0v8" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <rect x="36" y="56" width="28" height="4" rx="2" fill="var(--border)" />
      <rect x="40" y="64" width="20" height="3" rx="1.5" fill="var(--border)" />
      {/* tag */}
      <g transform="rotate(14 94 46)">
        <path d="M78 30h24a4 4 0 0 1 4 4v24l-14 14-18-18z" fill="currentColor" opacity="0.9" />
        <circle cx="98" cy="38" r="3" fill="var(--card)" />
        <rect x="84" y="46" width="12" height="3" rx="1.5" fill="var(--primary-foreground)" opacity="0.8" />
      </g>
      <circle cx="102" cy="78" r="11" fill="currentColor" />
      <path d="M102 73v10M97 78h10" stroke="var(--primary-foreground)" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

export function FoldersIllustration({ className, size = 120 }: P) {
  return (
    <svg viewBox="0 0 120 96" width={size} height={(size * 96) / 120} className={className} aria-hidden>
      <ellipse cx="60" cy="88" rx="40" ry="5" fill="currentColor" opacity="0.08" />
      <path d="M20 26h22l6 6h38v42H20z" fill="var(--card)" stroke="var(--border)" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M34 40h22l6 6h38v34H34z" fill="currentColor" opacity="0.18" />
      <path d="M34 40h22l6 6h38v34H34z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <rect x="44" y="58" width="30" height="4" rx="2" fill="currentColor" opacity="0.7" />
      <rect x="44" y="66" width="20" height="3" rx="1.5" fill="currentColor" opacity="0.4" />
    </svg>
  );
}

export function CollectionsIllustration({ className, size = 120 }: P) {
  return (
    <svg viewBox="0 0 120 96" width={size} height={(size * 96) / 120} className={className} aria-hidden>
      <ellipse cx="60" cy="88" rx="40" ry="5" fill="currentColor" opacity="0.08" />
      <rect x="22" y="22" width="36" height="44" rx="6" fill="var(--card)" stroke="var(--border)" strokeWidth="1.5" transform="rotate(-8 40 44)" />
      <rect x="62" y="22" width="36" height="44" rx="6" fill="var(--card)" stroke="var(--border)" strokeWidth="1.5" transform="rotate(8 80 44)" />
      <rect x="40" y="16" width="40" height="52" rx="7" fill="var(--card)" stroke="currentColor" strokeWidth="1.5" />
      <rect x="46" y="22" width="28" height="24" rx="4" fill="currentColor" opacity="0.18" />
      <rect x="46" y="52" width="20" height="4" rx="2" fill="currentColor" opacity="0.8" />
      <rect x="46" y="59" width="14" height="3" rx="1.5" fill="var(--border)" />
      <path d="M86 70l3 6 6.5 1-4.7 4.6 1.1 6.4L86 85l-5.9 3 1.1-6.4-4.7-4.6 6.5-1z" fill="currentColor" />
    </svg>
  );
}
