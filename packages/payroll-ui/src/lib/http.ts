import { ApiError } from "@rbms/web";

/** True for an API error with one of these HTTP statuses. */
export const isStatus = (err: unknown, ...statuses: number[]) => err instanceof ApiError && statuses.includes(err.status);

/** True for an API error with this code. */
export const isCode = (err: unknown, code: string) => err instanceof ApiError && err.code === code;

/** Retry policy for queries: never retry 4xx (no access, feature off, not found). */
export const retry4xx = (count: number, err: unknown) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2;
