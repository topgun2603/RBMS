"use client";

import * as React from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { AnimatePresence, Button, motion, toast } from "@srirealtime/ui";
import { useI18n } from "@srirealtime/web";

/** Copies `value`; the icon morphs into a check for 2s. */
export function CopyButton({
  value,
  label,
  copiedMessage,
  variant = "outline",
  size = "icon",
  showLabel,
  className,
}: {
  value: string;
  label?: string;
  copiedMessage?: string;
  variant?: "outline" | "ghost" | "secondary" | "default";
  size?: "icon" | "icon-lg" | "icon-sm" | "sm" | "default" | "lg";
  showLabel?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  const [copied, setCopied] = React.useState(false);
  const text = label ?? t("billing.common.copy");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success(copiedMessage ?? t("billing.common.copied"));
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t("billing.share.copyFailed"));
    }
  };
  return (
    <Button type="button" variant={variant} size={size} className={className} onClick={() => void copy()} aria-label={showLabel ? undefined : text}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={copied ? "y" : "n"}
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.5, opacity: 0 }}
          transition={{ duration: 0.12 }}
          className="inline-flex"
        >
          {copied ? <CheckIcon className="text-success" /> : <CopyIcon />}
        </motion.span>
      </AnimatePresence>
      {showLabel && text}
    </Button>
  );
}
