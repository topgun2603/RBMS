import type { BillDraft, BillLine, HistoryCtx, IndustryHook, IssuedBill, SimItem } from "../context";
import { addDays, daysBetween } from "../calendar";
import { personName, testPhone } from "../names";
import type { Rng } from "../rng";
import { bulkQty, GARMENT_RECIPES, GARMENT_STAFF, measurementsFor } from "./jobcards-garments";

/**
 * Repair shop on job cards: every bill of the day is a job delivered that day.
 * - the job is one of the shop's repair recipes (a phone screen, a battery with its part, an SSD upgrade with a serial
 *   unit, an AC service, a washing machine bearing …), opened up to a few days earlier (same day for quick repairs) and
 *   moved through received → diagnosed → (awaiting approval → approved, online on the tracking page or recorded from a
 *   call / WhatsApp / the counter) → in progress → (trial) → ready with dated timeline events, parts and labour lines,
 *   an advance on bigger jobs, then billed and delivered at the bill's time (credit customers' bills go on the book);
 * - at the start of each day a few jobs are opened that are not delivered: cancelled ones (estimate declined) on any day,
 *   warranty re-repairs at no charge, and in the last two weeks open jobs in every status (received, diagnosed,
 *   awaiting approval, approved, in progress, trial, ready), some stale, so the job board looks like a live bench.
 * Parts come from the stock-tracked catalogue entries; units with serial numbers are taken from the shop's serial stock
 * (the bill marks them sold and starts their warranty). Without the jobcards feature it falls back to counter bills.
 */
export type Device = "phone" | "laptop" | "tv" | "ac" | "appliance" | "garment";

interface Part {
  /** One of these item names (first one in stock). */
  names: string[];
  qty?: number;
  /** Take a unit with a serial number from the serial stock. */
  serial?: boolean;
}
export interface Recipe {
  id: string;
  weight: number;
  device: Device;
  /** Labour / service items: one of these names each. */
  labour: string[][];
  parts?: Part[];
  issues: string[];
  /** Days between intake and delivery. */
  days: [number, number];
  /** An estimate the customer must approve first. */
  approval?: boolean;
  /** Tailoring (garment template, profile `tailoring`): the garment and the styles it is stitched in. */
  garment?: { type: "blouse" | "salwar" | "shirt" | "pant" | "other"; name?: string; styles: string[] };
  /** Extra lines (add-ons) now and then. */
  addons?: string[];
  /** A trial fitting before it is ready. */
  trial?: boolean;
  /** The workroom person who stitches it. */
  tailor?: string;
  /** An alteration or finishing job (free re-do within a week). */
  alteration?: boolean;
  /** A bulk order for a school or business (the size slab sets the quantity, billed to a credit customer). */
  bulk?: boolean;
}

