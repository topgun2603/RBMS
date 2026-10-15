import { describe, expect, it, vi } from "vitest";
import type { Kit } from "./kit";
import { garmentKind, initials, paletteFor, placeholderAction, placeholderFileId, placeholderSvg, PLACEHOLDER_VERSION, seedProductImages } from "./seed-images";

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const ph = (v = PLACEHOLDER_VERSION) => `http://localhost:4000/v1/uploads/files/t/x/demo-placeholder/2026/10/${ID}-anarkali-kurti-ph${v}.webp`;

describe("placeholder art", () => {
  it("picks a garment icon from the name, then the category", () => {
    expect(garmentKind("Silk Saree (Kanchipuram)")).toBe("saree");
    expect(garmentKind("Anarkali Kurti")).toBe("dress");
    expect(garmentKind("Kurti (cotton)")).toBe("kurta");
    expect(garmentKind("Cotton Palazzo")).toBe("bottoms");
    expect(garmentKind("Readymade shirt")).toBe("shirt");
    expect(garmentKind("Silk dupatta")).toBe("dupatta");
    expect(garmentKind("Festive special", "Sarees")).toBe("saree");
    expect(garmentKind("Gift card")).toBe("generic");
  });

  it("is stable per product and escapes text", () => {
    expect(paletteFor("Anarkali Kurti")).toEqual(paletteFor(" anarkali kurti "));
    expect(initials("Silk Saree (Kanchipuram)")).toBe("SS");
    expect(initials("Kurti (cotton)")).toBe("K");
    const svg = placeholderSvg('Tom & "Jerry" <b>', null, "Anbu Fashions");
    expect(svg).toContain("Tom &amp; &quot;Jerry&quot; &lt;b&gt;");
    expect(svg).not.toContain("<b>");
    expect(svg).toContain("ANBU FASHIONS");
  });
});

describe("placeholder idempotency rules", () => {
  it("recognises its own files only", () => {
    expect(placeholderFileId(ph())).toBe(ID);
    expect(placeholderFileId(`http://localhost:4000/v1/uploads/files/t/x/product/2026/10/${ID}-photo.jpg`)).toBeNull();
    expect(placeholderFileId("https://cdn.example.com/kurti.jpg")).toBeNull();
  });

  it("adds when empty, keeps owners' pictures and current placeholders, redraws old ones", () => {
    expect(placeholderAction([])).toBe("add");
    expect(placeholderAction([{ url: ph() }])).toBe("keep");
    expect(placeholderAction([{ url: "https://cdn.example.com/kurti.jpg" }])).toBe("keep");
    expect(placeholderAction([{ url: ph(0) }, { url: "https://cdn.example.com/kurti.jpg" }])).toBe("keep");
    expect(placeholderAction([{ url: ph(0) }])).toBe("replace");
  });
});

describe("seedProductImages", () => {
  function fakeKit(products: { id: string; name: string; images: { url: string }[] }[]) {
    const byId = new Map(products.map((p) => [p.id, { ...p, categoryId: null }]));
    let n = 0;
    const kit = {
      catalogue: {
        service: {
          listCategories: vi.fn(async () => ({ items: [] })),
          listProducts: vi.fn(async () => ({ items: [...byId.values()].map(({ id, name }) => ({ id, name })) })),
          getProduct: vi.fn(async (_t: string, id: string) => byId.get(id)),
          updateProduct: vi.fn(async (_t: string, id: string, patch: { images: { url: string }[] }) => {
            byId.get(id)!.images = patch.images;
          }),
        },
      },
      uploads: {
        service: {
          storeGenerated: vi.fn(async (input: { filename: string; contentType: string; body: Buffer }) => ({
            url: `http://localhost:4000/v1/uploads/files/t/x/demo-placeholder/2026/10/${ID.slice(0, -1)}${n++}-${input.filename}`,
          })),
          remove: vi.fn(async () => undefined),
        },
      },
    };
    return { kit, byId };
  }
  const log = { info: () => undefined } as never;

  it("fills only products without pictures, once", async () => {
    const { kit, byId } = fakeKit([
      { id: "p1", name: "Anarkali Kurti", images: [] },
      { id: "p2", name: "Cotton Palazzo", images: [{ url: "https://cdn.example.com/own.jpg" }] },
      { id: "p3", name: "Not a demo product", images: [] },
    ]);
    const names = ["Anarkali Kurti", "Cotton Palazzo"];
    expect(await seedProductImages(kit as unknown as Kit, "t", log, "test", { names })).toBe(1);
    const stored = kit.uploads.service.storeGenerated.mock.calls[0]![0];
    expect(stored).toMatchObject({ contentType: "image/webp", visibility: "public", purpose: "demo-placeholder", filename: `anarkali-kurti-ph${PLACEHOLDER_VERSION}.webp` });
    expect(byId.get("p1")!.images).toHaveLength(1);
    expect(byId.get("p2")!.images).toEqual([{ url: "https://cdn.example.com/own.jpg" }]);
    expect(byId.get("p3")!.images).toEqual([]);
    // re-run: nothing new
    expect(await seedProductImages(kit as unknown as Kit, "t", log, "test", { names })).toBe(0);
    expect(kit.uploads.service.storeGenerated).toHaveBeenCalledTimes(1);
  });

  it("redraws an older placeholder and removes its file", async () => {
    const { kit, byId } = fakeKit([{ id: "p1", name: "Anarkali Kurti", images: [{ url: ph(0) }] }]);
    expect(await seedProductImages(kit as unknown as Kit, "t", log, "test")).toBe(1);
    expect(kit.uploads.service.remove).toHaveBeenCalledWith(ID, "t");
    expect(byId.get("p1")!.images[0]!.url).toMatch(new RegExp(`-ph${PLACEHOLDER_VERSION}\.webp$`));
  });
});
