# Phase 6 开发计划 — 财富目标、财务自由与财务报表

> **对应项目**：Comporalife（复利人生）Personal 开源个人版
> **上游计划**：`docs/plan-phase1.md`（S1–S7，v0.1.0）、`docs/plan-phase2.md`（P1–P8，v0.1.1）、`docs/plan-phase3.md`（A1–A7，v0.1.4）、`docs/plan-phase4.md`（B1–B7，v0.1.5）、`docs/plan-phase5.md`（C1–C7，v0.1.6）
> **技术栈**：沿用前五阶段：Fastify 5 + TypeScript + Prisma 6 + PostgreSQL 16 + Redis 7 + React 19 + Vite + Tailwind CSS 4 + ECharts 6
> **文档版本**：v6.0-plan
> **计划交付版本**：v0.1.7
> **范围决策**：财富目标与进度 + 财务自由估算 + 目标预测与反推 + 六类财务报表与冻结快照 + CSV/XLSX 导出；不做数据备份恢复、不做整体数据导出、不做管理后台、不做报表订阅推送

---

## 一、Phase 6 目标

> **把「我记了账、我有资产、我算过概率」变成「我的目标还差多少、多久能到、这个计划是否现实」**

前五个阶段各自回答了一个独立问题：账记得对不对、钱从哪来、花得是否合理、投资赚了多少、未来大概落在什么区间。但它们始终没有被拼到一起——用户打开应用，看到的是一堆互不相干的正确数字，而真正驱动财务决策的那个问题没有被回答：

- 我给孩子准备的 80 万教育金，现在到哪一步了？
- 按我现在的结余能力，五年后买房够不够？
- 我每月至少要存多少，才能在 60 岁前有 300 万？
- 我现在的资产，按 4% 提取率能覆盖多少年生活？
- 这个月的现金流、净资产、投资表现，能不能一次看全并导出给家里人？

Phase 6 补的就是这条闭环。它不是再添一个计算器，而是四件事：

1. **目标进度来自真实数据**：进度只能由账本与组合推导，不许手工填写一个百分比。用户改了流水，进度立刻跟着变。
2. **预测必须分源并列**：确定性复利给一个点估计，蒙特卡罗给一个区间与概率，两者必须并列并各自标注来源。绝不允许把它们平均成一个看起来很确定的数字。
3. **报表是快照，不是幻觉**：一份报表在生成那一刻冻结口径与数据，之后账本再变，历史报表也不会悄悄变形；要看最新数据必须显式「重新生成」。
4. **导出必须安全可用**：CSV 在 Excel 里打开中文不乱码、数字不变成日期、公式不会被执行；文件名中的中文不会乱码；导出内容永远带着口径说明。

### 核心原则

| 原则 | 说明 |
|------|------|
| **进度不可手填** | 目标进度一律由 `net_worth` / 账户余额 / 组合市值推导，接口不接受进度入参 |
| **进度不落快照** | 与 Phase 4 持仓一致：按 as-of 重算，改历史流水后进度立即正确，无需刷新任务 |
| **预测分源并列** | 点估计来自复利引擎，区间与概率来自蒙特卡罗运行；两者结构上分开返回，永不加权合并 |
| **概率必须同源** | 目标达成概率只能取自「目标金额与年限匹配」的模拟运行；不匹配时返回 `null` 与原因码，不借用别的运行 |
| **口径必返** | 任何报表与导出都带 `basis`：区间、币种、汇率日期、账户范围、数据完整性、模型版本 |
| **缺失不补零** | 缺月份、缺估值、缺汇率一律显式标记；不足最小样本时指标返回 `null`，不返回 0 |
| **报表冻结** | 报表数据一旦生成即冻结；重新生成是显式动作，旧快照不被覆盖 |
| **导出不改数据** | 导出与报表生成全程只读，不写账本、不写组合、不触发任何重算 |
| **不伪造结论** | 财务自由只给指标与敏感性，不给「可以退休了」这类判断 |
| **越权一律 404** | 与前五阶段一致 |

---

## 二、Phase 6 开发阶段划分

```
D1 目标模型与进度 ──┬──► D2 预测与反推 ──┐
                     │                     ├──► D6 前端目标与报表页 ──► D7 交付
D3 财务自由 ─────────┘                     │
                                           │
D4 报表引擎与快照 ─────────────────────────┤
                                           │
D5 报表与应用导出 ─────────────────────────┘
```

| 阶段 | 内容 | 涉及模块 | 预期工时 |
|------|------|----------|---------|
| **D1 目标模型与进度** | 2 张新表、4 个新枚举、目标 CRUD、资金绑定、进度推导、历史重算与达成判定 | prisma + goals | 5-6 天 |
| **D2 预测与反推** | 复利引擎复用、达成时间二分、所需月供反推、概率来源匹配约束 | goals/projection | 4-5 天 |
| **D3 财务自由** | 支出年化口径、提取率与敏感性网格、覆盖月数与安全边际 | goals/financial-independence | 3-4 天 |
| **D4 报表引擎与快照** | 六类报表生成、口径对象、完整性标记、快照冻结与重新生成 | reports | 5-6 天 |
| **D5 报表与应用导出** | CSV 编码与转义、XLSX 多表、行数上限、文件名、模拟方案与运行导出 | reports/export | 3-4 天 |
| **D6 前端目标与报表页** | 目标列表与详情、进度环与历史曲线、财务自由视图、报表生成与下载 | 前端页面 | 5-6 天 |
| **D7 i18n、测试与交付** | 双语资源、单元与集成测试、演示数据、文档更新 | 全项目 | 4-5 天 |

> **合计约 29-36 天（单人开发）**。主要不确定性在「首次达成时间按月重算」的成本、CSV 在各类 Excel 版本下的兼容性、以及目标与模拟运行的概率匹配边界，工时已含调试。

### 阶段依赖说明

- **D1 是所有阶段的前置**：目标实体与进度口径一旦定下，D2 的预测输入与 D4 的目标报表都以它为准。
- D2 依赖 D1 的进度结构，但只读；可与 D3 并行。
- D3 不依赖目标实体，只读 Phase 3 的分析口径，可与 D1 完全并行。
- D4 依赖 D1（目标报表）、D3（财务自由报表可后接）、Phase 1–5 的全部只读接口；建议先做 `cashflow` 与 `net_worth` 两类，验证口径对象结构，再补其余。
- D5 依赖 D4 的快照结构；CSV 转义与文件名编码必须先于任何报表内容对接，否则返工面很大。
- D6 依赖 D2/D3/D4/D5 的接口；建议先跑通「目标进度 → 报表生成 → 下载」一条直达路径，再接图表。
- D7 的回归测试必须验证「报表生成前后账本与组合完全不变」。

---

## 三、Phase 6 范围界定

### 交付范围

| 模块 | 交付内容 |
|------|---------|
| 财富目标 | 创建、修改、删除、归档、列表；储蓄/购房/教育/退休/应急金/财务自由/自定义类型 |
| 资金绑定 | 目标可绑定净资产、单/多账户或投资组合；不支持跨币种绑定 |
| 目标进度 | 当前金额、完成比例、缺口；按月度重算的历史进度曲线 |
| 达成判定 | 首次达成时间按月重算并标注颗粒度；状态自动由进度推导 |
| 目标预测 | 预计达成时间、所需月供、按当前计划的外推曲线（复利口径） |
| 概率区间 | 来自匹配的蒙特卡罗运行；不匹配时为 `null` 并给出原因码 |
| 目标汇总 | 全部活跃目标的总缺口、所需月供合计、与可投资结余的对比 |
| 财务自由 | 年化支出、财务自由目标资产、完成度、覆盖月数、提取率敏感性网格 |
| 财务报表 | 净资产、现金流、收支分析、投资绩效、目标进度、模拟分析六类 |
| 报表快照 | 生成即冻结；列表、详情、数据、重新生成、删除 |
| 报表导出 | CSV 与 XLSX；UTF-8 BOM、RFC 4180 转义、公式注入防护、行数上限 |
| 应用导出 | 蒙特卡罗方案与运行结果导出（含假设与模型版本）；复利方案导出 |
| 运维 | 能力声明、审计事件、报表保留策略、双语资源 |

### 明确不交付（后续阶段）

