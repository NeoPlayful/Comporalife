# Phase 3 开发计划 — 收支分析与预算

> **对应项目**：Comporalife（复利人生）Personal 开源个人版
> **上游计划**：`docs/plan-phase1.md`（S1–S7，v0.1.0）、`docs/plan-phase2.md`（P1–P8，v0.1.1）
> **技术栈**：沿用前两阶段：Fastify 5 + TypeScript + Prisma 6 + PostgreSQL 16 + Redis 7 + React 19 + Vite + Tailwind CSS 4 + ECharts 6
> **文档版本**：v3.0-plan
> **计划交付版本**：v0.2.0
> **范围决策**：收支分析 + 预算管理；不做投资、蒙特卡罗、财富目标、报表导出与数据管理

---

## 一、Phase 3 目标

> **看懂钱花到哪 → 判断花得是否合理 → 给下个月定一个可执行的上限**

Phase 1 解决了「记得对」，Phase 2 解决了「数据从哪来」。但账本本身不回答用户真正关心的问题：**这个月为什么花了这么多、哪些支出在重复发生、下个月还剩多少可以花**。

Phase 3 的核心不是再画几张图，而是三件事：

1. **口径可信**：同一份数据在不同页面、不同区间下必须给出可解释的一致结论；未分类金额不能被悄悄丢掉，缺失汇率不能被当成 1:1。
2. **可归因**：任何「支出上涨 18%」都必须能下钻到分类、商户与具体流水，而不是一个孤立数字。
3. **可执行**：预算不是一个静态数字，而是「额度 − 已花 − 结转」的实时余量，并且超额时给出明确提示。

### 核心原则

| 原则 | 说明 |
|------|------|
| **单一查询内核** | 所有分析接口共用同一层取数与折算逻辑，禁止每个接口各写一套 `where` 条件 |
| **不漏不猜** | 未分类金额单独统计并进入覆盖率指标；缺失汇率使该笔被排除并标记不完整，不做静默折算 |
| **转账与调整永远不是消费** | 转账、余额调整不进入收入、支出、分类占比、商户排行、预算执行 |
| **周期识别只做建议** | 经常性订阅/固定支出的识别结果只用于展示与「固定支出」口径，绝不自动写入交易或分类 |
| **预算执行实时计算** | 不存储「已花费」快照，避免修改历史流水后预算显示失真 |
| **结转只结转结余** | 结转只累加正结余，超支不产生负结转，避免预算滚雪球 |
| **分析不新增账本语义** | 不改 `transactions` / `transaction_entries` 的写入路径，只读不写 |
| **统计按用户时区切周期** | 与 Phase 1 的现金流口径保持一致，跨时区不在月末错分 |
| **范围有界** | 单次分析区间上限 5 年，周期识别回溯上限 24 个月，超出显式报错而非静默截断 |

---

## 二、Phase 3 开发阶段划分

```
A1 查询内核 ──┬──► A2 收支与分类 ──┐
              │                    ├──► A6 前端分析页 ──┐
              ├──► A3 商户/趋势/大额 ┤                     ├──► A7 前端预算页与交付
              │                    │                     │
              └──► A4 周期识别 ─────┘                     │
                                                          │
              A5 预算模型与执行 ──────────────────────────┘
```

| 阶段 | 内容 | 涉及模块 | 预期工时 |
|------|------|----------|---------|
| **A1 查询内核与模型** | 2 张新表、分析取数层、币种折算、覆盖率、分位数工具、能力声明 | prisma + analytics | 3-4 天 |
| **A2 收支与分类分析** | 收入支出汇总、储蓄率、分类占比（含层级汇总）、账户维度、未分类统计 | analytics | 3-4 天 |
| **A3 商户、趋势与大额** | 商户排行、周期对比（环比/同比）、大额支出、现金流趋势粒度 | analytics | 3-4 天 |
| **A4 周期识别** | 纯函数引擎：订阅与固定支出识别、固定/可变支出拆分 | analytics/insights | 3-4 天 |
| **A5 预算模型与执行** | 预算 CRUD、分类额度、执行进度、结转链、预警、复制周期 | budgets | 4-5 天 |
| **A6 前端分析页** | 概览卡、分类饼图、商户柱状图、对比图、订阅清单、大额支出表 | analytics 页面 | 4-5 天 |
| **A7 前端预算页与交付** | 预算总览、额度编辑、进度条、预警、i18n、测试与文档 | 全项目 | 3-4 天 |

> **合计约 23-30 天（单人开发）**。周期识别与预算结转是两处主要不确定性，工时已含边界调试。
> **可并行点**：A5 只依赖 A1 的取数层，与 A2–A4 完全并行；A6 的页面骨架可在 A2 接口冻结后先行；A7 依赖 A5。

### 阶段依赖说明

- **A1 是所有阶段的硬前置**：折算、覆盖率、周期切分三件事一旦分散实现，后续无法保证口径一致。
- A2 与 A3 共享同一份取数结果，接口可按前端的真实使用顺序分批上线。
- A4 的引擎是纯函数，不依赖 A5，可与预算并行开发，且必须先有单元测试再接入接口。
- A5 的预算执行需要 A1 的「某分类在某周期内的支出」聚合，因此不能早于 A1。
- A6 依赖 A2–A4 的接口；A7 依赖 A5，两个前端阶段可以重复利用图表与状态组件，但不应合并，以免一次交付过大。

---

## 三、Phase 3 范围界定

### 交付范围

| 模块 | 交付内容 |
|------|---------|
| 收支汇总 | 总收入、总支出、净结余、储蓄率、可投资结余；固定支出与可变支出拆分 |
| 分类分析 | 分类金额与占比（一级/二级两种粒度）、分类环比、分类覆盖流水与笔数 |
| 账户分析 | 按账户的收入/支出/净额，原币与折算金额并列 |
| 商户分析 | 商户支出排行、笔数、最近发生时间、所属主要分类 |
| 趋势 | 收入/支出/结余时间序列（日/周/月粒度）、环比、同比 |
| 周期识别 | 订阅与固定支出的候选识别、频率判定、下次预计日期、置信度 |
| 大额支出 | 阈值可指定，默认取本区间 P95；返回相对中位数的倍数 |
| 未分类治理 | 未分类金额、笔数、最久未分类时间、按账户分布、前 N 条待处理流水 |
| 预算 | 月度与年度预算、总预算与分类额度、执行进度、超额/接近超额预警、结转、复制到下一周期、归档 |
| 运维 | 能力声明更新、审计事件（`budget.created` / `budget.updated` / `budget.deleted`）、i18n 双语资源 |

### 明确不交付（后续阶段）

| 能力 | 原因 |
|------|------|
| 退款冲减原消费 | 需要「退款 → 原消费」的关联模型；当前退款记为收入，强行按分类推断会误伤真实收入 |
| 自定义预算周期（周度、自定义起止日、按发薪日对齐） | 与「自然月结转」的语义冲突，先把自然月做正确 |
| 预算多币种 | 预算统一以基准币种计量，跨币种支出按交易日汇率折算；多币种预算会引入预算自身的汇率口径 |
| 年度预算结转 | 结转链跨年回溯的长度与解释成本过高，年度预算视为独立区间 |
| 分类/分析结果 CSV 导出 | 属于 Phase 6 报表导出，届时统一处理公式注入转义与编码 |
| 投资、持仓、TWR/XIRR | Phase 4 范围 |
| 蒙特卡罗、异步任务与队列 | Phase 5 范围 |
| 财富目标、财务自由规划 | Phase 6 范围 |
| AI 异常检测与智能分类 | 无标注数据与评估集；规则与阈值已覆盖主要场景 |
| 家庭/多用户视图 | 个人开源版不包含 |
| 分析结果持久化与缓存 | 个人数据量下实时计算可在百毫秒级完成，缓存会引入失效问题 |
| 报表订阅、邮件推送 | 依赖 SMTP 与任务系统，Phase 6 之后 |

