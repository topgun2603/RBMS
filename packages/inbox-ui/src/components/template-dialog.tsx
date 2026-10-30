"use client";

import * as React from "react";
import { ArrowLeftIcon, FileTextIcon, Loader2Icon, RefreshCwIcon, SendIcon, UploadIcon } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  FieldControl,
  FieldError,
  FieldHint,
  FieldLabel,
  Input,
  Skeleton,
  toast,
} from "@rbms/ui";
import { describeError, QueryError, SearchField, useI18n } from "@rbms/web";
import { previewTemplate, slotLabel } from "../lib/templates";
import { useSyncTemplates, useWaSend, useWaTemplates } from "../lib/queries";
import { uploadFile } from "../lib/uploads";
import type { TemplateSlot, WaTemplate } from "../lib/types";
import { TemplatePreviewCard } from "./template-preview";

/** "Body {{1}}" style label (built in code: message strings never contain braces). */
export function useSlotName() {
  const { t } = useI18n();
  return React.useCallback(
    (s: TemplateSlot) => {
      const l = slotLabel(s);
      const part = l.part === "button" ? t("inbox.tpl.part.button", { n: l.button ?? 1 }) : t(`inbox.tpl.part.${l.part}`);
      return s.buttonType === "copy_code" ? `${part} · ${t("inbox.tpl.code")}` : `${part} {{${l.key}}}`;
    },
    [t],
  );
}

