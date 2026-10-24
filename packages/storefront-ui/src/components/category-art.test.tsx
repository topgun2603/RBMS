import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CATEGORY_ICONS, CategoryArt, categoryIconKey, type CategoryIconKey } from "./category-art";

/** The trades added with stores #7–#10 of the series (footwear, stationery, toys, cosmetics), English and Tamil names. */
describe("category art for footwear, stationery, toys and beauty", () => {
  it.each<[string, string, CategoryIconKey]>([
    // footwear
    ["Shoes", "shoes", "shoe"],
    ["Sandals", "sandals", "sandal"],
    ["Chappals", "chappals", "sandal"],
    ["Slippers", "slippers", "sandal"],
    ["School shoes", "school-shoes", "shoe"],
    ["Sports shoes", "sports-shoes", "shoe"],
    ["Formal shoes", "formal-shoes", "shoe"],
    ["Heels", "heels", "heels"],
    ["Footwear", "footwear", "footwear"],
    // stationery
    ["Notebooks", "notebooks", "notebook"],
    ["Pens", "pens", "pen"],
    ["Pencils", "pencils", "pencil"],
    ["School supplies", "school-supplies", "backpack"],
    ["Office supplies", "office-supplies", "office"],
    ["Art & craft", "art-craft", "art"],
    ["Books", "books", "books"],
    ["Exam guides", "exam-guides", "exam"],
    // toys
    ["Toys", "toys", "toys"],
    ["Games", "games", "boardGame"],
    ["Puzzles", "puzzles", "puzzle"],
    ["Soft toys", "soft-toys", "softToy"],
    ["Ride-ons", "ride-ons", "rideOn"],
    ["Dolls", "dolls", "doll"],
    ["Blocks", "blocks", "blocks"],
    ["Outdoor", "outdoor", "outdoor"],
    // beauty
    ["Skin care", "skin-care", "skin"],
    ["Hair care", "hair-care", "hairCare"],
    ["Makeup", "makeup", "makeup"],
    ["Lipstick", "lipstick", "lipstick"],
    ["Fragrance", "fragrance", "fragrance"],
    ["Perfume", "perfume", "fragrance"],
    ["Grooming", "grooming", "grooming"],
    ["Men's grooming", "mens-grooming", "grooming"],
    ["Bath & body", "bath-body", "bathBody"],
    // Tamil names
    ["காலணிகள்", "", "footwear"],
    ["செருப்புகள்", "", "sandal"],
    ["நோட்டுப் புத்தகங்கள்", "", "notebook"],
    ["பேனாக்கள்", "", "pen"],
    ["பொம்மைகள்", "", "toys"],
    ["புதிர்கள்", "", "puzzle"],
    ["சரும பராமரிப்பு", "", "skin"],
    ["கூந்தல் பராமரிப்பு", "", "hairCare"],
    ["வாசனைத் திரவியங்கள்", "", "fragrance"],
    ["மேக்கப்", "", "makeup"],
  ])("%s → %s", (name, slug, key) => {
    expect(categoryIconKey(name, slug)).toBe(key);
  });

  it("keeps the older trades' icons where the new words could clash", () => {
    expect(categoryIconKey("Hair", "hair")).toBe("hair");
    expect(categoryIconKey("Laptops", "laptops")).toBe("laptop");
    expect(categoryIconKey("Video games", "video-games")).toBe("gaming");
    expect(categoryIconKey("Bath & sanitary", "bath-sanitary")).toBe("plumbing");
    expect(categoryIconKey("Air conditioners", "air-conditioners")).toBe("fridge");
    expect(categoryIconKey("Water pumps", "water-pumps")).not.toBe("heels");
    expect(categoryIconKey("Combo meals", "combo-meals")).toBe("meal");
    expect(categoryIconKey("Kurtis", "kurtis")).toBe("shirt");
    // A name alone (no slug) works too, and "outdoor" furniture or lights stay out of the toy rule.
    expect(categoryIconKey("Outdoor")).toBe("outdoor");
    expect(categoryIconKey("Outdoor furniture", "outdoor-furniture")).toBe("furniture");
    expect(categoryIconKey("Blocks")).toBe("blocks");
    expect(categoryIconKey("Games")).toBe("boardGame");
  });

  it("draws every new key as an inline icon on the brand tint", () => {
    for (const key of ["shoe", "heels", "sandal", "notebook", "pen", "pencil", "office", "art", "exam", "softToy", "doll", "puzzle", "boardGame", "blocks", "rideOn", "outdoor", "lipstick", "fragrance", "hairCare", "grooming", "bathBody"] as const) {
      expect(CATEGORY_ICONS[key], key).toBeTruthy();
    }
    const out = renderToStaticMarkup(<CategoryArt name="Lipstick" slug="lipstick" image={null} tone={2} />);
    expect(out).toContain('data-cat-icon="lipstick"');
    expect(out).toContain("<svg");
  });
});

