"use client";

import * as React from "react";
import {
  AwardIcon,
  BarChart3Icon,
  BookOpenIcon,
  CrosshairIcon,
  FlameIcon,
  HistoryIcon,
  MilestoneIcon,
  PanelsTopLeftIcon,
  ReceiptTextIcon,
  StarHalfIcon,
  TimerIcon,
  TrophyIcon,
  UsersIcon,
  BanknoteIcon,
  CalendarCheckIcon,
  CircleHelpIcon,
  ClapperboardIcon,
  CoinsIcon,
  Columns2Icon,
  ImagesIcon,
  InstagramIcon,
  LayoutGridIcon,
  MapPinIcon,
  SquareSplitHorizontalIcon,
  TicketPercentIcon,
  UtensilsCrossedIcon,
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
  ZapIcon,
  ListFilterIcon,
  CircleDotIcon,
  PanelLeftIcon,
  BookImageIcon,
  TableIcon,
  Grid2x2CheckIcon,
  RulerIcon,
  PaletteIcon,
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
  "hero-split": Columns2Icon,
  "hero-video": ClapperboardIcon,
  offer: TicketPercentIcon,
  gallery: ImagesIcon,
  logos: AwardIcon,
  "category-mosaic": LayoutGridIcon,
  faq: CircleHelpIcon,
  location: MapPinIcon,
  "menu-board": UtensilsCrossedIcon,
  appointment: CalendarCheckIcon,
  "before-after": SquareSplitHorizontalIcon,
  "gold-rates": CoinsIcon,
  instagram: InstagramIcon,
  "product-tabs": PanelsTopLeftIcon,
  deal: TimerIcon,
  "shop-the-look": CrosshairIcon,
  bestsellers: TrophyIcon,
  "recently-viewed": HistoryIcon,
  recommended: FlameIcon,
  stats: BarChart3Icon,
  timeline: MilestoneIcon,
  team: UsersIcon,
  "pricing-table": ReceiptTextIcon,
  "blog-posts": BookOpenIcon,
  "reviews-summary": StarHalfIcon,
  "flash-sale": ZapIcon,
  finder: ListFilterIcon,
  stories: CircleDotIcon,
  "category-shelf": PanelLeftIcon,
  "sticky-story": BookImageIcon,
  comparison: TableIcon,
  tiles: Grid2x2CheckIcon,
  "size-finder": RulerIcon,
  swatches: PaletteIcon,
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
    case "hero-split":
      return (
        <svg {...common}>
          {bar(8, 18, 44, 6, accent, 0.9)}
          {bar(8, 30, 40)}
          {bar(8, 37, 32)}
          <rect x="8" y="48" width="20" height="8" rx="4" fill={accent} />
          <rect x="31" y="48" width="20" height="8" rx="4" fill="none" stroke={accent} />
          <rect x="62" y="6" width="52" height="60" rx="6" fill={accent} opacity="0.22" />
          <path d="M70 56l12-14 9 8 7-5 12 11z" fill={accent} opacity="0.5" />
        </svg>
      );
    case "hero-video":
      return (
        <svg {...common}>
          <rect x="4" y="6" width="112" height="60" rx="6" fill="#111" opacity="0.75" />
          <circle cx="60" cy="28" r="10" fill="#fff" opacity="0.85" />
          <path d="M57 23l8 5-8 5z" fill="#111" />
          {bar(30, 46, 60, 5, "#fff", 0.85)}
          {bar(42, 55, 36, 3, "#fff", 0.5)}
        </svg>
      );
    case "offer":
      return (
        <svg {...common}>
          <rect x="4" y="12" width="112" height="48" rx="6" fill={accent} opacity="0.8" />
          {bar(12, 22, 44, 6, "#fff", 0.9)}
          {bar(12, 33, 34, 3, "#fff", 0.6)}
          {[0, 1, 2, 3].map((i) => (
            <rect key={i} x={66 + i * 11} y="20" width="9" height="12" rx="2" fill="#fff" opacity="0.3" />
          ))}
          <rect x="12" y="42" width="40" height="10" rx="3" fill="none" stroke="#fff" strokeDasharray="2 2" />
          <rect x="70" y="42" width="38" height="10" rx="5" fill="#fff" />
        </svg>
      );
    case "gallery":
      return (
        <svg {...common}>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <rect key={i} x={8 + (i % 3) * 36} y={8 + Math.floor(i / 3) * 30} width="32" height="26" rx="3" fill={accent} opacity={0.15 + (i % 3) * 0.1} />
          ))}
        </svg>
      );
    case "logos":
      return (
        <svg {...common}>
          {bar(36, 14, 48, 4, line)}
          {[0, 1, 2, 3].map((i) => (
            <rect key={i} x={8 + i * 27} y="32" width="22" height="12" rx="3" fill={paper} stroke={line} />
          ))}
        </svg>
      );
    case "category-mosaic":
      return (
        <svg {...common}>
          <rect x="6" y="6" width="52" height="60" rx="4" fill={accent} opacity="0.3" />
          <rect x="62" y="6" width="24" height="28" rx="4" fill={accent} opacity="0.2" />
          <rect x="90" y="6" width="24" height="28" rx="4" fill={accent} opacity="0.15" />
          <rect x="62" y="38" width="52" height="28" rx="4" fill={accent} opacity="0.22" />
          {bar(12, 56, 24, 4, "#fff", 0.9)}
        </svg>
      );
    case "faq":
      return (
        <svg {...common}>
          {[0, 1, 2].map((i) => (
            <g key={i}>
              <rect x="10" y={8 + i * 20} width="100" height="16" rx="3" fill={paper} stroke={line} />
              {bar(16, 14 + i * 20, 52, 4, i === 0 ? accent : line, i === 0 ? 0.8 : 1)}
              <path d={`M100 ${14 + i * 20}l3 3 3-3`} stroke={accent} fill="none" />
            </g>
          ))}
        </svg>
      );
    case "location":
      return (
        <svg {...common}>
          <rect x="6" y="8" width="46" height="56" rx="4" fill={paper} stroke={line} />
          {bar(12, 16, 30, 4, accent, 0.7)}
          {bar(12, 26, 34)}
          {bar(12, 33, 28)}
          <rect x="12" y="48" width="18" height="8" rx="4" fill={accent} />
          <rect x="56" y="8" width="58" height="56" rx="4" fill={accent} opacity="0.12" />
          <path d="M85 22a8 8 0 0 1 8 8c0 6-8 14-8 14s-8-8-8-14a8 8 0 0 1 8-8z" fill={accent} opacity="0.8" />
        </svg>
      );
    case "menu-board":
      return (
        <svg {...common}>
          {[0, 1].map((c) => (
            <g key={c}>
              <rect x={6 + c * 56} y="6" width="52" height="60" rx="4" fill={paper} stroke={line} />
              {bar(12 + c * 56, 13, 26, 5, accent, 0.7)}
              {[0, 1, 2].map((r) => (
                <g key={r}>
                  <rect x={12 + c * 56} y={26 + r * 12} width="5" height="5" rx="1" fill="none" stroke={r === 1 && c === 1 ? "#9a3412" : "#15803d"} />
                  {bar(20 + c * 56, 27 + r * 12, 18, 3)}
                  {bar(42 + c * 56, 27 + r * 12, 10, 3, accent, 0.8)}
                </g>
              ))}
            </g>
          ))}
        </svg>
      );
    case "appointment":
      return (
        <svg {...common}>
          <rect x="4" y="8" width="112" height="56" rx="6" fill={accent} opacity="0.85" />
          {bar(12, 18, 40, 6, "#fff", 0.9)}
          {bar(12, 29, 30, 3, "#fff", 0.6)}
          <rect x="12" y="42" width="26" height="10" rx="5" fill="#fff" />
          {[0, 1, 2].map((i) => (
            <rect key={i} x="64" y={14 + i * 15} width="46" height="12" rx="3" fill="#fff" opacity="0.9" />
          ))}
        </svg>
      );
    case "before-after":
      return (
        <svg {...common}>
          <rect x="6" y="8" width="54" height="56" rx="4" fill={line} />
          <rect x="60" y="8" width="54" height="56" rx="4" fill={accent} opacity="0.35" />
          <rect x="59" y="8" width="2" height="56" fill="#fff" />
          <circle cx="60" cy="36" r="7" fill="#fff" stroke={line} />
          <path d="M57 36h6M57 36l2-2M57 36l2 2M63 36l-2-2M63 36l-2 2" stroke={accent} />
        </svg>
      );
    case "gold-rates":
      return (
        <svg {...common}>
          {bar(8, 10, 44, 5, accent, 0.7)}
          {[0, 1, 2].map((i) => (
            <g key={i}>
              <rect x={8 + i * 36} y="22" width="32" height="40" rx="4" fill={i === 0 ? accent : paper} opacity={i === 0 ? 0.8 : 1} stroke={i === 0 ? "none" : line} />
              {bar(13 + i * 36, 30, 16, 3, i === 0 ? "#fff" : line)}
              {bar(13 + i * 36, 40, 22, 6, i === 0 ? "#fff" : accent, 0.85)}
              {bar(13 + i * 36, 52, 12, 3, i === 0 ? "#fff" : line, 0.6)}
            </g>
          ))}
        </svg>
      );
    case "instagram":
      return (
        <svg {...common}>
          {bar(8, 8, 36, 5, accent, 0.7)}
          <rect x="86" y="5" width="26" height="10" rx="5" fill="none" stroke={accent} />
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <rect key={i} x={8 + (i % 6) * 18} y="24" width="16" height="16" rx="2" fill={accent} opacity={0.15 + (i % 3) * 0.1} />
          ))}
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <rect key={i} x={8 + (i % 6) * 18} y="42" width="16" height="16" rx="2" fill={accent} opacity={0.3 - (i % 3) * 0.07} />
          ))}
        </svg>
      );
    case "product-tabs":
      return (
        <svg {...common}>
          <rect x="8" y="6" width="26" height="9" rx="4.5" fill={accent} />
          <rect x="37" y="6" width="22" height="9" rx="4.5" fill={paper} stroke={line} />
          <rect x="62" y="6" width="22" height="9" rx="4.5" fill={paper} stroke={line} />
          {[0, 1, 2, 3].map((i) => (
            <g key={i}>
              <rect x={8 + i * 27} y="22" width="23" height="28" rx="3" fill={paper} stroke={line} />
              {bar(8 + i * 27, 55, 18, 3)}
              {bar(8 + i * 27, 61, 10, 3, accent, 0.8)}
            </g>
          ))}
        </svg>
      );
    case "deal":
      return (
        <svg {...common}>
          <rect x="6" y="8" width="50" height="56" rx="5" fill={paper} stroke={line} />
          {bar(64, 12, 26, 3, accent, 0.8)}
          {bar(64, 20, 46, 6, accent, 0.6)}
          {bar(64, 31, 24, 4)}
          {[0, 1, 2, 3].map((i) => (
            <rect key={i} x={64 + i * 12} y="39" width="10" height="11" rx="2" fill={accent} opacity="0.3" />
          ))}
          <rect x="64" y="55" width="40" height="9" rx="4.5" fill={accent} />
        </svg>
      );
    case "shop-the-look":
      return (
        <svg {...common}>
          <rect x="6" y="6" width="66" height="60" rx="5" fill={accent} opacity="0.18" />
          {[
            [24, 24],
            [48, 40],
            [30, 52],
          ].map(([x, y], i) => (
            <g key={i}>
              <circle cx={x} cy={y} r="5" fill="#fff" stroke={accent} />
              <circle cx={x} cy={y} r="1.6" fill={accent} />
            </g>
          ))}
          {[0, 1, 2].map((i) => (
            <g key={i}>
              <rect x="78" y={8 + i * 20} width="12" height="14" rx="2" fill={paper} stroke={line} />
              {bar(93, 11 + i * 20, 20, 3)}
              {bar(93, 17 + i * 20, 12, 3, accent, 0.8)}
            </g>
          ))}
        </svg>
      );
    case "bestsellers":
    case "recommended":
    case "recently-viewed":
      return (
        <svg {...common}>
          {bar(8, 8, type === "bestsellers" ? 34 : 44, 5, accent, 0.7)}
          {type === "bestsellers" && <path d="M108 6l2 4 4 .6-3 2.8.7 4.1-3.7-2-3.7 2 .7-4.1-3-2.8 4-.6z" fill={accent} />}
          {[0, 1, 2, 3, 4].map((i) => (
            <g key={i} opacity={type === "recently-viewed" ? 1 - i * 0.15 : 1}>
              <rect x={8 + i * 23} y="18" width="20" height="28" rx="3" fill={paper} stroke={line} />
              {bar(8 + i * 23, 51, 16, 3)}
              {bar(8 + i * 23, 57, 9, 3, accent, 0.8)}
            </g>
          ))}
        </svg>
      );
    case "stats":
      return (
        <svg {...common}>
          {[0, 1, 2, 3].map((i) => (
            <g key={i}>
              <rect x={6 + i * 28} y="16" width="24" height="40" rx="4" fill={paper} stroke={line} />
              {bar(10 + i * 28, 27, 16, 8, accent, 0.85)}
              {bar(10 + i * 28, 42, 14, 3)}
            </g>
          ))}
        </svg>
      );
    case "timeline":
      return (
        <svg {...common}>
          <rect x="59" y="6" width="2" height="60" fill={accent} opacity="0.35" />
          {[0, 1, 2].map((i) => (
            <g key={i}>
              <circle cx="60" cy={14 + i * 22} r="4" fill={accent} />
              {i % 2 === 0 ? (
                <>
                  {bar(22, 10 + i * 22, 28, 4, accent, 0.7)}
                  {bar(16, 17 + i * 22, 34, 3)}
                </>
              ) : (
                <>
                  {bar(70, 10 + i * 22, 28, 4, accent, 0.7)}
                  {bar(70, 17 + i * 22, 34, 3)}
                </>
              )}
            </g>
          ))}
        </svg>
      );
    case "team":
      return (
        <svg {...common}>
          {[0, 1, 2, 3].map((i) => (
            <g key={i}>
              <rect x={6 + i * 28} y="8" width="24" height="56" rx="4" fill={paper} stroke={line} />
              <circle cx={18 + i * 28} cy="26" r="9" fill={accent} opacity="0.3" />
              {bar(10 + i * 28, 42, 16, 4, accent, 0.7)}
              {bar(10 + i * 28, 50, 12, 3)}
            </g>
          ))}
        </svg>
      );
    case "pricing-table":
      return (
        <svg {...common}>
          {[0, 1, 2].map((i) => (
            <g key={i}>
              <rect x={8 + i * 36} y={i === 1 ? 4 : 10} width="32" height={i === 1 ? 64 : 54} rx="4" fill={i === 1 ? accent : paper} opacity={i === 1 ? 0.85 : 1} stroke={i === 1 ? "none" : line} />
              {bar(13 + i * 36, i === 1 ? 12 : 18, 14, 3, i === 1 ? "#fff" : line)}
              {bar(13 + i * 36, i === 1 ? 20 : 26, 20, 6, i === 1 ? "#fff" : accent, 0.85)}
              {[0, 1, 2].map((j) => bar(13 + i * 36, (i === 1 ? 32 : 38) + j * 6, 18, 2.5, i === 1 ? "#fff" : line, 0.7))}
            </g>
          ))}
        </svg>
      );
    case "blog-posts":
      return (
        <svg {...common}>
          {[0, 1, 2].map((i) => (
            <g key={i}>
              <rect x={6 + i * 37} y="8" width="34" height="22" rx="3" fill={accent} opacity={0.2 + i * 0.08} />
              {bar(6 + i * 37, 35, 30, 4, accent, 0.7)}
              {bar(6 + i * 37, 43, 26, 3)}
              {bar(6 + i * 37, 49, 20, 3)}
            </g>
          ))}
        </svg>
      );
    case "reviews-summary":
      return (
        <svg {...common}>
          <rect x="6" y="8" width="36" height="56" rx="4" fill={paper} stroke={line} />
          {bar(12, 16, 16, 8, accent, 0.85)}
          {[0, 1, 2, 3, 4].map((i) => bar(12, 30 + i * 6, 24 - i * 4, 3, accent, 0.5))}
          {[0, 1].map((r) =>
            [0, 1].map((c) => (
              <g key={`${r}${c}`}>
                <rect x={48 + c * 35} y={8 + r * 29} width="32" height="26" rx="3" fill={paper} stroke={line} />
                {bar(52 + c * 35, 13 + r * 29, 14, 3, accent, 0.8)}
                {bar(52 + c * 35, 20 + r * 29, 22, 3)}
              </g>
            )),
          )}
        </svg>
      );
    case "flash-sale":
      return (
        <svg {...common}>
          <rect x="4" y="5" width="112" height="22" rx="4" fill={accent} opacity="0.85" />
          <path d="M14 9l-5 8h4l-2 6 6-9h-4l2-5z" fill="#fff" />
          {bar(22, 11, 30, 4, "#fff")}
          {bar(22, 18, 20, 3, "#fff", 0.7)}
          {[0, 1, 2, 3].map((i) => (
            <rect key={i} x={70 + i * 11} y="10" width="9" height="12" rx="2" fill="#fff" opacity="0.35" />
          ))}
          {[0, 1, 2, 3].map((i) => (
            <g key={i}>
              <rect x={6 + i * 28} y="32" width="24" height="24" rx="3" fill={paper} stroke={line} />
              {bar(6 + i * 28, 60, 18, 3)}
            </g>
          ))}
        </svg>
      );
    case "finder":
      return (
        <svg {...common}>
          <rect x="6" y="6" width="108" height="60" rx="5" fill={paper} stroke={line} />
          {[0, 1, 2].map((i) => (
            <rect key={i} x={14 + i * 32} y="12" width="28" height="3" rx="1.5" fill={accent} opacity={i === 0 ? 0.9 : 0.25} />
          ))}
          {bar(14, 22, 52, 5, accent, 0.7)}
          {[0, 1, 2].map((i) => (
            <g key={i}>
              <rect x={14 + i * 32} y="33" width="28" height="24" rx="3" fill={i === 1 ? accent : "transparent"} opacity={i === 1 ? 0.2 : 1} stroke={i === 1 ? accent : line} />
              {bar(18 + i * 32, 50, 16, 3, i === 1 ? accent : line)}
            </g>
          ))}
        </svg>
      );
    case "stories":
      return (
        <svg {...common}>
          {[0, 1, 2, 3, 4].map((i) => (
            <g key={i}>
              <circle cx={16 + i * 22} cy="30" r="10" fill="none" stroke={accent} strokeWidth="2" opacity={1 - i * 0.12} />
              <circle cx={16 + i * 22} cy="30" r="7" fill={accent} opacity="0.22" />
              {bar(9 + i * 22, 46, 14, 3)}
            </g>
          ))}
        </svg>
      );
    case "category-shelf":
      return (
        <svg {...common}>
          <rect x="6" y="8" width="30" height="56" rx="4" fill={paper} stroke={line} />
          {[0, 1, 2, 3, 4].map((i) => (
            <rect key={i} x="10" y={13 + i * 10} width="22" height="6" rx="2" fill={i === 1 ? accent : line} opacity={i === 1 ? 0.85 : 0.7} />
          ))}
          {[0, 1].map((r) =>
            [0, 1, 2].map((c) => (
              <g key={`${r}${c}`}>
                <rect x={42 + c * 25} y={8 + r * 29} width="22" height="19" rx="3" fill={paper} stroke={line} />
                {bar(42 + c * 25, 30 + r * 29, 14, 2.5)}
              </g>
            )),
          )}
        </svg>
      );
    case "sticky-story":
      return (
        <svg {...common}>
          <rect x="6" y="6" width="50" height="60" rx="5" fill={accent} opacity="0.22" />
          <rect x="6" y="6" width="50" height="60" rx="5" fill="none" stroke={accent} strokeDasharray="3 3" opacity="0.5" />
          {[0, 1, 2].map((i) => (
            <g key={i} opacity={i === 1 ? 1 : 0.45}>
              {bar(64, 10 + i * 20, 10, 3, accent, 0.9)}
              {bar(64, 16 + i * 20, 40, 4, accent, 0.6)}
              {bar(64, 23 + i * 20, 48, 3)}
            </g>
          ))}
        </svg>
      );
    case "tiles":
      return (
        <svg {...common}>
          {[0, 1, 2, 3].map((i) => (
            <g key={i}>
              <rect x={6 + i * 28} y="10" width="24" height="52" rx="4" fill={paper} stroke={line} />
              <rect x={9 + i * 28} y="13" width="18" height="18" rx="3" fill={accent} opacity={0.2 + i * 0.1} />
              {bar(9 + i * 28, 36, 16, 3.5, accent, 0.8)}
              {bar(9 + i * 28, 43, 18, 2.5)}
              {bar(9 + i * 28, 49, 12, 2.5)}
            </g>
          ))}
        </svg>
      );
    case "swatches":
      return (
        <svg {...common}>
          {bar(8, 10, 34, 5, accent, 0.7)}
          {["#9b111e", "#c2185b", "#d77a61", "#c8a08a", "#8d5524", "#6b2737", "#e0a899", "#a0522d"].map((c, i) => (
            <circle key={i} cx={14 + (i % 4) * 14} cy={30 + Math.floor(i / 4) * 14} r="5.5" fill={c} stroke={i === 2 ? "currentColor" : "none"} strokeWidth="1.5" />
          ))}
          <rect x="68" y="18" width="46" height="44" rx="4" fill={paper} stroke={line} />
          <circle cx="78" cy="30" r="5" fill="#d77a61" />
          {bar(86, 28, 22, 3)}
          <rect x="74" y="48" width="34" height="8" rx="4" fill={accent} />
        </svg>
      );
    case "size-finder":
      return (
        <svg {...common}>
          <rect x="6" y="6" width="108" height="60" rx="5" fill={accent} opacity="0.1" />
          {bar(12, 12, 40, 5, accent, 0.7)}
          <rect x="12" y="22" width="56" height="10" rx="5" fill={paper} stroke={line} />
          <rect x="13" y="23" width="18" height="8" rx="4" fill={accent} />
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <rect key={i} x={12 + i * 16} y="38" width="13" height="11" rx="2.5" fill={i === 2 ? accent : "transparent"} stroke={i === 2 ? accent : line} />
          ))}
          <rect x="12" y="54" width="24" height="8" rx="2" fill={paper} stroke={line} />
        </svg>
      );
    case "comparison":
      return (
        <svg {...common}>
          <rect x="6" y="6" width="108" height="60" rx="4" fill={paper} stroke={line} />
          <rect x="72" y="6" width="21" height="60" fill={accent} opacity="0.14" />
          {[0, 1, 2].map((c) => (
            <rect key={c} x={52 + c * 21} y="10" width="16" height="14" rx="2" fill={accent} opacity={0.25 + c * 0.1} />
          ))}
          {[0, 1, 2, 3].map((r) => (
            <g key={r}>
              <rect x="6" y={29 + r * 9} width="108" height="0.8" fill={line} />
              {bar(10, 32 + r * 9, 30, 3)}
              {[0, 1, 2].map((c) => (
                <React.Fragment key={c}>{bar(54 + c * 21, 32 + r * 9, 12, 3, accent, 0.55)}</React.Fragment>
              ))}
            </g>
          ))}
        </svg>
      );
  }
}
