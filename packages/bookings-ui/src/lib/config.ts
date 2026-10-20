/** Host settings the pages read (set once by bookingsModule()). */
export interface BookingsConfig {
  /** App path of a bill, where payment is taken. */
  invoiceHref: (id: string) => string;
}

let config: BookingsConfig = { invoiceHref: (id) => `/invoices/${id}` };

export function setBookingsConfig(c: Partial<BookingsConfig>) {
  config = { ...config, ...Object.fromEntries(Object.entries(c).filter(([, v]) => v !== undefined)) };
}

export const bookingsConfig = () => config;
