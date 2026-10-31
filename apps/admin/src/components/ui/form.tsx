"use client";

import * as React from "react";
import {
  Controller,
  FormProvider,
  useFormContext,
  useFormState,
  type ControllerProps,
  type FieldPath,
  type FieldValues,
} from "react-hook-form";
import { cn, FieldLabel, fieldStyles, Slot, type FieldLabelProps } from "@rbms/ui";
import { useI18n } from "@/lib/i18n";

/** shadcn's react-hook-form helpers. Zod messages that look like i18n keys ("admin.…") are translated. */
const Form = FormProvider;

type FormFieldContextValue<TFieldValues extends FieldValues = FieldValues, TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>> = {
  name: TName;
};

const FormFieldContext = React.createContext<FormFieldContextValue>({} as FormFieldContextValue);

const FormField = <TFieldValues extends FieldValues = FieldValues, TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>>({
  ...props
}: ControllerProps<TFieldValues, TName>) => (
  <FormFieldContext.Provider value={{ name: props.name }}>
    <Controller {...props} />
  </FormFieldContext.Provider>
);

type FormItemContextValue = { id: string };
const FormItemContext = React.createContext<FormItemContextValue>({} as FormItemContextValue);

const useFormField = () => {
  const fieldContext = React.useContext(FormFieldContext);
  const itemContext = React.useContext(FormItemContext);
  const { getFieldState } = useFormContext();
  const formState = useFormState({ name: fieldContext.name });
  const fieldState = getFieldState(fieldContext.name, formState);
  if (!fieldContext) throw new Error("useFormField should be used within <FormField>");
  const { id } = itemContext;
  return {
    id,
    name: fieldContext.name,
    formItemId: `${id}-form-item`,
    formDescriptionId: `${id}-form-item-description`,
    formMessageId: `${id}-form-item-message`,
    ...fieldState,
  };
};

/**
 * Same layout as @rbms/ui's Field: a `content-start` grid (label row → control → description/message) so
 * fields side by side keep their controls aligned however much text sits under a neighbour.
 */
function FormItem({ className, ...props }: React.ComponentProps<"div">) {
  const id = React.useId();
  return (
    <FormItemContext.Provider value={{ id }}>
      <div data-slot="form-item" className={cn(fieldStyles.root, className)} {...props} />
    </FormItemContext.Provider>
  );
}

/**
 * The label row: label text, an optional `optional` tag ("(optional)") and an `aside` (link, counter, small badge)
 * on the right — all on one fixed-height row so the control below starts at the same offset in every column.
 */
function FormLabel(props: FieldLabelProps) {
  const { error, formItemId } = useFormField();
  return <FieldLabel data-form-label="" invalid={!!error} htmlFor={formItemId} {...props} />;
}

function FormControl(props: React.ComponentProps<typeof Slot.Root>) {
  const { error, formItemId, formDescriptionId, formMessageId } = useFormField();
  return (
    <Slot.Root
      data-slot="form-control"
      id={formItemId}
      aria-describedby={!error ? formDescriptionId : `${formDescriptionId} ${formMessageId}`}
      aria-invalid={!!error}
      {...props}
    />
  );
}

function FormDescription({ className, ...props }: React.ComponentProps<"p">) {
  const { formDescriptionId } = useFormField();
  return <p data-slot="form-description" id={formDescriptionId} className={cn(fieldStyles.hint, className)} {...props} />;
}

function FormMessage({ className, ...props }: React.ComponentProps<"p">) {
  const { error, formMessageId } = useFormField();
  const { t } = useI18n();
  const raw = error ? String(error?.message ?? "") : props.children;
  const body = typeof raw === "string" && raw.startsWith("admin.") ? t(raw) : raw;
  if (!body) return null;
  return (
    <p data-slot="form-message" id={formMessageId} className={cn(fieldStyles.error, className)} {...props}>
      {body}
    </p>
  );
}

export { useFormField, Form, FormItem, FormLabel, FormControl, FormDescription, FormMessage, FormField };
