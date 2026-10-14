"use client";

import * as React from "react";
import { cn } from "../lib/utils";

export interface OtpInputProps {
  /** Number of digits (default 6). */
  length?: number;
  value: string;
  onChange: (value: string) => void;
  /** Called once every slot holds a digit. */
  onComplete?: (value: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  invalid?: boolean;
  className?: string;
  /** Accessible label for the group; each box gets "<label> <n>". */
  "aria-label"?: string;
  id?: string;
}

/**
 * N single-digit boxes with auto-advance, backspace-to-previous, arrow keys, and paste of the
 * whole code into any box. Works with SMS autofill via autocomplete="one-time-code" on the first box.
 */
function OtpInput({
  length = 6,
  value,
  onChange,
  onComplete,
  disabled,
  autoFocus,
  invalid,
  className,
  id,
  "aria-label": ariaLabel = "One-time code digit",
}: OtpInputProps) {
  const refs = React.useRef<Array<HTMLInputElement | null>>([]);
  const digits = React.useMemo(() => {
    const clean = value.replace(/\D/g, "").slice(0, length);
    return Array.from({ length }, (_, i) => clean[i] ?? "");
  }, [value, length]);

  const focus = (index: number) => {
    const el = refs.current[Math.max(0, Math.min(length - 1, index))];
    el?.focus();
    el?.select();
  };

  const commit = (next: string[]) => {
    const joined = next.join("");
    onChange(joined);
    if (joined.length === length && next.every((d) => d !== "")) onComplete?.(joined);
  };

  const fill = (start: number, text: string) => {
    const incoming = text.replace(/\D/g, "");
    if (!incoming) return;
    const next = [...digits];
    // A full-length paste always replaces the whole code, regardless of which box got it.
    const from = incoming.length >= length ? 0 : start;
    let i = from;
    for (const ch of incoming) {
      if (i >= length) break;
      next[i] = ch;
      i++;
    }
    commit(next);
    focus(Math.min(i, length - 1));
  };

  const handleChange = (index: number, e: React.ChangeEvent<HTMLInputElement>) => {
    let raw = e.target.value.replace(/\D/g, "");
    const old = digits[index] ?? "";
    // Typing into an already-filled box (caret not selecting) yields old+new: keep only the new digit.
    if (raw.length === 2 && old && (raw[0] === old || raw[1] === old)) {
      raw = raw[0] === old ? raw.slice(1) : raw.slice(0, 1);
    }
    if (raw.length > 1) {
      fill(index, raw); // autofill or fast typing delivered several digits
      return;
    }
    const ch = raw.slice(-1);
    const next = [...digits];
    next[index] = ch;
    commit(next);
    if (ch && index < length - 1) focus(index + 1);
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace") {
      e.preventDefault();
      const next = [...digits];
      if (next[index]) {
        next[index] = "";
        commit(next);
      } else if (index > 0) {
        next[index - 1] = "";
        commit(next);
        focus(index - 1);
      }
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      focus(index - 1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      focus(index + 1);
    }
  };

  const handlePaste = (index: number, e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    fill(index, e.clipboardData.getData("text"));
  };

  return (
    <div data-slot="otp-input" role="group" className={cn("flex items-center gap-2", className)}>
      {digits.map((digit, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          id={i === 0 ? id : undefined}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          maxLength={length}
          value={digit}
          disabled={disabled}
          autoFocus={autoFocus && i === 0}
          aria-label={`${ariaLabel} ${i + 1}`}
          aria-invalid={invalid || undefined}
          onChange={(e) => handleChange(i, e)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={(e) => handlePaste(i, e)}
          onFocus={(e) => e.target.select()}
          className={cn(
            "size-11 rounded-md border border-input bg-transparent text-center text-lg font-semibold tabular-nums shadow-xs transition-[color,box-shadow,border-color] outline-none sm:size-12",
            "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30",
            "aria-invalid:border-destructive aria-invalid:ring-destructive/20",
            digit && "border-primary/60",
          )}
        />
      ))}
    </div>
  );
}

export { OtpInput };
