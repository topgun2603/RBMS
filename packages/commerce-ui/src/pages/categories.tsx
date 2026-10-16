"use client";

import * as React from "react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronRightIcon,
  EyeOffIcon,
  FolderPlusIcon,
  FolderTreeIcon,
  GripVerticalIcon,
  Loader2Icon,
  MoreVerticalIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import {
  AnimatePresence,
  Button,
  Card,
  cn,
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
  Field,
  FieldControl,
  FieldError,
  FieldHint,
  FieldLabel,
  Input,
  Label,
  motion,
  Skeleton,
  Switch,
  Textarea,
  toast,
} from "@srirealtime/ui";
import { ConfirmDialog, describeError, ModuleLink, Page, PageHeading, QueryError, useI18n } from "@srirealtime/web";
import { ProductThumb } from "../components/bits";
import { CategorySelect } from "../components/category-select";
import { FoldersIllustration } from "../components/illustrations";
import { ImageManager } from "../components/image-manager";
import { useDragSort } from "../components/sortable";
import { useCanManageCatalogue } from "../lib/access";
import { buildTree, flattenTree, totalProducts } from "../lib/categories";
import { SLUG_RE, slugify } from "../lib/format";
import { useCategories, useDeleteCategory, useReorderCategories, useSaveCategory } from "../lib/queries";
import type { Category, CategoryNode } from "../lib/types";

type Editing = { mode: "new"; parentId: string | null } | { mode: "edit"; category: Category } | null;

export default function CategoriesPage() {
  const { t } = useI18n();
  const q = useCategories();
  const reorder = useReorderCategories();
  const del = useDeleteCategory();
  const canManage = useCanManageCatalogue();
  const [editing, setEditing] = React.useState<Editing>(null);
  const [deleting, setDeleting] = React.useState<CategoryNode | null>(null);
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set());

  const flat = React.useMemo(() => q.data ?? [], [q.data]);
  const tree = React.useMemo(() => buildTree(flat), [flat]);

  /** A sibling group was reordered: send the whole tree order (sort is one sequence for the shop). */
  const onSiblingsReorder = React.useCallback(
    (parentId: string | null, siblings: CategoryNode[]) => {
      const replace = (nodes: CategoryNode[], pid: string | null): CategoryNode[] =>
        (pid === parentId ? siblings : nodes).map((n) => ({ ...n, children: replace(n.children, n.id) }));
      const next = flattenTree(replace(tree, null));
      const byId = new Map(flat.map((c) => [c.id, c]));
      reorder.mutate(
        next.map((c) => byId.get(c.id)!).filter(Boolean),
        { onError: (err) => toast.error(describeError(err, t)), onSuccess: () => toast.success(t("commerce.categories.reordered")) },
      );
    },
    [tree, flat, reorder, t],
  );

  const toggle = (id: string) =>
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const addButton = (
    <Button size="lg" onClick={() => setEditing({ mode: "new", parentId: null })} disabled={!canManage}>
      <PlusIcon /> {t("commerce.categories.add")}
    </Button>
  );

  return (
    <Page>
      <PageHeading
        icon={FolderTreeIcon}
        title={t("commerce.categories.title")}
        description={q.data ? t("commerce.categories.subtitleCount", { count: q.data.length }) : t("commerce.categories.subtitle")}
        actions={addButton}
      />

      {q.isError ? (
        <QueryError error={q.error} onRetry={() => void q.refetch()} />
      ) : q.isPending ? (
        <Card className="gap-0 divide-y py-1">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className={cn("flex items-center gap-3 px-4 py-3", i % 3 !== 0 && "pl-12")}>
              <Skeleton className="size-4" />
              <Skeleton className="size-10 rounded-xl" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-24" />
              </div>
              <Skeleton className="h-6 w-16 rounded-full" />
            </div>
          ))}
        </Card>
      ) : tree.length === 0 ? (
        <EmptyState illustration={<FoldersIllustration />} title={t("commerce.categories.emptyTitle")} description={t("commerce.categories.emptyBody")} action={addButton} />
      ) : (
        <>
          <p className="mb-2 text-meta text-muted-foreground">{t("commerce.categories.dragHint")}</p>
          <Card className={cn("gap-0 overflow-hidden p-1.5 transition-opacity", reorder.isPending && "opacity-70")}>
            <Branch
              nodes={tree}
              parentId={null}
              depth={0}
              collapsed={collapsed}
              onToggle={toggle}
              canManage={canManage}
              onReorder={onSiblingsReorder}
              onAddChild={(id) => setEditing({ mode: "new", parentId: id })}
              onEdit={(c) => setEditing({ mode: "edit", category: c })}
              onDelete={setDeleting}
            />
          </Card>
        </>
      )}

      <CategoryDialog editing={editing} onClose={() => setEditing(null)} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t("commerce.categories.deleteTitle", { name: deleting?.name ?? "" })}
        description={t("commerce.categories.deleteBody")}
        confirmLabel={t("commerce.common.delete")}
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await del.mutateAsync(deleting.id);
            toast.success(t("commerce.categories.deleted", { name: deleting.name }));
          } catch (err) {
            toast.error(describeError(err, t));
            throw err;
          }
        }}
      />
    </Page>
  );
}

