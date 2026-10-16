"use client";

import * as React from "react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  CornerDownRightIcon,
  ExternalLinkIcon,
  GripVerticalIcon,
  IndentIcon,
  MenuIcon,
  OutdentIcon,
  PanelBottomIcon,
  PanelTopIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import {
  AnimatePresence,
  Button,
  Card,
  ChipGroup,
  cn,
  Input,
  Label,
  motion,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  toast,
} from "@srirealtime/ui";
import { describeError, Page, PageHeading, QueryError, useFeature, useI18n } from "@srirealtime/web";
import { FieldError, ReadOnlyNote, SaveBar } from "../components/bits";
import { SlugSelect } from "../components/pickers";
import { useUnsavedGuard } from "../components/unsaved-guard";
import { PERMS, useCan } from "../lib/access";
import { MENU_ITEM_TYPES, type MenuItemType, type MenuKey } from "../lib/content";
import {
  addNode,
  canIndent,
  canOutdent,
  countItems,
  dropOn,
  fromApi,
  indentNode,
  MENU_MAX_CHILDREN,
  MENU_MAX_ITEMS,
  moveNode,
  newMenuNode,
  nodeHref,
  outdentNode,
  removeNode,
  toApi,
  updateNode,
  validateMenu,
  type MenuNode,
} from "../lib/menu-tree";
import { useMenu, useSaveMenu } from "../lib/queries";
import { useStoreUrl } from "../lib/store-url";
import type { StaffMenu } from "../lib/types";

export default function MenusPage() {
  const { t } = useI18n();
  const [tab, setTab] = React.useState<MenuKey>("header");
  const [dirty, setDirty] = React.useState<Record<MenuKey, boolean>>({ header: false, footer: false });
  const guard = useUnsavedGuard(dirty.header || dirty.footer);
  const onDirty = React.useCallback((key: MenuKey, d: boolean) => setDirty((x) => (x[key] === d ? x : { ...x, [key]: d })), []);
  const canEdit = useCan(PERMS.cms);

  return (
    <Page className="pb-0">
      <PageHeading icon={MenuIcon} title={t("site.menus.title")} description={t("site.menus.subtitle")} />
      {!canEdit && <ReadOnlyNote>{t("site.common.readOnlyCms")}</ReadOnlyNote>}
      <ChipGroup<MenuKey>
        className="mb-4"
        value={tab}
        onChange={setTab}
        aria-label={t("site.menus.which")}
        options={[
          { value: "header", label: <><PanelTopIcon className="size-4" /> {t("site.menus.header")}</>, meta: dirty.header ? "•" : undefined },
          { value: "footer", label: <><PanelBottomIcon className="size-4" /> {t("site.menus.footer")}</>, meta: dirty.footer ? "•" : undefined },
        ]}
      />
      {(["header", "footer"] as const).map((key) => (
        <div key={key} hidden={tab !== key}>
          <MenuLoader menuKey={key} onDirty={onDirty} canEdit={canEdit} />
        </div>
      ))}
      {guard.dialog}
    </Page>
  );
}

function MenuLoader({ menuKey, onDirty, canEdit }: { menuKey: MenuKey; onDirty: (k: MenuKey, d: boolean) => void; canEdit: boolean }) {
  const q = useMenu(menuKey);
  if (q.isError) return <QueryError error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data)
    return (
      <div className="grid gap-3">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-20 w-full rounded-xl" />
        ))}
      </div>
    );
  return <MenuEditor menu={q.data} onDirty={onDirty} canEdit={canEdit} />;
}

