"use client";

import * as React from "react";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { useWatch, type UseFormReturn } from "react-hook-form";
import { z } from "zod";
import { BellIcon, EyeIcon, FileTextIcon, Loader2Icon, RefreshCwIcon, SendIcon } from "lucide-react";
import {
  Badge,
  Button,
  DataTable,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  Label,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  type DataTableColumn,
} from "@rbms/ui";
import { StatusBadge } from "@/components/badges";
import { ResourcePage, type ResourceConfig } from "@/components/crud/resource-page";
import { Page } from "@/components/page";
import { QueryError } from "@/components/query-state";
import { channelIcon } from "@/components/usage";
import { api } from "@/lib/api";
import { describeError, LOCALE_NAMES, tOr, useI18n } from "@/lib/i18n";
import { qk } from "@/lib/queries";
import type { Channel, NotifyLogEntry, NotifyPreview, NotifyTemplate } from "@/lib/types";

const CHANNELS: Channel[] = ["sms", "email", "whatsapp", "push"];
const LOG_PAGE = 25;

const templateSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1, "admin.validation.required")
    .max(100, "admin.validation.tooLong")
    .regex(/^[a-z0-9_.-]+$/i, "admin.notifications.keyInvalid"),
  channel: z.enum(["sms", "email", "whatsapp", "push"]),
  locale: z.enum(["en", "ta"]),
  subject: z.string().max(500, "admin.validation.tooLong"),
  body: z.string().min(1, "admin.validation.required").max(20_000, "admin.validation.tooLong"),
});
type TemplateValues = z.infer<typeof templateSchema>;

function ChannelLabel({ channel }: { channel: Channel }) {
  const { t } = useI18n();
  const Icon = channelIcon[channel] ?? BellIcon;
  return (
    <span className="flex items-center gap-2">
      <Icon className="size-4 text-muted-foreground" />
      {tOr(t, `admin.channels.${channel}`, channel)}
    </span>
  );
}

export default function NotificationsPage() {
  const { t } = useI18n();
  const [testOpen, setTestOpen] = React.useState(false);
  const [tab, setTab] = React.useState("templates");

  return (
    <Page>
      <PageHeader
        title={t("admin.notifications.title")}
        description={t("admin.notifications.subtitle")}
        actions={
          <Button variant="outline" onClick={() => setTestOpen(true)}>
            <SendIcon /> {t("admin.notifications.sendTest")}
          </Button>
        }
      />
      <Tabs value={tab} onValueChange={setTab} className="gap-4">
        <TabsList>
          <TabsTrigger value="templates">
            <FileTextIcon /> {t("admin.notifications.templates")}
          </TabsTrigger>
          <TabsTrigger value="log">
            <BellIcon /> {t("admin.notifications.log")}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="templates">
          <TemplatesTab />
        </TabsContent>
        <TabsContent value="log">
          <DeliveryLog />
        </TabsContent>
      </Tabs>
      <SendTestDialog open={testOpen} onOpenChange={setTestOpen} />
    </Page>
  );
}

