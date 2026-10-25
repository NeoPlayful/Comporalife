-- 币种对申请机制已被「自选汇率」取代：用户直接把自己需要的币种对加入列表，
-- 不再需要管理员审核。申请数据本身没有长期价值（批准后也不写汇率值），
-- 因此整表删除。
--
-- 不可逆：执行前如需留档，请先导出：
--   SELECT * FROM "rate_pair_requests";
DROP TABLE "rate_pair_requests";
DROP TYPE "PairRequestStatus";
