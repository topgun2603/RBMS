"use client";

import * as React from "react";
import { AnimatePresence, motion, useReducedMotionSafe, useScroll, useTransform } from "@srirealtime/ui/motion";
import { useSite } from "./site-context";
import { CreditBookMockup, InvoiceMockup, NotifyChip, PhoneStoreMockup } from "./mockups";

const WORDS = ["hero.word.1", "hero.word.2", "hero.word.3", "hero.word.4", "hero.word.5", "hero.word.6", "hero.word.7", "hero.word.8", "hero.word.9", "hero.word.10"];

/** "Billing and online store for your <shop / grocery store / …>": the last words roll through shop types. */
export function HeroHeadline() {
  const { t, locale } = useSite();
  const reduced = useReducedMotionSafe();
  const [i, setI] = React.useState(0);
  React.useEffect(() => {
    if (reduced) return;
    const id = window.setInterval(() => setI((n) => (n + 1) % WORDS.length), 2600);
    return () => window.clearInterval(id);
  }, [reduced]);
  React.useEffect(() => setI(0), [locale]);
  const word = t(WORDS[i]!);
  const after = t("hero.titleAfter");
  return (
    <h1 className="text-display text-balance">
      {t("hero.titleBefore")}{" "}
      <span className="relative inline-grid align-bottom">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={word}
            initial={{ y: "70%", opacity: 0, filter: "blur(6px)" }}
            animate={{ y: 0, opacity: 1, filter: "blur(0px)" }}
            exit={{ y: "-70%", opacity: 0, filter: "blur(6px)" }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="text-gradient col-start-1 row-start-1 pb-1 whitespace-nowrap"
          >
            {word}
          </motion.span>
        </AnimatePresence>
      </span>
      {after ? <> {after}</> : null}
    </h1>
  );
}

/** Soft moving colour fields + a fading grid behind the hero. */
export function HeroBackdrop() {
  const reduced = useReducedMotionSafe();
  return (
    <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden" aria-hidden="true">
      <div className="bg-grid absolute inset-0 [mask-image:radial-gradient(ellipse_70%_60%_at_50%_30%,black,transparent)]" />
      <motion.div
        className="absolute -top-40 -left-32 size-[34rem] rounded-full bg-primary/20 blur-3xl"
        animate={reduced ? undefined : { x: [0, 60, 0], y: [0, 40, 0] }}
        transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute top-10 -right-40 size-[30rem] rounded-full bg-marigold/25 blur-3xl"
        animate={reduced ? undefined : { x: [0, -50, 0], y: [0, 60, 0] }}
        transition={{ duration: 22, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute bottom-0 left-1/3 size-[22rem] rounded-full bg-[oklch(0.65_0.18_340/0.14)] blur-3xl"
        animate={reduced ? undefined : { x: [0, 40, -20, 0] }}
        transition={{ duration: 26, repeat: Infinity, ease: "easeInOut" }}
      />
    </div>
  );
}

/** Phone storefront + GST bill + credit book, layered with floating notifications and a gentle scroll parallax. */
export function HeroVisual({ variant = "both" }: { variant?: "both" | "billing" | "store" }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const reduced = useReducedMotionSafe();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const yBack = useTransform(scrollYProgress, [0, 1], reduced ? [0, 0] : [30, -30]);
  const yFront = useTransform(scrollYProgress, [0, 1], reduced ? [0, 0] : [60, -60]);

  if (variant === "billing") {
    return (
      <div ref={ref} className="relative mx-auto h-[460px] w-full max-w-[460px] sm:h-[500px]">
        <motion.div style={{ y: yBack }} className="absolute top-6 right-0 left-6 sm:left-10">
          <InvoiceMockup />
        </motion.div>
        <motion.div style={{ y: yFront }} className="absolute bottom-2 left-0 w-[240px] sm:w-[260px]">
          <CreditBookMockup />
        </motion.div>
        <NotifyChip kind="whatsapp" detail="+91 98•••• 3210" className="-top-2 left-0 sm:-left-4" delay={0.5} />
        <NotifyChip kind="upi" detail="₹1,302.00" className="right-0 bottom-24 sm:-right-4" delay={0.9} />
      </div>
    );
  }
  if (variant === "store") {
    return (
      <div ref={ref} className="relative mx-auto h-[540px] w-full max-w-[420px]">
        <motion.div style={{ y: yBack }} className="absolute top-0 left-1/2 -translate-x-1/2">
          <PhoneStoreMockup />
        </motion.div>
        <NotifyChip kind="order" detail="#1042 · ₹8,450" className="top-44 left-0 sm:-left-6" delay={0.5} />
        <NotifyChip kind="upi" detail="₹8,450.00" className="right-0 bottom-28 sm:-right-6" delay={0.9} />
      </div>
    );
  }
  return (
    <div ref={ref} className="relative mx-auto h-[500px] w-full max-w-[560px] sm:h-[620px]">
      <motion.div style={{ y: yBack }} className="absolute top-0 right-0 sm:right-2">
        <PhoneStoreMockup className="w-[200px] sm:w-[260px]" />
      </motion.div>
      <motion.div style={{ y: yFront }} className="absolute bottom-0 left-0 z-10 w-[min(80%,330px)]">
        <InvoiceMockup />
      </motion.div>
      <motion.div style={{ y: yBack }} className="absolute top-0 left-0 hidden w-[220px] md:block">
        <CreditBookMockup />
      </motion.div>
      <NotifyChip kind="upi" detail="₹1,302.00" className="top-6 left-0 md:top-[42%] md:right-0 md:left-auto" delay={0.6} />
      <NotifyChip kind="order" detail="#1042" className="top-[62%] right-0 hidden lg:block lg:-right-4" delay={1.3} />
    </div>
  );
}
