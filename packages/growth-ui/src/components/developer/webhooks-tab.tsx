"use client";

import * as React from "react";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  HistoryIcon,
  Loader2Icon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  SendIcon,
  Trash2Icon,
  WebhookIcon,
  XCircleIcon,
} from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  AnimatePresence,
  Badge,
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  motion,
  Skeleton,
  Switch,
  toast,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useReducedMotionSafe,
} from "@rbms/ui";
import { ConfirmDialog, describeError, QueryError, useI18n } from "@rbms/web";
import { AUTO_DISABLE_AFTER, isAllEvents, relativeTime, shortUrl } from "../../lib/developer";
import { useDeleteEndpoint, useEndpoints, useEvents, useRotateSecret, useTestEndpoint, useUpdateEndpoint } from "../../lib/queries/developer";
import type { WebhookEndpoint } from "../../lib/types";
import { SecretOnceDialog, SectionCard } from "../bits";
import { EndpointSheet } from "./endpoint-dialog";

const MAX_CHIPS = 4;

export function WebhooksTab({ onShowDeliveries }: { onShowDeliveries: (endpointId: string) => void }) {
  const { t } = useI18n();
  const endpoints = useEndpoints();
  const rotate = useRotateSecret();
  const remove = useDeleteEndpoint();
  const [editing, setEditing] = React.useState<{ endpoint: WebhookEndpoint | null } | null>(null);
  const [secret, setSecret] = React.useState<{ secret: string; url: string; rotated: boolean } | null>(null);
  const [rotating, setRotating] = React.useState<WebhookEndpoint | null>(null);
  const [deleting, setDeleting] = React.useState<WebhookEndpoint | null>(null);
  const items = endpoints.data?.items ?? [];

  return (
    <SectionCard
      icon={WebhookIcon}
      title={t("growth.developer.endpoints.title")}
      description={t("growth.developer.endpoints.subtitle")}
      action={
        <Button size="sm" onClick={() => setEditing({ endpoint: null })}>
          <PlusIcon /> <span className="hidden sm:inline">{t("growth.developer.endpoints.add")}</span>
          <span className="sm:hidden">{t("growth.common.add")}</span>
        </Button>
      }
    >
      {endpoints.isError ? (
        <QueryError error={endpoints.error} onRetry={() => void endpoints.refetch()} />
      ) : endpoints.isPending ? (
        <div className="grid gap-3" aria-busy="true">
          {Array.from({ length: 2 }, (_, i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={WebhookIcon}
          title={t("growth.developer.endpoints.emptyTitle")}
          description={t("growth.developer.endpoints.emptyBody")}
          action={
            <Button onClick={() => setEditing({ endpoint: null })}>
              <PlusIcon /> {t("growth.developer.endpoints.add")}
            </Button>
          }
        />
      ) : (
        <EndpointList
          items={items}
          onEdit={(e) => setEditing({ endpoint: e })}
          onRotate={setRotating}
          onDelete={setDeleting}
          onShowDeliveries={onShowDeliveries}
        />
      )}

      <EndpointSheet
        open={!!editing}
        endpoint={editing?.endpoint ?? null}
        onOpenChange={(o) => !o && setEditing(null)}
        onCreated={(s, ep) => setSecret({ secret: s, url: ep.url, rotated: false })}
      />
      <SecretOnceDialog
        open={!!secret}
        onOpenChange={(o) => !o && setSecret(null)}
        title={secret?.rotated ? t("growth.developer.endpoints.rotatedTitle") : t("growth.developer.endpoints.secretTitle")}
        description={secret ? t("growth.developer.endpoints.secretBody", { url: shortUrl(secret.url) }) : undefined}
        secret={secret?.secret ?? null}
        warning={t("growth.developer.endpoints.secretWarning")}
        doneLabel={t("growth.developer.secretDone")}
      />
      <ConfirmDialog
        open={!!rotating}
        onOpenChange={(o) => !o && setRotating(null)}
        title={t("growth.developer.endpoints.rotateTitle")}
        description={t("growth.developer.endpoints.rotateBody", { url: rotating ? shortUrl(rotating.url) : "" })}
        confirmLabel={t("growth.developer.endpoints.rotate")}
        destructive
        onConfirm={async () => {
          if (!rotating) return;
          try {
            const res = await rotate.mutateAsync(rotating.id);
            setSecret({ secret: res.secret, url: res.endpoint.url, rotated: true });
          } catch (err) {
            toast.error(describeError(err, t));
            throw err;
          }
        }}
      />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t("growth.developer.endpoints.deleteTitle")}
        description={t("growth.developer.endpoints.deleteBody", { url: deleting ? shortUrl(deleting.url) : "" })}
        confirmLabel={t("growth.common.delete")}
        destructive
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await remove.mutateAsync(deleting.id);
            toast.success(t("growth.developer.endpoints.deleted"));
          } catch (err) {
            toast.error(describeError(err, t));
            throw err;
          }
        }}
      />
    </SectionCard>
  );
}