> **口径说明**：以上推迟项属于《项目功能全面分析》中的个人版完整功能，属于**产品范围**而非**本阶段范围**。Phase 3 不修改功能文档。

---

## 四、数据模型设计

### 4.1 模型总览（新增 2 张表）

```
budgets          按周期的预算头（月度或年度、总预算、结转开关、归档）
budget_items     预算内的分类额度（一个预算内一个分类一行）
```

对已有表**不做任何字段改动**。分析所需字段全部来自既有 `transactions` / `transaction_entries` / `categories` / `accounts`。

> **为什么不新建分析结果表**：分析结果是函数，输入是账本。存储快照会与账本产生双口径，一旦用户补录历史流水或冲正交易，快照就会说谎。这与 Phase 1「模拟结果不落库」、Phase 2「批次统计由行状态推导」是同一条原则。

### 4.2 新增枚举

```prisma
enum BudgetPeriodType {
  monthly       // 自然月
  yearly        // 自然年
}

enum BudgetStatus {
  active
  archived
}
```

### 4.3 模型定义

#### budgets

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | uuid | 主键 |
| `userId` | uuid | 归属用户，级联删除 |
| `periodType` | BudgetPeriodType | 月度或年度 |
| `year` | int | 年度，如 2026 |
| `month` | int | 1–12；**年度预算固定为 0** |
| `totalAmount` | decimal(20,6)? | 总预算额度；为空表示只做分类额度、不约束总额 |
| `rollover` | boolean | 仅月度可用；默认 false |
| `status` | BudgetStatus | 默认 active |
| `note` | varchar(500)? | 备注 |
| `version` | int | 乐观锁，默认 1 |
| `createdAt` / `updatedAt` | timestamptz | |

唯一约束：`[userId, periodType, year, month]`；索引：`[userId, year, month]`。

> **`month = 0` 而不是 NULL 的理由**：PostgreSQL 的唯一索引允许多个 NULL，若年度预算的 `month` 为 NULL，同一用户同一年的年度预算可以重复创建。用哨兵值 0 让唯一约束真正生效，字段保持 `NOT NULL`。这与 Phase 2 里「路由顺序必须注意」属于同一类必须写进文档的坑。

#### budget_items

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | uuid | 主键 |
| `budgetId` | uuid | 级联删除 |
| `userId` | uuid | 冗余存储，便于越权过滤与批量清理 |
| `categoryId` | uuid | 必须是 `kind = expense` 且未归档的分类 |
| `amount` | decimal(20,6) | 该分类的额度，必须 > 0 |
| `createdAt` / `updatedAt` | timestamptz | |

唯一约束：`[budgetId, categoryId]`；索引：`[userId, categoryId]`。

> **总预算不放进 `budget_items`**：总预算没有分类，若用 `categoryId = NULL` 表达，会再次遭遇唯一约束失效的问题，且「总预算」与「分类额度之和」本来就是两个独立概念（未分类支出计入总额但不计入任何分类额度）。

### 4.4 金额与精度

- 预算额度为 `DECIMAL(20,6)`，与账本同精度，避免出现「额度 1000.00 而支出 1000.000001」这类边界误判。
- 输入校验允许最多 6 位小数，前端展示按基准币种小数位。
- 执行进度内部用 `decimal.js` 计算，仅在响应时 `toFixed`。

---

## 五、关键设计决策

| # | 决策点 | 结论 | 理由 |
|---|--------|------|------|
| 1 | 分析数据来源 | 直接读 `transactions` + `entries`，不建结果表 | 避免账本与分析双口径 |
| 2 | 折算时点 | 按**交易日**汇率折算，而非当前汇率 | 三月支出应按三月汇率计入三月对比，否则历史区间会随汇率漂移 |
| 3 | 缺失汇率 | 排除该笔并计入 `coverage.missingRates`，标记 `isComplete=false` | 与 Phase 1 净资产口径一致，绝不按 1:1 静默处理 |
| 4 | 未分类支出 | 计入总支出，不计入任何分类占比；单独暴露覆盖率 | 分类占比图不显示未分类会让「已分类部分」被误读为全部 |
| 5 | 转账与调整 | 不计入收入/支出/分类/商户/预算 | 与 Phase 1 现金流口径一致，内部划转不是消费 |
| 6 | 已冲正交易 | 一律排除 | 冲正后不应再影响任何统计 |
| 7 | 分类层级 | 默认取一级分类，二级向上汇总；`level=2` 时平铺展示 | 一级看趋势、二级看细节 |
| 8 | 商户为空 | 单独归入「未填写商户」桶，不从描述推断商户 | 从描述猜商户会制造不可解释的假商户 |
| 9 | 同比可用性 | 历史不足 12 个月时同比返回 `null`，前端显示「—」 | 与储蓄率为 null 的处理一致 |
| 10 | 大额支出阈值 | 可传 `threshold`；默认取区间支出 P95 | 绝对阈值对不同收入水平不公平，分位数自适应且可解释 |
| 11 | 固定支出口径 | 由周期识别命中的流水构成 | 与订阅清单共用同一结果，避免两套定义互相矛盾 |
| 12 | 周期识别 | 纯函数、确定性、输出置信度与依据 | 可单测、可解释、不写库 |
| 13 | 预算执行 | 实时计算，不存快照 | 补录或冲正流水后预算立即正确 |
| 14 | 预算币种 | 统一基准币种 | 多币种预算会引入预算自身的汇率口径 |
| 15 | 结转 | 仅月度、仅正结余，回溯上限 12 个周期 | 负结转会滚雪球；过长的链无法向用户解释 |
| 16 | 父子分类同时预算 | 拒绝（422） | 会重复计算同一笔支出 |
| 17 | 分析区间上限 | 5 年（1826 天） | 个人数据量下内存聚合的可控边界 |
| 18 | 周期识别回溯上限 | 24 个月 | 覆盖年度订阅的一年周期并留余量 |
| 19 | 缓存 | 不引入 | 实时聚合足够快，缓存失效比慢更麻烦 |

---

## 六、统计口径规范

本节是 Phase 3 的「宪法」，所有接口与前端文案必须与本节的表述一致。

### 6.1 共享取数层

新增 `server/src/modules/analytics/query.service.ts`，所有分析接口只能通过它取数：

