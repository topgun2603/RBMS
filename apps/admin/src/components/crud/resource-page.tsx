"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm, type DefaultValues, type FieldPath, type FieldValues, type Resolver, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { Loader2Icon, MoreHorizontalIcon, PencilIcon, PlusIcon, SearchIcon, Trash2Icon } from "lucide-react";
import {
  Button,
  cn,
  DataTable,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Input,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
  toast,
  type DataTableColumn,
} from "@srirealtime/ui";
import { api, type QueryParams } from "@/lib/api";
import { describeError, useI18n } from "@/lib/i18n";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { QueryError } from "@/components/query-state";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";

export type ResourceFieldType = "text" | "textarea" | "number" | "switch" | "select" | "json" | "tags";

export interface ResourceField<V extends FieldValues> {
  name: FieldPath<V>;
  label: string;
  type?: ResourceFieldType;
  placeholder?: string;
  description?: string;
  options?: { value: string; label: string }[];
  /** Read-only when editing an existing row (natural keys such as ids). */
  lockOnEdit?: boolean;
  /** Spans both columns of the form grid. */
  wide?: boolean;
  rows?: number;
}

export interface ResourceLabels<T> {
  /** e.g. "Plan" — used in "New plan", "Edit plan". */
  createTitle: string;
  editTitle: string;
  createButton: string;
  deleteTitle: (row: T) => string;
  deleteDescription?: string;
  emptyTitle: string;
  emptyDescription?: string;
  searchPlaceholder?: string;
}

export interface ResourceConfig<T, V extends FieldValues> {
  title: string;
  description?: string;
  icon?: React.ComponentType<{ className?: string }>;
  queryKey: readonly unknown[];
  /** GET endpoint returning `{ items }` (or use `select` for other shapes). */
  list: { path: string; query?: QueryParams; select?: (res: unknown) => T[] };
  getId: (row: T) => string;
  columns: DataTableColumn<T>[];
  /** zod schema for the form values. Messages may be i18n keys ("admin.…"). */
  schema: z.ZodType<V, z.ZodTypeDef, unknown>;
  fields: ResourceField<V>[];
  defaults: V;
  toForm: (row: T) => V;
  /** Maps form values to the request body (default: values as-is). */
  toBody?: (values: V, row: T | null) => unknown;
  create?: { method?: "POST" | "PUT"; path: string | ((values: V) => string) };
  update?: { method?: "PUT" | "PATCH" | "POST"; path: (row: T, values: V) => string };
  remove?: { path: (row: T) => string };
  labels: ResourceLabels<T>;
  search?: (row: T, q: string) => boolean;
  /** Client-side filter applied before search (e.g. a locale tab). */
  filter?: (row: T) => boolean;
  /** Extra controls next to the search box. */
  toolbar?: React.ReactNode;
  /** Extra dropdown items per row. */
  rowActions?: (row: T) => React.ReactNode;
  /** Rendered under the form fields, e.g. a live preview. */
  formExtra?: (form: UseFormReturn<V>, row: T | null) => React.ReactNode;
  pageSize?: number;
  /** Inside another page (tabs): no PageHeader, compact toolbar instead. */
  embedded?: boolean;
  dialogClassName?: string;
}

type Editing<T> = { mode: "create" } | { mode: "edit"; row: T } | null;

/**
 * Generic list + create/edit dialog + delete confirm for a REST resource.
 * Used by platform plans and notification templates; reuse for any `{ items }` endpoint.
 */