const RECIPES: Recipe[] = [
  { id: "phone-screen-compat", weight: 3, device: "phone", labour: [["Phone screen replacement, compatible panel – 6.2 to 6.5-inch", "Phone screen replacement, compatible panel – Up to 6.1-inch", "Phone screen replacement, compatible panel – 6.6-inch and above"]], issues: ["Screen cracked after a fall", "Display has lines and touch is patchy", "Screen broken, touch not working"], days: [0, 1] },
  { id: "phone-screen-original", weight: 2, device: "phone", labour: [["Phone screen replacement, original panel – 6.2 to 6.5-inch"]], issues: ["Cracked screen, wants the original panel", "Display dim and cracked at the corner"], days: [0, 2], approval: true },
  { id: "phone-screen-part", weight: 2.5, device: "phone", labour: [["Screen replacement (labour)"]], parts: [{ names: ["Phone display module, 6.1-inch OLED (compatible)"] }], issues: ["Screen cracked, 6.1-inch phone", "Display flickers and shows green line"], days: [0, 1] },
  { id: "phone-battery", weight: 3, device: "phone", labour: [["Battery replacement (labour)"]], parts: [{ names: ["Phone battery, 4000 mAh (compatible)", "Phone battery, 5000 mAh (compatible)"] }], issues: ["Battery drains by evening", "Phone switches off at 30%", "Battery swollen, back cover lifting"], days: [0, 1] },
  { id: "phone-port", weight: 1.5, device: "phone", labour: [["Charging port replacement – USB-C", "Charging port replacement – Micro USB"]], issues: ["Not charging unless the cable is held", "Charging port loose"], days: [0, 1] },
  { id: "phone-port-flex", weight: 0.8, device: "phone", labour: [["Charging port replacement – USB-C"]], parts: [{ names: ["Phone charging port flex, USB-C"] }], issues: ["Not charging, port damaged by a bent cable"], days: [0, 1] },
  { id: "phone-water", weight: 1, device: "phone", labour: [["Water damage: diagnosis and ultrasonic cleaning – Phone"], ["Water damage: motherboard repair – Phone"]], issues: ["Fell in water, won't switch on", "Tea spilled on the phone", "Rain damage, speaker silent"], days: [2, 5], approval: true },
  { id: "phone-misc", weight: 0.7, device: "phone", labour: [["Speaker, mic or camera repair – Earpiece or loudspeaker", "Speaker, mic or camera repair – Rear camera", "Phone back glass replacement", "Phone won't switch on: diagnosis"]], issues: ["Caller can't hear me", "Rear camera blurry", "Back glass cracked", "Phone dead overnight"], days: [0, 2] },
  { id: "laptop-os", weight: 1.5, device: "laptop", labour: [["Windows reinstall with drivers and Office – Laptop"]], issues: ["Very slow, pop-ups everywhere", "Windows will not start", "Needs a clean install before joining a new job"], days: [0, 2] },
  { id: "laptop-ssd", weight: 1, device: "laptop", labour: [["Data backup and transfer – Laptop or desktop"]], parts: [{ names: ["Laptop SSD 512 GB SATA", "Laptop SSD 1 TB NVMe"], serial: true }], issues: ["Takes five minutes to start, wants an SSD", "Hard disk clicking, upgrade to SSD"], days: [1, 3], approval: true },
  { id: "laptop-ram", weight: 0.8, device: "laptop", labour: [["Laptop overheating: fan clean and thermal paste"]], parts: [{ names: ["Laptop RAM 8 GB DDR4 SODIMM"], serial: true }], issues: ["Hangs with a few tabs, fan is loud", "Gets hot and slow, add memory"], days: [1, 2] },
  { id: "laptop-battery", weight: 0.6, device: "laptop", labour: [["Express diagnosis in 2 hours"]], parts: [{ names: ["Laptop battery, compatible"], serial: true }], issues: ["Switches off when unplugged"], days: [0, 2], approval: true },
  { id: "laptop-other", weight: 0.8, device: "laptop", labour: [["Laptop screen replacement – 15.6-inch HD", "Laptop keyboard replacement", "Laptop won't switch on: motherboard repair – Board repair (typical)", "Laptop battery replacement"]], issues: ["Screen cracked, lid pressed in a bag", "Some keys not working", "No power, no lights", "Battery doesn't hold charge"], days: [1, 4], approval: true },
  { id: "laptop-charger", weight: 0.7, device: "laptop", labour: [["Express diagnosis in 2 hours"]], parts: [{ names: ["Laptop charger, 65 W"] }], issues: ["Not charging, adapter hot"], days: [0, 1] },
  { id: "ac-service", weight: 1.3, device: "ac", labour: [["AC general service (split) – 1.5 ton", "AC general service (split) – 1 ton", "AC general service (split) – 2 ton"]], issues: ["Yearly service before summer", "Weak cooling, smells when it starts"], days: [0, 0] },
  { id: "ac-jetwash", weight: 0.7, device: "ac", labour: [["AC deep jet-wash service – 1.5 ton", "AC deep jet-wash service – 1 ton", "AC deep jet-wash service – 2 ton"]], issues: ["Water dripping inside, dirty coil"], days: [0, 0] },
  { id: "ac-gas", weight: 0.5, device: "ac", labour: [["AC gas top-up (R32) – 1 to 1.5 ton", "AC gas top-up (R32) – 2 ton"]], issues: ["Runs but doesn't cool, ice on the pipe"], days: [0, 1], approval: true },
  { id: "ac-capacitor", weight: 0.6, device: "ac", labour: [["AC not cooling: home visit diagnosis"]], parts: [{ names: ["AC fan capacitor, 35 µF"] }], issues: ["Outdoor fan not starting, humming noise"], days: [0, 0] },
  { id: "tv-backlight", weight: 0.8, device: "tv", labour: [["TV backlight repair – 40 to 43-inch", "TV backlight repair – Up to 32-inch", "TV backlight repair – 50-inch and above"]], issues: ["Picture very dark, only a shadow visible", "Left half of the screen dim"], days: [0, 2], approval: true },
  { id: "tv-strips", weight: 0.5, device: "tv", labour: [["TV no picture or sound: home visit diagnosis"]], parts: [{ names: ["TV backlight LED strip set, 43-inch"] }], issues: ["Sound is fine but no picture"], days: [0, 1], approval: true },
  { id: "tv-board", weight: 0.5, device: "tv", labour: [["TV main board or power board repair"]], issues: ["Red light blinking, won't switch on"], days: [1, 2], approval: true },
  { id: "washer-bearing", weight: 0.7, device: "appliance", labour: [["Washing machine repair: visit and diagnosis"]], parts: [{ names: ["Washing machine drum bearing kit"] }], issues: ["Loud grinding noise while spinning"], days: [0, 1], approval: true },
  { id: "washer-board", weight: 0.4, device: "appliance", labour: [["Washing machine control board repair"]], issues: ["Panel dead, beeps and won't start"], days: [1, 3], approval: true },
  { id: "fridge-ro", weight: 0.6, device: "appliance", labour: [["Fridge not cooling: gas and compressor check", "RO water purifier service"]], issues: ["Fridge warm, freezer ice only", "RO water tastes salty"], days: [0, 0] },
];