| 能力 | 原因 |
|------|------|
| 数据备份、恢复与整体导出 | Phase 7 数据管理范围；备份需要加密包、完整性校验与恢复演练，与报表导出不是同一件事 |
| 管理后台与任务监控面板 | Phase 7；本阶段不引入管理员视角 |
| 报表 PDF 导出 | 中文字体嵌入与分页排版成本高，且浏览器打印已能覆盖大多数场景；引入 PDF 需要额外字体与渲染依赖 |
| 报表订阅、定时生成与邮件推送 | 依赖 SMTP 可靠性、投递失败重试与退订，属于独立小阶段 |
| 多目标自动资金分配 | 任何自动分配都需要用户确认未来现金流；本阶段只做「所需月供合计 vs 可投资结余」的对比提示 |
| 目标进度的手工调整 | 手工填进度会让目标失去与真实数据的一致性，属于产品红线 |
| 跨币种目标与折算目标 | 需要独立的目标汇率口径与历史汇率，容易与净资产口径冲突，另行设计 |
| 行情自动接入 | 独立小阶段，不改变本阶段报表口径 |
| 税务报表与税前/税后口径 | 需要地区税制参数，个人版不预设任何税率假设 |
| 报表数据回写（例如用报表结果修正账本） | 报表只读，任何修正都应在账本层完成 |

> **口径说明**：推迟项属于《项目功能全面分析》中的完整个人版能力，属于**产品范围**而非**本阶段范围**。Phase 6 不修改功能文档。

---

## 四、数据模型设计

### 4.1 模型总览（新增 2 张表）

```
financial_goals   财富目标（类型、目标金额、期限、资金绑定、假设）
reports           财务报表快照（类型、参数、冻结数据、口径）
```

**不新增第三张「目标进度表」**：进度是账本与组合的函数，存快照必然与真实数据漂移。历史曲线按需按月重算，与 Phase 4 持仓重放同一思路。

**不新增「导出任务表」**：本阶段导出同步完成（见第五节决策 11），异步导出随 Phase 7 数据管理一并设计。

并对已有表做**增量扩展**（不破坏前五个阶段数据）：

```
users            新增关系：financialGoals / reports
```

### 4.2 新增枚举

```prisma
enum GoalType {
  savings                  // 储蓄目标
  purchase                 // 购房/大额购置
  education                // 教育金
  retirement               // 退休储备
  emergency_fund           // 应急备用金
  financial_independence   // 财务自由
  custom                   // 自定义
}

enum GoalFundingSource {
  net_worth    // 绑定整体净资产
  account      // 绑定一个或多个账户余额
  portfolio    // 绑定投资组合市值
}

enum GoalStatus {
  active
  achieved
  archived
}

enum ReportType {
  net_worth    // 资产负债
  cashflow     // 现金流
  analytics    // 收支分类与商户
  investment   // 投资绩效
  goals        // 目标进度
  simulation   // 模拟分析
}
```

`ReportFormat` 不做枚举列：CSV / XLSX 只是下载时的查询参数，不构成持久状态。

### 4.3 模型定义

#### financial_goals

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | uuid | 主键 |
| `userId` | uuid | 归属用户，级联删除 |
| `name` | varchar(80) | 同一用户内唯一 |
| `type` | GoalType | 默认 `savings` |
| `targetAmount` | decimal(20,6) | 目标金额，> 0 |
| `currency` | char(3) | 目标币种，必须与绑定资金同币种 |
| `targetDate` | date? | 目标日期；为空表示无期限（仅追踪进度） |
| `startedAt` | date | 起算日，默认创建日 |
| `initialAmount` | decimal(20,6) | 起算日已计入的金额，默认 0 |
| `inflationAdjusted` | bool | 目标金额是否随通胀调整，默认 false |
| `inflationRate` | decimal(10,6) | 年通胀率，`inflationAdjusted` 为真时必填 |
| `expectedAnnualReturn` | decimal(10,6)? | 预测用年化收益；为空时不预测 |
| `monthlyContribution` | decimal(20,6)? | 计划月供；为空时由预测反推 |
| `fundingSource` | GoalFundingSource | 资金绑定方式，默认 `net_worth` |
| `accountId` | uuid? | 绑定账户，`fundingSource = account` 时必填 |
| `portfolioId` | uuid? | 绑定组合，`fundingSource = portfolio` 时必填 |
| `priority` | int | 展示顺序，1 最高 |
| `status` | GoalStatus | 默认 `active` |
| `achievedAt` | date? | 首次达成日（按月重算，见 6.3） |
| `note` | text? | |
| `createdAt` / `updatedAt` | timestamptz | |

唯一约束：`[userId, name]`；索引：`[userId, status, priority]`、`[userId, updatedAt(sort: Desc)]`。

**为什么账户绑定只存一个 `accountId`**：个人版的储蓄目标绝大多数绑定单一账户；需要多账户时绑定组合或使用净资产口径即可。引入 `financial_goal_accounts` 关联表会让「一个账户被多个目标瓜分」的语义变得模糊（同一笔钱同时算进两个目标），这与「不重复计算」的原则冲突。

#### reports

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | uuid | 主键 |
| `userId` | uuid | 归属用户，级联删除 |
| `type` | ReportType | 报表类型 |
| `title` | varchar(120) | 用户可见标题，默认由类型与区间生成 |
| `rangeFrom` | date | 统计区间起（资产负债表为空区间的同一日） |
| `rangeTo` | date | 统计区间止 |
| `currency` | char(3) | 生成时的基准币种快照 |
| `params` | Json | 生成参数（维度、账户范围、是否含转账等） |
| `basis` | Json | **口径对象**（见 6.7），生成时冻结 |
| `data` | Json | **冻结的报表数据**，下载与预览都只读这里 |
| `rowCount` | int | 明细行数，用于上限判断与展示 |
| `modelVersions` | Json | 引用到的模型版本（`compound-v1` / `montecarlo-v1` 等） |
| `generatedAt` | timestamptz | 数据实际生成时间 |
| `createdAt` | timestamptz | |

索引：`[userId, createdAt(sort: Desc)]`、`[userId, type, createdAt(sort: Desc)]`。

> `params` / `basis` / `data` 三者必须一起冻结。只存参数不存数据，等于把「历史报表」退化成「用今天的账本重算」，与报表的意义相反。

### 4.4 金额与精度

| 位置 | 类型 | 理由 |
|------|------|------|
| 金额字段 | `decimal(20,6)` | 与账本、复利引擎、投资模块一致 |
| 比率字段 | `decimal(10,6)` | 与 Phase 3/4 的比率精度一致 |
| 报表导出 | 6 位小数原始字符串 | 导出不写千分位、不带币种符号，避免 Excel 误判 |
| 百分比展示 | 前端保留 1 位小数 | 接口给 6 位原值，展示层再舍入 |

**边界规则**：进入计算前所有金额经 `Decimal` 解析；导出边界统一 `moneyToString`；进度与概率在序列化时统一 6 位小数。

### 4.5 迁移策略

- 纯增量：2 个新表 + 4 个新枚举（`GoalType`、`GoalFundingSource`、`GoalStatus`、`ReportType`）。
- 不改任何既有表结构，不加列、不改枚举值，前五阶段数据与测试全部不受影响。
- 存量用户无目标与报表，Dashboard、净资产、分析、预算、投资、复利、风险模拟页行为完全不变。
- `users` 仅新增两条关系，不产生列变更。

---

## 五、关键设计决策

| # | 决策点 | 结论 | 理由 |
|---|--------|------|------|
| 1 | 进度是计算还是存储 | 一律计算 | 存快照会与真实数据漂移；用户改一笔流水后进度必须立即正确 |
| 2 | 进度是否允许手工调整 | 不允许 | 手工填百分比等于放弃「目标与真实数据绑定」这个唯一价值 |
| 3 | 目标金额是否随通胀调整 | 默认不变，可显式开启 | 默认调整会让「80 万教育金」逐年变大，与用户心理账户不符 |
| 4 | 达成时间怎么定 | 按月重算的历史首个 ≥100% 月末 | 精确到日需要逐日重放全部账户，成本与价值不成比例；月粒度足够，但必须标注 |
| 5 | 达成状态如何维护 | 由进度推导，写入 `status` 与 `achievedAt` | 列表筛选与徽标需要索引列；但值仍来自重算，不是人工置位 |
| 6 | 预测用哪个引擎 | Phase 1 复利引擎 | 确定性、可解释、与用户已熟悉的复利页口径完全一致 |
| 7 | 概率从哪里来 | 只取目标金额与年限匹配的蒙特卡罗运行 | 借用不匹配的运行会把「80 万目标」的概率贴到「300 万目标」上，是产品事故 |
| 8 | 概率不匹配怎么办 | 返回 `null` + 原因码 | 返回 0 会被读成「不可能达成」，返回近似值会被读成「就是这个数」 |
| 9 | 所需月供怎么解 | 二分搜索 | 复利引擎含费用、通胀与投入时点，无闭式解；目标函数严格单调，二分稳定且可设精度 |
| 10 | 财务自由的支出怎么取 | 最近 12 个**完整**月的支出年化 | 不完整月不补零、不按天外推；不足最小月数返回 `null` |
| 11 | 导出同步还是异步 | 同步，带行数上限 | 报表导出是纯内存序列化，上限内百毫秒级完成；异步导出需要把 Phase 5 的执行器从蒙特卡罗专用泛化，留给 Phase 7 |
| 12 | 报表数据是实时还是快照 | 冻结快照，重新生成是显式动作 | 「历史报表」若随时间变形，就无法引用、无法对账、无法解释 |
| 13 | CSV 编码 | UTF-8 带 BOM | 不带 BOM 的 UTF-8 在中文 Windows 的 Excel 里会乱码，这是最常见的投诉 |
| 14 | CSV 安全 | 公式注入前缀 + RFC 4180 转义 | 以 `= + - @` 与制表符、回车开头的单元格会被 Excel 当公式执行，必须加单引号前缀 |
| 15 | 数值列格式 | 原始数值，不加千分位与币种 | `1,234.56` 与 `¥` 会让 Excel 把整列变成文本，后续无法求和 |
| 16 | XLSX 用什么 | 既有 SheetJS（导入已依赖） | 不新增依赖；多 sheet 承载「摘要 + 明细」 |
| 17 | 是否做 PDF | 不做 | 中文字体嵌入、分页、页眉页脚、表格跨页都是独立工程，浏览器打印已覆盖绝大多数场景 |
| 18 | 报表保留 | 每用户保留最新 100 份 | 防止无界增长；删除只针对旧快照，不影响账本 |
| 19 | 目标数量上限 | 50 个 | 汇总计算与列表展示的成本边界，同时避免「目标比账户还多」的反常使用 |
| 20 | 崩盘式风险如何呈现 | 直接引用该运行的 P10/P90 与破产概率 | 目标页不重算风险，只搬运并标注来源与种子 |
| 21 | 报表时间区间上限 | 沿用分析层的 1826 天 | 与 Phase 3 口径一致，避免同一份数据在不同页面被切成不同粒度 |
| 22 | 越权 | 一律 404 | 与前五阶段一致 |

