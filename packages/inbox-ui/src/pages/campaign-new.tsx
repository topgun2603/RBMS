"use client";

import * as React from "react";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CalendarClockIcon,
  CheckIcon,
  FileTextIcon,
  Loader2Icon,
  MegaphoneIcon,
  PlusIcon,
  SaveIcon,
  SendIcon,
  Trash2Icon,
  UsersRoundIcon,
} from "lucide-react";
import {
  AnimatePresence,
  Button,
  Card,
  cn,
  EmptyState,
  Field,
  FieldControl,
  FieldError,
  FieldHint,
  FieldLabel,
  FieldRow,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  motion,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Textarea,
  toast,
  useReducedMotionSafe,
} from "@srirealtime/ui";
import { describeError, Page, PageHeading, QueryError, useDebounced, useI18n, useModuleNavigate } from "@srirealtime/web";
import { AiCampaignWriter } from "../components/ai-campaign-writer";
import { Section, TagEditor } from "../components/bits";
import { useSlotName } from "../components/template-dialog";
import { TemplatePreviewCard } from "../components/template-preview";
import { parsePhoneList } from "../lib/format";
import { useAudiencePreview, useAudienceSources, useCreateCampaign, useWaTags, useWaTemplates } from "../lib/queries";
import { defaultMapping, mappedValues, previewTemplate, setSourceKind, unmappedSlots } from "../lib/templates";
import { istLocalToIso, isoToIstLocal } from "../lib/time";
import { AUDIENCE_KINDS, type AudienceKind, type AudienceSource, type ParamSource, type TemplateMapping, type WaTemplate } from "../lib/types";

const STEPS = ["name", "audience", "template", "schedule", "review"] as const;
type Step = (typeof STEPS)[number];

/** Editor state of one audience source (inputs kept as strings until sent). */
type SourceDraft =
  | { kind: "wa_contacts"; tags: string[]; match: "any" | "all" }
  | { kind: "dues"; minDue: string }
  | { kind: "recent_orders"; days: string }
  | { kind: "loyalty_tier"; tiers: string[] }
  | { kind: "customers" }
  | { kind: "phones"; text: string };

const blank = (kind: AudienceKind): SourceDraft => {
  switch (kind) {
    case "wa_contacts":
      return { kind, tags: [], match: "any" };
    case "dues":
      return { kind, minDue: "1" };
    case "recent_orders":
      return { kind, days: "30" };
    case "loyalty_tier":
      return { kind, tiers: [] };
    case "customers":
      return { kind };
    case "phones":
      return { kind, text: "" };
  }
};

/** Draft → API source, or null while it isn't valid yet. */
export function toSource(d: SourceDraft): AudienceSource | null {
  switch (d.kind) {
    case "wa_contacts":
      return { kind: d.kind, ...(d.tags.length ? { tags: d.tags } : {}), match: d.match };
    case "dues": {
      const r = Number(d.minDue.replace(/[,₹\s]/g, ""));
      return Number.isFinite(r) && r >= 0 ? { kind: d.kind, minDue: Math.max(1, Math.round(r * 100)) } : null;
    }
    case "recent_orders": {
      const n = Number(d.days);
      return Number.isInteger(n) && n >= 1 && n <= 730 ? { kind: d.kind, days: n } : null;
    }
    case "loyalty_tier":
      return d.tiers.length ? { kind: d.kind, tiers: d.tiers } : null;
    case "customers":
      return { kind: d.kind };
    case "phones": {
      const { items } = parsePhoneList(d.text);
      return items.length ? { kind: d.kind, items } : null;
    }
  }
}