type RepairDevice = Exclude<Device, "garment">;
const BRANDS: Record<RepairDevice, { brand: string; models: string[]; accessories: string[][] }> = {
  phone: { brand: "", models: ["Redmi Note 12", "Galaxy A34", "Realme 11", "Moto G54", "iPhone 12", "Vivo Y27", "OnePlus Nord CE 3", "Poco X5"], accessories: [[], ["back cover"], ["SIM tray", "back cover"]] },
  laptop: { brand: "", models: ["HP 15s", "Dell Inspiron 3511", "Lenovo IdeaPad 3", "Acer Aspire 5", "Asus VivoBook 15"], accessories: [["charger"], ["charger", "bag"], []] },
  tv: { brand: "", models: ["43-inch LED", "32-inch LED", "55-inch smart TV", "40-inch LED"], accessories: [["remote"]] },
  ac: { brand: "", models: ["1.5 ton split inverter", "1 ton split", "2 ton split", "1.5 ton window"], accessories: [[]] },
  appliance: { brand: "", models: ["Top-load 7 kg", "Front-load 8 kg", "Double-door fridge 260 L", "RO purifier 8 L"], accessories: [[]] },
};
const BRAND_NAMES: Record<RepairDevice, string[]> = {
  phone: ["Redmi", "Samsung", "Realme", "Motorola", "Apple", "Vivo", "OnePlus", "Poco"],
  laptop: ["HP", "Dell", "Lenovo", "Acer", "Asus"],
  tv: ["Sony", "LG", "Samsung", "Mi", "TCL"],
  ac: ["Voltas", "LG", "Daikin", "Blue Star", "Hitachi"],
  appliance: ["IFB", "LG", "Whirlpool", "Samsung", "Kent"],
};

const TECHS: Record<RepairDevice, string> = { phone: "Karthikeyan Subramani", laptop: "Karthikeyan Subramani", tv: "Arul Prakash", ac: "Arul Prakash", appliance: "Arul Prakash" };
const REAL_STAFF = [
  { role: "Manager", name: "Senthil Murugan" },
  { role: "Technician", name: "Karthikeyan Subramani" },
  { role: "Technician", name: "Arul Prakash" },
  { role: "Cashier", name: "Divya Lakshmi" },
];

interface State {
  enabled: boolean;
  /** The pool of recipes (device repairs, or garments for the tailoring profile). */
  recipes: Recipe[];
  garments: boolean;
  serials: boolean;
  assignees: Map<string, string | null>;
  delivered: { id: string; label: string; name: string; phone: string | null; customerId: string | null; date: string; device: Device; fields: Record<string, unknown> }[];
  plans: WeakMap<BillDraft, JobPlan>;
}
const states = new WeakMap<HistoryCtx, State>();

interface PlannedLine {
  item: SimItem;
  qty: number;
  kind: "part" | "labour";
  serialPart: boolean;
}
interface JobPlan {
  recipe: Recipe;
  lines: PlannedLine[];
  fields: { brand: string; model: string; serial: string | null; issue: string; accessories: string[]; condition: string | null };
  /** Garment template fields (tailoring); the trial date is set when the job opens. */
  garment?: { garmentType: string; garmentName?: string; fabricReceived: boolean; style: string; unit: "in"; measurements: Record<string, number> };
  total: number;
}

const GST = (l: { item: SimItem; qty: number }) => Math.round(l.item.rate * l.qty * (1 + l.item.gstRate / 100));

const find = (ctx: HistoryCtx, name: string) => ctx.items.find((i) => i.name === name);

/** Resolves a recipe to catalogue items (parts need stock); null when something it needs isn't there. */
function resolve(ctx: HistoryCtx, r: Rng, recipe: Recipe, opts: { serials: boolean }): PlannedLine[] | null {
  const out: PlannedLine[] = [];
  for (const group of recipe.labour) {
    const item = find(ctx, r.pick(group));
    if (!item) return null;
    out.push({ item, qty: recipe.bulk ? bulkQty(item.name, r) : 1, kind: "labour", serialPart: false });
  }
  if (recipe.addons?.length && r.chance(0.35)) {
    const add = find(ctx, r.pick(recipe.addons));
    if (add) out.push({ item: add, qty: 1, kind: "labour", serialPart: false });
  }
  for (const p of recipe.parts ?? []) {
    const options = p.names.map((n) => find(ctx, n)).filter((i): i is SimItem => !!i);
    const qty = p.qty ?? 1;
    const item = options.find((i) => !i.tracked || i.stock >= qty);
    if (!item) return null;
    if (p.serial && !opts.serials) return null;
    out.push({ item, qty, kind: "part", serialPart: !!p.serial });
  }
  return out;
}

