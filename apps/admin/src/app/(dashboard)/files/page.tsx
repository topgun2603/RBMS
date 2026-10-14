"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CopyIcon,
  ExternalLinkIcon,
  FileIcon,
  FileTextIcon,
  FolderOpenIcon,
  LockIcon,
  MoreVerticalIcon,
  Trash2Icon,
  UploadIcon,
  XIcon,
} from "lucide-react";
import {
  Badge,
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Label,
  PageHeader,
  Progress,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Stagger,
  StaggerItem,
  Switch,
  toast,
} from "@srirealtime/ui";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Page } from "@/components/page";
import { QueryError } from "@/components/query-state";
import { absoluteUrl, api } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import { describeError, tOr, useI18n } from "@/lib/i18n";
import { qk } from "@/lib/queries";
import type { UploadedFile } from "@/lib/types";
import { uploadFile } from "@/lib/upload";

const MAX_BYTES = 25 * 1024 * 1024;
const PURPOSES = ["general", "branding", "avatar", "document"] as const;

interface PendingUpload {
  id: string;
  name: string;
  size: number;
  progress: number;
  error?: string;
}

export default function FilesPage() {
  const { t, formatRelative } = useI18n();
  const qc = useQueryClient();
  const input = React.useRef<HTMLInputElement>(null);
  const [purpose, setPurpose] = React.useState<string>("all");
  const [publicUpload, setPublicUpload] = React.useState(false);
  const [pending, setPending] = React.useState<PendingUpload[]>([]);
  const [deleting, setDeleting] = React.useState<UploadedFile | null>(null);
  const [dragging, setDragging] = React.useState(false);

  const files = useQuery({
    queryKey: qk.uploads(purpose),
    queryFn: () =>
      api.get<{ items: UploadedFile[] }>("/uploads", { purpose: purpose === "all" ? undefined : purpose, limit: 200 }).then((r) => r.items),
  });

  const remove = useMutation({
    mutationFn: (f: UploadedFile) => api.delete(`/uploads/${f.id}`),
    onSuccess: () => {
      toast.success(t("admin.files.deleted"));
      void qc.invalidateQueries({ queryKey: ["uploads"] });
    },
    onError: (err) => toast.error(describeError(err, t)),
  });

  const startUploads = async (list: FileList | File[]) => {
    const chosen = Array.from(list);
    for (const file of chosen) {
      const id = `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`;
      if (file.size > MAX_BYTES) {
        toast.error(t("admin.files.tooLarge", { max: formatBytes(MAX_BYTES) }));
        continue;
      }
      setPending((p) => [...p, { id, name: file.name, size: file.size, progress: 0 }]);
      try {
        await uploadFile(file, {
          purpose: purpose === "all" ? "general" : purpose,
          visibility: publicUpload ? "public" : "private",
          onProgress: (progress) => setPending((p) => p.map((u) => (u.id === id ? { ...u, progress } : u))),
        });
        setPending((p) => p.filter((u) => u.id !== id));
        void qc.invalidateQueries({ queryKey: ["uploads"] });
      } catch (err) {
        setPending((p) => p.map((u) => (u.id === id ? { ...u, error: describeError(err, t) } : u)));
      }
    }
    if (input.current) input.current.value = "";
  };

  const copy = async (f: UploadedFile) => {
    try {
      await navigator.clipboard.writeText(absoluteUrl(f.url));
      toast.success(t("admin.files.copied"));
    } catch {
      toast.error(t("admin.errors.generic"));
    }
  };

  return (
    <Page>
      <PageHeader
        title={t("admin.files.title")}
        description={t("admin.files.subtitle")}
        actions={
          <Button onClick={() => input.current?.click()}>
            <UploadIcon /> {t("admin.files.upload")}
          </Button>
        }
      />
      <input
        ref={input}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => e.target.files && void startUploads(e.target.files)}
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Select value={purpose} onValueChange={setPurpose}>
          <SelectTrigger size="sm" className="w-44" aria-label={t("admin.files.purpose")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("admin.files.allPurposes")}</SelectItem>
            {PURPOSES.map((p) => (
              <SelectItem key={p} value={p}>
                {tOr(t, `admin.files.purposes.${p}`, p)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Label className="flex items-center gap-2 text-sm font-normal text-muted-foreground">
          <Switch checked={publicUpload} onCheckedChange={setPublicUpload} />
          {t("admin.files.uploadPublic")}
        </Label>
        {files.data && <span className="ml-auto text-xs text-muted-foreground">{t("admin.files.count", { count: files.data.length })}</span>}
      </div>

      {pending.length > 0 && (
        <div className="mb-4 grid gap-2 rounded-xl border bg-card p-3">
          {pending.map((u) => (
            <div key={u.id} className="flex items-center gap-3 text-sm">
              <FileIcon className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="flex justify-between gap-2">
                  <span className="truncate">{u.name}</span>
                  <span className={cn("shrink-0 text-xs tabular-nums", u.error ? "text-destructive" : "text-muted-foreground")}>
                    {u.error ?? `${u.progress}%`}
                  </span>
                </div>
                {!u.error && <Progress value={u.progress} className="mt-1 h-1" />}
              </div>
              {u.error && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("admin.common.dismiss")}
                  onClick={() => setPending((p) => p.filter((x) => x.id !== u.id))}
                >
                  <XIcon />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files.length) void startUploads(e.dataTransfer.files);
        }}
        className={cn("rounded-xl transition-colors", dragging && "bg-primary/5 ring-2 ring-primary/40 ring-offset-4 ring-offset-background")}
      >
        {files.isError ? (
          <QueryError error={files.error} onRetry={() => void files.refetch()} />
        ) : files.isLoading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {Array.from({ length: 10 }, (_, i) => (
              <Skeleton key={i} className="aspect-[4/5]" />
            ))}
          </div>
        ) : !files.data?.length ? (
          <EmptyState
            icon={FolderOpenIcon}
            title={t("admin.files.emptyTitle")}
            description={t("admin.files.emptyDescription")}
            action={
              <Button variant="outline" onClick={() => input.current?.click()}>
                <UploadIcon /> {t("admin.files.upload")}
              </Button>
            }
          />
        ) : (
          <Stagger className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" stagger={0.02}>
            {files.data.map((f) => {
              const isImage = f.contentType.startsWith("image/");
              const thumb = f.thumbUrl ?? (isImage ? f.url : null);
              const name = f.originalName ?? f.key?.split("/").pop() ?? f.id;
              return (
                <StaggerItem key={f.id}>
                  <div className="group overflow-hidden rounded-xl border bg-card shadow-xs transition-shadow hover:shadow-md">
                    <a
                      href={absoluteUrl(f.url)}
                      target="_blank"
                      rel="noreferrer"
                      className="relative flex aspect-[4/3] items-center justify-center bg-muted/50"
                    >
                      {thumb ? (
                        // eslint-disable-next-line @next/next/no-img-element -- signed/arbitrary storage URLs
                        <img src={absoluteUrl(thumb)} alt="" loading="lazy" className="size-full object-cover" />
                      ) : f.contentType === "application/pdf" || f.contentType.startsWith("text/") ? (
                        <FileTextIcon className="size-8 text-muted-foreground" />
                      ) : (
                        <FileIcon className="size-8 text-muted-foreground" />
                      )}
                      {f.visibility === "private" && (
                        <Badge variant="secondary" className="absolute top-2 left-2 h-5 bg-background/80 px-1.5 backdrop-blur">
                          <LockIcon />
                        </Badge>
                      )}
                    </a>
                    <div className="flex items-start gap-1 p-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium" title={name}>
                          {name}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {formatBytes(f.size)}
                          {f.width && f.height ? ` · ${f.width}×${f.height}` : ""}
                          {f.createdAt ? ` · ${formatRelative(f.createdAt)}` : ""}
                        </p>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" className="-mr-1 shrink-0" aria-label={t("admin.common.actions")}>
                            <MoreVerticalIcon />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44">
                          <DropdownMenuItem asChild>
                            <a href={absoluteUrl(f.url)} target="_blank" rel="noreferrer">
                              <ExternalLinkIcon /> {t("admin.files.open")}
                            </a>
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => void copy(f)}>
                            <CopyIcon /> {t("admin.files.copyUrl")}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(f)}>
                            <Trash2Icon /> {t("admin.common.delete")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                </StaggerItem>
              );
            })}
          </Stagger>
        )}
      </div>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t("admin.files.deleteTitle")}
        description={t("admin.files.deleteDescription", { name: deleting?.originalName ?? "" })}
        confirmLabel={t("admin.common.delete")}
        onConfirm={() => (deleting ? remove.mutateAsync(deleting) : undefined)}
      />
    </Page>
  );
}
