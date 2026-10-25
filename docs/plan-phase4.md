# Phase 4 开发计划 — 投资组合与收益

> **对应项目**：Comporalife（复利人生）Personal 开源个人版
> **上游计划**：`docs/plan-phase1.md`（S1–S7，v0.1.0）、`docs/plan-phase2.md`（P1–P8，v0.1.1）、`docs/plan-phase3.md`（A1–A7，v0.1.4）
> **技术栈**：沿用前三阶段：Fastify 5 + TypeScript + Prisma 6 + PostgreSQL 16 + Redis 7 + React 19 + Vite + Tailwind CSS 4 + ECharts 6
> **文档版本**：v4.0-plan
> **计划交付版本**：v0.1.5（Phase 3 原计划标记 v0.2.0，实际以 v0.1.4 交付，本阶段沿用末位递增）
> **范围决策**：投资组合 + 标的与价格 + 买卖与股息 + 持仓成本 + TWR/XIRR + 资产配置与再平衡预览；不做行情自动接入、不做复利/蒙特卡罗模拟扩展

---

## 一、Phase 4 目标

> **把「钱投出去了」变成「投了多少、现在值多少、赚了多少、赚得靠什么」**

Phase 1 解决了「记得对」，Phase 2 解决「数据从哪来」，Phase 3 解决「花得是否合理」。但账本里始终有一个盲区：**转到证券账户的钱在账本上只是余额减少，用户看不到它变成了什么、现在值多少、收益是否值得**。

Phase 4 的核心不是再加一个持仓列表，而是四件事：

1. **不重复计净资产**：买入证券是「现金 → 证券」的资产转换，不是支出。现金已在账本里，证券市值额外计入，两者不能相加成两份资产。
2. **收益口径可复现**：同一段历史、同一套交易，无论今天还是下个月打开，TWR 与 XIRR 必须给出同一个数；成本方法固定并记录，绝不随界面切换。
3. **估值来源可见**：行情未接入时，市值来自用户手工录价，界面必须标明价格日期与是否过期，不能显示成实时行情。
4. **可解释可下钻**：任何一个「收益 +12%」都能追溯到期末估值、期间现金流与每一笔买卖，而不是一个孤立百分比。

### 核心原则

| 原则 | 说明 |
|------|------|
| **单一账本** | 投资交易的现金腿写入既有 `transactions` + `transaction_entries`，不新增第二套资金流水表 |
| **资产转换不是收支** | 买入、卖出的现金变动记为 `investment` 类型，**永不进入**收入、支出、分类占比、商户排行、预算执行 |
| **股息是收入、手续费是支出** | 股息/利息按 `income` 记账并归类；手续费/税费按 `expense` 记账。收益口径与生活收支口径各自成立 |
| **持仓实时重算** | 数量、成本、已实现/未实现损益全部由交易历史重放得出，不存储持仓快照，改历史交易后结果立即正确 |
| **成本方法固定** | 组合创建时确定成本方法（本期仅加权平均），有交易后不可修改，方法随组合持久化 |
| **估值可缺失但不可伪造** | 缺少某日价格时返回「数据不完整」并给出缺失日期，绝不用最近价静默填充历史 |
| **收益不可计算时返回 `null`** | 样本不足、无符号变化、估值缺失时 TWR/XIRR 返回 `null` 并附原因码，不返回 0 |
| **再平衡只做建议** | 目标权重与偏离度仅用于展示与模拟，系统永不自动下单或写入交易 |
| **不接入资金划转的双重记账** | 组合与资金账户一一绑定，组合价值 = 该账户余额 + 证券市值，避免现金被计两次 |
| **只读不写分析层** | Phase 3 的分析取数层只增加「排除 investment」一条规则，不改其结构 |

---

## 二、Phase 4 开发阶段划分

```
B1 模型与账本接入 ──► B2 价格与估值 ──► B3 持仓与损益 ──┬──► B4 收益与现金流 ──┐
                                                        │                       ├──► B6 前端投资页 ──► B7 录入与交付
                                                        └──► B5 配置与再平衡 ──┘
```

| 阶段 | 内容 | 涉及模块 | 预期工时 |
|------|------|----------|---------|
| **B1 模型与账本接入** | 7 张新表、`TransactionType.investment`、净资产扩展、分析口径排除 | prisma + portfolios + ledger | 5-6 天 |
| **B2 价格与估值** | 标的元数据、手工价格、估值快照、过期标记 | portfolios/pricing | 3-4 天 |
| **B3 持仓与损益** | 加权平均成本、数量校验、已实现/未实现损益、配置权重 | portfolios/holdings | 5-6 天 |
| **B4 收益与现金流** | 外部现金流、TWR、XIRR、收益曲线 | portfolios/performance | 5-6 天 |
| **B5 配置与再平衡** | 目标权重、偏离度、再平衡预览、集中度摘要 | portfolios/allocation | 3-4 天 |
| **B6 前端投资页** | 组合列表、组合详情、持仓表、配置图、收益曲线 | portfolios 页面 | 5-6 天 |
| **B7 交易录入与交付** | 交易录入表单、编辑重放、i18n、测试与文档 | 全项目 | 4-5 天 |

> **合计约 30-37 天（单人开发）**。TWR 估值边界与交易重放是两处主要不确定性，工时已含边界调试。

### 阶段依赖说明

- **B1 是所有阶段的硬前置**：`investment` 交易类型一旦加入，分析层排除规则、净资产公式、账本类型守卫三处必须同时改到位，否则会立刻出现「买入被算成支出」的口径错误。
- B2 与 B3 之间是数据依赖：没有价格就算不出市值，没有市值就只有成本没有盈亏。B2 必须先于 B3 的验收，但代码可以并行。
- B4 依赖 B2 的历史估值（TWR 的分段点需要每个现金流日的组合价值），因此 B4 不能早于 B2。
- B5 只依赖 B3 的市值与权重，与 B4 完全并行。
- B6 依赖 B3–B5 的接口；B7 的交易录入必须建在 B1 的账本写入路径之上。

---

## 三、Phase 4 范围界定

### 交付范围

| 模块 | 交付内容 |
|------|---------|
| 投资组合 | 创建、修改、归档、列表；组合与资金账户一对一绑定；成本方法记录 |
| 投资标的 | 股票/ETF/基金/债券/现金/其他；自定义代码与名称；按用户隔离 |
| 标的价格 | 手工录价、价格历史、删除错误价格、价格来源标记 |
| 投资交易 | 买入、卖出、股息、利息、手续费、税费；关联账本交易；修改与撤销 |
| 持仓 | 数量、加权平均成本、总成本、市值、未实现损益、收益率、占比 |
| 已实现损益 | 按卖出时点结算，支持区间过滤；股息与利息单独汇总 |
| 组合收益 | 外部现金流明细、TWR、XIRR、区间收益曲线 |
| 组合估值 | 手工估值快照（可选）、最新市值来源与新鲜度标记 |
| 资产配置 | 按资产类别/标的/币种/账户的权重；目标权重；偏离度 |
| 再平衡 | 预览建议（买卖金额与数量），不写入任何交易 |
| 风险摘要 | 单标的集中度、前三大持仓占比、资产类别分布 |
| 净资产衔接 | 证券市值计入净资产，标注估值日期与过期状态 |
| 运维 | 能力声明更新、审计事件、i18n 双语资源 |

### 明确不交付（后续阶段）

