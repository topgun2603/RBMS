"use client";

import { useQuery } from "@tanstack/react-query";
import { api, useFeature } from "@rbms/web";

/** Whether the item is tracked by serial number / IMEI in Serials (the shop needs the `serials` feature). */
export function useSerialTracked(itemId: string | undefined): boolean {
  const on = useFeature("serials");
  const q = useQuery({
    queryKey: ["serials", "items", "for", itemId ?? ""],
    queryFn: async () => (await api.get<{ items: { itemId: string; tracked: boolean }[] }>("/serials/items", { ids: itemId })).items[0]?.tracked ?? false,
    enabled: on && !!itemId,
    staleTime: 60_000,
    retry: 0,
  });
  return on && !!itemId && q.data === true;
}