```ts
interface AnalyticsQuery {
  userId: string;
  from: Date;              // 含
  to: Date;                // 含
  timezone: string;        // 来自 user_settings，不信任客户端
  baseCurrency: string;
  accountIds?: string[];   // 为空表示全部账户
}

interface AnalyticsRow {
  transactionId: string;
  type: 'income' | 'expense' | 'transfer' | 'adjustment';
  occurredAt: Date;
  periodKey: string;               // 用户时区下的 yyyy-MM
  description: string;
  merchant: string | null;
  categoryId: string | null;
  categoryName: string | null;
  categoryParentId: string | null;
  categoryKind: 'income' | 'expense' | null;
  originalAmount: Decimal;         // 账户腿绝对值，原币
  currency: string;
  amountBase: Decimal;             // 折合基准币种，交易日汇率
}

interface AnalyticsResult {
  rows: AnalyticsRow[];
  missingRates: Array<{ currency: string; date: string }>;
  excludedCount: number;           // 因缺汇率被排除的笔数
  isComplete: boolean;
  range: { from: string; to: string; days: number };
}

loadAnalyticsRows(prisma, query): Promise<AnalyticsResult>
```

**取数规则**

1. `status = 'posted'`，冲正交易一律排除。
2. `occurredAt` 落在 `[from, to]`，边界按用户时区解释。
3. 每笔交易取**账户腿**绝对值（`entries.accountId IS NOT NULL`）作为金额；转账按单腿计算，不重复计两腿。
4. 区间天数 > 1826 → 400 `ANALYTICS_RANGE_TOO_LARGE`。
5. 折算失败的流水被剔除并记录，不参与任何汇总。

> 现有 `cashflow.service.ts` 与 `networth.service.ts` 保持不动。`computeCashflow` 服务于 Dashboard 的「本月」视图，`loadAnalyticsRows` 服务于可下钻的分析视图，两者口径必须由集成测试对齐（见第十八节），但不强行合并实现，以免 Dashboard 承担分析所需的额外折算开销。

### 6.2 收入、支出、转账、调整

| 交易类型 | 收入 | 支出 | 分类占比 | 商户排行 | 预算执行 |
|---------|:----:|:----:|:--------:|:--------:|:--------:|
| `income` | ✓ | — | — | — | — |
| `expense` | — | ✓ | ✓ | ✓ | ✓ |
| `transfer` | — | — | — | — | — |
| `adjustment` | — | — | — | — | — |

- 储蓄率 = `(收入 − 支出) / 收入`；收入为 0 时返回 `null`，不返回 0 或无穷大。
- 可投资结余 = `收入 − 支出`（即净结余），单独字段返回，避免前端自行相减。

### 6.3 时区与周期

- 周期键（`periodKey`）统一用 `formatInTimeZone(occurredAt, timezone, 'yyyy-MM')`，与 `cashflow.service.ts` 完全一致。
- 日粒度键为 `yyyy-MM-dd`，周粒度键为**该周最后一天**的 `yyyy-MM-dd`（周一为一周起点）。
- 区间参数 `from` / `to` 由前端按用户时区的自然日传入；服务端不做二次时区猜测。
- 某周期内没有任何流水时，该周期 `isComplete = false`，前端显示「数据不完整」而非零值。

### 6.4 币种折算

```
amountBase = originalAmount × rate(from=currency, to=baseCurrency, asOf=交易日 00:00 用户时区)
```

- 复用 `currencies/currency.service.ts` 的 `convertMany`，但**逐笔按交易日**传入，而不是整区间一次性传入。
- 币种等于基准币种时直接使用原值，不查汇率。
- 任意一笔缺失汇率 → 该笔排除，`isComplete = false`，`missingRates` 去重列出币种与日期。
- **响应必须同时给出 `currency` 与 `amountBase`**，让用户知道原币金额与折算金额分别是多少。

### 6.5 分类覆盖率

每个涉及分类的响应都必须携带：

```jsonc
"coverage": {
  "categorizedAmount": "8420.00",
  "uncategorizedAmount": "1260.00",
  "uncategorizedCount": 7,
  "coverageRatio": "0.8698",      // 已分类金额 / 总支出；总支出为 0 时为 null
  "missingRates": [{ "currency": "USD", "date": "2026-09-14" }],
  "isComplete": false
}
```

- 覆盖率 < 0.9 时，前端在分类图表上方显示提示条并链接到未分类流水筛选。
- 覆盖率不是「准确率」，只是「已归类比例」，文案不得暗示分类结果正确。

### 6.6 固定支出与可变支出

- **固定支出** = 周期识别引擎在回溯窗口内判定为 recurring 的流水，且发生在本区间内。
- **可变支出** = 区间总支出 − 固定支出。
- 两者之和必须严格等于区间总支出；若识别结果与总支出不一致（例如缺汇率导致剔除），以取数层结果为准并标记不完整。
- 响应返回命中的 `recurringKeys`，使用户能验证「哪些支出被算成了固定支出」。

### 6.7 大额支出

- 参数 `threshold` 可选；未传时取本区间所有支出的 **P95**。
- 分位数定义：升序排序后按 `index = (n − 1) × 0.95` 做线性插值，结果按基准币种小数位舍入。该算法写入单元测试。
- 阈值下限保护：区间支出笔数 < 20 时，P95 不稳定，改为「中位数 × 3」并返回 `thresholdSource: 'median_multiple'`。
- 响应附带 `multipleOfMedian`，用于解释「这笔为什么被判定为大额」。
- 已分类与未分类支出都参与判定，未分类的在结果中标注 `uncategorized: true`。

### 6.8 环比与同比

- **环比**：与上一个等长周期比较。月度按自然月，年度按自然年；自定义区间按「向前平移同等天数」。
- 变化率 = `(本期 − 上期) / |上期|`；上期为 0 时返回 `null`，不返回 `100%` 或无穷大。
- **同比**：本期向前平移 12 个月。仅当用户最早一笔流水的日期早于「本期起点 − 12 个月」时才计算，否则 `yoy = null`。
- 环比与同比的口径说明（是否为自然月、平移方式）必须在 `basis` 中返回。

---

## 七、周期识别引擎（`modules/analytics/recurring.engine.ts`）

### 7.1 定位

纯函数，无 IO、无时钟依赖（当前时间由调用方传入），可独立单元测试。输入为已按时间升序排列的支出流水，输出候选周期项。

```ts
interface RecurringInput {
  transactions: Array<{
    id: string;
    accountId: string;
    occurredAt: Date;
    description: string;
    merchant: string | null;
    amount: Decimal;      // 已折算基准币种的支出金额
  }>;
  now: Date;
  lookbackMonths: number;   // 默认 24
  minOccurrences: number;   // 默认 3
}

detectRecurring(input: RecurringInput): RecurringCandidate[]
```

### 7.2 分组键

```
key = accountId + '|' + normalize(merchant ?? description)
```

`normalize` 步骤（顺序固定）：

1. 全角转半角；
2. 去首尾空白，连续空白压缩为单个空格；
3. 转小写；
4. 去掉尾部形如 `-2026` `20260301` `#123456` 的流水后缀；
5. 不再做任何模糊匹配。

> **不从描述推断商户、不做编辑距离合并**：合并过度会把「房租」和「物业费」当成同一项，合并不足只是少识别一项。少识别可被用户理解，误合并不可解释。

### 7.3 判定规则

