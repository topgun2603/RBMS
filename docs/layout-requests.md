# Storefront layout requests

Demo stores must not share one home-page structure. When a store needs a layout the platform can't do yet, its builder
adds a request here instead of hand-coding it; the layout-features agent builds it as a **platform feature** (a CMS
home section type or a theme / layout option), editable by every shop owner in the admin (Home page editor or
Settings → Appearance) and rendered by `storefront-ui`.

Rules for requests: one `##` heading per request, the store that wants it, what the shopper sees (desktop and phone),
the settings the owner should control in the admin, and English + Tamil copy needs. Append only; don't edit other
stores' requests. The layout-features agent marks each one `Status: built (<section type / option name>)` or
`Status: declined (<why>)`.

## The default pattern to avoid repeating

hero → USP strip → category mosaic or rings → product tabs → offer → testimonials → FAQ → location → newsletter.
Every store should differ in section choice, order, rhythm and the theme's structural options (header, hero, cards,
listing, product page), not only in colours and fonts.

**Demo sections from the layout-features agent:** to show each new feature it published one section with an id
starting `lx-` on these homes: Cauvery `lx-flash`, Murugan `lx-aisles`, Arasan `lx-compare`, Thari `lx-reels`, Vayal
`lx-story`, Padham `lx-size` (Ezhuthaani and Azhagu have since re-seeded with their own `ez-finder`, `az-concerns` and
`az-shades`, so their `lx-` demos are gone). Keep, move or delete them in your store's
`home()` — note that `pnpm seed:stores <slug> --refresh-home` only rewrites a home whose section ids are all yours, so
either add the section to your store data (same or your own id) or delete the `lx-` section in the admin first.

---

## Shop-by-class finder (store #8, Ezhuthaani Books & Stationery)

- **Shopper sees:** a band with two or three steps as chips or a select: board (Tamil Nadu State Board / CBSE / other),
  class (LKG … Class 12, College) and optionally medium (English / Tamil); "Show my list" opens the matching collection
  (or a filtered listing by tag / attribute) with the class's kit bundle pinned first. Desktop: one row of chip groups
  beside a short heading and a picture; phone: stacked groups, chips scroll sideways, the button full width.
- **Owner controls (Home page editor):** heading, text, picture; the list of classes (label + target collection or tag)
  and boards; an optional "Send your school list on WhatsApp" secondary button (href).
- **Copy:** heading / text / chip labels / button label in English and Tamil (section translations like the others).
- Today the store uses a `logos` strip of name-only wordmarks linked to class collections as a stand-in.
- **Status: built (`finder`, layout `chips`).** Questions = chip rows (board, class, medium); each answer filters by
  `tag` (exact, e.g. `class-1-5`), category, option/attribute, words or price, or opens its own page (`href`: the class
  collection). `results: "button"` + `buttonLabel: "Show my list"` gives the button (with the match count) instead of
  the inline products; `imageUrl` is the picture beside, `cta` the WhatsApp button. Demo: section `lx-finder` on
  Ezhuthaani's home (class tag × category, inline matches), now replaced by the store's own `ez-finder`. See
  docs/verticals.md → Layout catalogue.

## Shop by concern (store #10, Azhagu Beauty)

- **Shopper sees:** a row of concern tiles (acne & oily skin, dry skin, hair fall, dark spots & tan …), each with a small
  picture or icon, the concern's name, a one-line "what helps" note (e.g. "Niacinamide, salicylic acid, sunscreen") and
  a product count; a tile opens its collection. Desktop: 4–6 tiles in one row; phone: two per row or a sideways scroll.
- **Owner controls (Home page editor):** title, text; tiles (label, note, picture or icon, target collection or tag).
- **Copy:** title / text / labels / notes in English and Tamil.
- Today the store uses a `gallery` (grid) with captions linking to concern collections as a stand-in (no notes, no counts).
- **Status: built (`tiles`).** Tiles with picture (or an icon from the name), label, `note`, product count (from the
  collection or the tag), each opening `href` / `collectionSlug` / `tag`; layout `row` (sideways on phones) or `grid`.
  Azhagu's home now uses it (`az-concerns`).

## Shade finder (store #10, Azhagu Beauty)

- **Shopper sees:** colour swatches of a product family's shades (lipstick, foundation, compact, nail paint), grouped by
  product, with an optional "skin depth" filter (fair / wheatish / dusky / deep) for face products; tapping a swatch
  shows the shade name, a swatch photo and "Add to cart" for that variant (or opens the product with the shade
  selected). Desktop: tabs per product with a swatch grid beside a picture; phone: tabs scroll, swatches wrap.
