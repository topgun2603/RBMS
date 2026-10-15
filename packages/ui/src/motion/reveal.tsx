"use client";

import * as React from "react";
import { motion, useAnimationControls, useInView, type HTMLMotionProps, type Variants } from "motion/react";
import { MOTION_EASE, useReducedMotionSafe } from "./motion";

/*
 * Scroll reveals that are safe for server rendering.
 *
 * The server (and the first client render) output the content fully visible — no `opacity: 0` in the HTML, so
 * crawlers, no-JS visitors and the LCP element are never hidden. Right after hydration (before paint) an element that
 * sits below the fold is switched to its hidden state and animates in once it scrolls into view. Elements already on
 * screen are left alone (no flash). With reduced motion nothing is hidden at all.
 */

const useIsoLayoutEffect = typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;

type RevealTag = "div" | "section" | "ul" | "ol" | "li";
const TAGS = {
  div: motion.div,
  section: motion.section,
  ul: motion.ul,
  ol: motion.ol,
  li: motion.li,
} as const;

type BaseProps = Omit<HTMLMotionProps<"div">, "initial" | "animate" | "variants" | "ref">;

export interface RevealProps extends BaseProps {
  as?: RevealTag;
  /** Upward travel in px (default 18). */
  y?: number;
  delay?: number;
  duration?: number;
  /** Portion of the element that must be visible before it reveals (default 0.12). */
  amount?: number;
}

function useArmedReveal(amount: number) {
  const ref = React.useRef<HTMLElement>(null);
  const controls = useAnimationControls();
  const reduced = useReducedMotionSafe();
  const [armed, setArmed] = React.useState(false);
  const inView = useInView(ref as React.RefObject<Element>, { once: true, amount });

  useIsoLayoutEffect(() => {
    if (reduced || typeof window === "undefined" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const el = ref.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top;
    if (top > window.innerHeight * 0.95) {
      controls.set("hidden");
      setArmed(true);
    }
    // Only on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (armed && inView) void controls.start("show");
  }, [armed, inView, controls]);

  return { ref, controls };
}

/** Fades + lifts its content in when it first scrolls into view. */
export function Reveal({ as = "div", y = 18, delay = 0, duration = 0.55, amount = 0.12, ...props }: RevealProps) {
  const { ref, controls } = useArmedReveal(amount);
  const variants: Variants = {
    hidden: { opacity: 0, y },
    show: { opacity: 1, y: 0, transition: { duration, delay, ease: MOTION_EASE } },
  };
  const Comp = TAGS[as] as typeof motion.div;
  return <Comp ref={ref as React.Ref<HTMLDivElement>} initial={false} animate={controls} variants={variants} {...props} />;
}

export interface RevealGroupProps extends BaseProps {
  as?: RevealTag;
  /** Seconds between children (default 0.06). */
  stagger?: number;
  delay?: number;
  amount?: number;
}

/** Like <Reveal>, but reveals its <RevealItem> children one after another. */
export function RevealGroup({ as = "div", stagger = 0.06, delay = 0, amount = 0.08, ...props }: RevealGroupProps) {
  const { ref, controls } = useArmedReveal(amount);
  const variants: Variants = {
    hidden: {},
    show: { transition: { staggerChildren: stagger, delayChildren: delay } },
  };
  const Comp = TAGS[as] as typeof motion.div;
  return <Comp ref={ref as React.Ref<HTMLDivElement>} initial={false} animate={controls} variants={variants} {...props} />;
}

export interface RevealItemProps extends BaseProps {
  as?: RevealTag;
  y?: number;
}

export function RevealItem({ as = "div", y = 16, ...props }: RevealItemProps) {
  const variants: Variants = {
    hidden: { opacity: 0, y },
    show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: MOTION_EASE } },
  };
  const Comp = TAGS[as] as typeof motion.div;
  return <Comp variants={variants} {...props} />;
}
