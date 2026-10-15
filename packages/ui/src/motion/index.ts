export {
  AnimatedNumber,
  AnimatePresence,
  FadeIn,
  MOTION_DURATION,
  MOTION_EASE,
  PageTransition,
  SlideIn,
  Stagger,
  StaggerItem,
  motion,
  useReducedMotionSafe,
} from "./motion";
export type {
  AnimatedNumberProps,
  FadeInProps,
  PageTransitionProps,
  SlideDirection,
  SlideInProps,
  StaggerProps,
} from "./motion";
export { SuccessCheck } from "./success-check";
export type { SuccessCheckProps } from "./success-check";
export { Reveal, RevealGroup, RevealItem } from "./reveal";
export type { RevealProps, RevealGroupProps, RevealItemProps } from "./reveal";
export { RollingNumber } from "./rolling-number";
export type { RollingNumberProps } from "./rolling-number";

// Re-exported so feature packages can animate without depending on `motion` directly.
export {
  animate,
  LayoutGroup,
  MotionConfig,
  useAnimate,
  useAnimationControls,
  useInView,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from "motion/react";
export type { Transition, Variants, MotionValue, HTMLMotionProps } from "motion/react";
