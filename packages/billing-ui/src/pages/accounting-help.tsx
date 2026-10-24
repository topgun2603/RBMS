"use client";

import * as React from "react";
import { HelpCircleIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@srirealtime/ui";
import { ModuleLink, useI18n } from "@srirealtime/web";
import { AccountingPage } from "../components/accounting/parts";

const AUTO = ["invoice", "payment", "receipt", "creditNote", "purchase", "supplierPayment", "debitNote", "expense", "till", "stock", "opening"] as const;
const SECTIONS = ["lock", "reports", "basis", "stockValue", "limits"] as const;

/** A plain-language explainer for shop owners: what the books are and what the screens do. */
export default function AccountingHelpPage() {
  const { t } = useI18n();
  return (
    <AccountingPage title={t("billing.accounting.nav.howItWorks")} description={t("billing.accounting.help.subtitle")} icon={HelpCircleIcon} needsSetup={false}>
      <div className="mx-auto grid max-w-3xl gap-5">
        <Card>
          <CardHeader>
            <CardTitle>{t("billing.accounting.help.whatTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm leading-relaxed">
            <p>{t("billing.accounting.help.whatBody")}</p>
            <p>{t("billing.accounting.help.twoSides")}</p>
            <div className="overflow-x-auto rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("billing.accounting.help.exampleTitle")}</TableHead>
                    <TableHead className="text-right">{t("billing.accounting.debit")}</TableHead>
                    <TableHead className="text-right">{t("billing.accounting.credit")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell>{t("billing.accounting.help.exampleCash")}</TableCell>
                    <TableCell className="text-right tabular-nums">₹1,180</TableCell>
                    <TableCell />
                  </TableRow>
                  <TableRow>
                    <TableCell className="pl-8">{t("billing.accounting.help.exampleSales")}</TableCell>
                    <TableCell />
                    <TableCell className="text-right tabular-nums">₹1,000</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="pl-8">{t("billing.accounting.help.exampleGst")}</TableCell>
                    <TableCell />
                    <TableCell className="text-right tabular-nums">₹180</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
            <p className="text-meta text-muted-foreground">{t("billing.accounting.help.exampleNote")}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("billing.accounting.help.autoTitle")}</CardTitle>
            <p className="text-meta text-muted-foreground">{t("billing.accounting.help.autoBody")}</p>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("billing.accounting.help.whenYou")}</TableHead>
                    <TableHead>{t("billing.accounting.help.booksShow")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {AUTO.map((k) => (
                    <TableRow key={k}>
                      <TableCell className="font-medium">{t(`billing.accounting.help.auto.${k}.when`)}</TableCell>
                      <TableCell className="text-muted-foreground">{t(`billing.accounting.help.auto.${k}.what`)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("billing.accounting.help.handTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm leading-relaxed">
            <p>{t("billing.accounting.help.handBody")}</p>
            <ul className="list-disc pl-5 text-muted-foreground">
              {(["payment", "receipt", "contra", "journal"] as const).map((k) => (
                <li key={k}>
                  <b className="text-foreground">{t(`billing.accounting.voucher.${k}`)}</b>: {t(`billing.accounting.new.about.${k}`)}
                </li>
              ))}
            </ul>
            <p>{t("billing.accounting.help.reverseBody")}</p>
          </CardContent>
        </Card>

        {SECTIONS.map((k) => (
          <Card key={k}>
            <CardHeader>
              <CardTitle>{t(`billing.accounting.help.${k}Title`)}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm leading-relaxed">
              <p>{t(`billing.accounting.help.${k}Body`)}</p>
            </CardContent>
          </Card>
        ))}

        <p className="text-meta text-muted-foreground">
          <ModuleLink to="accounting" className="hover:text-primary hover:underline">
            {t("billing.accounting.help.back")}
          </ModuleLink>
        </p>
      </div>
    </AccountingPage>
  );
}
