import type { Category, CategoryNode } from "./types";

/** Builds the tree from the flat list (siblings by `sort`, then name). Orphans (missing parent) become roots. */
export function buildTree(flat: readonly Category[]): CategoryNode[] {
  const nodes = new Map<string, CategoryNode>(flat.map((c) => [c.id, { ...c, children: [] }]));
  const roots: CategoryNode[] = [];
  for (const n of nodes.values()) {
    const parent = n.parentId ? nodes.get(n.parentId) : undefined;
    if (parent) parent.children.push(n);
    else roots.push(n);
  }
  const sort = (list: CategoryNode[]) => {
    list.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
    for (const n of list) sort(n.children);
  };
  sort(roots);
  return roots;
}

export interface FlatCategory extends Category {
  depth: number;
  /** "Women › Sarees" */
  path: string;
  hasChildren: boolean;
}

/** Depth-first order with depth and a breadcrumb path (pickers, the categories page). */
export function flattenTree(tree: readonly CategoryNode[], depth = 0, prefix = ""): FlatCategory[] {
  const out: FlatCategory[] = [];
  for (const n of tree) {
    const path = prefix ? `${prefix} › ${n.name}` : n.name;
    const { children, ...rest } = n;
    out.push({ ...rest, depth, path, hasChildren: children.length > 0 });
    out.push(...flattenTree(children, depth + 1, path));
  }
  return out;
}

/** `id` and every category below it. */
export function subtreeIds(flat: readonly Category[], id: string): Set<string> {
  const out = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of flat) {
      if (c.parentId && out.has(c.parentId) && !out.has(c.id)) {
        out.add(c.id);
        grew = true;
      }
    }
  }
  return out;
}

/** Products in a category and all of its subcategories. */
export function totalProducts(node: CategoryNode): number {
  return node.productCount + node.children.reduce((n, c) => n + totalProducts(c), 0);
}
