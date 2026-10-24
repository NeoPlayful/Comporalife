-- CreateEnum
CREATE TYPE "GoalType" AS ENUM ('savings', 'purchase', 'education', 'retirement', 'emergency_fund', 'financial_independence', 'custom');

-- CreateEnum
CREATE TYPE "GoalFundingSource" AS ENUM ('net_worth', 'account', 'portfolio');

-- CreateEnum
CREATE TYPE "GoalStatus" AS ENUM ('active', 'achieved', 'archived');

-- CreateEnum
CREATE TYPE "ReportType" AS ENUM ('net_worth', 'cashflow', 'analytics', 'investment', 'goals', 'simulation');

-- CreateTable
CREATE TABLE "financial_goals" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "GoalType" NOT NULL DEFAULT 'savings',
    "target_amount" DECIMAL(20,6) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "target_date" DATE,
    "started_at" DATE NOT NULL,
    "initial_amount" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "inflation_adjusted" BOOLEAN NOT NULL DEFAULT false,
    "inflation_rate" DECIMAL(10,6),
    "expected_annual_return" DECIMAL(10,6),
    "monthly_contribution" DECIMAL(20,6),
    "funding_source" "GoalFundingSource" NOT NULL DEFAULT 'net_worth',
    "account_id" UUID,
    "portfolio_id" UUID,
    "priority" INTEGER NOT NULL DEFAULT 1,
    "status" "GoalStatus" NOT NULL DEFAULT 'active',
    "achieved_at" DATE,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "financial_goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "ReportType" NOT NULL,
    "title" TEXT NOT NULL,
    "range_from" DATE NOT NULL,
    "range_to" DATE NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "params" JSONB NOT NULL,
    "basis" JSONB NOT NULL,
    "data" JSONB NOT NULL,
    "row_count" INTEGER NOT NULL,
    "model_versions" JSONB NOT NULL,
    "generated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "financial_goals_user_id_status_priority_idx" ON "financial_goals"("user_id", "status", "priority");

-- CreateIndex
CREATE INDEX "financial_goals_user_id_updated_at_idx" ON "financial_goals"("user_id", "updated_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "financial_goals_user_id_name_key" ON "financial_goals"("user_id", "name");

-- CreateIndex
CREATE INDEX "reports_user_id_created_at_idx" ON "reports"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "reports_user_id_type_created_at_idx" ON "reports"("user_id", "type", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "financial_goals" ADD CONSTRAINT "financial_goals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_goals" ADD CONSTRAINT "financial_goals_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_goals" ADD CONSTRAINT "financial_goals_portfolio_id_fkey" FOREIGN KEY ("portfolio_id") REFERENCES "portfolios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
