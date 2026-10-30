"use client";

import * as React from "react";
import { XIcon } from "lucide-react";
import { AnimatePresence, cn, motion, useReducedMotionSafe, type ControlSize } from "@rbms/ui";
import { useI18n } from "@rbms/web";
import { splitList } from "../../lib/report-spec";

/**
 * Values as removable chips with a text box: Enter, comma or paste adds; Backspace on an empty box removes the last.
 * `validate` marks bad chips (shown in the destructive tone). Put it inside a FieldControl — it forwards id/aria props
 * to the text box.
 */
export const ChipsInput = React.forwardRef<
  HTMLInputElement,
  {
    value: string[];
    onChange: (next: string[]) => void;
    validate?: (v: string) => boolean;
    normalize?: (v: string) => string;
    placeholder?: string;
    max?: number;
    size?: ControlSize;
    inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
    type?: string;
    id?: string;
    "aria-invalid"?: boolean;
    "aria-describedby"?: string;
    "aria-label"?: string;
    className?: string;
  }
>(function ChipsInput({ value, onChange, validate, normalize = (v) => v, placeholder, max = 100, size = "default", inputMode, type = "text", className, ...aria }, ref) {
  const { t } = useI18n();
  const reduced = useReducedMotionSafe();
  const [draft, setDraft] = React.useState("");

  const add = (raw: string) => {
    const parts = splitList(raw).map(normalize);
    if (!parts.length) return;
    const next = [...value];
    for (const p of parts) if (!next.includes(p) && next.length < max) next.push(p);
    onChange(next);
    setDraft("");
  };

  return (
    <div
      className={cn(
        "flex w-full min-w-0 flex-wrap items-center gap-1.5 rounded-md border border-input bg-transparent px-2 py-1.5 shadow-xs transition-[color,box-shadow] dark:bg-input/30",
        "focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50",
        "has-[[aria-invalid=true]]:border-destructive",
        size === "sm" ? "min-h-9" : size === "lg" ? "min-h-11" : "min-h-10",
        className,
      )}
    >
      <AnimatePresence initial={false}>
        {value.map((v) => {
          const bad = validate ? !validate(v) : false;
          return (
            <motion.span
              key={v}
              layout={!reduced}
              initial={reduced ? false : { opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.85 }}
              transition={{ duration: 0.15 }}
              className={cn(
                "inline-flex max-w-full items-center gap-1 rounded-full py-0.5 pr-1 pl-2.5 text-xs font-medium ring-1 ring-inset",
                bad ? "bg-destructive/10 text-danger-ink ring-destructive/30" : "bg-muted text-foreground ring-border",
              )}
            >
              <span className="truncate">{v}</span>
              <button
                type="button"
                className="inline-flex size-5 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={t("growth.reports.chips.remove", { value: v })}
                onClick={() => onChange(value.filter((x) => x !== v))}
              >
                <XIcon className="size-3" />
              </button>
            </motion.span>
          );
        })}
      </AnimatePresence>
      <input
        ref={ref}
        type={type}
        inputMode={inputMode}
        value={draft}
        placeholder={value.length ? undefined : placeholder}
        onChange={(e) => {
          const v = e.target.value;
          if (/[,;\n]/.test(v)) add(v);
          else setDraft(v);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add(draft);
          } else if (e.key === "Backspace" && !draft && value.length) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={() => draft.trim() && add(draft)}
        onPaste={(e) => {
          const text = e.clipboardData.getData("text");
          if (/[,;\s]/.test(text.trim())) {
            e.preventDefault();
            add(`${draft} ${text}`);
          }
        }}
        className="h-7 min-w-24 flex-1 bg-transparent px-1 text-base outline-none placeholder:text-muted-foreground md:text-sm"
        {...aria}
      />
    </div>
  );
});
