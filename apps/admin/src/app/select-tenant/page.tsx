"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Building2Icon, ChevronRightIcon, Loader2Icon, LogOutIcon, PlusIcon } from "lucide-react";
import {
  AuthLayout,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  Skeleton,
  Stagger,
  StaggerItem,
  toast,
} from "@srirealtime/ui";
import { RoleBadges, StatusBadge } from "@/components/badges";
import { BrandMark } from "@/components/brand-mark";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { QueryError } from "@/components/query-state";
import { ThemeToggle } from "@/components/theme-toggle";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { api } from "@/lib/api";
import { isSuperAdmin, myTenantsQueryKey, useMe, useMyTenants, useSignOut, useSwitchTenant } from "@/lib/auth";
import { SLUG_RE, slugify } from "@/lib/format";
import { describeError, useI18n } from "@/lib/i18n";
import { useHydrated, useTenantSlug, useToken } from "@/lib/session";
import type { Tenant } from "@/lib/types";

/** Mirrors the API's validateSlug (packages/tenancy/src/slug.ts). */
const RESERVED = ["www", "api", "admin", "app", "mail", "static", "cdn", "assets", "dashboard", "help", "support", "status", "blog", "docs"];

const createSchema = z.object({
  name: z.string().trim().min(1, "admin.validation.required").max(120, "admin.validation.tooLong"),
  slug: z
    .string()
    .trim()
    .min(3, "admin.workspace.slugLength")
    .max(40, "admin.workspace.slugLength")
    .regex(SLUG_RE, "admin.workspace.slugChars")
    .refine((s) => !RESERVED.includes(s), "admin.workspace.slugReserved"),
});
type CreateValues = z.infer<typeof createSchema>;

export default function SelectTenantPage() {
  const { t } = useI18n();
  const router = useRouter();
  const hydrated = useHydrated();
  const token = useToken();
  const current = useTenantSlug();
  const me = useMe();
  const tenants = useMyTenants();
  const switchTenant = useSwitchTenant();
  const signOut = useSignOut();
  const [createOpen, setCreateOpen] = React.useState(false);

  React.useEffect(() => {
    if (hydrated && !token) router.replace("/login");
  }, [hydrated, token, router]);

  React.useEffect(() => {
    if (new URLSearchParams(window.location.search).has("create")) setCreateOpen(true);
  }, []);

  // The workspace being opened; the dashboard can take a moment to load (longer in dev, while it compiles).
  const [opening, setOpening] = React.useState<string | null>(null);
  const pick = (slug: string) => {
    if (opening) return;
    setOpening(slug);
    switchTenant(slug);
    router.push("/");
  };

  return (
    <AuthLayout
      logo={<BrandMark size="lg" />}
      title={t("admin.workspace.title")}
      description={t("admin.workspace.subtitle")}
      corner={
        <>
          <LocaleSwitcher />
          <ThemeToggle />
        </>
      }
      footer={
        <div className="flex items-center justify-center gap-3">
          {isSuperAdmin(me.data?.user) && (
            <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => router.push("/platform/tenants")}>
              {t("admin.workspace.platform")}
            </Button>
          )}
          <Button variant="link" size="sm" className="h-auto p-0 text-xs text-muted-foreground" onClick={() => void signOut()}>
            <LogOutIcon className="size-3" /> {t("admin.user.signOut")}
          </Button>
        </div>
      }
    >
      {(tenants.isLoading && !tenants.data) || !hydrated ? (
        <div className="grid gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : tenants.isError ? (
        <QueryError compact error={tenants.error} onRetry={() => void tenants.refetch()} />
      ) : tenants.data && tenants.data.length > 0 ? (
        <Stagger className="grid max-h-[50vh] gap-2 overflow-y-auto">
          {tenants.data.map(({ tenant, roles }) => (
            <StaggerItem key={tenant.id}>
              <button
                type="button"
                onClick={() => pick(tenant.slug)}
                disabled={tenant.status === "suspended" || (opening !== null && opening !== tenant.slug)}
                aria-busy={opening === tenant.slug}
                className="group flex w-full items-center gap-3 rounded-lg border bg-background p-3 text-left transition-colors hover:border-primary/40 hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60 data-[current=true]:border-primary/60"
                data-current={tenant.slug === current}
              >
                <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 font-heading font-semibold text-primary">
                  {Array.from(tenant.name)[0]?.toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{tenant.name}</span>
                    {tenant.status !== "active" && <StatusBadge status={tenant.status} />}
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="truncate font-mono text-xs text-muted-foreground">{tenant.slug}</span>
                    <RoleBadges roles={roles} />
                  </div>
                </div>
                {opening === tenant.slug ? (
                  <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
                ) : (
                  <ChevronRightIcon className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                )}
              </button>
            </StaggerItem>
          ))}
        </Stagger>
      ) : (
        <EmptyState compact icon={Building2Icon} title={t("admin.workspace.emptyTitle")} description={t("admin.workspace.emptyDescription")} />
      )}

      <Button variant="outline" className="mt-4 w-full" onClick={() => setCreateOpen(true)}>
        <PlusIcon /> {t("admin.tenant.create")}
      </Button>

      <CreateWorkspaceDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={(tn) => pick(tn.slug)} />
    </AuthLayout>
  );
}

function CreateWorkspaceDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: (t: Tenant) => void;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const slugEdited = React.useRef(false);
  const form = useForm<CreateValues>({ resolver: zodResolver(createSchema), defaultValues: { name: "", slug: "" } });

  React.useEffect(() => {
    if (open) {
      form.reset({ name: "", slug: "" });
      slugEdited.current = false;
    }
  }, [open, form]);

  const create = useMutation({
    mutationFn: (v: CreateValues) => api.post<Tenant>("/tenancy/tenants", v, { tenant: null }),
    onSuccess: async (tenant) => {
      toast.success(t("admin.workspace.created", { name: tenant.name }));
      await qc.invalidateQueries({ queryKey: myTenantsQueryKey });
      onOpenChange(false);
      onCreated(tenant);
    },
    onError: (err) => toast.error(describeError(err, t)),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !create.isPending && onOpenChange(o)}>
      <DialogContent closeLabel={t("admin.common.close")}>
        <DialogHeader>
          <DialogTitle>{t("admin.tenant.create")}</DialogTitle>
          <DialogDescription>{t("admin.workspace.createDescription")}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => create.mutate(v))} className="grid gap-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("admin.workspace.name")}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      autoFocus
                      placeholder={t("admin.workspace.namePlaceholder")}
                      onChange={(e) => {
                        field.onChange(e);
                        if (!slugEdited.current) form.setValue("slug", slugify(e.target.value), { shouldValidate: form.formState.isSubmitted });
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="slug"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("admin.workspace.slug")}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      className="font-mono"
                      placeholder="acme-traders"
                      onChange={(e) => {
                        slugEdited.current = true;
                        field.onChange(e.target.value.toLowerCase());
                      }}
                    />
                  </FormControl>
                  <FormDescription>{t("admin.workspace.slugHint")}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={create.isPending}>
                {t("admin.common.cancel")}
              </Button>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending && <Loader2Icon className="animate-spin" />}
                {t("admin.workspace.createSubmit")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
