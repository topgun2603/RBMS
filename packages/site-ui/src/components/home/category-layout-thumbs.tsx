import * as React from "react";
import type { CategoryLayout } from "../../lib/sections";

/*
 * Tiny sketches of each categories-section layout for the layout picker (64×40, drawn in currentColor; the "photo"
 * areas use a lighter fill so the shapes read at a glance).
 */

const P = { fill: "currentColor", fillOpacity: 0.22 } as const;
const S = { fill: "currentColor", fillOpacity: 0.55 } as const;
const L = { stroke: "currentColor", strokeOpacity: 0.55, strokeWidth: 1.5, strokeLinecap: "round" as const };
const label = (x: number, y: number, w = 8) => <rect x={x} y={y} width={w} height={2} rx={1} {...S} />;

const SKETCH: Record<CategoryLayout, React.ReactNode> = {
  circles: (
    <>
      {[12, 26, 40, 54].map((x) => (
        <g key={x}>
          <circle cx={x} cy={17} r={6} {...P} />
          {label(x - 4, 27)}
        </g>
      ))}
    </>
  ),
  "rounded-squares": (
    <>
      {[6, 20, 34, 48].map((x) => (
        <g key={x}>
          <rect x={x} y={10} width={11} height={11} rx={3.5} {...P} />
          {label(x + 1.5, 26)}
        </g>
      ))}
    </>
  ),
  "story-rings": (
    <>
      {[12, 26, 40, 54].map((x) => (
        <g key={x}>
          <circle cx={x} cy={17} r={6} fill="none" stroke="currentColor" strokeWidth={1.4} />
          <circle cx={x} cy={17} r={4} {...P} />
          {label(x - 4, 27)}
        </g>
      ))}
    </>
  ),
  pills: (
    <>
      {[
        [4, 18],
        [24, 16],
        [42, 20],
      ].map(([x, w]) => (
        <g key={x}>
          <rect x={x} y={15} width={w} height={9} rx={4.5} fill="none" stroke="currentColor" strokeOpacity={0.45} />
          <circle cx={x! + 4.5} cy={19.5} r={2.6} {...P} />
          {label(x! + 8.5, 18.5, w! - 11)}
        </g>
      ))}
    </>
  ),
  "icon-list": (
    <>
      {[
        [6, 9, 22],
        [31, 9, 26],
        [16, 22, 30],
      ].map(([x, y, w]) => (
        <g key={`${x}-${y}`}>
          <rect x={x} y={y} width={w} height={9} rx={4.5} fill="none" stroke="currentColor" strokeOpacity={0.45} />
          <circle cx={x! + 4.5} cy={y! + 4.5} r={2.8} {...P} />
          {label(x! + 9, y! + 3.5, w! - 12)}
        </g>
      ))}
    </>
  ),
  cards: (
    <>
      {[5, 20, 35, 50].map((x) => (
        <g key={x}>
          <rect x={x} y={8} width={11} height={22} rx={2} fill="none" stroke="currentColor" strokeOpacity={0.35} />
          <rect x={x} y={8} width={11} height={14} rx={2} {...P} />
          {label(x + 2, 25, 7)}
        </g>
      ))}
    </>
  ),
  tiles: (
    <>
      {[6, 24, 42].map((x) => (
        <g key={x}>
          <rect x={x} y={7} width={16} height={16} rx={2.5} {...P} />
          {label(x + 2, 19, 7)}
        </g>
      ))}
      {[6, 24].map((x) => (
        <rect key={x} x={x} y={25} width={16} height={9} rx={2.5} {...P} />
      ))}
    </>
  ),
  "banner-row": (
    <>
      {[
        [4, 8],
        [33, 8],
        [4, 22],
      ].map(([x, y]) => (
        <g key={`${x}-${y}`}>
          <rect x={x} y={y} width={27} height={11} rx={2} fill="none" stroke="currentColor" strokeOpacity={0.4} />
          <rect x={x! + 1.5} y={y! + 1.5} width={8} height={8} rx={1.5} {...P} />
          {label(x! + 12, y! + 3, 10)}
          {label(x! + 12, y! + 6.5, 6)}
        </g>
      ))}
    </>
  ),
  "big-grid": (
    <>
      {[4, 24, 44].map((x) => (
        <g key={x}>
          <rect x={x} y={9} width={17} height={22} rx={2.5} {...P} />
          {label(x + 2, 26, 9)}
        </g>
      ))}
    </>
  ),
  bento: (
    <>
      <rect x={4} y={5} width={27} height={30} rx={2.5} {...P} />
      <rect x={33} y={5} width={13} height={14} rx={2} {...P} />
      <rect x={48} y={5} width={12} height={14} rx={2} {...P} />
      <rect x={33} y={21} width={27} height={14} rx={2} {...P} />
      {label(7, 30, 10)}
    </>
  ),
  slider: (
    <>
      {[2, 19, 36, 53].map((x) => (
        <g key={x}>
          <rect x={x} y={5} width={15} height={26} rx={2} {...P} opacity={x === 53 ? 0.5 : 1} />
          {label(x + 2, 26, 8)}
        </g>
      ))}
      <circle cx={58} cy={18} r={3.5} fill="currentColor" fillOpacity={0.9} />
    </>
  ),
  "minimal-list": (
    <>
      {[9, 19, 29].map((y) => (
        <g key={y}>
          {label(6, y - 1, 3)}
          <rect x={13} y={y - 2} width={26} height={3.5} rx={1.5} {...S} />
          <path d={`M53 ${y - 2.5}l2.5 2.5-2.5 2.5`} fill="none" {...L} />
          <path d={`M6 ${y + 4}h52`} {...L} strokeOpacity={0.2} strokeWidth={1} />
        </g>
      ))}
    </>
  ),
};

export function CategoryLayoutThumb({ layout, className }: { layout: CategoryLayout; className?: string }) {
  return (
    <svg viewBox="0 0 64 40" aria-hidden className={className} data-thumb={layout}>
      {SKETCH[layout]}
    </svg>
  );
}