| 能力 | 原因 |
|------|------|
| 行情自动接入（Yahoo、Alpha Vantage、券商 API） | 需要外部密钥、限流与缓存策略；本阶段先把手工录价与估值口径做正确，接口适配器留给后继阶段 |
| 逐笔成本法（FIFO / LIFO / 指定批次） | 需要持仓批次表与部分卖出分摊；加权平均在个人场景已足够，且结果确定、无歧义 |
| 跨币种投资（外币计价标的） | 会同时引入标的币种、账户币种、基准币种三层折算，并影响成本与收益口径；本阶段要求标的币种 = 账户币种 |
| 分红再投资（DRIP） | 需要「股息 → 自动买入」的联动规则；本阶段股息只记现金，不改变成本 |
| 期权、期货、融资融券、做空 | 负持仓、保证金与强平语义完全不同，需要独立模型 |
| 投资交易专用账单导入 | 依赖本阶段模型定型，建议在模型稳定后作为 Phase 2 导入框架的扩展模板接入 |
| 组合级多账户归集 | 一个组合绑定一个资金账户；多券商账户请建多个组合 |
| 真实行情下的组合历史净值回放 | 需要完整价格历史；手工价格无法回填历史，TWR 在缺价时明确返回不可计算。**Phase 9 修正**：本阶段实现当时未做到「缺价返回不可计算」，而是用最新价填充历史；Phase 9 的 G4 已改为按采样日判定可用性，缺价点标记不完整，并接入手工估值快照作为显式替代 |
| 投资绩效报告导出（PDF/CSV） | 属于报表模块，届时统一处理模板与编码 |
| 税务计算与申报表 | 各法域规则差异过大，且需要长期维护 |
| 蒙特卡罗与复利模拟扩展 | Phase 5 范围 |
| 财富目标与财务自由规划 | Phase 6 范围 |

> **口径说明**：推迟项属于《项目功能全面分析》中个人版的完整投资能力，属于**产品范围**而非**本阶段范围**。Phase 4 不修改功能文档。

---

## 四、数据模型设计

### 4.1 模型总览（新增 7 张表）

```
instruments            投资标的元数据（代码、名称、资产类别、币种）
instrument_prices      手工录入的价格历史
portfolios             投资组合（绑定资金账户、成本方法）
portfolio_trades       投资交易（买卖/股息/利息/费用/税费）
portfolio_cashflows    组合外部资金流（入金/出金）
portfolio_valuations   手工估值快照（可选，用于无法重算的历史时点）
portfolio_targets      目标配置权重
```

`portfolio_targets` 按「组合 + 维度 + 键」存目标权重，可覆盖资产类别、标的、币种三个维度。

并对已有表做**增量扩展**（不破坏前三个阶段数据）：

```
transactions           枚举新增 investment；不新增列，与 portfolio_trades 通过 portfolio_trades.transactionId 关联
users                  新增关系：instruments / portfolios
accounts               新增关系：portfolios
```

### 4.2 新增枚举

```prisma
enum AssetClass {
  stock        // 股票
  etf          // ETF
  fund         // 基金（含货币基金、债券基金）
  bond         // 债券
  cash         // 现金类（货币基金以外的活期理财）
  other        // 其他
}

enum TradeKind {
  buy          // 买入
  sell         // 卖出
  dividend     // 股息
  interest     // 利息
  fee          // 手续费
  tax          // 税费
}

enum CostBasisMethod {
  average      // 加权平均成本（本阶段唯一实现）
}

enum CashflowKind {
  deposit      // 入金
  withdraw     // 出金
}

enum PriceSource {
  manual       // 用户手工录入
  imported     // 预留：未来批量导入
  provider     // 预留：未来行情接口
}

enum ValuationSource {
  computed     // 由价格历史与交易重放得出
  manual       // 用户手工录入快照
}

enum PortfolioStatus {
  active
  archived
}

enum AllocationDimension {
  asset_class
  instrument
  currency
}
```

`TransactionType` 增加一个值：

```prisma
enum TransactionType {
  income
  expense
  transfer
  adjustment
  investment   // 资产转换：买入/卖出证券，只动现金，不计收支
}
```

### 4.3 模型定义

#### instruments

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | uuid | 主键 |
| `userId` | uuid | 归属用户，级联删除 |
| `symbol` | varchar(32) | 用户自定义代码，如 `510300`、`VOO`；同一用户内唯一 |
| `name` | varchar(120) | 展示名称，如「沪深300ETF」 |
| `assetClass` | AssetClass | 资产类别 |
| `currency` | char(3) | 标的计价币种，必须与所属组合资金账户币种一致 |
| `note` | text? | 备注 |
| `createdAt` / `updatedAt` | timestamptz | |

唯一约束：`[userId, symbol]`；索引：`[userId, assetClass]`。

#### instrument_prices

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | uuid | |
| `userId` | uuid | 冗余归属，便于越权过滤 |
| `instrumentId` | uuid | 级联删除 |
| `priceDate` | date | 价格所属日期（用户时区当日） |
| `price` | decimal(20, 8) | 单位价格，必须 > 0 |
| `source` | PriceSource | 默认 `manual` |
| `note` | varchar(200)? | 如「收盘价」「净值」 |
| `createdAt` | timestamptz | |

唯一约束：`[instrumentId, priceDate]`（同一标的同一天只保留一个价格，重复录入走覆盖）；索引：`[instrumentId, priceDate(sort: Desc)]`、`[userId]`。

#### portfolios

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | uuid | |
| `userId` | uuid | |
| `accountId` | uuid | **绑定的资金账户**，必须为 `brokerage` 类型且同币种；级联删除 |
| `name` | varchar(80) | 用户内唯一 |
| `currency` | char(3) | 冗余自账户币种，避免每次联表 |
| `costBasisMethod` | CostBasisMethod | 默认 `average`；有交易后不可修改 |
| `status` | PortfolioStatus | 默认 `active` |
| `note` | text? | |
| `version` | int | 乐观锁，默认 1 |
| `archivedAt` | timestamptz? | |
| `createdAt` / `updatedAt` | timestamptz | |

唯一约束：`[userId, name]`、`[userId, accountId]`（**一个资金账户最多对应一个活跃组合**）；索引：`[userId, status]`。

> `[userId, accountId]` 唯一是收益口径的前提：组合价值 = 账户余额 + 证券市值，若两个组合共用同一账户，现金会被两边各算一次。

#### portfolio_trades

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | uuid | |
| `userId` | uuid | 冗余归属 |
| `portfolioId` | uuid | 级联删除 |
| `instrumentId` | uuid? | `fee` / `tax` / `interest` 可为空（无标的的费用，如账户管理费） |
| `kind` | TradeKind | 见 4.2 |
| `tradeDate` | timestamptz | 成交时间（按用户时区当日零点附近，与账本一致） |
| `quantity` | decimal(24, 8)? | 买卖必填且 > 0；股息/利息/费用/税费为 NULL |
| `price` | decimal(20, 8)? | 买卖单价；股息/利息/费用/税费为 NULL |
| `amount` | decimal(20, 6) | 净金额（不含费用），买卖 = 数量 × 单价（四舍五入 6 位） |
| `fee` | decimal(20, 6) | 默认 0 |
| `tax` | decimal(20, 6) | 默认 0 |
| `transactionId` | uuid? | 关联账本交易；交易被删除时置空 |
| `note` | varchar(200)? | |
| `voidedAt` | timestamptz? | 撤销时间；非空即不参与持仓重放与所有聚合 |
| `version` | int | 乐观锁 |
| `createdAt` / `updatedAt` | timestamptz | |

索引：`[portfolioId, tradeDate]`、`[portfolioId, instrumentId, tradeDate]`、`[userId, tradeDate]`、`[transactionId]`。

**约束**：买卖的 `quantity`、`price` 必填且为正；非买卖的 `quantity`、`price` 必须为 NULL（由校验层强制，不用数据库 CHECK，便于后续扩展）。

#### portfolio_cashflows

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | uuid | |
| `userId` | uuid | |
| `portfolioId` | uuid | 级联删除 |
| `kind` | CashflowKind | 入金 / 出金 |
| `flowDate` | timestamptz | 资金发生日 |
| `amount` | decimal(20, 6) | 恒为正数，方向由 `kind` 决定 |
| `transactionId` | uuid? | 若由账本转账生成则关联；手工登记可为空 |
| `note` | varchar(200)? | |
| `createdAt` | timestamptz | |

索引：`[portfolioId, flowDate]`。

> 外部现金流必须显式登记，**不从账户余额变动反推**：账户里可能同时有手续费、税费、股息等内部变动，反推会把它们误当成入金。

#### portfolio_valuations

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | uuid | |
| `userId` | uuid | |
| `portfolioId` | uuid | 级联删除 |
| `valuationDate` | date | 估值日 |
| `marketValue` | decimal(20, 6) | **仅证券市值**，不含现金，避免与账本现金重复 |
| `source` | ValuationSource | 默认 `computed` |
| `note` | varchar(200)? | |
| `createdAt` | timestamptz | |

