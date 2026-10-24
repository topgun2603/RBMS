"use client";

import { posApi } from "../api";
import type { BlockDto, OfflineApi, SyncResultDto } from "./types";

/** POST /v1/pos/offline/* (docs/offline-billing.md) as the sync engine uses it. */
export function createOfflineApi(deviceId: string): OfflineApi {
  return {
    sync: (bills) => posApi.post<{ results: SyncResultDto[] }>("/pos/offline/sync", { bills }).then((r) => r.results),
    reserveBlock: (count) => posApi.post<BlockDto>("/pos/offline/blocks", { count, deviceId }),
    closeBlock: (id) => posApi.post<{ released: number[] }>(`/pos/offline/blocks/${id}/close`, {}),
  };
}
