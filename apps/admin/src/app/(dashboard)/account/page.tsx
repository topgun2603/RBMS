"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LaptopIcon, Loader2Icon, LogOutIcon, MonitorSmartphoneIcon, SaveIcon, SmartphoneIcon } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Field,
  FieldControl,
  FieldLabel,
  FieldRow,
  Input,
  Label,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Stagger,
  StaggerItem,
  toast,
} from "@rbms/ui";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ImageUpload } from "@/components/image-upload";
import { Page } from "@/components/page";
import { QueryError } from "@/components/query-state";
import { api } from "@/lib/api";
import { meQueryKey, useMe, useSignOut } from "@/lib/auth";
import { describeUserAgent } from "@/lib/format";
import { describeError, LOCALE_NAMES, SUPPORTED_LOCALES, useI18n, type Locale } from "@/lib/i18n";
import { qk } from "@/lib/queries";
import type { Session, User } from "@/lib/types";

export default function AccountPage() {
  const { t } = useI18n();
  const me = useMe();
  return (
    <Page className="max-w-4xl">
      <PageHeader title={t("admin.account.title")} description={t("admin.account.subtitle")} />
      <div className="grid gap-6">
        {me.isError ? (
          <QueryError error={me.error} onRetry={() => void me.refetch()} />
        ) : me.data ? (
          <ProfileCard key={me.data.user.id} user={me.data.user} />
        ) : (
          <Skeleton className="h-72" />
        )}
        <SessionsCard />
      </div>
    </Page>
  );
}