唯一约束：`[portfolioId, valuationDate]`。

> 该表是**可选缓存**：只要价格历史完整，系统会优先重算；仅当历史价格缺失而用户手上有当日对账单市值时，才录入手工快照，且快照来源永远标记为 `manual`。

#### portfolio_targets

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | uuid | |
| `userId` | uuid | |
| `portfolioId` | uuid | 级联删除 |
| `dimension` | AllocationDimension | 资产类别 / 标的 / 币种 |
| `key` | varchar(64) | 资产类别枚举值、instrumentId 或币种代码 |
| `targetWeight` | decimal(9, 6) | 0–1 之间，同维度合计必须为 1 |
| `createdAt` / `updatedAt` | timestamptz | |

唯一约束：`[portfolioId, dimension, key]`。

### 4.4 金额与精度

| 字段 | 精度 | 理由 |
|------|------|------|
| 金额（`amount` / `fee` / `tax` / `marketValue` / `targetWeight`） | decimal(20, 6) | 与账本一致 |
| 数量 `quantity` | decimal(24, 8) | 基金份额常到 4 位小数，8 位留余量 |
| 单价 `price` | decimal(20, 8) | 基金净值 4 位、部分标的价格 6 位 |
| 权重 `targetWeight` | decimal(9, 6) | 0.000000–1.000000 |

**禁止 `parseFloat`**：数量 × 单价必须走 `Decimal`，四舍五入统一用 `roundMoney`。数量不做舍入（保留用户输入精度），市值 = `quantity × price` 后再 `roundMoney`。

### 4.5 迁移策略

- 全部为**纯增量**：7 个新表 + 9 个新枚举（8 个全新枚举 + `TransactionType` 新增一个值）。
- `TransactionType` 新增值 `investment` 通过 `ALTER TYPE ... ADD VALUE` 完成。PostgreSQL 12+ 允许在事务内新增枚举值，但**同一事务内不能使用该新值**；本迁移只增加值、不写数据，因此安全。迁移后必须先 `prisma generate` 再使用新类型。
- 既有 41 条以上流水与前三阶段测试数据不受影响，全部保持原类型。
- 存量 `brokerage` 账户不被自动转换成组合：用户需显式创建组合，避免把「只是一个余额占位账户」误算成投资。

---

## 五、关键设计决策

| # | 决策点 | 结论 | 理由 |
|---|--------|------|------|
| 1 | 现金腿写哪 | 写入既有 `transactions` + `transaction_entries` | 与 Phase 2「导入即记账」同一原则，避免余额两套权威 |
| 2 | 买卖的交易类型 | 新增 `TransactionType.investment` | 买卖既不是收入也不是支出；复用 `adjustment` 会把对账语义污染 |
| 3 | 股息处理 | `income` 类型 + 分类，同时写一条 `dividend` 交易行 | 股息是真实收入，储蓄率必须看到它；同时收益核算需要独立记录 |
| 4 | 手续费/税费 | `expense` 类型 + 分类，同时写 `fee` / `tax` 交易行 | 它们是真实成本，应进入支出与预算 |
| 5 | 分析层怎么排除 | `investment` 加入 `excludes` 与所有类型过滤 | 买入不是消费；漏掉一条就会让月度支出暴涨 |
| 6 | 净资产怎么算 | 账户余额（含证券账户现金）+ 证券市值 | 现金已在账本，市值是新增部分，相加不重复 |
| 7 | 组合与账户关系 | 一对一（`[userId, accountId]` 唯一） | 组合价值含账户现金，共用账户会导致现金被重复计入 |
| 8 | 标的是否复用 `Account` | 否，独立 `instruments` 表 | 标的有代码、类别、价格序列，账户没有；混用会让余额语义崩坏 |
| 9 | 持仓是否落库 | 否，全部由交易重放 | 与预算执行同理：改历史立即正确，无快照失效问题 |
| 10 | 成本方法 | 加权平均，组合级记录，有交易后锁定 | 逐笔法需要批次表；固定方法才能保证历史收益可复现 |
| 11 | 卖出校验 | 按交易日校验持仓，超卖直接 422 | 负持仓会让成本与收益全部失真 |
| 12 | 标的币种 | 必须等于账户币种 | 跨币种投资需要三层折算，本阶段明确不做 |
| 13 | 价格来源 | 只支持手工录入，来源字段预留 | 无密钥、无限流依赖也能交付真实可用的估值 |
| 14 | 价格缺失 | 标记 `isComplete = false` 并列出缺失日期 | 与 Phase 3 缺失汇率同一原则：不静默补零 |
| 15 | 估值快照 | 可选，优先重算 | 手工快照只在历史价格缺失时使用，且来源永久标记 |
| 16 | 组合价值定义 | 账户余额 + 证券市值 | 使 TWR/XIRR 的现金流定义自洽（见第八节） |
| 17 | 外部现金流 | 显式 `portfolio_cashflows`，不从余额反推 | 手续费、股息也会改变余额，反推必然误判 |
| 18 | TWR 分段点 | 每个外部现金流日 + 区间首尾 | 这是时间加权的标准做法，避免入金抬高收益 |
| 19 | XIRR 求解 | 牛顿迭代，失败回落二分，均有上限 | 必须确定性；直接抛异常或返回 0 都会误导用户 |
| 20 | 交易修改 | 冲正旧账本交易 + 重建新账本交易 + 重放持仓 | 不原地改分录，保留审计链 |
| 21 | 交易删除 | 冲正关联账本交易，交易行软删（`voidedAt`） | 直接物理删除会断掉审计与收益回溯 |
| 22 | 归档组合 | 保留交易与历史，仅排除在默认列表与净资产之外 | 归档 ≠ 清空；用户可能只是暂时不看 |
| 23 | 再平衡 | 只算不写 | 自动交易属于委托执行，超出个人记账产品边界 |
| 24 | 越权 | 一律 404 | 与前三阶段一致，不暴露资源存在性 |

---

## 六、统计口径规范

### 6.1 投资与账本的衔接

```
买入 1000 元（手续费 5 元）
  ├─ portfolio_trades: kind=buy, quantity=100, price=10.00, amount=1000.00, fee=5.00
  └─ transactions: type=investment, 两条分录
       ├─ 证券账户（brokerage）: -1005.00
       └─ 外部腿（accountId = null）: +1005.00

卖出 1000 元（税费 2 元）
  ├─ portfolio_trades: kind=sell, quantity=100, price=10.00, amount=1000.00, tax=2.00
  └─ transactions: type=investment
       ├─ 证券账户: +998.00
       └─ 外部腿: -998.00

股息 30 元
  ├─ portfolio_trades: kind=dividend, amount=30.00
  └─ transactions: type=income, category=投资收益
       ├─ 证券账户: +30.00
       └─ 外部腿: -30.00
```

**净额口径**：买入的现金变动是 `amount + fee`，卖出的现金变动是 `amount − fee − tax`。手续费与税费**不另建账本交易**，避免一笔操作产生两条交易、账单对不上。

> 例外：独立发生的账户管理费（无对应买卖）以 `kind=fee` 单独建一条 `expense` 交易。

### 6.2 投资与收支分析的关系

| 指标 | 是否包含投资 |
|------|-------------|
| 收入 | 包含股息与利息（`income` 交易） |
| 支出 | 包含手续费与税费（`expense` 交易） |
| 分类占比 / 商户排行 / 大额支出 | 同上，按分类与商户正常参与 |
| 预算执行 | 同上，投资相关支出会计入分类额度 |
| 买入 / 卖出 | **全部排除**，`investment` 类型被分析层统一过滤 |
| `excludes` 字段 | 由 `['transfer','adjustment','voided']` 变为 `['transfer','adjustment','investment','voided']` |

> Phase 3 的集成测试中「支出与 `/api/dashboard/cashflow` 一致」必须继续通过；本阶段补充「买入不改变支出」的对齐测试。

### 6.3 净资产的扩展

```
净资产 = Σ 账户余额（折算基准币种） − 负债账户余额（绝对值）
       + Σ 活跃组合的证券市值（按最新价格折算）
```

