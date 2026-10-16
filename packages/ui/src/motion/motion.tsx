"use client";

import * as React from "react";
import { animate, motion, type HTMLMotionProps, type Transition, type Variants } from "motion/react";

/** Shared timings: subtle and quick. */
export const MOTION_DURATION = 0.2;
export const MOTION_EASE: Transition["ease"] = [0.16, 1, 0.3, 1]; // ease-out (expo-ish)

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const reducedMotionQuery = () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(REDUCED_MOTION_QUERY) : null);
function subscribeReducedMotion(onChange: () => void) {
  const mq = reducedMotionQuery();
  mq?.addEventListener("change", onChange);
  return () => mq?.removeEventListener("change", onChange);
}
const reducedMotionSnapshot = () => reducedMotionQuery()?.matches ?? false;
const reducedMotionServerSnapshot = () => false;

/**
 * True when the user asked the OS for reduced motion (Windows: "Animation effects" off). It is false on the server
 * *and during hydration* (useSyncExternalStore's server snapshot), then switches after mount, so components may
 * render different markup for it without a hydration mismatch. motion's own `useReducedMotion()` reads the media
 * query on the first client render, which differs from the server whenever reduced motion is on (React #418).
 */
export function useReducedMotionSafe(): boolean {
  return React.useSyncExternalStore(subscribeReducedMotion, reducedMotionSnapshot, reducedMotionServerSnapshot);
}

function useTransition(duration: number, delay: number): Transition {
  const reduced = useReducedMotionSafe();
  return reduced ? { duration: 0, delay: 0 } : { duration, delay, ease: MOTION_EASE };
}

type DivMotionProps = Omit<HTMLMotionProps<"div">, "initial" | "animate" | "exit" | "transition" | "variants">;

export interface FadeInProps extends DivMotionProps {
  delay?: number;
  duration?: number;
  /** Small upward offset in px (default 4). Set 0 for a pure fade. */
  y?: number;
}

/** Fades (and nudges up) its children in on mount. */
export function FadeIn({ delay = 0, duration = MOTION_DURATION, y = 4, ...props }: FadeInProps) {
  const reduced = useReducedMotionSafe();
  const transition = useTransition(duration, delay);
  return (
    <motion.div
      initial={{ opacity: 0, y: reduced ? 0 : y }}
      animate={{ opacity: 1, y: 0 }}
      transition={transition}
      {...props}
    />
  );
}

export type SlideDirection = "up" | "down" | "left" | "right";

export interface SlideInProps extends DivMotionProps {
  direction?: SlideDirection;
  /** Distance in px (default 12). */
  distance?: number;
  delay?: number;
  duration?: number;
}

function offsetFor(direction: SlideDirection, distance: number) {
  switch (direction) {
    case "up":
      return { x: 0, y: distance };
    case "down":
      return { x: 0, y: -distance };
    case "left":
      return { x: distance, y: 0 };
    case "right":
      return { x: -distance, y: 0 };
  }
}

/** Slides its children in from `direction` (the side it travels towards) on mount. */
export function SlideIn({ direction = "up", distance = 12, delay = 0, duration = 0.22, ...props }: SlideInProps) {
  const reduced = useReducedMotionSafe();
  const transition = useTransition(duration, delay);
  const from = reduced ? { x: 0, y: 0 } : offsetFor(direction, distance);
  return (
    <motion.div
      initial={{ opacity: 0, ...from }}
      animate={{ opacity: 1, x: 0, y: 0 }}
      exit={{ opacity: 0, ...from }}
      transition={transition}
      {...props}
    />
  );
}

export interface StaggerProps extends DivMotionProps {
  /** Delay between children in seconds (default 0.035). */
  stagger?: number;
  delay?: number;
}

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 6 },
  show: { opacity: 1, y: 0 },
};

/** Container that reveals its <StaggerItem> children one after another. */
export function Stagger({ stagger = 0.035, delay = 0, ...props }: StaggerProps) {
  const reduced = useReducedMotionSafe();
  const variants: Variants = {
    hidden: {},
    show: { transition: reduced ? {} : { staggerChildren: stagger, delayChildren: delay } },
  };
  return <motion.div variants={variants} initial="hidden" animate="show" {...props} />;
}

export function StaggerItem(props: DivMotionProps) {
  const reduced = useReducedMotionSafe();
  return (
    <motion.div
      variants={itemVariants}
      transition={reduced ? { duration: 0 } : { duration: MOTION_DURATION, ease: MOTION_EASE }}
      {...props}
    />
  );
}

export interface PageTransitionProps extends DivMotionProps {
  /** Change this (e.g. the pathname) to replay the enter animation. */
  routeKey?: string;
}

/** Subtle enter animation for page content. Re-runs whenever `routeKey` changes. */
export function PageTransition({ routeKey, ...props }: PageTransitionProps) {
  const reduced = useReducedMotionSafe();
  return (
    <motion.div
      key={routeKey}
      initial={{ opacity: 0, y: reduced ? 0 : 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduced ? { duration: 0 } : { duration: 0.22, ease: MOTION_EASE }}
      {...props}
    />
  );
}

export interface AnimatedNumberProps extends Omit<React.ComponentProps<"span">, "children"> {
  value: number;
  /** Formats the in-flight value (default: rounded, locale grouped). */
  format?: (n: number) => string;
  duration?: number;
  /** Count up from this value on mount (e.g. 0 for hero figures). Default: start at `value`. */
  from?: number;
}

/** Counts from the previous value to `value`. Renders the final value directly with reduced motion. */
export function AnimatedNumber({ value, format, duration = 0.5, from, ...props }: AnimatedNumberProps) {
  const reduced = useReducedMotionSafe();
  const [display, setDisplay] = React.useState(from ?? value);
  const previous = React.useRef(from ?? value);
  const fmt = format ?? ((n: number) => Math.round(n).toLocaleString());

  React.useEffect(() => {
    if (reduced || previous.current === value) {
      previous.current = value;
      setDisplay(value);
      return;
    }
    const controls = animate(previous.current, value, {
      duration,
      ease: "easeOut",
      onUpdate: (v) => setDisplay(v),
    });
    previous.current = value;
    return () => controls.stop();
  }, [value, reduced, duration]);

  return (
    <span data-slot="animated-number" {...props}>
      {fmt(display)}
    </span>
  );
}

export { AnimatePresence, motion } from "motion/react";
