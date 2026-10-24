CREATE TABLE "dining_ingredients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"unit" text DEFAULT 'kg' NOT NULL,
	"price" integer,
	"item_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dining_recipe_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"recipe_id" uuid NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"qty" numeric(14, 4) NOT NULL,
	"unit" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dining_recipes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"note" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dining_recipes_tenant_item_uq" UNIQUE("tenant_id","item_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "dining_ingredients_tenant_name_uq" ON "dining_ingredients" USING btree ("tenant_id",lower("name"));--> statement-breakpoint
CREATE INDEX "dining_recipe_lines_tenant_recipe_idx" ON "dining_recipe_lines" USING btree ("tenant_id","recipe_id");