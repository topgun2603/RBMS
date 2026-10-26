"use client";

import * as React from "react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CopyIcon,
  GripVerticalIcon,
  HeadingIcon,
  HelpCircleIcon,
  ImageIcon,
  ImagesIcon,
  MinusIcon,
  MousePointerClickIcon,
  PilcrowIcon,
  PlusIcon,
  Trash2Icon,
  XIcon,
  YoutubeIcon,
} from "lucide-react";
import { AnimatePresence, Button, ChipGroup, cn, Label, motion } from "@srirealtime/ui";
import { useI18n } from "@srirealtime/web";
import { extractYoutubeId } from "../lib/content";
import { BLOCK_LIMITS, BLOCK_TYPES, duplicateBlockForm, newBlockForm, youtubeThumb, type BlockForm, type BlockType } from "../lib/blocks";
import type { FieldErrors } from "../lib/sections";
import { FieldError, TextField } from "./bits";
import { GalleryField, ImageField } from "./image-field";
import { MarkdownField } from "./markdown-field";
import { useDragSort } from "./sortable";

export const BLOCK_ICONS: Record<BlockType, React.ComponentType<{ className?: string }>> = {
  heading: HeadingIcon,
  paragraph: PilcrowIcon,
  image: ImageIcon,
  gallery: ImagesIcon,
  button: MousePointerClickIcon,
  faq: HelpCircleIcon,
  video: YoutubeIcon,
  divider: MinusIcon,
};

