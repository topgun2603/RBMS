"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "../lib/utils";
import { useReducedMotionSafe } from "./motion";

export interface RollingNumberProps {
  value: number | string;
  className?: string;
}

/**
 * A value that rolls vertically when it changes (up when it grows, down when it shrinks) — quantity steppers,
 * badges. Instant with reduced motion. The width is reserved by an invisible copy so neighbours never shift.
 */
export function RollingNumber({ value, className }: RollingNumberProps) {
  const reduced = useReducedMotionSafe();
  const prev = React.useRef(value);
  const dir = Number(value) >= Number(prev.current) ? 1 : -1;
  React.useEffect(() => {
    prev.current = value;
  }, [value]);
  return (
    <span className={cn("relative inline-flex justify-center overflow-hidden tabular-nums", className)} data-slot="rolling-number">
      <span className="invisible">{value}</span>
      <AnimatePresence initial={false} custom={dir}>
        <motion.span
          key={String(value)}
          custom={dir}
          className="absolute inset-0 flex items-center justify-center"
          variants={{
            enter: (d: number) => ({ y: reduced ? 0 : `${d * 100}%`, opacity: reduced ? 1 : 0 }),
            center: { y: 0, opacity: 1 },
            exit: (d: number) => ({ y: reduced ? 0 : `${d * -100}%`, opacity: 0 }),
          }}
          initial="enter"
          animate="center"
          exit="exit"
          transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 34 }}
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