function Branch({
  nodes,
  parentId,
  depth,
  collapsed,
  onToggle,
  canManage,
  onReorder,
  onAddChild,
  onEdit,
  onDelete,
}: {
  nodes: CategoryNode[];
  parentId: string | null;
  depth: number;
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  canManage: boolean;
  onReorder: (parentId: string | null, siblings: CategoryNode[]) => void;
  onAddChild: (id: string) => void;
  onEdit: (c: Category) => void;
  onDelete: (c: CategoryNode) => void;
}) {
  const { t } = useI18n();
  const sort = useDragSort(nodes, (n) => n.id, (next) => onReorder(parentId, next));
  return (
    <ul role={depth === 0 ? "tree" : "group"} aria-label={depth === 0 ? t("commerce.categories.title") : undefined} className="grid gap-0.5">
      {nodes.map((n, i) => {
        const open = !collapsed.has(n.id);
        const total = totalProducts(n);
        const empty = n.productCount === 0 && n.children.length === 0;
        return (
          <motion.li key={n.id} layout="position" transition={{ duration: 0.2 }} role="treeitem" aria-expanded={n.children.length ? open : undefined} aria-level={depth + 1}>
            <div
              {...(canManage ? sort.itemProps(n.id) : {})}
              className={cn(
                "group flex items-center gap-2 rounded-xl px-2 py-2 transition-colors hover:bg-accent/50",
                "data-[dragging]:opacity-40 data-[over]:bg-primary/5 data-[over]:ring-2 data-[over]:ring-primary/50",
              )}
              style={{ paddingLeft: `${0.5 + depth * 1.5}rem` }}
            >
              {canManage && (
                <span className="hidden cursor-grab text-muted-foreground/60 group-hover:text-muted-foreground active:cursor-grabbing sm:inline-flex" aria-hidden>
                  <GripVerticalIcon className="size-4" />
                </span>
              )}
              {n.children.length > 0 ? (
                <button
                  type="button"
                  onClick={() => onToggle(n.id)}
                  className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={open ? t("commerce.categories.collapse", { name: n.name }) : t("commerce.categories.expand", { name: n.name })}
                >
                  <ChevronRightIcon className={cn("size-4 transition-transform", open && "rotate-90")} />
                </button>
              ) : (
                <span className="size-6" aria-hidden />
              )}
              <ProductThumb src={n.imageUrl} alt="" className="size-10" />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 truncate font-medium">
                  {n.name}
                  {!n.active && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
                      <EyeOffIcon className="size-3" /> {t("commerce.categories.hidden")}
                    </span>
                  )}
                </p>
                <p className="truncate font-mono text-meta text-muted-foreground">/{n.slug}</p>
              </div>
              <ModuleLink
                to={`products?categoryId=${n.id}`}
                className="hidden rounded-full bg-muted px-2.5 py-1 text-xs font-medium tabular-nums outline-none hover:bg-primary/10 hover:text-primary focus-visible:ring-2 focus-visible:ring-ring sm:inline-flex"
                aria-label={t("commerce.categories.viewProducts", { name: n.name })}
              >
                {t("commerce.categories.productCount", { count: n.productCount })}
                {total !== n.productCount && <span className="ml-1 text-muted-foreground">· {t("commerce.categories.totalCount", { count: total })}</span>}
              </ModuleLink>
              {canManage && (
                <div className="flex items-center">
                  <Button type="button" variant="ghost" size="icon-sm" className="hidden sm:inline-flex" disabled={i === 0} onClick={() => sort.move(i, -1)} aria-label={t("commerce.categories.moveUp", { name: n.name })}>
                    <ArrowUpIcon />
                  </Button>
                  <Button type="button" variant="ghost" size="icon-sm" className="hidden sm:inline-flex" disabled={i === nodes.length - 1} onClick={() => sort.move(i, 1)} aria-label={t("commerce.categories.moveDown", { name: n.name })}>
                    <ArrowDownIcon />
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label={t("commerce.common.actionsFor", { name: n.name })}>
                        <MoreVerticalIcon />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem className="h-10" onSelect={() => onEdit(n)}>
                        <PencilIcon /> {t("commerce.common.edit")}
                      </DropdownMenuItem>
                      <DropdownMenuItem className="h-10" onSelect={() => onAddChild(n.id)}>
                        <FolderPlusIcon /> {t("commerce.categories.addChild")}
                      </DropdownMenuItem>
                      <DropdownMenuItem className="h-10 sm:hidden" disabled={i === 0} onSelect={() => sort.move(i, -1)}>
                        <ArrowUpIcon /> {t("commerce.categories.up")}
                      </DropdownMenuItem>
                      <DropdownMenuItem className="h-10 sm:hidden" disabled={i === nodes.length - 1} onSelect={() => sort.move(i, 1)}>
                        <ArrowDownIcon /> {t("commerce.categories.down")}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" className="h-10" disabled={!empty} onSelect={() => onDelete(n)}>
                        <Trash2Icon /> {empty ? t("commerce.common.delete") : t("commerce.categories.notEmpty")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )}
            </div>
            <AnimatePresence initial={false}>
              {open && n.children.length > 0 && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18 }} className="overflow-hidden">
                  <Branch
                    nodes={n.children}
                    parentId={n.id}
                    depth={depth + 1}
                    collapsed={collapsed}
                    onToggle={onToggle}
                    canManage={canManage}
                    onReorder={onReorder}
                    onAddChild={onAddChild}
                    onEdit={onEdit}
                    onDelete={onDelete}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </motion.li>
        );
      })}
    </ul>
  );
}