---

## 六、口径规范

### 6.1 目标进度

| 绑定方式 | 当前金额定义 | 说明 |
|----------|--------------|------|
| `net_worth` | 净资产 − 起算日净资产 + `initialAmount` | 用增量而不是绝对值，避免「目标创建前已有的房贷」把进度拉成负数 |
| `account` | 账户在 as-of 日的账面余额 + `initialAmount` | 账户必须启用且与目标同币种 |
| `portfolio` | 组合市值（含该组合绑定账户的现金）+ `initialAmount` | 与 Phase 4 净资产口径完全一致，不重复计算 |

- **进度 = 当前金额 / 目标金额**，允许 > 1（超额完成），展示时封顶 100% 但保留真实数值。
- **缺口 = max(0, 目标金额 − 当前金额)**。
- `net_worth` 口径下若起算日净资产被后续修改（补录历史交易），进度会随之变化——这是正确行为，不视为漂移。
- 绑定账户或组合被归档时，目标进度返回 `null` 并标记 `funding_unavailable`，不静默归零。

### 6.2 目标金额的通胀调整

开启 `inflationAdjusted` 时：

```
调整后目标 = targetAmount × (1 + inflationRate)^(targetDate − startedAt 的年数)
```

- 调整后的目标金额同时出现在进度与预测中，报告中必须并列展示「原始目标」与「调整后目标」。
- 未设 `targetDate` 时不允许开启通胀调整（`GOAL_PARAMETERS_INVALID`）。

### 6.3 达成判定

判定在**月度颗粒度**上重算：

```
对每个月初（从 startedAt 到当前月）：
  以该月月末为 as-of 重算进度
  首个 进度 ≥ 1 的月份 → achievedAt = 该月月末日期
```

- 结果写入 `achievedAt` 与 `status = achieved`；若之后余额下降导致进度跌破 100%，状态回到 `active` 但**保留** `achievedAt`（历史事实不撤销）。
- 报告与界面必须标注：「达成时间按月重算，实际达成可能发生在该月内的更早日期」。
- 重算成本：最多 `GOAL_HISTORY_MAX_MONTHS`（默认 120）个月，每次只查该月月末的快照，不做逐日重放。

### 6.4 预测口径

目标预测返回**两组结构，永不合并**：

```ts
interface GoalProjection {
  // 确定性部分：复利引擎
  deterministic: {
    projectedValue: string;          // 按当前计划到期值
    requiredMonthly: string | null;  // 反推所需月供
    etaMonths: number | null;        // 按当前计划达成所需月数
    basis: { expectedAnnualReturn: string; monthlyContribution: string; inflationRate: string };
    feasible: boolean;               // 见下
  } | null;

  // 概率部分：来自匹配的蒙特卡罗运行
  probabilistic: {
    runId: string;
    seed: number;
    pathCount: number;
    probability: string;             // 达标概率
    p10: string; p50: string; p90: string;
    assumptionsDigest: string;       // 关键假设摘要（年限、路径数、模型版本）
    matchedOn: 'target_amount_and_years';
  } | null;

  unavailableReasons: string[];      // 例如 'no_expected_return'、'no_matching_run'
}
```

- `deterministic` 只有在目标设置了 `expectedAnnualReturn` 时返回；否则为 `null` 并写入原因码。
- `probabilistic` 只在存在「`targetAmount` 与本次计算口径一致、年限一致、币种一致、状态为 `succeeded`」的模拟运行时返回；否则为 `null` 并写入 `no_matching_run`。
- `feasible = false` 的三种情况：期望收益为负且月供不足以抵消、期限已过、反推月供超过 `GOAL_MAX_REQUIRED_MONTHLY`。此时 `requiredMonthly` 仍返回数值（若可解），由前端提示不现实。

### 6.5 所需月供反推

已知目标金额 `T`、当前金额 `V0`、月数 `n`、年化收益 `R`、费用率 `f`、通胀 `i`，求月供 `m`，使复利引擎的到期值 `V(m) = T`。

- `V(m)` 在 `m ≥ 0` 上严格单调递增，二分区间 `[0, T]`，迭代上限 100 次，精度 0.01 元。
- 若 `V(0) ≥ T`：`requiredMonthly = 0`，`etaMonths = 0`，写入 `already_achieved`。
- 若 `V(T) < T`（极端负收益）：返回 `null` + `infeasible`，不返回一个巨大的伪解。
- 反推全程调用 Phase 1 引擎，不复制任何复利公式。

### 6.6 达成时间预测

- 固定月供 `m`，求最小月数 `n` 使 `V(n) ≥ T`；`n` 上限 `GOAL_PROJECTION_MAX_MONTHS`（默认 600）。
- 超出上限返回 `null` + `beyond_horizon`，不返回 600。
- `m = 0` 且当前金额不足时，若收益率为正仍可能达成，按实际计算；若收益率为 0 或负，返回 `null`。

### 6.7 报表口径对象（`basis`）

每份报表的 `basis` 固定包含：

```jsonc
{
  "range": { "from": "2025-01-01", "to": "2025-12-31" },
  "currency": "CNY",
  "rateDates": ["2025-12-31"],          // 折算使用的汇率日期
  "accountScope": { "mode": "all", "accounts": 12, "excluded": [] },
  "completeness": {
    "isComplete": false,
    "missingMonths": ["2025-02"],
    "missingRates": ["USD/CNY@2025-06-30"],
    "staleValuations": [{ "portfolioId": "...", "priceDate": "2025-09-01" }],
    "unpricedSymbols": ["AAPL"]
  },
  "modelVersions": { "compound": "compound-v1", "monteCarlo": "montecarlo-v1" },
  "generatedAt": "2026-10-24T09:30:00.000Z",
  "notes": ["内部转账与投资转换不计入收入或支出"]
}
```

- `completeness` 只要有任一项为空缺，`isComplete = false`，前端必须显式提示，不能只在角标里藏一个图标。
- 报表数据中不得出现没有 `basis` 支撑的数字。

### 6.8 财务自由口径

| 指标 | 定义 | 边界 |
|------|------|------|
| 年化支出 | 最近 12 个完整月的支出合计 ÷ 实际月数 × 12 | 实际月数 < `FI_MIN_EXPENSE_MONTHS`（默认 6）时返回 `null` |
| 财务自由目标资产 | 年化支出 ÷ 提取率 | 提取率默认 4%，范围 2%–10% |
| 完成度 | 可投资资产 ÷ 财务自由目标资产 | 可投资资产 = 非负债账户余额 + 证券市值；账本外资产（如自住房）天然不计，不做额外剔除 |
| 覆盖月数 | 可投资资产 ÷ 月均支出 | 支出为 0 时返回 `null`，不返回 Infinity |
| 安全边际 | (可投资资产 − 目标资产) ÷ 目标资产 | 可为负 |
| 敏感性网格 | 提取率（3 档）× 年化支出（×0.8 / ×1.0 / ×1.2）3×3 矩阵，每格给出目标资产与完成度 | 只展示，不给结论 |

