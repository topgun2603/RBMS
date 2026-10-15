"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster, toast } from "@srirealtime/ui/components/sonner";
import { LOCALE_COOKIE, translatorFor, type Locale, type Translator } from "../lib/messages";
import type { AuthUser, PricedCart, StoreShell } from "../types";
import { call, getToken, setCookie, setToken, setUnauthorizedHandler } from "./api";
import { track } from "./analytics";

export const CART_COOKIE = "sr_cart";

interface CartApi {
  cart: PricedCart | null;
  count: number;
  token: string | null;
  loading: boolean;
  /** The initial cart load finished (or there was no cart). */
  ready: boolean;
  /** Adds qty to the line (creating the cart on first add). Opens the mini cart unless `silent`. */
  add(variantId: string, qty: number, opts?: { silent?: boolean; productId?: string; value?: number }): Promise<PricedCart | null>;
  /** Sets a line's qty (0 removes). */
  setQty(variantId: string, qty: number): Promise<void>;
  applyCoupon(code: string): Promise<PricedCart | null>;
  removeCoupon(): Promise<void>;
  setPincode(pincode: string): Promise<PricedCart | null>;
  refresh(): Promise<PricedCart | null>;
  /** After checkout: the server cleared the cart. */
  reset(): void;
  replace(cart: PricedCart): void;
  miniOpen: boolean;
  setMiniOpen(open: boolean): void;
}

interface AuthApi {
  token: string | null;
  user: AuthUser | null;
  /** False until the stored token was read on the client. */
  ready: boolean;
  signIn(token: string, user: AuthUser): Promise<void>;
  signOut(): Promise<void>;
}

interface QuickViewApi {
  /** Opens the quick-view dialog for a product (the dialog's code loads on first use). */
  open(slug: string): void;
}

interface StoreCtx {
  shell: StoreShell;
  locale: Locale;
  t: Translator;
  setLocale(l: Locale): void;
  cart: CartApi;
  auth: AuthApi;
  quickView: QuickViewApi;
}

const QuickView = React.lazy(() => import("./quick-view").then((m) => ({ default: m.QuickView })));

const Ctx = React.createContext<StoreCtx | null>(null);

export function useStore(): StoreCtx {
  const c = React.useContext(Ctx);
  if (!c) throw new Error("useStore outside <StoreProvider>");
  return c;
}

export function useT(): Translator {
  return useStore().t;
}