export function ResourcePage<T, V extends FieldValues>({ config }: { config: ResourceConfig<T, V> }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [q, setQ] = React.useState("");
  const [editing, setEditing] = React.useState<Editing<T>>(null);
  const [deleting, setDeleting] = React.useState<T | null>(null);

  const query = useQuery({
    queryKey: config.queryKey,
    queryFn: async () => {
      const res = await api.get<unknown>(config.list.path, config.list.query);
      return config.list.select ? config.list.select(res) : ((res as { items: T[] }).items ?? []);
    },
  });

  const rows = React.useMemo(() => {
    let r = query.data ?? [];
    if (config.filter) r = r.filter(config.filter);
    const needle = q.trim().toLowerCase();
    if (needle && config.search) r = r.filter((row) => config.search!(row, needle));
    return r;
  }, [query.data, q, config]);

  const remove = useMutation({
    mutationFn: (row: T) => api.delete(config.remove!.path(row)),
    onSuccess: () => {
      toast.success(t("admin.crud.deleted"));
      void qc.invalidateQueries({ queryKey: config.queryKey });
    },
    onError: (err) => toast.error(describeError(err, t)),
  });

  const hasActions = !!(config.update || config.remove || config.rowActions);
  const columns: DataTableColumn<T>[] = hasActions
    ? [
        ...config.columns,
        {
          id: "__actions",
          header: <span className="sr-only">{t("admin.common.actions")}</span>,
          align: "right",
          width: "48px",
          cell: (row) => (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={t("admin.common.actions")} onClick={(e) => e.stopPropagation()}>
                  <MoreHorizontalIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                {config.update && (
                  <DropdownMenuItem onSelect={() => setEditing({ mode: "edit", row })}>
                    <PencilIcon /> {t("admin.common.edit")}
                  </DropdownMenuItem>
                )}
                {config.rowActions?.(row)}
                {config.remove && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(row)}>
                      <Trash2Icon /> {t("admin.common.delete")}
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          ),
        },
      ]
    : config.columns;

  const createButton = config.create && (
    <Button size={config.embedded ? "sm" : "default"} onClick={() => setEditing({ mode: "create" })}>
      <PlusIcon /> {config.labels.createButton}
    </Button>
  );

  return (
    <div>
      {!config.embedded && <PageHeader title={config.title} description={config.description} actions={createButton} />}

      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        {config.search && (
          <div className="relative w-full sm:max-w-xs">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={config.labels.searchPlaceholder ?? t("admin.common.search")}
              className="h-8 pl-8"
              aria-label={t("admin.common.search")}
            />
          </div>
        )}
        {config.toolbar}
        {config.embedded && <div className="sm:ml-auto">{createButton}</div>}
      </div>

      {query.isError ? (
        <QueryError error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          loading={query.isLoading}
          getRowId={(row) => config.getId(row)}
          onRowClick={config.update ? (row) => setEditing({ mode: "edit", row }) : undefined}
          pageSize={config.pageSize ?? 20}
          labels={{
            previous: t("admin.table.previous"),
            next: t("admin.table.next"),
            range: ({ from, to, total }) => t("admin.table.range", { from, to, total: total ?? to }),
          }}
          empty={
            <EmptyState
              compact
              icon={config.icon}
              title={q ? t("admin.common.noResults") : config.labels.emptyTitle}
              description={q ? undefined : config.labels.emptyDescription}
              action={!q ? createButton : undefined}
            />
          }
        />
      )}

      <ResourceFormDialog config={config} editing={editing} onClose={() => setEditing(null)} />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={deleting ? config.labels.deleteTitle(deleting) : ""}
        description={config.labels.deleteDescription ?? t("admin.crud.deleteDescription")}
        confirmLabel={t("admin.common.delete")}
        onConfirm={() => (deleting ? remove.mutateAsync(deleting) : undefined)}
      />
    </div>
  );
}