function ProfileCard({ user }: { user: User }) {
  const { t, locale: uiLocale, setLocale } = useI18n();
  const qc = useQueryClient();
  const [name, setName] = React.useState(user.name ?? "");
  const [avatarUrl, setAvatarUrl] = React.useState<string | null>(user.avatarUrl);
  const [locale, setLocaleDraft] = React.useState<Locale>((user.locale as Locale) ?? uiLocale);
  const dirty = name !== (user.name ?? "") || avatarUrl !== user.avatarUrl || locale !== user.locale;

  const save = useMutation({
    mutationFn: () => api.patch<{ user: User }>("/auth/me", { name: name.trim() || null, avatarUrl, locale }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: meQueryKey });
      if (locale !== uiLocale) setLocale(locale);
      toast.success(t("admin.account.saved"));
    },
    onError: (err) => toast.error(describeError(err, t)),
  });

  return (
    <Card className="gap-5">
      <CardHeader>
        <CardTitle>{t("admin.account.profile")}</CardTitle>
        <CardDescription>{t("admin.account.profileHint")}</CardDescription>
        <CardAction>
          <Button size="sm" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? <Loader2Icon className="animate-spin" /> : <SaveIcon />}
            {t("admin.common.save")}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-5">
        <div className="grid gap-2">
          <Label>{t("admin.account.avatar")}</Label>
          <ImageUpload value={avatarUrl} onChange={setAvatarUrl} purpose="avatar" shape="circle" accept="image/png,image/jpeg,image/webp" />
        </div>
        <FieldRow className="gap-5">
          <Field id="acc-name">
            <FieldLabel>{t("admin.account.name")}</FieldLabel>
            <FieldControl>
              <Input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
            </FieldControl>
          </Field>
          <Field id="acc-language">
            <FieldLabel>{t("admin.account.language")}</FieldLabel>
            <Select value={locale} onValueChange={(v) => setLocaleDraft(v as Locale)}>
              <FieldControl>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
              </FieldControl>
              <SelectContent>
                {SUPPORTED_LOCALES.map((l) => (
                  <SelectItem key={l} value={l} lang={l}>
                    {LOCALE_NAMES[l]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field id="acc-phone">
            <FieldLabel>{t("admin.account.phone")}</FieldLabel>
            <FieldControl>
              <Input value={user.phone ?? "—"} readOnly disabled className="font-mono" />
            </FieldControl>
          </Field>
          <Field id="acc-email">
            <FieldLabel>{t("admin.account.email")}</FieldLabel>
            <FieldControl>
              <Input value={user.email ?? "—"} readOnly disabled />
            </FieldControl>
          </Field>
        </FieldRow>
      </CardContent>
    </Card>
  );
}

function SessionsCard() {
  const { t, formatRelative, formatDateTime } = useI18n();
  const qc = useQueryClient();
  const signOut = useSignOut();
  const [revoking, setRevoking] = React.useState<Session | null>(null);
  const [revokeAll, setRevokeAll] = React.useState(false);

  const sessions = useQuery({
    queryKey: qk.sessions,
    queryFn: () => api.get<{ items: Session[] }>("/auth/sessions").then((r) => r.items),
  });

  const revoke = useMutation({
    mutationFn: (s: Session) => api.delete(`/auth/sessions/${s.id}`),
    onSuccess: (_d, s) => {
      if (s.current) {
        void signOut();
        return;
      }
      toast.success(t("admin.account.sessionRevoked"));
      void qc.invalidateQueries({ queryKey: qk.sessions });
    },
    onError: (err) => toast.error(describeError(err, t)),
  });

  const revokeOthers = useMutation({
    mutationFn: () => api.post<{ revoked: number }>("/auth/sessions/revoke-others"),
    onSuccess: (r) => {
      toast.success(t("admin.account.othersRevoked", { count: r.revoked ?? 0 }));
      void qc.invalidateQueries({ queryKey: qk.sessions });
    },
    onError: (err) => toast.error(describeError(err, t)),
  });

  const others = sessions.data?.filter((s) => !s.current).length ?? 0;

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle>{t("admin.account.sessions")}</CardTitle>
        <CardDescription>{t("admin.account.sessionsHint")}</CardDescription>
        <CardAction>
          <Button size="sm" variant="outline" disabled={others === 0} onClick={() => setRevokeAll(true)}>
            <LogOutIcon /> {t("admin.account.revokeOthers")}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {sessions.isError ? (
          <QueryError compact error={sessions.error} onRetry={() => void sessions.refetch()} />
        ) : sessions.isLoading ? (
          <div className="space-y-2">
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        ) : !sessions.data?.length ? (
          <EmptyState compact icon={MonitorSmartphoneIcon} title={t("admin.account.noSessions")} />
        ) : (
          <Stagger className="divide-y rounded-lg border">
            {sessions.data.map((s) => {
              const ua = describeUserAgent(s.userAgent);
              const Icon = ua.mobile ? SmartphoneIcon : LaptopIcon;
              return (
                <StaggerItem key={s.id} className="flex items-center gap-3 px-3 py-3">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
                    <Icon className="size-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      {ua.browser}
                      {ua.os && <span className="font-normal text-muted-foreground">· {ua.os}</span>}
                      {s.current && <Badge variant="success">{t("admin.account.thisDevice")}</Badge>}
                    </div>
                    <div className="truncate text-xs text-muted-foreground" title={s.userAgent ?? undefined}>
                      {s.ip ?? "—"} · {t("admin.account.lastActive", { when: formatRelative(s.lastSeenAt) })} ·{" "}
                      {t("admin.account.signedIn", { when: formatDateTime(s.createdAt) })}
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setRevoking(s)}>
                    {s.current ? t("admin.user.signOut") : t("admin.account.revoke")}
                  </Button>
                </StaggerItem>
              );
            })}
          </Stagger>
        )}
      </CardContent>

      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(o) => !o && setRevoking(null)}
        title={revoking?.current ? t("admin.account.signOutTitle") : t("admin.account.revokeTitle")}
        description={revoking?.current ? t("admin.account.signOutDescription") : t("admin.account.revokeDescription")}
        confirmLabel={revoking?.current ? t("admin.user.signOut") : t("admin.account.revoke")}
        onConfirm={() => (revoking ? revoke.mutateAsync(revoking) : undefined)}
      />
      <ConfirmDialog
        open={revokeAll}
        onOpenChange={setRevokeAll}
        title={t("admin.account.revokeOthers")}
        description={t("admin.account.revokeOthersDescription", { count: others })}
        confirmLabel={t("admin.account.revokeOthers")}
        onConfirm={() => revokeOthers.mutateAsync()}
      />
    </Card>
  );
}
