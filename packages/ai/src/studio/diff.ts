import { mergeTokens, type BrandTokens } from "@srirealtime/branding/tokens";
import type { HomeDoc, MenuItem } from "@srirealtime/cms";
import type { BrandingArea, CategoriesArea, DiscountsArea, FeatureArea, HomeArea, MenuArea, PageArea, RolesArea, SettingsArea, SignInArea } from "./areas";
import type { Bi, ChangeLine, StudioEnv, StudioPreview, StudioState } from "./types";

const same = (v: string): Bi => ({ en: v, ta: v });
const NONE: Bi = { en: "(none)", ta: "(இல்லை)" };
const ON: Bi = { en: "on", ta: "இயக்கம்" };
const OFF: Bi = { en: "off", ta: "நிறுத்தம்" };
const clip = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const money = (paise: number) => `₹${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(paise / 100)}`;
const MONEY_KEYS = new Set(["codMaxAmount", "minOrderValue", "maxAmount"]);

function fmt(key: string, v: unknown): Bi {
  if (v === undefined || v === null || v === "") return NONE;
  if (typeof v === "boolean") return v ? ON : OFF;
  if (typeof v === "number") return same(MONEY_KEYS.has(key) ? (v === 0 ? "none" : money(v)) : String(v));
  if (Array.isArray(v)) return v.length ? same(clip(v.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(", "))) : NONE;
  if (typeof v === "object") return same(clip(JSON.stringify(v)));
  return same(clip(String(v)));
}

const eq = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const line = (area: string, label: Bi, before: Bi, after: Bi): ChangeLine => ({ area, label, before, after });

// ------------------------------------------------------------------ labels

const TOKEN_LABEL: Record<string, Bi> = {
  "colors.primary": { en: "Main colour", ta: "முதன்மை நிறம்" },
  "colors.secondary": { en: "Second colour", ta: "இரண்டாம் நிறம்" },
  "colors.accent": { en: "Accent colour", ta: "அலங்கார நிறம்" },
  "colors.background": { en: "Background colour", ta: "பின்னணி நிறம்" },
  "colors.foreground": { en: "Text colour", ta: "எழுத்து நிறம்" },
  fontSans: { en: "Body font", ta: "உரை எழுத்துரு" },
  fontHeading: { en: "Heading font", ta: "தலைப்பு எழுத்துரு" },
  radius: { en: "Corner roundness", ta: "மூலை வட்டம்" },
  mode: { en: "Light / dark mode", ta: "ஒளி / இருள் முறை" },
  preset: { en: "Ready-made look", ta: "தயார் தோற்றம்" },
};

function brandingLines(before: BrandingArea, after: BrandingArea, env: StudioEnv): ChangeLine[] {
  const out: ChangeLine[] = [];
  const a = mergeTokens(env.brandDefaults as BrandTokens, before.tokens);
  const b = mergeTokens(env.brandDefaults as BrandTokens, after.tokens);
  if (before.appName !== after.appName) out.push(line("branding", { en: "Shop name shown", ta: "காட்டப்படும் கடை பெயர்" }, fmt("", before.appName), fmt("", after.appName)));
  const flat = (t: BrandTokens) => ({
    "colors.primary": t.colors.primary,
    "colors.secondary": t.colors.secondary,
    "colors.accent": t.colors.accent,
    "colors.background": t.colors.background,
    "colors.foreground": t.colors.foreground,
    fontSans: t.fontSans,
    fontHeading: t.fontHeading ?? t.fontSans,
    radius: t.radius,
    mode: t.mode,
    preset: t.preset,
  });
  const fa = flat(a) as Record<string, unknown>;
  const fb = flat(b) as Record<string, unknown>;
  for (const k of Object.keys(TOKEN_LABEL)) if (!eq(fa[k], fb[k])) out.push(line("branding", TOKEN_LABEL[k]!, fmt(k, fa[k]), fmt(k, fb[k])));
  const ta = a.theme as Record<string, unknown>;
  const tb = b.theme as Record<string, unknown>;
  for (const k of new Set([...Object.keys(ta), ...Object.keys(tb)])) if (!eq(ta[k], tb[k])) out.push(line("branding", { en: `Store layout: ${k}`, ta: `கடை அமைப்பு: ${k}` }, fmt(k, ta[k] ?? "standard"), fmt(k, tb[k])));
  return out;
}

type Sec = { id?: string; type: string; hidden?: boolean } & Record<string, unknown>;
const secName = (s: Sec) => {
  const t = (s.title ?? s.heading ?? (Array.isArray(s.slides) ? (s.slides[0] as { heading?: string } | undefined)?.heading : undefined)) as string | undefined;
  return t ? `${s.type} “${clip(String(t), 36)}”` : s.type;
};