function planFor(ctx: HistoryCtx, r: Rng, opts: { serials: boolean; recipes?: Recipe[] }): JobPlan | null {
  const pool = opts.recipes ?? states.get(ctx)?.recipes ?? RECIPES;
  for (let attempt = 0; attempt < 6; attempt++) {
    const recipe = r.weighted(pool, (x) => x.weight);
    const lines = resolve(ctx, r, recipe, opts);
    if (!lines) continue;
    const total = lines.reduce((a, l) => a + GST(l), 0);
    if (recipe.device === "garment" && recipe.garment) {
      const gm = recipe.garment;
      return {
        recipe,
        lines,
        fields: { brand: "", model: "", serial: null, issue: "", accessories: [], condition: null },
        garment: {
          garmentType: gm.type,
          ...(gm.name ? { garmentName: gm.name } : {}),
          fabricReceived: r.chance(recipe.bulk ? 0.9 : 0.8),
          style: r.pick(gm.styles),
          unit: "in",
          measurements: measurementsFor(gm.type, r, gm.name),
        },
        total,
      };
    }
    const dev = recipe.device as RepairDevice;
    const device = BRANDS[dev];
    const brand = r.pick(BRAND_NAMES[dev]);
    const model = r.pick(device.models);
    return {
      recipe,
      lines,
      fields: {
        brand,
        model,
        serial: dev === "phone" || dev === "laptop" ? `${r.int(100000, 999999)}${r.int(100000, 999999)}${r.int(100, 999)}` : null,
        issue: r.pick(recipe.issues),
        accessories: r.pick(device.accessories),
        condition: r.chance(0.35) ? r.pick(["Scratches on the back", "Dent on one corner", "Old repair marks", "Screen protector fitted", "Minor scuffs"]) : null,
      },
      total,
    };
  }
  return null;
}

const ABS_OPEN = 9 * 60 + 40;
const ABS_CLOSE = 20 * 60 + 15;
/** A moment (date + minute) from an absolute minute counter, kept inside opening hours. */
function moment(base: string, abs: number): { date: string; minute: number } {
  const day = Math.floor(abs / 1440);
  const m = abs - day * 1440;
  return { date: addDays(base, day), minute: Math.min(Math.max(m, ABS_OPEN), ABS_CLOSE) };
}

const jobLines = (plan: JobPlan, serials: Map<number, string[]>) =>
  plan.lines.map((l, i) => ({
    kind: l.kind,
    itemId: l.item.id,
    description: l.item.name,
    qty: l.qty,
    rate: l.item.rate,
    gstRate: l.item.gstRate,
    ...(l.item.hsn ? { hsn: l.item.hsn } : {}),
    unit: l.item.unit,
    ...(serials.get(i)?.length ? { serials: serials.get(i) } : {}),
  }));

async function freeSerials(ctx: HistoryCtx, itemId: string, qty: number, skip: Set<string>): Promise<string[] | null> {
  try {
    const page = await ctx.kit.serials.service.listUnits(ctx.tenant.id, { itemId, status: "in_stock", limit: qty + skip.size + 2 } as never);
    const units = page.items.map((u) => u.serial as string).filter((s) => !skip.has(s)).slice(0, qty);
    return units.length === qty ? units : null;
  } catch {
    return null;
  }
}

/** Business credit customers (schools, hostels): the buyers of bulk orders. */
const schoolsOf = (ctx: HistoryCtx) => {
  const credit = ctx.customers.filter((c) => c.planned.creditLimit !== null);
  const schools = credit.filter((c) => c.planned.gstin !== null);
  return schools.length ? schools : credit;
};

function customerOf(ctx: HistoryCtx, r: Rng, draft: BillDraft | null) {
  const c = draft?.customer;
  if (c) return { name: c.planned.name, phone: c.planned.phone, customerId: c.id, credit: c.planned.creditLimit !== null, payer: c.planned.payer };
  if (draft?.walkIn) return { name: draft.walkIn.name, phone: draft.walkIn.phone ?? testPhone(r.int(9000, 9999)), customerId: null, credit: false, payer: "regular" as const };
  const p = personName(r);
  return { name: p.name, phone: testPhone(r.int(9000, 9999)), customerId: null as string | null, credit: false, payer: "regular" as const };
}

const jobFields = (plan: JobPlan, trialDate: string | null = null): Record<string, unknown> => plan.garment ? { ...plan.garment, trialDate } : ({
  brand: plan.fields.brand,
  model: plan.fields.model,
  serial: plan.fields.serial,
  issue: plan.fields.issue,
  accessories: plan.fields.accessories,
  condition: plan.fields.condition,
});

type JobStatusStep = "received" | "diagnosed" | "awaiting_approval" | "approved" | "in_progress" | "trial" | "ready";
const ORDER: JobStatusStep[] = ["received", "diagnosed", "awaiting_approval", "approved", "in_progress", "trial", "ready"];