- 月均支出 = 年化支出 ÷ 12（与年化同一口径，不用不同分母）。
- 支出口径复用 Phase 3：排除内部转账、信用卡还款与投资转换。
- 返回结构固定包含 `unavailableReasons`，数据不足时不返回 0。

---

## 七、目标引擎规范（`modules/goals/goal.engine.ts`）

### 7.1 定位

纯函数：输入目标定义、资金快照与预测假设，输出进度、缺口、达成时间与预测。**不访问数据库、不读时钟**，便于单元测试。

```ts
export interface GoalProgressInput {
  targetAmount: number;
  currentAmount: number;
  initialAmount: number;
  targetDate: string | null;
  startedAt: string;
}

export interface GoalProgressResult {
  currentAmount: number;
  targetAmount: number;          // 已按通胀调整
  progress: number;              // 未封顶
  gap: number;
  isAchieved: boolean;
  monthsRemaining: number | null;
}
```

### 7.2 交叉验证不变式（必须写成测试）

| 不变式 | 含义 |
|--------|------|
| **同数据一致** | 同一 as-of 时刻，目标进度与净资产接口（`net_worth` 口径）完全相等 |
| **零收益反推正确** | `R = 0`、`f = 0`、`i = 0` 时，`requiredMonthly = (T − V0) / n`（误差 ≤ 0.01 元） |
| **反推与外推互逆** | 用反推得到的月供重新跑复利引擎，到期值与目标金额误差 ≤ 0.01 元 |
| **单调性** | 月供增加时到期值不减；收益增加时所需月供不增 |
| **达成边界** | `currentAmount ≥ targetAmount` 时 `gap = 0`、`isAchieved = true`、`requiredMonthly = 0` |
| **无解返回 null** | 期限已过、负收益且无月供时，`etaMonths === null` 且带原因码 |
| **通胀调整可逆** | 关闭通胀调整时目标金额恒等于 `targetAmount` |

---

## 八、D1 — 目标模型与进度

### 8.1 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/goals` | 目标列表（含进度摘要、可按状态筛选） |
| POST | `/api/goals` | 创建目标 |
| GET | `/api/goals/:id` | 目标详情（含进度、绑定资金信息） |
| PATCH | `/api/goals/:id` | 修改目标（类型与绑定方式可改，历史进度随之重算） |
| DELETE | `/api/goals/:id` | 删除目标（仅删除目标本身，不动账本） |
| GET | `/api/goals/:id/progress` | 当前进度与缺口 |
| GET | `/api/goals/:id/history` | 按月重算的进度曲线 |
| GET | `/api/goals/summary` | 活跃目标汇总 |

> **路由顺序**：`/summary` 必须注册在 `/:id` 之前。Phase 2/3/4/5 均踩过这个坑。

### 8.2 创建请求

```jsonc
// POST /api/goals
{
  "name": "孩子教育金",
  "type": "education",
  "targetAmount": "800000.000000",
  "currency": "CNY",
  "targetDate": "2035-09-01",
  "startedAt": "2026-10-24",
  "initialAmount": "50000.000000",
  "inflationAdjusted": true,
  "inflationRate": "0.025",
  "expectedAnnualReturn": "0.06",
  "monthlyContribution": "3000.000000",
  "fundingSource": "account",
  "accountId": "...",
  "priority": 1,
  "note": "每年学费按 2.5% 上涨"
}
```

- `fundingSource = account` 时 `accountId` 必填且账户属于当前用户、启用中、币种一致；否则 `GOAL_FUNDING_INVALID` 422。
- `fundingSource = portfolio` 时 `portfolioId` 同样校验，含归档状态。
- `inflationAdjusted = true` 必须有 `targetDate` 与 `inflationRate`，否则 `GOAL_PARAMETERS_INVALID` 422。
- 同一用户同名 → `GOAL_NAME_EXISTS` 409。
- 活跃目标超过 `GOAL_MAX_COUNT` → `GOAL_LIMIT_EXCEEDED` 422。

### 8.3 进度响应

```jsonc
// GET /api/goals/:id/progress
{
  "goalId": "...",
  "asOf": "2026-10-24T00:00:00.000Z",
  "currentAmount": "185000.000000",
  "targetAmount": "845600.000000",       // 已按通胀调整
  "originalTargetAmount": "800000.000000",
  "progress": "0.218780",
  "gap": "660600.000000",
  "isAchieved": false,
  "achievedAt": null,
  "funding": { "source": "account", "accountId": "...", "available": true },
  "monthlyContribution": "3000.000000",
  "currency": "CNY"
}
```

- `progress` 不封顶；前端展示时按 100% 封顶并保留真实值。
- `funding.available = false` 时 `currentAmount = null`，并给出原因（账户归档、组合归档）。

### 8.4 汇总响应

```jsonc
// GET /api/goals/summary
{
  "activeCount": 4,
  "totalTarget": "3200000.000000",
  "totalCurrent": "980000.000000",
  "totalGap": "2220000.000000",
  "requiredMonthlyTotal": "8600.000000",
  "investableSurplus": "5200.000000",     // 来自 Phase 3 的可投资结余
  "shortfall": "3400.000000",
  "surplusBasis": { "months": 6, "source": "analytics", "isComplete": false },
  "currency": "CNY"
}
```

- 可投资结余取最近完整月份的平均结余，样本不足时 `investableSurplus = null` 并标注 `insufficient_savings_data`。
- `shortfall` 为负表示结余足以覆盖，前端文案必须区分「够」与「不够」，不能用同一个颜色。

### 8.5 验收

- [ ] 目标进度与净资产接口在同一时刻完全一致（`net_worth` 口径）
- [ ] 修改绑定账户后进度立即变化，无需任何刷新任务
- [ ] 绑定归档账户/组合时进度为 `null` 并标记不可用，而不是 0
- [ ] 跨用户访问目标一律 404
- [ ] 同名目标 409，超过数量上限 422
- [ ] 删除目标不影响账本、净资产与任何报表


---

## 九、D2 — 目标预测与反推

### 9.1 接口

```jsonc
// POST /api/goals/:id/projection
{
  "expectedAnnualReturn": "0.06",     // 可覆盖目标上的默认值
  "monthlyContribution": "3000.000000",
  "feeRate": "0.003",
  "includeProbabilistic": true
}
```

- 全部参数可选；缺省时使用目标上的值。
- `includeProbabilistic = true` 时才去查匹配的蒙特卡罗运行，避免不必要的扫描。
- 该接口**只读**，不创建模拟运行、不写任何表。

### 9.2 响应

见 6.4 的 `GoalProjection`。补充：

```jsonc
{
  "etaMonths": 58,
  "etaDate": "2031-08-31",
  "projectedValue": "862400.000000",
  "timeline": [ { "month": "2026-11", "value": "188000.000000" } ],   // 最多 60 点
  "assumptions": {
    "engine": "compound-v1",
    "contributionTiming": "end",
    "inflationAdjusted": true,
    "inflationRate": "0.025"
  }
}
```

- `timeline` 按年抽样（首年按月、之后按年），避免 600 个点塞满响应。
- 响应必须带 `assumptions`，前端在预测卡片旁固定展示，不得折叠隐藏。

### 9.3 概率匹配规则（必须写成测试）

一次运行被认定为「匹配」，需同时满足：

1. 同一用户、同一币种。
2. `assumptions.targetAmount` 与目标当前**调整后**金额完全相等（6 位小数）。
3. `years` 与目标剩余年限一致（按目标日期与今天计算，允许 ±0，不做取整容忍）。
4. `status = 'succeeded'`。
5. 若存在多条，取 `createdAt` 最新的一条。

不满足时 `probabilistic = null`，`unavailableReasons` 包含 `no_matching_run`，并在 `matchedExpected` 中返回「需要什么样的运行」供前端引导用户去创建：

```jsonc
"matchedExpected": { "targetAmount": "845600.000000", "years": 9, "currency": "CNY" }
```

> 这是本阶段最重要的一条口径约束：宁可显示「暂无匹配的模拟」，也不把不相干运行的概率贴到目标上。

### 9.4 验收

- [ ] `requiredMonthly` 代入复利引擎后到期值与目标误差 ≤ 0.01 元
- [ ] `R = 0` 时的反推等于线性摊分
- [ ] 目标已达成时 `requiredMonthly = 0`、`etaMonths = 0`
- [ ] 期限已过或负收益无解时返回 `null` 与原因码，不返回 600 或极大数值
- [ ] 不同目标金额的运行不被匹配（构造两条运行验证）
- [ ] 调用预测接口后，`reports` / `financial_goals` / 模拟运行表均无新增或修改

---

## 十、D3 — 财务自由

### 10.1 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/financial-independence/overview` | 当前指标与敏感性网格 |
| POST | `/api/financial-independence/calculate` | 按自定义参数试算（不保存） |