- 证券账户的**现金余额**已由账户余额计入，组合侧只加**证券市值**，不加组合现金。
- 每个组合附带 `valuationDate` 与 `stale`（超过 `INVESTMENT_PRICE_STALE_DAYS`，默认 7 天）。过期时净资产响应中返回 `staleValuations`，前端显示「估值过期」而不是无声使用。
- 缺少某标的最新价格时，该标的市值用**最近一个有效价格**并标记 `missingPrices`；若从未有价格，该标的计入 `unpriced`，其市值按 0 计并明确列出，绝不按成本价冒充市值。

### 6.4 组合价值与外部现金流

```
组合价值(t) = 账户余额(t) + Σ(持仓数量(t) × 价格(t))
```

外部现金流只有两类：`deposit`（入金，投资者投入）与 `withdraw`（出金，投资者取回）。

以下**不是**外部现金流：买入、卖出、股息、利息、手续费、税费。它们发生在组合内部，只改变组合的构成，不改变投资者投入的资本。

> 由此可得：股息使组合价值上升（现金增加），因此计入收益；手续费使价值下降，因此是负收益；买卖不改变价值，因此不影响收益。这一组性质是第八节所有公式的基础。

### 6.5 估值时点与缺失处理

- 估值取**用户时区当日收盘**（手工价格的 `priceDate` 即日）。
- 计算区间内任一所需日期无价格、且无手工快照时，不得插值、不得用最近价顶替。
- 缺价时：
  - 持仓表：用最近有效价格计算当前市值，并标注 `priceDate` 与 `stale`。
  - 历史收益（TWR）：返回 `null`，`reason = 'missing_valuation'` 并给出缺失日期列表。
  - XIRR：仍可计算（只需要现金流与终值），终值使用最近有效价格并标注。

### 6.6 已实现与未实现损益

- **已实现损益**：卖出时点结算，`(卖出价 − 加权平均成本) × 数量 − 卖出费用`。费用包含卖出侧的 `fee` 与 `tax`。
- **未实现损益**：`(最新价格 − 加权平均成本) × 当前数量`。买入费用已计入成本，因此不再单独扣减。
- **成本基础**：买入时 `总成本 += amount + fee`；卖出时 `总成本 -= 加权平均成本 × 数量`。
- 加权平均成本在**每次买入后**重算，卖出不改变单位成本：
  ```
  新单位成本 = (原总成本 + 本次 amount + 本次 fee) / (原数量 + 本次数量)
  ```
- 全部持仓清空（数量归零）后，总成本归零；若因舍入残留极小余额，直接置零并记录一条内部舍入调整（不写账本）。

### 6.7 收益率的两种口径

| 指标 | 回答的问题 | 受入金影响 | 用途 |
|------|-----------|-----------|------|
| TWR | 「我的投资策略本身赚了多少」 | 否 | 评价选股/配置能力，可与指数对比 |
| XIRR | 「我的钱实际年化赚了多少」 | 是 | 评价个人真实回报，含择时 |

两者都可能大于或小于对方，界面必须并列展示并说明差异，不能只给一个数字。

---

## 七、持仓与成本引擎规范（`modules/portfolios/holdings.engine.ts`）

### 7.1 定位

纯函数引擎：输入按时间排序的交易列表与价格表，输出每个标的的持仓、成本、损益。**不访问数据库、不读取时钟**，便于单元测试与重放。

### 7.2 重放顺序

```ts
interface ReplayInput {
  trades: Array<{
    id: string; kind: TradeKind; tradeDate: Date;
    instrumentId: string | null;
    quantity: Decimal | null; price: Decimal | null;
    amount: Decimal; fee: Decimal; tax: Decimal;
  }>;
  baseCurrency: string;
}
```

- 交易按 `tradeDate` 升序，同日按 `createdAt` 升序，保证确定性。
- 处理顺序：`buy` → `sell` → `dividend` → `interest` → `fee` → `tax`（同日内部顺序不影响数量，只影响费用汇总）。
- 卖出时若 `quantity > 当前持仓`，引擎返回 `{ ok: false, error: 'SELL_EXCEEDS_HOLDING', available }`，接口层转为 422。

### 7.3 输出

```ts
interface HoldingComputed {
  instrumentId: string;
  quantity: Decimal;
  totalCost: Decimal;          // 剩余持仓的总成本
  averageCost: Decimal | null; // 数量为 0 时 null
  realizedPnl: Decimal;        // 累计已实现损益
  dividends: Decimal;          // 累计股息
  interest: Decimal;           // 累计利息
  fees: Decimal;               // 累计手续费
  taxes: Decimal;              // 累计税费
  firstTradeDate: Date | null;
  lastTradeDate: Date | null;
}
```

### 7.4 边界规则

| 场景 | 规则 |
|------|------|
| 数量为 0 | `averageCost = null`，不显示 0 成本 |
| 全部卖出后再买入 | 成本从零重新累计，历史已实现损益保留 |
| 同日多笔买入 | 按 `createdAt` 顺序逐笔累加，结果与录入顺序一致 |
| 卖出费用 | 从卖出净额中扣除，同时降低已实现损益 |
| 股息不改变成本 | 本期不支持分红再投资 |
| 舍入 | 仅对 `totalCost` 与 `averageCost` 做 6 位舍入，数量不舍入 |

### 7.5 持仓日期快照

除当前持仓外，引擎需支持 `asOf`：只回放 `tradeDate <= asOf` 的交易，用于：
- 卖出校验（按成交日判断是否超卖）
- 历史市值与 TWR 分段点计算

---

## 八、收益指标规范（`modules/portfolios/performance.engine.ts`）

### 8.1 输入

```ts
interface PerformanceInput {
  startDate: Date;
  endDate: Date;
  cashflows: Array<{ date: Date; amount: Decimal; kind: 'deposit' | 'withdraw' }>;
  values: Array<{ date: Date; value: Decimal; complete: boolean }>; // 每个分段点的组合价值
}
```

`values` 由调用方（服务层）用「账户余额 + 持仓市值」逐日或逐分段点计算后传入，引擎本身不知道账户与标的存在。

### 8.2 TWR

标准做法：在每个外部现金流发生时点切分区间，计算每段收益率，再连乘。

```
r_i = (V_end_i − CF_i) / V_start_i − 1
TWR = Π(1 + r_i) − 1
```

- `CF_i`：该分段内的净外部现金流（入金为正、出金为负）。约定现金流发生在**期末**，即先计收益、后计流入，避免把当天入金当成收益。
- 分段点 = `startDate`、每个现金流日、`endDate`，去重后按日期排序。
- 任一 `V_start_i = 0`、或任一分段点 `complete = false`、或现金流日缺少估值 → 返回 `{ value: null, reason }`。
- `reason` 取值：`insufficient_data`（分段点少于 2）、`missing_valuation`、`zero_start_value`。
- 输出附 `segments` 明细（起止日、起止价值、净流入、分段收益率），供前端下钻核对。

### 8.3 XIRR

求解使净现值为零的年化利率：

```
NPV(r) = Σ CF_t / (1 + r)^((t − t_0) / 365) = 0
```

现金流约定：
- 入金：负（投资者付出）
- 出金：正（投资者取回）
- `endDate` 的组合价值：正（视为期末全部变现）
- 买入/卖出/股息/手续费**不进入** XIRR 现金流（它们是内部变动）

求解：
1. 先取现金流符号，若全同号或为空 → `null`，`reason = 'no_cashflow_sign_change'`。
2. 牛顿迭代，初始 `r = 0.1`，导数用解析式；迭代上限 100 次，收敛阈值 `1e-9`。
3. 牛顿失败（导数过小、发散、越界）→ 在 `[-0.9999, 10]` 区间二分，上限 200 次。
4. 仍不收敛 → `null`，`reason = 'not_converged'`。
5. 结果舍入到 1e-6，并以字符串返回，避免浮点显示抖动。

> 不使用 `xirr` 等第三方库：公式简单、边界必须可控，且项目已有 `Decimal`。

### 8.4 收益曲线

- 按用户选择的粒度（日/周/月）采样组合价值。
- 每个采样点同时返回 `value`、`twrIndex`（以区间起点为 1 的累计指数）、`complete`。
- 采样点超过 `INVESTMENT_MAX_SERIES_POINTS`（默认 400）时自动降级粒度，返回 `downgraded: true`，与 Phase 3 趋势接口一致。
- 缺价的采样点 `value = null`、`complete = false`，曲线在图上断开，不做插值连线。