function homeLines(before: HomeArea, after: HomeArea): ChangeLine[] {
  const out: ChangeLine[] = [];
  const A = ((before.doc?.sections ?? []) as unknown as Sec[]).map((s, i) => ({ ...s, _k: s.id ?? `#${i}` }));
  const B = ((after.doc?.sections ?? []) as unknown as Sec[]).map((s, i) => ({ ...s, _k: s.id ?? `#${i}` }));
  const inA = new Map(A.map((s) => [s._k, s]));
  const inB = new Map(B.map((s) => [s._k, s]));
  for (const s of B) if (!inA.has(s._k)) out.push(line("home", { en: "Home section added", ta: "முகப்புப் பகுதி சேர்க்கப்பட்டது" }, NONE, same(secName(s))));
  for (const s of A) if (!inB.has(s._k)) out.push(line("home", { en: "Home section removed", ta: "முகப்புப் பகுதி நீக்கப்பட்டது" }, same(secName(s)), NONE));
  const common = A.filter((s) => inB.has(s._k)).map((s) => s._k);
  const orderB = B.filter((s) => inA.has(s._k)).map((s) => s._k);
  if (!eq(common, orderB)) out.push(line("home", { en: "Home section order", ta: "முகப்புப் பகுதிகளின் வரிசை" }, same(common.map((k) => inA.get(k)!.type).join(" > ")), same(orderB.map((k) => inA.get(k)!.type).join(" > "))));
  for (const k of common) {
    const x = inA.get(k)!;
    const y = inB.get(k)!;
    const { _k: _a, ...xs } = x as Sec & { _k: string };
    const { _k: _b, ...ys } = y as Sec & { _k: string };
    if (eq(xs, ys)) continue;
    const keys = [...new Set([...Object.keys(xs), ...Object.keys(ys)])].filter((f) => !eq(xs[f], ys[f]));
    if (keys.length === 1 && keys[0] === "hidden") out.push(line("home", { en: `Section ${secName(y)}`, ta: `பகுதி ${secName(y)}` }, y.hidden ? { en: "shown", ta: "தெரியும்" } : { en: "hidden", ta: "மறைவு" }, y.hidden ? { en: "hidden", ta: "மறைவு" } : { en: "shown", ta: "தெரியும்" }));
    else for (const f of keys) out.push(line("home", { en: `Section ${secName(y)}: ${f}`, ta: `பகுதி ${secName(y)}: ${f}` }, fmt(f, xs[f]), fmt(f, ys[f])));
  }
  const ta0 = (before.doc?.translations as { ta?: Record<string, unknown> } | undefined)?.ta ?? {};
  const ta1 = (after.doc?.translations as { ta?: Record<string, unknown> } | undefined)?.ta ?? {};
  for (const id of new Set([...Object.keys(ta0), ...Object.keys(ta1)])) if (!eq(ta0[id], ta1[id])) out.push(line("home", { en: `Tamil words for section ${id}`, ta: `${id} பகுதிக்கான தமிழ்ச் சொற்கள்` }, fmt("", ta0[id]), fmt("", ta1[id])));
  return out;
}

function menuLines(menu: string, before: MenuArea, after: MenuArea): ChangeLine[] {
  const flat = (items: MenuItem[]) => items.flatMap((i, n) => [{ ...i, _p: `${n}`, _parent: "" }, ...(i.children ?? []).map((c, m) => ({ ...c, _p: `${n}.${m}`, _parent: i.id ?? i.label }))]);
  const A = flat(before.items);
  const B = flat(after.items);
  const name = menu === "header" ? { en: "Header menu", ta: "மேல் மெனு" } : { en: "Footer menu", ta: "கீழ் மெனு" };
  const target = (i: MenuItem) => i.href ?? `${i.type}: ${i.ref}`;
  const out: ChangeLine[] = [];
  const key = (i: { id?: string; label: string }) => i.id ?? i.label;
  const ia = new Map(A.map((i) => [key(i), i]));
  const ib = new Map(B.map((i) => [key(i), i]));
  for (const i of B) if (!ia.has(key(i))) out.push(line(`menu:${menu}`, name, NONE, same(`${i.label} → ${target(i)}`)));
  for (const i of A) if (!ib.has(key(i))) out.push(line(`menu:${menu}`, name, same(`${i.label} → ${target(i)}`), NONE));
  for (const i of B) {
    const o = ia.get(key(i));
    if (o && (o.label !== i.label || target(o) !== target(i))) out.push(line(`menu:${menu}`, name, same(`${o.label} → ${target(o)}`), same(`${i.label} → ${target(i)}`)));
  }
  const oa = A.filter((i) => ib.has(key(i))).map((i) => i.label);
  const ob = B.filter((i) => ia.has(key(i))).map((i) => i.label);
  if (!eq(oa, ob)) out.push(line(`menu:${menu}`, { en: `${name.en} order`, ta: `${name.ta} வரிசை` }, same(oa.join(" | ")), same(ob.join(" | "))));
  return out;
}