| 规则 | 条件 |
|------|------|
| 出现次数 | 组内 ≥ 3 笔，且全部落在回溯窗口内 |
| 同日去重 | 同一天出现多笔只取第一笔，避免批量导入重复行放大计数 |
| 间隔规律 | 相邻间隔天数的中位数落在 25–35（月度）、5–9（周度）、350–380（年度）之一 |
| 间隔稳定性 | 间隔的最大偏差 ≤ 中位数的 30% |
| 金额稳定性 | 金额的变异系数（标准差 / 均值）≤ 0.2 |
| 方向 | 只识别支出 |
| 最近活跃 | 最后一笔距今不超过 `1.5 × 周期长度`，否则视为已停止 |

### 7.4 置信度

```
confidence = 0.4 × countScore + 0.3 × intervalScore + 0.3 × amountScore
countScore    = min(count / 6, 1)
intervalScore = 1 − (间隔最大偏差 / 中位数)     // 截断到 [0, 1]
amountScore   = 1 − min(变异系数 / 0.2, 1)
```

只返回 `confidence ≥ 0.5` 的候选，按置信度降序，最多 50 项。置信度是**排序依据**，不是概率，文案不得称其为「概率」。

### 7.5 输出

```jsonc
{
  "key": "uuid|netflix",
  "label": "NETFLIX",
  "accountId": "uuid",
  "accountName": "信用卡",
  "frequency": "monthly",          // weekly | monthly | yearly
  "amount": "68.00",               // 最近一笔金额
  "amountVariation": "0.0312",     // 变异系数
  "occurrences": 12,
  "lastOccurredAt": "2026-10-06T00:00:00.000Z",
  "nextExpectedDate": "2026-11-06",
  "confidence": "0.87",
  "recentSamples": [
    { "transactionId": "uuid", "occurredAt": "...", "amount": "68.00", "description": "NETFLIX" }
  ]
}
```

`nextExpectedDate` = 最后一笔日期 + 周期长度（月度按自然月加一，年末自动进位）；若该日期已早于 `now`，顺延到下一个周期。

---

## 八、预算模型

### 8.1 周期与唯一性

- 月度：`periodType = monthly`，`month ∈ 1..12`。
- 年度：`periodType = yearly`，`month = 0`。
- 唯一约束 `[userId, periodType, year, month]`，重复创建返回 409 `BUDGET_PERIOD_EXISTS`。
- 归档预算保留记录，不再参与预警与总览默认列表，但可通过 `status=archived` 查询。
- 删除为物理删除（预算不含历史流水引用，删除不影响账本），仅允许删除 `active` 预算。

### 8.2 分类额度

- `categoryId` 必须属于当前用户、`kind = expense`、`archived = false`。
- `amount` 必须 > 0，最多 6 位小数。
- 允许为父分类预算，其子分类支出自动向上汇总。
- **父子冲突**：同一预算内若同时存在分类 X 与其任一祖先或后代的额度，整个请求返回 422 `BUDGET_CATEGORY_CONFLICT`，附冲突的 categoryId 对。理由：同一笔支出会被计入两次。
- 单个预算最多 50 条分类额度。

### 8.3 执行计算

```
periodFrom / periodTo = 用户时区下的自然月（或自然年）边界
rows = loadAnalyticsRows(userId, periodFrom, periodTo, ...).rows.filter(type === 'expense')

totalSpent        = Σ rows.amountBase
categorizedSpent  = Σ rows(categoryId != null).amountBase
uncategorizedSpent= totalSpent − categorizedSpent

itemSpent(categoryId) = Σ rows.amountBase
                        WHERE rows.categoryId ∈ {categoryId} ∪ descendants(categoryId)
```

- `descendants` 来自用户分类树的两级结构，一次查询后在内存中展开。
- 分类归档后其历史支出仍计入原额度（历史不因归档而消失）。
- 依赖缺失汇率的流水被排除，`isComplete = false`，并在进度响应中列出 `missingRates`。

### 8.4 结转链

```
available    = amount + carryIn
spent        = itemSpent
remaining    = available − spent
carryOut     = rollover ? max(0, remaining) : 0
carryIn(M)   = rollover ? carryOut(M − 1) : 0
```

- 仅 `periodType = monthly` 支持结转；年度预算传 `rollover = true` 返回 422 `BUDGET_ROLLOVER_UNSUPPORTED`。
- 回溯上限 12 个周期；超过上限的更早结余不再累计，响应中标记 `carryoverTruncated = true`。
- 任一前置周期不存在预算时，`carryIn = 0`（不视为整月全额结余）。
- 任一前置周期 `rollover = false` 时，链在此重置为 0。
- 结转只累加正结余：超支不产生负结转，避免「本月超支导致下月额度为负」的滚雪球。
- 结转是**计算值**，不落库；修改历史流水或历史预算后，本期结转立即变化。

### 8.5 预警

| 等级 | 条件 | 前端表现 |
|------|------|---------|
| `exceeded` | `spent > available` | 红色进度条 + 超出金额 |
| `warning` | `spent / available ≥ 0.8` | 黄色进度条 |
| `ok` | 其余 | 正常进度条 |
| `unknown` | `isComplete = false` | 灰色 + 「数据不完整」提示 |

- 总预算与分类额度分别计算等级，互不推导。
- `GET /api/budgets/alerts` 只返回当前自然月（或当前自然年）`warning` 与 `exceeded` 的项，按超支比例降序。
- 预算是提醒工具，不是强约束：超额不阻止记账。

---

## 九、A1 — 查询内核与模型

### 9.1 数据库

- [ ] `schema.prisma` 新增 `BudgetPeriodType`、`BudgetStatus` 与 `Budget`、`BudgetItem` 模型
- [ ] `User` 增加关系 `budgets Budget[]`
- [ ] 迁移为纯增量；执行 `prisma migrate dev` 后确认 Phase 1/2 数据无损
- [ ] 唯一约束 `[userId, periodType, year, month]` 与 `[budgetId, categoryId]` 生效（年度预算重复创建必须被拦截）

### 9.2 取数层

- [ ] `analytics/query.service.ts`：`loadAnalyticsRows` 与 `AnalyticsRow` 类型
- [ ] `analytics/period.ts`：`resolvePeriod`（月/年/自定义区间）、`previousPeriod`、`shiftYears`、`periodKeyOf`
- [ ] `lib/percentile.ts`：线性插值分位数，含空数组与单元素边界
- [ ] `analytics/coverage.ts`：由 rows 计算覆盖率、缺失汇率去重、完整性标记

### 9.3 配置与声明

- [ ] `constants.ts` 新增 `ANALYTICS_MAX_RANGE_DAYS = 1826`、`ANALYTICS_DEFAULT_LOOKBACK_MONTHS = 24`、`RECURRING_MIN_OCCURRENCES = 3`、`BUDGET_WARNING_RATIO = 0.8`、`BUDGET_CARRYOVER_MAX_PERIODS = 12`、`BUDGET_MAX_ITEMS = 50`
- [ ] `/api/system/capabilities` 的 `available` 增加 `analytics`、`budgets`；从 `planned` 移除 `budgets`
- [ ] `system.ts` 的 `PHASE` 常量从 `phase-1` 更新为 `phase-3`（当前值与实际交付阶段不符）

### 9.4 验收

- [ ] 取数层对同一区间返回的 `totalSpent` 与 `computeCashflow` 的 `totalExpense` 完全一致（Phase 1 回归测试覆盖）
- [ ] 缺失汇率使 `isComplete = false` 且 `excludedCount` 正确
- [ ] 5 年零 1 天的区间返回 400

---

## 十、A2 — 收支与分类分析