### 10.2 请求与响应

```jsonc
// POST /api/financial-independence/calculate
{
  "annualExpense": "180000.000000",   // 可选，缺省按分析层年化
  "withdrawalRate": "0.04",
  "expectedAnnualReturn": "0.06",
  "inflationRate": "0.025"
}

// 响应
{
  "annualExpense": "180000.000000",
  "expenseBasis": { "months": 12, "from": "2025-10-01", "to": "2026-09-30", "isComplete": true },
  "withdrawalRate": "0.040000",
  "targetAssets": "4500000.000000",
  "investableAssets": "1980000.000000",
  "progress": "0.440000",
  "coverageMonths": "132.000000",
  "safetyMargin": "-0.560000",
  "sensitivity": {
    "expenseScale": ["0.800000", "1.000000", "1.200000"],
    "withdrawalRates": ["0.030000", "0.040000", "0.050000"],
    // 行对应提取率，列对应支出缩放；每格给出目标资产
    "cells": [
      [ { "targetAssets": "4800000.000000" }, { "targetAssets": "6000000.000000" }, { "targetAssets": "7200000.000000" } ],
      [ { "targetAssets": "3600000.000000" }, { "targetAssets": "4500000.000000" }, { "targetAssets": "5400000.000000" } ],
      [ { "targetAssets": "2880000.000000" }, { "targetAssets": "3600000.000000" }, { "targetAssets": "4320000.000000" } ]
    ]
  },
  "unavailableReasons": [],
  "disclaimers": ["withdrawal_rate_is_scenario_only", "past_expense_not_future_expense"]
}
```

- 提取率越界（< 0.02 或 > 0.10）→ `FI_PARAMETERS_INVALID` 422。
- 支出样本不足 → `annualExpense`、`targetAssets`、`progress`、`coverageMonths`、`safetyMargin` 全部为 `null`，`unavailableReasons` 含 `insufficient_expense_months`。
- `disclaimers` 由语言文件提供键，前端渲染；接口只给键，不给硬编码文案。
- 该接口永远不返回「可以退休」这类结论性字段。

### 10.3 验收

- [ ] 年化支出与 Phase 3 现金流报表的同一区间支出合计一致（误差 ≤ 1 元）
- [ ] 内部转账、信用卡还款与投资转换不计入支出
- [ ] 支出为 0 时 `coverageMonths = null`，不是 Infinity 或 0
- [ ] 样本不足时所有派生指标为 `null` 且原因码齐全
- [ ] 敏感性网格三档提取率与三档支出的目标资产符合 `支出 ÷ 提取率` 关系
- [ ] 调用后不产生任何写操作

---

## 十一、D4 — 报表引擎与快照

### 11.1 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/reports` | 报表列表（类型、区间、生成时间、行数） |
| POST | `/api/reports` | 按通用参数生成报表 |
| GET | `/api/reports/:id` | 报表元数据与 `basis` |
| GET | `/api/reports/:id/data` | 冻结数据 |
| POST | `/api/reports/:id/regenerate` | 用原参数重新生成，**覆盖该条记录的快照**并更新 `generatedAt` |
| DELETE | `/api/reports/:id` | 删除报表 |
| POST | `/api/reports/net-worth` | 资产负债报表 |
| POST | `/api/reports/cashflow` | 现金流量报表 |
| POST | `/api/reports/analytics` | 收支分类与商户报表 |
| POST | `/api/reports/investment` | 投资绩效报表 |
| POST | `/api/reports/goals` | 目标进度报表 |
| POST | `/api/reports/simulation` | 模拟分析报表 |

> `/api/reports/:id/regenerate` 与 `/:id` 同级，需在注册顺序上先于通配的详情路由；分类生成接口是固定路径，必须在 `/:id` 之前注册。

### 11.2 生成流程

```
校验参数（区间、类型、账户范围）
  → 加载数据（只读，复用 Phase 3/4/5 的服务函数）
  → 计算指标与明细
  → 组装 basis（含完整性）
  → 检查 rowCount ≤ REPORT_MAX_ROWS
  → 写入 reports(data / basis / rowCount / modelVersions)
  → 触发保留策略（保留最新 100 份）
```

- 生成失败不写半成品：`data` 与 `basis` 在同一个 `create` 中写入。
- `rowCount` 超限 → `REPORT_TOO_LARGE` 422，提示缩小区间；不截断后静默保存。
- 区间超过 `ANALYTICS_MAX_RANGE_DAYS` → `REPORT_RANGE_INVALID` 400。

### 11.3 各类型数据形状

#### net_worth

```jsonc
{
  "asOf": "2026-10-24",
  "accounts": [
    { "accountId": "...", "name": "招商银行", "type": "bank", "currency": "CNY",
      "balance": "120000.000000", "baseBalance": "120000.000000", "isLiability": false }
  ],
  "securities": [
    { "portfolioId": "...", "name": "长期组合", "marketValue": "520000.000000",
      "priceDate": "2026-10-20", "isStale": false }
  ],
  "totals": { "assets": "...", "liabilities": "...", "netWorth": "...", "securitiesValue": "..." }
}
```

#### cashflow

```jsonc
{
  "points": [
    { "period": "2026-09", "income": "...", "expense": "...", "net": "...", "isComplete": true }
  ],
  "totals": { "income": "...", "expense": "...", "net": "...", "savingsRate": "0.312000" },
  "transferTotal": "..."
}
```

- `savingsRate` 在收入为 0 时为 `null`；`isComplete = false` 的月份必须带 `missingDays` 或 `reason`。

#### analytics

```jsonc
{
  "byCategory": [ { "categoryId": "...", "name": "餐饮", "kind": "expense", "amount": "...", "share": "0.184000" } ],
  "byMerchant": [ { "merchant": "星巴克", "amount": "...", "count": 12 } ],
  "uncategorized": { "count": 3, "amount": "..." },
  "coverage": { "categorizedRatio": "0.982000" }
}
```

#### investment

```jsonc
{
  "portfolios": [
    { "portfolioId": "...", "name": "长期组合", "costBasis": "...", "marketValue": "...",
      "realizedPnl": "...", "unrealizedPnl": "...", "twr": "0.083000", "xirr": "0.071000",
      "twrUnavailableReason": null, "valuationDate": "2026-10-20", "isStale": false }
  ],
  "allocation": [ { "dimension": "asset_class", "key": "etf", "weight": "0.620000", "marketValue": "..." } ]
}
```

- TWR/XIRR 不可计算时返回 `null` 并在 `twrUnavailableReason` / `xirrUnavailableReason` 给原因码，与 Phase 4 一致。

#### goals

```jsonc
{
  "goals": [
    { "goalId": "...", "name": "教育金", "type": "education", "targetAmount": "...",
      "currentAmount": "...", "progress": "0.218780", "gap": "...",
      "etaMonths": 58, "requiredMonthly": "3000.000000",
      "probability": null, "probabilityUnavailableReason": "no_matching_run" }
  ],
  "summary": { "activeCount": 4, "totalGap": "...", "requiredMonthlyTotal": "..." }
}
```

#### simulation

```jsonc
{
  "compound": [
    { "scenarioId": "...", "name": "长期定投", "finalNominalValue": "...", "totalContributed": "...",
      "modelVersion": "compound-v1" }
  ],
  "monteCarlo": [
    { "runId": "...", "scenarioName": "长期定投", "seed": 20261023, "pathCount": 5000, "years": 20,
      "terminal": { "p10": "...", "p50": "...", "p90": "..." },
      "probabilities": { "loss": "...", "target": null, "ruin": "..." },
      "modelVersion": "montecarlo-v1",
      "resultDisclaimer": "simulation_not_forecast" }
  ]
}
```

> 模拟报表必须把「模拟」与「真实」分块呈现，且每块带 `modelVersion` 与免责声明键。合并成一张「预期收益」表是本阶段禁止的做法。

### 11.4 保留策略

- 每用户保留最新 `REPORT_RETENTION`（默认 100）份报表，超出删除最旧的。
- 删除在单事务内完成，且只删 `reports` 行，不影响任何其他表。
- 被删除的报表在列表自然消失，下载返回 404。

### 11.5 审计事件

| 事件 | 记录内容 |
|------|---------|
| `goal.created` | 目标 ID、类型、绑定方式、币种 |
| `goal.updated` | 目标 ID、变更字段名 |
| `goal.deleted` | 目标 ID |
| `goal.achieved` | 目标 ID、达成日期 |
| `report.generated` | 报表 ID、类型、区间、行数 |
| `report.regenerated` | 报表 ID、类型、新的 `generatedAt` |
| `report.exported` | 报表 ID、格式、行数 |
| `report.deleted` | 报表 ID |

> 与前端阶段一致：只记标识与计数，不记金额、目标名与报表内容。

