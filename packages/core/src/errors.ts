/** Error with an HTTP status and a stable machine-readable code. The API host maps these to responses. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const badRequest = (message: string, details?: unknown) => new AppError(400, "bad_request", message, details);
export const unauthorized = (message = "Sign in required") => new AppError(401, "unauthorized", message);
export const forbidden = (message = "You don't have access to this") => new AppError(403, "forbidden", message);
export const notFound = (what = "Resource") => new AppError(404, "not_found", `${what} not found`);
export const conflict = (message: string) => new AppError(409, "conflict", message);
export const tooMany = (message = "Too many attempts, try again later") => new AppError(429, "rate_limited", message);
/** A plan limit or disabled module blocked the action. */
export const paymentRequired = (message: string, details?: unknown) =>
  new AppError(402, "plan_limit", message, details);
