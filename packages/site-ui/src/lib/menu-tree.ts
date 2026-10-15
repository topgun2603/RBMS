/**
 * Header/footer menu tree helpers: two levels (top items and their sub-items), immutable updates, conversion to and
 * from the API shape (`menuItemsSchema`), and validation mapped back to item keys. Pure — unit-tested.
 */
import { CMS_LIMITS, menuItemsSchema, type MenuItem, type MenuItemInput, type MenuItemType } from "./content";
import { issueCode } from "./sections";

export interface MenuNode {
  /** Editor key (not stored unless the item came with an `id`). */
  key: string;
  id?: string;
  label: string;
  type: MenuItemType;
  href: string;
  ref: string;
  children: MenuNode[];
}

let seq = 0;
export const newMenuKey = () => `m${Date.now().toString(36).slice(-4)}${(seq++).toString(36)}`;

export const newMenuNode = (patch: Partial<Omit<MenuNode, "key">> = {}, key: string = newMenuKey()): MenuNode => ({
  key,
  label: "",
  type: "url",
  href: "",
  ref: "",
  children: [],
  ...patch,
});

export function fromApi(items: readonly (MenuItem | MenuItemInput)[], key: () => string = newMenuKey): MenuNode[] {
  const one = (i: MenuItem | MenuItemInput, kids: boolean): MenuNode => ({
    key: key(),
    ...(i.id ? { id: i.id } : {}),
    label: i.label ?? "",
    type: i.type ?? "url",
    href: i.href ?? "",
    ref: i.ref ?? "",
    children: kids ? (("children" in i && i.children) || []).map((c) => one(c as MenuItem, false)) : [],
  });
  return items.map((i) => one(i, true));
}

/** API body items; `href` only for links, `ref` only for the other types, children only when there are some. */
export function toApi(nodes: readonly MenuNode[]): MenuItemInput[] {
  const one = (n: MenuNode, top: boolean): MenuItemInput => {
    const base: MenuItemInput = { ...(n.id ? { id: n.id } : {}), label: n.label.trim(), type: n.type };
    if (n.type === "url") {
      if (n.href.trim()) base.href = n.href.trim();
    } else if (n.ref.trim()) base.ref = n.ref.trim();
    if (top && n.children.length) base.children = n.children.map((c) => one(c, false)) as MenuItemInput["children"];
    return base;
  };
  return nodes.map((n) => one(n, true));
}

/** Items counting sub-items (the API allows 40). */
export const countItems = (nodes: readonly MenuNode[]) => nodes.reduce((n, i) => n + 1 + i.children.length, 0);
export const MENU_MAX_ITEMS = CMS_LIMITS.menuItems;
export const MENU_MAX_CHILDREN = CMS_LIMITS.menuChildren;

/** Where a node sits: top-level index, and child index when it is a sub-item. */
export function locate(nodes: readonly MenuNode[], key: string): { top: number; child: number | null } | null {
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]!;
    if (n.key === key) return { top: i, child: null };
    const c = n.children.findIndex((x) => x.key === key);
    if (c >= 0) return { top: i, child: c };
  }
  return null;
}

export function findNode(nodes: readonly MenuNode[], key: string): MenuNode | null {
  const at = locate(nodes, key);
  if (!at) return null;
  const top = nodes[at.top]!;
  return at.child === null ? top : (top.children[at.child] ?? null);
}

const move = <T>(list: readonly T[], from: number, to: number): T[] => {
  const next = [...list];
  if (from < 0 || from >= next.length || to < 0 || to >= next.length || from === to) return next;
  const [it] = next.splice(from, 1);
  next.splice(to, 0, it!);
  return next;
};

export function updateNode(nodes: readonly MenuNode[], key: string, patch: Partial<Omit<MenuNode, "key" | "children">>): MenuNode[] {
  return nodes.map((n) =>
    n.key === key ? { ...n, ...patch } : { ...n, children: n.children.map((c) => (c.key === key ? { ...c, ...patch } : c)) },
  );
}

export function removeNode(nodes: readonly MenuNode[], key: string): MenuNode[] {
  return nodes.filter((n) => n.key !== key).map((n) => ({ ...n, children: n.children.filter((c) => c.key !== key) }));
}