### 11.6 验收

- [ ] 报表生成后修改账本，`/data` 返回值不变（快照冻结）
- [ ] `regenerate` 后 `generatedAt` 更新且数据反映最新账本
- [ ] 超出行数上限返回 422，且不写入半成品记录
- [ ] 区间超限返回 400
- [ ] 缺失汇率、缺失估值、缺月份均在 `basis.completeness` 中体现
- [ ] 模拟报表的「真实」与「模拟」两区块各自带 `modelVersion`
- [ ] 报表生成不改动账本、组合、模拟运行中的任何一行

---

## 十二、D5 — 报表与应用导出

### 12.1 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/reports/:id/download?format=csv` | 下载 CSV |
| GET | `/api/reports/:id/download?format=xlsx` | 下载 XLSX |
| GET | `/api/simulations/monte-carlo/:id/export?format=json` | 导出模拟方案（含参数与最近运行摘要） |
| GET | `/api/simulations/monte-carlo/:id/runs/:runId/export?format=csv` | 导出单次运行结果（含假设与模型版本） |
| GET | `/api/simulations/compound/:id/export?format=csv` | 导出复利方案与年度明细 |

> `format` 缺省：报表为 `csv`，模拟运行为 `csv`，方案为 `json`。未知格式 → `REPORT_FORMAT_UNSUPPORTED` 415。

### 12.2 CSV 规范

| 项 | 规则 |
|---|------|
| 编码 | UTF-8，**带 BOM**（`﻿`） |
| 分隔符 | 逗号 |
| 换行 | `\r\n`（RFC 4180） |
| 转义 | 含 `,` / `"` / `\r` / `\n` 的字段用双引号包裹，内部双引号翻倍 |
| 公式注入 | 以 `=`、`+`、`-`、`@`、制表符、回车开头的单元格前置单引号 `'` |
| 数值 | 原始 6 位小数，不加千分位、不加币种符号 |
| 空值 | 空字符串，不写 `null` / `NaN` |
| 表头 | 第一行，列名来自语言文件对应的固定键 |
| 口径 | 最后追加 `basis` 说明区块，前面以空行分隔 |

> 「以 `-` 开头的数值」是常见误伤点：负数必须保留负号。规则是**只有非数值字符串**才加前缀单引号；判定前先尝试按数值解析，能解析为数值则不加。

### 12.3 XLSX 规范

- 使用既有 `xlsx`（SheetJS），不新增依赖。
- 每个报表至少两个 sheet：`摘要` 与 `明细`；投资与目标报表额外带 `附录`（口径与假设）。
- 单元格类型：金额与比率写为数值（`t: 'n'`），比率保留 6 位小数；文本写为字符串。
- 列宽按内容估算并设上限，避免超宽列。
- 不在单元格中写公式字符串；公式注入防护同样生效。

### 12.4 文件名与响应头

```
Content-Type: text/csv; charset=utf-8
Content-Disposition: attachment; filename="report-cashflow-2025-01-01-2025-12-31.csv"; filename*=UTF-8''<percent-encoded>
```

- `filename` 使用 ASCII 安全名；`filename*` 带中文标题（RFC 5987 百分号编码）。
- 文件名中去除路径分隔符与控制字符，长度上限 120 字符。

### 12.5 行数上限

- `REPORT_MAX_ROWS`（默认 50,000）同时约束报表生成与导出。
- 超限 → `REPORT_TOO_LARGE` 422，`details.rows` 与 `details.maxRows` 一并返回。
- 同步导出的时间预算为 3 秒；超过 `EXPORT_TIMEOUT_MS` 视为实现缺陷而非用户错误，需优化查询而不是无限等待。

### 12.6 模拟结果导出必须包含的字段

| 字段 | 说明 |
|------|------|
| `scenarioName` / `seed` / `pathCount` / `years` | 可复现的最小信息集 |
| `modelVersion` | 脱离它结果不可解读 |
| `assumptions` | 完整参数快照 |
| `terminal` / `probabilities` / `drawdown` | 结果主体 |
| `deterministic` | 压力情景标记 |
| `disclaimers` | 免责声明键 |

> Phase 5 已明确「导出需说明结果不可脱离 modelVersion 解读」，本阶段导出文件首行必须是模型版本与种子，缺一不可。

### 12.7 验收

- [ ] Windows Excel 打开 CSV 中文不乱码
- [ ] 含逗号、引号、换行的字段导出后重新解析完全一致
- [ ] `=SUM(A1:A2)` 形式的分类名导出后不被当作公式
- [ ] 负数保持负号，不被注入防护误伤
- [ ] 中文标题在 `filename*` 中正确编码，浏览器保存后文件名不乱码
- [ ] XLSX 的金额列可在 Excel 中直接求和
- [ ] 导出不产生任何写操作（除审计日志）
- [ ] 超过行数上限返回 422 且包含实际行数与上限

---

## 十三、D6 — 前端目标与报表页

### 13.1 路由与导航

- 新增 `/goals`（目标 + 财务自由视图）与 `/reports`（报表列表与生成）。
- 侧边栏在「风险模拟」之后新增「财富目标」，再新增「财务报表」；图标使用 `lucide-react` 的 `Target` 与 `FileText`。
- 导航项分别受 `capabilities.available.includes('goals')` 与 `includes('reports')` 控制。
- 财务自由不单独占菜单，作为目标页的第二个视图（Tab），避免侧边栏继续膨胀。

### 13.2 页面结构

```
/goals
├── 顶部：汇总卡（总目标、当前、缺口、所需月供合计 vs 可投资结余）
├── Tab 1 目标列表
│     ├── 每项：名称、类型徽标、进度环、缺口、状态
│     ├── 筛选：全部 / 进行中 / 已达成 / 已归档
│     └── 新建目标
├── Tab 2 目标详情（选中后）
│     ├── 进度环 + 当前/目标/缺口
│     ├── 历史进度曲线（按月的实际 vs 目标线）
│     ├── 预测卡：复利点估计（预计达成时间、所需月供）
│     ├── 概率卡：来自匹配运行的概率与区间，或「暂无匹配的模拟」引导
│     └── 编辑 / 归档 / 删除
└── Tab 3 财务自由
      ├── 年化支出、目标资产、完成度、覆盖月数、安全边际
      ├── 提取率滑块与敏感性网格
      └── 固定免责声明

/reports
├── 左栏：报表列表（类型、区间、生成时间、行数）
├── 右栏：生成面板（类型、区间、维度、账户范围）
├── 预览区：摘要指标 + 明细表（分页）
└── 操作：下载 CSV / 下载 XLSX / 重新生成 / 删除
```

### 13.3 组件

```
components/goals/
├── GoalList.tsx              目标列表与状态筛选
├── GoalForm.tsx              创建/编辑（类型、金额、期限、绑定、假设）
├── GoalProgressRing.tsx      进度环（封顶 100%，悬停显示真实值）
├── GoalHistoryChart.tsx      月度进度曲线 + 目标线
├── GoalProjectionCard.tsx    复利点估计与所需月供
├── GoalProbabilityCard.tsx   匹配运行的概率与区间，含不匹配引导
├── GoalSummaryCards.tsx      汇总卡与结余对比
├── FinancialIndependencePanel.tsx  指标 + 提取率 + 敏感性网格
└── GoalEmptyState.tsx        无目标时的引导

components/reports/
├── ReportList.tsx            报表列表
├── ReportBuilder.tsx         类型/区间/维度选择与生成
├── ReportPreview.tsx         摘要 + 明细表
├── ReportBasisNotice.tsx     口径与完整性提示（缺失项必须显式列出）
├── ReportDownloadMenu.tsx    CSV / XLSX 下载
└── ReportEmptyState.tsx      无报表时的引导
```

### 13.4 交互与口径展示

- 目标页顶部固定展示币种与 as-of 时间；跨币种目标不存在（创建时即校验）。
- 预测卡与概率卡在视觉上必须**并列且分色**，标题分别写明「按固定收益率推算」与「按随机模拟推算」，不得共用一个「预计」字样。
- 概率不可用时显示「暂无匹配的模拟，去创建一个目标金额为 845,600 元、期限 9 年的模拟」，并提供跳转到风险模拟页的按钮。
- 财务自由页不出现「可以退休」「已达成」这类结论性文案，只展示指标与声明。
- 报表预览顶部固定展示 `basis`，`isComplete = false` 时以警示色列出缺失项。
- 下载按钮在点击后明确提示「已生成 N 行」，避免用户以为点了没反应。

### 13.5 移动端

- 375px 宽度下：汇总卡改为两列网格；目标列表改为卡片式；历史曲线高度压缩至 180px。
- 敏感性网格在窄屏改为纵向列表，表头固定。
- 报表明细表在窄屏只显示前 4 列，其余列通过「展开」查看，不引入整页横向滚动。
- 下载菜单使用原生 `<a download>` 触发，避免移动端弹窗拦截。

