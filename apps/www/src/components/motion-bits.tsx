"use client";

import * as React from "react";
import { motion, useReducedMotionSafe, type HTMLMotionProps } from "@rbms/ui/motion";
import { cn } from "@rbms/ui/lib/utils";

/** Lifts on hover / press (cards, tiles). */
export function Lift({ className, ...props }: HTMLMotionProps<"div">) {
  const reduced = useReducedMotionSafe();
  return (
    <motion.div
      whileHover={reduced ? undefined : { y: -4 }}
      whileTap={reduced ? undefined : { scale: 0.985 }}
      transition={{ type: "spring", stiffness: 380, damping: 26 }}
      className={className}
      {...props}
    />
  );
}

/** Endless horizontal ticker (pauses on hover; static with reduced motion). */
export function Marquee({ children, className }: { children: React.ReactNode; className?: string }) {
  const reduced = useReducedMotionSafe();
  if (reduced) return <div className={cn("flex flex-wrap justify-center gap-x-10 gap-y-3", className)}>{children}</div>;
  return (
    <div className={cn("group relative flex overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_12%,black_88%,transparent)]", className)}>
      {[0, 1].map((k) => (
        <motion.div
          key={k}
          aria-hidden={k === 1 || undefined}
          className="flex shrink-0 items-center gap-10 pr-10"
          animate={{ x: ["0%", "-100%"] }}
          transition={{ duration: 28, repeat: Infinity, ease: "linear" }}
        >
          {children}
        </motion.div>
      ))}
    </div>
  );
}

/** A line that draws itself when it scrolls into view (connects the "how it works" steps). */
export function DrawLine({ className }: { className?: string }) {
  return (
    <motion.div
      aria-hidden="true"
      className={cn("origin-left bg-gradient-to-r from-primary via-marigold to-primary/0", className)}
      initial={{ scaleX: 0 }}
      whileInView={{ scaleX: 1 }}
      viewport={{ once: true, amount: 0.6 }}
      transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
    />
  );
}

/** Pops a number badge in when it scrolls into view. */
export function PopIn({ children, className, delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const reduced = useReducedMotionSafe();
  return (
    <motion.div
      className={className}
      initial={reduced ? false : { scale: 0.5, opacity: 0, rotate: -12 }}
      whileInView={{ scale: 1, opacity: 1, rotate: 0 }}
      viewport={{ once: true, amount: 0.8 }}
      transition={{ delay, type: "spring", stiffness: 380, damping: 18 }}
    >
      {children}
    </motion.div>
  );
}
