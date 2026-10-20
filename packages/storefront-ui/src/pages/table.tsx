import * as React from "react";
import type { Metadata } from "next";
import { QrCodeIcon } from "lucide-react";
import { TableMenu, type TableMenuItem } from "../client/table-menu";
import { Container, Empty } from "../components/bits";
import { apiGetOrNull, apiGetSafe, getRequestInfo, hasFeature } from "../server/api";
import type { Category } from "../types";

interface PublicTable {
  id: string;
  name: string;
  seats: number;
}

const getTable = (token: string) => apiGetOrNull<PublicTable>(`/dining/public/tables/${encodeURIComponent(token)}`, { revalidate: 0 }).catch(() => null);

export async function tableMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const { t } = await getRequestInfo();
  const table = await getTable(token);
  return { title: table ? t("table.metaTitle", { table: table.name }) : t("table.unknownTitle"), robots: { index: false, follow: false } };
}

/**
 * The restaurant's QR table menu: guests at a table pick dishes and send them straight to the kitchen (feature
 * `dining.qr-ordering`). Prices and items come from the API; the order lands on the table's running order.
 */
export async function TableMenuPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { t } = await getRequestInfo();
  const [on, table] = await Promise.all([hasFeature("dining.qr-ordering"), getTable(token)]);
  if (!on || !table) {
    return <Empty icon={<QrCodeIcon />} title={t("table.unknownTitle")} body={t("table.unknownBody")} className="max-w-md py-20" />;
  }
  const [menu, categories] = await Promise.all([
    apiGetSafe<{ items: TableMenuItem[] }>("/dining/public/menu", { items: [] }, { revalidate: 30 }),
    apiGetSafe<{ items: Category[] }>("/catalog/public/categories", { items: [] }, { revalidate: 120 }),
  ]);
  const order = new Map(categories.items.map((c, i) => [c.id, { name: c.name, sort: c.sort * 1000 + i }]));
  return (
    <Container className="max-w-3xl py-6 pb-32">
      <header className="mb-6">
        <p className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-sm font-semibold text-primary">
          <QrCodeIcon className="size-4" /> {t("table.title", { table: table.name })}
        </p>
        <p className="mt-3 text-muted-foreground">{t("table.subtitle")}</p>
      </header>
      <TableMenu
        token={token}
        items={menu.items}
        categories={[...new Set(menu.items.map((i) => i.categoryId))]
          .map((id) => ({ id, name: id ? (order.get(id)?.name ?? null) : null, sort: id ? (order.get(id)?.sort ?? 1e9) : 2e9 }))
          .sort((a, b) => a.sort - b.sort)}
      />
    </Container>
  );
}
