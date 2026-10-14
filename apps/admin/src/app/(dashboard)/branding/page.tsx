"use client";

import * as React from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2Icon, Loader2Icon, MoonIcon, RotateCcwIcon, SaveIcon, SunIcon, TriangleAlertIcon } from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ColorInput,
  cn,
  Input,
  Label,
  PageHeader,
  Progress,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Skeleton,
  Slider,
  Switch,
  Tabs,
  TabsList,
  TabsTrigger,
  toast,
} from "@srirealtime/ui";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ImageUpload } from "@/components/image-upload";
import { Page } from "@/components/page";
import { QueryError } from "@/components/query-state";
import { api } from "@/lib/api";
import { BRAND_FONTS, scopeBrandingCss, useWebFonts } from "@/lib/branding";
import { describeError, useI18n } from "@/lib/i18n";
import { qk } from "@/lib/queries";
import type { Branding, BrandingPreview, BrandTokens } from "@/lib/types";

interface Draft {
  appName: string;
  logoUrl: string | null;
  logoDarkUrl: string | null;
  faviconUrl: string | null;
  primary: string;
  secondary: string | null;
  accent: string | null;
  radius: number;
  fontSans: string;
  fontHeading: string | null;
  mode: BrandTokens["mode"];
}

const toDraft = (b: Branding): Draft => ({
  appName: b.appName ?? "",
  logoUrl: b.logoUrl,
  logoDarkUrl: b.logoDarkUrl,
  faviconUrl: b.faviconUrl,
  primary: b.tokens.colors.primary,
  secondary: b.tokens.colors.secondary ?? null,
  accent: b.tokens.colors.accent ?? null,
  radius: b.tokens.radius,
  fontSans: b.tokens.fontSans,
  fontHeading: b.tokens.fontHeading ?? null,
  mode: b.tokens.mode,
});

const tokensPatch = (d: Draft) => ({
  colors: { primary: d.primary, secondary: d.secondary, accent: d.accent },
  radius: d.radius,
  fontSans: d.fontSans,
  fontHeading: d.fontHeading,
  mode: d.mode,
});

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const id = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return v;
}

const PREVIEW_SCOPE = ".sr-brand-preview";

