-- 汇率存储归一为「USD→X 单一方向」。
--
-- 旧模型同时存了 seed 的 USD→X 与自动同步写的 X→用户基准币，方向混杂。
-- 读取侧改为「任意币种对由 (USD→to)/(USD→from) 套算」，因此这里把能无损
-- 转成 USD 腿的行保留下来：
--   1. X→USD 取倒数得到 USD→X（保留每日序列，图表不断档）
--   2. 其余 base≠USD 的自动同步行（如 X→CNY）无法在不借助当日 USD 腿的情况下
--      干净还原，直接删除；这些交叉对之后由两条 USD 腿实时套算
--   3. 人工录入行（source='manual'）一律保留：人工交叉对是权威覆盖，读取侧优先
--
-- 说明：1 USD = rate X ⇔ X→USD 的行 rate 表示 1 X = rate USD，
-- 因此 USD→X 的汇率是它的倒数。小数按 DECIMAL(20,10) 舍入。

-- 1. 把每个 X→USD 的自动行倒转成 USD→X（同日已有 USD→X 时跳过，保留原值）
INSERT INTO "exchange_rates" ("id", "base_currency", "quote_currency", "rate", "rate_date", "source", "created_at", "updated_at")
SELECT
  gen_random_uuid(),
  'USD',
  r."base_currency",
  ROUND(1::numeric / r."rate", 10),
  r."rate_date",
  r."source",
  now(),
  now()
FROM "exchange_rates" r
WHERE r."quote_currency" = 'USD'
  AND r."base_currency" <> 'USD'
  AND r."rate" > 0
  AND r."source" = 'provider'
  AND ROUND(1::numeric / r."rate", 10) > 0
ON CONFLICT ("base_currency", "quote_currency", "rate_date") DO NOTHING;

-- 2. 删除所有 base≠USD 的自动同步行：X→USD 已在上一步转成 USD→X，
--    其余非 USD 基准的自动行无法无损还原，统一清除。人工行不动。
DELETE FROM "exchange_rates"
WHERE "base_currency" <> 'USD'
  AND "source" = 'provider';
