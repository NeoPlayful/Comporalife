-- CreateEnum
CREATE TYPE "AssetKind" AS ENUM ('property', 'vehicle', 'collectible', 'other');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('active', 'archived');

-- CreateEnum
CREATE TYPE "LiabilityKind" AS ENUM ('mortgage', 'consumer_loan', 'auto_loan', 'credit_line', 'other');

-- CreateEnum
CREATE TYPE "LiabilityStatus" AS ENUM ('active', 'archived');

-- CreateEnum
CREATE TYPE "ValuationBasis" AS ENUM ('manual', 'appraised', 'market');

-- CreateTable
CREATE TABLE "assets" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "AssetKind" NOT NULL DEFAULT 'other',
    "currency" CHAR(3) NOT NULL,
    "purchase_date" DATE,
    "purchase_price" DECIMAL(20,6),
    "note" TEXT,
    "status" "AssetStatus" NOT NULL DEFAULT 'active',
    "archived_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_valuations" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "valuation_date" DATE NOT NULL,
    "value" DECIMAL(20,6) NOT NULL,
    "basis" "ValuationBasis" NOT NULL DEFAULT 'manual',
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_valuations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "liabilities" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "LiabilityKind" NOT NULL DEFAULT 'other',
    "currency" CHAR(3) NOT NULL,
    "original_amount" DECIMAL(20,6),
    "start_date" DATE,
    "interest_rate" DECIMAL(10,6),
    "note" TEXT,
    "status" "LiabilityStatus" NOT NULL DEFAULT 'active',
    "archived_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "liabilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "liability_snapshots" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "liability_id" UUID NOT NULL,
    "snapshot_date" DATE NOT NULL,
    "balance" DECIMAL(20,6) NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "liability_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assets_user_id_status_idx" ON "assets"("user_id", "status");

-- CreateIndex
CREATE INDEX "assets_user_id_kind_idx" ON "assets"("user_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "assets_user_id_name_key" ON "assets"("user_id", "name");

-- CreateIndex
CREATE INDEX "asset_valuations_user_id_valuation_date_idx" ON "asset_valuations"("user_id", "valuation_date" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "asset_valuations_asset_id_valuation_date_key" ON "asset_valuations"("asset_id", "valuation_date");

-- CreateIndex
CREATE INDEX "liabilities_user_id_status_idx" ON "liabilities"("user_id", "status");

-- CreateIndex
CREATE INDEX "liabilities_user_id_kind_idx" ON "liabilities"("user_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "liabilities_user_id_name_key" ON "liabilities"("user_id", "name");

-- CreateIndex
CREATE INDEX "liability_snapshots_user_id_snapshot_date_idx" ON "liability_snapshots"("user_id", "snapshot_date" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "liability_snapshots_liability_id_snapshot_date_key" ON "liability_snapshots"("liability_id", "snapshot_date");

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_valuations" ADD CONSTRAINT "asset_valuations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_valuations" ADD CONSTRAINT "asset_valuations_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liabilities" ADD CONSTRAINT "liabilities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liability_snapshots" ADD CONSTRAINT "liability_snapshots_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liability_snapshots" ADD CONSTRAINT "liability_snapshots_liability_id_fkey" FOREIGN KEY ("liability_id") REFERENCES "liabilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
