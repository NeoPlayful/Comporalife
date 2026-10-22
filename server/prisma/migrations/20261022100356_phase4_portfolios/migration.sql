-- CreateEnum
CREATE TYPE "AssetClass" AS ENUM ('stock', 'etf', 'fund', 'bond', 'cash', 'other');

-- CreateEnum
CREATE TYPE "TradeKind" AS ENUM ('buy', 'sell', 'dividend', 'interest', 'fee', 'tax');

-- CreateEnum
CREATE TYPE "CostBasisMethod" AS ENUM ('average');

-- CreateEnum
CREATE TYPE "CashflowKind" AS ENUM ('deposit', 'withdraw');

-- CreateEnum
CREATE TYPE "PriceSource" AS ENUM ('manual', 'imported', 'provider');

-- CreateEnum
CREATE TYPE "ValuationSource" AS ENUM ('computed', 'manual');

-- CreateEnum
CREATE TYPE "PortfolioStatus" AS ENUM ('active', 'archived');

-- CreateEnum
CREATE TYPE "AllocationDimension" AS ENUM ('asset_class', 'instrument', 'currency');

-- AlterEnum
ALTER TYPE "TransactionType" ADD VALUE 'investment';

-- CreateTable
CREATE TABLE "instruments" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "symbol" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "asset_class" "AssetClass" NOT NULL,
    "currency" TEXT NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "instruments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instrument_prices" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "instrument_id" UUID NOT NULL,
    "price_date" DATE NOT NULL,
    "price" DECIMAL(20,8) NOT NULL,
    "source" "PriceSource" NOT NULL DEFAULT 'manual',
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "instrument_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portfolios" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "cost_basis_method" "CostBasisMethod" NOT NULL DEFAULT 'average',
    "status" "PortfolioStatus" NOT NULL DEFAULT 'active',
    "note" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "portfolios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portfolio_trades" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "portfolio_id" UUID NOT NULL,
    "instrument_id" UUID,
    "kind" "TradeKind" NOT NULL,
    "trade_date" TIMESTAMPTZ(6) NOT NULL,
    "quantity" DECIMAL(24,8),
    "price" DECIMAL(20,8),
    "amount" DECIMAL(20,6) NOT NULL,
    "fee" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "tax" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "transaction_id" UUID,
    "note" TEXT,
    "voided_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "portfolio_trades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portfolio_cashflows" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "portfolio_id" UUID NOT NULL,
    "kind" "CashflowKind" NOT NULL,
    "flow_date" TIMESTAMPTZ(6) NOT NULL,
    "amount" DECIMAL(20,6) NOT NULL,
    "transaction_id" UUID,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portfolio_cashflows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portfolio_valuations" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "portfolio_id" UUID NOT NULL,
    "valuation_date" DATE NOT NULL,
    "market_value" DECIMAL(20,6) NOT NULL,
    "source" "ValuationSource" NOT NULL DEFAULT 'computed',
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portfolio_valuations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portfolio_targets" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "portfolio_id" UUID NOT NULL,
    "dimension" "AllocationDimension" NOT NULL,
    "key" TEXT NOT NULL,
    "target_weight" DECIMAL(9,6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "portfolio_targets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "instruments_user_id_asset_class_idx" ON "instruments"("user_id", "asset_class");

-- CreateIndex
CREATE UNIQUE INDEX "instruments_user_id_symbol_key" ON "instruments"("user_id", "symbol");

-- CreateIndex
CREATE INDEX "instrument_prices_instrument_id_price_date_idx" ON "instrument_prices"("instrument_id", "price_date" DESC);

-- CreateIndex
CREATE INDEX "instrument_prices_user_id_idx" ON "instrument_prices"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "instrument_prices_instrument_id_price_date_key" ON "instrument_prices"("instrument_id", "price_date");

-- CreateIndex
CREATE INDEX "portfolios_user_id_status_idx" ON "portfolios"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "portfolios_user_id_name_key" ON "portfolios"("user_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "portfolios_user_id_account_id_key" ON "portfolios"("user_id", "account_id");

-- CreateIndex
CREATE INDEX "portfolio_trades_portfolio_id_trade_date_idx" ON "portfolio_trades"("portfolio_id", "trade_date");

-- CreateIndex
CREATE INDEX "portfolio_trades_portfolio_id_instrument_id_trade_date_idx" ON "portfolio_trades"("portfolio_id", "instrument_id", "trade_date");

-- CreateIndex
CREATE INDEX "portfolio_trades_user_id_trade_date_idx" ON "portfolio_trades"("user_id", "trade_date");

-- CreateIndex
CREATE INDEX "portfolio_trades_transaction_id_idx" ON "portfolio_trades"("transaction_id");

-- CreateIndex
CREATE INDEX "portfolio_cashflows_portfolio_id_flow_date_idx" ON "portfolio_cashflows"("portfolio_id", "flow_date");

-- CreateIndex
CREATE UNIQUE INDEX "portfolio_valuations_portfolio_id_valuation_date_key" ON "portfolio_valuations"("portfolio_id", "valuation_date");

-- CreateIndex
CREATE UNIQUE INDEX "portfolio_targets_portfolio_id_dimension_key_key" ON "portfolio_targets"("portfolio_id", "dimension", "key");

-- AddForeignKey
ALTER TABLE "instruments" ADD CONSTRAINT "instruments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instrument_prices" ADD CONSTRAINT "instrument_prices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instrument_prices" ADD CONSTRAINT "instrument_prices_instrument_id_fkey" FOREIGN KEY ("instrument_id") REFERENCES "instruments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portfolios" ADD CONSTRAINT "portfolios_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portfolios" ADD CONSTRAINT "portfolios_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portfolio_trades" ADD CONSTRAINT "portfolio_trades_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portfolio_trades" ADD CONSTRAINT "portfolio_trades_portfolio_id_fkey" FOREIGN KEY ("portfolio_id") REFERENCES "portfolios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portfolio_trades" ADD CONSTRAINT "portfolio_trades_instrument_id_fkey" FOREIGN KEY ("instrument_id") REFERENCES "instruments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portfolio_cashflows" ADD CONSTRAINT "portfolio_cashflows_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portfolio_cashflows" ADD CONSTRAINT "portfolio_cashflows_portfolio_id_fkey" FOREIGN KEY ("portfolio_id") REFERENCES "portfolios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portfolio_valuations" ADD CONSTRAINT "portfolio_valuations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portfolio_valuations" ADD CONSTRAINT "portfolio_valuations_portfolio_id_fkey" FOREIGN KEY ("portfolio_id") REFERENCES "portfolios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portfolio_targets" ADD CONSTRAINT "portfolio_targets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portfolio_targets" ADD CONSTRAINT "portfolio_targets_portfolio_id_fkey" FOREIGN KEY ("portfolio_id") REFERENCES "portfolios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
