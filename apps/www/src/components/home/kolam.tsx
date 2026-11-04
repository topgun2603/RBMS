"use client";

import * as React from "react";
import { motion, useReducedMotionSafe, useScroll, useSpring, useTransform } from "@rbms/ui/motion";

const CELL = 40;

/**
 * A sikku (one-line) kolam, built the way the drawing is: a line that bounces around a grid of dots and never lifts off
 * the floor. A billiard path in a grid whose sides share no factor closes as a single line; rounding each bounce gives
 * the loops.
 */
function kolamOf(cols: number, rows: number) {
  const pts: [number, number][] = [];
  let x = 0;
  let y = 1;
  let dx = 1;
  let dy = 1;
  do {
    pts.push([x * (CELL / 2), y * (CELL / 2)]);
    x += dx;
    y += dy;
    if (x <= 0 || x >= cols * 2) dx = -dx;
    if (y <= 0 || y >= rows * 2) dy = -dy;
  } while (!(x === 0 && y === 1 && dx === 1 && dy === 1));
  const mid = (a: [number, number], b: [number, number]) => `${(a[0] + b[0]) / 2} ${(a[1] + b[1]) / 2}`;
  let d = `M ${mid(pts[pts.length - 1]!, pts[0]!)}`;
  pts.forEach((p, i) => {
    d += ` Q ${p[0]} ${p[1]} ${mid(p, pts[(i + 1) % pts.length]!)}`;
  });
  const dots: [number, number][] = [];
  for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) dots.push([(c + 0.5) * CELL, (r + 0.5) * CELL]);
  return { d, dots, w: cols * CELL, h: rows * CELL };
}

/** Draws itself as its parent scrolls past. `cols` and `rows` must share no factor, or the line would not be one line. */
export function Kolam({ cols = 7, rows = 5, className, strokeWidth = 3 }: { cols?: number; rows?: number; className?: string; strokeWidth?: number }) {
  const { d, dots, w, h } = React.useMemo(() => kolamOf(cols, rows), [cols, rows]);
  const ref = React.useRef<SVGSVGElement>(null);
  const reduced = useReducedMotionSafe();
  const { scrollYProgress } = useScroll({ target: ref as unknown as React.RefObject<HTMLElement>, offset: ["start end", "end 45%"] });
  const smooth = useSpring(scrollYProgress, { stiffness: 80, damping: 22, mass: 0.4 });
  const length = useTransform(smooth, [0, 1], [0.04, 1]);
  return (
    <svg ref={ref} viewBox={`-6 -6 ${w + 12} ${h + 12}`} className={className} fill="none" aria-hidden="true">
      {dots.map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r={2.6} fill="currentColor" opacity={0.75} />
      ))}
      <motion.path d={d} stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" style={reduced ? undefined : { pathLength: length }} />
    </svg>
  );
}
