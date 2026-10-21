ALTER TABLE "product_reviews" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "product_reviews" ADD COLUMN "author_city" text;--> statement-breakpoint
ALTER TABLE "product_reviews" ADD COLUMN "source" text DEFAULT 'customer' NOT NULL;--> statement-breakpoint
ALTER TABLE "product_reviews" ADD COLUMN "source_platform" text;--> statement-breakpoint
ALTER TABLE "product_reviews" ADD COLUMN "source_url" text;--> statement-breakpoint
ALTER TABLE "product_reviews" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "product_reviews" ADD CONSTRAINT "product_reviews_verified_order_ck" CHECK (not "product_reviews"."verified" or "product_reviews"."order_id" is not null);--> statement-breakpoint
ALTER TABLE "product_reviews" ADD CONSTRAINT "product_reviews_customer_user_ck" CHECK ("product_reviews"."source" <> 'customer' or "product_reviews"."user_id" is not null);