function TemplatesTab() {
  const { t, formatRelative } = useI18n();
  const [locale, setLocale] = React.useState<"all" | "en" | "ta">("all");

  const config: ResourceConfig<NotifyTemplate, TemplateValues> = {
    title: t("admin.notifications.templates"),
    embedded: true,
    icon: FileTextIcon,
    queryKey: qk.templates,
    list: { path: "/notify/templates" },
    getId: (r) => r.id,
    filter: locale === "all" ? undefined : (r) => r.locale === locale,
    search: (r, q) => [r.key, r.subject ?? "", r.body].some((s) => s.toLowerCase().includes(q)),
    columns: [
      {
        id: "key",
        header: t("admin.notifications.key"),
        cell: (r) => (
          <div className="min-w-0">
            <div className="font-mono text-xs font-medium">{r.key}</div>
            <div className="max-w-[18rem] truncate text-xs text-muted-foreground">{r.subject || r.body}</div>
          </div>
        ),
      },
      { id: "channel", header: t("admin.notifications.channel"), cell: (r) => <ChannelLabel channel={r.channel} /> },
      {
        id: "locale",
        header: t("admin.notifications.locale"),
        cell: (r) => <Badge variant="outline">{LOCALE_NAMES[r.locale as "en" | "ta"] ?? r.locale}</Badge>,
      },
      {
        id: "scope",
        header: t("admin.notifications.scope"),
        hideBelow: "md",
        cell: (r) => (
          <Badge variant={r.tenantId ? "secondary" : "muted"}>{r.tenantId ? t("admin.notifications.scopeTenant") : t("admin.notifications.scopeGlobal")}</Badge>
        ),
      },
      {
        id: "updated",
        header: t("admin.common.updated"),
        hideBelow: "lg",
        align: "right",
        cell: (r) => <span className="text-muted-foreground">{r.updatedAt ? formatRelative(r.updatedAt) : "—"}</span>,
      },
    ],
    schema: templateSchema,
    defaults: { key: "", channel: "sms", locale: locale === "ta" ? "ta" : "en", subject: "", body: "" },
    toForm: (r) => ({
      key: r.key,
      channel: r.channel,
      locale: r.locale === "ta" ? "ta" : "en",
      subject: r.subject ?? "",
      body: r.body,
    }),
    toBody: (v) => ({ ...v, subject: v.subject.trim() || null }),
    fields: [
      { name: "key", label: t("admin.notifications.key"), placeholder: "auth.otp", lockOnEdit: true, wide: true, description: t("admin.notifications.keyHint") },
      {
        name: "channel",
        label: t("admin.notifications.channel"),
        type: "select",
        lockOnEdit: true,
        options: CHANNELS.map((c) => ({ value: c, label: tOr(t, `admin.channels.${c}`, c) })),
      },
      {
        name: "locale",
        label: t("admin.notifications.locale"),
        type: "select",
        lockOnEdit: true,
        options: [
          { value: "en", label: LOCALE_NAMES.en },
          { value: "ta", label: LOCALE_NAMES.ta },
        ],
      },
      { name: "subject", label: t("admin.notifications.subject"), wide: true, description: t("admin.notifications.subjectHint") },
      { name: "body", label: t("admin.notifications.body"), type: "textarea", rows: 6, description: t("admin.notifications.bodyHint") },
    ],
    // Templates are upserted on (key, channel, locale), so create and update use the same PUT.
    create: { method: "PUT", path: "/notify/templates" },
    update: { method: "PUT", path: () => "/notify/templates" },
    remove: { path: (r) => `/notify/templates/${r.id}` },
    formExtra: (form) => <TemplatePreview form={form} />,
    toolbar: (
      <Tabs value={locale} onValueChange={(v) => setLocale(v as typeof locale)}>
        <TabsList>
          <TabsTrigger value="all">{t("admin.common.all")}</TabsTrigger>
          <TabsTrigger value="en">{LOCALE_NAMES.en}</TabsTrigger>
          <TabsTrigger value="ta" lang="ta">
            {LOCALE_NAMES.ta}
          </TabsTrigger>
        </TabsList>
      </Tabs>
    ),
    labels: {
      createTitle: t("admin.notifications.newTemplate"),
      editTitle: t("admin.notifications.editTemplate"),
      createButton: t("admin.notifications.newTemplate"),
      deleteTitle: (r) => t("admin.notifications.deleteTemplate", { key: r.key }),
      emptyTitle: t("admin.notifications.templatesEmpty"),
      emptyDescription: t("admin.notifications.templatesEmptyHint"),
      searchPlaceholder: t("admin.notifications.searchTemplates"),
    },
    dialogClassName: "sm:max-w-3xl",
  };

  return <ResourcePage config={config} />;
}

/** Renders the template being edited through POST /notify/templates/preview with sample variables. */
function TemplatePreview({ form }: { form: UseFormReturn<TemplateValues> }) {
  const { t } = useI18n();
  const values = useWatch({ control: form.control });
  const [vars, setVars] = React.useState('{ "name": "Priya", "code": "123456", "app": "Acme" }');
  let parsedVars: Record<string, string | number> | null = null;
  try {
    const v: unknown = JSON.parse(vars || "{}");
    if (v && typeof v === "object" && !Array.isArray(v)) parsedVars = v as Record<string, string | number>;
  } catch {
    parsedVars = null;
  }

  const preview = useMutation({
    mutationFn: () =>
      api.post<NotifyPreview>("/notify/templates/preview", {
        channel: values.channel,
        locale: values.locale,
        subject: values.subject?.trim() ? values.subject : null,
        body: values.body ?? "",
        vars: parsedVars ?? {},
      }),
    onError: (err) => toast.error(describeError(err, t)),
  });

  return (
    <div className="grid gap-3 rounded-lg border bg-muted/30 p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="grid flex-1 content-start gap-1.5">
          <Label htmlFor="preview-vars" className="text-xs">
            {t("admin.notifications.sampleVars")}
          </Label>
          <Input
            id="preview-vars"
            value={vars}
            onChange={(e) => setVars(e.target.value)}
            size="sm"
            className="font-mono text-xs"
            aria-invalid={parsedVars === null || undefined}
          />
        </div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={!values.body || parsedVars === null || preview.isPending}
          onClick={() => preview.mutate()}
        >
          {preview.isPending ? <Loader2Icon className="animate-spin" /> : <EyeIcon />}
          {t("admin.notifications.preview")}
        </Button>
      </div>
      {preview.data && (
        <div className="rounded-md border bg-background p-3 text-sm">
          {preview.data.subject && <div className="mb-2 border-b pb-2 font-medium">{preview.data.subject}</div>}
          <div className="whitespace-pre-wrap">{preview.data.body}</div>
        </div>
      )}
    </div>
  );
}

