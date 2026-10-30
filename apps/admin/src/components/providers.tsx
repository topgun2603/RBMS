"use client";

import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider, useTheme } from "next-themes";
import { Toaster, TooltipProvider } from "@rbms/ui";
import { ApiError } from "@/lib/api";
import { BrandingProvider } from "@/lib/branding";
import { I18nProvider } from "@/lib/i18n";

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
  return <Toaster theme={resolvedTheme === "dark" ? "dark" : "light"} position="top-right" richColors closeButton />;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(makeQueryClient);
  return (
    <QueryClientProvider client={client}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
        <I18nProvider>
          <BrandingProvider>
            <TooltipProvider delayDuration={200}>
              {children}
              <ThemedToaster />
            </TooltipProvider>
          </BrandingProvider>
        </I18nProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
