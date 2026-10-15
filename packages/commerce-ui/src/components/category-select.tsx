"use client";

import * as React from "react";
import { FolderPlusIcon, Loader2Icon } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
  toast,
} from "@srirealtime/ui";
import { describeError, useI18n } from "@srirealtime/web";
import { buildTree, flattenTree, subtreeIds, type FlatCategory } from "../lib/categories";
import { useCategories, useSaveCategory } from "../lib/queries";
import type { Category } from "../lib/types";

const NONE = "__none";
const NEW = "__new";

/** Indented category options in tree order (optionally without `exclude` and its subtree, for parent pickers). */
export function useCategoryOptions(exclude?: string | null): { list: FlatCategory[]; loading: boolean; all: Category[] } {
  const q = useCategories();
  return React.useMemo(() => {
    const all = q.data ?? [];
    const hidden = exclude ? subtreeIds(all, exclude) : new Set<string>();
    const list = flattenTree(buildTree(all)).filter((c) => !hidden.has(c.id));
    return { list, loading: q.isPending, all };
  }, [q.data, q.isPending, exclude]);
}

export function CategoryOptionLabel({ c }: { c: FlatCategory }) {
  return (
    <span className="flex items-center gap-1.5" style={{ paddingLeft: `${c.depth * 0.875}rem` }}>
      {c.depth > 0 && <span className="text-muted-foreground" aria-hidden>└</span>}
      {c.name}
    </span>
  );
}

/**
 * Category picker in tree order with "No category" and "Create category…" (a small dialog that creates it and selects
 * it). `exclude` hides a category and its subtree (parent pickers).
 */
export function CategorySelect({
  id,
  value,
  onChange,
  exclude,
  allowCreate = true,
  noneLabel,
  className,
  disabled,
  "aria-label": ariaLabel,
}: {
  id?: string;
  value: string | null;
  onChange: (id: string | null) => void;
  exclude?: string | null;
  allowCreate?: boolean;
  noneLabel?: string;
  className?: string;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  const { t } = useI18n();
  const { list, loading } = useCategoryOptions(exclude);
  const [creating, setCreating] = React.useState(false);

  return (
    <>
      <Select
        value={value ?? NONE}
        disabled={disabled || loading}
        onValueChange={(v) => {
          if (v === NEW) setCreating(true);
          else onChange(v === NONE ? null : v);
        }}
      >
        <SelectTrigger id={id} className={className} aria-label={ariaLabel}>
          <SelectValue placeholder={loading ? t("commerce.common.loading") : undefined} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>
            <span className="text-muted-foreground">{noneLabel ?? t("commerce.categories.none")}</span>
          </SelectItem>
          {list.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              <CategoryOptionLabel c={c} />
            </SelectItem>
          ))}
          {allowCreate && (
            <>
              <SelectSeparator />
              <SelectItem value={NEW} className="font-medium text-primary">
                <FolderPlusIcon className="text-primary" /> {t("commerce.categories.createInline")}
              </SelectItem>
            </>
          )}
        </SelectContent>
      </Select>
      <QuickCategoryDialog
        open={creating}
        onOpenChange={setCreating}
        parentOptions={list}
        onCreated={(c) => {
          onChange(c.id);
          setCreating(false);
        }}
      />
    </>
  );
}

function QuickCategoryDialog({
  open,
  onOpenChange,
  parentOptions,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  parentOptions: FlatCategory[];
  onCreated: (c: Category) => void;
}) {
  const { t } = useI18n();
  const save = useSaveCategory();
  const [name, setName] = React.useState("");
  const [parentId, setParentId] = React.useState<string>(NONE);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (open) {
      setName("");
      setParentId(NONE);
      setError(null);
    }
  }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!name.trim()) {
      setError(t("commerce.validation.required"));
      return;
    }
    try {
      const c = await save.mutateAsync({ body: { name: name.trim(), parentId: parentId === NONE ? null : parentId } });
      toast.success(t("commerce.categories.created", { name: c.name }));
      onCreated(c);
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !save.isPending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md" closeLabel={t("commerce.common.close")}>
        <DialogHeader>
          <DialogTitle>{t("commerce.categories.newTitle")}</DialogTitle>
          <DialogDescription>{t("commerce.categories.quickHint")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <div className="grid gap-2">
            <Label htmlFor="quick-cat-name">{t("commerce.categories.name")}</Label>
            <Input
              id="quick-cat-name"
              autoFocus
              className="h-11"
              value={name}
              aria-invalid={!!error}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
            />
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
          {parentOptions.length > 0 && (
            <div className="grid gap-2">
              <Label htmlFor="quick-cat-parent">{t("commerce.categories.parent")}</Label>
              <Select value={parentId} onValueChange={setParentId}>
                <SelectTrigger id="quick-cat-parent" className="h-11 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t("commerce.categories.topLevel")}</SelectItem>
                  {parentOptions.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      <CategoryOptionLabel c={c} />
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>
              {t("commerce.common.cancel")}
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2Icon className="animate-spin" />}
              {t("commerce.categories.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