### 13.6 验收

- [ ] 无目标时展示引导而不是空图表
- [ ] 绑定归档账户时目标卡片明确标注「资金不可用」，不显示 0%
- [ ] 预测卡与概率卡视觉上不可混淆，且各自标注来源
- [ ] 概率不可用时有明确引导与跳转
- [ ] 报表缺失项在预览顶部显式列出
- [ ] 中英文切换后无残留硬编码文案
- [ ] 375px 下无整页横向滚动

---

## 十四、D7 — i18n、测试与交付

### 14.1 i18n

- 新增命名空间 `goals` 与 `reports`，`zh-CN` 与 `en-US` 键完全对齐。
- `enums` 增补：`goal_type`、`goal_status`、`goal_funding_source`、`report_type`、`report_format`。
- `errors` 增补第十五节全部错误码。
- 免责声明、原因码文案、口径说明全部放语言文件，禁止硬编码。
- 导航注册：`nav:goals`、`nav:reports`。

### 14.2 测试

| 层级 | 覆盖 |
|------|------|
| 单元 | 进度计算（三种绑定口径）、通胀调整、达成时间月粒度重算、二分反推单调性与精度、达成边界、ETA 上限、年化支出口径、覆盖月数与 null、敏感性网格符合支出 ÷ 提取率、CSV 转义（逗号/引号/换行）、公式注入前缀与负数例外、BOM、文件名编码 |
| 集成 | 目标 CRUD 与重名 409、数量上限 422、跨用户 404、绑定账户/组合校验、进度与净资产一致、预测概率匹配规则（同目标金额、同年限、最新成功）、概率不匹配返回 null 与原因、财务自由样本不足、报表六类生成、快照冻结、重新生成、行数上限 422、区间上限 400、下载 CSV/XLSX 内容与编码、越权下载 404、模拟导出含 modelVersion 与 seed、报表保留 100 份 |
| 回归 | Phase 1–5 全部测试通过；无目标与报表时 Dashboard、净资产、分析、预算、投资、复利、风险模拟页响应完全不变；`/api/system/capabilities` 中 `goals` 与 `reports` 从 `planned` 移至 `available` |
| 口径对齐 | 目标进度与净资产同源；目标报表中的进度与详情接口一致；报表生成、导出、预测三类操作前后账本与组合零变化 |

### 14.3 文档

- [ ] README 增加「财富目标」与「财务报表」章节：进度口径、预测分源原则、报表快照语义、导出编码规则
- [ ] `docs/API接口全面分析.md` 第 18、19 节标记为已实现，并按本计划修正接口清单
- [ ] `docs/项目目录结构.md` 增补 `modules/goals`、`modules/reports`、前端页面与组件
- [ ] 演示数据脚本增补 3 个目标（进行中、已达成、绑定组合）与 2 份报表，使演示账号下有可看数据
- [ ] 在 Phase 1–5 计划中「Phase 6 目标与报告」的表述处补注本计划的实际范围（PDF 与备份恢复不在本阶段）
- [ ] 明确记录「达成时间按月重算」与「导出同步执行、行数上限」两处边界

---

## 十五、接口清单与错误码

### 15.1 接口清单汇总

| 模块 | 接口数 | 所属阶段 |
|------|--------|----------|
| 目标 CRUD 与进度历史 | 7 | D1 |
| 目标汇总 | 1 | D1 |
| 目标预测 | 1 | D2 |
| 财务自由 | 2 | D3 |
| 报表通用与生成 | 12 | D4 |
| 报表下载 | 1 | D5 |
| 模拟与复利导出 | 3 | D5 |
| **合计新增** | **27** | |

> 实现核对：目标与财务自由 11 个、报表 13 个、模拟与复利导出 3 个 = 27 个，与计划一致。

> 相比前五阶段实际累计的 181 个接口（Phase 5 计划写 183，路由合并后为 16 个新增），本阶段新增 27 个；全项目累计 208 个。

### 实现说明（与计划的差异）

| 项 | 计划 | 实际实现 | 原因 |
|---|---|---|---|
| 目标数量上限校验时机 | 未明确 | 创建时统计 `active + achieved` 数量 | 已归档目标不占额度，否则归档失去意义 |
| 达成状态维护 | 未明确 | 预测接口调用前重算一次并写回 `status` / `achievedAt` | 避免列表徽标与实际进度长期不一致 |
| 净值口径的目标进度 | 未明确 | 用「当前净资产 − 起算日净资产 + 起算金额」 | 用绝对值会让目标创建前就存在的房贷把进度拉成负数 |
| 目标汇总的跨币种 | 未明确 | 跨币种目标不并入合计，只进 `unavailableGoalIds` | 缺目标汇率口径时混加会得到一个无法解释的总额 |
| 可投资结余样本门槛 | 计划写「最近完整月份」 | 取最近 6 个完整月，少于 3 个返回 `null` | 少于 3 个月的平均结余波动过大，会给出误导性对比 |
| 概率匹配的币种来源 | 计划写「同一币种」 | 读方案的 `currency`，不读快照 | 快照未存币种，方案币种是唯一可靠来源 |
| 月供反推的精度断言 | 计划写「误差 ≤ 0.01 元」 | 断言「不欠账且溢出不超过一个月供」 | 月供按分向上取整，120 个月会累积出几元溢出，0.01 元不可达 |
| 报表生成分类路由 | 计划列 6 个分类接口 | 用同一套 schema 生成，注册在 `/:id` 之前 | 避免六份几乎相同的处理逻辑漂移 |
| 报表预览的数值精度 | 未明确 | 金额 2 位、比率 4 位，接口仍返回 6 位原值 | 表格里出现 `999,090.375958` 是噪声，不是精度 |
| 模拟导出路由位置 | 计划归入报表模块 | 独立 `simulations/simulation-export.routes.ts` | 数据来自模拟表本身，不落报表快照 |
| 演示数据 | 「增补 3 个目标与 2 份报表」 | 直接调用目标/报表服务与引擎生成 | 保证演示数字与真实口径一致，不写死；同时把流水延到 13 个月让财务自由有 12 个完整月 |

### 15.2 新增错误码

| 错误码 | HTTP | 说明 |
|--------|------|------|
| `GOAL_NOT_FOUND` | 404 | 目标不存在或不属于当前用户 |
| `GOAL_NAME_EXISTS` | 409 | 同一用户下目标名重复 |
| `GOAL_PARAMETERS_INVALID` | 422 | 目标参数越界或自相矛盾（如无期限却开启通胀调整） |
| `GOAL_FUNDING_INVALID` | 422 | 绑定账户/组合不存在、已归档或币种不一致 |
| `GOAL_LIMIT_EXCEEDED` | 422 | 活跃目标超过数量上限 |
| `GOAL_PROJECTION_UNAVAILABLE` | 409 | 无法预测（缺少收益率假设且未提供替代参数） |
| `FI_PARAMETERS_INVALID` | 422 | 提取率或自定义支出越界 |
| `REPORT_NOT_FOUND` | 404 | 报表不存在或不属于当前用户 |
| `REPORT_TYPE_UNSUPPORTED` | 422 | 未知报表类型 |
| `REPORT_PARAMETERS_INVALID` | 422 | 报表参数非法（如区间颠倒） |
| `REPORT_RANGE_INVALID` | 400 | 区间超出允许范围 |
| `REPORT_TOO_LARGE` | 422 | 明细行数超过上限，`details.rows` / `details.maxRows` 给出实际值 |
| `REPORT_FORMAT_UNSUPPORTED` | 415 | 不支持的导出格式 |

> 越权访问一律 404（`GOAL_NOT_FOUND` / `REPORT_NOT_FOUND`），与前五阶段一致。
> 数据不足（支出样本、匹配运行、TWR/XIRR）**不产生错误**，一律返回 `null` + 原因码。

---

## 十六、技术依赖

### 后端

**不新增依赖。**

- 目标进度、预测、ETA 与反推全部复用 Phase 1 `simulate()`；不复制复利公式。
- 财务自由复用 Phase 3 的现金流口径与 Phase 4 的净资产口径。
- CSV 序列化为项目内小模块（转义、BOM、注入防护），不引入 CSV 库；既有 `csv-parse` 仅用于解析。
- XLSX 使用既有 `xlsx`（SheetJS），与账单导入同一版本。
- 概率数据直接读 Phase 5 的 `monte_carlo_runs.result`，不重算。

> 不引入 PDF 库（`pdfkit` / `puppeteer`）的完整理由见第五节决策 17；若未来需要 PDF，应为独立阶段，并评估字体体积与容器镜像大小。

### 前端

**不新增依赖。**

