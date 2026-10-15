import { describe, expect, it } from "vitest";
import { menuItemsSchema } from "./content";
import { MENU_FIXTURE } from "./fixtures";
import {
  addNode,
  canIndent,
  canOutdent,
  countItems,
  dropOn,
  findNode,
  fromApi,
  indentNode,
  locate,
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
} from "./menu-tree";

const keys = () => {
  let i = 0;
  return () => `k${i++}`;
};
const tree = () => fromApi(MENU_FIXTURE, keys());
const labels = (nodes: MenuNode[]) => nodes.map((n) => (n.children.length ? `${n.label}[${n.children.map((c) => c.label).join(",")}]` : n.label));

describe("menu tree ↔ API", () => {
  it("round-trips the API shape", () => {
    expect(menuItemsSchema.parse(toApi(tree()))).toEqual(menuItemsSchema.parse(MENU_FIXTURE));
  });

  it("sends href only for links and ref only for the other types", () => {
    const n = [newMenuNode({ label: "A", type: "page", href: "/leftover", ref: "about" }, "a"), newMenuNode({ label: "B", type: "url", href: "/b", ref: "x" }, "b")];
    expect(toApi(n)).toEqual([
      { label: "A", type: "page", ref: "about" },
      { label: "B", type: "url", href: "/b" },
    ]);
  });

  it("counts sub-items", () => {
    expect(countItems(tree())).toBe(6);
  });
});

describe("tree edits", () => {
  it("moves within siblings, top level and sub-items", () => {
    const t = tree();
    expect(labels(moveNode(t, "k0", 1))).toEqual(["Shop[Sarees,New]", "Home", "About", "Blog post"]);
    const sareesKey = t[1]!.children[0]!.key;
    expect(labels(moveNode(t, sareesKey, 1))).toEqual(["Home", "Shop[New,Sarees]", "About", "Blog post"]);
    // out of range: unchanged
    expect(labels(moveNode(t, "k0", -1))).toEqual(labels(t));
  });

  it("drag-and-drop reorders within one list only", () => {
    const t = tree();
    expect(labels(dropOn(t, t[3]!.key, t[0]!.key))).toEqual(["Blog post", "Home", "Shop[Sarees,New]", "About"]);
    const [a, b] = t[1]!.children;
    expect(labels(dropOn(t, b!.key, a!.key))).toEqual(["Home", "Shop[New,Sarees]", "About", "Blog post"]);
    // a sub-item can't be dropped among top-level items
    expect(labels(dropOn(t, a!.key, t[0]!.key))).toEqual(labels(t));
  });

  it("indents a top item under the one above, and outdents it right after its parent", () => {
    const t = tree();
    const about = t[2]!.key;
    expect(canIndent(t, about)).toBe(true);
    const ind = indentNode(t, about);
    expect(labels(ind)).toEqual(["Home", "Shop[Sarees,New,About]", "Blog post"]);
    expect(canOutdent(ind, about)).toBe(true);
    const sareesKey = ind[1]!.children[0]!.key;
    const out = outdentNode(ind, sareesKey);
    expect(labels(out)).toEqual(["Home", "Shop[New,About]", "Sarees", "Blog post"]);
  });

  it("never nests deeper than two levels", () => {
    const t = tree();
    expect(canIndent(t, t[0]!.key)).toBe(false); // first item has nothing above
    expect(canIndent(t, t[1]!.key)).toBe(false); // has children of its own
    expect(canIndent(t, t[1]!.children[0]!.key)).toBe(false); // already a sub-item
    expect(labels(indentNode(t, t[1]!.key))).toEqual(labels(t));
    expect(canOutdent(t, t[0]!.key)).toBe(false);
  });

  it("adds, updates, finds and removes", () => {
    let t = tree();
    t = addNode(t, newMenuNode({ label: "Contact", href: "/contact" }, "new"));
    t = addNode(t, newMenuNode({ label: "Silk" }, "sub"), t[1]!.key);
    expect(labels(t)).toEqual(["Home", "Shop[Sarees,New,Silk]", "About", "Blog post", "Contact"]);
    t = updateNode(t, "sub", { label: "Silk sarees" });
    expect(findNode(t, "sub")?.label).toBe("Silk sarees");
    expect(locate(t, "sub")).toEqual({ top: 1, child: 2 });
    t = removeNode(t, "sub");
    t = removeNode(t, "new");
    expect(labels(t)).toEqual(labels(tree()));
  });
});

describe("validation", () => {
  it("passes the fixture", () => {
    expect(validateMenu(tree()).ok).toBe(true);
  });

  it("maps errors back to items and fields", () => {
    const t = [
      newMenuNode({ label: "", type: "url", href: "/x" }, "a"),
      newMenuNode({ label: "Page", type: "page" }, "b"),
      newMenuNode({ label: "Bad link", type: "url", href: "javascript:alert(1)" }, "c"),
      newMenuNode({ label: "Parent", type: "url", children: [newMenuNode({ label: "Kid", type: "category" }, "d")] }, "p"),
    ];
    const v = validateMenu(t);
    expect(v.ok).toBe(false);
    expect(v.errors.a?.label).toBe("required");
    expect(v.errors.b?.ref).toBeTruthy();
    expect(v.errors.c?.href).toBe("url");
    expect(v.errors.d?.ref).toBeTruthy();
    // a link-less parent with children is fine
    expect(v.errors.p).toBeUndefined();
  });

  it("flags menus over the 40-item limit", () => {
    const many = Array.from({ length: 21 }, (_, i) =>
      newMenuNode({ label: `T${i}`, href: "/", children: i < 20 ? [newMenuNode({ label: `C${i}`, href: "/" }, `c${i}`)] : [] }, `t${i}`),
    );
    expect(countItems(many)).toBeGreaterThan(MENU_MAX_ITEMS);
    const v = validateMenu(many);
    expect(v.ok).toBe(false);
    expect(v.tooMany).toBe(true);
  });

  it("shows the storefront address of each item type", () => {
    expect(nodeHref({ type: "page", href: "", ref: "about" })).toBe("/about");
    expect(nodeHref({ type: "post", href: "", ref: "tips" })).toBe("/blog/tips");
    expect(nodeHref({ type: "category", href: "", ref: "sarees" })).toBe("/c/sarees");
    expect(nodeHref({ type: "collection", href: "", ref: "new" })).toBe("/collections/new");
    expect(nodeHref({ type: "url", href: " /x ", ref: "" })).toBe("/x");
    expect(nodeHref({ type: "page", href: "", ref: "" })).toBeNull();
  });
});
