/**
 * Small inline SVG drawings for empty states. currentColor (the brand primary via EmptyState) for accents and the
 * surface/border tokens for paper, so they work in light and dark.
 */
type P = { className?: string; size?: number };

export function OrdersIllustration({ className, size = 128 }: P) {
  return (
    <svg viewBox="0 0 128 100" width={size} height={(size * 100) / 128} className={className} aria-hidden>
      <ellipse cx="64" cy="92" rx="46" ry="5" fill="currentColor" opacity="0.08" />
      {/* parcel */}
      <path d="M26 44l30-12 30 12v32l-30 12-30-12z" fill="var(--card)" stroke="var(--border)" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M26 44l30 12 30-12M56 56v32" fill="none" stroke="var(--border)" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M41 38l30 12v10" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity="0.85" />
      {/* receipt */}
      <g transform="rotate(8 98 40)">
        <path d="M84 18h26v38l-4.3-3-4.4 3-4.3-3-4.4 3-4.3-3-4.3 3z" fill="var(--card)" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        <rect x="89" y="25" width="16" height="3" rx="1.5" fill="currentColor" opacity="0.8" />
        <rect x="89" y="32" width="12" height="2.5" rx="1.25" fill="var(--border)" />
        <rect x="89" y="38" width="14" height="2.5" rx="1.25" fill="var(--border)" />
      </g>
      <circle cx="102" cy="78" r="11" fill="currentColor" />
      <path d="M97 78.5l3.4 3.4 6.6-6.8" fill="none" stroke="var(--primary-foreground)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function CouponsIllustration({ className, size = 124 }: P) {
  return (
    <svg viewBox="0 0 124 96" width={size} height={(size * 96) / 124} className={className} aria-hidden>
      <ellipse cx="62" cy="88" rx="42" ry="5" fill="currentColor" opacity="0.08" />
      <g transform="rotate(-8 62 48)">
        <path
          d="M18 30h88v12a6 6 0 0 0 0 12v12H18V54a6 6 0 0 0 0-12z"
          fill="var(--card)"
          stroke="var(--border)"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <path d="M44 32v32" stroke="var(--border)" strokeWidth="1.5" strokeDasharray="3 3" />
        <circle cx="31" cy="42" r="3.5" fill="currentColor" />
        <circle cx="31" cy="56" r="3.5" fill="currentColor" opacity="0.5" />
        <rect x="54" y="40" width="40" height="5" rx="2.5" fill="currentColor" opacity="0.85" />
        <rect x="54" y="51" width="26" height="4" rx="2" fill="var(--border)" />
      </g>
      <circle cx="98" cy="22" r="10" fill="currentColor" />
      <path d="M94 26l8-8M94.5 18.5h.01M101.5 25.5h.01" stroke="var(--primary-foreground)" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

export function DeliveryIllustration({ className, size = 128 }: P) {
  return (
    <svg viewBox="0 0 128 96" width={size} height={(size * 96) / 128} className={className} aria-hidden>
      <ellipse cx="64" cy="88" rx="46" ry="5" fill="currentColor" opacity="0.08" />
      <rect x="18" y="34" width="54" height="36" rx="4" fill="var(--card)" stroke="var(--border)" strokeWidth="1.5" />
      <path d="M72 44h18l12 12v14H72z" fill="currentColor" opacity="0.18" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M78 48h10l7 8H78z" fill="var(--card)" />
      <circle cx="36" cy="72" r="7" fill="var(--card)" stroke="currentColor" strokeWidth="3" />
      <circle cx="88" cy="72" r="7" fill="var(--card)" stroke="currentColor" strokeWidth="3" />
      <rect x="26" y="44" width="26" height="4" rx="2" fill="currentColor" opacity="0.8" />
      <rect x="26" y="52" width="18" height="3" rx="1.5" fill="var(--border)" />
      <path d="M104 18c-6 0-10 4.5-10 10 0 7.5 10 16 10 16s10-8.5 10-16c0-5.5-4-10-10-10z" fill="currentColor" />
      <circle cx="104" cy="28" r="3.5" fill="var(--primary-foreground)" />
    </svg>
  );
}