function CategoryDialog({ editing, onClose }: { editing: Editing; onClose: () => void }) {
  const { t } = useI18n();
  const save = useSaveCategory();
  const open = editing !== null;
  const existing = editing?.mode === "edit" ? editing.category : null;
  const [name, setName] = React.useState("");
  const [slug, setSlug] = React.useState("");
  const [parentId, setParentId] = React.useState<string | null>(null);
  const [description, setDescription] = React.useState("");
  const [image, setImage] = React.useState<{ url: string; alt?: string | null }[]>([]);
  const [active, setActive] = React.useState(true);
  const [errors, setErrors] = React.useState<{ name?: string; slug?: string }>({});

  React.useEffect(() => {
    if (!editing) return;
    const c = editing.mode === "edit" ? editing.category : null;
    setName(c?.name ?? "");
    setSlug(c?.slug ?? "");
    setParentId(editing.mode === "new" ? editing.parentId : (c?.parentId ?? null));
    setDescription(c?.description ?? "");
    setImage(c?.imageUrl ? [{ url: c.imageUrl }] : []);
    setActive(c?.active ?? true);
    setErrors({});
  }, [editing]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const next: typeof errors = {};
    if (!name.trim()) next.name = t("commerce.validation.required");
    if (slug.trim() && !SLUG_RE.test(slug.trim())) next.slug = t("commerce.validation.slug");
    setErrors(next);
    if (Object.keys(next).length) return;
    try {
      const body = {
        name: name.trim(),
        slug: slug.trim() || null,
        parentId,
        description: description.trim() || null,
        imageUrl: image[0]?.url ?? null,
        active,
      };
      const c = await save.mutateAsync({ id: existing?.id, body });
      toast.success(existing ? t("commerce.categories.updated", { name: c.name }) : t("commerce.categories.created", { name: c.name }));
      onClose();
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg" closeLabel={t("commerce.common.close")}>
        <DialogHeader>
          <DialogTitle>{existing ? t("commerce.categories.editTitle") : t("commerce.categories.newTitle")}</DialogTitle>
          <DialogDescription>{t("commerce.categories.dialogHint")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <Field id="cat-name" invalid={!!errors.name}>
            <FieldLabel>{t("commerce.categories.name")}</FieldLabel>
            <FieldControl>
              <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
            </FieldControl>
            <FieldError>{errors.name}</FieldError>
          </Field>
          <Field id="cat-parent">
            <FieldLabel>{t("commerce.categories.parent")}</FieldLabel>
            <CategorySelect
              id="cat-parent"
              value={parentId}
              onChange={setParentId}
              exclude={existing?.id}
              allowCreate={false}
              noneLabel={t("commerce.categories.topLevel")}
              className="w-full"
            />
          </Field>
          <Field id="cat-slug" invalid={!!errors.slug}>
            <FieldLabel>{t("commerce.categories.slug")}</FieldLabel>
            <FieldControl>
              <Input
                className="font-mono"
                value={slug}
                placeholder={slugify(name) || undefined}
                onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
              />
            </FieldControl>
            {errors.slug ? <FieldError>{errors.slug}</FieldError> : <FieldHint>{t("commerce.categories.slugHint")}</FieldHint>}
          </Field>
          <Field id="cat-desc">
            <FieldLabel>{t("commerce.categories.description")}</FieldLabel>
            <FieldControl>
              <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
            </FieldControl>
          </Field>
          <div className="grid content-start gap-2">
            <Label>{t("commerce.categories.image")}</Label>
            <ImageManager value={image} onChange={setImage} single />
          </div>
          <Label htmlFor="cat-active" className="flex items-center justify-between gap-4 rounded-xl border px-4 py-3 font-normal">
            <span className="grid gap-0.5">
              <span className="text-sm font-medium">{t("commerce.categories.active")}</span>
              <span className="text-xs text-muted-foreground">{t("commerce.categories.activeHint")}</span>
            </span>
            <Switch id="cat-active" checked={active} onCheckedChange={setActive} />
          </Label>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" size="lg" onClick={onClose} disabled={save.isPending}>
              {t("commerce.common.cancel")}
            </Button>
            <Button type="submit" size="lg" disabled={save.isPending}>
              {save.isPending && <Loader2Icon className="animate-spin" />}
              {existing ? t("commerce.common.save") : t("commerce.categories.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
