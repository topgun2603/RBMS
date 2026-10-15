"use client";

import * as React from "react";
import {
  BanknoteIcon,
  CheckCircle2Icon,
  ClockIcon,
  FolderTreeIcon,
  GalleryHorizontalEndIcon,
  GiftIcon,
  HeartIcon,
  ImageIcon,
  LayersIcon,
  LayoutPanelLeftIcon,
  LeafIcon,
  MailIcon,
  MessageSquareQuoteIcon,
  PackageIcon,
  PhoneIcon,
  RotateCcwIcon,
  ShieldCheckIcon,
  SparklesIcon,
  StarIcon,
  TagIcon,
  TruckIcon,
  TypeIcon,
} from "lucide-react";
import type { HomeSectionType } from "../../lib/content";
import { uspIconKey } from "../../lib/sections";

type Icon = React.ComponentType<{ className?: string }>;

export const SECTION_ICONS: Record<HomeSectionType, Icon> = {
  hero: GalleryHorizontalEndIcon,
  categories: FolderTreeIcon,
  collection: LayersIcon,
  products: PackageIcon,
  banner: ImageIcon,
  text: TypeIcon,
  "image-text": LayoutPanelLeftIcon,
  testimonials: MessageSquareQuoteIcon,
  usp: SparklesIcon,
  newsletter: MailIcon,
};

/** Storefront USP icon keys → lucide icons (the storefront uses the same meanings). */
export const USP_ICON_MAP: Record<string, Icon> = {
  truck: TruckIcon,
  cash: BanknoteIcon,
  return: RotateCcwIcon,
  shield: ShieldCheckIcon,
  star: StarIcon,
  gift: GiftIcon,
  phone: PhoneIcon,
  leaf: LeafIcon,
  clock: ClockIcon,
  tag: TagIcon,
  heart: HeartIcon,
  check: CheckCircle2Icon,
};

export const uspIcon = (key: string): Icon => USP_ICON_MAP[uspIconKey(key) ?? ""] ?? CheckCircle2Icon;

/**
 * Little wireframe of each section type for the "Add section" gallery. Uses currentColor (primary) for accents and
 * surface tokens for the paper, so it reads in light and dark.
 */
export function SectionThumb({ type, className }: { type: HomeSectionType; className?: string }) {
  const paper = "var(--muted)";
  const line = "var(--border)";
  const accent = "currentColor";
  const common = { viewBox: "0 0 120 72", className, "aria-hidden": true } as const;
  const bar = (x: number, y: number, w: number, h = 4, fill = line, o = 1) => <rect x={x} y={y} width={w} height={h} rx={h / 2} fill={fill} opacity={o} />;
  switch (type) {
    case "hero":
      return (
        <svg {...common}>
          <rect x="4" y="6" width="112" height="60" rx="6" fill={accent} opacity="0.18" />
          {bar(14, 24, 52, 6, accent, 0.9)}
          {bar(14, 35, 36)}
          <rect x="14" y="46" width="24" height="9" rx="4.5" fill={accent} />
          <circle cx="56" cy="61" r="1.6" fill={accent} />
          <circle cx="62" cy="61" r="1.6" fill={line} />
          <circle cx="68" cy="61" r="1.6" fill={line} />
        </svg>
      );
    case "categories":
      return (
        <svg {...common}>
          {bar(8, 10, 40, 5, accent, 0.7)}
          {[0, 1, 2, 3].map((i) => (
            <g key={i}>
              <circle cx={20 + i * 27} cy="38" r="11" fill={paper} stroke={line} />
              {bar(12 + i * 27, 55, 16, 3)}
            </g>
          ))}
        </svg>
      );
    case "collection":
    case "products":
      return (
        <svg {...common}>
          {bar(8, 8, type === "collection" ? 46 : 36, 5, accent, 0.7)}
          {[0, 1, 2, 3].map((i) => (
            <g key={i}>
              <rect x={8 + i * 27} y="18" width="23" height="28" rx="3" fill={paper} stroke={line} />
              {bar(8 + i * 27, 51, 18, 3)}
              {bar(8 + i * 27, 58, 10, 3, accent, 0.8)}
            </g>
          ))}
        </svg>
      );
    case "banner":
      return (
        <svg {...common}>
          <rect x="4" y="18" width="112" height="36" rx="5" fill={accent} opacity="0.22" />
          <path d="M14 48l14-14 10 9 8-6 16 11z" fill={accent} opacity="0.55" />
          <circle cx="96" cy="30" r="5" fill={accent} opacity="0.55" />
        </svg>
      );
    case "text":
      return (
        <svg {...common}>
          {bar(24, 14, 72, 6, accent, 0.7)}
          {bar(14, 28, 92)}
          {bar(14, 36, 86)}
          {bar(14, 44, 90)}
          {bar(14, 52, 60)}
        </svg>
      );
    case "image-text":
      return (
        <svg {...common}>
          <rect x="6" y="10" width="50" height="52" rx="5" fill={accent} opacity="0.22" />
          {bar(64, 16, 44, 6, accent, 0.7)}
          {bar(64, 28, 48)}
          {bar(64, 36, 40)}
          {bar(64, 44, 44)}
          <rect x="64" y="52" width="22" height="8" rx="4" fill={accent} />
        </svg>
      );
    case "testimonials":
      return (
        <svg {...common}>
          {[0, 1].map((i) => (
            <g key={i}>
              <rect x={8 + i * 56} y="12" width="48" height="48" rx="5" fill={paper} stroke={line} />
              <text x={14 + i * 56} y="30" fontSize="16" fill={accent} opacity="0.8">
                “
              </text>
              {bar(14 + i * 56, 34, 36, 3)}
              {bar(14 + i * 56, 41, 30, 3)}
              {bar(14 + i * 56, 50, 18, 3, accent, 0.7)}
            </g>
          ))}
        </svg>
      );
    case "usp":
      return (
        <svg {...common}>
          {[0, 1, 2].map((i) => (
            <g key={i}>
              <circle cx={24 + i * 36} cy="28" r="9" fill={accent} opacity="0.25" />
              <circle cx={24 + i * 36} cy="28" r="4" fill={accent} />
              {bar(12 + i * 36, 44, 24, 4)}
              {bar(15 + i * 36, 52, 18, 3, line, 0.8)}
            </g>
          ))}
        </svg>
      );
    case "newsletter":
      return (
        <svg {...common}>
          <rect x="4" y="8" width="112" height="56" rx="6" fill={paper} />
          {bar(32, 18, 56, 6, accent, 0.7)}
          {bar(26, 29, 68)}
          <rect x="18" y="40" width="58" height="12" rx="4" fill="var(--card)" stroke={line} />
          <rect x="80" y="40" width="24" height="12" rx="4" fill={accent} />
        </svg>
      );
  }
}
