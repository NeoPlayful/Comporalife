-- AlterTable
ALTER TABLE "users" ADD COLUMN     "deleted_at" TIMESTAMPTZ(6),
ADD COLUMN     "deletion_requested_at" TIMESTAMPTZ(6),
ADD COLUMN     "deletion_reviewed_at" TIMESTAMPTZ(6);
