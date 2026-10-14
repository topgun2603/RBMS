"use client";

import { BellIcon, MailIcon, MessageCircleIcon, SmartphoneIcon } from "lucide-react";
import { Progress } from "@srirealtime/ui";
import type { Channel } from "@/lib/types";

export const channelIcon: Record<Channel, typeof MailIcon> = {
  email: MailIcon,
  sms: SmartphoneIcon,
  whatsapp: MessageCircleIcon,
  push: BellIcon,
};

/** Thin usage bar that turns amber at 75% and red at 90%. */
export function UsageBar({ percent, className }: { percent: number; className?: string }) {
  return (
    <Progress
      value={percent}
      className={className ?? "h-1.5"}
      indicatorClassName={percent >= 90 ? "bg-destructive" : percent >= 75 ? "bg-warning" : undefined}
    />
  );
}
