-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('uploaded', 'parsed', 'mapped', 'validated', 'committing', 'completed', 'failed', 'cancelled', 'rolled_back');

-- CreateEnum
CREATE TYPE "ImportFormat" AS ENUM ('csv', 'xlsx');

-- CreateEnum
CREATE TYPE "ImportRowStatus" AS ENUM ('pending', 'valid', 'invalid', 'duplicate', 'suspected', 'skipped', 'imported', 'failed');

-- CreateEnum
CREATE TYPE "DuplicateKind" AS ENUM ('exact', 'suspected');

-- CreateEnum
CREATE TYPE "TransactionSource" AS ENUM ('manual', 'import');

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "balance_after" DECIMAL(20,6),
ADD COLUMN     "external_id" TEXT,
ADD COLUMN     "import_batch_id" UUID,
ADD COLUMN     "import_fingerprint" CHAR(64),
ADD COLUMN     "source" "TransactionSource" NOT NULL DEFAULT 'manual';

-- CreateTable
CREATE TABLE "import_batches" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'uploaded',
    "original_filename" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "file_sha256" CHAR(64) NOT NULL,
    "storage_key" TEXT NOT NULL,
    "encryption_iv" TEXT NOT NULL,
    "encryption_tag" TEXT NOT NULL,
    "format" "ImportFormat" NOT NULL,
    "encoding" TEXT NOT NULL,
    "delimiter" TEXT,
    "sheet_name" TEXT,
    "header_row" INTEGER,
    "template_id" UUID,
    "mapping" JSONB,
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "valid_rows" INTEGER NOT NULL DEFAULT 0,
    "invalid_rows" INTEGER NOT NULL DEFAULT 0,
    "duplicate_rows" INTEGER NOT NULL DEFAULT 0,
    "suspected_rows" INTEGER NOT NULL DEFAULT 0,
    "skipped_rows" INTEGER NOT NULL DEFAULT 0,
    "imported_rows" INTEGER NOT NULL DEFAULT 0,
    "failure_reason" TEXT,
    "committed_at" TIMESTAMPTZ(6),
    "rolled_back_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_rows" (
    "id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "row_number" INTEGER NOT NULL,
    "raw" JSONB NOT NULL,
    "occurred_at" TIMESTAMPTZ(6),
    "amount" DECIMAL(20,6),
    "currency" TEXT,
    "description" TEXT,
    "merchant" TEXT,
    "external_id" TEXT,
    "balance_after" DECIMAL(20,6),
    "direction" TEXT,
    "fingerprint" CHAR(64),
    "status" "ImportRowStatus" NOT NULL DEFAULT 'pending',
    "errors" JSONB,
    "transaction_id" UUID,
    "duplicate_kind" "DuplicateKind",
    "duplicate_of_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_templates" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "bank_name" TEXT,
    "format" "ImportFormat" NOT NULL,
    "header_signature" CHAR(64) NOT NULL,
    "mapping" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "import_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "classification_rules" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "conditions" JSONB NOT NULL,
    "actions" JSONB NOT NULL,
    "match_count" INTEGER NOT NULL DEFAULT 0,
    "last_applied_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "classification_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "import_batches_user_id_created_at_idx" ON "import_batches"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "import_batches_user_id_status_idx" ON "import_batches"("user_id", "status");

-- CreateIndex
CREATE INDEX "import_batches_user_id_file_sha256_idx" ON "import_batches"("user_id", "file_sha256");

-- CreateIndex
CREATE INDEX "import_rows_batch_id_status_idx" ON "import_rows"("batch_id", "status");

-- CreateIndex
CREATE INDEX "import_rows_user_id_fingerprint_idx" ON "import_rows"("user_id", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "import_rows_batch_id_row_number_key" ON "import_rows"("batch_id", "row_number");

-- CreateIndex
CREATE INDEX "import_templates_user_id_format_header_signature_idx" ON "import_templates"("user_id", "format", "header_signature");

-- CreateIndex
CREATE UNIQUE INDEX "import_templates_user_id_name_key" ON "import_templates"("user_id", "name");

-- CreateIndex
CREATE INDEX "classification_rules_user_id_priority_idx" ON "classification_rules"("user_id", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "classification_rules_user_id_name_key" ON "classification_rules"("user_id", "name");

-- CreateIndex
CREATE INDEX "transactions_import_batch_id_idx" ON "transactions"("import_batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_user_id_import_fingerprint_key" ON "transactions"("user_id", "import_fingerprint");

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_import_batch_id_fkey" FOREIGN KEY ("import_batch_id") REFERENCES "import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "import_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "import_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_templates" ADD CONSTRAINT "import_templates_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classification_rules" ADD CONSTRAINT "classification_rules_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

