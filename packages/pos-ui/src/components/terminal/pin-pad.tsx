"use client";

import * as React from "react";
import { ArrowRightIcon, DeleteIcon, Loader2Icon } from "lucide-react";
import { cn } from "@rbms/ui";
import { useI18n } from "@rbms/web";
import { keyToPinAction, PIN_MAX, PIN_MIN, type PinPadAction } from "../../lib/pin";

export interface PinPadProps {
  digits: string;
  onAction: (a: PinPadAction) => void;
  onSubmit: () => void;
  disabled?: boolean;
  busy?: boolean;
  /** Shake the dots (wrong PIN). Change the number to replay. */
  shake?: number;
  invalid?: boolean;
}

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "back", "0", "ok"] as const;

/**
 * Big PIN pad: touch keys 0–9, back and OK, plus the keyboard (digits, numpad, Backspace, Escape, Enter). Digits are
 * never shown, only dots. Submits on its own once 6 digits are in.
 */
export function PinPad({ digits, onAction, onSubmit, disabled, busy, shake = 0, invalid }: PinPadProps) {
  const { t } = useI18n();
  const submitRef = React.useRef(onSubmit);
  submitRef.current = onSubmit;
  const canSubmit = !disabled && !busy && digits.length >= PIN_MIN;

  React.useEffect(() => {
    if (disabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (e.key === "Enter") {
        e.preventDefault();
        submitRef.current();
        return;
      }
      const a = keyToPinAction(e.key);
      if (a) {
        e.preventDefault();
        onAction(a);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [disabled, onAction]);

  // Six digits: no need to press OK.
  React.useEffect(() => {
    if (digits.length === PIN_MAX && !disabled && !busy) submitRef.current();
  }, [digits, disabled, busy]);

  return (
    <div className="grid w-full max-w-xs justify-items-center gap-6">
      <div
        key={shake}
        className={cn("flex h-6 items-center gap-3", shake > 0 && "motion-safe:animate-[pos-shake_0.35s_ease-in-out]")}
        role="status"
        aria-live="polite"
        aria-label={t("pos.lock.entered", { count: digits.length })}
      >
        {Array.from({ length: Math.max(PIN_MIN, Math.min(digits.length + 1, PIN_MAX)) }, (_, i) => (
          <span
            key={i}
            className={cn(
              "size-3.5 rounded-full border-2 transition-colors",
              i < digits.length ? (invalid ? "border-destructive bg-destructive" : "border-primary bg-primary") : "border-muted-foreground/40",
            )}
          />
        ))}
      </div>
      <div className="grid w-full grid-cols-3 gap-3" role="group" aria-label={t("pos.lock.pad")}>
        {KEYS.map((k) => {
          if (k === "back") {
            return (
              <PadKey key={k} label={t("pos.lock.back")} disabled={disabled || digits.length === 0} onPress={() => onAction({ type: "back" })} variant="quiet">
                <DeleteIcon className="size-6" />
              </PadKey>
            );
          }
          if (k === "ok") {
            return (
              <PadKey key={k} label={t("pos.lock.unlock")} disabled={!canSubmit} onPress={onSubmit} variant="primary">
                {busy ? <Loader2Icon className="size-6 animate-spin" /> : <ArrowRightIcon className="size-6" />}
              </PadKey>
            );
          }
          return (
            <PadKey key={k} label={k} disabled={disabled} onPress={() => onAction({ type: "digit", digit: k })}>
              <span className="text-2xl font-semibold tabular-nums">{k}</span>
            </PadKey>
          );
        })}
      </div>
      <style>{`@keyframes pos-shake { 0%,100% { transform: translateX(0) } 20% { transform: translateX(-8px) } 40% { transform: translateX(8px) } 60% { transform: translateX(-5px) } 80% { transform: translateX(5px) } }`}</style>
    </div>
  );
}

function PadKey({
  children,
  label,
  onPress,
  disabled,
  variant = "digit",
}: {
  children: React.ReactNode;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: "digit" | "quiet" | "primary";
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onPress}
      className={cn(
        "grid h-16 place-items-center rounded-2xl border text-foreground shadow-xs transition-[background-color,transform] outline-none select-none focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-95 disabled:pointer-events-none disabled:opacity-40 motion-reduce:active:scale-100 sm:h-[4.5rem]",
        variant === "digit" && "bg-card hover:bg-accent",
        variant === "quiet" && "border-transparent bg-transparent text-muted-foreground shadow-none hover:bg-accent",
        variant === "primary" && "border-transparent bg-primary text-primary-foreground hover:bg-primary/90",
      )}
    >
      {children}
    </button>
  );
}