export default function BrandingPage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [initial, setInitial] = React.useState<Draft | null>(null);
  const [resetOpen, setResetOpen] = React.useState(false);
  const [previewDark, setPreviewDark] = React.useState(false);

  const branding = useQuery({ queryKey: qk.branding, queryFn: () => api.get<Branding>("/branding") });

  React.useEffect(() => {
    if (branding.data && !draft) {
      const d = toDraft(branding.data);
      setDraft(d);
      setInitial(d);
    }
  }, [branding.data, draft]);

  const patch = draft ? tokensPatch(draft) : null;
  const debouncedPatch = useDebounced(patch, 250);
  const preview = useQuery({
    queryKey: ["branding", "preview", debouncedPatch],
    // The API takes the tokens patch as the body; `tokens` is included for API versions that wrap it.
    queryFn: () => api.post<BrandingPreview>("/branding/preview", { ...debouncedPatch, tokens: debouncedPatch }),
    enabled: !!debouncedPatch,
    placeholderData: keepPreviousData,
    retry: false,
  });

  useWebFonts([draft?.fontSans, draft?.fontHeading]);

  const dirty = !!draft && !!initial && JSON.stringify(draft) !== JSON.stringify(initial);

  const save = useMutation({
    mutationFn: (d: Draft) =>
      api.put<Branding & { warnings?: string[] }>("/branding", {
        appName: d.appName.trim() || null,
        logoUrl: d.logoUrl,
        logoDarkUrl: d.logoDarkUrl,
        faviconUrl: d.faviconUrl,
        tokens: tokensPatch(d),
      }),
    onSuccess: (b) => {
      const d = toDraft(b);
      setDraft(d);
      setInitial(d);
      qc.setQueryData(qk.branding, b);
      void qc.invalidateQueries({ queryKey: ["branding"] });
      toast.success(t("admin.branding.saved"));
    },
    onError: (err) => toast.error(describeError(err, t)),
  });

  const reset = useMutation({
    mutationFn: () => api.delete<Branding>("/branding"),
    onSuccess: (b) => {
      const d = toDraft(b);
      setDraft(d);
      setInitial(d);
      void qc.invalidateQueries({ queryKey: ["branding"] });
      void qc.invalidateQueries({ queryKey: qk.branding });
      toast.success(t("admin.branding.resetDone"));
    },
    onError: (err) => toast.error(describeError(err, t)),
  });

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => (d ? { ...d, [key]: value } : d));

  if (branding.isError) {
    return (
      <Page>
        <PageHeader title={t("admin.branding.title")} />
        <QueryError error={branding.error} onRetry={() => void branding.refetch()} />
      </Page>
    );
  }

  return (
    <Page wide>
      <PageHeader
        title={t("admin.branding.title")}
        description={t("admin.branding.subtitle")}
        actions={
          <>
            <Button variant="outline" onClick={() => setResetOpen(true)} disabled={!draft || reset.isPending}>
              <RotateCcwIcon /> {t("admin.branding.reset")}
            </Button>
            <Button variant="outline" onClick={() => initial && setDraft(initial)} disabled={!dirty}>
              {t("admin.common.discard")}
            </Button>
            <Button onClick={() => draft && save.mutate(draft)} disabled={!dirty || save.isPending}>
              {save.isPending ? <Loader2Icon className="animate-spin" /> : <SaveIcon />}
              {t("admin.common.saveChanges")}
            </Button>
          </>
        }
      />

      {!draft ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)]">
          <div className="space-y-6">
            <Skeleton className="h-48" />
            <Skeleton className="h-56" />
          </div>
          <Skeleton className="h-96" />
        </div>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)]">
          <div className="space-y-6">
            <Card className="gap-5">
              <CardHeader>
                <CardTitle>{t("admin.branding.identity")}</CardTitle>
                <CardDescription>{t("admin.branding.identityHint")}</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-5">
                <div className="grid gap-2">
                  <Label htmlFor="appName">{t("admin.branding.appName")}</Label>
                  <Input id="appName" value={draft.appName} maxLength={80} onChange={(e) => set("appName", e.target.value)} />
                </div>
                <div className="grid gap-5 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label>{t("admin.branding.logo")}</Label>
                    <ImageUpload value={draft.logoUrl} onChange={(v) => set("logoUrl", v)} purpose="branding" shape="wide" />
                  </div>
                  <div className="grid gap-2">
                    <Label>{t("admin.branding.logoDark")}</Label>
                    <ImageUpload value={draft.logoDarkUrl} onChange={(v) => set("logoDarkUrl", v)} purpose="branding" shape="wide" dark />
                  </div>
                  <div className="grid gap-2">
                    <Label>{t("admin.branding.favicon")}</Label>
                    <ImageUpload value={draft.faviconUrl} onChange={(v) => set("faviconUrl", v)} purpose="branding" maxBytes={512 * 1024} />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="gap-5">
              <CardHeader>
                <CardTitle>{t("admin.branding.colors")}</CardTitle>
                <CardDescription>{t("admin.branding.colorsHint")}</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-5 sm:grid-cols-3">
                <div className="grid content-start gap-2">
                  <Label htmlFor="c-primary">{t("admin.branding.primary")}</Label>
                  <ColorInput id="c-primary" value={draft.primary} onChange={(v) => set("primary", v)} aria-label={t("admin.branding.primary")} />
                </div>
                <OptionalColor
                  id="c-secondary"
                  label={t("admin.branding.secondary")}
                  value={draft.secondary}
                  fallback="#f1f5f9"
                  onChange={(v) => set("secondary", v)}
                />
                <OptionalColor
                  id="c-accent"
                  label={t("admin.branding.accent")}
                  value={draft.accent}
                  fallback="#fef3c7"
                  onChange={(v) => set("accent", v)}
                />
              </CardContent>
            </Card>

            <Card className="gap-5">
              <CardHeader>
                <CardTitle>{t("admin.branding.shapeType")}</CardTitle>
                <CardDescription>{t("admin.branding.shapeTypeHint")}</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-6">
                <div className="grid gap-3">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="radius">{t("admin.branding.radius")}</Label>
                    <span className="font-mono text-xs text-muted-foreground tabular-nums">{draft.radius.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}rem</span>
                  </div>
                  <Slider id="radius" min={0} max={1.5} step={0.125} value={[draft.radius]} onValueChange={([v]) => set("radius", v ?? 0)} />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{t("admin.branding.square")}</span>
                    <span>{t("admin.branding.round")}</span>
                  </div>
                </div>
                <div className="grid gap-5 sm:grid-cols-3">
                  <div className="grid gap-2">
                    <Label>{t("admin.branding.fontSans")}</Label>
                    <FontSelect value={draft.fontSans} onChange={(v) => set("fontSans", v ?? "Inter")} />
                  </div>
                  <div className="grid gap-2">
                    <Label>{t("admin.branding.fontHeading")}</Label>
                    <FontSelect value={draft.fontHeading} onChange={(v) => set("fontHeading", v)} allowSame />
                  </div>
                  <div className="grid gap-2">
                    <Label>{t("admin.branding.mode")}</Label>
                    <Select value={draft.mode} onValueChange={(v) => set("mode", v as Draft["mode"])}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="light">{t("admin.theme.light")}</SelectItem>
                        <SelectItem value="dark">{t("admin.theme.dark")}</SelectItem>
                        <SelectItem value="system">{t("admin.theme.system")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-4 lg:sticky lg:top-20">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                {t("admin.branding.preview")}
                {preview.isFetching && <Loader2Icon className="size-3.5 animate-spin text-muted-foreground" />}
                {dirty && <Badge variant="warning">{t("admin.branding.unsaved")}</Badge>}
              </h2>
              <Tabs value={previewDark ? "dark" : "light"} onValueChange={(v) => setPreviewDark(v === "dark")}>
                <TabsList className="h-8">
                  <TabsTrigger value="light" aria-label={t("admin.theme.light")}>
                    <SunIcon />
                  </TabsTrigger>
                  <TabsTrigger value="dark" aria-label={t("admin.theme.dark")}>
                    <MoonIcon />
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            {preview.data?.css && <style>{scopeBrandingCss(preview.data.css, PREVIEW_SCOPE)}</style>}
            <div className={cn(previewDark ? "dark" : "light")}>
              <BrandPreview draft={draft} />
            </div>

            {preview.isError ? (
              <Alert variant="destructive">
                <TriangleAlertIcon />
                <AlertTitle>{t("admin.branding.previewFailed")}</AlertTitle>
                <AlertDescription>{describeError(preview.error, t)}</AlertDescription>
              </Alert>
            ) : preview.data && preview.data.warnings.length > 0 ? (
              <Alert variant="warning">
                <TriangleAlertIcon />
                <AlertTitle>{t("admin.branding.contrastWarnings", { count: preview.data.warnings.length })}</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc space-y-1 pl-4 text-xs">
                    {preview.data.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            ) : preview.data ? (
              <Alert variant="success">
                <CheckCircle2Icon />
                <AlertTitle>{t("admin.branding.contrastOk")}</AlertTitle>
              </Alert>
            ) : null}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={resetOpen}
        onOpenChange={setResetOpen}
        title={t("admin.branding.resetTitle")}
        description={t("admin.branding.resetDescription")}
        confirmLabel={t("admin.branding.reset")}
        onConfirm={() => reset.mutateAsync()}
      />
    </Page>
  );
}