### 10.1 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/analytics/income-expense` | 收入、支出、净结余、储蓄率、可投资结余 |
| GET | `/api/analytics/categories` | 分类金额与占比，支持 `level`、`kind`、`previous` |
| GET | `/api/analytics/accounts` | 账户维度收支 |
| GET | `/api/analytics/uncategorized` | 未分类统计与前 N 条待处理流水 |

### 10.2 收支汇总

```jsonc
// GET /api/analytics/income-expense?from=2026-10-01&to=2026-10-31
{
  "income": "18500.00",
  "expense": "9680.00",
  "net": "8820.00",
  "savingsRate": "0.4768",
  "investableSurplus": "8820.00",
  "transactionCounts": { "income": 1, "expense": 34 },
  "coverage": { "...": "..." },
  "period": { "from": "2026-10-01", "to": "2026-10-31", "timezone": "Asia/Shanghai", "days": 31 },
  "basis": { "baseCurrency": "CNY", "excludes": ["transfer", "adjustment", "voided"] }
}
```

### 10.3 分类分析

- `kind` 默认 `expense`，可取 `income`。
- `level` 默认 `1`：按一级分类汇总，子分类金额向上累加；`level=2` 平铺返回二级分类。
- `previous=true` 时附带上一等长周期的同分类金额与变化率。
- 排序默认按金额降序；金额为 0 的分类不返回。
- `coverage` 必返；未分类金额不进入 `items`，单独在 `coverage` 中体现。

```jsonc
{
  "kind": "expense",
  "level": 1,
  "items": [
    {
      "categoryId": "uuid",
      "name": "住房",
      "amount": "5500.00",
      "ratio": "0.5683",
      "count": 1,
      "previousAmount": "5500.00",
      "changeRatio": "0.0000"
    }
  ],
  "total": "9680.00",
  "coverage": { "...": "..." },
  "period": { "...": "..." },
  "basis": { "...": "..." }
}
```

### 10.4 账户维度

- 返回每个在区间内有账户腿流水的账户（含已归档），按 `expense` 降序。
- 同时给出原币金额与折算金额，避免用户看到「美元账户的支出被折成人民币」后无法核对。

```jsonc
{
  "items": [
    {
      "accountId": "uuid",
      "name": "工资卡",
      "type": "bank",
      "currency": "CNY",
      "income": "18500.00",
      "expense": "5500.00",
      "net": "13000.00",
      "transferIn": "0.00",
      "transferOut": "5000.00",
      "incomeBase": "18500.00",
      "expenseBase": "5500.00"
    }
  ],
  "totals": { "incomeBase": "18500.00", "expenseBase": "9680.00" },
  "coverage": { "...": "..." }
}
```

> 转账在账户维度**单独列出**（`transferIn` / `transferOut`），不并入收入支出，否则账户维度会与总览对不上。

### 10.5 未分类统计

```jsonc
{
  "count": 7,
  "amount": "1260.00",
  "oldestOccurredAt": "2026-08-14T02:00:00.000Z",
  "byAccount": [{ "accountId": "uuid", "name": "日常现金", "count": 4, "amount": "820.00" }],
  "items": [
    { "transactionId": "uuid", "occurredAt": "...", "description": "...", "merchant": "...", "amount": "260.00", "currency": "CNY", "accountName": "日常现金" }
  ],
  "truncated": false
}
```

- `items` 上限 50 条，超出置 `truncated = true`；完整列表走 `/api/transactions?categoryId=null`（需在 A2 增补该筛选能力，见下）。

### 10.6 交易列表增补

`GET /api/transactions` 需要支持两个新筛选参数，供未分类下钻使用：

| 参数 | 说明 |
|------|------|
| `uncategorized=true` | 只返回 `categoryId IS NULL` 的收入/支出流水 |
| `source=manual\|import` | 按来源筛选（Phase 2 已落库 `source`，但未暴露为筛选） |

- 这两个参数为**增量扩展**，不改变既有响应结构。
- 必须复用现有分页与越权过滤逻辑，不新增查询路径。

---

## 十一、A3 — 商户、趋势与大额

### 11.1 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/analytics/merchants` | 商户支出排行 |
| GET | `/api/analytics/cashflow-trend` | 时间序列，支持 `granularity=day\|week\|month` |
| GET | `/api/analytics/period-comparison` | 环比与同比 |
| GET | `/api/analytics/large-expenses` | 大额支出 |

### 11.2 商户排行

- 只统计 `expense`。
- `merchant` 为空的流水归入独立的「未填写商户」桶，**不参与排行**，在响应中单独给出金额与笔数。
- 同一商户在不同账户下合并。
- 附带 `topCategoryId` / `topCategoryName`：该商户支出金额最高的分类，用于解释这笔钱花在哪。

```jsonc
{
  "items": [
    { "merchant": "示例房东", "amount": "5500.00", "count": 1, "ratio": "0.5683", "lastOccurredAt": "...", "topCategoryName": "住房" }
  ],
  "unattributed": { "amount": "1200.00", "count": 9 },
  "total": "9680.00",
  "coverage": { "...": "..." }
}
```

### 11.3 时间序列

- `granularity` 默认：区间 ≤ 90 天为 `day`，≤ 730 天为 `week`，否则 `month`；可显式指定。
- 每个点返回 `period`、`income`、`expense`、`net`、`isComplete`。
- 与 `/api/dashboard/cashflow` 的区别：Dashboard 版本固定按月且服务于概览；本接口支持三种粒度并返回覆盖率，供分析页使用。两者对同一区间、同一粒度的结果必须一致（集成测试覆盖）。
- 点数上限 400：超过时自动降级粒度并在响应中返回 `granularity` 与 `downgraded: true`。

### 11.4 周期对比

```jsonc
{
  "current": { "period": {...}, "income": "...", "expense": "...", "net": "...", "savingsRate": "0.47" },
  "previous": { "period": {...}, "income": "...", "expense": "...", "net": "...", "savingsRate": "0.51" },
  "changes": { "income": "-0.0320", "expense": "0.1800", "net": "-0.2214", "savingsRate": "-0.04" },
  "yoy": {
    "period": {...},
    "income": "...", "expense": "...", "net": "...",
    "changes": { "expense": "0.0920" }
  },
  "basis": { "comparisonMode": "natural_month", "yoyAvailable": true }
}
```

- `yoy` 在历史不足时整体为 `null`，`basis.yoyAvailable = false`。
- 变化率为 `null` 时表示上期为 0，前端显示「—」。

### 11.5 大额支出

```jsonc
{
  "threshold": "1180.00",
  "thresholdSource": "p95",     // p95 | median_multiple | parameter
  "items": [
    { "transactionId": "...", "occurredAt": "...", "description": "...", "merchant": "...",
      "categoryName": "住房", "uncategorized": false, "amount": "5500.00", "multipleOfMedian": "9.6" }
  ],
  "median": "572.00",
  "expenseCount": 34,
  "coverage": { "...": "..." }
}
```

---

## 十二、A4 — 周期识别

### 12.1 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/analytics/recurring` | 订阅与固定支出候选 |
| GET | `/api/analytics/fixed-variable` | 固定支出与可变支出拆分 |

参数：`lookbackMonths`（6–24，默认 12）、`frequency`（可选筛选）。

### 12.2 实现要求