function ResourceFormDialog<T, V extends FieldValues>({
  config,
  editing,
  onClose,
}: {
  config: ResourceConfig<T, V>;
  editing: Editing<T>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const row = editing?.mode === "edit" ? editing.row : null;
  const form = useForm<V>({
    resolver: zodResolver(config.schema as never) as unknown as Resolver<V>,
    defaultValues: config.defaults as DefaultValues<V>,
  });

  React.useEffect(() => {
    if (!editing) return;
    form.reset((editing.mode === "edit" ? config.toForm(editing.row) : config.defaults) as DefaultValues<V>);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when the dialog target changes
  }, [editing]);

  const save = useMutation({
    mutationFn: async (values: V) => {
      const body = config.toBody ? config.toBody(values, row) : values;
      if (row && config.update) {
        return api(config.update.path(row, values), { method: config.update.method ?? "PATCH", body });
      }
      if (!row && config.create) {
        const path = typeof config.create.path === "function" ? config.create.path(values) : config.create.path;
        return api(path, { method: config.create.method ?? "POST", body });
      }
      return undefined;
    },
    onSuccess: () => {
      toast.success(row ? t("admin.crud.updated") : t("admin.crud.created"));
      void qc.invalidateQueries({ queryKey: config.queryKey });
      onClose();
    },
    onError: (err) => toast.error(describeError(err, t)),
  });

  return (
    <Dialog open={editing !== null} onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent className={cn("sm:max-w-2xl", config.dialogClassName)} closeLabel={t("admin.common.close")}>
        <DialogHeader>
          <DialogTitle>{row ? config.labels.editTitle : config.labels.createTitle}</DialogTitle>
          <DialogDescription className="sr-only">{config.title}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              {config.fields.map((f) => (
                <FormField
                  key={f.name}
                  control={form.control}
                  name={f.name}
                  render={({ field }) => {
                    const disabled = !!(row && f.lockOnEdit);
                    const type = f.type ?? "text";
                    return (
                      <FormItem
                        className={cn(
                          (f.wide || type === "textarea" || type === "json") && "sm:col-span-2",
                          type === "switch" && "flex flex-row items-center justify-between gap-3 rounded-md border px-3 py-2.5",
                        )}
                      >
                        <div className={cn(type === "switch" && "space-y-0.5")}>
                          <FormLabel>{f.label}</FormLabel>
                          {type === "switch" && f.description && <FormDescription>{f.description}</FormDescription>}
                        </div>
                        <FormControl>
                          {type === "switch" ? (
                            <Switch checked={!!field.value} onCheckedChange={field.onChange} disabled={disabled} />
                          ) : type === "select" ? (
                            <Select value={(field.value as string) ?? ""} onValueChange={field.onChange} disabled={disabled}>
                              <SelectTrigger className="w-full">
                                <SelectValue placeholder={f.placeholder} />
                              </SelectTrigger>
                              <SelectContent>
                                {f.options?.map((o) => (
                                  <SelectItem key={o.value} value={o.value}>
                                    {o.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : type === "textarea" || type === "json" ? (
                            <Textarea
                              {...field}
                              value={(field.value as string) ?? ""}
                              rows={f.rows ?? (type === "json" ? 5 : 4)}
                              placeholder={f.placeholder}
                              disabled={disabled}
                              spellCheck={type !== "json"}
                              className={cn(type === "json" && "font-mono text-xs")}
                            />
                          ) : type === "number" ? (
                            <Input
                              type="number"
                              inputMode="numeric"
                              name={field.name}
                              ref={field.ref}
                              onBlur={field.onBlur}
                              value={(field.value as number | string | undefined) ?? ""}
                              onChange={(e) => field.onChange(e.target.value === "" ? "" : Number(e.target.value))}
                              placeholder={f.placeholder}
                              disabled={disabled}
                            />
                          ) : (
                            <Input
                              {...field}
                              value={(field.value as string) ?? ""}
                              placeholder={f.placeholder}
                              disabled={disabled}
                              className={cn(f.lockOnEdit && "font-mono")}
                            />
                          )}
                        </FormControl>
                        {type !== "switch" && f.description && <FormDescription>{f.description}</FormDescription>}
                        <FormMessage />
                      </FormItem>
                    );
                  }}
                />
              ))}
            </div>
            {config.formExtra?.(form, row)}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>
                {t("admin.common.cancel")}
              </Button>
              <Button type="submit" disabled={save.isPending}>
                {save.isPending && <Loader2Icon className="animate-spin" />}
                {t("admin.common.save")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

/** zod refinement helpers for JSON / tag text fields. */
export const jsonText = (s: string) => {
  if (!s.trim()) return true;
  try {
    const v: unknown = JSON.parse(s);
    return typeof v === "object" && v !== null && !Array.isArray(v);
  } catch {
    return false;
  }
};
export const parseJsonObject = <R,>(s: string): R => (s.trim() ? (JSON.parse(s) as R) : ({} as R));
export const splitTags = (s: string) =>
  s
    .split(/[,\n]/)
    .map((x) => x.trim())
    .filter(Boolean);
