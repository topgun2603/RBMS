"use client";

import { useQuery } from "@tanstack/react-query";
import { packOrDefault } from "@rbms/verticals";
import { api, useOptionalShop } from "@rbms/web";

/** The shop's business type id ("school", "salon"…), from Settings → Appearance; falls back to the app's default trade. */
export function usePackId(): string {
  const shop = useOptionalShop();
  const q = useQuery({
    queryKey: ["site", "settings", "store"],
    queryFn: () => api.get<{ values?: { businessType?: string } }>("/settings/store").then((r) => r.values ?? {}),
    staleTime: 5 * 60_000,
    retry: false,
  });
  return packOrDefault(q.data?.businessType, shop?.tenant.appId ?? null).id;
}
/** True for a school: "Converted" reads "Admitted" and the student field "Student". */
export function useIsSchool(): boolean {
  return usePackId() === "school";
}