function EndpointList({
  items,
  onEdit,
  onRotate,
  onDelete,
  onShowDeliveries,
}: {
  items: WebhookEndpoint[];
  onEdit: (e: WebhookEndpoint) => void;
  onRotate: (e: WebhookEndpoint) => void;
  onDelete: (e: WebhookEndpoint) => void;
  onShowDeliveries: (id: string) => void;
}) {
  const reduced = useReducedMotionSafe();
  return (
    <ul className="grid gap-3">
      <AnimatePresence initial={false}>
        {items.map((ep, i) => (
          <motion.li
            key={ep.id}
            layout={!reduced}
            initial={reduced ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0, transition: { delay: reduced ? 0 : Math.min(i, 6) * 0.04 } }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
          >
            <EndpointCard endpoint={ep} onEdit={onEdit} onRotate={onRotate} onDelete={onDelete} onShowDeliveries={onShowDeliveries} />
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}

function EndpointCard({
  endpoint: ep,
  onEdit,
  onRotate,
  onDelete,
  onShowDeliveries,
}: {
  endpoint: WebhookEndpoint;
  onEdit: (e: WebhookEndpoint) => void;
  onRotate: (e: WebhookEndpoint) => void;
  onDelete: (e: WebhookEndpoint) => void;
  onShowDeliveries: (id: string) => void;
}) {
  const { t, formatDate, locale } = useI18n();
  const events = useEvents();
  const update = useUpdateEndpoint();
  const test = useTestEndpoint();
  const labels = React.useMemo(() => new Map((events.data?.items ?? []).map((e) => [e.type, e.label])), [events.data]);
  const all = isAllEvents(ep.events);
  const failing = ep.active && ep.consecutiveFailures > 0;
  const switchId = `endpoint-active-${ep.id}`;

  const toggle = async (active: boolean) => {
    try {
      await update.mutateAsync({ id: ep.id, active });
      toast.success(active ? t("growth.developer.endpoints.turnedOn") : t("growth.developer.endpoints.turnedOff"));
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  const sendTest = async () => {
    try {
      const d = await test.mutateAsync(ep.id);
      if (!d) toast.error(t("growth.developer.endpoints.testNoResult"));
      else if (d.status === "succeeded") toast.success(t("growth.developer.endpoints.testOk", { status: d.responseStatus ?? "—", ms: d.durationMs ?? 0 }));
      else
        toast.error(t("growth.developer.endpoints.testFailed", { status: d.responseStatus ?? "—" }), {
          description: d.error ?? undefined,
          action: { label: t("growth.developer.endpoints.viewLog"), onClick: () => onShowDeliveries(ep.id) },
        });
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  const when = (iso: string) => (
    <time dateTime={iso} title={formatDate(iso, { dateStyle: "medium", timeStyle: "short" })}>
      {relativeTime(iso, locale)}
    </time>
  );

  return (
    <article className={cn("grid gap-3 rounded-xl border bg-card p-3 sm:p-4", !ep.active && "bg-muted/30")}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-sm font-medium" title={ep.url}>
            {ep.url}
          </p>
          {ep.description && <p className="mt-0.5 line-clamp-2 text-meta text-muted-foreground">{ep.description}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <label htmlFor={switchId} className="sr-only">
            {t("growth.developer.endpoints.activeLabel")}
          </label>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <Switch id={switchId} checked={ep.active} disabled={update.isPending} onCheckedChange={(v) => void toggle(v)} />
              </span>
            </TooltipTrigger>
            <TooltipContent>{ep.active ? t("growth.common.active") : t("growth.common.inactive")}</TooltipContent>
          </Tooltip>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={t("growth.developer.endpoints.actionsFor", { url: shortUrl(ep.url) })}>
                <MoreHorizontalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => onEdit(ep)}>
                <PencilIcon /> {t("growth.common.edit")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onShowDeliveries(ep.id)}>
                <HistoryIcon /> {t("growth.developer.endpoints.viewLog")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onRotate(ep)}>
                <RefreshCwIcon /> {t("growth.developer.endpoints.rotate")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => onDelete(ep)}>
                <Trash2Icon /> {t("growth.common.delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5" aria-label={t("growth.developer.endpoints.events")}>
        {all ? (
          <Badge variant="secondary">{t("growth.developer.events.allShort")}</Badge>
        ) : (
          <>
            {ep.events.slice(0, MAX_CHIPS).map((e) => (
              <Badge key={e} variant="outline" className="font-mono text-xs font-normal" title={labels.get(e)}>
                {e}
              </Badge>
            ))}
            {ep.events.length > MAX_CHIPS && (
              <Badge variant="muted" title={ep.events.slice(MAX_CHIPS).join(", ")}>
                {t("growth.developer.endpoints.moreEvents", { count: ep.events.length - MAX_CHIPS })}
              </Badge>
            )}
          </>
        )}
      </div>

      {!ep.active && ep.disabledReason && (
        <Alert className="border-warning/40 bg-warning/10 text-warning-ink">
          <AlertTriangleIcon />
          <AlertTitle className="text-sm">{t("growth.developer.endpoints.disabled")}</AlertTitle>
          <AlertDescription className="text-xs text-warning-ink/90">
            {ep.disabledReason}
            {ep.disabledAt && ` · ${formatDate(ep.disabledAt, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}`}
          </AlertDescription>
        </Alert>
      )}
      {failing && (
        <p className="flex items-start gap-1.5 text-xs text-warning-ink">
          <AlertTriangleIcon className="mt-px size-3.5 shrink-0" />
          {t("growth.developer.endpoints.failingWarning", { count: ep.consecutiveFailures, max: AUTO_DISABLE_AFTER })}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <CheckCircle2Icon className="size-3.5 text-success" />
            {t("growth.developer.endpoints.lastSuccess")}: {ep.lastSuccessAt ? when(ep.lastSuccessAt) : t("growth.common.never")}
          </span>
          <span className="inline-flex items-center gap-1">
            <XCircleIcon className="size-3.5 text-destructive" />
            {t("growth.developer.endpoints.lastFailure")}: {ep.lastFailureAt ? when(ep.lastFailureAt) : t("growth.common.never")}
          </span>
        </div>
        <Button variant="outline" size="sm" onClick={() => void sendTest()} disabled={test.isPending}>
          {test.isPending ? <Loader2Icon className="animate-spin" /> : <SendIcon />}
          {t("growth.developer.endpoints.sendTest")}
        </Button>
      </div>
    </article>
  );
}
