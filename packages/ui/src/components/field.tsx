"use client";

import * as React from "react";
import { Slot } from "radix-ui";
import { cn } from "../lib/utils";
import { controlHeight, type ControlSize } from "../lib/control";
import { Label } from "./label";

/*
 * Field layout: label row → control → hint / error.
 *
 * Rules that keep side-by-side controls aligned:
 *  - The field is a grid with `content-start`, so when the row is stretched by a taller neighbour the extra space
 *    goes to the bottom instead of being shared out between the label and the control.
 *  - The label row has a fixed minimum height (20px) and bottom-aligns its content; the "(optional)" tag and the
 *    `aside` slot (links, counters, small badges) live inside that row, so they never push the control down.
 *  - Hints, errors, pills and counters that belong under the control render *below* it, so the control always
 *    starts at the same offset in every column.
 *  - Put fields in a `FieldRow` (or any grid with `items-start`) — never `items-center`.
 *
 * Usage:
 *   <FieldRow cols={2}>
 *     <Field invalid={!!errors.city}>
 *       <FieldLabel optional={t("common.optional")} aside={<a href="#">Size guide</a>}>City</FieldLabel>
 *       <FieldControl><Input value={city} onChange={…} /></FieldControl>
 *       <FieldHint>Shown on the invoice</FieldHint>
 *       <FieldError>{errors.city}</FieldError>
 *     </Field>
 *   </FieldRow>
 */

/** Class names shared with the react-hook-form helpers (FormItem / FormLabel / FormDescription / FormMessage). */
export const fieldStyles = {
  /**
   * The field column: label row → 8px → control → 6px → hint / error.
   * `*:data-[slot=field-label-row]` only targets a label row that is a direct child.
   */
  root: "grid min-w-0 content-start gap-2 *:data-[slot=field-label-row]:min-h-5",
  /** Label + optional tag on the left, aside on the right; bottom-aligned so the control offset stays fixed. */
  labelRow: "flex items-end justify-between gap-2",
  /** Pills/badges placed inside the label text get the same -my-1 so the row stays 20px. */
  label: "data-[error=true]:text-destructive *:data-[slot=badge]:-my-1 *:data-[slot=status-pill]:-my-1",
  optional: "text-xs font-normal text-muted-foreground",
  /**
   * `-mt-2` lets a 24px pill (StatusPill sm, a Badge) sit in the 20px row without making it taller, and keeps the
   * aside's bottom on the row's bottom so a counter or link shares the label's baseline.
   */
  aside: "-mt-2 flex shrink-0 items-center gap-2 text-xs leading-snug text-muted-foreground",
  /** Helper text: 13px, 6px under the control (the field's 8px gap less 2px). */
  hint: "-mt-0.5 text-meta text-muted-foreground",
  error: "-mt-0.5 text-meta text-destructive",
} as const;

type FieldContextValue = {
  controlId: string;
  hintId: string;
  errorId: string;
  invalid: boolean;
  hasHint: boolean;
  hasError: boolean;
  register: (part: "hint" | "error", on: boolean) => void;
};

const FieldContext = React.createContext<FieldContextValue | null>(null);

/** The surrounding Field's ids and state, or null outside a Field. */
function useField() {
  return React.useContext(FieldContext);
}

const useIsoLayoutEffect = typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;

function useRegister(part: "hint" | "error", on: boolean) {
  const ctx = React.useContext(FieldContext);
  const register = ctx?.register;
  useIsoLayoutEffect(() => {
    if (!register || !on) return;
    register(part, true);
    return () => register(part, false);
  }, [register, part, on]);
}

function Field({
  className,
  id,
  invalid = false,
  ...props
}: React.ComponentProps<"div"> & {
  /** Id given to the control (FieldControl) and used by FieldLabel's htmlFor. Generated when omitted. */
  id?: string;
  /** Marks the label and control invalid (aria-invalid). FieldError also implies it when it has content. */
  invalid?: boolean;
}) {
  const auto = React.useId();
  const controlId = id ?? `${auto}-control`;
  const [parts, setParts] = React.useState({ hint: false, error: false });
  const register = React.useCallback((part: "hint" | "error", on: boolean) => {
    setParts((p) => (p[part] === on ? p : { ...p, [part]: on }));
  }, []);
  const value = React.useMemo<FieldContextValue>(
    () => ({
      controlId,
      hintId: `${controlId}-hint`,
      errorId: `${controlId}-error`,
      invalid: invalid || parts.error,
      hasHint: parts.hint,
      hasError: parts.error,
      register,
    }),
    [controlId, invalid, parts.hint, parts.error, register],
  );
  return (
    <FieldContext.Provider value={value}>
      <div data-slot="field" data-invalid={value.invalid || undefined} className={cn(fieldStyles.root, className)} {...props} />
    </FieldContext.Provider>
  );
}