/** Appends at the top level, or as the last sub-item of `parentKey`. */
export function addNode(nodes: readonly MenuNode[], node: MenuNode, parentKey?: string | null): MenuNode[] {
  if (!parentKey) return [...nodes, { ...node, children: node.children }];
  return nodes.map((n) => (n.key === parentKey ? { ...n, children: [...n.children, { ...node, children: [] }] } : n));
}

/** Moves a node up (-1) or down (+1) among its siblings. */
export function moveNode(nodes: readonly MenuNode[], key: string, delta: number): MenuNode[] {
  const at = locate(nodes, key);
  if (!at) return [...nodes];
  if (at.child === null) return move(nodes, at.top, at.top + delta);
  return nodes.map((n, i) => (i === at.top ? { ...n, children: move(n.children, at.child!, at.child! + delta) } : n));
}

/** Drag-and-drop within one sibling list: puts `key` where `overKey` is. Different lists → unchanged. */
export function dropOn(nodes: readonly MenuNode[], key: string, overKey: string): MenuNode[] {
  const a = locate(nodes, key);
  const b = locate(nodes, overKey);
  if (!a || !b || key === overKey) return [...nodes];
  if (a.child === null && b.child === null) return move(nodes, a.top, b.top);
  if (a.child !== null && b.child !== null && a.top === b.top)
    return nodes.map((n, i) => (i === a.top ? { ...n, children: move(n.children, a.child!, b.child!) } : n));
  return [...nodes];
}

/** A top-level item without sub-items can become a sub-item of the item above it. */
export function canIndent(nodes: readonly MenuNode[], key: string): boolean {
  const at = locate(nodes, key);
  if (!at || at.child !== null || at.top === 0) return false;
  const self = nodes[at.top]!;
  const prev = nodes[at.top - 1]!;
  return self.children.length === 0 && prev.children.length < MENU_MAX_CHILDREN;
}

export function indentNode(nodes: readonly MenuNode[], key: string): MenuNode[] {
  if (!canIndent(nodes, key)) return [...nodes];
  const at = locate(nodes, key)!;
  const self = nodes[at.top]!;
  const out = nodes.filter((_, i) => i !== at.top);
  const parent = out[at.top - 1]!;
  out[at.top - 1] = { ...parent, children: [...parent.children, { ...self, children: [] }] };
  return out;
}

export const canOutdent = (nodes: readonly MenuNode[], key: string) => locate(nodes, key)?.child != null;

/** A sub-item moves out to the top level, right after its parent (later siblings stay under the parent). */
export function outdentNode(nodes: readonly MenuNode[], key: string): MenuNode[] {
  const at = locate(nodes, key);
  if (!at || at.child === null) return [...nodes];
  const parent = nodes[at.top]!;
  const self = parent.children[at.child]!;
  const out = [...nodes];
  out[at.top] = { ...parent, children: parent.children.filter((c) => c.key !== key) };
  out.splice(at.top + 1, 0, { ...self, children: [] });
  return out;
}

/** Validation with the cms schema; errors keyed by node key → field ("label", "href", "ref") → reason code. */
export function validateMenu(nodes: readonly MenuNode[]): { ok: boolean; errors: Record<string, Record<string, string>>; tooMany: boolean } {
  const r = menuItemsSchema.safeParse(toApi(nodes));
  const errors: Record<string, Record<string, string>> = {};
  let tooMany = false;
  if (!r.success) {
    for (const issue of r.error.issues) {
      const [top, k1, child, k2] = issue.path;
      if (typeof top !== "number") {
        tooMany = true;
        continue;
      }
      const t = nodes[top];
      if (!t) continue;
      let node = t;
      let field = String(k1 ?? "_");
      if (k1 === "children" && typeof child === "number") {
        const c = t.children[child];
        if (!c) {
          tooMany = true;
          continue;
        }
        node = c;
        field = String(k2 ?? "_");
      }
      const e = (errors[node.key] ??= {});
      if (!e[field]) e[field] = issueCode(issue);
    }
  }
  return { ok: r.success, errors, tooMany };
}

/** Storefront address an item will open (for the editor's hint line). */
export function nodeHref(n: Pick<MenuNode, "type" | "href" | "ref">): string | null {
  const ref = n.ref.trim();
  switch (n.type) {
    case "url":
      return n.href.trim() || null;
    case "page":
      return ref ? `/${ref}` : null;
    case "post":
      return ref ? `/blog/${ref}` : null;
    case "category":
      return ref ? `/c/${ref}` : null;
    case "collection":
      return ref ? `/collections/${ref}` : null;
  }
}
