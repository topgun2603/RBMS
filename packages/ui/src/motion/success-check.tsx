"use client";

import * as React from "react";
import { motion } from "motion/react";
import { cn } from "../lib/utils";
import { useReducedMotionSafe } from "./motion";

export interface SuccessCheckProps {
  /** Diameter in px (default 72). */
  size?: number;
  className?: string;
  /** Accessible label; when omitted the graphic is decorative. */
  label?: string;
}

/**
 * Celebratory check: the disc pops in, the tick draws itself and a soft ring bursts outward.
 * Colour comes from `currentColor` (defaults to the success token). Static with reduced motion.
 */
export function SuccessCheck({ size = 72, className, label }: SuccessCheckProps) {
  const reduced = useReducedMotionSafe();
  const spring = reduced ? { duration: 0 } : { type: "spring" as const, stiffness: 420, damping: 18 };
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn("relative inline-flex items-center justify-center text-success", className)}
      style={{ width: size, height: size }}
    >
      {!reduced && (
        <motion.span
          className="absolute inset-0 rounded-full border-2 border-current"
          initial={{ scale: 0.6, opacity: 0.7 }}
          animate={{ scale: 1.7, opacity: 0 }}
          transition={{ duration: 0.8, ease: "easeOut", delay: 0.15 }}
        />
      )}
      <motion.svg
        viewBox="0 0 52 52"
        width={size}
        height={size}
        initial={{ scale: reduced ? 1 : 0.4, opacity: reduced ? 1 : 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={spring}
      >
        <circle cx="26" cy="26" r="25" fill="currentColor" />
        <motion.path
          d="M15 27 l7.5 7.5 L38 19"
          fill="none"
          stroke="white"
          strokeWidth={4.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: reduced ? 1 : 0 }}
          animate={{ pathLength: 1 }}
          transition={reduced ? { duration: 0 } : { duration: 0.35, ease: "easeOut", delay: 0.18 }}
        />
      </motion.svg>
    </span>
  );
}