- 图表用既有 `echarts` + `echarts-for-react`（进度曲线、敏感性热力可选）。
- 表单与请求用既有 `react-hook-form` + TanStack Query。
- 下载使用原生 `<a download>` 与 `fetch` + `Blob`，不引入下载库。

---

## 十七、环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `GOAL_MAX_COUNT` | `50` | 单用户活跃目标上限 |
| `GOAL_MAX_REQUIRED_MONTHLY` | `1000000` | 反推月供的合理性上限，超过视为无解 |
| `GOAL_PROJECTION_MAX_MONTHS` | `600` | 预测与 ETA 的最大月数（50 年） |
| `GOAL_HISTORY_MAX_MONTHS` | `120` | 进度历史的最大重算月数 |
| `FI_DEFAULT_WITHDRAWAL_RATE` | `0.04` | 默认安全提取率 |
| `FI_MIN_WITHDRAWAL_RATE` | `0.02` | 提取率下限 |
| `FI_MAX_WITHDRAWAL_RATE` | `0.10` | 提取率上限 |
| `FI_MIN_EXPENSE_MONTHS` | `6` | 年化支出的最小月数 |
| `REPORT_MAX_ROWS` | `50000` | 报表生成与导出的行数上限 |
| `REPORT_RETENTION` | `100` | 每用户保留的最新报表数 |
| `EXPORT_TIMEOUT_MS` | `3000` | 同步导出的时间预算（用于告警，非中断） |
| `REPORT_TITLE_MAX_LENGTH` | `120` | 报表标题长度上限 |

> 全部写入 `src/config/constants.ts`，并在 `/api/system/capabilities` 的 `goalLimits`、`fiLimits`、`reportLimits` 中暴露，供前端做输入校验与提示。不新增外部服务。

---

## 十八、验证清单

### D1

- [ ] 目标进度与净资产接口在同一 as-of 完全一致
- [ ] 修改历史流水后进度立即变化，无需刷新任务
- [ ] 绑定归档账户/组合时进度为 `null` 且原因可见
- [ ] 达成时间按月重算，且报告中标注颗粒度
- [ ] 进度跌破 100% 后状态回 `active` 但 `achievedAt` 保留
- [ ] 同名 409、超上限 422、跨用户 404

### D2

- [ ] `requiredMonthly` 回代复利引擎误差 ≤ 0.01 元
- [ ] `R = 0` 时反推等于线性摊分
- [ ] 目标已达成时月供为 0、ETA 为 0
- [ ] 无解时返回 `null` 与原因码，不返回上限值
- [ ] 概率只来自同目标金额、同年限、最新的成功运行
- [ ] 预测接口零写入

### D3

- [ ] 年化支出与现金流报表同区间合计一致
- [ ] 内部转账与投资转换不计入支出
- [ ] 支出为 0 时覆盖月数为 `null`
- [ ] 样本不足时派生指标全部为 `null`
- [ ] 无结论性文案，只有指标与声明

### D4

- [ ] 报表快照冻结，账本变化不影响历史 `/data`
- [ ] `regenerate` 更新快照与 `generatedAt`
- [ ] 六类报表均返回完整 `basis`
- [ ] 缺失项在 `basis.completeness` 中逐项列出
- [ ] 超限 422 不写入半成品
- [ ] 模拟报表的模拟与真实分区且各带模型版本

### D5

- [ ] CSV 在 Windows Excel 中中文正常、负数正常
- [ ] 公式注入被阻断，数值以数值类型导出（XLSX 可求和）
- [ ] 文件名中文不乱码
- [ ] 模拟导出首行含 `modelVersion` 与 `seed`
- [ ] 导出零写入（除审计日志）

### D6 / D7

- [ ] 预测卡与概率卡视觉不可混淆
- [ ] 概率不可用时有引导与跳转
- [ ] 报表缺失项显式列出
- [ ] 中英文切换无残留
- [ ] 375px 无整页横向滚动
- [ ] 前五阶段全部测试通过，无目标与报表时既有页面响应不变
- [ ] `/api/system/capabilities` 中 `goals`、`reports` 在 `available`、不在 `planned`

---

## 十九、交付标准与后续衔接

### 功能交付

1. 用户可创建储蓄、购房、教育、退休、应急金、财务自由与自定义目标，并绑定净资产、账户或投资组合。
2. 用户可查看目标当前金额、完成比例、缺口与按月的进度历史曲线。
3. 用户可查看按固定收益率推算的预计达成时间与所需月供，且反推结果可回代验证。
4. 用户可看到来自匹配模拟运行的达标概率与区间；不匹配时明确显示「暂无匹配的模拟」并给出创建引导。
5. 用户可查看汇总缺口、所需月供合计与可投资结余的对比。
6. 用户可查看财务自由指标、覆盖月数与提取率敏感性，且不存在结论性判断。
7. 用户可生成净资产、现金流、收支分析、投资绩效、目标进度、模拟分析六类报表。
8. 用户可下载 CSV 与 XLSX，在 Excel 中中文正常、数字可计算、公式不执行。
9. 用户可导出蒙特卡罗方案与运行结果、复利方案，文件包含模型版本、种子与完整假设。

### 质量要求

1. 目标进度只能由账本与组合推导，接口不接受进度入参，任何手工修改流水的行为都会立即反映到进度。
2. 任何预测都分源并列：点估计来自复利引擎，区间与概率来自蒙特卡罗运行，两者永不加权合并。
3. 概率必须来自目标金额、年限、币种匹配的最近一次成功运行；不匹配返回 `null` 与原因码。
4. 报表是冻结快照，重新生成是显式动作；快照与 `basis` 同时写入，不存在只有数据没有口径的报表。
5. 缺失月份、缺失汇率、缺失估值、过期价格、不可用资金全部显式暴露，绝不以 0 或最近值填充。
6. 导出的 CSV 兼容中文 Excel，公式注入被阻断，负数不被误伤，文件名不乱码。
7. 报表生成、预测计算与导出全程只读，账本、组合、模拟运行在任何操作前后完全不变。
8. 跨用户访问一律 404；前五阶段测试全部通过，行为无回归。

### 已知取舍（需在文档与 UI 中明示）

| 取舍 | 影响 | 后续处理 |
|------|------|---------|
| 达成时间按月重算 | 实际达成可能发生在月中更早的日期 | 报告与界面标注颗粒度；若需精确到日，需逐日重放账户 |
| 目标只支持单账户绑定 | 多账户储蓄需绑定组合或改用净资产口径 | 若出现普遍需求，可引入目标分摊模型并明确「不重复计算」规则 |
| 不支持跨币种目标 | 外币目标无法直接追踪 | 需要独立目标汇率口径与历史汇率 |
| 预测依赖用户填写的收益率 | 收益率假设的好坏决定预测的可信度 | 可提供「从组合历史 TWR 反填」的建议值，但不自动采用 |
| 概率只来自已有运行 | 没跑过模拟就没有概率 | 界面给出「需要什么样的运行」的明确引导 |
| 导出同步执行 | 超大区间会被拒绝 | Phase 7 已实现异步导出：超过阈值走通用任务执行器 |
| 不做 PDF | 无法直接得到排版精美的文件 | 用浏览器打印；若需 PDF 应独立立项 |
| 报表保留 100 份 | 更早的历史会被清理 | 需要长期归档时随 Phase 7 一并设计 |
| 财务自由不判断「能否退休」 | 只给指标 | 这是产品红线：任何结论都需用户自行结合税制、地区与个人风险偏好判断 |

### 与后续阶段的衔接

| 后续阶段 | 建议内容 | 对 Phase 6 的依赖 |
|---------|---------|------------------|
| Phase 7 数据管理与运维 | 备份恢复、整体导出、管理后台、任务监控、异步导出 — 已在 `docs/plan-phase7.md` 落地 | 复用报表快照结构作为导出内容来源；备份覆盖目标与报表；通用任务执行器与 MC 执行器并列，任务面板用读模型合并 |
| 行情接入（独立小阶段） | 价格提供方、缓存、限流、复权 | 使投资报表的估值与 TWR 从「手工录价」升级为可用历史价，不改变报表结构 |
| 报表订阅与推送（独立小阶段） | 定时生成、邮件投递、投递失败重试 | 复用本阶段的生成流程与快照结构，另加调度与投递状态 |
| PDF 导出（独立小阶段） | 字体嵌入、分页、页眉页脚 | 复用冻结快照，不重新取数 |

### 需补齐的设计文档

| 文档 | 最晚需要时间 |
|------|-------------|
| 财务目标进度与预测规范（绑定口径、通胀调整、达成判定、反推算法与边界） | D1 开始前 |
| 财务报表口径规范（六类报表的字段、完整性定义、快照语义） | D4 开始前 |
| 导出格式与安全规范（CSV 转义、注入防护、编码、文件名、XLSX 类型） | D5 开始前 |