const PAGE_NAME: Bi = { en: "Page", ta: "பக்கம்" };
function pageLines(before: PageArea, after: PageArea): ChangeLine[] {
  const lab = (s: string): Bi => ({ en: `${PAGE_NAME.en} “${s}”`, ta: `${PAGE_NAME.ta} “${s}”` });
  if (!before.exists && after.exists) return [line(`page:${after.slug}`, lab(after.title), NONE, { en: `new page (${after.status})`, ta: `புதிய பக்கம் (${after.status === "published" ? "வெளியிடப்பட்டது" : "வரைவு"})` })];
  if (before.exists && !after.exists) return [line(`page:${before.slug}`, lab(before.title), same(before.status), NONE)];
  if (before.status !== after.status) return [line(`page:${after.slug}`, lab(after.title), same(before.status), same(after.status))];
  return [];
}

const SETTING_LABEL: Record<string, Record<string, Bi>> = {
  store: {
    open: { en: "Online store open", ta: "ஆன்லைன் கடை திறந்துள்ளது" },
    closedMessage: { en: "Message when closed", ta: "மூடியிருக்கும்போது செய்தி" },
    codEnabled: { en: "Cash on delivery", ta: "கேஷ் ஆன் டெலிவரி" },
    codMaxAmount: { en: "Cash on delivery limit", ta: "கேஷ் ஆன் டெலிவரி வரம்பு" },
    minOrderValue: { en: "Minimum order", ta: "குறைந்தபட்ச ஆர்டர்" },
    deliveryEnabled: { en: "Home delivery", ta: "வீட்டு டெலிவரி" },
    pickupEnabled: { en: "Pickup from shop", ta: "கடையில் எடுத்தல்" },
    pickupNote: { en: "Pickup note", ta: "எடுக்கும் குறிப்பு" },
    contactPhone: { en: "Store phone", ta: "கடை தொலைபேசி" },
    contactEmail: { en: "Store e-mail", ta: "கடை மின்னஞ்சல்" },
    social: { en: "Social and WhatsApp links", ta: "சமூக / WhatsApp இணைப்புகள்" },
    policies: { en: "Policy pages", ta: "கொள்கைப் பக்கங்கள்" },
    trust: { en: "Trust badges", ta: "நம்பிக்கை பேட்ஜ்கள்" },
    installBanner: { en: "Install app banner", ta: "செயலி நிறுவல் பேனர்" },
    businessType: { en: "Type of business", ta: "வணிக வகை" },
  },
  billing: {
    legalName: { en: "Business name on bills", ta: "பில்லில் வணிகப் பெயர்" },
    gstin: { en: "GSTIN on bills", ta: "பில்லில் GSTIN" },
    address: { en: "Address on bills", ta: "பில்லில் முகவரி" },
    city: { en: "City", ta: "நகரம்" },
    pincode: { en: "PIN code", ta: "அஞ்சல் குறியீடு" },
    stateCode: { en: "State code", ta: "மாநிலக் குறியீடு" },
    phone: { en: "Phone on bills", ta: "பில்லில் தொலைபேசி" },
    email: { en: "E-mail on bills", ta: "பில்லில் மின்னஞ்சல்" },
    terms: { en: "Terms on bills", ta: "பில் விதிமுறைகள்" },
    bankName: { en: "Bank name", ta: "வங்கி பெயர்" },
    accountNumber: { en: "Account number", ta: "கணக்கு எண்" },
    ifsc: { en: "IFSC", ta: "IFSC" },
    upiId: { en: "UPI id", ta: "UPI ஐடி" },
    invoicePrefix: { en: "Bill number prefix", ta: "பில் எண் முன்னொட்டு" },
    autoReminders: { en: "Automatic reminders", ta: "தானியங்கி நினைவூட்டல்கள்" },
    reminderDays: { en: "Reminder days after due", ta: "நிலுவை முடிந்த பின் நினைவூட்டல் நாட்கள்" },
    sendPaymentReceipts: { en: "Payment receipts", ta: "கட்டண ரசீதுகள்" },
  },
  printing: {
    paperWidth: { en: "Receipt paper width", ta: "ரசீது காகித அகலம்" },
    headerLines: { en: "Receipt header lines", ta: "ரசீது மேல் வரிகள்" },
    footerLines: { en: "Receipt footer lines", ta: "ரசீது கீழ் வரிகள்" },
    showLogo: { en: "Logo on receipt", ta: "ரசீதில் லோகோ" },
    showQr: { en: "QR on receipt", ta: "ரசீதில் QR" },
    autoPrint: { en: "Print automatically", ta: "தானாக அச்சிடு" },
    openDrawerOnCash: { en: "Open drawer on cash", ta: "பணத்துக்கு டிராயரைத் திற" },
    cut: { en: "Paper cut", ta: "காகித வெட்டு" },
  },
  quotations: {
    prefix: { en: "Quotation prefix", ta: "விலைப்பட்டியல் முன்னொட்டு" },
    validityDays: { en: "Valid for (days)", ta: "செல்லுபடி (நாட்கள்)" },
    terms: { en: "Quotation terms", ta: "விலைப்பட்டியல் விதிமுறைகள்" },
    advancePercent: { en: "Advance %", ta: "முன்பணம் %" },
  },
  ai: {
    features: { en: "AI helpers allowed", ta: "அனுமதிக்கப்பட்ட AI உதவியாளர்கள்" },
    maskGstin: { en: "Hide GSTIN from AI", ta: "AI-க்கு GSTIN மறை" },
    storePrompts: { en: "Keep AI prompts for debugging", ta: "பிழைதிருத்தத்துக்கு AI உள்ளீடுகளைச் சேமி" },
  },
};