/** Pick an approved template, fill its variables (with a live preview) and send it to one contact. */
export function TemplateDialog({ contactId, contactName, open, onOpenChange }: { contactId: string; contactName: string | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useI18n();
  const templates = useWaTemplates(open);
  const sync = useSyncTemplates();
  const send = useWaSend(contactId);
  const slotName = useSlotName();
  const [q, setQ] = React.useState("");
  const [chosen, setChosen] = React.useState<WaTemplate | null>(null);
  const [values, setValues] = React.useState<Record<string, string>>({});
  const [media, setMedia] = React.useState("");
  const [uploading, setUploading] = React.useState(false);
  const [tried, setTried] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    if (!open) {
      setChosen(null);
      setValues({});
      setMedia("");
      setTried(false);
      setQ("");
    }
  }, [open]);

  const pick = (tpl: WaTemplate) => {
    setChosen(tpl);
    // Pre-fill the customer's name where the saved mapping uses it.
    const next: Record<string, string> = {};
    for (const s of tpl.slots) {
      const src = tpl.mapping?.params?.[s.slot];
      if (src?.from === "name" && contactName) next[s.slot] = contactName;
      else if (src?.from === "text") next[s.slot] = src.value;
    }
    setValues(next);
    setMedia(tpl.mapping?.headerMedia?.link ?? "");
    setTried(false);
  };

  const approved = (templates.data ?? []).filter((x) => x.status === "APPROVED" && (!q || `${x.name} ${x.language} ${x.category ?? ""}`.toLowerCase().includes(q.toLowerCase())));
  const preview = chosen ? previewTemplate(chosen, values, { headerMedia: !!media.trim() }) : null;
  const mediaOk = !chosen?.headerMediaType || /^https?:\/\/\S+$/.test(media.trim());

  const submit = async () => {
    setTried(true);
    if (!chosen || !preview || preview.missing.length || !mediaOk) return;
    try {
      await send.mutateAsync({
        type: "template",
        templateId: chosen.id,
        values,
        ...(chosen.headerMediaType ? { headerMedia: { type: chosen.headerMediaType, link: media.trim() } } : {}),
      });
      toast.success(t("inbox.tpl.sent"));
      onOpenChange(false);
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {chosen && (
              <Button variant="ghost" size="icon-sm" onClick={() => setChosen(null)} aria-label={t("inbox.common.back")}>
                <ArrowLeftIcon />
              </Button>
            )}
            {chosen ? chosen.name : t("inbox.tpl.pick")}
          </DialogTitle>
          <DialogDescription>{chosen ? t("inbox.tpl.fillBody") : t("inbox.tpl.pickBody")}</DialogDescription>
        </DialogHeader>

        {!chosen ? (
          <div className="grid gap-3">
            <div className="flex gap-2">
              <SearchField value={q} onChange={setQ} placeholder={t("inbox.tpl.search")} size="default" className="flex-1" />
              <Button
                variant="outline"
                onClick={async () => {
                  try {
                    const r = await sync.mutateAsync();
                    toast.success(t("inbox.tpl.synced", { count: r.total }));
                  } catch (err) {
                    toast.error(describeError(err, t));
                  }
                }}
                disabled={sync.isPending}
              >
                {sync.isPending ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />}
                <span className="max-sm:sr-only">{t("inbox.tpl.sync")}</span>
              </Button>
            </div>
            {templates.isError ? (
              <QueryError compact error={templates.error} onRetry={() => void templates.refetch()} />
            ) : templates.isPending ? (
              <div className="grid gap-2">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-16 rounded-xl" />
                ))}
              </div>
            ) : approved.length === 0 ? (
              <EmptyState compact icon={FileTextIcon} title={t("inbox.tpl.none")} description={t("inbox.tpl.noneBody")} />
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2">
                {approved.map((tpl) => {
                  const p = previewTemplate(tpl, {});
                  return (
                    <li key={tpl.id}>
                      <button
                        type="button"
                        onClick={() => pick(tpl)}
                        className="flex h-full w-full flex-col gap-1 rounded-xl border bg-card p-3 text-left outline-none hover:border-primary/40 hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span className="flex items-center gap-2">
                          <span className="min-w-0 flex-1 truncate font-mono text-sm font-medium">{tpl.name}</span>
                          <span className="rounded bg-muted px-1.5 text-[0.625rem] uppercase">{tpl.language}</span>
                        </span>
                        <span className="line-clamp-2 text-xs text-muted-foreground">{p.body}</span>
                        {tpl.category && <span className="text-[0.625rem] tracking-wide text-muted-foreground uppercase">{tpl.category}</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ) : (
          <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="grid content-start gap-4">
              {chosen.slots.length === 0 && !chosen.headerMediaType && <p className="text-sm text-muted-foreground">{t("inbox.tpl.noVars")}</p>}
              {chosen.headerMediaType && (
                <Field invalid={tried && !mediaOk}>
                  <FieldLabel aside={uploading ? <Loader2Icon className="size-3.5 animate-spin" /> : undefined}>{t(`inbox.tpl.media.${chosen.headerMediaType}`)}</FieldLabel>
                  <div className="flex gap-2">
                    <FieldControl>
                      <Input value={media} onChange={(e) => setMedia(e.target.value)} placeholder="https://" inputMode="url" />
                    </FieldControl>
                    <input
                      ref={fileRef}
                      type="file"
                      hidden
                      accept={chosen.headerMediaType === "image" ? "image/*" : chosen.headerMediaType === "video" ? "video/*" : "application/pdf"}
                      onChange={async (e) => {
                        const f = e.target.files?.[0];
                        e.target.value = "";
                        if (!f) return;
                        setUploading(true);
                        try {
                          setMedia((await uploadFile(f, { purpose: "whatsapp" })).url);
                        } catch (err) {
                          toast.error(describeError(err, t));
                        } finally {
                          setUploading(false);
                        }
                      }}
                    />
                    <Button type="button" variant="outline" size="icon" onClick={() => fileRef.current?.click()} aria-label={t("inbox.tpl.upload")} disabled={uploading}>
                      <UploadIcon />
                    </Button>
                  </div>
                  <FieldHint>{t("inbox.tpl.mediaHint")}</FieldHint>
                  <FieldError>{tried && !mediaOk ? t("inbox.tpl.mediaInvalid") : null}</FieldError>
                </Field>
              )}
              {chosen.slots.map((s) => {
                const missing = tried && !!preview?.missing.includes(s.slot);
                return (
                  <Field key={s.slot} invalid={missing}>
                    <FieldLabel>{slotName(s)}</FieldLabel>
                    <FieldControl>
                      <Input value={values[s.slot] ?? ""} maxLength={1000} onChange={(e) => setValues((v) => ({ ...v, [s.slot]: e.target.value }))} />
                    </FieldControl>
                    <FieldError>{missing ? t("inbox.tpl.required") : null}</FieldError>
                  </Field>
                );
              })}
            </div>
            <div className="grid content-start gap-2">
              <p className="text-meta font-medium text-muted-foreground">{t("inbox.tpl.preview")}</p>
              {preview && <TemplatePreviewCard preview={preview} mediaType={chosen.headerMediaType} mediaLink={media} />}
            </div>
          </div>
        )}

        {chosen && (
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t("inbox.common.cancel")}
            </Button>
            <Button onClick={() => void submit()} disabled={send.isPending || uploading}>
              {send.isPending ? <Loader2Icon className="animate-spin" /> : <SendIcon />}
              {t("inbox.tpl.send")}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