type FieldLabelProps = Omit<React.ComponentProps<typeof Label>, "htmlFor"> & {
  /** Defaults to the surrounding Field's control id. Pass `null` for a label over a group (chips, radios) with no single control. */
  htmlFor?: string | null;
  /** Muted tag after the label text, e.g. t("…optional") → "(optional)". Pass the translated text. */
  optional?: React.ReactNode;
  /** Right side of the label row: a "Size guide" link, a character counter, a small badge. Keep it ≤ 20px tall. */
  aside?: React.ReactNode;
  /** Styles the label as invalid; defaults to the surrounding Field's state. */
  invalid?: boolean;
  /** Class for the row wrapper (the label itself takes `className`). */
  rowClassName?: string;
};

/** The label row of a field. Renders `<div data-slot="field-label-row"><Label/>{aside}</div>`. */
function FieldLabel({ className, rowClassName, children, optional, aside, invalid, htmlFor, ...props }: FieldLabelProps) {
  const ctx = useField();
  const isInvalid = invalid ?? ctx?.invalid ?? false;
  return (
    <div data-slot="field-label-row" className={cn(fieldStyles.labelRow, rowClassName)}>
      <Label data-slot="field-label" data-error={isInvalid} htmlFor={htmlFor === null ? undefined : (htmlFor ?? ctx?.controlId)} className={cn(fieldStyles.label, className)} {...props}>
        {children}
        {optional ? (
          <span data-slot="field-optional" className={fieldStyles.optional}>
            {typeof optional === "string" ? `(${optional})` : optional}
          </span>
        ) : null}
      </Label>
      {aside ? (
        <div data-slot="field-aside" className={fieldStyles.aside}>
          {aside}
        </div>
      ) : null}
    </div>
  );
}

/** Wires the single child control to the field: id, aria-describedby (hint + error) and aria-invalid. */
function FieldControl(props: React.ComponentProps<typeof Slot.Root>) {
  const ctx = useField();
  if (!ctx) return <Slot.Root data-slot="field-control" {...props} />;
  const describedBy = [ctx.hasHint ? ctx.hintId : null, ctx.hasError ? ctx.errorId : null, props["aria-describedby"]].filter(Boolean).join(" ");
  return (
    <Slot.Root
      data-slot="field-control"
      id={ctx.controlId}
      aria-invalid={ctx.invalid || undefined}
      {...props}
      aria-describedby={describedBy || undefined}
    />
  );
}

/** Helper text under the control. */
function FieldHint({ className, id, ...props }: React.ComponentProps<"p">) {
  const ctx = useField();
  useRegister("hint", true);
  return <p data-slot="field-hint" id={id ?? ctx?.hintId} className={cn(fieldStyles.hint, className)} {...props} />;
}

/** Validation message under the control. Renders nothing (and doesn't mark the field invalid) when empty. */
function FieldError({ className, id, children, ...props }: React.ComponentProps<"p">) {
  const ctx = useField();
  const has = children !== null && children !== undefined && children !== false && children !== "";
  useRegister("error", has);
  if (!has) return null;
  return (
    <p data-slot="field-error" id={id ?? ctx?.errorId} className={cn(fieldStyles.error, className)} {...props}>
      {children}
    </p>
  );
}

const ROW_COLS = {
  1: "",
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-3",
  4: "sm:grid-cols-2 lg:grid-cols-4",
} as const;

/** Side-by-side fields: one column on phones, `cols` from `sm` up, every column top-aligned (`items-start`). */
function FieldRow({ className, cols = 2, ...props }: React.ComponentProps<"div"> & { cols?: keyof typeof ROW_COLS }) {
  return <div data-slot="field-row" className={cn("grid items-start gap-x-4 gap-y-5", ROW_COLS[cols], className)} {...props} />;
}

/**
 * A control with adornments (₹, %, +91, "/products/", an icon) inside one bordered box of the shared control height.
 * Put an `InputGroupInput` (borderless Input) and any number of `InputGroupAddon`s inside, in visual order.
 */
function InputGroup({ className, size = "default", ...props }: React.ComponentProps<"div"> & { size?: ControlSize }) {
  return (
    <div
      data-slot="input-group"
      data-size={size}
      className={cn(
        "flex w-full min-w-0 items-center rounded-md border border-input bg-transparent shadow-xs transition-[color,box-shadow] dark:bg-input/30",
        "focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50",
        "has-[[aria-invalid=true]]:border-destructive has-[[aria-invalid=true]]:ring-destructive/20 has-[:disabled]:opacity-50",
        controlHeight(size),
        className,
      )}
      {...props}
    />
  );
}

/** Text or icon inside an InputGroup (prefix or suffix). */
function InputGroupAddon({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="input-group-addon"
      className={cn(
        "flex shrink-0 items-center gap-1 px-3 text-sm whitespace-nowrap text-muted-foreground select-none first:pr-0 last:pl-0 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    />
  );
}

/** The input inside an InputGroup: no border, ring or shadow of its own; fills the group's height. */
function InputGroupInput({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      data-slot="input-group-input"
      className={cn(
        "h-full w-full min-w-0 flex-1 rounded-md bg-transparent px-3 py-1 text-base outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed md:text-sm",
        "[[data-slot=input-group-addon]+&]:pl-1.5",
        className,
      )}
      {...props}
    />
  );
}

export { Field, FieldLabel, FieldControl, FieldHint, FieldError, FieldRow, InputGroup, InputGroupAddon, InputGroupInput, useField, type FieldLabelProps };