function settingsLines(ns: string, before: SettingsArea, after: SettingsArea): ChangeLine[] {
  const out: ChangeLine[] = [];
  const keys = new Set([...Object.keys(before.effective), ...Object.keys(after.effective)]);
  for (const k of keys) {
    const x = before.effective[k];
    const y = after.effective[k];
    if (eq(x, y)) continue;
    const label = SETTING_LABEL[ns]?.[k] ?? same(k);
    if (x && y && typeof x === "object" && typeof y === "object" && !Array.isArray(x) && !Array.isArray(y)) {
      for (const sk of new Set([...Object.keys(x as object), ...Object.keys(y as object)])) {
        const sx = (x as Record<string, unknown>)[sk];
        const sy = (y as Record<string, unknown>)[sk];
        if (!eq(sx, sy)) out.push(line(`settings:${ns}`, { en: `${label.en}: ${sk}`, ta: `${label.ta}: ${sk}` }, fmt(sk, sx), fmt(sk, sy)));
      }
    } else out.push(line(`settings:${ns}`, label, fmt(k, x), fmt(k, y)));
  }
  return out;
}

function rolesLines(before: RolesArea, after: RolesArea): ChangeLine[] {
  const out: ChangeLine[] = [];
  const A = new Map(before.roles.map((r) => [r.key, r]));
  for (const r of after.roles) {
    const o = A.get(r.key);
    const lab: Bi = { en: `Role “${r.name}”`, ta: `பணி “${r.name}”` };
    if (!o) out.push(line("roles", lab, NONE, same(`${r.permissions.length} permissions: ${clip(r.permissions.join(", "), 80)}`)));
    else {
      const added = r.permissions.filter((p) => !o.permissions.includes(p));
      const removed = o.permissions.filter((p) => !r.permissions.includes(p));
      if (added.length) out.push(line("roles", { en: `${lab.en}: permissions added`, ta: `${lab.ta}: சேர்க்கப்பட்ட அனுமதிகள்` }, NONE, same(added.join(", "))));
      if (removed.length) out.push(line("roles", { en: `${lab.en}: permissions removed`, ta: `${lab.ta}: நீக்கப்பட்ட அனுமதிகள்` }, same(removed.join(", ")), NONE));
      if (o.name !== r.name) out.push(line("roles", { en: `${lab.en}: name`, ta: `${lab.ta}: பெயர்` }, same(o.name), same(r.name)));
    }
  }
  for (const r of before.roles) if (!after.roles.some((x) => x.key === r.key)) out.push(line("roles", { en: `Role “${r.name}”`, ta: `பணி “${r.name}”` }, same("exists"), NONE));
  return out;
}