### 8.5 已知限制（必须写进 UI 文案与文档）

- 手工价格无法回填历史，因此**新建组合的历史 TWR 通常不可计算**，只有从你开始录价之后才有分段估值。这不是 bug，是数据可得性的限制。
- XIRR 依赖外部现金流的完整性；未登记入金/出金的组合，XIRR 等同于简单收益率，可能严重高估或低估。
- 组合价值含账户现金，因此「转出到其他账户」若未登记为出金，会被误认为亏损。

---

## 九、B1 — 模型与账本接入

### 9.1 数据库

- 7 张新表、8 个全新枚举、`TransactionType` 新增 `investment`，详见第四节。
- 迁移为纯增量；`ALTER TYPE` 增加枚举值的语句必须独立，不与使用新值的 DML 同事务。

### 9.2 账本接入（`modules/portfolios/trade-ledger.service.ts`）

```ts
interface TradeLedgerInput {
  userId: string;
  accountId: string;       // 组合绑定的资金账户
  kind: TradeKind;
  tradeDate: Date;
  amount: Decimal;         // 净金额
  fee: Decimal;
  tax: Decimal;
  instrumentName?: string;
  investmentCategoryId?: string; // 股息/利息/费用/税费所需
}
```

映射规则：

| kind | 账本类型 | 现金变动 | 分类 |
|------|---------|---------|------|
| `buy` | `investment` | `−(amount + fee)` | 无 |
| `sell` | `investment` | `+(amount − fee − tax)` | 无 |
| `dividend` | `income` | `+amount` | 投资收益（用户可改） |
| `interest` | `income` | `+amount` | 投资收益（用户可改） |
| `fee` | `expense` | `−(amount + fee)` | 手续费（用户可改） |
| `tax` | `expense` | `−amount` | 税费（用户可改） |

- 分录由既有 `buildEntries` 生成，`investment` 类型按「一条真实账户腿 + 一条外部腿」处理，与收入/支出同样的平衡结构。
- `entry.service.ts` 的类型守卫需要同步接受 `investment`，但仍禁止通过用户端通用记账接口创建该类型（仅投资模块内部可写）。
- 股息/利息/手续费/税费必须归类，否则会拉低分类覆盖率；找不到对应分类时返回 422，提示先建分类。

### 9.3 分析层与净资产

- `coverage.ts` 的 `excludes` 增加 `'investment'`。
- `query.service.ts` 与 `cashflow.service.ts` 的类型过滤加入 `investment`（只读取、用于统计排除）。
- `networth.service.ts` 增加证券市值项；新增 `staleValuations`、`unpriced` 字段（不破坏既有响应，只新增可空字段）。
- `system.ts`：`PHASE = 'phase-4'`；`available` 增加 `'portfolios'`、`'instruments'`；`planned` 移除 `'portfolios'`。

### 9.4 验收

- [ ] 迁移后既有数据无损，全部既有测试通过
- [ ] 买入一笔后，`/api/analytics/income-expense` 的支出**不变**
- [ ] 买入一笔后，`/api/dashboard/overview` 的净资产**不变**（现金减少、市值同步增加）
- [ ] 股息一笔后，收入增加且分类覆盖率为 1
- [ ] 通用记账接口无法创建 `investment` 类型

---

## 十、B2 — 标的、价格与估值

### 10.1 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/instruments` | 标的列表，支持 `assetClass` / `q` 搜索 |
| POST | `/api/instruments` | 新建标的 |
| GET | `/api/instruments/:id` | 标的详情（含最新价格） |
| PATCH | `/api/instruments/:id` | 修改名称、类别、备注（有交易时不允许改币种） |
| DELETE | `/api/instruments/:id` | 删除（有交易则 409） |
| GET | `/api/instruments/:id/prices` | 价格历史，支持区间 |
| POST | `/api/instruments/:id/prices` | 录入手工价格（同日覆盖） |
| DELETE | `/api/instruments/:id/prices/:priceId` | 删除错误价格 |
| GET | `/api/portfolios/:id/valuations` | 估值快照列表 |
| POST | `/api/portfolios/:id/valuations` | 录入手工估值快照 |
| DELETE | `/api/portfolios/:id/valuations/:valuationId` | 删除快照 |

### 10.2 价格规则

- `price > 0`，`priceDate` 不得晚于用户当前日期（允许今天）。
- 同一标的同一天重复录入 = 覆盖（upsert），响应中返回 `created: boolean`。
- 删除价格后，若该价格曾被估值使用，历史 TWR 会随即变为不可计算——这是正确行为，前端需提示「删除价格会影响历史收益」。
- 价格不自动向前填充：某天没有价格就是没有。

### 10.3 估值快照

- `marketValue` 仅指证券市值，不含现金（与 6.3 一致）。
- 录入快照时如果同一天重算值与手填值差异超过 5%，返回警告字段 `discrepancy`（不拒绝，用户可能有未录入的持仓）。
- `computed` 快照不需要用户录入，由系统在计算收益时按需生成并缓存；删除价格后这些缓存必须失效（按 `portfolioId` 前缀批量删除）。

### 10.4 验收

- [ ] 同日重复录价覆盖而非报错
- [ ] 未来日期价格被 422 拒绝
- [ ] 删除价格后，历史 TWR 返回 `missing_valuation`
- [ ] 标的币种与账户币种不同时创建标的被 422 拒绝

---

## 十一、B3 — 持仓与损益

### 11.1 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/portfolios` | 组合列表（含最新市值、总收益、状态） |
| POST | `/api/portfolios` | 创建组合（绑定 brokerage 账户，自动记录成本方法） |
| GET | `/api/portfolios/:id` | 组合详情 |
| PATCH | `/api/portfolios/:id` | 修改名称、备注；有交易时不可改账户与成本方法 |
| DELETE | `/api/portfolios/:id` | 归档（有交易时仍可归档，不删数据） |
| GET | `/api/portfolios/:id/holdings` | 当前持仓及成本 |
| GET | `/api/portfolios/:id/realized-gains` | 已实现损益，支持区间 |
| GET | `/api/portfolios/:id/unrealized-gains` | 未实现损益 |
| GET | `/api/portfolios/:id/income` | 股息与利息汇总 |
| GET | `/api/portfolios/:id/summary` | 组合总览（市值、现金、成本、收益、最新价格日期） |

> **路由顺序**：`/portfolios/:id/holdings` 等子路径不受 `:id` 影响，但若未来新增 `/portfolios/summary` 之类的顶级路径，必须注册在 `:id` 之前（Phase 2/3 已两次踩坑）。

### 11.2 持仓响应

```jsonc
// GET /api/portfolios/:id/holdings
{
  "portfolio": { "id": "...", "name": "长期账户", "currency": "CNY", "costBasisMethod": "average" },
  "holdings": [
    {
      "instrumentId": "...", "symbol": "510300", "name": "沪深300ETF",
      "assetClass": "etf",
      "quantity": "1200.00000000",
      "averageCost": "3.925000",
      "totalCost": "4710.000000",
      "price": "4.12000000",
      "priceDate": "2026-10-21",
      "stale": false,
      "marketValue": "4944.000000",
      "unrealizedPnl": "234.000000",
      "unrealizedRatio": "0.049682",
      "weight": "0.612000",
      "realizedPnl": "0.000000"
    }
  ],
  "totals": {
    "marketValue": "8078.000000",
    "cash": "3200.000000",
    "portfolioValue": "11278.000000",
    "totalCost": "7840.000000",
    "totalPnl": "438.000000"
  },
  "isComplete": true,
  "missingPrices": [],
  "valuationDate": "2026-10-21",
  "stale": false
}
```

- `weight` = 该标的市值 / 组合总市值（**不含现金**），合计为 1；无持仓时为空数组。
- `cash` 来自账户余额（B1 的余额服务），`portfolioValue = marketValue + cash`。
- `isComplete = false` 表示存在无价格标的，`missingPrices` 列出标的。
- `stale = true` 表示最新价格超过阈值天数。

### 11.3 已实现损益