/** Page/post content as a list of blocks: add, edit, drag (or arrows) to reorder, duplicate, delete. */
export function BlockEditor({
  value,
  onChange,
  errors,
  disabled,
  idPrefix,
}: {
  value: BlockForm[];
  onChange: (v: BlockForm[]) => void;
  errors: Record<string, FieldErrors>;
  disabled?: boolean;
  idPrefix: string;
}) {
  const { t } = useI18n();
  const sort = useDragSort(value, (b) => b.key, onChange);
  const [focusKey, setFocusKey] = React.useState<string | null>(null);
  // Only the card header starts a drag, so text in the inputs stays selectable.
  const [armed, setArmed] = React.useState<string | null>(null);
  const full = value.length >= BLOCK_LIMITS.blocks;
  const patch = (key: string, next: BlockForm) => onChange(value.map((b) => (b.key === key ? next : b)));

  const add = (type: BlockType, at = value.length) => {
    const b = newBlockForm(type);
    const next = [...value];
    next.splice(at, 0, b);
    onChange(next);
    setFocusKey(b.key);
  };

  React.useEffect(() => {
    if (!focusKey) return;
    const el = document.getElementById(`${idPrefix}-block-${focusKey}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    el?.querySelector<HTMLElement>("input, textarea, button[role=radio]")?.focus({ preventScroll: true });
    setFocusKey(null);
  }, [focusKey, idPrefix]);

  return (
    <div className="grid gap-3">
      {value.length === 0 && (
        <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">{t("site.blocks.empty")}</p>
      )}
      <ol className="grid gap-3">
        <AnimatePresence initial={false}>
          {value.map((b, i) => {
            const Icon = BLOCK_ICONS[b.type];
            const errs = errors[b.key] ?? {};
            const bad = Object.keys(errs).length > 0;
            return (
              <motion.li
                key={b.key}
                id={`${idPrefix}-block-${b.key}`}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ duration: 0.16 }}
              >
               <div
                className={cn(
                  "rounded-xl border bg-card shadow-xs data-[dragging]:opacity-40 data-[over]:ring-2 data-[over]:ring-primary/50",
                  bad && "border-destructive/50",
                )}
                {...(disabled ? {} : sort.itemProps(b.key))}
                draggable={!disabled && armed === b.key}
                onDragEnd={() => {
                  setArmed(null);
                  if (!disabled) sort.itemProps(b.key).onDragEnd();
                }}
               >
                <div
                  className="flex cursor-grab items-center gap-2 border-b border-border/60 px-2 py-1.5 active:cursor-grabbing"
                  onPointerDown={() => setArmed(b.key)}
                  onPointerUp={() => setArmed(null)}
                >
                  <GripVerticalIcon className="hidden size-4 shrink-0 cursor-grab text-muted-foreground sm:block" aria-hidden />
                  <span className="icon-chip size-7 rounded-lg text-primary">
                    <Icon className="size-3.5" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{t(`site.blocks.type.${b.type}`)}</span>
                  <Button type="button" variant="ghost" size="icon-sm" disabled={disabled || i === 0} onClick={() => sort.move(i, -1)} aria-label={t("site.common.moveUpN", { n: i + 1 })}>
                    <ArrowUpIcon />
                  </Button>
                  <Button type="button" variant="ghost" size="icon-sm" disabled={disabled || i === value.length - 1} onClick={() => sort.move(i, 1)} aria-label={t("site.common.moveDownN", { n: i + 1 })}>
                    <ArrowDownIcon />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={disabled || full}
                    onClick={() => {
                      const copy = duplicateBlockForm(b);
                      const next = [...value];
                      next.splice(i + 1, 0, copy);
                      onChange(next);
                    }}
                    aria-label={t("site.common.duplicateN", { n: i + 1 })}
                  >
                    <CopyIcon />
                  </Button>
                  <Button type="button" variant="ghost" size="icon-sm" className="text-destructive" disabled={disabled} onClick={() => onChange(value.filter((x) => x.key !== b.key))} aria-label={t("site.common.removeN", { n: i + 1 })}>
                    <Trash2Icon />
                  </Button>
                </div>
                <div className="grid gap-3 p-3">
                  <BlockFields block={b} onChange={(nb) => patch(b.key, nb)} errors={errs} disabled={disabled} idp={`${idPrefix}-${b.key}`} />
                </div>
               </div>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ol>
      {!disabled && (
        <div className="grid gap-2 rounded-xl border border-dashed p-3">
          <p className="flex items-center gap-1.5 text-meta font-medium text-muted-foreground">
            <PlusIcon className="size-3.5" /> {full ? t("site.blocks.full", { max: BLOCK_LIMITS.blocks }) : t("site.blocks.add")}
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {BLOCK_TYPES.map((type) => {
              const Icon = BLOCK_ICONS[type];
              return (
                <Button key={type} type="button" variant="outline" size="lg" className="h-auto min-h-11 min-w-0 justify-start py-2 text-start whitespace-normal" disabled={full} onClick={() => add(type)}>
                  <Icon /> {t(`site.blocks.type.${type}`)}
                </Button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function BlockFields({
  block: b,
  onChange,
  errors,
  disabled,
  idp,
}: {
  block: BlockForm;
  onChange: (b: BlockForm) => void;
  errors: FieldErrors;
  disabled?: boolean;
  idp: string;
}) {
  const { t } = useI18n();
  switch (b.type) {
    case "heading":
      return (
        <>
          <ChipGroup<"2" | "3">
            size="sm"
            value={String(b.level) as "2" | "3"}
            onChange={(v) => onChange({ ...b, level: v === "3" ? 3 : 2 })}
            aria-label={t("site.blocks.level")}
            options={[
              { value: "2", label: t("site.blocks.levelLarge") },
              { value: "3", label: t("site.blocks.levelSmall") },
            ]}
          />
          <TextField id={`${idp}-text`} label={t("site.blocks.headingText")} value={b.text} maxLength={200} disabled={disabled} error={errors.text} onChange={(text) => onChange({ ...b, text })} inputClassName={b.level === 2 ? "text-lg font-semibold" : "font-semibold"} />
        </>
      );
    case "paragraph":
      return <MarkdownField id={`${idp}-md`} label={t("site.blocks.text")} hideLabel value={b.markdown} rows={5} maxLength={20_000} disabled={disabled} error={errors.markdown} onChange={(markdown) => onChange({ ...b, markdown })} />;
    case "image":
      return (
        <>
          <ImageField value={b.url} onChange={(url) => onChange({ ...b, url })} disabled={disabled} aspect="aspect-[16/9]" invalid={!!errors.url} />
          <FieldError code={errors.url} />
          <div className="grid items-start gap-3 sm:grid-cols-2">
            <TextField id={`${idp}-alt`} label={t("site.media.alt")} hint={t("site.media.altHint")} value={b.alt} maxLength={200} disabled={disabled} error={errors.alt} onChange={(alt) => onChange({ ...b, alt })} />
            <TextField id={`${idp}-cap`} label={t("site.media.caption")} optional value={b.caption} maxLength={300} disabled={disabled} error={errors.caption} onChange={(caption) => onChange({ ...b, caption })} />
          </div>
        </>
      );
    case "gallery":
      return (
        <>
          <GalleryField value={b.images} onChange={(images) => onChange({ ...b, images })} max={BLOCK_LIMITS.gallery} disabled={disabled} />
          <FieldError code={errors.images ?? Object.entries(errors).find(([k]) => k.startsWith("images."))?.[1]} />
        </>
      );
    case "button":
      return (
        <div className="grid items-start gap-3 sm:grid-cols-2">
          <TextField id={`${idp}-label`} label={t("site.blocks.buttonLabel")} value={b.label} maxLength={60} disabled={disabled} error={errors.label} onChange={(label) => onChange({ ...b, label })} />
          <TextField id={`${idp}-href`} label={t("site.blocks.buttonLink")} hint={t("site.common.linkHint")} placeholder="/products" value={b.href} disabled={disabled} error={errors.href} onChange={(href) => onChange({ ...b, href })} />
          <div className="grid content-start gap-2 sm:col-span-2">
            <Label>{t("site.blocks.buttonStyle")}</Label>
            <ChipGroup<"primary" | "secondary">
              size="sm"
              value={b.style}
              onChange={(style) => onChange({ ...b, style })}
              aria-label={t("site.blocks.buttonStyle")}
              options={[
                { value: "primary", label: t("site.blocks.stylePrimary") },
                { value: "secondary", label: t("site.blocks.styleSecondary") },
              ]}
            />
          </div>
        </div>
      );
    case "faq":
      return (
        <div className="grid gap-3">
          {b.items.map((it, i) => (
            <div key={i} className="grid gap-2 rounded-lg border bg-muted/20 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-muted-foreground">{t("site.blocks.question", { n: i + 1 })}</span>
                <Button type="button" variant="ghost" size="icon-sm" disabled={disabled || b.items.length <= 1} onClick={() => onChange({ ...b, items: b.items.filter((_, j) => j !== i) })} aria-label={t("site.common.removeN", { n: i + 1 })}>
                  <XIcon />
                </Button>
              </div>
              <TextField id={`${idp}-q${i}`} label={t("site.blocks.q")} value={it.q} maxLength={300} disabled={disabled} error={errors[`items.${i}.q`]} onChange={(q) => onChange({ ...b, items: b.items.map((x, j) => (j === i ? { ...x, q } : x)) })} />
              <MarkdownField id={`${idp}-a${i}`} label={t("site.blocks.a")} rows={3} value={it.a} maxLength={3000} disabled={disabled} error={errors[`items.${i}.a`]} onChange={(a) => onChange({ ...b, items: b.items.map((x, j) => (j === i ? { ...x, a } : x)) })} />
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" className="justify-self-start" disabled={disabled || b.items.length >= BLOCK_LIMITS.faq} onClick={() => onChange({ ...b, items: [...b.items, { q: "", a: "" }] })}>
            <PlusIcon /> {t("site.blocks.addQuestion")}
          </Button>
        </div>
      );
    case "video": {
      const id = extractYoutubeId(b.video);
      return (
        <div className="grid items-start gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
          <div className="grid content-start gap-3">
            <TextField id={`${idp}-yt`} label={t("site.blocks.youtube")} placeholder="https://www.youtube.com/watch?v=…" hint={t("site.blocks.youtubeHint")} value={b.video} disabled={disabled} error={errors.video} onChange={(video) => onChange({ ...b, video })} />
            <TextField id={`${idp}-yt-title`} label={t("site.blocks.videoTitle")} optional value={b.title} maxLength={200} disabled={disabled} onChange={(title) => onChange({ ...b, title })} />
          </div>
          <div className="aspect-video overflow-hidden rounded-xl bg-muted ring-1 ring-border">
            {id ? (
              // eslint-disable-next-line @next/next/no-img-element -- YouTube thumbnail
              <img src={youtubeThumb(id)} alt="" className="size-full object-cover" />
            ) : (
              <span className="flex size-full items-center justify-center text-muted-foreground">
                <YoutubeIcon className="size-8 opacity-50" />
              </span>
            )}
          </div>
        </div>
      );
    }
    case "divider":
      return (
        <div className="flex items-center gap-3 py-1 text-xs text-muted-foreground">
          <span className="h-px flex-1 bg-border" />
          {t("site.blocks.dividerHint")}
          <span className="h-px flex-1 bg-border" />
        </div>
      );
  }
}
