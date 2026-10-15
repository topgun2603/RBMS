/**
 * Small inline drawings for empty states (currentColor = brand primary via EmptyState; surface tokens for paper).
 */
import * as React from "react";

type P = { className?: string; size?: number };

export function PagesIllustration({ className, size = 120 }: P) {
  return (
    <svg viewBox="0 0 120 96" width={size} height={(size * 96) / 120} className={className} aria-hidden>
      <ellipse cx="60" cy="90" rx="40" ry="4" fill="currentColor" opacity="0.08" />
      <rect x="30" y="14" width="52" height="66" rx="6" fill="var(--card)" stroke="var(--border)" strokeWidth="1.5" transform="rotate(-6 56 47)" />
      <rect x="40" y="10" width="52" height="66" rx="6" fill="var(--card)" stroke="var(--border)" strokeWidth="1.5" />
      <rect x="48" y="20" width="30" height="5" rx="2.5" fill="currentColor" opacity="0.85" />
      <rect x="48" y="31" width="36" height="3" rx="1.5" fill="var(--border)" />
      <rect x="48" y="38" width="32" height="3" rx="1.5" fill="var(--border)" />
      <rect x="48" y="45" width="34" height="3" rx="1.5" fill="var(--border)" />
      <rect x="48" y="54" width="22" height="12" rx="3" fill="currentColor" opacity="0.2" />
      <circle cx="92" cy="72" r="11" fill="currentColor" />
      <path d="M92 67v10M87 72h10" stroke="var(--primary-foreground)" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

export function ReviewsIllustration({ className, size = 120 }: P) {
  return (
    <svg viewBox="0 0 120 96" width={size} height={(size * 96) / 120} className={className} aria-hidden>
      <ellipse cx="60" cy="90" rx="40" ry="4" fill="currentColor" opacity="0.08" />
      <rect x="18" y="20" width="70" height="44" rx="8" fill="var(--card)" stroke="var(--border)" strokeWidth="1.5" />
      <path d="M32 64l-4 12 14-12" fill="var(--card)" stroke="var(--border)" strokeWidth="1.5" strokeLinejoin="round" />
      {[0, 1, 2, 3, 4].map((i) => (
        <path
          key={i}
          d="M0-6l1.8 3.7 4 .6-2.9 2.8.7 4L0 3.2-3.6 5.1l.7-4L-5.8-1.7l4-.6z"
          transform={`translate(${32 + i * 11} 36)`}
          fill="currentColor"
          opacity={i < 4 ? 0.9 : 0.25}
        />
      ))}
      <rect x="28" y="48" width="44" height="3" rx="1.5" fill="var(--border)" />
      <circle cx="94" cy="62" r="12" fill="currentColor" />
      <path d="M89 62l3.5 3.5L99 58" fill="none" stroke="var(--primary-foreground)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ChartIllustration({ className, size = 120 }: P) {
  return (
    <svg viewBox="0 0 120 96" width={size} height={(size * 96) / 120} className={className} aria-hidden>
      <ellipse cx="60" cy="90" rx="40" ry="4" fill="currentColor" opacity="0.08" />
      <rect x="16" y="14" width="88" height="64" rx="8" fill="var(--card)" stroke="var(--border)" strokeWidth="1.5" />
      <path d="M26 64h68" stroke="var(--border)" strokeWidth="1.5" />
      <path d="M28 58l14-12 12 6 14-16 14 8 10-10" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="92" cy="34" r="3" fill="currentColor" />
      <rect x="26" y="22" width="26" height="4" rx="2" fill="currentColor" opacity="0.5" />
    </svg>
  );
}
