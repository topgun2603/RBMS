"use client";

import * as React from "react";
import { CheckIcon, Loader2Icon, LockIcon, PencilIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react";
import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Input, Skeleton, toast } from "@srirealtime/ui";
import { ConfirmDialog, describeError, QueryError, useI18n } from "@srirealtime/web";
import { useDeleteCategory, useExpenseCategories, useSaveCategory, type ExpenseCategory } from "../../lib/expenses";
import { categoryLabel } from "./expense-dialog";

/** Add, rename and delete expense categories (built-ins can be renamed, not deleted). */
export function CategoriesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useI18n();
  const q = useExpenseCategories(open);
  const save = useSaveCategory();
  const del = useDeleteCategory();
  const [name, setName] = React.useState("");
  const [editing, setEditing] = React.useState<{ id: string; name: string; original: string } | null>(null);
  const [deleting, setDeleting] = React.useState<ExpenseCategory | null>(null);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      await save.mutateAsync({ name: name.trim() });
      toast.success(t("billing.expenses.categoryAdded", { name: name.trim() }));
      setName("");
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };
  const rename = async () => {
    if (!editing?.name.trim()) return;
    if (editing.name.trim() === editing.original) return setEditing(null);
    try {
      await save.mutateAsync({ id: editing.id, name: editing.name.trim() });
      setEditing(null);
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-md" closeLabel={t("billing.common.close")}>
        <DialogHeader>
          <DialogTitle>{t("billing.expenses.categoriesTitle")}</DialogTitle>
          <DialogDescription>{t("billing.expenses.categoriesHint")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={add} className="flex gap-2">
          <Input className="h-11" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("billing.expenses.newCategory")} aria-label={t("billing.expenses.newCategory")} maxLength={60} />
          <Button type="submit" className="h-11" disabled={!name.trim() || save.isPending}>
            {save.isPending && !editing ? <Loader2Icon className="animate-spin" /> : <PlusIcon />} {t("billing.expenses.addCategory")}
          </Button>
        </form>
        {q.isError ? (
          <QueryError compact error={q.error} onRetry={() => void q.refetch()} />
        ) : q.isPending ? (
          <div className="grid gap-2">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-10 rounded-lg" />
            ))}
          </div>
        ) : (
          <ul className="divide-y rounded-xl border">
            {q.data.map((c) => (
              <li key={c.id} className="flex items-center gap-2 px-3 py-1.5">
                {editing?.id === c.id ? (
                  <>
                    <Input
                      autoFocus
                      className="h-9"
                      value={editing.name}
                      maxLength={60}
                      aria-label={t("billing.expenses.renameCategory")}
                      onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void rename();
                        }
                        if (e.key === "Escape") setEditing(null);
                      }}
                    />
                    <Button variant="ghost" size="icon" aria-label={t("billing.common.save")} onClick={() => void rename()} disabled={save.isPending}>
                      <CheckIcon />
                    </Button>
                    <Button variant="ghost" size="icon" aria-label={t("billing.common.cancel")} onClick={() => setEditing(null)}>
                      <XIcon />
                    </Button>
                  </>
                ) : (
                  <>
                    <span className="min-w-0 flex-1 truncate text-sm">{categoryLabel(t, c)}</span>
                    {c.builtin && <LockIcon className="size-3.5 text-muted-foreground" aria-label={t("billing.expenses.builtinCategory")} />}
                    <Button variant="ghost" size="icon" aria-label={t("billing.expenses.renameNamed", { name: categoryLabel(t, c) })} onClick={() => setEditing({ id: c.id, name: categoryLabel(t, c), original: categoryLabel(t, c) })}>
                      <PencilIcon />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-destructive"
                      disabled={c.builtin}
                      aria-label={t("billing.expenses.deleteNamed", { name: categoryLabel(t, c) })}
                      onClick={() => setDeleting(c)}
                    >
                      <Trash2Icon />
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        <ConfirmDialog
          open={!!deleting}
          onOpenChange={(o) => !o && setDeleting(null)}
          title={t("billing.expenses.deleteCategoryTitle", { name: deleting ? categoryLabel(t, deleting) : "" })}
          description={t("billing.expenses.deleteCategoryBody")}
          confirmLabel={t("billing.common.delete")}
          onConfirm={async () => {
            if (!deleting) return;
            try {
              await del.mutateAsync(deleting.id);
            } catch (err) {
              toast.error(describeError(err, t));
              throw err;
            }
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
