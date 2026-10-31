"use client";

import * as React from "react";
import { KeyRoundIcon, Loader2Icon, LockIcon, MailIcon, MessageCircleIcon, ShieldCheckIcon, SmartphoneIcon, UsersIcon, StoreIcon } from "lucide-react";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, cn, Skeleton, Switch, toast } from "@rbms/ui";
import { Page, PageHeading } from "../components/page";
import { QueryError } from "../components/query-state";
import { SettingsNav } from "../components/settings-nav";
import type { SignInAudience, SignInMethod } from "../lib/firebase-phone";
import { describeError, useI18n } from "../lib/i18n";
import {
  isLastUsable,
  makeFirst,
  sameOptions,
  SIGN_IN_METHODS,
  toggleMethod,
  useSaveSignInSettings,
  useSignInSettings,
  type AudienceOptions,
} from "../lib/sign-in-settings";
import { useSession } from "./session";

const ICONS: Record<SignInMethod, React.ComponentType<{ className?: string }>> = {
  sms: SmartphoneIcon,
  whatsapp: MessageCircleIcon,
  email_code: MailIcon,
  google: ShieldCheckIcon,
  password: KeyRoundIcon,
};

type Draft = Record<SignInAudience, AudienceOptions>;

/** Settings → Sign-in options: which methods the shop's team and its customers may use, and which comes first. */
export default function SignInSettingsPage() {
  const { t } = useI18n();
  const { canManage } = useSession();
  const settings = useSignInSettings(canManage);
  const save = useSaveSignInSettings();
  const [draft, setDraft] = React.useState<Draft | null>(null);

  // (Re)start from what the server has whenever it changes.
  React.useEffect(() => {
    if (settings.data) setDraft(settings.data.options);
  }, [settings.data]);

  const saved = settings.data?.options;
  const dirty = !!draft && !!saved && (!sameOptions(draft.staff, saved.staff) || !sameOptions(draft.customer, saved.customer));

  const onSave = () => {
    if (!draft || !saved) return;
    const patch: Partial<Draft> = {};
    if (!sameOptions(draft.staff, saved.staff)) patch.staff = draft.staff;
    if (!sameOptions(draft.customer, saved.customer)) patch.customer = draft.customer;
    save.mutate(patch, {
      onSuccess: () => toast.success(t("web.signin.saved")),
      onError: (err) => toast.error(describeError(err, t)),
    });
  };

  return (
    <Page width="narrow">
      <SettingsNav />
      <PageHeading icon={KeyRoundIcon} title={t("web.signin.title")} description={t("web.signin.description")} />
      {!canManage && (
        <p className="mb-4 flex items-center gap-2 rounded-xl border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">
          <LockIcon className="size-4 shrink-0" /> {t("web.signin.readOnly")}
        </p>
      )}
      {canManage && settings.error && !settings.data ? (
        <QueryError error={settings.error} onRetry={() => void settings.refetch()} />
      ) : canManage && (!settings.data || !draft) ? (
        <div className="grid gap-4">
          <Skeleton className="h-72 rounded-2xl" />
          <Skeleton className="h-72 rounded-2xl" />
        </div>
      ) : canManage && settings.data && draft ? (
        <div className="grid gap-4">
          <p className="rounded-xl border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">
            {t("web.signin.note.lockout")} {t("web.signin.note.admin")}
          </p>
          {(["staff", "customer"] as const).map((audience) => (
            <AudienceCard
              key={audience}
              audience={audience}
              value={draft[audience]}
              platform={settings.data.platform}
              disabled={save.isPending}
              onChange={(next) => setDraft({ ...draft, [audience]: next })}
            />
          ))}
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={onSave} disabled={!dirty || save.isPending}>
              {save.isPending && <Loader2Icon className="animate-spin" />}
              {save.isPending ? t("web.signin.saving") : t("web.signin.save")}
            </Button>
            <Button variant="ghost" disabled={save.isPending} onClick={() => setDraft(settings.data!.defaults)}>
              {t("web.signin.reset")}
            </Button>
            {dirty && <span className="text-sm text-muted-foreground">{t("web.signin.unsaved")}</span>}
          </div>
        </div>
      ) : null}
    </Page>
  );
}

function AudienceCard({
  audience,
  value,
  platform,
  disabled,
  onChange,
}: {
  audience: SignInAudience;
  value: AudienceOptions;
  platform: Record<SignInMethod, boolean>;
  disabled: boolean;
  onChange: (next: AudienceOptions) => void;
}) {
  const { t } = useI18n();
  const Icon = audience === "staff" ? UsersIcon : StoreIcon;
  // Shown in the order people will see them: enabled first (preferred on top), then the ones that are off.
  const ordered = [...value.methods, ...SIGN_IN_METHODS.filter((m) => !value.methods.includes(m))];
  return (
    <Card className="gap-1" data-testid={`signin-${audience}`}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="size-4 text-muted-foreground" /> {t(`web.signin.${audience}.title`)}
        </CardTitle>
        <CardDescription>{t(`web.signin.${audience}.hint`)}</CardDescription>
      </CardHeader>
      <CardContent className="divide-y">
        {ordered.map((m) => {
          const on = value.methods.includes(m);
          const available = platform[m];
          const last = on && isLastUsable(value, m, platform);
          const MethodIcon = ICONS[m];
          const id = `signin-${audience}-${m}`;
          return (
            <div key={m} className={cn("flex items-start gap-3 py-3.5", !available && !on && "opacity-70")}>
              <MethodIcon className="mt-1 size-5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1 space-y-1">
                <label htmlFor={id} className="flex flex-wrap items-center gap-2 font-medium">
                  {t(`web.signin.method.${m}`)}
                  {on && value.default === m && <Badge variant="secondary">{t("web.signin.firstTag")}</Badge>}
                </label>
                <p className="text-sm text-muted-foreground">{t(`web.signin.method.${m}.hint`)}</p>
                {!available && <p className="text-xs text-warning-ink">{t("web.signin.unavailable")}</p>}
                {last && <p className="text-xs text-muted-foreground">{t("web.signin.lastOne")}</p>}
                {on && value.default !== m && available && (
                  <Button type="button" variant="link" size="sm" className="h-auto p-0" disabled={disabled} onClick={() => onChange(makeFirst(value, m))}>
                    {t("web.signin.makeFirst")}
                  </Button>
                )}
              </div>
              <Switch
                id={id}
                checked={on}
                disabled={disabled || last}
                onCheckedChange={(next) => {
                  const updated = toggleMethod(value, m, next);
                  if (updated) onChange(updated);
                }}
                aria-label={t(`web.signin.method.${m}`)}
              />
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
