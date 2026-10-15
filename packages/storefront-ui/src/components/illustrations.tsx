import * as React from "react";

/*
 * Friendly empty-state illustrations. Inline SVG (no requests), drawn in `currentColor` (the shop's primary through
 * `text-primary`) with soft tints, plus a warm neutral, so they follow the tenant brand and dark mode.
 */

type P = { className?: string };

const Base = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <svg viewBox="0 0 200 160" fill="none" className={className} aria-hidden="true" focusable="false">
    <ellipse cx="100" cy="146" rx="62" ry="7" fill="currentColor" fillOpacity=".1" />
    {/* kolam dots */}
    <g fill="currentColor" fillOpacity=".25">
      <circle cx="24" cy="30" r="2" />
      <circle cx="36" cy="18" r="1.5" />
      <circle cx="176" cy="40" r="2" />
      <circle cx="166" cy="24" r="1.5" />
      <circle cx="182" cy="96" r="1.5" />
      <circle cx="16" cy="92" r="1.5" />
    </g>
    {children}
  </svg>
);

export function EmptyBagArt({ className }: P) {
  return (
    <Base className={className}>
      <path d="M62 56h76l8 84H54l8-84Z" fill="currentColor" fillOpacity=".14" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
      <path d="M80 62V48a20 20 0 0 1 40 0v14" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <circle cx="80" cy="64" r="3.5" fill="currentColor" />
      <circle cx="120" cy="64" r="3.5" fill="currentColor" />
      <path d="M84 104c4 5 9 7 16 7s12-2 16-7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <circle cx="88" cy="90" r="3" fill="currentColor" />
      <circle cx="112" cy="90" r="3" fill="currentColor" />
      <path d="M150 34l4 8 8 4-8 4-4 8-4-8-8-4 8-4 4-8Z" fill="#f2b84b" />
    </Base>
  );
}

export function NoResultsArt({ className }: P) {
  return (
    <Base className={className}>
      <rect x="44" y="40" width="74" height="92" rx="10" fill="currentColor" fillOpacity=".1" stroke="currentColor" strokeWidth="3" />
      <path d="M58 62h46M58 76h34M58 90h40" stroke="currentColor" strokeOpacity=".5" strokeWidth="3" strokeLinecap="round" />
      <circle cx="122" cy="92" r="26" fill="var(--background, #fff)" stroke="currentColor" strokeWidth="4" />
      <path d="M141 111l20 20" stroke="currentColor" strokeWidth="7" strokeLinecap="round" />
      <path d="M113 86c1.5-5 5-7 9-7s8 3 8 7c0 5-8 6-8 11" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <circle cx="122" cy="104" r="2.2" fill="currentColor" />
    </Base>
  );
}

export function NoOrdersArt({ className }: P) {
  return (
    <Base className={className}>
      <path d="M100 30 150 54v58l-50 24-50-24V54l50-24Z" fill="currentColor" fillOpacity=".12" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
      <path d="M50 54l50 24 50-24M100 78v58" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
      <path d="M75 42l50 24v18" stroke="currentColor" strokeOpacity=".55" strokeWidth="3" strokeLinecap="round" />
      <path d="M150 28c8 0 14 6 14 14" stroke="#f2b84b" strokeWidth="3" strokeLinecap="round" />
      <path d="M156 18c13 0 22 10 22 22" stroke="#f2b84b" strokeOpacity=".6" strokeWidth="3" strokeLinecap="round" />
    </Base>
  );
}

export function EmptyWishlistArt({ className }: P) {
  return (
    <Base className={className}>
      <path
        d="M100 132S48 102 48 68c0-16 12-28 27-28 11 0 20 6 25 15 5-9 14-15 25-15 15 0 27 12 27 28 0 34-52 64-52 64Z"
        fill="currentColor"
        fillOpacity=".14"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <path d="M72 64c2-6 7-9 12-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <path d="M152 30l3 6 6 3-6 3-3 6-3-6-6-3 6-3 3-6ZM40 110l2 4 4 2-4 2-2 4-2-4-4-2 4-2 2-4Z" fill="#f2b84b" />
    </Base>
  );
}

export function LostArt({ className }: P) {
  return (
    <Base className={className}>
      <circle cx="100" cy="82" r="50" fill="currentColor" fillOpacity=".1" stroke="currentColor" strokeWidth="3" />
      <circle cx="100" cy="82" r="38" stroke="currentColor" strokeOpacity=".35" strokeWidth="2" strokeDasharray="3 6" />
      <path d="M100 52l12 30-12 30-12-30 12-30Z" fill="currentColor" fillOpacity=".25" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
      <path d="M100 52l12 30H88l12-30Z" fill="currentColor" />
      <circle cx="100" cy="82" r="4" fill="var(--background, #fff)" stroke="currentColor" strokeWidth="2" />
    </Base>
  );
}

export function OfflineArt({ className }: P) {
  return (
    <Base className={className}>
      <path d="M60 112h82a24 24 0 0 0 2-48 34 34 0 0 0-64-8 26 26 0 0 0-20 56Z" fill="currentColor" fillOpacity=".12" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
      <path d="M82 80l36 36M118 80l-36 36" stroke="currentColor" strokeWidth="4" strokeLinecap="round" opacity=".7" />
    </Base>
  );
}
