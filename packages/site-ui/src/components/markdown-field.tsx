"use client";

import * as React from "react";
import { BoldIcon, EyeIcon, ItalicIcon, Link2Icon, ListIcon, PencilIcon } from "lucide-react";
import { cn, Label, Textarea } from "@rbms/ui";
import { useI18n } from "@rbms/web";
import { FieldError, Optional } from "./bits";
import { Markdown } from "./markdown";

/**
 * Markdown text area with Write / Preview tabs and a tiny toolbar (bold, italic, list, link) that wraps the
 * selection — enough for shop owners who have never heard of markdown.
 */
export function MarkdownField({
  id,
  label,
  value,
  onChange,
  error,
  optional,
  rows = 5,
  disabled,
  maxLength,
  hideLabel,
}: {
  id: string;
  label: React.ReactNode;
  value: string;
  onChange: (v: string) => void;
  error?: string | null;
  optional?: boolean;
  rows?: number;
  disabled?: boolean;
  maxLength?: number;
  hideLabel?: boolean;
}) {
  const { t } = useI18n();
  const [mode, setMode] = React.useState<"write" | "preview">("write");
  const ref = React.useRef<HTMLTextAreaElement>(null);

  const wrap = (before: string, after = before, placeholder = "") => {
    const el = ref.current;
    if (!el) return;
    const { selectionStart: a, selectionEnd: b } = el;
    const sel = value.slice(a, b) || placeholder;
    const next = value.slice(0, a) + before + sel + after + value.slice(b);
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(a + before.length, a + before.length + sel.length);
    });
  };
  const bullet = () => {
    const el = ref.current;
    if (!el) return;
    const a = el.selectionStart;
    const lineStart = value.lastIndexOf("\n", a - 1) + 1;
    onChange(value.slice(0, lineStart) + "- " + value.slice(lineStart));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(a + 2, a + 2);
    });
  };

  const tool = "inline-flex size-8 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 [&_svg]:size-4";
  const tab = (on: boolean) =>
    cn("inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring", on ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground");

  return (
    <div className="grid content-start gap-2">
      <Label htmlFor={id} className={cn(hideLabel && "sr-only")}>
        {label}
        {optional && <Optional />}
      </Label>
      <div className={cn("overflow-hidden rounded-xl border bg-card shadow-xs focus-within:ring-[3px] focus-within:ring-ring/40", error && "border-destructive/60")}>
        <div className="flex flex-wrap items-center justify-between gap-1 border-b bg-muted/40 px-1.5 py-1">
          <div className="flex gap-0.5" role="tablist" aria-label={t("site.markdown.mode")}>
            <button type="button" role="tab" aria-selected={mode === "write"} className={tab(mode === "write")} onClick={() => setMode("write")}>
              <PencilIcon className="size-3.5" /> {t("site.markdown.write")}
            </button>
            <button type="button" role="tab" aria-selected={mode === "preview"} className={tab(mode === "preview")} onClick={() => setMode("preview")}>
              <EyeIcon className="size-3.5" /> {t("site.markdown.preview")}
            </button>
          </div>
          {mode === "write" && (
            <div className="flex gap-0.5">
              <button type="button" className={tool} disabled={disabled} aria-label={t("site.markdown.bold")} title={t("site.markdown.bold")} onClick={() => wrap("**", "**", t("site.markdown.boldSample"))}>
                <BoldIcon />
              </button>
              <button type="button" className={tool} disabled={disabled} aria-label={t("site.markdown.italic")} title={t("site.markdown.italic")} onClick={() => wrap("*", "*", t("site.markdown.italicSample"))}>
                <ItalicIcon />
              </button>
              <button type="button" className={tool} disabled={disabled} aria-label={t("site.markdown.list")} title={t("site.markdown.list")} onClick={bullet}>
                <ListIcon />
              </button>
              <button type="button" className={tool} disabled={disabled} aria-label={t("site.markdown.link")} title={t("site.markdown.link")} onClick={() => wrap("[", "](https://)", t("site.markdown.linkSample"))}>
                <Link2Icon />
              </button>
            </div>
          )}
        </div>
        {mode === "write" ? (
          <Textarea
            ref={ref}
            id={id}
            rows={rows}
            value={value}
            disabled={disabled}
            maxLength={maxLength}
            aria-invalid={!!error}
            className="min-h-24 resize-y rounded-none border-0 shadow-none focus-visible:ring-0"
            onChange={(e) => onChange(e.target.value)}
          />
        ) : (
          <div className="min-h-24 px-3 py-2.5">
            {value.trim() ? <Markdown source={value} /> : <p className="text-sm text-muted-foreground">{t("site.markdown.empty")}</p>}
          </div>
        )}
      </div>
      {!error && mode === "write" && <p className="text-meta text-muted-foreground">{t("site.markdown.hint")}</p>}
      <FieldError code={error} />
    </div>
  );
}