function DeliveryLog() {
  const { t, formatDateTime, formatRelative } = useI18n();
  const [page, setPage] = React.useState(0);
  const [status, setStatus] = React.useState<"all" | NotifyLogEntry["status"]>("all");

  const log = useQuery({
    queryKey: ["notify", "log", "page", page, status],
    queryFn: () =>
      api
        .get<{ items: NotifyLogEntry[] }>("/notify/log", {
          limit: LOG_PAGE,
          offset: page * LOG_PAGE,
          status: status === "all" ? undefined : status,
        })
        .then((r) => r.items),
    placeholderData: keepPreviousData,
  });

  const columns: DataTableColumn<NotifyLogEntry>[] = [
    { id: "channel", header: t("admin.notifications.channel"), cell: (r) => <ChannelLabel channel={r.channel} /> },
    { id: "to", header: t("admin.notifications.to"), cell: (r) => <span className="font-mono text-xs">{r.to}</span> },
    {
      id: "template",
      header: t("admin.notifications.template"),
      hideBelow: "md",
      cell: (r) => <span className="font-mono text-xs text-muted-foreground">{r.templateKey ?? "—"}</span>,
    },
    {
      id: "status",
      header: t("admin.common.status"),
      cell: (r) =>
        r.error ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <StatusBadge status={r.status} />
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">{r.error}</TooltipContent>
          </Tooltip>
        ) : (
          <StatusBadge status={r.status} />
        ),
    },
    {
      id: "when",
      header: t("admin.common.when"),
      align: "right",
      cell: (r) => (
        <span className="text-muted-foreground" title={formatDateTime(r.createdAt)}>
          {formatRelative(r.createdAt)}
        </span>
      ),
    },
  ];

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v as typeof status);
            setPage(0);
          }}
        >
          <SelectTrigger size="sm" className="w-40" aria-label={t("admin.common.status")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("admin.common.allStatuses")}</SelectItem>
            {(["queued", "sent", "failed"] as const).map((s) => (
              <SelectItem key={s} value={s}>
                {tOr(t, `admin.status.${s}`, s)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="ghost" size="icon-sm" className="ml-auto" aria-label={t("admin.common.refresh")} onClick={() => void log.refetch()}>
          <RefreshCwIcon className={log.isFetching ? "animate-spin" : undefined} />
        </Button>
      </div>
      {log.isError ? (
        <QueryError error={log.error} onRetry={() => void log.refetch()} />
      ) : (
        <DataTable
          columns={columns}
          data={log.data}
          loading={log.isLoading}
          getRowId={(r) => r.id}
          pagination={{
            page,
            pageSize: LOG_PAGE,
            hasNext: (log.data?.length ?? 0) === LOG_PAGE,
            onPageChange: setPage,
          }}
          labels={{
            previous: t("admin.table.previous"),
            next: t("admin.table.next"),
            range: ({ from, to }) => t("admin.table.rangeOpen", { from, to }),
          }}
          empty={<EmptyState compact icon={BellIcon} title={t("admin.notifications.logEmpty")} />}
        />
      )}
    </div>
  );
}

function SendTestDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useI18n();
  const [channel, setChannel] = React.useState<Channel>("email");
  const [to, setTo] = React.useState("");
  React.useEffect(() => {
    if (open) setTo("");
  }, [open]);

  const send = useMutation({
    mutationFn: () => api.post("/notify/test", { channel, to: to.trim() }),
    onSuccess: () => {
      toast.success(t("admin.notifications.testSent"));
      onOpenChange(false);
    },
    onError: (err) => toast.error(describeError(err, t)),
  });

  const placeholder = channel === "email" ? "you@example.com" : channel === "push" ? t("admin.notifications.pushToken") : "+919876543210";

  return (
    <Dialog open={open} onOpenChange={(o) => !send.isPending && onOpenChange(o)}>
      <DialogContent closeLabel={t("admin.common.close")}>
        <DialogHeader>
          <DialogTitle>{t("admin.notifications.sendTest")}</DialogTitle>
          <DialogDescription>{t("admin.notifications.sendTestHint")}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (to.trim().length >= 3) send.mutate();
          }}
        >
          <div className="grid gap-2">
            <Label>{t("admin.notifications.channel")}</Label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {CHANNELS.map((c) => {
                const Icon = channelIcon[c];
                return (
                  <Button key={c} type="button" variant={channel === c ? "default" : "outline"} size="sm" onClick={() => setChannel(c)}>
                    <Icon /> {tOr(t, `admin.channels.${c}`, c)}
                  </Button>
                );
              })}
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="test-to">{t("admin.notifications.to")}</Label>
            <Input id="test-to" value={to} onChange={(e) => setTo(e.target.value)} placeholder={placeholder} autoFocus />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={send.isPending}>
              {t("admin.common.cancel")}
            </Button>
            <Button type="submit" disabled={send.isPending || to.trim().length < 3}>
              {send.isPending ? <Loader2Icon className="animate-spin" /> : <SendIcon />}
              {t("admin.notifications.send")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
