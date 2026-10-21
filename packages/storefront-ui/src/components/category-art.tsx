import * as React from "react";
import {
  BabyIcon,
  BackpackIcon,
  BandageIcon,
  BeefIcon,
  BicepsFlexedIcon,
  BookOpenIcon,
  BrickWallIcon,
  BrushIcon,
  CakeIcon,
  CakeSliceIcon,
  CameraIcon,
  CandyIcon,
  CarrotIcon,
  CoffeeIcon,
  CookingPotIcon,
  CroissantIcon,
  CrownIcon,
  CupSodaIcon,
  DrillIcon,
  DropletIcon,
  DropletsIcon,
  DrumstickIcon,
  DumbbellIcon,
  EggIcon,
  EyeIcon,
  FishIcon,
  FlameIcon,
  FlaskConicalIcon,
  FlowerIcon,
  FootprintsIcon,
  Gamepad2Icon,
  GemIcon,
  GiftIcon,
  GlassesIcon,
  HamburgerIcon,
  HammerIcon,
  HandIcon,
  HandPlatterIcon,
  HardHatIcon,
  HeadphonesIcon,
  HeartPulseIcon,
  IceCreamBowlIcon,
  IdCardIcon,
  LampIcon,
  LaptopIcon,
  LeafyGreenIcon,
  LightbulbIcon,
  LinkIcon,
  MicrowaveIcon,
  MilkIcon,
  NutIcon,
  PaintRollerIcon,
  PawPrintIcon,
  PillIcon,
  PizzaIcon,
  PlugZapIcon,
  PopcornIcon,
  PrinterIcon,
  RefrigeratorIcon,
  RulerIcon,
  ScanEyeIcon,
  ScissorsIcon,
  ShirtIcon,
  ShoppingBagIcon,
  ShovelIcon,
  ShrimpIcon,
  SmartphoneIcon,
  SoapDispenserDropletIcon,
  SoupIcon,
  SpeakerIcon,
  SparklesIcon,
  SpoolIcon,
  SprayCanIcon,
  SproutIcon,
  StethoscopeIcon,
  SunIcon,
  TabletIcon,
  TagIcon,
  ThermometerSnowflakeIcon,
  TicketPercentIcon,
  ToyBrickIcon,
  TvIcon,
  UtensilsIcon,
  WalletIcon,
  WashingMachineIcon,
  WatchIcon,
  WheatIcon,
  WrenchIcon,
  ZapIcon,
  AppleIcon,
  ArmchairIcon,
  type LucideProps,
} from "lucide-react";
import { cn } from "@srirealtime/ui/lib/utils";
import { imageUrl } from "../lib/format";
import { StoreImage } from "./bits";

/*
 * Category art: the category's photo, or — when a shop hasn't added one — a designed fallback instead of initials: an
 * icon picked from the category name/slug (`categoryIconKey`, keyword rules covering the trades we serve) on a brand
 * tint that rotates per tile (`tone`, six analogous shades of --primary, see styles.css `.sf-cat-art`), with a soft
 * halo + dot pattern. `bold` is the saturated version for tiles that carry white text on top.
 */

type Icon = React.ComponentType<LucideProps>;