- [ ] `recurring.engine.ts` 为纯函数，不 import Prisma、不读 `Date.now()`
- [ ] 引擎输入为已折算金额，折算在调用方完成，引擎不关心币种
- [ ] 单元测试覆盖 7.3 的每一条规则的三类边界：刚好满足、刚好不满足、明显不满足
- [ ] `fixed-variable` 复用同一引擎结果，禁止另写一套判定

### 12.3 固定/可变拆分

```jsonc
{
  "fixed": {
    "amount": "5860.00",
    "ratio": "0.6054",
    "items": [{ "key": "...", "label": "NETFLIX", "amount": "68.00", "frequency": "monthly" }]
  },
  "variable": { "amount": "3820.00", "ratio": "0.3946" },
  "total": "9680.00",
  "recurringKeys": ["uuid|netflix", "uuid|示例房东"],
  "coverage": { "...": "..." }
}
```

> 识别不到任何周期项时，`fixed.amount = 0` 且 `variable.amount = total`，并在响应中返回 `note: 'no_recurring_detected'`，前端提示「未识别到周期性支出」，而不是展示一个 0 的固定支出图。

### 12.4 已知限制（必须写进 UI 文案与文档）

- 金额波动大（水电煤）或间隔不规律（餐饮）的支出不会被识别，属于预期行为。
- 同一商户在不同账户各有一笔月度扣款时，会分别识别为两个周期项。
- 识别只依赖历史流水，新用户的固定支出需要至少 3 个月数据。

---

## 十三、A5 — 预算模型与执行

### 13.1 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/budgets` | 预算列表，按 `year` / `month` / `periodType` / `status` 筛选 |
| POST | `/api/budgets` | 创建预算（可同时带分类额度） |
| GET | `/api/budgets/summary` | 指定周期的总览与各项进度 |
| GET | `/api/budgets/alerts` | 当前周期的预警项 |
| GET | `/api/budgets/:id` | 预算详情（含额度与进度） |
| PATCH | `/api/budgets/:id` | 修改总额、结转、备注、额度集合 |
| DELETE | `/api/budgets/:id` | 删除（仅 active） |
| POST | `/api/budgets/:id/copy` | 复制到下一周期 |
| GET | `/api/budgets/:id/progress` | 单预算执行进度（含结转明细） |

> **路由顺序**：`/budgets/summary`、`/budgets/alerts` 必须在 `/budgets/:id` **之前**注册，否则会被参数路由吞掉。Phase 2 已在 `/imports/templates` 踩过同一个坑，本阶段必须在路由文件顶部加注释提醒。

### 13.2 创建与更新

```jsonc
// POST /api/budgets
{
  "periodType": "monthly",
  "year": 2026,
  "month": 11,
  "totalAmount": "10000.00",
  "rollover": true,
  "note": "十一月",
  "items": [
    { "categoryId": "uuid-housing", "amount": "5500.00" },
    { "categoryId": "uuid-food", "amount": "2000.00" }
  ]
}
```

- `items` 为**全量替换**语义：PATCH 时未出现的分类额度会被删除。前端编辑界面必须一次性提交完整集合。
- 单事务写入预算与额度；任一额度校验失败整体回滚。
- 创建成功后写审计 `budget.created`（只记预算 ID、周期与额度条数，不记金额明细）。
- 校验失败码见第十六节。

### 13.3 总览与进度

```jsonc
// GET /api/budgets/summary?periodType=monthly&year=2026&month=10
{
  "budget": { "id": "...", "totalAmount": "10000.00", "rollover": true, "version": 3 },
  "period": { "from": "2026-10-01", "to": "2026-10-31", "timezone": "Asia/Shanghai" },
  "total": {
    "amount": "10000.00",
    "carryIn": "820.00",
    "available": "10820.00",
    "spent": "9680.00",
    "remaining": "1140.00",
    "usageRatio": "0.8946",
    "level": "warning",
    "carryOut": "1140.00",
    "carryoverTruncated": false
  },
  "items": [
    {
      "itemId": "...", "categoryId": "...", "categoryName": "住房",
      "amount": "5500.00", "carryIn": "0.00", "available": "5500.00",
      "spent": "5500.00", "remaining": "0.00", "usageRatio": "1.0000",
      "level": "ok", "childCategoryIds": ["..."]
    }
  ],
  "uncategorizedSpent": "1260.00",
  "coverage": { "...": "..." },
  "basis": { "baseCurrency": "CNY", "rolloverChain": 3 }
}
```

- `usageRatio` 在 `available ≤ 0` 时返回 `null`。
- `uncategorizedSpent` 单独给出：它计入总预算的 `spent`，但不计入任何分类额度。
- `rolloverChain` 表示本次实际回溯了多少个前置周期，便于用户判断结转可信度。

### 13.4 复制到下一周期

```
1. 读取源预算，计算目标周期（月度：下个月，跨年自动进位；年度：下一年）
2. 目标周期已存在预算 → 409 BUDGET_PERIOD_EXISTS（附目标预算 ID）
3. 复制 totalAmount、rollover、note 与全部 items
4. 单事务创建，写审计 budget.copied
5. 返回新预算 ID
```

- 不复制执行结果（本来就不存储）。
- 不复制归档状态，新预算一律 `active`。

### 13.5 审计

| 事件 | 记录内容 |
|------|---------|
| `budget.created` | 预算 ID、周期、额度条数 |
| `budget.updated` | 预算 ID、变更字段名 |
| `budget.deleted` | 预算 ID、周期 |
| `budget.copied` | 源预算 ID、目标预算 ID |

**不记录金额明细、不记录分类名称**，与其他审计事件保持一致。

---

## 十四、A6 — 前端分析页

### 14.1 路由与导航

| 路由 | 页面 | 图标 |
|------|------|------|
| `/analytics` | `AnalyticsPage` | `BarChart3` |
| `/budgets` | `BudgetsPage` | `Target` |

侧边栏顺序调整为：仪表板 → 账户 → 交易 → 账单导入 → **分析** → **预算** → 分类管理 → 复利模拟 → 设置。侧边栏已有 7 项，新增两项后必须确认 `h-screen` 固定布局下导航区仍可独立滚动（参见既有布局约定：固定侧边栏使用独立全屏根布局）。

### 14.2 页面结构

```
AnalyticsPage
├── 顶部：区间选择（本月 / 上月 / 本季 / 本年 / 自定义）
├── 概览卡：收入、支出、净结余、储蓄率（附环比箭头）
├── 覆盖率提示条（覆盖率 < 0.9 时出现，仅一行，可跳转未分类）
├── Tab
│   ├── 分类     CategoryPieChart + 分类明细表（含环比）
│   ├── 商户     MerchantBarChart（Top 15）+ 商户明细表
│   ├── 趋势     TrendComparisonChart（折线 + 柱状）
│   ├── 周期     订阅清单卡片 + 固定/可变支出占比条
│   ├── 大额     大额支出表格
│   └── 账户     账户维度收支表
└── 每个图表下方：灰字口径说明（区间、基准币种、是否完整）
```

### 14.3 组件