const limitText = (r: { maxPercent: number | null; maxAmount: number | null } | undefined): Bi => (r ? same([r.maxPercent != null && `${r.maxPercent}% a line`, r.maxAmount != null && `${money(r.maxAmount)} a bill`].filter(Boolean).join(", ") || "no limit") : { en: "no limit", ta: "வரம்பு இல்லை" });
function discountLines(before: DiscountsArea, after: DiscountsArea): ChangeLine[] {
  const out: ChangeLine[] = [];
  const k = (r: { scope: string; subject: string }) => `${r.scope}:${r.subject}`;
  const A = new Map(before.items.map((r) => [k(r), r]));
  const B = new Map(after.items.map((r) => [k(r), r]));
  for (const key of new Set([...A.keys(), ...B.keys()])) {
    const x = A.get(key);
    const y = B.get(key);
    if (!eq(x, y)) out.push(line("discounts", { en: `Discount limit: ${(y ?? x)!.subject}`, ta: `தள்ளுபடி வரம்பு: ${(y ?? x)!.subject}` }, limitText(x), limitText(y)));
  }
  return out;
}

function signinLines(before: SignInArea, after: SignInArea): ChangeLine[] {
  const out: ChangeLine[] = [];
  for (const a of ["staff", "customer"] as const) {
    const who: Bi = a === "staff" ? { en: "Team sign-in", ta: "குழு உள்நுழைவு" } : { en: "Shopper sign-in", ta: "வாடிக்கையாளர் உள்நுழைவு" };
    const x = before[a];
    const y = after[a];
    if (!eq(x.methods, y.methods)) out.push(line("signin", { en: `${who.en}: methods`, ta: `${who.ta}: முறைகள்` }, same(x.methods.join(", ")), same(y.methods.join(", "))));
    if (x.default !== y.default) out.push(line("signin", { en: `${who.en}: shown first`, ta: `${who.ta}: முதலில் காட்டு` }, same(x.default), same(y.default)));
    if (!!x.requireMfa !== !!y.requireMfa) out.push(line("signin", { en: `${who.en}: two-factor required`, ta: `${who.ta}: இரு-படி கட்டாயம்` }, x.requireMfa ? ON : OFF, y.requireMfa ? ON : OFF));
  }
  return out;
}

function categoryLines(before: CategoriesArea, after: CategoriesArea): ChangeLine[] {
  const k = (n: string) => n.trim().toLowerCase();
  const had = new Set(before.items.map((c) => k(c.name)));
  const will = new Set(after.items.map((c) => k(c.name)));
  const added = after.items.filter((c) => !had.has(k(c.name))).map((c) => c.name);
  const removed = before.items.filter((c) => !will.has(k(c.name))).map((c) => c.name);
  const out: ChangeLine[] = [];
  if (added.length) out.push(line("categories", { en: "Product groups added", ta: "சேர்க்கப்படும் பொருள் வகைகள்" }, NONE, same(clip(added.join(", "), 160))));
  if (removed.length) out.push(line("categories", { en: "Empty product groups removed", ta: "நீக்கப்படும் காலியான வகைகள்" }, same(clip(removed.join(", "), 160)), NONE));
  return out;
}

/** The before -> after list of everything the plan changes, plus the data the live store preview needs. */
export function buildPreview(st: StudioState, env: StudioEnv): StudioPreview {
  const lines: ChangeLine[] = [];
  const preview: StudioPreview = { lines };
  for (const area of st.changed()) {
    const b = st.before(area) as never;
    const a = st.after(area) as never;
    if (area === "branding") {
      lines.push(...brandingLines(b, a, env));
      const merged = mergeTokens(env.brandDefaults as BrandTokens, (a as BrandingArea).tokens);
      preview.tokens = JSON.parse(JSON.stringify(merged));
    } else if (area === "home") {
      lines.push(...homeLines(b, a));
      preview.sections = ((a as HomeArea).doc?.sections ?? []).map((s, i) => ({ ...(s as object), id: (s as { id?: string }).id ?? `sec-${i}` }) as Record<string, unknown>);
    } else if (area.startsWith("menu:")) lines.push(...menuLines(area.slice(5), b, a));
    else if (area.startsWith("page:")) lines.push(...pageLines(b ?? { exists: false, slug: area.slice(5), title: "", status: "draft", id: null, blocks: [] }, a));
    else if (area.startsWith("settings:")) lines.push(...settingsLines(area.slice(9), b, a));
    else if (area === "roles") lines.push(...rolesLines(b, a));
    else if (area === "discounts") lines.push(...discountLines(b, a));
    else if (area === "signin") lines.push(...signinLines(b, a));
    else if (area === "categories") lines.push(...categoryLines(b, a));
    else if (area.startsWith("feature:")) {
      const f = a as FeatureArea;
      lines.push(line(area, { en: `Feature “${f.label}”`, ta: `வசதி “${f.label}”` }, (b as FeatureArea).enabled ? ON : OFF, f.enabled ? ON : OFF));
    }
  }
  return preview;
}

export type { HomeDoc };
