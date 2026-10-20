"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api } from "@srirealtime/web";
import type { Appointment, AppointmentStatus, Availability, BillResult, BookingService, BookingsSummary, BookingStaff, DayRow, DayView, Hours, ShopItem, Timeoff } from "./types";

const B = "/bookings";

/** Never retry 4xx (no access, feature off, not found). */
export const retry4xx = (count: number, err: unknown) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2;
export const isStatus = (err: unknown, ...statuses: number[]) => err instanceof ApiError && statuses.includes(err.status);

/** Query keys. Everything starts with "bookings" so a mutation can refresh the lot. */
export const bk = {
  all: ["bookings"] as const,
  day: (date: string) => ["bookings", "day", date] as const,
  list: ["bookings", "list"] as const,
  appointment: (id: string) => ["bookings", "appointment", id] as const,
  summary: ["bookings", "summary"] as const,
  services: (all: boolean) => ["bookings", "services", all] as const,
  staff: (all: boolean) => ["bookings", "staff", all] as const,
  hours: ["bookings", "hours"] as const,
  timeoff: ["bookings", "timeoff"] as const,
  availability: (date: string, serviceIds: string[], staffId: string) => ["bookings", "availability", date, serviceIds.join(","), staffId] as const,
  items: (q: string) => ["bookings", "shop-items", q] as const,
};

/** Polling stands in for a live channel: the calendar refreshes every 30 s (paused in background tabs). */
export const DAY_POLL_MS = 30_000;

export function useDay(date: string) {
  return useQuery({ queryKey: bk.day(date), queryFn: () => api.get<DayView>(`${B}/day`, { date }), refetchInterval: DAY_POLL_MS, placeholderData: keepPreviousData, retry: retry4xx });
}

export function useAppointment(id: string | null) {
  return useQuery({ queryKey: bk.appointment(id ?? ""), queryFn: () => api.get<Appointment>(`${B}/appointments/${id}`), enabled: !!id, retry: retry4xx });
}

export function useSummary() {
  return useQuery({ queryKey: bk.summary, queryFn: () => api.get<BookingsSummary>(`${B}/summary`), refetchInterval: 60_000, retry: retry4xx });
}

export function useServices(all = false) {
  return useQuery({ queryKey: bk.services(all), queryFn: () => api.get<{ items: BookingService[] }>(`${B}/services`, { all: all ? 1 : undefined }), retry: retry4xx });
}

export function useStaff(all = false) {
  return useQuery({ queryKey: bk.staff(all), queryFn: () => api.get<{ items: BookingStaff[] }>(`${B}/staff`, { all: all ? 1 : undefined }), retry: retry4xx });
}

export function useHours() {
  return useQuery({ queryKey: bk.hours, queryFn: () => api.get<Hours>(`${B}/hours`), retry: retry4xx });
}

export function useTimeoff() {
  return useQuery({ queryKey: bk.timeoff, queryFn: () => api.get<{ items: Timeoff[] }>(`${B}/timeoff`), retry: retry4xx });
}

/** Free slots for these services on a day; `staffId` = a person or "any". */
export function useAvailability(date: string, serviceIds: string[], staffId: string, enabled = true) {
  return useQuery({
    queryKey: bk.availability(date, serviceIds, staffId),
    queryFn: ({ signal }) => api.get<Availability>(`${B}/availability`, { date, serviceIds: serviceIds.join(","), staffId }, { signal }),
    enabled: enabled && serviceIds.length > 0 && !!date,
    placeholderData: keepPreviousData,
    retry: retry4xx,
  });
}

/** Billing items (catalogue variants) matching `q`, for picking what a service bills as. */
export function useShopItems(q: string, enabled = true) {
  return useQuery({
    queryKey: bk.items(q),
    queryFn: ({ signal }) => api.get<{ items: ShopItem[] }>("/invoices/items", { q: q || undefined, limit: 20 }, { signal }),
    enabled,
    placeholderData: keepPreviousData,
    retry: retry4xx,
  });
}

function useRefresh() {
  const qc = useQueryClient();
  return (a?: Appointment) => {
    if (a) qc.setQueryData(bk.appointment(a.id), a);
    return qc.invalidateQueries({ queryKey: bk.all });
  };
}

export interface AppointmentBody {
  serviceIds: string[];
  /** A person, "any" or null (unassigned). */
  staffId: string | null;
  start: string;
  customerName: string;
  customerPhone?: string | null;
  notes?: string | null;
}

export function useCreateAppointment() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: (b: AppointmentBody) => api.post<Appointment>(`${B}/appointments`, b), onSuccess: (a) => refresh(a) });
}

export function useAppointmentActions(id: string) {
  const refresh = useRefresh();
  const done = (a: Appointment) => refresh(a);
  return {
    status: useMutation({ mutationFn: (b: { status: AppointmentStatus; reason?: string | null }) => api.post<Appointment>(`${B}/appointments/${id}/status`, b), onSuccess: done }),
    move: useMutation({ mutationFn: (b: { start: string; staffId?: string | null }) => api.post<Appointment>(`${B}/appointments/${id}/move`, b), onSuccess: done }),
    update: useMutation({
      mutationFn: (b: { customerName?: string; customerPhone?: string | null; notes?: string | null }) => api.patch<Appointment>(`${B}/appointments/${id}`, b),
      onSuccess: done,
    }),
    bill: useMutation({ mutationFn: () => api.post<{ appointment: Appointment; bill: BillResult }>(`${B}/appointments/${id}/bill`, {}), onSuccess: (r) => done(r.appointment) }),
  };
}

export function useSetupActions() {
  const qc = useQueryClient();
  const onSuccess = () => qc.invalidateQueries({ queryKey: bk.all });
  return {
    createService: useMutation({
      mutationFn: (b: { itemId: string; durationMin: number; bufferMin: number; onlineBookable: boolean }) => api.post<BookingService>(`${B}/services`, b),
      onSuccess,
    }),
    updateService: useMutation({
      mutationFn: ({ id, ...b }: { id: string; durationMin?: number; bufferMin?: number; onlineBookable?: boolean; active?: boolean; name?: string }) =>
        api.patch<BookingService>(`${B}/services/${id}`, b),
      onSuccess,
    }),
    deleteService: useMutation({ mutationFn: (id: string) => api.delete(`${B}/services/${id}`), onSuccess }),
    createStaff: useMutation({ mutationFn: (b: { name: string; color: string }) => api.post<BookingStaff>(`${B}/staff`, b), onSuccess }),
    updateStaff: useMutation({
      mutationFn: ({ id, ...b }: { id: string; name?: string; color?: string; active?: boolean; serviceItemIds?: string[] }) => api.patch<BookingStaff>(`${B}/staff/${id}`, b),
      onSuccess,
    }),
    deleteStaff: useMutation({ mutationFn: (id: string) => api.delete(`${B}/staff/${id}`), onSuccess }),
    saveHours: useMutation({ mutationFn: (b: { staffId: string | null; days: DayRow[] }) => api.put<Hours>(`${B}/hours`, b), onSuccess }),
    createTimeoff: useMutation({
      mutationFn: (b: { staffId: string | null; from: string; to: string; reason: string | null }) => api.post<Timeoff>(`${B}/timeoff`, b),
      onSuccess,
    }),
    deleteTimeoff: useMutation({ mutationFn: (id: string) => api.delete(`${B}/timeoff/${id}`), onSuccess }),
  };
}