```jsonc
// GET /api/portfolios/:id/realized-gains?from=2026-01-01&to=2026-10-31
{
  "items": [
    {
      "tradeId": "...", "instrumentId": "...", "symbol": "510300",
      "tradeDate": "2026-08-14",
      "quantity": "200.00000000",
      "sellPrice": "4.30000000",
      "averageCost": "3.850000",
      "proceeds": "860.000000",
      "cost": "770.000000",
      "fee": "8.600000",
      "tax": "0.000000",
      "realizedPnl": "81.400000",
      "realizedRatio": "0.105714"
    }
  ],
  "totals": { "proceeds": "...", "cost": "...", "realizedPnl": "...", "fee": "...", "tax": "..." },
  "period": { "from": "2026-01-01", "to": "2026-10-31" }
}
```

- `averageCost` 是**卖出当时**的加权平均成本（由重放到该时点得出），不是今天的成本。
- 区间过滤按 `tradeDate`。

### 11.4 验收

- [ ] 买入 100 @10，费用 5 → 平均成本 10.05
- [ ] 再买 100 @11，费用 5 → 平均成本 10.55
- [ ] 卖出 100 @12，费用 10 → 已实现损益 = 1200 − 1055 − 10 = 135
- [ ] 卖出数量超过持仓返回 422 并给出可用数量
- [ ] 全部卖出后 `averageCost = null`、`quantity = 0`
- [ ] 删除一笔历史买入后，持仓与损益立即变化（无需刷新任务）
- [ ] 无价格的标的出现在 `missingPrices`，市值不按成本价填充

---

## 十二、B4 / B5 — 现金流、收益、配置与再平衡

### 12.1 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/portfolios/:id/cashflows` | 外部现金流列表 |
| POST | `/api/portfolios/:id/cashflows` | 登记入金/出金（可关联账本转账） |
| DELETE | `/api/portfolios/:id/cashflows/:cashflowId` | 删除现金流记录 |
| GET | `/api/portfolios/:id/returns` | TWR 与 XIRR，含分段与原因码 |
| GET | `/api/portfolios/:id/performance` | 收益曲线（价值、指数、完整性） |
| GET | `/api/portfolios/:id/allocation` | 当前配置权重（资产类别/标的/币种） |
| GET | `/api/portfolios/:id/targets` | 目标权重 |
| PUT | `/api/portfolios/:id/targets` | 设置目标权重（同维度合计必须为 1） |
| GET | `/api/portfolios/:id/drift` | 目标与当前偏离 |
| POST | `/api/portfolios/:id/rebalance-preview` | 再平衡预览（只算不写） |
| GET | `/api/portfolios/:id/risk-summary` | 集中度与风险摘要 |

### 12.2 收益响应

```jsonc
// GET /api/portfolios/:id/returns?from=2026-01-01&to=2026-10-31
{
  "twr": {
    "value": "0.083200",
    "reason": null,
    "segments": [
      {
        "from": "2026-01-01", "to": "2026-03-15",
        "startValue": "10000.000000", "endValue": "10800.000000",
        "netFlow": "0.000000", "return": "0.080000"
      }
    ]
  },
  "xirr": {
    "value": "0.124880",
    "reason": null,
    "cashflows": [
      { "date": "2026-01-01", "amount": "-10000.000000", "kind": "deposit" },
      { "date": "2026-10-31", "amount": "11400.000000", "kind": "terminal" }
    ]
  },
  "period": { "from": "2026-01-01", "to": "2026-10-31" },
  "isComplete": true,
  "missingValuations": []
}
```

- `value = null` 时 `reason` 必有值，前端显示为「—」并给出原因文案。
- `terminal` 现金流等于期末组合价值。
- 现金流超过 `INVESTMENT_MAX_CASHFLOWS`（默认 200）时返回 400，提示缩小区间（防止迭代爆炸）。

### 12.3 配置与再平衡

- `allocation` 三个维度均返回 `[{ key, label, value, weight }]`，`weight` 合计为 1；无持仓时返回空数组与 `total = 0`。
- `targets` 按维度独立校验：同维度 `targetWeight` 合计与 1 的偏差超过 1e-6 时返回 422，并给出合计值。
- `drift` 输出 `[{ key, targetWeight, currentWeight, drift, action }]`，`action` 为 `buy` / `sell` / `none`（|drift| ≤ 阈值，默认 0.05）。
- `rebalance-preview` 输入可选 `amount`（本次可投入金额），输出每个标的的建议买卖金额与数量（按最新价格折算，向下取整到 4 位）：**只返回建议，不产生任何记录**。
- `risk-summary` 输出：持仓数量、最大单标的权重、前三大持仓合计、资产类别分布、是否有单一类别超过 60%（`concentrationWarning`）。

### 12.4 验收

- [ ] 无外部现金流时 XIRR 等于简单收益率，且 `reason = null`
- [ ] 期间入金不被计入收益（TWR 分段后结果与无入金情形一致）
- [ ] 现金流全为正或全为负时 XIRR 返回 `null` 且 `reason = 'no_cashflow_sign_change'`
- [ ] 缺价时 TWR 返回 `null`、`reason = 'missing_valuation'`
- [ ] 相同输入两次调用，TWR 与 XIRR 完全一致
- [ ] 目标权重合计不为 1 时 422
- [ ] 再平衡预览不产生任何 `portfolio_trades` 记录
- [ ] 收益曲线超过 400 点时自动降级并标记 `downgraded`

---

## 十三、B6 — 前端投资页

### 13.1 路由与导航

- 新增路由 `/portfolios`（列表）与 `/portfolios/:id`（详情）。
- 侧边栏在「预算」之后新增「投资」，图标使用 `lucide-react` 的 `LineChart`。
- 导航项受 `capabilities.available.includes('portfolios')` 控制，与既有能力声明保持一致。

### 13.2 页面结构

```
/portfolios
├── 顶部：创建组合、总数与总市值
├── 组合卡片列表：名称、总市值、总收益、状态（正常/估值过期/无持仓）
└── 空态：引导创建组合并绑定证券账户

/portfolios/:id
├── 头部：组合名、币种、资金账户、估值日期与新鲜度、归档/编辑
├── 总览卡：总市值、现金、总成本、总收益、TWR、XIRR
├── Tab 1 持仓：表格（标的、数量、成本、现价、市值、盈亏、占比）
├── Tab 2 收益：收益曲线 + TWR/XIRR 说明 + 分段明细折叠
├── Tab 3 配置：饼图（资产类别）+ 目标权重编辑 + 偏离表
├── Tab 4 交易：交易列表（买卖/股息/费用）+ 新增/编辑/撤销
└── Tab 5 现金流：入金/出金列表与登记
```

### 13.3 组件

```
components/portfolios/
├── PortfolioSummaryCards.tsx     总市值、现金、成本、收益、TWR、XIRR
├── HoldingTable.tsx              持仓表，缺价与过期就地标注
├── AllocationPieChart.tsx        资产类别饼图，复用 analytics 的图表封装
├── PerformanceChart.tsx          收益曲线，缺价处断线
├── ReturnExplanation.tsx         TWR 与 XIRR 差异说明（口径文案）
├── TradeForm.tsx                 买卖/股息/费用录入
├── TradeList.tsx                 交易列表与撤销
├── CashflowForm.tsx              入金/出金登记
├── DriftTable.tsx                目标与当前偏离
└── RebalancePreview.tsx          再平衡建议（只读）
```

### 13.4 交互与口径展示

- 所有价格旁必须显示 `priceDate`；`stale = true` 时显示「估值过期」标签（颜色 + 文字，不只靠颜色）。
- TWR 或 XIRR 为 `null` 时显示「—」，鼠标悬停/点击展开原因文案，**不得显示 0%**。
- 组合总览同时展示 TWR 与 XIRR，并附一句口径说明（来自语言文件，不硬编码）。
- 卖出表单在提交前先调 `holdings` 校验可用数量，超卖就地提示，不等到提交失败。
- 撤销交易需二次确认，提示「将同时冲正账本记录」。

### 13.5 移动端

- 375px 宽度下持仓表切换为卡片式布局（标的 + 市值 + 盈亏），横向表格不出现滚动条。
- 收益曲线的图例在窄屏折叠。

---

## 十四、B7 — 交易录入、i18n、测试与交付

