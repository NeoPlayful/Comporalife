-- 新增原始单元格数组：可与批次表头按位置对应，重新映射时不丢失重名列
ALTER TABLE "import_rows" ADD COLUMN "cells" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "import_rows" ALTER COLUMN "cells" DROP DEFAULT;