/**
 * Moves a job through its statuses up to `upTo`, each at its own time (`times[status]` = absolute minute from `base`).
 * The approval is answered online (the tracking page), by phone / WhatsApp / at the counter, or told at intake.
 */
async function advance(ctx: HistoryCtx, r: Rng, id: string, token: string, base: string, times: Partial<Record<JobStatusStep, number>>, upTo: JobStatusStep, needsApproval: boolean, device: Device, trial = false) {
  const garment = device === "garment";
  const svc = ctx.kit.jobcards.service;
  const t = ctx.tenant.id;
  // Seconds rise with each step, so two steps landing in the same minute stay in order (an approval older than the
  // request for it would not count).
  const at = (s: JobStatusStep) => {
    const m = moment(base, times[s] ?? 0);
    ctx.clock.set(m.date, m.minute, ORDER.indexOf(s) * 8 + r.int(0, 7));
  };
  const goes = (s: JobStatusStep) => ORDER.indexOf(s) <= ORDER.indexOf(upTo);
  if (goes("diagnosed")) {
    at("diagnosed");
    await svc.moveStatus(t, id, { status: "diagnosed", note: garment ? r.pick(["Measurements taken, cloth checked", "Measured and noted, cutting next", "Measurements and style confirmed"]) : r.pick(["Fault confirmed on the bench", "Tested, cause found", "Diagnosed, estimate prepared"]) });
  }
  if (goes("awaiting_approval") && needsApproval) {
    at("awaiting_approval");
    await svc.moveStatus(t, id, { status: "awaiting_approval", note: garment ? "Quote sent to the customer" : "Estimate sent to the customer" });
    if (goes("approved")) {
      at("approved");
      if (r.chance(0.4)) await svc.publicRespond(t, token, { decision: "approve" }, { ip: "203.0.113.20", userAgent: "demo-history" });
      else await svc.recordApproval(t, id, { decision: "approved", channel: r.pick(["phone", "whatsapp", "in_person"] as const), at: ctx.clock.now() });
    }
  } else if (goes("approved") && !needsApproval && r.chance(0.5)) {
    at("approved");
    await svc.recordApproval(t, id, { decision: "approved", channel: "in_person", at: ctx.clock.now(), note: garment ? "Told the price and date at the counter" : "Told the price at intake" });
  }
  if (goes("in_progress")) {
    at("in_progress");
    await svc.moveStatus(t, id, { status: "in_progress", note: garment ? r.pick(["Cut and with the tailor", "Stitching started", "On the machine", null]) : r.chance(0.3) ? "Part collected, repair started" : null });
  }
  if (goes("trial") && (garment ? trial : (device === "tv" || device === "ac" || device === "appliance") && r.chance(0.7))) {
    at("trial");
    await svc.moveStatus(t, id, { status: "trial", note: garment ? r.pick(["Fitting done, changes marked", "Trial: take in half an inch", "Trial fitted well, finishing", "Trial: sleeve to be shortened"]) : "Running test under load" });
  }
  if (goes("ready")) {
    at("ready");
    await svc.moveStatus(t, id, { status: "ready", note: garment ? r.pick(["Pressed and tagged", "Ready for pickup", "Stitched, pressed, packed"]) : r.pick(["Tested and cleaned", "Ready for pickup", "Repair done, tested"]) });
  }
}

/** Times of each step spread over [start, end] (absolute minutes from the base date). */
function spread(r: Rng, start: number, end: number): Record<JobStatusStep, number> {
  const span = Math.max(end - start, 30);
  const at = (a: number, b: number) => Math.round(start + span * r.float(a, b));
  const times = { received: start, diagnosed: at(0.08, 0.2), awaiting_approval: at(0.2, 0.3), approved: at(0.3, 0.45), in_progress: at(0.45, 0.6), trial: at(0.62, 0.72), ready: at(0.8, 0.92) };
  // Strictly in order.
  let last = start;
  for (const s of ORDER) {
    times[s] = Math.max(times[s], last);
    last = times[s];
  }
  return times;
}

function assignee(ctx: HistoryCtx, device: Device, tailor?: string) {
  const st = states.get(ctx)!;
  const name = tailor ?? (device === "garment" ? "Selvi Murugesan" : TECHS[device]);
  return { assigneeName: name, assigneeUserId: st.assignees.get(name) ?? null };
}