/** Line glyphs lucide lacks (same 24px grid and stroke as lucide). */
const glyph = (name: string, body: React.ReactNode): Icon => {
  const G = ({ className, strokeWidth = 2, ...rest }: LucideProps) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} {...(rest as React.SVGProps<SVGSVGElement>)}>
      {body}
    </svg>
  );
  G.displayName = name;
  return G;
};
const SareeIcon = glyph(
  "SareeIcon",
  <>
    <circle cx="12" cy="4" r="2" />
    <path d="M9 8.5h6l2.5 12.5h-11z" />
    <path d="M15 8.5 8.2 14.5" />
    <path d="M7 18h10" />
  </>,
);
const DressIcon = glyph(
  "DressIcon",
  <>
    <path d="m9.5 2.5.5 3.5" />
    <path d="m14.5 2.5-.5 3.5" />
    <path d="M10 6h4l1 4H9z" />
    <path d="M9 10 5.5 21h13L15 10" />
  </>,
);
const TrousersIcon = glyph(
  "TrousersIcon",
  <>
    <path d="M7 3h10l1.5 18h-4.5L12 10l-2 11H5.5z" />
    <path d="M7 6h10" />
  </>,
);
const RingIcon = glyph(
  "RingIcon",
  <>
    <circle cx="12" cy="15" r="6" />
    <path d="M10 3h4l1.5 2.5L12 9 8.5 5.5z" />
  </>,
);
const NecklaceIcon = glyph(
  "NecklaceIcon",
  <>
    <path d="M5 3c0 5.5 3 9.5 7 9.5S19 8.5 19 3" />
    <path d="m12 12.5-2.5 3.5 2.5 4 2.5-4z" />
  </>,
);
const BangleIcon = glyph(
  "BangleIcon",
  <>
    <ellipse cx="12" cy="12" rx="9" ry="6" />
    <ellipse cx="12" cy="12" rx="5.5" ry="3" />
  </>,
);
const EarringIcon = glyph(
  "EarringIcon",
  <>
    <circle cx="12" cy="3.5" r="1.5" />
    <path d="M12 5v3" />
    <path d="M12 8 8 15a4 4 0 0 0 8 0z" />
    <path d="M10 20.5h4" />
  </>,
);

export const CATEGORY_ICONS = {
  saree: SareeIcon,
  shirt: ShirtIcon,
  bottoms: TrousersIcon,
  dress: DressIcon,
  kids: ToyBrickIcon,
  baby: BabyIcon,
  watch: WatchIcon,
  footwear: FootprintsIcon,
  bag: ShoppingBagIcon,
  backpack: BackpackIcon,
  wallet: WalletIcon,
  phone: SmartphoneIcon,
  laptop: LaptopIcon,
  tablet: TabletIcon,
  tv: TvIcon,
  audio: HeadphonesIcon,
  speaker: SpeakerIcon,
  camera: CameraIcon,
  gaming: Gamepad2Icon,
  printer: PrinterIcon,
  fridge: RefrigeratorIcon,
  washer: WashingMachineIcon,
  kitchen: MicrowaveIcon,
  charger: PlugZapIcon,
  medicine: PillIcon,
  wellness: HeartPulseIcon,
  personal: SoapDispenserDropletIcon,
  device: StethoscopeIcon,
  firstAid: BandageIcon,
  starter: HandPlatterIcon,
  main: CookingPotIcon,
  meal: UtensilsIcon,
  rice: SoupIcon,
  bread: CroissantIcon,
  dessert: IceCreamBowlIcon,
  sweets: CandyIcon,
  coffee: CoffeeIcon,
  drink: CupSodaIcon,
  snack: PopcornIcon,
  pizza: PizzaIcon,
  burger: HamburgerIcon,
  vegetable: CarrotIcon,
  greens: LeafyGreenIcon,
  fruit: AppleIcon,
  dairy: MilkIcon,
  egg: EggIcon,
  staples: WheatIcon,
  oil: DropletIcon,
  spice: FlameIcon,
  chicken: DrumstickIcon,
  meat: BeefIcon,
  fish: FishIcon,
  prawn: ShrimpIcon,
  cake: CakeIcon,
  pastry: CakeSliceIcon,
  organic: SproutIcon,
  nuts: NutIcon,
  frozen: ThermometerSnowflakeIcon,
  cleaning: SprayCanIcon,
  ring: RingIcon,
  necklace: NecklaceIcon,
  bangle: BangleIcon,
  earring: EarringIcon,
  chain: LinkIcon,
  jewel: GemIcon,
  bridal: CrownIcon,
  hair: ScissorsIcon,
  skin: DropletsIcon,
  spa: FlowerIcon,
  makeup: BrushIcon,
  nails: HandIcon,
  gym: DumbbellIcon,
  training: BicepsFlexedIcon,
  membership: IdCardIcon,
  supplement: FlaskConicalIcon,
  tools: WrenchIcon,
  hammer: HammerIcon,
  drill: DrillIcon,
  paint: PaintRollerIcon,
  plumbing: DropletsIcon,
  electrical: ZapIcon,
  lighting: LightbulbIcon,
  cement: BrickWallIcon,
  safety: HardHatIcon,
  garden: ShovelIcon,
  frames: GlassesIcon,
  lenses: EyeIcon,
  sunglasses: SunIcon,
  eyeTest: ScanEyeIcon,
  tailoring: ScissorsIcon,
  blouse: SpoolIcon,
  alteration: RulerIcon,
  gift: GiftIcon,
  decor: LampIcon,
  furniture: ArmchairIcon,
  books: BookOpenIcon,
  toys: ToyBrickIcon,
  pets: PawPrintIcon,
  offers: TicketPercentIcon,
  newIn: SparklesIcon,
  tag: TagIcon,
} satisfies Record<string, Icon>;
export type CategoryIconKey = keyof typeof CATEGORY_ICONS;

