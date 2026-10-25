-- Phase 10：汇率全局化。
-- 不可逆：删除 user_id 与去重都无法还原，执行前请先运行
--   npx tsx --env-file=.env prisma/scripts/phase10-export-rates.ts
-- 该脚本会导出全表 JSON 与冲突报告到本迁移目录。

-- CreateEnum
CREATE TYPE "PairRequestStatus" AS ENUM ('pending', 'approved', 'rejected');
CREATE TYPE "SyncTrigger" AS ENUM ('scheduled', 'manual');
CREATE TYPE "SyncStatus" AS ENUM ('running', 'succeeded', 'partial', 'failed', 'skipped');

-- AlterEnum
-- 本迁移不写入 provider 值，因此在同一事务内新增枚举值是安全的
ALTER TYPE "RateSource" ADD VALUE 'provider';

-- CreateTable
CREATE TABLE "rate_pair_requests" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "base_currency" TEXT NOT NULL,
    "quote_currency" TEXT NOT NULL,
    "reason" VARCHAR(200),
    "status" "PairRequestStatus" NOT NULL DEFAULT 'pending',
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "review_note" VARCHAR(200),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rate_pair_requests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "rate_sync_runs" (
    "id" UUID NOT NULL,
    "triggered_by" UUID,
    "trigger" "SyncTrigger" NOT NULL,
    "provider" TEXT NOT NULL,
    "anchor_currency" TEXT NOT NULL,
    "status" "SyncStatus" NOT NULL DEFAULT 'running',
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(6),
    "fetched_pairs" INTEGER NOT NULL DEFAULT 0,
    "written_rows" INTEGER NOT NULL DEFAULT 0,
    "skipped_manual" INTEGER NOT NULL DEFAULT 0,
    "failures" JSONB,
    "error_code" TEXT,
    "error_message" TEXT,

    CONSTRAINT "rate_sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rate_pair_requests_user_id_base_currency_quote_currency_status_key"
    ON "rate_pair_requests"("user_id", "base_currency", "quote_currency", "status");
CREATE INDEX "rate_pair_requests_status_created_at_idx" ON "rate_pair_requests"("status", "created_at");
CREATE INDEX "rate_sync_runs_started_at_idx" ON "rate_sync_runs"("started_at" DESC);
CREATE INDEX "rate_sync_runs_status_started_at_idx" ON "rate_sync_runs"("status", "started_at");

-- AddForeignKey
ALTER TABLE "rate_pair_requests" ADD CONSTRAINT "rate_pair_requests_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 去重：同一币种对同一天保留 createdAt 最早的一行（最早记录最接近当天真实使用值）。
-- createdAt 相同时用 id 兜底，保证结果确定而非依赖扫描顺序。
DELETE FROM "exchange_rates" a
USING "exchange_rates" b
WHERE a."base_currency" = b."base_currency"
  AND a."quote_currency" = b."quote_currency"
  AND a."rate_date" = b."rate_date"
  AND (
    a."created_at" > b."created_at"
    OR (a."created_at" = b."created_at" AND a."id" > b."id")
  );

-- 改结构：去掉用户维度
DROP INDEX IF EXISTS "exchange_rates_user_id_base_currency_quote_currency_rate_date_key";
DROP INDEX IF EXISTS "exchange_rates_user_id_base_currency_quote_currency_rate_date_idx";
ALTER TABLE "exchange_rates" DROP CONSTRAINT IF EXISTS "exchange_rates_user_id_fkey";
ALTER TABLE "exchange_rates" DROP COLUMN "user_id";

ALTER TABLE "exchange_rates" ADD COLUMN "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX "exchange_rates_base_currency_quote_currency_rate_date_key"
    ON "exchange_rates"("base_currency", "quote_currency", "rate_date");
CREATE INDEX "exchange_rates_base_currency_quote_currency_rate_date_idx"
    ON "exchange_rates"("base_currency", "quote_currency", "rate_date" DESC);
CREATE INDEX "exchange_rates_rate_date_idx" ON "exchange_rates"("rate_date" DESC);

-- 用户展示偏好
ALTER TABLE "user_settings" ADD COLUMN "rate_display_pairs" JSONB;
