import * as React from "react";
import {
  ArmchairIcon, CakeIcon, CoffeeIcon, CookingPotIcon, DumbbellIcon, FishIcon, FlameIcon, FlowerIcon, FootprintsIcon, GemIcon, GiftIcon, GlassesIcon,
  HammerIcon, HeadphonesIcon, LeafIcon, PawPrintIcon, PillIcon, PuzzleIcon, ScissorsIcon, ShirtIcon, ShoppingBasketIcon, SmartphoneIcon, SparklesIcon,
  TrophyIcon, UtensilsCrossedIcon, WrenchIcon, BookOpenIcon, CpuIcon, FlaskConicalIcon, GraduationCapIcon,
  BoneIcon, CameraIcon, CarIcon, ChefHatIcon, LayersIcon, MusicIcon, PaintRollerIcon, PartyPopperIcon, PrinterIcon, ReceiptIcon, SnowflakeIcon, StoreIcon, WashingMachineIcon, ZapIcon, LayoutGridIcon, BriefcaseIcon, BikeIcon, SproutIcon, CogIcon,
} from "lucide-react";
import type { Translator } from "@rbms/i18n/client";
import { Card } from "@rbms/ui/components/card";
import { RevealGroup, RevealItem } from "@rbms/ui/motion";
import { cn } from "@rbms/ui/lib/utils";
import { demoStoreUrl } from "@/lib/site";
import { DEMO_SLUG, tradeName, type BusinessType } from "@/lib/trades";
import { Lift } from "./motion-bits";

const ICONS: Record<BusinessType, React.ComponentType<{ className?: string }>> = {
  grocery: ShoppingBasketIcon, bakery: CakeIcon, fresh: FishIcon, organic: LeafIcon, restaurant: UtensilsCrossedIcon, cloud_kitchen: CookingPotIcon, tea_stall: CoffeeIcon,
  fashion: ShirtIcon, footwear: FootprintsIcon, jewellery: GemIcon, cosmetics: SparklesIcon, home_decor: GiftIcon, furniture: ArmchairIcon, florist_pooja: FlowerIcon, crackers: FlameIcon,
  pharmacy: PillIcon, optical: GlassesIcon, salon: ScissorsIcon, spa: FlaskConicalIcon, gym: DumbbellIcon,
  hardware: HammerIcon, electronics: CpuIcon, mobile_accessories: HeadphonesIcon, repair: WrenchIcon, stationery: BookOpenIcon, toys: PuzzleIcon, sports: TrophyIcon, pet_shop: PawPrintIcon, tailoring: SmartphoneIcon, school: GraduationCapIcon,
  general_shop: StoreIcon, general_counter: ReceiptIcon, general_services: BriefcaseIcon,
  textiles_wholesale: LayersIcon, catering: ChefHatIcon, pet_grooming: BoneIcon, photo_studio: CameraIcon, laundry: WashingMachineIcon, event_decor: PartyPopperIcon, ac_service: SnowflakeIcon,
  print_shop: PrinterIcon, tuition: BookOpenIcon, dance_music: MusicIcon, yoga: LeafIcon, driving_school: CarIcon, paints: PaintRollerIcon, electricals: ZapIcon, tiles_sanitary: LayoutGridIcon,
  two_wheeler_service: BikeIcon, car_service: CarIcon, agri_inputs: SproutIcon, auto_parts: CogIcon,
};
const TONES = ["bg-primary/10 text-primary", "bg-marigold/20 text-marigold-ink", "bg-leaf/15 text-leaf"];

/** One card per trade: name (English or Tamil from the business pack), what it gets, and a demo link when configured. */
export function TradeCards({ ids, t, locale, cols = 4 }: { ids: readonly BusinessType[]; t: Translator; locale: string; cols?: 3 | 4 }) {
  return (
    <RevealGroup className={cn("grid gap-4 sm:grid-cols-2", cols === 4 ? "lg:grid-cols-4" : "lg:grid-cols-3")}>
      {ids.map((id, i) => {
        const Icon = ICONS[id];
        const slug = DEMO_SLUG[id];
        const demo = slug ? demoStoreUrl(slug) : null;
        return (
          <RevealItem key={id} className="h-full">
            <Lift className="h-full">
              <Card className="group h-full gap-3 rounded-2xl p-5 transition-shadow hover:shadow-www" data-trade={id}>
                <span className={cn("flex size-10 items-center justify-center rounded-xl transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-6 [&_svg]:size-5", TONES[i % TONES.length])}>
                  <Icon />
                </span>
                <h3 className="font-display text-base font-semibold" lang={locale}>{tradeName(id, locale)}</h3>
                <p className="text-sm text-muted-foreground">{t(`ind.${id}`)}</p>
                {demo && (
                  <a href={demo} target="_blank" rel="noopener noreferrer" className="mt-auto text-sm font-medium text-primary hover:underline focus-ring">
                    {t("trades.demo")}
                  </a>
                )}
              </Card>
            </Lift>
          </RevealItem>
        );
      })}
    </RevealGroup>
  );
}