- **Owner controls (Home page editor):** title, text, the products to include (their `Shade` option values become the
  swatches), a hex colour per shade (or taken from the variant's colour attribute), optional skin-depth tags per shade.
- **Copy:** title / text / tab labels / filter labels in English and Tamil; shade names come from the catalogue.
- Today the store uses a `shop-the-look` on a swatch photo (hotspots to the lipstick products) as a stand-in.
- **Status: built (`swatches`).** Products (1–6, tabs), `optionName` (default `Shade`), `shades` = option value → hex
  colour + optional skin depth (fair / wheatish / dusky / deep, the filter); a swatch shows the shade name, the
  variant's price and Add to cart (that variant). Values without a colour show a neutral swatch. Not done: taking the
  colour from a variant attribute (the owner types the hex). Azhagu's home uses it (`az-shades`).

## Shop by size (store #7, Padham Footwear)

- **Shopper sees:** "Find your size" band: a Men / Women / Kids toggle and a row of size chips (UK 6 … UK 11, UK 3 …
  UK 8, UK 8C … UK 5), optionally a foot-length entry in cm that picks the chip for them (from the storefront's shoe
  chart); tapping a chip opens the listing filtered to products that have that `Size` value in stock (the filter the
  listing's Size facet already applies), keeping the chosen category. Desktop: one row beside a short heading and a
  picture; phone: the toggle on top, chips scroll sideways, the cm field full width.
- **Owner controls (Home page editor):** heading, text, picture; which groups to show and their size values (default:
  the shoe chart's), the target per group (a category or collection), whether to show the cm field.
- **Copy:** heading / text / group labels / button in English and Tamil (section translations like the others).
- Today the store uses an `image-text` "Measure once, fit right" block linking to the size-guide page as a stand-in.
- **Status: built (`size-finder`).** Groups (label, category, sizes exactly as the option values, e.g. `UK 8`,
  `UK 10C`), `optionName`, `footLength` (cm → size on the UK/India scale used by the shoe chart), `imageUrl`. A chip
  opens `/search?cat=<group category>&opt.Size=<size>`. Demo: `lx-size` on Padham's home. Not done: in-stock-only
  sizes (the listing's stock filter can be added to the link later).

## Festival calendar with a countdown to the next event (store #12, Malligai Flowers & Pooja, Madurai)

- **Shopper sees:** a band headed by the next festival with a live d/h/m countdown ("Karthigai Deepam in 12 days") and
  its "book by" date, then the following 4–6 festivals as compact date cards (date, name, one line, picture, a link to
  its kit or collection). Past dates drop off by themselves, so the section never shows a stale offer. Desktop: the
  next event large on the left, the rest in a row beside it; phone: the next event on top, the rest a sideways scroll.
- **Owner controls (Home page editor):** title, text; events: date (and optional end date), name, note, "book by"
  date, picture, link (collection / category / page), optional coupon code.
- **Copy:** title / text / names / notes in English and Tamil (section translations); dates formatted per locale.
- Today the store uses a `timeline` (dates as `when`, no countdown) plus an `offer` with `endsAt` (which hides itself
  after Deepavali eve, leaving no countdown for the next festival) as a stand-in.

## Swatches over a second option: case colour × phone model (store #13, Kaipesi Mobile Accessories)

- **Shopper sees:** the `swatches` colour finder for products with two options, e.g. a silicone case with *Phone
  model* (iPhone-style 6.1-inch, Galaxy A-series 6.6-inch …) and *Colour*. Above the swatches, a "Your phone" select
  (or chips) for the second option; the swatches then show that model's colours, the price of that exact variant and
  Add to cart adds that variant (or "Choose your phone first" while none is picked). Desktop: the select beside the
  product tabs; phone: a full-width select over the swatches.
- **Owner controls (Home page editor):** as today (products, option name, shades), plus "also choose" = a second option
  name (e.g. `Phone model`) and its label.
- **Copy:** the select's label and placeholder in English and Tamil (section translations).
- Why: today `swatchProducts` takes the first variant per colour, so on a two-option product Add would add the first
  phone model's case in that colour, whatever the shopper's phone. Kaipesi's `kp-colours` therefore shows single-option
  products only (earphones, watch straps, smartwatch, earbuds, power bank) instead of its case colours.