function OptionalColor({
  id,
  label,
  value,
  fallback,
  onChange,
}: {
  id: string;
  label: string;
  value: string | null;
  fallback: string;
  onChange: (v: string | null) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="grid content-start gap-2">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {t("admin.branding.custom")}
          <Switch checked={value !== null} onCheckedChange={(on) => onChange(on ? fallback : null)} aria-label={label} />
        </label>
      </div>
      {value !== null ? (
        <ColorInput id={id} value={value} onChange={onChange} aria-label={label} />
      ) : (
        <div className="flex h-9 items-center rounded-md border border-dashed px-3 text-xs text-muted-foreground">
          {t("admin.branding.useDefault")}
        </div>
      )}
    </div>
  );
}

function FontSelect({ value, onChange, allowSame }: { value: string | null; onChange: (v: string | null) => void; allowSame?: boolean }) {
  const { t } = useI18n();
  const fonts: string[] = [...BRAND_FONTS];
  if (value && !fonts.includes(value)) fonts.unshift(value);
  return (
    <Select value={value ?? "__same"} onValueChange={(v) => onChange(v === "__same" ? null : v)}>
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {allowSame && <SelectItem value="__same">{t("admin.branding.sameAsBody")}</SelectItem>}
        {fonts.map((f) => (
          <SelectItem key={f} value={f}>
            <span style={{ fontFamily: `"${f}", sans-serif` }}>{f}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Sample UI rendered with the previewed tokens (scoped CSS variables). */
function BrandPreview({ draft }: { draft: Draft }) {
  const { t } = useI18n();
  const logo = draft.logoUrl;
  return (
    <div
      className="sr-brand-preview overflow-hidden rounded-xl border bg-background text-foreground shadow-sm"
      style={{ fontFamily: "var(--font-sans)" }}
    >
      <div className="flex items-center gap-2.5 border-b bg-card px-4 py-3">
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element -- preview of an uploaded logo
          <img src={logo} alt="" className="h-7 w-auto max-w-24 object-contain" />
        ) : (
          <div className="flex size-7 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground">
            {Array.from(draft.appName || "A")[0]?.toUpperCase()}
          </div>
        )}
        <span className="font-semibold" style={{ fontFamily: "var(--font-heading)" }}>
          {draft.appName || t("admin.branding.yourApp")}
        </span>
        <Badge variant="secondary" className="ml-auto">
          {t("admin.branding.sampleBadge")}
        </Badge>
      </div>
      <div className="space-y-4 p-4">
        <div className="space-y-1">
          <h3 className="text-lg font-semibold tracking-tight" style={{ fontFamily: "var(--font-heading)" }}>
            {t("admin.branding.sampleHeading")}
          </h3>
          <p className="text-sm text-muted-foreground">{t("admin.branding.sampleText")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm">{t("admin.branding.samplePrimary")}</Button>
          <Button size="sm" variant="secondary">
            {t("admin.branding.sampleSecondary")}
          </Button>
          <Button size="sm" variant="outline">
            {t("admin.branding.sampleOutline")}
          </Button>
          <Button size="sm" variant="link" className="px-1">
            {t("admin.branding.sampleLink")}
          </Button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge>{t("admin.status.active")}</Badge>
          <Badge variant="secondary">{t("admin.roles.admin")}</Badge>
          <Badge variant="outline">{t("admin.roles.member")}</Badge>
          <Badge variant="destructive">{t("admin.status.failed")}</Badge>
        </div>
        <Separator />
        <div className="grid gap-3">
          <Input placeholder={t("admin.branding.sampleInput")} />
          <div className="flex items-center justify-between rounded-md border p-3">
            <span className="text-sm">{t("admin.branding.sampleToggle")}</span>
            <Switch defaultChecked />
          </div>
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{t("admin.overview.storage")}</span>
              <span>64%</span>
            </div>
            <Progress value={64} />
          </div>
        </div>
        <div className="rounded-lg bg-accent p-3 text-sm text-accent-foreground">{t("admin.branding.sampleAccent")}</div>
      </div>
    </div>
  );
}