export default function CampaignNewPage() {
  const { t, formatDate, formatNumber } = useI18n();
  const navigate = useModuleNavigate();
  const reduced = useReducedMotionSafe();
  const kinds = useAudienceSources();
  const templates = useWaTemplates();
  const tags = useWaTags();
  const create = useCreateCampaign();
  const slotName = useSlotName();

  const [step, setStep] = React.useState<Step>("name");
  const [dir, setDir] = React.useState(1);
  const [tried, setTried] = React.useState<Partial<Record<Step, boolean>>>({});
  const [name, setName] = React.useState("");
  const [sources, setSources] = React.useState<SourceDraft[]>([blank("wa_contacts")]);
  const [excludeTags, setExcludeTags] = React.useState<string[]>([]);
  const [templateId, setTemplateId] = React.useState<string>("");
  const [mapping, setMapping] = React.useState<TemplateMapping>({ params: {} });
  const [when, setWhen] = React.useState<"now" | "later">("now");
  const [at, setAt] = React.useState(() => isoToIstLocal(new Date(Date.now() + 60 * 60_000)));

  const approved = (templates.data ?? []).filter((x) => x.status === "APPROVED");
  const tpl: WaTemplate | undefined = approved.find((x) => x.id === templateId);
  const built = sources.map(toSource);
  const audience = { sources: built.filter((s): s is AudienceSource => !!s), ...(excludeTags.length ? { excludeTags } : {}) };
  const debouncedBody = useDebounced(JSON.stringify({ audience, templateId: templateId || undefined, mapping: tpl ? mapping : undefined }), 500);
  const preview = useAudiencePreview(React.useMemo(() => JSON.parse(debouncedBody) as Parameters<typeof useAudiencePreview>[0], [debouncedBody]));

  const pickTemplate = (id: string) => {
    setTemplateId(id);
    const x = approved.find((a) => a.id === id);
    setMapping(x ? (x.mapping && Object.keys(x.mapping.params ?? {}).length ? x.mapping : defaultMapping(x.slots)) : { params: {} });
  };

  const scheduleIso = when === "later" ? istLocalToIso(at) : null;
  const errors: Record<Step, string | null> = {
    name: name.trim() ? null : t("inbox.campaign.err.name"),
    audience: built.some((s) => !s) || audience.sources.length === 0 ? t("inbox.campaign.err.audience") : null,
    template: !tpl
      ? t("inbox.campaign.err.template")
      : unmappedSlots(tpl.slots, mapping).length
        ? t("inbox.campaign.err.mapping")
        : tpl.headerMediaType && !/^https?:\/\/\S+$/.test(mapping.headerMedia?.link ?? "")
          ? t("inbox.tpl.mediaInvalid")
          : null,
    schedule: when === "later" && (!scheduleIso || Date.parse(scheduleIso) < Date.now() + 60_000) ? t("inbox.campaign.err.schedule") : null,
    review: null,
  };
  const index = STEPS.indexOf(step);

  const go = (to: Step) => {
    const i = STEPS.indexOf(to);
    if (i > index) {
      const blocking = STEPS.slice(0, i).find((s) => errors[s]);
      if (blocking) {
        setTried((p) => ({ ...p, [blocking]: true }));
        setDir(STEPS.indexOf(blocking) >= index ? 1 : -1);
        setStep(blocking);
        return;
      }
    }
    setDir(i >= index ? 1 : -1);
    setStep(to);
  };

  const finish = async (start: boolean) => {
    const blocking = STEPS.find((s) => errors[s]);
    if (blocking) return go(blocking);
    try {
      const c = await create.mutateAsync({
        input: { name: name.trim(), templateId, mapping, audience, scheduleAt: scheduleIso },
        start,
      });
      toast.success(start ? (scheduleIso ? t("inbox.campaign.scheduledToast") : t("inbox.campaign.startedToast")) : t("inbox.campaign.savedToast"));
      navigate(`campaigns/${c.id}`, { replace: true });
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  const available = (kinds.data ?? ["wa_contacts", "phones"]).filter((k): k is AudienceKind => (AUDIENCE_KINDS as string[]).includes(k));

  return (
    <Page className="pb-0 lg:pb-0">
      <PageHeading icon={MegaphoneIcon} title={t("inbox.campaign.new")} description={t("inbox.campaign.newBody")} back={{ href: "campaigns", label: t("inbox.campaign.title") }} />

      <ol className="mb-6 flex gap-1 overflow-x-auto pb-1 [scrollbar-width:none]" aria-label={t("inbox.campaign.steps")}>
        {STEPS.map((s, i) => {
          const done = i < index && !errors[s];
          return (
            <li key={s} className="min-w-0 flex-1">
              <button
                type="button"
                onClick={() => go(s)}
                aria-current={s === step ? "step" : undefined}
                className={cn(
                  "flex w-full min-w-24 items-center gap-2 rounded-xl border px-2.5 py-2 text-left text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                  s === step ? "border-primary bg-primary/8 text-foreground" : "bg-card text-muted-foreground hover:bg-accent/50",
                )}
              >
                <span className={cn("inline-flex size-6 shrink-0 items-center justify-center rounded-full text-xs tabular-nums", done ? "bg-success text-white dark:bg-success/60" : s === step ? "bg-primary text-primary-foreground" : "bg-muted")}>
                  {done ? <CheckIcon className="size-3.5" /> : i + 1}
                </span>
                <span className="truncate">{t(`inbox.campaign.step.${s}`)}</span>
              </button>
            </li>
          );
        })}
      </ol>

      <div className="grid gap-section lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 overflow-hidden">
          <AnimatePresence mode="wait" custom={dir} initial={false}>
            <motion.div
              key={step}
              custom={dir}
              initial={reduced ? false : { opacity: 0, x: dir * 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={reduced ? undefined : { opacity: 0, x: dir * -24 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="grid gap-4"
            >
              {step === "name" && (
                <AiCampaignWriter
                  onApply={(a) => {
                    setName(a.name);
                    setSources([{ kind: "phones", text: a.phonesText }]);
                    setWhen("later");
                    setAt(isoToIstLocal(new Date(a.sendAtIso)));
                  }}
                />
              )}
              {step === "name" && (
                <Section icon={MegaphoneIcon} title={t("inbox.campaign.step.name")} description={t("inbox.campaign.nameHint")}>
                  <Field invalid={!!tried.name && !!errors.name}>
                    <FieldLabel>{t("inbox.campaign.name")}</FieldLabel>
                    <FieldControl>
                      <Input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder={t("inbox.campaign.namePlaceholder")} autoFocus />
                    </FieldControl>
                    <FieldHint>{t("inbox.campaign.nameHelp")}</FieldHint>
                    <FieldError>{tried.name ? errors.name : null}</FieldError>
                  </Field>
                </Section>
              )}

              {step === "audience" && (
                <>
                  {sources.map((d, i) => (
                    <SourceEditor
                      key={i}
                      draft={d}
                      invalid={!!tried.audience && !built[i]}
                      tagSuggestions={(tags.data ?? []).map((x) => x.tag)}
                      onChange={(next) => setSources((l) => l.map((x, j) => (j === i ? next : x)))}
                      onRemove={sources.length > 1 ? () => setSources((l) => l.filter((_, j) => j !== i)) : undefined}
                    />
                  ))}
                  <Card className="p-card">
                    <p className="text-sm font-medium">{t("inbox.campaign.addSource")}</p>
                    <div className="flex flex-wrap gap-2">
                      {kinds.isPending ? (
                        <Skeleton className="h-9 w-64" />
                      ) : (
                        available.map((k) => (
                          <Button key={k} variant="outline" size="sm" onClick={() => setSources((l) => [...l, blank(k)])} disabled={sources.length >= 10}>
                            <PlusIcon /> {t(`inbox.audience.${k}`)}
                          </Button>
                        ))
                      )}
                    </div>
                    <Field>
                      <FieldLabel htmlFor={null} optional={t("inbox.common.optional")}>
                        {t("inbox.campaign.excludeTags")}
                      </FieldLabel>
                      <TagEditor value={excludeTags} onChange={setExcludeTags} label={t("inbox.campaign.excludeTags")} placeholder={t("inbox.wa.addTag")} suggestions={(tags.data ?? []).map((x) => x.tag)} />
                      <FieldHint>{t("inbox.campaign.excludeHint")}</FieldHint>
                    </Field>
                    {tried.audience && errors.audience && <p className="text-xs text-destructive">{errors.audience}</p>}
                  </Card>
                </>
              )}

              {step === "template" && (
                <Section icon={FileTextIcon} title={t("inbox.campaign.step.template")} description={t("inbox.campaign.templateHint")}>
                  {templates.isError ? (
                    <QueryError compact error={templates.error} onRetry={() => void templates.refetch()} />
                  ) : templates.isPending ? (
                    <Skeleton className="h-10 w-full" />
                  ) : approved.length === 0 ? (
                    <EmptyState compact icon={FileTextIcon} title={t("inbox.tpl.none")} description={t("inbox.tpl.noneBody")} />
                  ) : (
                    <Field invalid={!!tried.template && !tpl}>
                      <FieldLabel>{t("inbox.campaign.template")}</FieldLabel>
                      <Select value={templateId} onValueChange={pickTemplate}>
                        <FieldControl>
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder={t("inbox.tpl.pick")} />
                          </SelectTrigger>
                        </FieldControl>
                        <SelectContent>
                          {approved.map((x) => (
                            <SelectItem key={x.id} value={x.id}>
                              {x.name} · {x.language}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                  )}
                  {tpl && (
                    <>
                      {tpl.headerMediaType && (
                        <Field invalid={!!tried.template && !/^https?:\/\/\S+$/.test(mapping.headerMedia?.link ?? "")}>
                          <FieldLabel>{t(`inbox.tpl.media.${tpl.headerMediaType}`)}</FieldLabel>
                          <FieldControl>
                            <Input
                              value={mapping.headerMedia?.link ?? ""}
                              inputMode="url"
                              placeholder="https://"
                              onChange={(e) => setMapping((m) => ({ ...m, headerMedia: { type: tpl.headerMediaType!, link: e.target.value.trim() } }))}
                            />
                          </FieldControl>
                          <FieldHint>{t("inbox.tpl.mediaHint")}</FieldHint>
                        </Field>
                      )}
                      {tpl.slots.length === 0 && <p className="text-sm text-muted-foreground">{t("inbox.tpl.noVars")}</p>}
                      {tpl.slots.map((s) => (
                        <MappingRow
                          key={s.slot}
                          label={slotName(s)}
                          src={mapping.params[s.slot]}
                          invalid={!!tried.template && unmappedSlots([s], mapping).length > 0}
                          onKind={(k) => setMapping((m) => setSourceKind(m, s, k))}
                          onChange={(src) => setMapping((m) => ({ ...m, params: { ...m.params, [s.slot]: src } }))}
                        />
                      ))}
                      {tried.template && errors.template && <p className="text-xs text-destructive">{errors.template}</p>}
                    </>
                  )}
                </Section>
              )}

              {step === "schedule" && (
                <Section icon={CalendarClockIcon} title={t("inbox.campaign.step.schedule")} description={t("inbox.campaign.scheduleHint")}>
                  <Field>
                    <FieldLabel htmlFor={null}>{t("inbox.campaign.when")}</FieldLabel>
                    <RadioGroup value={when} onValueChange={(v) => setWhen(v as "now" | "later")} className="grid gap-2 sm:grid-cols-2">
                      {(["now", "later"] as const).map((v) => (
                        <label key={v} className={cn("flex cursor-pointer items-start gap-3 rounded-xl border p-3", when === v && "border-primary bg-primary/5")}>
                          <RadioGroupItem value={v} className="mt-0.5" />
                          <span>
                            <span className="block text-sm font-medium">{t(`inbox.campaign.when.${v}`)}</span>
                            <span className="block text-xs text-muted-foreground">{t(`inbox.campaign.whenHint.${v}`)}</span>
                          </span>
                        </label>
                      ))}
                    </RadioGroup>
                  </Field>
                  {when === "later" && (
                    <Field invalid={!!tried.schedule && !!errors.schedule}>
                      <FieldLabel>{t("inbox.campaign.at")}</FieldLabel>
                      <FieldControl>
                        <Input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} className="sm:max-w-xs" />
                      </FieldControl>
                      <FieldHint>{t("inbox.campaign.atHint")}</FieldHint>
                      <FieldError>{tried.schedule ? errors.schedule : null}</FieldError>
                    </Field>
                  )}
                  {preview.data && (
                    <p className="text-meta text-muted-foreground">{t("inbox.campaign.duration", { minutes: preview.data.minutes, rate: preview.data.ratePerMinute })}</p>
                  )}
                </Section>
              )}

              {step === "review" && (
                <Section icon={CheckIcon} title={t("inbox.campaign.step.review")} description={t("inbox.campaign.reviewHint")}>
                  <dl className="grid gap-3 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="text-xs text-muted-foreground">{t("inbox.campaign.name")}</dt>
                      <dd className="font-medium">{name || "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">{t("inbox.campaign.template")}</dt>
                      <dd className="font-mono font-medium">{tpl ? `${tpl.name} · ${tpl.language}` : "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">{t("inbox.campaign.audience")}</dt>
                      <dd className="font-medium">{audience.sources.map((s) => t(`inbox.audience.${s.kind}`)).join(" + ") || "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">{t("inbox.campaign.when")}</dt>
                      <dd className="font-medium">{scheduleIso ? formatDate(scheduleIso, { dateStyle: "medium", timeStyle: "short" }) : t("inbox.campaign.when.now")}</dd>
                    </div>
                  </dl>
                  {preview.data && (
                    <p className="rounded-xl bg-primary/8 px-3 py-2 text-sm">
                      {t("inbox.campaign.willSend", { count: preview.data.sendable })}
                    </p>
                  )}
                </Section>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        <aside className="grid content-start gap-4 lg:sticky lg:top-20">
          <Section icon={UsersRoundIcon} title={t("inbox.campaign.liveCount")}>
            {preview.isError ? (
              <p className="text-xs text-destructive">{describeError(preview.error, t)}</p>
            ) : !preview.data ? (
              audience.sources.length ? <Skeleton className="h-16 w-full" /> : <p className="text-meta text-muted-foreground">{t("inbox.campaign.pickAudience")}</p>
            ) : (
              <div className={cn("grid gap-2 transition-opacity", preview.isFetching && "opacity-60")} aria-live="polite">
                <p className="flex items-baseline gap-2">
                  <span className="font-heading text-3xl font-bold tabular-nums">{formatNumber(preview.data.sendable)}</span>
                  <span className="text-xs text-muted-foreground">{t("inbox.campaign.willGet")}</span>
                  {preview.isFetching && <Loader2Icon className="size-3.5 animate-spin text-muted-foreground" aria-hidden />}
                </p>
                <ul className="grid gap-1 text-xs text-muted-foreground">
                  <li>{t("inbox.campaign.found", { count: preview.data.total })}</li>
                  {preview.data.optedOut > 0 && <li>{t("inbox.campaign.optedOut", { count: preview.data.optedOut })}</li>}
                  {preview.data.duplicates > 0 && <li>{t("inbox.campaign.duplicates", { count: preview.data.duplicates })}</li>}
                  {preview.data.invalid > 0 && <li>{t("inbox.campaign.invalid", { count: preview.data.invalid })}</li>}
                  {preview.data.excluded > 0 && <li>{t("inbox.campaign.excluded", { count: preview.data.excluded })}</li>}
                </ul>
              </div>
            )}
          </Section>
          {tpl && (
            <Section icon={FileTextIcon} title={t("inbox.tpl.preview")}>
              <TemplatePreviewCard
                preview={previewTemplate(tpl, mappedValues(tpl.slots, mapping, { phone: "+91 98765 43210", name: preview.data?.sample[0]?.name ?? null, variables: {} }), { headerMedia: !!mapping.headerMedia?.link })}
                mediaType={tpl.headerMediaType}
                mediaLink={mapping.headerMedia?.link}
              />
              {(preview.data?.sample.length ?? 0) > 0 && (
                <div className="grid gap-1.5">
                  <p className="text-meta font-medium text-muted-foreground">{t("inbox.campaign.samples")}</p>
                  {preview.data!.sample.slice(0, 3).map((s) => (
                    <div key={s.phone} className="rounded-lg border bg-muted/30 px-2.5 py-1.5 text-xs">
                      <p className="font-medium">{s.name ?? s.phone}</p>
                      {s.missing.length ? <p className="text-danger-ink">{t("inbox.campaign.sampleMissing", { slots: s.missing.join(", ") })}</p> : <p className="line-clamp-3 whitespace-pre-wrap text-muted-foreground">{s.text}</p>}
                    </div>
                  ))}
                </div>
              )}
            </Section>
          )}
        </aside>
      </div>

      <div className="sticky bottom-0 z-40 -mx-4 mt-6 border-t border-border/70 bg-card/90 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-[0_-8px_24px_-12px_oklch(0_0_0/0.18)] backdrop-blur-md sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => index > 0 && go(STEPS[index - 1]!)} disabled={index === 0}>
            <ArrowLeftIcon /> <span className="max-sm:sr-only">{t("inbox.common.back")}</span>
          </Button>
          <div className="flex-1" />
          {step === "review" ? (
            <>
              <Button variant="outline" onClick={() => void finish(false)} disabled={create.isPending}>
                <SaveIcon /> <span className="max-sm:sr-only">{t("inbox.campaign.saveDraft")}</span>
              </Button>
              <Button onClick={() => void finish(true)} disabled={create.isPending}>
                {create.isPending ? <Loader2Icon className="animate-spin" /> : scheduleIso ? <CalendarClockIcon /> : <SendIcon />}
                {scheduleIso ? t("inbox.campaign.schedule") : t("inbox.campaign.sendNow")}
              </Button>
            </>
          ) : (
            <Button onClick={() => (errors[step] ? setTried((p) => ({ ...p, [step]: true })) : go(STEPS[index + 1]!))}>
              {t("inbox.common.next")} <ArrowRightIcon />
            </Button>
          )}
        </div>
      </div>
    </Page>
  );
}

function SourceEditor({
  draft,
  onChange,
  onRemove,
  invalid,
  tagSuggestions,
}: {
  draft: SourceDraft;
  onChange: (d: SourceDraft) => void;
  onRemove?: () => void;
  invalid: boolean;
  tagSuggestions: string[];
}) {
  const { t } = useI18n();
  const parsed = draft.kind === "phones" ? parsePhoneList(draft.text) : null;
  return (
    <Section
      icon={UsersRoundIcon}
      title={t(`inbox.audience.${draft.kind}`)}
      description={t(`inbox.audienceHint.${draft.kind}`)}
      className={cn(invalid && "border-destructive/50")}
      action={
        onRemove && (
          <Button variant="ghost" size="icon-sm" onClick={onRemove} aria-label={t("inbox.common.removeNamed", { name: t(`inbox.audience.${draft.kind}`) })}>
            <Trash2Icon />
          </Button>
        )
      }
    >
      {draft.kind === "wa_contacts" && (
        <FieldRow cols={2}>
          <Field>
            <FieldLabel htmlFor={null} optional={t("inbox.common.optional")}>
              {t("inbox.audience.withTags")}
            </FieldLabel>
            <TagEditor value={draft.tags} onChange={(tags) => onChange({ ...draft, tags })} label={t("inbox.audience.withTags")} placeholder={t("inbox.audience.anyContact")} suggestions={tagSuggestions} />
          </Field>
          <Field>
            <FieldLabel>{t("inbox.audience.match")}</FieldLabel>
            <Select value={draft.match} onValueChange={(v) => onChange({ ...draft, match: v as "any" | "all" })} disabled={draft.tags.length < 2}>
              <FieldControl>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
              </FieldControl>
              <SelectContent>
                <SelectItem value="any">{t("inbox.audience.matchAny")}</SelectItem>
                <SelectItem value="all">{t("inbox.audience.matchAll")}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </FieldRow>
      )}
      {draft.kind === "dues" && (
        <Field invalid={invalid}>
          <FieldLabel>{t("inbox.audience.minDue")}</FieldLabel>
          <FieldControl>
            <InputGroup className="sm:max-w-xs">
              <InputGroupAddon>₹</InputGroupAddon>
              <InputGroupInput inputMode="decimal" value={draft.minDue} onChange={(e) => onChange({ ...draft, minDue: e.target.value })} />
            </InputGroup>
          </FieldControl>
        </Field>
      )}
      {draft.kind === "recent_orders" && (
        <Field invalid={invalid}>
          <FieldLabel>{t("inbox.audience.days")}</FieldLabel>
          <FieldControl>
            <InputGroup className="sm:max-w-xs">
              <InputGroupInput inputMode="numeric" value={draft.days} onChange={(e) => onChange({ ...draft, days: e.target.value.replace(/\D/g, "") })} />
              <InputGroupAddon>{t("inbox.audience.daysUnit")}</InputGroupAddon>
            </InputGroup>
          </FieldControl>
          <FieldError>{invalid ? t("inbox.audience.daysInvalid") : null}</FieldError>
        </Field>
      )}
      {draft.kind === "loyalty_tier" && (
        <Field invalid={invalid}>
          <FieldLabel htmlFor={null}>{t("inbox.audience.tiers")}</FieldLabel>
          <TagEditor value={draft.tiers} onChange={(tiers) => onChange({ ...draft, tiers })} label={t("inbox.audience.tiers")} placeholder={t("inbox.audience.tiersPlaceholder")} />
          <FieldError>{invalid ? t("inbox.audience.tiersRequired") : null}</FieldError>
        </Field>
      )}
      {draft.kind === "customers" && <p className="text-meta text-muted-foreground">{t("inbox.audienceHint.customersNote")}</p>}
      {draft.kind === "phones" && (
        <Field invalid={invalid}>
          <FieldLabel>{t("inbox.audience.paste")}</FieldLabel>
          <FieldControl>
            <Textarea rows={6} value={draft.text} onChange={(e) => onChange({ ...draft, text: e.target.value })} placeholder={"9876543210, Ravi\n9123456789, Meena"} className="font-mono text-sm" />
          </FieldControl>
          <FieldHint>{parsed && parsed.items.length ? t("inbox.audience.parsed", { count: parsed.items.length, skipped: parsed.skipped }) : t("inbox.audience.pasteHint")}</FieldHint>
        </Field>
      )}
    </Section>
  );
}

function MappingRow({
  label,
  src,
  invalid,
  onKind,
  onChange,
}: {
  label: string;
  src: ParamSource | undefined;
  invalid: boolean;
  onKind: (k: ParamSource["from"]) => void;
  onChange: (s: ParamSource) => void;
}) {
  const { t } = useI18n();
  const kind = src?.from ?? "text";
  return (
    <div className="grid gap-3 rounded-xl border bg-muted/20 p-3">
      <p className="font-mono text-xs font-medium">{label}</p>
      <FieldRow cols={2}>
        <Field>
          <FieldLabel>{t("inbox.map.source")}</FieldLabel>
          <Select value={kind} onValueChange={(v) => onKind(v as ParamSource["from"])}>
            <FieldControl>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
            </FieldControl>
            <SelectContent>
              {(["name", "phone", "var", "text"] as const).map((k) => (
                <SelectItem key={k} value={k}>
                  {t(`inbox.map.from.${k}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {kind === "text" && (
          <Field invalid={invalid}>
            <FieldLabel>{t("inbox.map.value")}</FieldLabel>
            <FieldControl>
              <Input value={src?.from === "text" ? src.value : ""} maxLength={1000} onChange={(e) => onChange({ from: "text", value: e.target.value })} />
            </FieldControl>
            <FieldError>{invalid ? t("inbox.tpl.required") : null}</FieldError>
          </Field>
        )}
        {kind === "var" && (
          <Field invalid={invalid}>
            <FieldLabel>{t("inbox.map.key")}</FieldLabel>
            <FieldControl>
              <Input
                value={src?.from === "var" ? src.key : ""}
                maxLength={60}
                className="font-mono"
                onChange={(e) => onChange({ from: "var", key: e.target.value, ...(src?.from === "var" && src.fallback ? { fallback: src.fallback } : {}) })}
              />
            </FieldControl>
            <FieldHint>{t("inbox.map.keyHint")}</FieldHint>
          </Field>
        )}
        {(kind === "name" || kind === "var") && (
          <Field>
            <FieldLabel optional={t("inbox.common.optional")}>{t("inbox.map.fallback")}</FieldLabel>
            <FieldControl>
              <Input
                value={src && (src.from === "name" || src.from === "var") ? (src.fallback ?? "") : ""}
                maxLength={200}
                onChange={(e) =>
                  onChange(
                    src?.from === "var"
                      ? { from: "var", key: src.key, ...(e.target.value ? { fallback: e.target.value } : {}) }
                      : { from: "name", ...(e.target.value ? { fallback: e.target.value } : {}) },
                  )
                }
              />
            </FieldControl>
            <FieldHint>{t("inbox.map.fallbackHint")}</FieldHint>
          </Field>
        )}
      </FieldRow>
    </div>
  );
}
