/**
 * Small inline SVG drawings for empty states. They use currentColor (the brand primary via the EmptyState
 * wrapper) for accents and the surface/border tokens for paper, so they work in light and dark.
 */
import * as React from "react";

type P = { className?: string; size?: number };

const Paper = (props: React.SVGProps<SVGRectElement>) => (
  <rect fill="var(--card)" stroke="var(--border)" strokeWidth={1.5} {...props} />
);

export function BillsIllustration({ className, size = 120 }: P) {
  return (
    <svg viewBox="0 0 120 96" width={size} height={(size * 96) / 120} className={className} aria-hidden>
      <ellipse cx="60" cy="88" rx="40" ry="5" fill="currentColor" opacity="0.08" />
      <g transform="rotate(-8 44 48)">
        <Paper x="22" y="14" width="44" height="58" rx="6" />
        <rect x="30" y="24" width="22" height="4" rx="2" fill="var(--border)" />
        <rect x="30" y="33" width="28" height="3" rx="1.5" fill="var(--border)" />
        <rect x="30" y="40" width="20" height="3" rx="1.5" fill="var(--border)" />
      </g>
      <Paper x="50" y="10" width="48" height="64" rx="6" />
      <rect x="58" y="20" width="20" height="5" rx="2.5" fill="currentColor" opacity="0.85" />
      <rect x="58" y="31" width="32" height="3" rx="1.5" fill="var(--border)" />
      <rect x="58" y="38" width="26" height="3" rx="1.5" fill="var(--border)" />
      <rect x="58" y="45" width="30" height="3" rx="1.5" fill="var(--border)" />
      <rect x="58" y="58" width="32" height="8" rx="4" fill="currentColor" opacity="0.15" />
      <circle cx="96" cy="70" r="12" fill="currentColor" />
      <path d="M96 64v12M90 70h12" stroke="var(--primary-foreground)" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

export function CreditBookIllustration({ className, size = 120 }: P) {
  return (
    <svg viewBox="0 0 120 96" width={size} height={(size * 96) / 120} className={className} aria-hidden>
      <ellipse cx="60" cy="88" rx="42" ry="5" fill="currentColor" opacity="0.08" />
      <path d="M18 18c14-4 28-4 42 4v58c-14-8-28-8-42-4z" fill="var(--card)" stroke="var(--border)" strokeWidth="1.5" />
      <path d="M102 18c-14-4-28-4-42 4v58c14-8 28-8 42-4z" fill="var(--card)" stroke="var(--border)" strokeWidth="1.5" />
      <path d="M60 22v58" stroke="currentColor" strokeWidth="2" opacity="0.5" />
      {[32, 42, 52, 62].map((y) => (
        <React.Fragment key={y}>
          <path d={`M26 ${y}c9-2 18-2 26 1`} stroke="var(--border)" strokeWidth="2.5" strokeLinecap="round" fill="none" />
          <path d={`M68 ${y + 1}c8-3 17-3 26-1`} stroke="var(--border)" strokeWidth="2.5" strokeLinecap="round" fill="none" />
        </React.Fragment>
      ))}
      <circle cx="94" cy="20" r="11" fill="currentColor" />
      <text x="94" y="24.5" textAnchor="middle" fontSize="13" fontWeight="700" fill="var(--primary-foreground)">
        ₹
      </text>
    </svg>
  );
}

export function BoxIllustration({ className, size = 120 }: P) {
  return (
    <svg viewBox="0 0 120 96" width={size} height={(size * 96) / 120} className={className} aria-hidden>
      <ellipse cx="60" cy="88" rx="40" ry="5" fill="currentColor" opacity="0.08" />
      <path d="M24 34l36-16 36 16v40L60 90 24 74z" fill="var(--card)" stroke="var(--border)" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M24 34l36 16 36-16M60 50v40" fill="none" stroke="var(--border)" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M42 26l36 16v12" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity="0.8" />
      <rect x="68" y="60" width="18" height="10" rx="2" fill="currentColor" opacity="0.15" transform="skewY(-24)" />
    </svg>
  );
}

export function TruckIllustration({ className, size = 120 }: P) {
  return (
    <svg viewBox="0 0 120 96" width={size} height={(size * 96) / 120} className={className} aria-hidden>
      <ellipse cx="60" cy="86" rx="46" ry="5" fill="currentColor" opacity="0.08" />
      <Paper x="14" y="30" width="58" height="40" rx="5" />
      <path d="M72 42h18l12 14v14H72z" fill="var(--card)" stroke="var(--border)" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M78 47h10l7 8H78z" fill="currentColor" opacity="0.2" />
      <rect x="22" y="40" width="24" height="5" rx="2.5" fill="currentColor" opacity="0.85" />
      <rect x="22" y="50" width="38" height="3" rx="1.5" fill="var(--border)" />
      {[32, 88].map((cx) => (
        <g key={cx}>
          <circle cx={cx} cy="74" r="8" fill="var(--foreground)" opacity="0.8" />
          <circle cx={cx} cy="74" r="3" fill="var(--card)" />
        </g>
      ))}
    </svg>
  );
}

export function PeopleIllustration({ className, size = 120 }: P) {
  return (
    <svg viewBox="0 0 120 96" width={size} height={(size * 96) / 120} className={className} aria-hidden>
      <ellipse cx="60" cy="88" rx="40" ry="5" fill="currentColor" opacity="0.08" />
      <circle cx="44" cy="36" r="13" fill="var(--card)" stroke="var(--border)" strokeWidth="1.5" />
      <path d="M20 80c2-16 12-24 24-24s22 8 24 24z" fill="var(--card)" stroke="var(--border)" strokeWidth="1.5" />
      <circle cx="78" cy="32" r="14" fill="currentColor" opacity="0.9" />
      <path d="M52 80c2-18 13-27 26-27s24 9 26 27z" fill="currentColor" opacity="0.9" />
      <path d="M72 32h12M78 26v12" stroke="var(--primary-foreground)" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

export function ChartIllustration({ className, size = 120 }: P) {
  return (
    <svg viewBox="0 0 120 96" width={size} height={(size * 96) / 120} className={className} aria-hidden>
      <Paper x="16" y="12" width="88" height="68" rx="8" />
      <path d="M28 64h64" stroke="var(--border)" strokeWidth="1.5" />
      <path d="M28 58l14-10 12 6 14-16 12 6 12-14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="92" cy="30" r="3.5" fill="currentColor" />
    </svg>
  );
}

export function CardIllustration({ className, size = 120 }: P) {
  return (
    <svg viewBox="0 0 120 96" width={size} height={(size * 96) / 120} className={className} aria-hidden>
      <ellipse cx="60" cy="86" rx="40" ry="5" fill="currentColor" opacity="0.08" />
      <rect x="18" y="22" width="76" height="48" rx="8" fill="currentColor" opacity="0.9" />
      <rect x="18" y="32" width="76" height="8" fill="var(--foreground)" opacity="0.25" />
      <rect x="26" y="52" width="26" height="5" rx="2.5" fill="var(--primary-foreground)" opacity="0.7" />
      <circle cx="92" cy="66" r="13" fill="var(--card)" stroke="var(--border)" strokeWidth="1.5" />
      <path d="M86 66l4 4 8-8" fill="none" stroke="var(--success)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