/*
 * Keyword rules, most specific first (baby care before personal care, sunglasses before glasses, earrings before
 * rings, biryani before rice). Each pattern is matched against "name slug-as-words", lower-cased; word starts are
 * anchored so "men" doesn't hit "women" and "ring" doesn't hit "earring".
 */
const RULES: [CategoryIconKey, RegExp][] = [
  ["baby", /\b(bab(y|ies)|infant|diaper|toddler|newborn)/],
  ["sunglasses", /\b(sun ?glass|shades|goggle|aviator)/],
  ["lenses", /\b(lens|contacts?\b)/],
  ["eyeTest", /\b(eye ?(test|check)|optometr)/],
  ["frames", /\b(frames?\b|spectacle|eye ?glass|eyewear|optical|glasses|specs\b)/],
  ["earring", /\b(ear ?rings?|jhumk|studs?\b)/],
  ["necklace", /\b(necklace|haram|pendant|mangalsutra|choker|mala\b)/],
  ["bangle", /\b(bangle|bracelet|kada|valayal|anklet|kolusu)/],
  ["chain", /\b(chains?\b)/],
  ["ring", /\b(rings?\b|mothiram)/],
  ["jewel", /\b(jewel|silver|gold|diamond|platinum|gem|coins?\b)/],
  ["bridal", /\b(bridal|bride|wedding)/],
  ["blouse", /\b(blouse|stitching|embroider|aari)/],
  ["alteration", /\b(alter|measure|fitting)/],
  ["tailoring", /\b(tailor|uniform)/],
  ["saree", /\b(sarees?|sari\b|saris\b|silk|pattu|veshti|dhoti|handloom|cotton saree)/],
  ["kids", /\b(kids?|child|junior)/],
  ["footwear", /\b(foot ?wear|shoes?|sandals?|chappal|slippers?|heels|sneakers?|boots?\b)/],
  ["bottoms", /\b(bottoms?|jeans|trousers?|pants?\b|leggings?|palazzo|skirts?|shorts|track ?pants|chinos)/],
  ["dress", /\b(dress|gown|lehenga|frock|anarkali|ethnic|women|ladies|girls?\b)/],
  ["shirt", /\b(shirts?|t-?shirts?|tees?\b|tops?\b|kurti|kurta|salwar|churidar|polo|men\b|mens\b|gents|boys?\b|apparel|clothing|wear\b|western)/],
  ["backpack", /\b(backpack|school bag)/],
  ["wallet", /\b(wallet|purse)/],
  ["bag", /\b(bags?\b|handbag|luggage|clutch)/],
  ["watch", /\b(watch|smart ?watch)/],
  ["charger", /\b(charger|cables?|power ?bank|adapter|plug)/],
  ["phone", /\b(mobiles?|phones?|smartphone|iphone|android)/],
  ["laptop", /\b(laptop|computer|notebook|desktop|pc\b|macbook)/],
  ["tablet", /\b(ipad)/],
  ["tv", /\b(tvs?\b|television|monitor|led tv|smart tv)/],
  ["speaker", /\b(speaker|soundbar|home theat)/],
  ["audio", /\b(audio|headphone|earphone|ear ?buds|headset|music)/],
  ["camera", /\b(camera|cctv|dslr)/],
  ["gaming", /\b(gaming|games?\b|console|playstation|xbox)/],
  ["printer", /\b(printer|ink|toner)/],
  ["watch", /\baccessor/],
  ["washer", /\b(washing|washer|dryer)/],
  ["fridge", /\b(fridge|refrigerator|freezer|appliance|air ?condition|\bac\b)/],
  ["kitchen", /\b(kitchen|mixer|grinder|microwave|oven|cooker)/],
  ["device", /\b(devices?|bp\b|glucometer|thermometer|nebuli|oximeter|medical equip)/],
  ["firstAid", /\b(first ?aid|bandage|ortho)/],
  ["personal", /\b(personal|hygiene|soap|shampoo|toiletr|oral|tooth|deo)/],
  ["supplement", /\b(supplement|protein|whey|creatine|pre-?workout)/],
  ["medicine", /\b(medicine|tablets?|capsule|syrup|pharma|rx\b|prescription|generic|drugs?\b|ointment)/],
  ["wellness", /\b(wellness|vitamin|ayurved|health|immunity|herbal|siddha)/],
  ["membership", /\b(membership|plans?\b|pass(es)?\b|subscription)/],
  ["training", /\b(personal training|trainer|coaching|crossfit|strength)/],
  ["gym", /\b(gym|workout|fitness|cardio|yoga|zumba|exercise)/],
  ["hair", /\b(hair|cut\b|haircut|beard|groom|shave|barber)/],
  ["nails", /\b(nails?|manicure|pedicure)/],
  ["makeup", /\b(make ?up|cosmetic|lipstick|mehendi|mehndi|beauty)/],
  ["skin", /\b(skin|facial|cleanup|wax|threading|glow)/],
  ["spa", /\b(spa\b|massage|therapy|relax)/],
  ["rice", /\b(biryani|pulao|fried rice|rice bowl|noodles|chinese)/],
  ["starter", /\b(starters?|appeti[sz]er|tikka|kebab|tandoor|chaat)/],
  ["meal", /\b(meals?\b|thali|combo|lunch|dinner|tiffin|breakfast|south indian|north indian)/],
  ["main", /\b(main|curry|curries|gravy|course)/],
  ["pizza", /\b(pizza|pasta|italian)/],
  ["burger", /\b(burger|sandwich|wrap|rolls?\b)/],
  ["bread", /\b(breads?|roti|naan|paratha|chapat|parotta|bun|bakery)/],
  ["cake", /\b(cakes?\b|cupcake|birthday)/],
  ["pastry", /\b(pastr|brownie|muffin|cookie)/],
  ["sweets", /\b(sweets?|mithai|halwa|laddu|chocolate|candy)/],
  ["dessert", /\b(dessert|ice ?cream|kulfi|falooda|pudding)/],
  ["coffee", /\b(coffee|tea\b|chai)/],
  ["drink", /\b(beverage|drinks?|juice|shake|lassi|soda|mocktail|water)/],
  ["snack", /\b(snacks?|chips|namkeen|savour|murukku|mixture|bites)/],
  ["meat", /\bnon-?veg/],
  ["greens", /\b(greens|leafy|keerai|herbs?\b)/],
  ["vegetable", /\b(vegetables?|veggies?|veg\b|sabzi|kaai)/],
  ["fruit", /\b(fruits?|apple|banana|mango)/],
  ["dairy", /\b(dairy|milk|curd|paneer|ghee|butter|cheese|yog(h)?urt)/],
  ["egg", /\b(eggs?\b)/],
  ["oil", /\b(oils?\b)/],
  ["spice", /\b(spice|masala|chilli|pepper|condiment|pooja)/],
  ["nuts", /\b(dry ?fruit|nuts?\b|cashew|almond)/],
  ["organic", /\b(organic|millet|natural)/],
  ["staples", /\b(staples?|atta|flour|rice|dal\b|dhal|pulses|grains?|grocery|provision)/],
  ["chicken", /\b(chicken|poultry|wings)/],
  ["prawn", /\b(prawns?|shrimps?|crab)/],
  ["fish", /\b(fish|seafood|meen)/],
  ["meat", /\b(meat|mutton|lamb|beef|pork|non-?veg)/],
  ["frozen", /\b(frozen|ice\b)/],
  ["cleaning", /\b(clean|detergent|household|home care)/],
  ["paint", /\b(paint|primer|putty|colou?rs?\b)/],
  ["plumbing", /\b(plumb|pipes?|taps?\b|sanitary|bath|fittings)/],
  ["lighting", /\b(light|bulb|lamp\b|led\b)/],
  ["electrical", /\b(electric|wires?|switch|cables?|fans?\b)/],
  ["cement", /\b(cement|building|construct|bricks?|steel|tiles?\b|sand\b)/],
  ["drill", /\b(power tools?|drill)/],
  ["hammer", /\b(hand tools?|hammer|hardware)/],
  ["tools", /\b(tools?|spanner|wrench|repair|service)/],
  ["safety", /\b(safety|helmet|gloves)/],
  ["garden", /\b(garden|plants?|seeds?|pots?\b)/],
  ["gift", /\b(gifts?|hamper|combo)/],
  ["furniture", /\b(furniture|sofa|chairs?|tables?\b)/],
  ["decor", /\b(home|decor|living)/],
  ["books", /\b(books?|stationery|pens?\b|school)/],
  ["toys", /\b(toys?|puzzle)/],
  ["pets", /\b(pets?|dog|cat\b)/],
  ["offers", /\b(offers?|sale|deals?|discount|clearance)/],
  ["newIn", /\b(new|arrival|latest|trending|featured|best ?sell)/],
];