```
components/analytics/
├── AnalyticsRangePicker.tsx     区间选择与快捷项
├── CoverageNotice.tsx           覆盖率与缺失汇率提示
├── CategoryPieChart.tsx         一级分类环形图
├── CategoryBreakdownTable.tsx   分类明细与环比
├── MerchantBarChart.tsx         横向条形图
├── TrendComparisonChart.tsx     收入/支出柱 + 结余线
├── RecurringList.tsx            周期项卡片（含下次预计日期）
├── FixedVariableBar.tsx         固定/可变支出占比
├── LargeExpenseTable.tsx        大额支出表
└── AccountBreakdownTable.tsx    账户维度表
```

### 14.4 交互与口径展示

- 图表空状态与「数据不完整」状态必须区分：前者表示无数据，后者表示数据存在但缺汇率或未分类过多。
- 所有百分比显示两位小数；`null` 一律显示「—」，不得显示 `0%`、`NaN` 或 `Infinity`。
- 分类与商户条目可点击跳转 `/transactions?categoryId=...` / `?merchant=...`（商户筛选参数需在 A2 的交易列表增补中一并加入，若未加入则本阶段降级为只读展示并在计划中登记）。
- 图表语言跟随 i18n，数字与日期使用 `lib/format.ts`，不得自行 `toLocaleString`。

> 按既有约定，**不使用 Playwright 截图或视觉识别**验证。前端正确性通过接口集成测试、DOM 断言（headless 文本输出）与手动键盘/表单验证覆盖。

---

## 十五、A7 — 前端预算页与交付

### 15.1 页面结构

```
BudgetsPage
├── 周期切换（上个月 / 本月 / 下个月），年度预算单独入口
├── 总预算卡：可用 / 已花 / 剩余 / 结转（含结转链说明）
├── 分类额度进度列表（进度条 + 已花/可用 + 状态色 + 文字标签）
├── 未分类支出提示：金额 + 跳转
├── 预警区：warning / exceeded 项
├── 操作：新建预算、编辑额度、复制到下一周期、归档/删除
└── 无预算时：引导创建，并提供「按上月常用分类快速创建」
```

### 15.2 组件

```
components/budgets/
├── BudgetPeriodSwitcher.tsx
├── BudgetSummaryCards.tsx
├── BudgetProgressBar.tsx      进度条，状态不只用颜色表达
├── BudgetItemEditor.tsx       分类额度增删改（父子冲突就地提示）
├── BudgetCarryoverNote.tsx    结转来源与截断说明
└── BudgetAlertList.tsx
```

### 15.3 前端数据层

```ts
// src/lib/analytics.ts
export const analyticsApi = {
  incomeExpense, categories, merchants, cashflowTrend,
  periodComparison, recurring, fixedVariable, largeExpenses,
  accounts, uncategorized,
};

// src/lib/budgets.ts
export const budgetsApi = {
  list, detail, create, update, remove,
  summary, alerts, progress, copy,
};
```

### 15.4 i18n

- 新增命名空间 `analytics`、`budgets`，`zh-CN` 与 `en-US` 各一份，键必须完全对齐。
- `enums` 增补：`budget_period_type`、`budget_status`、`recurring_frequency`、`budget_alert_level`。
- `errors` 增补第十六节全部错误码。
- 所有新增 `t()` 调用必须能被静态校验脚本解析（沿用既有「按命名空间校验缺失键」的检查方式）。
- 口径文案（例如「内部转账与余额调整不计入收支」）必须放在语言文件里，不得硬编码在组件中。

### 15.5 测试

| 层级 | 覆盖 |
|------|------|
| 单元 | 周期识别全部规则边界、分位数插值、环比/同比区间计算、结转链（含重置与截断）、总支出一致性 |
| 集成 | 各分析接口口径（转账/调整/冲正排除）、覆盖率与缺失汇率、跨用户 404、预算 CRUD 与唯一冲突、父子分类冲突、分类额度含子分类汇总、复制幂等、预警等级边界 |
| 回归 | Phase 1/2 全部测试通过；Dashboard 与导入模块行为不变；交易列表新增筛选不影响既有分页 |
| 口径对齐 | 同一区间 `income-expense` 的支出与 `dashboard/cashflow` 的支出完全相等；`analytics/cashflow-trend` 按月与 Dashboard 结果一致 |

### 15.6 文档

- [ ] README 增加分析与预算章节：口径说明、周期识别限制、结转规则、预算币种约定
- [ ] `docs/API接口全面分析.md` 更新分析与预算的接口状态
- [ ] 更新 `docs/项目目录结构.md` 中新增模块
- [ ] 演示数据脚本增补预算与跨月支出，确保分析页与预算页在演示账号下有可看的数据

---

## 十六、接口清单汇总

| 模块 | 接口数 | 所属阶段 |
|------|--------|----------|
| 收支与分类分析 | 4 | A2 |
| 商户、趋势、大额 | 4 | A3 |
| 周期识别 | 2 | A4 |
| 预算 | 9 | A5 |
| 交易列表增补（参数扩展，非新接口） | 0 | A2 |
| **合计新增** | **19** | |

> 相比 Phase 2 累计的 109 个接口，本阶段新增 19 个；全项目累计 128 个。

### 实现说明（与计划的差异）

| 项 | 计划 | 实际实现 | 原因 |
|---|---|---|---|
| 取数层行粒度 | 每笔交易一行 | 收入/支出取账户腿；转账与调整逐腿输出两行 | 账户维度需要同时看到转出与转入；收支口径只取收入与支出，因此不会重复计数 |
| 大型支出阈值函数 | `percentile` | 新增 `lib/percentile.ts`，同时提供 `median` 与 `coefficientOfVariation` | 周期识别与预算共用同一套统计工具 |
| 结转计算 | 逐额度回溯 | 前置周期一次性取回后缓存，再按分类累加 | 逐额度回溯会重复查询 12 个月流水，性能不可接受 |
| 交易列表筛选 | 计划中提及 | 额外补充 `merchant` 筛选 | 商户排行需要可下钻，与未分类下钻同属分析闭环 |

### 新增错误码

| 错误码 | HTTP | 说明 |
|--------|------|------|
| `ANALYTICS_RANGE_TOO_LARGE` | 400 | 分析区间超过 5 年 |
| `ANALYTICS_RANGE_INVALID` | 400 | 起始晚于结束，或未按用户时区给出合法日期 |
| `ANALYTICS_GRANULARITY_INVALID` | 400 | 不支持的粒度或点数超限 |
| `BUDGET_PERIOD_EXISTS` | 409 | 该周期预算已存在 |
| `BUDGET_ITEM_INVALID` | 422 | 分类不存在、非支出分类、已归档或额度非法 |
| `BUDGET_CATEGORY_CONFLICT` | 422 | 同一预算内父子分类重复预算 |
| `BUDGET_ROLLOVER_UNSUPPORTED` | 422 | 年度预算不支持结转 |
| `BUDGET_ARCHIVED` | 409 | 预算已归档，不可修改或删除 |
| `BUDGET_NOT_FOUND` | 404 | 预算不存在或不属于当前用户（与既有越权约定一致） |

> `BUDGET_NOT_FOUND` 与通用 `NOT_FOUND` 二选一：为便于前端给出针对性文案，采用专用码，但跨用户访问仍返回 404 而非 403，不暴露资源存在性。

---

## 十七、技术依赖

### 后端

**不新增依赖。**

- 分位数、周期识别、结转链均为纯计算，使用 `decimal.js`（已存在）与原生数组方法。
- 时间与周期使用 `date-fns` / `date-fns-tz`（已存在），不引入 `luxon` 或 `dayjs`。

