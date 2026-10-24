-- CreateEnum
CREATE TYPE "ExportStatus" AS ENUM ('queued', 'running', 'ready', 'failed', 'expired');

-- CreateEnum
CREATE TYPE "ExportScope" AS ENUM ('full', 'ledger', 'investments', 'simulations', 'planning', 'settings');

-- CreateEnum
CREATE TYPE "BackupStatus" AS ENUM ('creating', 'ready', 'failed', 'expired');

-- CreateEnum
CREATE TYPE "BackupFormat" AS ENUM ('json_encrypted');

-- CreateEnum
CREATE TYPE "TaskKind" AS ENUM ('export', 'backup', 'restore', 'recheck');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('queued', 'running', 'succeeded', 'failed', 'cancelled');

-- CreateTable
CREATE TABLE "data_exports" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "scope" "ExportScope" NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'csv_zip',
    "status" "ExportStatus" NOT NULL DEFAULT 'queued',
    "params" JSONB NOT NULL,
    "manifest" JSONB,
    "file_key" TEXT,
    "size_bytes" BIGINT,
    "sha256" CHAR(64),
    "row_count" INTEGER,
    "failure_code" TEXT,
    "expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "data_exports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backups" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "format" "BackupFormat" NOT NULL DEFAULT 'json_encrypted',
    "schema_version" TEXT NOT NULL,
    "scope" JSONB NOT NULL,
    "file_key" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "status" "BackupStatus" NOT NULL DEFAULT 'creating',
    "restore_count" INTEGER NOT NULL DEFAULT 0,
    "last_restored_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "backups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_tasks" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" "TaskKind" NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'queued',
    "progress" DECIMAL(5,4) NOT NULL DEFAULT 0,
    "stage" TEXT,
    "target_type" TEXT,
    "target_id" UUID,
    "summary" JSONB,
    "failure_code" TEXT,
    "failure_message" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "heartbeat_at" TIMESTAMPTZ(6),
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),
    "cancel_requested_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "key" VARCHAR(64) NOT NULL,
    "value" JSONB NOT NULL,
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "data_exports_user_id_created_at_idx" ON "data_exports"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "data_exports_status_created_at_idx" ON "data_exports"("status", "created_at");

-- CreateIndex
CREATE INDEX "data_exports_expires_at_idx" ON "data_exports"("expires_at");

-- CreateIndex
CREATE INDEX "backups_user_id_created_at_idx" ON "backups"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "backups_status_idx" ON "backups"("status");

-- CreateIndex
CREATE INDEX "backups_expires_at_idx" ON "backups"("expires_at");

-- CreateIndex
CREATE INDEX "job_tasks_user_id_created_at_idx" ON "job_tasks"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "job_tasks_status_created_at_idx" ON "job_tasks"("status", "created_at");

-- CreateIndex
CREATE INDEX "job_tasks_kind_status_idx" ON "job_tasks"("kind", "status");

-- AddForeignKey
ALTER TABLE "data_exports" ADD CONSTRAINT "data_exports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backups" ADD CONSTRAINT "backups_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_tasks" ADD CONSTRAINT "job_tasks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
