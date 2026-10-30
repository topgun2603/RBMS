"use client";

import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider, useTheme } from "next-themes";
import { Toaster, TooltipProvider } from "@rbms/ui";
import { ApiError } from "../lib/api";
import { FeaturesProvider } from "../lib/features";
import { I18nProvider, type MessageBundle } from "../lib/i18n";

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        // Don't retry client errors (4xx); retry network/5xx twice.
        retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
      },
      mutations: { retry: false },
    },
  });
}

function ThemedToaster() {
  const { resolvedTheme } = useTheme();
  useThemeColorMeta(resolvedTheme);
  return <Toaster theme={resolvedTheme === "dark" ? "dark" : "light"} position="top-center" richColors closeButton />;
}

/** The layouts' theme-color colours (browser / phone status bar), per mode. */
const THEME_COLORS = { light: "#fbfaf8", dark: "#1a1816" } as const;

/**
 * The layouts declare theme-color per `prefers-color-scheme`, which follows the OS, so picking Dark in the app on a
 * light phone kept a light status bar (and the reverse). Once the app's own choice is known, point every theme-color
 * meta at it.
 */
function useThemeColorMeta(resolvedTheme: string | undefined) {
  React.useEffect(() => {
    if (resolvedTheme !== "light" && resolvedTheme !== "dark") return;
    for (const meta of document.querySelectorAll<HTMLMetaElement>("meta[name='theme-color']")) {
      meta.content = THEME_COLORS[resolvedTheme];
    }
  }, [resolvedTheme]);
}

/** Query client, theme, i18n (kit + module bundles), shop features, tooltips and toasts. */
export function WebProviders({
  bundles,
  namespaces,
  children,
}: {
  bundles: MessageBundle[];
  namespaces: string[];
  children: React.ReactNode;
}) {
  const [client] = React.useState(makeQueryClient);
  return (
    <QueryClientProvider client={client}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
        <I18nProvider bundles={bundles} namespaces={namespaces}>
          <FeaturesProvider>
            <TooltipProvider delayDuration={200}>
              {children}
              <ThemedToaster />
            </TooltipProvider>
          </FeaturesProvider>
        </I18nProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