/** The nine packs added after the stores series: their starter categories (English and Tamil) get a trade icon. */
describe("category art for crackers, florist & pooja, phone accessories, furniture, décor, pets, sports, tea and spa", () => {
  it.each<[string, CategoryIconKey]>([
    ["Sparklers", "crackers"],
    ["Flower pots & chakkars", "crackers"],
    ["Rockets & sky shots", "rocket"],
    ["Sound crackers", "crackers"],
    ["Kids' crackers", "crackers"],
    ["Gift boxes", "gift"],
    ["Loose flowers", "flowers"],
    ["Jasmine strings", "flowers"],
    ["Wedding garlands", "flowers"],
    ["Pooja items", "pooja"],
    ["Temple offerings", "pooja"],
    ["Lamps & diyas", "pooja"],
    ["Cases & covers", "phone"],
    ["Screen guards", "phone"],
    ["Earphones & neckbands", "audio"],
    ["Power banks", "charger"],
    ["Smartwatches", "watch"],
    ["Car & bike mounts", "phone"],
    ["Sofas", "sofa"],
    ["Beds & mattresses", "bed"],
    ["Wardrobes", "furniture"],
    ["Dining sets", "furniture"],
    ["Office chairs & desks", "furniture"],
    ["Kids' furniture", "furniture"],
    ["Brass & lamps", "pooja"],
    ["Wall art & frames", "wallArt"],
    ["Handicrafts", "art"],
    ["Return gifts", "gift"],
    ["Dog food", "dog"],
    ["Cat food", "cat"],
    ["Treats & chews", "petTreat"],
    ["Toys & leashes", "pets"],
    ["Beds & carriers", "pets"],
    ["Pet grooming", "pets"],
    ["Birds & fish", "bird"],
    ["Cricket", "sport"],
    ["Badminton", "sport"],
    ["Football", "sport"],
    ["Fitness equipment", "gym"],
    ["Sportswear", "shirt"],
    ["Sports shoes", "shoe"],
    ["Team kits & trophies", "trophy"],
    ["Tea & coffee", "coffee"],
    ["Fresh juices", "drink"],
    ["Combos", "meal"],
    ["Massages", "spa"],
    ["Body scrubs & wraps", "spa"],
    ["Foot reflexology", "spa"],
    ["Couple packages", "spa"],
    ["Facials", "skin"],
    // Tamil names
    ["பட்டாசுகள்", "crackers"],
    ["மத்தாப்பு", "crackers"],
    ["பூஜைப் பொருட்கள்", "pooja"],
    ["மல்லிகை", "flowers"],
    ["கட்டில்கள்", "bed"],
    ["நாய் உணவு", "dog"],
    ["கிரிக்கெட்", "sport"],
    ["டீ & காபி", "coffee"],
    ["மசாஜ்", "spa"],
  ])("%s → %s", (name, key) => {
    expect(categoryIconKey(name, name.toLowerCase().replace(/[^a-z0-9]+/g, "-"))).toBe(key);
  });

  it("keeps the other trades' icons where the new words could clash", () => {
    expect(categoryIconKey("Cream crackers", "cream-crackers")).not.toBe("crackers");
    expect(categoryIconKey("Jasmine rice", "jasmine-rice")).toBe("staples");
    expect(categoryIconKey("Temple jewellery", "temple-jewellery")).toBe("jewel");
    expect(categoryIconKey("Brass fittings", "brass-fittings")).not.toBe("pooja");
    expect(categoryIconKey("Hot dogs", "hot-dogs")).not.toBe("dog");
    expect(categoryIconKey("Kitten heels", "kitten-heels")).toBe("heels");
    expect(categoryIconKey("Baby carriers", "baby-carriers")).toBe("baby");
    expect(categoryIconKey("Bed sheets", "bed-sheets")).not.toBe("bed");
    expect(categoryIconKey("Frames", "frames")).toBe("frames");
    expect(categoryIconKey("Face scrubs", "face-scrubs")).not.toBe("spa");
    expect(categoryIconKey("TV wall mounts", "tv-wall-mounts")).not.toBe("phone");
    expect(categoryIconKey("Flower pots", "flower-pots")).toBe("garden");
  });

  it("draws the new keys", () => {
    for (const key of ["crackers", "rocket", "flowers", "pooja", "sofa", "bed", "wallArt", "dog", "cat", "bird", "petTreat", "sport", "trophy"] as const) expect(CATEGORY_ICONS[key], key).toBeTruthy();
    expect(renderToStaticMarkup(<CategoryArt name="Pooja items" slug="pooja-items" image={null} tone={1} />)).toContain('data-cat-icon="pooja"');
  });
});