export function StoreProvider({ shell, locale, children }: { shell: StoreShell; locale: Locale; children: React.ReactNode }) {
  const router = useRouter();
  const t = React.useMemo(() => translatorFor(locale), [locale]);
  const [queryClient] = React.useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } } }));

  // ------------------------------------------------------------ auth
  const [token, setTok] = React.useState<string | null>(null);
  const [user, setUser] = React.useState<AuthUser | null>(null);
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    const stored = getToken();
    setTok(stored);
    setReady(true);
    if (stored) {
      call<{ user: AuthUser }>("/auth/me")
        .then((r) => setUser(r.user))
        .catch(() => undefined);
    }
    setUnauthorizedHandler(() => {
      setToken(null);
      setTok(null);
      setUser(null);
      queryClient.clear();
    });
    return () => setUnauthorizedHandler(null);
  }, [queryClient]);

  // ------------------------------------------------------------ cart
  const [cart, setCart] = React.useState<PricedCart | null>(null);
  const [cartToken, setCartToken] = React.useState<string | null>(shell.cartToken);
  const [count, setCount] = React.useState(shell.cartCount);
  const [loading, setLoading] = React.useState(false);
  const [cartReady, setCartReady] = React.useState(!shell.cartToken);
  const [miniOpen, setMiniOpen] = React.useState(false);
  const tokenRef = React.useRef<string | null>(shell.cartToken);

  const replace = React.useCallback((c: PricedCart) => {
    setCart(c);
    setCount(c.itemCount);
    if (c.token !== tokenRef.current) {
      tokenRef.current = c.token;
      setCartToken(c.token);
      setCookie(CART_COOKIE, c.token);
    }
  }, []);

  const reset = React.useCallback(() => {
    tokenRef.current = null;
    setCartToken(null);
    setCart(null);
    setCount(0);
    setCookie(CART_COOKIE, null);
  }, []);

  const ensureToken = React.useCallback(async (): Promise<string> => {
    if (tokenRef.current) return tokenRef.current;
    const r = await call<{ token: string }>("/store/cart", { method: "POST" });
    tokenRef.current = r.token;
    setCartToken(r.token);
    setCookie(CART_COOKIE, r.token);
    return r.token;
  }, []);

  const refresh = React.useCallback(async () => {
    const tk = tokenRef.current;
    if (!tk) return null;
    setLoading(true);
    try {
      const c = await call<PricedCart>(`/store/cart/${tk}`);
      replace(c);
      return c;
    } catch (err) {
      // Only a cart the API no longer knows (404) is dropped; a network blip or a fetch aborted by navigation keeps it.
      if ((err as { status?: number }).status === 404) reset();
      return null;
    } finally {
      setLoading(false);
      setCartReady(true);
    }
  }, [replace, reset]);

  React.useEffect(() => {
    if (shell.cartToken) void refresh();
  }, [refresh, shell.cartToken]);

  /** Runs a cart mutation; a vanished cart (404) is recreated once. */
  const mutate = React.useCallback(
    async (fn: (tk: string) => Promise<PricedCart>): Promise<PricedCart> => {
      let tk = await ensureToken();
      try {
        const c = await fn(tk);
        replace(c);
        return c;
      } catch (err) {
        if ((err as { status?: number }).status === 404) {
          reset();
          tk = await ensureToken();
          const c = await fn(tk);
          replace(c);
          return c;
        }
        throw err;
      }
    },
    [ensureToken, replace, reset],
  );

  const add = React.useCallback<CartApi["add"]>(
    async (variantId, qty, opts) => {
      const existing = cart?.lines.find((l) => l.variantId === variantId)?.qty ?? 0;
      const c = await mutate((tk) => call<PricedCart>(`/store/cart/${tk}/lines`, { method: "PUT", body: { variantId, qty: Math.min(99, existing + qty) } }));
      track({ type: "add_to_cart", variantId, productId: opts?.productId, value: opts?.value });
      if (!opts?.silent) setMiniOpen(true);
      return c;
    },
    [cart, mutate],
  );

  const setQty = React.useCallback<CartApi["setQty"]>(
    async (variantId, qty) => {
      const line = cart?.lines.find((l) => l.variantId === variantId);
      await mutate((tk) => call<PricedCart>(`/store/cart/${tk}/lines`, { method: "PUT", body: { variantId, qty } }));
      if (qty === 0 && line) track({ type: "remove_from_cart", variantId, productId: line.productId, value: line.lineTotal });
    },
    [cart, mutate],
  );

  const applyCoupon = React.useCallback((code: string) => mutate((tk) => call<PricedCart>(`/store/cart/${tk}/coupon`, { body: { code } })), [mutate]);
  const removeCoupon = React.useCallback(async () => {
    await mutate((tk) => call<PricedCart>(`/store/cart/${tk}/coupon`, { method: "DELETE" }));
  }, [mutate]);
  const setPincode = React.useCallback((pincode: string) => mutate((tk) => call<PricedCart>(`/store/cart/${tk}/pincode`, { body: { pincode } })), [mutate]);

  const signIn = React.useCallback<AuthApi["signIn"]>(
    async (tk, u) => {
      setToken(tk);
      setTok(tk);
      setUser(u);
      queryClient.clear();
      // Bring the anonymous cart into the shopper's cart (or fetch the shopper's saved one).
      try {
        const cartTk = await ensureToken();
        const merged = await call<PricedCart>(`/store/cart/${cartTk}/merge`, { method: "POST" });
        replace(merged);
      } catch {
        /* cart merge is best-effort */
      }
    },
    [ensureToken, queryClient, replace],
  );

  const signOut = React.useCallback(async () => {
    await call("/auth/logout", { method: "POST" }).catch(() => undefined);
    setToken(null);
    setTok(null);
    setUser(null);
    queryClient.clear();
    reset();
    toast.success(t("auth.signOut"));
  }, [queryClient, reset, t]);

  const setLocale = React.useCallback(
    (l: Locale) => {
      setCookie(LOCALE_COOKIE, l, 365);
      document.documentElement.lang = l;
      router.refresh();
    },
    [router],
  );

  // ------------------------------------------------------------ quick view (lazy)
  const [qvSlug, setQvSlug] = React.useState<string | null>(null);
  const [qvLoaded, setQvLoaded] = React.useState(false);
  const quickView = React.useMemo<QuickViewApi>(
    () => ({
      open: (slug: string) => {
        setQvLoaded(true);
        setQvSlug(slug);
      },
    }),
    [],
  );

  const value = React.useMemo<StoreCtx>(
    () => ({
      shell,
      locale,
      t,
      setLocale,
      cart: { cart, count, token: cartToken, loading, ready: cartReady, add, setQty, applyCoupon, removeCoupon, setPincode, refresh, reset, replace, miniOpen, setMiniOpen },
      auth: { token, user, ready, signIn, signOut },
      quickView,
    }),
    [shell, locale, t, setLocale, cart, count, cartToken, loading, cartReady, add, setQty, applyCoupon, removeCoupon, setPincode, refresh, reset, replace, miniOpen, token, user, ready, signIn, signOut, quickView],
  );

  return (
    <QueryClientProvider client={queryClient}>
      <Ctx.Provider value={value}>
        {children}
        {qvLoaded && (
          <React.Suspense fallback={null}>
            <QuickView slug={qvSlug} onClose={() => setQvSlug(null)} />
          </React.Suspense>
        )}
        <Toaster position="top-center" richColors closeButton offset={72} mobileOffset={{ top: 64 }} />
      </Ctx.Provider>
    </QueryClientProvider>
  );
}
