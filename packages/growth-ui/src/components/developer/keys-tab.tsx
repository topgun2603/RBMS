"use client";

import * as React from "react";
import { BanIcon, CheckCircle2Icon, ClockAlertIcon, KeyRoundIcon, Loader2Icon, MoreHorizontalIcon, PencilIcon, PlusIcon } from "lucide-react";
import {
  AnimatePresence,
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  Field,
  FieldControl,
  FieldError,
  FieldLabel,
  Input,
  motion,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Skeleton,
  StatusPill,
  toast,
  useReducedMotionSafe,
  type StatusTone,
} from "@srirealtime/ui";
import { ConfirmDialog, describeError, QueryError, useI18n } from "@srirealtime/web";
import { maskedKey, relativeTime } from "../../lib/developer";
import { useApiKeys, useRenameKey, useRevokeKey, useScopes } from "../../lib/queries/developer";
import type { ApiKey } from "../../lib/types";
import { SecretOnceDialog, SectionCard } from "../bits";
import { CreateKeyDialog } from "./create-key-dialog";

const STATUS: Record<ApiKey["status"], { tone: StatusTone; icon: React.ComponentType<{ className?: string }> }> = {
  active: { tone: "success", icon: CheckCircle2Icon },
  revoked: { tone: "danger", icon: BanIcon },
  expired: { tone: "neutral", icon: ClockAlertIcon },
};

export function KeyStatusPill({ status }: { status: ApiKey["status"] }) {
  const { t } = useI18n();
  const s = STATUS[status];
  return (
    <StatusPill tone={s.tone} icon={s.icon}>
      {t(`growth.developer.keys.status.${status}`)}
    </StatusPill>
  );
}

export function KeysTab() {
  const { t } = useI18n();
  const keys = useApiKeys();
  const [creating, setCreating] = React.useState(false);
  const [secret, setSecret] = React.useState<{ token: string; name: string } | null>(null);
  const [revoking, setRevoking] = React.useState<ApiKey | null>(null);
  const [renaming, setRenaming] = React.useState<ApiKey | null>(null);
  const revoke = useRevokeKey();
  const items = keys.data?.items ?? [];

  return (
    <SectionCard
      icon={KeyRoundIcon}
      title={t("growth.developer.keys.title")}
      description={t("growth.developer.keys.subtitle")}
      action={
        <Button size="sm" onClick={() => setCreating(true)}>
          <PlusIcon /> <span className="hidden sm:inline">{t("growth.developer.keys.create")}</span>
          <span className="sm:hidden">{t("growth.common.add")}</span>
        </Button>
      }
    >
      {keys.isError ? (
        <QueryError error={keys.error} onRetry={() => void keys.refetch()} />
      ) : keys.isPending ? (
        <div className="grid gap-2" aria-busy="true">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={KeyRoundIcon}
          title={t("growth.developer.keys.emptyTitle")}
          description={t("growth.developer.keys.emptyBody")}
          action={
            <Button onClick={() => setCreating(true)}>
              <PlusIcon /> {t("growth.developer.keys.create")}
            </Button>
          }
        />
      ) : (
        <KeyList items={items} onRevoke={setRevoking} onRename={setRenaming} />
      )}

      <CreateKeyDialog open={creating} onOpenChange={setCreating} onCreated={(token, name) => setSecret({ token, name })} />
      <SecretOnceDialog
        open={!!secret}
        onOpenChange={(o) => !o && setSecret(null)}
        title={t("growth.developer.keys.secretTitle")}
        description={secret ? t("growth.developer.keys.secretBody", { name: secret.name }) : undefined}
        secret={secret?.token ?? null}
        warning={t("growth.developer.keys.secretWarning")}
        doneLabel={t("growth.developer.secretDone")}
      />
      <ConfirmDialog
        open={!!revoking}
        onOpenChange={(o) => !o && setRevoking(null)}
        title={t("growth.developer.keys.revokeTitle", { name: revoking?.name ?? "" })}
        description={t("growth.developer.keys.revokeBody")}
        confirmLabel={t("growth.developer.keys.revoke")}
        destructive
        onConfirm={async () => {
          if (!revoking) return;
          try {
            await revoke.mutateAsync(revoking.id);
            toast.success(t("growth.developer.keys.revoked"));
          } catch (err) {
            toast.error(describeError(err, t));
            throw err;
          }
        }}
      />
      <RenameKeyDialog apiKey={renaming} onClose={() => setRenaming(null)} />
    </SectionCard>
  );
}

