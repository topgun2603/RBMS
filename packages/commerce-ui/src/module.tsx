"use client";

import * as React from "react";
import { FolderTreeIcon, LayersIcon, PackageIcon, PlusIcon } from "lucide-react";
import type { NavSection, RouteDef, WebModule, WidgetDef } from "@srirealtime/web";
import { commerceMessages } from "./lib/messages";

/** Feature keys the commerce UI uses (declared by @srirealtime/catalogue, inventory and importexport; docs/features.md). */
export const COMMERCE_FEATURES = {
  catalogue: "catalogue",
  variants: "catalogue.variants",
  inventory: "inventory",
  importexport: "importexport",
} as const;

const F = COMMERCE_FEATURES;

export interface CommerceModuleOptions {
  /** Where the host mounts the module: "/" (apps/shop) or e.g. "/store". Default "/". */
  basePath?: string;
  /** Further restrict features on top of the server (grants like "catalogue", "catalogue.*"). */
  features?: string[];
}

const page = (load: () => Promise<{ default: React.ComponentType }>) => React.lazy(load);
const widgets = () => import("./widgets/catalogue");

/** The store-admin UI module (catalogue part). Mount it with createWebApp({ modules: [commerceModule()] }). */
export function commerceModule(opts: CommerceModuleOptions = {}): WebModule {
  const nav: NavSection[] = [
    {
      id: "catalogue",
      title: "commerce.nav.catalogue",
      feature: F.catalogue,
      items: [
        { href: "products", label: "commerce.nav.products", icon: PackageIcon, feature: F.catalogue, mobile: "tab", exact: false },
        { href: "categories", label: "commerce.nav.categories", icon: FolderTreeIcon, feature: F.catalogue },
        { href: "collections", label: "commerce.nav.collections", icon: LayersIcon, feature: F.catalogue, exact: false },
      ],
    },
  ];

  // Static segments before ":id" so "products/new" isn't read as a product id.
  const routes: RouteDef[] = [
    { path: "products", component: page(() => import("./pages/products")), feature: F.catalogue },
    { path: "products/new", component: page(() => import("./pages/product-new")), feature: F.catalogue, immersive: true },
    { path: "products/:id", component: page(() => import("./pages/product-edit")), feature: F.catalogue, immersive: true },
    { path: "categories", component: page(() => import("./pages/categories")), feature: F.catalogue },
    { path: "collections", component: page(() => import("./pages/collections")), feature: F.catalogue },
    { path: "collections/new", component: page(() => import("./pages/collection-new")), feature: F.catalogue, immersive: true },
    { path: "collections/:id", component: page(() => import("./pages/collection-edit")), feature: F.catalogue, immersive: true },
  ];

  const widgetDefs: WidgetDef[] = [
    { id: "catalogue", size: "sm", feature: F.catalogue, component: React.lazy(() => widgets().then((m) => ({ default: m.CatalogueWidget }))) },
  ];

  return {
    id: "commerce",
    basePath: opts.basePath ?? "/",
    features: opts.features,
    messages: commerceMessages,
    nav,
    routes,
    widgets: widgetDefs,
    actions: [{ id: "add-product", label: "commerce.nav.addProduct", href: "products/new", icon: PlusIcon, feature: F.catalogue, primary: true }],
  };
}
