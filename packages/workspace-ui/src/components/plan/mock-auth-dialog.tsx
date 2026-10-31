"use client";

import * as React from "react";
import { FlaskConicalIcon, Loader2Icon, ShieldCheckIcon } from "lucide-react";
import {
  AnimatePresence,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  motion,
  StatusPill,
  toast,
  useReducedMotionSafe,
} from "@rbms/ui";
import {
  describeError,
  formatPaise,
  MOCK_AUTH_PARAM,
  planPrice,
  useI18n,
  useModuleNavigate,
  useQueryParams,
  type PlanInfo,
  type SubscriptionCurrent,
} from "@rbms/web";
import { useMockAuthorize } from "../../lib/subscriptions";

/**
 * The mock provider's "mandate" screen. Its authUrl returns here with `?mockAuth=<subscriptionId>`; authorising calls
 * POST /v1/subscriptions/mock/authorize (non-production only) and clears the query string.
 */
export function MockAuthDialog({ cur, plans }: { cur: SubscriptionCurrent | undefined; plans: PlanInfo[] }) {
  const { t } = useI18n();
  const reduced = useReducedMotionSafe();
  const params = useQueryParams();
  const navigate = useModuleNavigate();
  const id = params.get(MOCK_AUTH_PARAM);
  const authorize = useMockAuthorize();
  const [closing, setClosing] = React.useState(false);
  React.useEffect(() => setClosing(false), [id]);

  const sub = cur?.subscription;
  // An upgrade's mandate collects its first period (less the credit) on authorisation.
  const upgrade = !!id && sub?.pendingProviderSubscriptionId === id;
  const planId = upgrade ? sub?.pendingPlanId : (sub?.checkoutPlanId ?? sub?.planId);
  const interval = (upgrade ? sub?.pendingInterval : sub?.checkoutInterval) ?? sub?.interval ?? "monthly";
  const plan = plans.find((p) => p.id === planId) ?? (cur?.plan?.id === planId ? cur?.plan : null);

  const clear = () => {
    setClosing(true);
    navigate("?", { replace: true, scroll: false });
  };

  const go = async () => {
    if (!id) return;
    try {
      await authorize.mutateAsync(id);
      toast.success(t("workspace.plan.mock.done"));
      clear();
    } catch {
      // shown below
    }
  };

  return (
    <Dialog open={!!id && !closing} onOpenChange={(o) => !o && !authorize.isPending && clear()}>
      <DialogContent className="sm:max-w-sm" closeLabel={t("workspace.common.close")}>
        <DialogHeader className="items-center text-center sm:items-center sm:text-center">
          <motion.span
            initial={reduced ? false : { scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 380, damping: 22 }}
            className="icon-chip mb-1 size-14 rounded-2xl text-primary"
          >
            <ShieldCheckIcon className="size-7" />
          </motion.span>
          <StatusPill tone="warning" icon={FlaskConicalIcon} className="mx-auto">
            {t("workspace.plan.mock.badge")}
          </StatusPill>
          <DialogTitle>{t("workspace.plan.mock.title")}</DialogTitle>
          <DialogDescription>{t("workspace.plan.mock.body")}</DialogDescription>
        </DialogHeader>
        <dl className="divide-y rounded-xl border text-sm">
          {plan && (
            <div className="flex justify-between gap-3 px-3 py-2">
              <dt className="text-muted-foreground">{t("workspace.plan.mock.plan")}</dt>
              <dd className="font-medium">
                {plan.name} · {t(`workspace.plan.plans.${interval}`)}
              </dd>
            </div>
          )}
          {upgrade && (
            <div className="flex justify-between gap-3 px-3 py-2">
              <dt className="text-muted-foreground">{t("workspace.plan.mock.dueNow")}</dt>
              <dd className="font-medium tabular-nums">{formatPaise(sub?.pendingChargePaise ?? 0)}</dd>
            </div>
          )}
          {plan && (
            <div className="flex justify-between gap-3 px-3 py-2">
              <dt className="text-muted-foreground">{t("workspace.plan.mock.amount")}</dt>
              <dd className="font-medium tabular-nums">
                {formatPaise(planPrice(plan, interval))} {t("workspace.plan.plusGst")}
              </dd>
            </div>
          )}
          <div className="flex justify-between gap-3 px-3 py-2">
            <dt className="text-muted-foreground">{t("workspace.plan.mock.reference")}</dt>
            <dd className="max-w-[60%] truncate font-mono text-xs leading-5">{id}</dd>
          </div>
        </dl>
        <AnimatePresence initial={false}>
          {authorize.isError && (
            <motion.p
              key="err"
              role="alert"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-danger-ink"
            >
              {describeError(authorize.error, t)}
            </motion.p>
          )}
        </AnimatePresence>
        <DialogFooter>
          <Button variant="outline" onClick={clear} disabled={authorize.isPending}>
            {t("workspace.plan.mock.decline")}
          </Button>
          <Button onClick={() => void go()} disabled={authorize.isPending}>
            {authorize.isPending ? <Loader2Icon className="animate-spin" /> : <ShieldCheckIcon />}
            {t("workspace.plan.mock.authorise")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