async function openJob(ctx: HistoryCtx, r: Rng, plan: JobPlan, who: ReturnType<typeof customerOf>, when: { date: string; minute: number }, dueDate: string | null, serials: Map<number, string[]>, advancePaise: number) {
  ctx.clock.set(when.date, when.minute, r.int(0, 59));
  return ctx.kit.jobcards.service.create(
    ctx.tenant.id,
    {
      template: plan.garment ? "garment" : "device",
      fields: jobFields(plan, trialDateFor(plan, when.date, dueDate)),
      customerName: who.name,
      customerPhone: who.phone,
      customerId: who.customerId,
      dueDate,
      priority: r.chance(0.08) ? "urgent" : "normal",
      advance: advancePaise,
      notes: r.chance(0.25) ? r.pick(plan.garment ? ["Customer will collect after 6 pm", "Call before delivering", "Needed for a function on Sunday", "Fabric brought by the customer, 2.5 m", "Matching saree brought for the fitting"] : ["Customer will collect after 6 pm", "Call before delivering", "Data backed up before repair", "Needs the bill for office reimbursement"]) : null,
      ...assignee(ctx, plan.recipe.device, plan.recipe.tailor),
      lines: jobLines(plan, serials),
    },
    null,
  );
}

/** A trial a day before it is due (never before the job opens), only for garments that have a fitting. */
const trialDateFor = (plan: JobPlan, openDate: string, dueDate: string | null) => {
  if (!plan.garment || !plan.recipe.trial || !dueDate) return null;
  const d = addDays(dueDate, -1);
  return d >= openDate ? d : null;
};

const advanceFor = (r: Rng, total: number, garments = false) =>
  garments
    ? total >= 80_000 && r.chance(0.75)
      ? Math.min(Math.round((total * r.float(0.25, 0.5)) / 5_000) * 5_000, total - 5_000)
      : 0
    : total >= 250_000 && r.chance(0.7)
      ? Math.round((total * r.float(0.2, 0.3)) / 10_000) * 10_000
      : 0;