function MenuEditor({ menu, onDirty, canEdit }: { menu: StaffMenu; onDirty: (k: MenuKey, d: boolean) => void; canEdit: boolean }) {
  const { t } = useI18n();
  const save = useSaveMenu();
  const storeUrl = useStoreUrl();
  const [nodes, setNodes] = React.useState<MenuNode[]>(() => fromApi(menu.items));
  const [baseline, setBaseline] = React.useState(() => JSON.stringify(toApi(fromApi(menu.items))));
  const [showErrors, setShowErrors] = React.useState(false);
  const [drag, setDrag] = React.useState<{ key: string; over: string | null } | null>(null);
  const [armed, setArmed] = React.useState<string | null>(null);
  const dirty = JSON.stringify(toApi(nodes)) !== baseline;
  React.useEffect(() => onDirty(menu.key, dirty), [dirty, menu.key, onDirty]);

  const v = React.useMemo(() => validateMenu(nodes), [nodes]);
  const count = countItems(nodes);
  const full = count >= MENU_MAX_ITEMS;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!v.ok) {
      setShowErrors(true);
      toast.error(v.tooMany ? t("site.menus.tooMany", { max: MENU_MAX_ITEMS }) : t("site.editor.fixErrors", { count: Object.keys(v.errors).length }));
      return;
    }
    try {
      const saved = await save.mutateAsync({ key: menu.key, items: toApi(nodes) });
      const next = fromApi(saved.items);
      setNodes(next);
      setBaseline(JSON.stringify(toApi(next)));
      setShowErrors(false);
      toast.success(t("site.menus.saved"));
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  const row = (n: MenuNode, index: number, siblings: number, parent: MenuNode | null) => {
    const errs = showErrors ? (v.errors[n.key] ?? {}) : {};
    const target = nodeHref(n);
    return (
      <motion.li key={n.key} layout transition={{ duration: 0.16 }} className={cn(parent && "ml-6 sm:ml-10")}>
        <div
          draggable={canEdit && armed === n.key}
          onDragStart={(e) => {
            setDrag({ key: n.key, over: null });
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", n.key);
          }}
          onDragOver={(e) => {
            if (!drag) return;
            e.preventDefault();
            if (drag.over !== n.key) setDrag({ ...drag, over: n.key });
          }}
          onDrop={(e) => {
            e.preventDefault();
            if (drag && drag.key !== n.key) setNodes((x) => dropOn(x, drag.key, n.key));
            setDrag(null);
          }}
          onDragEnd={() => {
            setDrag(null);
            setArmed(null);
          }}
          className={cn(
            "rounded-xl border bg-card shadow-xs transition-[opacity,box-shadow]",
            drag?.key === n.key && "opacity-40",
            drag && drag.over === n.key && drag.key !== n.key && "ring-2 ring-primary/50",
            Object.keys(errs).length > 0 && "border-destructive/50",
          )}
        >
          <div className="flex items-center gap-1 border-b border-border/60 px-2 py-1" onPointerDown={() => canEdit && setArmed(n.key)} onPointerUp={() => setArmed(null)}>
            <GripVerticalIcon className={cn("size-4 shrink-0 text-muted-foreground", canEdit && "cursor-grab")} aria-hidden />
            {parent && <CornerDownRightIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              {target ? <span className="font-mono">{target}</span> : n.children.length ? t("site.menus.dropdownOnly") : t("site.menus.noTarget")}
            </span>
            {canEdit && (
              <>
                <Button type="button" variant="ghost" size="icon-sm" disabled={index === 0} onClick={() => setNodes((x) => moveNode(x, n.key, -1))} aria-label={t("site.common.moveUp")}>
                  <ArrowUpIcon />
                </Button>
                <Button type="button" variant="ghost" size="icon-sm" disabled={index === siblings - 1} onClick={() => setNodes((x) => moveNode(x, n.key, 1))} aria-label={t("site.common.moveDown")}>
                  <ArrowDownIcon />
                </Button>
                {parent ? (
                  <Button type="button" variant="ghost" size="icon-sm" disabled={!canOutdent(nodes, n.key)} onClick={() => setNodes((x) => outdentNode(x, n.key))} aria-label={t("site.menus.outdent")} title={t("site.menus.outdent")}>
                    <OutdentIcon />
                  </Button>
                ) : (
                  <Button type="button" variant="ghost" size="icon-sm" disabled={!canIndent(nodes, n.key)} onClick={() => setNodes((x) => indentNode(x, n.key))} aria-label={t("site.menus.indent")} title={t("site.menus.indent")}>
                    <IndentIcon />
                  </Button>
                )}
                <Button type="button" variant="ghost" size="icon-sm" className="text-destructive" onClick={() => setNodes((x) => removeNode(x, n.key))} aria-label={t("site.common.removeNamed", { name: n.label || t("site.menus.item") })}>
                  <Trash2Icon />
                </Button>
              </>
            )}
          </div>
          <div className="grid items-start gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_10rem_minmax(0,1.2fr)]">
            <div className="grid content-start gap-1">
              <Label htmlFor={`mi-${n.key}-label`} className="text-xs">
                {t("site.menus.label")}
              </Label>
              <Input id={`mi-${n.key}-label`} value={n.label} maxLength={60} disabled={!canEdit} aria-invalid={!!errs.label} aria-describedby={errs.label ? `mi-${n.key}-label-err` : undefined} onChange={(e) => setNodes((x) => updateNode(x, n.key, { label: e.target.value }))} />
              <FieldError code={errs.label} id={`mi-${n.key}-label-err`} />
            </div>
            <div className="grid content-start gap-1">
              <Label htmlFor={`mi-${n.key}-type`} className="text-xs">
                {t("site.menus.type")}
              </Label>
              <TypeSelect id={`mi-${n.key}-type`} value={n.type} disabled={!canEdit} onChange={(type) => setNodes((x) => updateNode(x, n.key, { type }))} />
            </div>
            <div className="grid content-start gap-1">
              <Label htmlFor={`mi-${n.key}-target`} className="text-xs">
                {t(`site.menus.target.${n.type}`)}
              </Label>
              {n.type === "url" ? (
                <>
                  <Input id={`mi-${n.key}-target`} value={n.href} placeholder="/products" disabled={!canEdit} aria-invalid={!!errs.href} aria-describedby={`mi-${n.key}-target-help`} onChange={(e) => setNodes((x) => updateNode(x, n.key, { href: e.target.value }))} />
                  {errs.href ? <FieldError code={errs.href} id={`mi-${n.key}-target-help`} /> : <p id={`mi-${n.key}-target-help`} className="text-[0.6875rem] text-muted-foreground">{t("site.common.linkHint")}</p>}
                </>
              ) : (
                <>
                  <SlugSelect
                    id={`mi-${n.key}-target`}
                    type={n.type}
                    value={n.ref}
                    invalid={!!errs.ref}
                    disabled={!canEdit}
                    onChange={(ref, label) => setNodes((x) => updateNode(x, n.key, { ref, ...(n.label.trim() ? {} : { label: label.slice(0, 60) }) }))}
                  />
                  <FieldError code={errs.ref ? `site.menus.pickTarget` : null} />
                </>
              )}
            </div>
          </div>
        </div>
        {!parent && (n.children.length > 0 || canEdit) && (
          <ol className="mt-2 grid gap-2">
            {n.children.map((c, j) => row(c, j, n.children.length, n))}
            {canEdit && (
              <li className="ml-6 sm:ml-10">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  disabled={full || n.children.length >= MENU_MAX_CHILDREN}
                  onClick={() => setNodes((x) => addNode(x, newMenuNode(), n.key))}
                >
                  <PlusIcon /> {t("site.menus.addSub", { name: n.label || t("site.menus.item") })}
                </Button>
              </li>
            )}
          </ol>
        )}
      </motion.li>
    );
  };

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <MenuStrip nodes={nodes} footer={menu.key === "footer"} />
      {nodes.length === 0 ? (
        <Card className="items-center gap-2 p-8 text-center">
          <MenuIcon className="size-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{t(menu.key === "header" ? "site.menus.emptyHeader" : "site.menus.emptyFooter")}</p>
        </Card>
      ) : (
        <ol className="grid gap-2">
          <AnimatePresence initial={false}>{nodes.map((n, i) => row(n, i, nodes.length, null))}</AnimatePresence>
        </ol>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {canEdit && (
          <Button type="button" variant="outline" size="lg" className="border-dashed" disabled={full} onClick={() => setNodes((x) => addNode(x, newMenuNode()))}>
            <PlusIcon /> {t("site.menus.add")}
          </Button>
        )}
        <p className={cn("text-xs", full ? "text-warning-ink" : "text-muted-foreground")}>{t("site.menus.count", { n: count, max: MENU_MAX_ITEMS })}</p>
      </div>
      <p className="text-meta text-muted-foreground">{t("site.menus.nestHint")}</p>
      {storeUrl && (
        <a href={storeUrl("/")} target="_blank" rel="noreferrer" className="inline-flex w-fit items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline">
          <ExternalLinkIcon className="size-4" /> {t("site.common.viewStore")}
        </a>
      )}
      {canEdit && <SaveBar dirty={dirty} saving={save.isPending} onDiscard={() => setNodes(fromApi(menu.items))} saveLabel={t("site.menus.save")} />}
    </form>
  );
}

function TypeSelect({ id, value, onChange, disabled }: { id: string; value: MenuItemType; onChange: (v: MenuItemType) => void; disabled?: boolean }) {
  const { t } = useI18n();
  const blog = useFeature("cms.blog");
  return (
    <Select value={value} onValueChange={(v) => onChange(v as MenuItemType)} disabled={disabled}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {MENU_ITEM_TYPES.filter((ty) => ty !== "post" || blog || value === "post").map((ty) => (
          <SelectItem key={ty} value={ty}>
            {t(`site.menus.types.${ty}`)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** What the menu will look like: a header bar with dropdown markers, or footer columns. */
function MenuStrip({ nodes, footer }: { nodes: MenuNode[]; footer: boolean }) {
  const { t } = useI18n();
  if (!nodes.length) return null;
  return (
    <div className="rounded-xl border bg-muted/30 p-3" aria-label={t("site.menus.previewLabel")}>
      <p className="mb-2 text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase">{t("site.menus.previewLabel")}</p>
      {footer ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {nodes.map((n) => (
            <div key={n.key} className="grid content-start gap-1 text-sm">
              <span className="font-semibold">{n.label || "…"}</span>
              {n.children.map((c) => (
                <span key={c.key} className="text-muted-foreground">
                  {c.label || "…"}
                </span>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm font-medium">
          {nodes.map((n) => (
            <span key={n.key} className="inline-flex items-center gap-1">
              {n.label || "…"}
              {n.children.length > 0 && <ChevronDownIcon className="size-3.5 text-muted-foreground" />}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
