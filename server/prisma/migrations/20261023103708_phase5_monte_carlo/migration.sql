-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('queued', 'running', 'succeeded', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "RunStage" AS ENUM ('preparing', 'simulating', 'aggregating', 'finalizing');

-- CreateEnum
CREATE TYPE "ReturnModel" AS ENUM ('lognormal');

-- CreateEnum
CREATE TYPE "RebalanceFrequency" AS ENUM ('none', 'monthly', 'quarterly', 'annual');

-- CreateTable
CREATE TABLE "monte_carlo_scenarios" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "years" INTEGER NOT NULL,
    "path_count" INTEGER NOT NULL,
    "rebalance" "RebalanceFrequency" NOT NULL DEFAULT 'annual',
    "return_model" "ReturnModel" NOT NULL DEFAULT 'lognormal',
    "assets" JSONB NOT NULL,
    "correlation" JSONB NOT NULL,
    "settings" JSONB NOT NULL,
    "model_version" TEXT NOT NULL DEFAULT 'montecarlo-v1',
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "monte_carlo_scenarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monte_carlo_runs" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "scenario_id" UUID NOT NULL,
    "scenario_name" TEXT NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'queued',
    "stage" "RunStage",
    "progress" DECIMAL(5,4) NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "assumptions" JSONB NOT NULL,
    "seed" INTEGER NOT NULL,
    "model_version" TEXT NOT NULL,
    "path_count" INTEGER NOT NULL,
    "years" INTEGER NOT NULL,
    "cancel_requested_at" TIMESTAMPTZ(6),
    "heartbeat_at" TIMESTAMPTZ(6),
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),
    "duration_ms" INTEGER,
    "failure_code" TEXT,
    "failure_message" TEXT,
    "result" JSONB,
    "sample_paths" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "monte_carlo_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "monte_carlo_scenarios_user_id_updated_at_idx" ON "monte_carlo_scenarios"("user_id", "updated_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "monte_carlo_scenarios_user_id_name_key" ON "monte_carlo_scenarios"("user_id", "name");

-- CreateIndex
CREATE INDEX "monte_carlo_runs_user_id_created_at_idx" ON "monte_carlo_runs"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "monte_carlo_runs_scenario_id_created_at_idx" ON "monte_carlo_runs"("scenario_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "monte_carlo_runs_status_created_at_idx" ON "monte_carlo_runs"("status", "created_at");

-- AddForeignKey
ALTER TABLE "monte_carlo_scenarios" ADD CONSTRAINT "monte_carlo_scenarios_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monte_carlo_runs" ADD CONSTRAINT "monte_carlo_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monte_carlo_runs" ADD CONSTRAINT "monte_carlo_runs_scenario_id_fkey" FOREIGN KEY ("scenario_id") REFERENCES "monte_carlo_scenarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