export const jobcardsHook: IndustryHook = {
  id: "jobcards",

  async prepare(ctx) {
    const enabled = await ctx.kit.features.service.isEnabled(ctx.tenant.id, "jobcards").catch(() => false);
    const serials = await ctx.kit.features.service.isEnabled(ctx.tenant.id, "serials").catch(() => false);
    const assignees = new Map<string, string | null>();
    try {
      for (const m of await ctx.kit.staff.service.listMembers(ctx.tenant.id)) if (m.name) assignees.set(m.name, m.userId);
    } catch {
      // The job cards then carry the technician's name only.
    }
    const garments = ctx.profile.id === "tailoring";
    states.set(ctx, { enabled, recipes: garments ? GARMENT_RECIPES : RECIPES, garments, serials, assignees, delivered: [], plans: new WeakMap() });
    // The people who work the counter and the bench are the shop's real staff (names on tills, salaries, job cards).
    ctx.staff.splice(0, ctx.staff.length, ...(garments ? GARMENT_STAFF : REAL_STAFF));
  },

  shapeBill(ctx, draft) {
    const st = states.get(ctx);
    if (!st?.enabled) return;
    const plan = planFor(ctx, draft.rng, { serials: st.serials });
    if (!plan) return;
    st.plans.set(draft, plan);
    // A bulk order (school uniforms) is for a business on credit: a school with a GSTIN, else any credit customer.
    if (plan.recipe.bulk) {
      if (!(draft.customer?.planned.gstin != null)) {
        const pool = schoolsOf(ctx);
        if (pool.length) draft.customer = draft.rng.pick(pool);
      }
    } else if (st.garments && draft.customer?.planned.gstin != null && !/Boutique/.test(draft.customer.planned.name) && draft.rng.chance(0.85)) {
      // A school does not bring a single alteration: an ordinary customer instead.
      draft.customer = null;
    }
    // The bill lines are the job's lines: the engine keeps its stock counts in step with them.
    draft.lines = plan.lines.map((l): BillLine => ({ item: l.item, qty: l.qty }));
  },

  async issueBill(ctx, draft, session) {
    const st = states.get(ctx);
    const plan = st?.plans.get(draft);
    if (!st || !plan || !session) return null;
    const r = draft.rng.fork("job");
    const svc = ctx.kit.jobcards.service;
    const t = ctx.tenant.id;
    let jobId: string | null = null;
    try {
      // Serial units for the serial parts (a unit can't go on two jobs).
      const serials = new Map<number, string[]>();
      const taken = new Set<string>();
      for (const [i, l] of plan.lines.entries()) {
        if (!l.serialPart) continue;
        const units = await freeSerials(ctx, l.item.id, l.qty, taken);
        if (!units) return null;
        units.forEach((u) => taken.add(u));
        serials.set(i, units);
      }
      const who = customerOf(ctx, r, draft);
      // Timeline: intake `days` earlier (same day for quick repairs), delivery now.
      let days = r.int(plan.recipe.days[0], plan.recipe.days[1]);
      const deliverAbs = draft.minute;
      // Keep the whole job inside the simulated window.
      while (days > 0 && addDays(draft.date, -days) < ctx.windowStart) days--;
      let start = days > 0 ? -days * 1440 + r.int(10 * 60, 17 * 60 + 30) : deliverAbs - r.int(70, 260);
      if (days === 0 && start < ABS_OPEN) start = ABS_OPEN + r.int(0, 30);
      if (start > deliverAbs - 45) start = Math.max(ABS_OPEN - 30, deliverAbs - 45);
      const startMoment = moment(draft.date, start);
      const times = spread(r, start, deliverAbs - r.int(10, 40));
      const due = addDays(draft.date, 0);
      const created = await openJob(ctx, r, plan, who, startMoment, due, serials, advanceFor(r, plan.total, !!plan.garment));
      jobId = created.id;
      const needsApproval = !!plan.recipe.approval || plan.total >= 400_000;
      await advance(ctx, r, created.id, created.trackToken, draft.date, times, "ready", needsApproval, plan.recipe.device, !!plan.recipe.trial);
      // Bill and hand over.
      ctx.clock.set(draft.date, draft.minute, r.int(0, 30));
      const terms = who.payer === "regular" ? 15 : 30;
      const { bill } = await svc.bill(ctx.tenant, created.id, { tillSessionId: session.id, ...(who.credit ? { dueDate: addDays(draft.date, terms) } : {}) }, { branchId: null });
      ctx.clock.set(draft.date, draft.minute, 58);
      await svc.moveStatus(t, created.id, { status: "delivered", note: r.pick(["Collected by the customer", "Collected, bill explained", "Delivered at the counter"]) });
      const inv = await ctx.kit.invoices.service.get(t, bill.id);
      st.delivered.push({ id: created.id, label: created.label, name: who.name, phone: who.phone, customerId: who.customerId, date: draft.date, device: plan.recipe.device, fields: jobFields(plan, trialDateFor(plan, startMoment.date, due)) });
      const out: IssuedBill = { id: bill.id, number: bill.number, total: bill.total, paid: inv.paid, lines: [] };
      return [out];
    } catch (err) {
      ctx.log.warn({ err: err instanceof Error ? err.message : err, date: draft.date }, "jobcards: job failed, billing at the counter");
      ctx.clock.set(draft.date, draft.minute, 59);
      if (jobId) await svc.cancel(t, jobId, { reason: "Entered again at the counter" }).catch(() => undefined);
      return null;
    }
  },

  async beginDay(ctx, day) {
    const st = states.get(ctx);
    if (!st?.enabled || day.closed) return;
    const r = ctx.rng(`jobs:${day.date}`);
    const svc = ctx.kit.jobcards.service;
    const t = ctx.tenant.id;
    const date = day.date;
    const age = daysBetween(date, ctx.today);
    const nowAbs = date === ctx.today ? ctx.nowMinutes - 2 : 20 * 60;
    const guard = (abs: number) => Math.min(abs, nowAbs);

    const run = async (label: string, fn: () => Promise<void>) => {
      try {
        await fn();
      } catch (err) {
        ctx.log.warn({ err: err instanceof Error ? err.message : err, date, label }, "jobcards: extra job failed");
      }
    };

    // 1. A cancelled job now and then: the customer declined the estimate (or never came back).
    if (r.chance(0.06) && age >= 1) {
      await run("cancelled", async () => {
        const plan = planFor(ctx, r, { serials: false, recipes: st.garments ? st.recipes.filter((x) => !!x.approval && !x.bulk) : undefined });
        if (!plan) return;
        const who = customerOf(ctx, r, null);
        const start = 10 * 60 + r.int(0, 300);
        const times = spread(r, start, start + 20 * 60);
        const job = await openJob(ctx, r, plan, who, { date, minute: guard(start) }, null, new Map(), 0);
        await advance(ctx, r, job.id, job.trackToken, date, times, "awaiting_approval", true, plan.recipe.device);
        const m = moment(date, times.awaiting_approval + r.int(30, 240));
        ctx.clock.set(m.date, m.minute, 5);
        if (r.chance(0.7)) await svc.recordApproval(t, job.id, { decision: "declined", channel: r.pick(["phone", "whatsapp", "in_person"] as const), at: ctx.clock.now(), note: st.garments ? r.pick(["Too costly, will buy it ready-made", "Will stitch it elsewhere", "Changed the design, will come again"]) : r.pick(["Too costly, will buy a new one", "Will repair at another shop", "Not worth it for an old device"]) });
        ctx.clock.set(date, guard(Math.min(m.minute + 40, 20 * 60)), 10);
        await svc.cancel(t, job.id, { reason: st.garments ? r.pick(["Customer declined the quote and collected the cloth", "Customer did not come for the trial", "Customer changed the design and will re-order", "Customer bought it ready-made"]) : r.pick(["Customer declined the estimate and collected the device", "Not repairable: board damaged beyond repair", "Customer did not respond for a week", "Customer bought a new one"]) });
      });
    }

    // 2. A warranty re-repair, free of charge, for a customer repaired at least a fortnight ago.
    const old = st.delivered.filter((d) => daysBetween(d.date, date) >= (st.garments ? 3 : 14) && (!st.garments || (d.device === "garment" && daysBetween(d.date, date) <= 7)));
    if (old.length && r.chance(st.garments ? 0.06 : 0.04)) {
      await run("warranty", async () => {
        const src = r.pick(old);
        const start = 10 * 60 + r.int(0, 360);
        ctx.clock.set(date, guard(start), r.int(0, 59));
        const job = await svc.create(
          t,
          {
            template: src.device === "garment" ? "garment" : "device",
            fields: src.device === "garment" ? { ...src.fields, trialDate: null } : src.fields,
            customerName: src.name,
            customerPhone: src.phone,
            customerId: src.customerId,
            dueDate: date,
            notes: src.device === "garment" ? `Free alteration within 7 days of ${src.label} (delivered ${src.date}). No charge.` : `Warranty claim on ${src.label} (delivered ${src.date}). No charge.`,
            ...assignee(ctx, src.device),
            lines: src.device === "garment" ? [{ kind: "labour", description: "Free alteration (no charge)", qty: 1, rate: 0, gstRate: 0 }] : [
              { kind: "labour", description: "Warranty re-repair (no charge)", qty: 1, rate: 0, gstRate: 0 },
              { kind: "part", description: "Replacement part under warranty", qty: 1, rate: 0, gstRate: 0 },
            ],
          },
          null,
        );
        const times = spread(r, start, start + r.int(90, 300));
        await advance(ctx, r, job.id, job.trackToken, date, times, "ready", false, src.device);
        ctx.clock.set(date, guard(Math.min(times.ready + 25, 20 * 60)), 20);
        await svc.moveStatus(t, job.id, { status: "delivered", note: src.device === "garment" ? "Altered and collected" : "Warranty repair collected" });
      });
    }

    // 3. Open jobs on the board: the last two weeks, in every status.
    const OPEN: Record<number, JobStatusStep[]> = {
      0: ["received", "diagnosed", "ready"],
      1: ["in_progress", "awaiting_approval", "trial"],
      2: ["approved", "ready"],
      3: ["awaiting_approval", "ready"],
      4: ["in_progress"],
      5: ["awaiting_approval"],
      6: ["ready"],
      8: ["ready"],
      10: ["awaiting_approval"],
      13: ["in_progress"],
    };
    // A workroom has more jobs in flight (a blouse takes days, a uniform order weeks), so more open ones on the board.
    const OPEN_G: Record<number, JobStatusStep[]> = {
      0: ["received", "received", "in_progress", "ready"],
      1: ["in_progress", "trial", "awaiting_approval", "ready"],
      2: ["in_progress", "trial", "approved"],
      3: ["in_progress", "trial", "ready"],
      4: ["in_progress", "ready"],
      5: ["in_progress", "trial"],
      6: ["ready", "in_progress"],
      7: ["trial"],
      8: ["ready"],
      10: ["awaiting_approval", "ready"],
      13: ["in_progress"],
    };
    for (const [i, status] of ((st.garments ? OPEN_G : OPEN)[age] ?? []).entries()) {
      await run(`open-${status}`, async () => {
        const rr = r.fork(`open${i}`);
        // Estimates (awaiting approval / approved / in progress) are bigger jobs; trial is a TV, AC or appliance.
        const pool = st.recipes.filter((x) => (status === "trial" ? (x.device === "garment" ? !!x.trial : x.device === "tv" || x.device === "ac" || x.device === "appliance") : status === "awaiting_approval" || status === "approved" ? !!x.approval : true));
        const plan = planFor(ctx, rr, { serials: false, recipes: pool });
        if (!plan) return;
        const school = plan.recipe.bulk ? schoolsOf(ctx) : [];
        const who = customerOf(ctx, rr, school.length ? ({ customer: rr.pick(school) } as BillDraft) : null);
        const start = date === ctx.today ? Math.max(ABS_OPEN, Math.min(10 * 60 + i * 45 + rr.int(0, 40), nowAbs - 150)) : 10 * 60 + rr.int(0, 360);
        const end = date === ctx.today ? Math.max(start + 40, nowAbs - 10) : start + 24 * 60 * Math.min(age, 3);
        const times = spread(rr, start, Math.max(end, start + 60));
        const dueOffset = status === "in_progress" && age >= 4 ? -2 : status === "awaiting_approval" ? 1 : 1;
        const due = addDays(ctx.today, dueOffset);
        const job = await openJob(ctx, rr, plan, who, { date, minute: guard(start) }, due, new Map(), age >= 1 ? advanceFor(rr, plan.total, !!plan.garment) : 0);
        const needsApproval = !!plan.recipe.approval || plan.total >= 400_000 || status === "awaiting_approval" || status === "approved";
        await advance(ctx, rr, job.id, job.trackToken, date, times, status, needsApproval, plan.recipe.device, !!plan.recipe.trial);
        // Awaiting approval stops at the question.
        if (status === "awaiting_approval") return;
      });
    }
  },
};