### 前端

**不新增依赖。**

- 图表沿用 `echarts` + `echarts-for-react`（已存在）。
- 进度条、Tab、区间选择均为原生实现，不引入 UI 组件库。

> 本阶段的克制是刻意的：分析与预算的复杂度在口径而不在技术栈，新增依赖只会增加升级负担。

---

## 十八、验证清单

### A1

- [ ] 迁移为纯增量，Phase 1/2 数据无损，全部既有测试通过
- [ ] 年度预算重复创建被唯一约束拦截
- [ ] 取数层的支出合计与 `computeCashflow` 完全一致
- [ ] 缺失汇率使 `isComplete = false` 且排除笔数正确
- [ ] `/api/system/capabilities` 中 `budgets` 从 `planned` 移至 `available`，`analytics` 出现

### A2

- [ ] 转账与调整不出现在任何收支、分类、账户收支字段中
- [ ] 已冲正交易被排除
- [ ] 收入为 0 时储蓄率为 `null` 而非 0
- [ ] 一级分类金额等于其二级分类之和
- [ ] 未分类金额进入覆盖率但不进入分类条目
- [ ] 未分类下钻可看到完整列表（超过 50 条时 `truncated = true`）

### A3

- [ ] 商户为空的流水进入 `unattributed`，不进入排行
- [ ] 同一商户跨账户合并
- [ ] 环比上期为 0 时变化率为 `null`
- [ ] 历史不足 12 个月时同比为 `null`
- [ ] 大额支出阈值：P95、中位数倍数、显式参数三种来源均可复现
- [ ] 时间序列点数超限时自动降级并标记 `downgraded`

### A4

- [ ] 月度订阅（间隔 28–31 天、金额稳定）被识别
- [ ] 周度、年度订阅分别被识别
- [ ] 水电煤这类金额波动 > 20% 的支出不被识别
- [ ] 间隔不规律的餐饮支出不被识别
- [ ] 少于 3 笔不识别
- [ ] 停止超过 1.5 个周期的项不识别
- [ ] 相同输入两次调用结果完全一致
- [ ] 固定支出 + 可变支出 = 区间总支出

### A5

- [ ] 预算 CRUD 正常；重复周期返回 409
- [ ] 父子分类同时预算被 422 拒绝并指出冲突对
- [ ] 分类额度自动汇总子分类支出
- [ ] 未分类支出计入总预算但不计入分类额度
- [ ] 结转：仅正结余结转；`rollover=false` 处重置；超过 12 个周期标记截断
- [ ] 年度预算 + 结转被 422 拒绝
- [ ] 归档预算不可修改
- [ ] `/budgets/summary` 与 `/budgets/alerts` 不被 `/budgets/:id` 吞路由
- [ ] 复制到下一周期成功，目标已存在时返回 409
- [ ] 修改历史流水后预算进度立即变化
- [ ] 预警等级边界：79.99% 为 `ok`，80% 与 100% 为 `warning`，100.01% 为 `exceeded`

### A6 / A7

- [ ] 侧边栏新增两项后，折叠与展开状态下滑动正常
- [ ] 覆盖率低于 0.9 时提示条出现并可跳转
- [ ] 所有 `null` 值显示「—」
- [ ] 中英文切换后新增页面无残留中文/英文
- [ ] 移动端 375px 宽度下分析页与预算页不出现横向滚动
- [ ] 无预算时展示引导，不展示空白的 0 进度条
- [ ] 进度条状态同时用颜色与文字表达

---

## 十九、交付标准与后续衔接

### 功能交付

1. 用户可在任意区间查看收入、支出、净结余与储蓄率，并明确看到统计口径与数据完整性。
2. 用户可按一级或二级分类查看支出占比、环比变化，并能下钻到具体流水。
3. 用户可查看商户支出排行、收支趋势与周期对比（环比、同比），同比不可用时明确标注。
4. 用户可查看被识别出的订阅与固定支出，以及固定/可变支出拆分，并能核对识别依据。
5. 用户可查看大额支出，并理解阈值来源。
6. 用户可创建月度或年度预算，设置总预算与分类额度，查看结转后的可用余额与预警。
7. 用户可复制预算到下一周期，归档旧预算。

### 质量要求

1. 所有分析接口共用同一取数层，同一区间下的支出合计在各接口之间完全一致。
2. 未分类与缺失汇率永远不被静默忽略，覆盖率与完整性标记随响应返回。
3. 转账与调整不进入任何消费口径，积分测试覆盖。
4. 预算执行实时计算，补录或冲正历史流水后无需任何刷新任务即可正确。
5. 周期识别为确定性纯函数，相同输入结果完全一致，且不写入任何业务数据。
6. 跨用户访问一律 404。
7. Phase 1/2 全部测试保持通过，Dashboard 与导入模块行为无回归。

### 已知取舍（需在文档与 UI 中明示）

| 取舍 | 影响 | 后续处理 |
|------|------|---------|
| 不支持退款冲减 | 退款记为收入，会同时抬高收入与总支出 | 需引入退款关联模型，建议与「交易拆分」一并立项 |
| 周期识别漏报 | 金额波动大或间隔不规律的固定支出可能未被识别 | 允许用户手动忽略/标记（Phase 4 之后） |
| 结转只累加正结余 | 超支不会透支下月额度 | 有意的产品选择，避免负向滚雪球 |
| 年度预算不结转 | 跨年结余不延续 | 年度预算视为独立周期 |
| 预算统一基准币种 | 外币账户支出按交易日汇率折算进预算 | 多币种预算需要预算自身的汇率口径 |
| 分析区间上限 5 年 | 更长区间需分段查询 | 个人场景足够；报表导出时另行设计 |
| 不缓存分析结果 | 每次请求实时聚合 | 数据量增长后再评估（优先索引与 SQL 聚合） |
| 无导出 | 分析结果不能导出 CSV | Phase 6 报表模块统一实现 |

### 与后续阶段的衔接

| 后续阶段 | 建议内容 | 对 Phase 3 的依赖 |
|---------|---------|------------------|
| Phase 4 投资 | 组合、证券、成本基础、TWR/XIRR、再平衡 | 复用本阶段的分位数、周期切分与折算工具；投资交易需在分析口径中显式排除 |
| Phase 5 风险模拟 | 蒙特卡罗、分片异步执行 | 复用周期识别中的「确定性 + 种子」思路；预算预警可作为模拟的约束输入。**注**：Phase 5 计划已改为进程内执行器，不使用 BullMQ 与 Worker Threads，见 `docs/plan-phase5.md` 第 5.1 节 |
| Phase 6 目标与报告 | 财富目标、财务独立、报表导出 | 直接使用本阶段的储蓄率、可投资结余与固定支出口径 |
| Phase 7 数据管理与运维 | 备份恢复、导出、管理后台、审计扩展 | 复用预算审计事件与保留策略 |

### 需补齐的设计文档

| 文档 | 最晚需要时间 |
|------|-------------|
| 分析与预算口径说明（本文件第六、七、八节即可作为初稿） | A1 开始前确认 |
| 周期识别算法说明与测试基线（规则、阈值、置信度公式） | A4 开始前 |
| 预算结转语义说明（重置、截断、负结余处理） | A5 开始前 |