function KeyList({ items, onRevoke, onRename }: { items: ApiKey[]; onRevoke: (k: ApiKey) => void; onRename: (k: ApiKey) => void }) {
  const { t, formatDate, locale } = useI18n();
  const reduced = useReducedMotionSafe();
  const scopes = useScopes();
  const scopeLabel = React.useMemo(() => new Map((scopes.data?.items ?? []).map((s) => [s.key, s.label])), [scopes.data]);

  return (
    <ul className="grid gap-2">
      <li className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto_2.5rem] gap-3 px-3 text-xs font-medium text-muted-foreground lg:grid">
        <span>{t("growth.common.name")}</span>
        <span>{t("growth.developer.keys.scopes")}</span>
        <span>{t("growth.developer.keys.lastUsed")}</span>
        <span>{t("growth.developer.keys.expires")}</span>
        <span>{t("growth.common.status")}</span>
        <span className="sr-only">{t("growth.common.actions")}</span>
      </li>
      <AnimatePresence initial={false}>
        {items.map((k, i) => (
          <motion.li
            key={k.id}
            layout={!reduced}
            initial={reduced ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0, transition: { delay: reduced ? 0 : Math.min(i, 8) * 0.03 } }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
            className={cn(
              "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 rounded-xl border bg-card px-3 py-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto_2.5rem]",
              k.status !== "active" && "bg-muted/30",
            )}
          >
            <div className="min-w-0">
              <p className={cn("truncate text-sm font-medium", k.status !== "active" && "text-muted-foreground")}>{k.name}</p>
              <p className="truncate font-mono text-xs text-muted-foreground">{maskedKey(k.prefix)}</p>
            </div>
            <div className="col-start-2 row-start-1 flex items-center gap-1 lg:hidden">
              <KeyStatusPill status={k.status} />
              <KeyMenu apiKey={k} onRevoke={onRevoke} onRename={onRename} />
            </div>
            <div className="col-span-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground lg:contents">
              <div className="lg:text-sm">
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="rounded-md underline decoration-dotted underline-offset-4 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {t("growth.developer.keys.scopeCount", { count: k.scopes.length })}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-80 p-0">
                    <p className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">{t("growth.developer.keys.scopesOf", { name: k.name })}</p>
                    <ul className="grid max-h-64 gap-1 overflow-y-auto p-2">
                      {k.scopes.map((s) => (
                        <li key={s} className="grid rounded-md px-2 py-1 text-sm">
                          <span>{scopeLabel.get(s) ?? s}</span>
                          <code className="font-mono text-[11px] text-muted-foreground">{s}</code>
                        </li>
                      ))}
                    </ul>
                  </PopoverContent>
                </Popover>
              </div>
              <div className="lg:text-sm">
                <span className="lg:hidden">{t("growth.developer.keys.lastUsed")}: </span>
                {k.lastUsedAt ? (
                  <time dateTime={k.lastUsedAt} title={formatDate(k.lastUsedAt, { dateStyle: "medium", timeStyle: "short" })}>
                    {relativeTime(k.lastUsedAt, locale)}
                  </time>
                ) : (
                  t("growth.common.never")
                )}
              </div>
              <div className="lg:text-sm">
                <span className="lg:hidden">{t("growth.developer.keys.expires")}: </span>
                {k.revokedAt ? (
                  <span>{t("growth.developer.keys.revokedOn", { date: formatDate(k.revokedAt, { day: "numeric", month: "short", year: "numeric" }) })}</span>
                ) : k.expiresAt ? (
                  <time dateTime={k.expiresAt}>{formatDate(k.expiresAt, { day: "numeric", month: "short", year: "numeric" })}</time>
                ) : (
                  t("growth.common.never")
                )}
              </div>
              <div className="hidden lg:block">
                <KeyStatusPill status={k.status} />
              </div>
              <div className="hidden lg:block">
                <KeyMenu apiKey={k} onRevoke={onRevoke} onRename={onRename} />
              </div>
            </div>
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}

function KeyMenu({ apiKey, onRevoke, onRename }: { apiKey: ApiKey; onRevoke: (k: ApiKey) => void; onRename: (k: ApiKey) => void }) {
  const { t } = useI18n();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={t("growth.developer.keys.actionsFor", { name: apiKey.name })}>
          <MoreHorizontalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => onRename(apiKey)}>
          <PencilIcon /> {t("growth.developer.keys.rename")}
        </DropdownMenuItem>
        {apiKey.status !== "revoked" && (
          <DropdownMenuItem variant="destructive" onSelect={() => onRevoke(apiKey)}>
            <BanIcon /> {t("growth.developer.keys.revoke")}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function RenameKeyDialog({ apiKey, onClose }: { apiKey: ApiKey | null; onClose: () => void }) {
  const { t } = useI18n();
  const rename = useRenameKey();
  const [name, setName] = React.useState("");
  React.useEffect(() => {
    if (apiKey) {
      setName(apiKey.name);
      rename.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey?.id]);
  const empty = !name.trim();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiKey || empty) return;
    try {
      await rename.mutateAsync({ id: apiKey.id, name: name.trim() });
      toast.success(t("growth.common.saved"));
      onClose();
    } catch {
      // inline
    }
  };

  return (
    <Dialog open={!!apiKey} onOpenChange={(o) => !o && !rename.isPending && onClose()}>
      <DialogContent closeLabel={t("growth.common.close")} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("growth.developer.keys.renameTitle")}</DialogTitle>
        </DialogHeader>
        <form id="rename-api-key" onSubmit={submit} className="grid gap-4" noValidate>
          <Field invalid={rename.isError}>
            <FieldLabel>{t("growth.developer.keys.name")}</FieldLabel>
            <FieldControl>
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus autoComplete="off" />
            </FieldControl>
            <FieldError>{rename.isError ? describeError(rename.error, t) : null}</FieldError>
          </Field>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={rename.isPending}>
            {t("growth.common.cancel")}
          </Button>
          <Button type="submit" form="rename-api-key" disabled={rename.isPending || empty}>
            {rename.isPending && <Loader2Icon className="animate-spin" />}
            {t("growth.common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