### 14.1 交易录入

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/portfolio-trades` | 交易列表，支持 `portfolioId` / `kind` / `instrumentId` / 区间 |
| POST | `/api/portfolio-trades` | 新增交易（同时写账本，单事务） |
| GET | `/api/portfolio-trades/:id` | 交易详情（含关联账本交易） |
| PATCH | `/api/portfolio-trades/:id` | 修改交易（冲正旧账本交易并重建） |
| DELETE | `/api/portfolio-trades/:id` | 撤销交易（冲正账本交易 + `voidedAt`） |

- 前端不直接调用账本接口，统一走 `/api/portfolio-trades`，由服务层负责「写交易 → 写账本 → 返回关联 ID」的单事务。
- 编辑交易 = 冲正旧账本交易 + 重建新账本交易 + 更新交易行（`version` 乐观锁）。
- 撤销交易 = 冲正账本交易 + `portfolio_trades.voidedAt` 置位；持仓重放自动排除已撤销交易。

> 所有聚合与重放都必须过滤 `voidedAt IS NULL`。

### 14.2 审计事件

| 事件 | 记录内容 |
|------|---------|
| `portfolio.created` | 组合 ID、账户 ID、成本方法 |
| `portfolio.updated` | 组合 ID、变更字段名 |
| `portfolio.archived` | 组合 ID |
| `trade.created` | 交易 ID、组合 ID、类型、标的 ID（不记金额） |
| `trade.voided` | 交易 ID、组合 ID |
| `cashflow.created` | 现金流 ID、组合 ID、类型（不记金额） |
| `targets.updated` | 组合 ID、维度、条目数（不记权重明细） |

> 与 Phase 3 的审计约定一致：只记标识与计数，不记金额。

### 14.3 i18n

- 新增命名空间 `portfolios`，`zh-CN` 与 `en-US` 各一份且键完全对齐。
- `enums` 增补：`asset_class`、`trade_kind`、`cost_basis_method`、`cashflow_kind`、`allocation_dimension`、`portfolio_status`、`price_source`。
- `errors` 增补第十五节全部错误码。
- 口径文案（TWR 与 XIRR 的区别、估值过期、外部现金流含义）必须放语言文件，不得硬编码。

### 14.4 测试

| 层级 | 覆盖 |
|------|------|
| 单元 | 加权平均成本（含费用、多次买入、全清仓）、卖出超量、已实现损益、已撤销交易排除、TWR 分段与连乘、XIRR 收敛与不收敛、目标权重校验、再平衡取整 |
| 集成 | 组合 CRUD 与账户唯一约束、标的与价格（覆盖/未来日期）、交易写账本与冲正、删除价格后收益不可计算、分析接口排除 investment、净资产含市值且不重复计现金、跨用户 404、归档后不出现在列表但历史保留 |
| 回归 | Phase 1/2/3 全部测试通过；Dashboard 净资产在无组合时完全不变；导入、预算、分析行为不变 |
| 口径对齐 | 买入前后 `/api/dashboard/overview` 的 `netWorth` 变化等于 0；买入前后分析支出变化等于 0；股息前后收入变化等于股息金额 |

### 14.5 文档

- [ ] README 增加投资章节：组合与账户绑定、成本方法、TWR/XIRR 口径、估值来源与过期规则
- [ ] `docs/API接口全面分析.md` 更新投资相关接口状态
- [ ] `docs/项目目录结构.md` 增补 `modules/portfolios` 与前端页面
- [ ] 演示数据脚本增补组合、标的、价格、买卖与入金，使投资页在演示账号下有可看数据
- [ ] 明确记录「新建组合历史 TWR 不可计算」的成因

---

## 十五、接口清单汇总

| 模块 | 接口数 | 所属阶段 |
|------|--------|----------|
| 标的与价格 | 8 | B2 |
| 估值快照 | 3 | B2 |
| 组合 CRUD 与总览 | 6 | B3 |
| 持仓与损益 | 4 | B3 |
| 现金流 | 3 | B4 |
| 收益 | 2 | B4 |
| 配置、偏离与再平衡 | 6 | B5 |
| 投资交易 | 5 | B7 |
| **合计新增** | **37** | |

> 相比前三阶段累计的 128 个接口，本阶段新增 37 个；全项目累计 165 个。

### 实现说明（与计划的差异）

| 项 | 计划 | 实际实现 | 原因 |
|---|---|---|---|
| 入金/出金是否进账本 | 只登记 `portfolio_cashflows` | 同时写一条 `investment` 账本交易 | 否则组合现金恒为 0，收益曲线与 XIRR 都会失真；用 `investment` 而非 `income/expense` 才能保持「不是收支」 |
| 默认收益区间 | 今天往前 365 天 | 组合首笔交易或入金日到今天 | 固定 365 天会让新建组合的起点价值为 0，TWR 直接不可算 |
| 已实现损益核算 | 逐笔卖出各自重放 | 一次重放就地捕获每笔卖出的平均成本 | 逐笔重放是 O(n²)，且清仓后重放拿不到当时的成本 |
| 交易列表 `created` 判定 | 响应返回是否新建 | 落库前先查同日价格是否存在 | upsert 之后无法区分「新建」与「覆盖」 |
| 客户端 4xx 处理 | 未覆盖 | Fastify 自身 4xx（空 body、content-type 不符）原样返回 400 | 原实现一律包装成 500，把调用方错误显示成服务故障 |
| 归档组合 | 归档即排除 | 列表默认只返回 active，`status=all` 可查 | 前端不应默认看到归档项，但历史必须可访问 |
| 资产类别标签 | 后端返回可读名称 | 后端返回枚举值，前端翻译 | 标签属于展示层，避免后端硬编码中文 |

### 新增错误码

| 错误码 | HTTP | 说明 |
|--------|------|------|
| `PORTFOLIO_VALUATION_NOT_FOUND` | 404 | 估值快照不存在（避免与组合本身混淆） |
| `PORTFOLIO_NOT_FOUND` | 404 | 组合不存在或不属于当前用户 |
| `PORTFOLIO_ACCOUNT_INVALID` | 422 | 绑定账户不是 brokerage 类型 / 已归档 / 已被其他组合占用 |
| `PORTFOLIO_HAS_TRADES` | 409 | 有交易时试图修改账户或成本方法 |
| `PORTFOLIO_ARCHIVED` | 409 | 组合已归档，不可新增交易或现金流 |
| `INSTRUMENT_NOT_FOUND` | 404 | 标的不存在或不属于当前用户 |
| `INSTRUMENT_SYMBOL_EXISTS` | 409 | 同一用户下代码重复 |
| `INSTRUMENT_IN_USE` | 409 | 标的已有交易，不可删除 |
| `INSTRUMENT_CURRENCY_MISMATCH` | 422 | 标的币种与账户币种不一致 |
| `PRICE_DATE_INVALID` | 422 | 价格日期在未来，或价格不为正 |
| `PRICE_NOT_FOUND` | 404 | 指定价格记录不存在 |
| `TRADE_NOT_FOUND` | 404 | 交易不存在或不属于当前用户 |
| `TRADE_INVALID` | 422 | 类型与字段不匹配（买卖缺数量/价格，或非买卖带数量） |
| `TRADE_SELL_EXCEEDS_HOLDING` | 422 | 卖出数量超过该时点持仓，`details.available` 给出可用数量 |
| `TRADE_CATEGORY_REQUIRED` | 422 | 股息/利息/费用/税费缺少可用分类 |
| `CASHFLOW_NOT_FOUND` | 404 | 现金流记录不存在 |
| `CASHFLOW_AMOUNT_INVALID` | 422 | 金额不为正 |
| `VALUATION_DATE_EXISTS` | 409 | 同日快照已存在（提交 `overwrite` 时覆盖） |
| `ALLOCATION_TARGETS_INVALID` | 422 | 权重越界、负数或键不属于该维度 |
| `ALLOCATION_TARGETS_MISMATCH` | 422 | 同维度权重合计不为 1，`details.total` 给出实际合计 |
| `PORTFOLIO_RANGE_INVALID` | 400 | 区间起始晚于结束或超出允许范围 |
| `PORTFOLIO_TOO_MANY_CASHFLOWS` | 400 | 区间内现金流过多，无法稳定求解 |

> 越权访问一律 404（`PORTFOLIO_NOT_FOUND` / `INSTRUMENT_NOT_FOUND` / `TRADE_NOT_FOUND`），与前三阶段一致。

---

## 十六、技术依赖

### 后端

**不新增依赖。**

- 成本重放、TWR、XIRR 均为纯计算，使用 `decimal.js`（已存在）。
- 求根使用原生牛顿迭代 + 二分，不引入 `xirr` / `newton-raphson` 等库。
- 日期与周期使用 `date-fns` / `date-fns-tz`（已存在）。
- 账本写入复用既有 `buildEntries` / `assertBalanced`。

> XIRR 的边界远比公式难，第三方库往往在无解时返回 `NaN` 或抛异常。自己实现并把失败原因显式返回，比引入一个不可控的黑盒更合适。

### 前端

**不新增依赖。**

- 图表沿用 `echarts` + `echarts-for-react`（已存在）。
- 表格、Tab、饼图、折叠面板均为原生 + 既有封装实现，不引入 UI 组件库。

---

## 十七、环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `INVESTMENT_PRICE_STALE_DAYS` | `7` | 价格超过该天数视为过期 |
| `INVESTMENT_MAX_SERIES_POINTS` | `400` | 收益曲线最大采样点，超出降级粒度 |
| `INVESTMENT_MAX_CASHFLOWS` | `200` | 单次收益计算的现金流上限 |

> 三者写入 `src/config/constants.ts` 并随 `capabilities` 返回的 `investmentLimits` 暴露给前端，供界面提示与校验。不新增数据库表或外部服务。

---

## 十八、验证清单

### B1

- [ ] 迁移为纯增量，`ALTER TYPE` 后新枚举值可用，前三阶段测试全部通过
- [ ] 买入前后分析支出不变；净资产不变
- [ ] 股息使收入增加、分类覆盖率保持 1
- [ ] 通用记账接口无法创建 `investment` 类型
- [ ] `/api/system/capabilities` 中 `portfolios` 从 `planned` 移至 `available`

### B2

- [ ] 同日重复价格覆盖且返回 `created: false`
- [ ] 未来日期价格被 422
- [ ] 删除价格后，依赖它的 TWR 变为 `null` 且原因为 `missing_valuation`
- [ ] 标的币种与账户币种不一致被 422

### B3

- [ ] 加权平均成本在多次买入、含费用、清仓后重新买入等场景均正确
- [ ] 卖出超量 422，`details.available` 为卖出日可用数量而非当前数量
- [ ] 已撤销交易不参与重放
- [ ] 持仓 `weight` 不含现金，合计为 1
- [ ] 无价格标的进入 `missingPrices`，市值不按成本填充
- [ ] 修改或删除历史交易后持仓立即变化

### B4

- [ ] TWR 分段数 = 现金流数 + 1，且分段收益率连乘等于总收益
- [ ] 入金不当成收益：有入金与无入金两次计算的 TWR 一致
- [ ] XIRR 牛顿失败时成功回落二分，不返回 `NaN`
- [ ] 全正/全负现金流返回 `null` 且原因正确
- [ ] 收益曲线超点自动降级并标记 `downgraded`
- [ ] 现金流超过上限时返回 400，而非超时

### B5

- [ ] 目标权重合计不为 1 时 422 并给出合计值
- [ ] 偏离度与再平衡建议在目标未设置时返回 `[]` 而非报错
- [ ] 再平衡预览不写入任何交易
- [ ] 单一资产类别超过 60% 时触发集中度提示

### B6 / B7

- [ ] 侧边栏新增「投资」后，折叠与展开状态下滑动正常
- [ ] 所有 `null` 收益显示「—」并附原因，不显示 0%
- [ ] 价格日期与过期状态在持仓表可见
- [ ] 中英文切换后新增页面无残留中文/英文
- [ ] 移动端 375px 宽度下持仓表不出现横向滚动
- [ ] 无组合时展示引导，不展示空图表
- [ ] 撤销交易后账本记录被冲正，审计日志有对应事件

---

## 十九、交付标准与后续衔接

### 功能交付

1. 用户可创建多个投资组合，每个组合绑定一个证券资金账户，并查看总市值、现金、成本与收益。
2. 用户可维护投资标的与手工价格，查看标的持仓数量、加权平均成本、市值与未实现损益。
3. 用户可录入买入、卖出、股息、利息、手续费与税费，且这些操作正确反映到统一账本。
4. 用户可登记入金与出金，并据此得到 TWR 与 XIRR，两个指标并列展示且口径有解释。
5. 用户可查看收益曲线、已实现损益明细与股息利息汇总。
6. 用户可设置目标配置比例，查看偏离度与再平衡建议（不会自动交易）。
7. 用户可查看组合集中度与风险摘要。
8. 净资产包含证券市值，并明确标注估值日期与过期状态。

### 质量要求

1. 买入与卖出永不进入收入、支出、分类占比、商户排行与预算执行。
2. 持仓、成本与损益全部由交易历史重放，修改历史后无需任何刷新任务即正确。
3. 净资产不重复计算现金与市值；无组合时净资产与前三阶段完全一致。
4. 估值缺失与价格过期永远显式暴露，不用最近价伪造历史、不把过期估值当作实时数据。
5. TWR 与 XIRR 为确定性计算，相同输入结果完全一致；不可计算时返回 `null` 与原因码。
6. 跨用户访问一律 404。
7. 前三阶段全部测试保持通过，Dashboard、导入、分析、预算行为无回归。

### 已知取舍（需在文档与 UI 中明示）

| 取舍 | 影响 | 后续处理 |
|------|------|---------|
| 仅加权平均成本 | 无法按批次指定卖出成本 | FIFO/指定批次需要批次表与部分卖出分摊，建议与交易拆分一并立项 |
| 仅手工价格 | 无历史价格时 TWR 不可计算 | 接入行情后可用历史价回填，届时保留手工价作为兜底 |
| 标的不支持外币 | 无法直接记录美股/港股 | 需要三层折算与独立汇率口径，建议单独设计 |
| 组合与账户一对一 | 同一券商多策略需建多个账户 | 若未来需要归集，需引入组合现金分摊模型 |
| 股息不进成本 | 不支持分红再投资 | DRIP 需要「股息 → 自动买入」规则 |
| 无期权/融券/做空 | 无法记录负持仓与保证金 | 需要独立的风险与强平模型 |
| 未登记现金流会扭曲收益 | 转出未登记会被误认为亏损 | 收益页对「无现金流但有资金转出」给出提醒 |
| 不自动交易 | 再平衡仅为建议 | 委托执行涉及券商接口与合规，不在个人记账产品范围内 |

### 与后续阶段的衔接

| 后续阶段 | 建议内容 | 对 Phase 4 的依赖 |
|---------|---------|------------------|
| Phase 5 风险模拟 | 蒙特卡罗、分片异步执行、任务进度 | 复用本阶段的组合收益与波动数据作为模拟输入；模拟结果必须与真实收益显式区分。**注**：Phase 5 计划已改为进程内执行器，不使用 BullMQ 与 Worker Threads，见 `docs/plan-phase5.md` 第 5.1 节 |
| Phase 6 目标与报告 | 财富目标、财务独立、报表导出 | 使用本阶段的投资市值、TWR/XIRR 与净资产口径；报表需标注估值来源与日期。**注**：Phase 6 已实现，投资报表的估值来源与过期标记随 `basis` 返回，见 `docs/plan-phase6.md` |
| Phase 7 数据管理与运维 | 备份恢复、导出、管理后台、审计扩展 | 复用本阶段的审计事件与组合/标的外键约束，备份需覆盖价格与估值历史 |
| 行情接入（独立小阶段） | 价格提供方适配器、缓存、限流、复权 | 复用 `instrument_prices` 与 `PriceSource.provider`，不改变持仓与收益公式 |

### 需补齐的设计文档

| 文档 | 最晚需要时间 |
|------|-------------|
| 投资收益与复利计算规范（成本基础、TWR/XIRR 用例与边界） | B1 开始前 |
| 价格与估值数据规范（来源优先级、过期阈值、缺失处理） | B2 开始前 |
| 投资口径与净资产衔接说明（本文件第六节即可作为初稿） | B1 确认 |