/** The icon for a category, from its name and slug ("tag" when nothing matches). Pure: same input, same icon. */
export function categoryIconKey(name: string, slug = ""): CategoryIconKey {
  const text = ` ${name} ${slug.replace(/[-_]+/g, " ")} `.toLowerCase();
  for (const [key, re] of RULES) if (re.test(text)) return key;
  return "tag";
}

/** How many brand tints the fallback rotates through (styles.css `.sf-cat-art[data-tone]`). */
export const CATEGORY_TONES = 6;

/**
 * A category's picture (object-cover), or the icon fallback. Fills its box (give the parent a size / aspect ratio).
 * `alt` "" = decorative (the name is printed next to it).
 */
export function CategoryArt({
  name,
  slug,
  image,
  tone = 0,
  bold,
  compact,
  alt = "",
  eager,
  sizes,
  className,
  imageClassName,
}: {
  name: string;
  slug?: string;
  image: string | null | undefined;
  tone?: number;
  bold?: boolean;
  /** Small chips: a flat tint and a bigger icon. */
  compact?: boolean;
  alt?: string;
  eager?: boolean;
  sizes?: string;
  className?: string;
  /** Extra classes for the photo only (hover zoom). */
  imageClassName?: string;
}) {
  if (imageUrl(image)) return <StoreImage src={image} alt={alt} name={name} eager={eager} sizes={sizes} className={cn(className, imageClassName)} />;
  const key = categoryIconKey(name, slug);
  const Icon = CATEGORY_ICONS[key];
  return (
    <span
      {...(alt ? { role: "img", "aria-label": alt } : { "aria-hidden": true })}
      data-tone={((tone % CATEGORY_TONES) + CATEGORY_TONES) % CATEGORY_TONES}
      data-bold={bold ? "" : undefined}
      data-compact={compact ? "" : undefined}
      data-cat-icon={key}
      className={cn("sf-cat-art", className)}
    >
      <Icon className="sf-cat-art-icon" strokeWidth={1.6} aria-hidden />
    </span>
  );
}
