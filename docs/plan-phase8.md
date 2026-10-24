# Phase 8 开发计划 — 数据完整性、资产与负债、账户生命周期

> **对应项目**：Comporalife（复利人生）Personal 开源个人版
> **上游计划**：`docs/plan-phase1.md`（S1–S7，v0.1.0）、`docs/plan-phase2.md`（P1–P8，v0.1.1）、`docs/plan-phase3.md`（A1–A7，v0.1.4）、`docs/plan-phase4.md`（B1–B7，v0.1.5）、`docs/plan-phase5.md`（C1–C7，v0.1.6）、`docs/plan-phase6.md`（D1–D7，v0.1.7）、`docs/plan-phase7.md`（E1–E7，v0.1.8）
> **技术栈**：沿用前七阶段：Fastify 5 + TypeScript + Prisma 6 + PostgreSQL 16 + Redis 7 + React 19 + Vite 6 + Tailwind CSS 4 + ECharts 6
> **文档版本**：v8.0-plan
> **计划交付版本**：v0.1.11
> **范围决策**：修复前七阶段交付物的数据完整性缺口 + 补上产品文档中唯一成体系缺失的模块（非交易型资产与负债）+ 打通账户生命周期（邮箱验证、注销申请）+ 站内通知 + 已实现能力的界面入口补齐 + 复利模拟参数补全；不做行情自动接入、不做附件与交易拆分、不做云端同步、不做用户物理删除

---

## 一、Phase 8 目标

> **把「已经做出来的东西真正可用」和「产品文档里承诺却无人的一块」一起补齐**

Phase 1 至 Phase 7 建成了一条完整的个人财务链路，但在交付复盘中暴露出三类问题，它们都不是「再加一个功能」，而是**已有承诺没有兑现**：

1. **备份不完整，且用户无从知道**。当前备份包采集 15 个域，遗漏了标的全部手工价格、流水与标签的关联、组合目标权重、自动分类规则、导入映射模板、账户对账记录，`includeRates` 参数存在却从未生效。包内 `notes` 只声明排除了原始账单文件和凭据——用户会认为「全量备份」真的全量。恢复后投资模块的市值、TWR、XIRR 全部失效，而且无法补回。这违背了 Phase 7 自己写下的核心原则：备份是「能原样还原」的。
2. **产品文档里有一块完整模块无人认领**。功能文档第 3 节与接口文档第 5 节定义了「非交易型资产与负债」（房产、车辆、房贷、其他负债）共 14 个接口及其估值快照。Phase 1 把贷款塞进 `Account.type = loan` 之后，后续六个阶段没有任何一个认领这一块，而 `plan-phase1.md` 的接口统计里明确写着「后续阶段新增：资产与负债 14」。这是七个阶段之间的规划断层，不是有意推迟。
3. **已实现的能力没有入口，承诺的落地环节是断的**。预算预警接口完整、前端 API 封装完整，没有任何页面调用；个人审计日志同样；管理后台的「删除审批」在前端类型里存在却无按钮，而用户侧根本没有发起删除申请的接口——审批流程只有下游没有上游；`nodemailer` 在依赖里、`SMTP_*` 在环境变量里，全项目没有一处 `sendMail`，生产环境用户永远收不到密码重置链接。

Phase 8 的五件事：

1. **让备份与导出真正完整，并把「不完整」如实说出来**。补齐遗漏的实体域，上线汇率备份，备份结构版本升到 v2 并保留对 v1 的读取能力（缺域时明确警告，而不是静默丢数据）。
2. **补上资产与负债模块**。房产、车辆、其他资产与其估值快照；房贷、消费贷、其他负债与其余额快照。它们不进复式记账，但必须进入净资产，且与账户、证券市值三方不重复计数。
3. **打通账户生命周期**。SMTP 真正发信；邮箱验证可选启用但不阻断登录；用户可发起注销申请并在冷却期内撤销；管理员审批后软删除并保留数据可追溯。
4. **让已完成的工作可见**。站内通知承载导出/备份/恢复/任务完成事件；仪表板补上预算预警与目标进度；个人审计页、预算预警卡片、管理员删除审批按钮全部落地。
5. **把复利模拟的参数补到产品文档要求的水准**。每年递增定投、提款阶段、税费、目标金额反推。引擎升版本，旧场景继续按旧版本重算，不改变历史结果。

### 核心原则

| 原则 | 说明 |
|------|------|
| **备份必须完整或明说不完整** | 新增域必须进包；确实不备份的内容（原始文件、凭据、审计日志）必须在 `notes` 与 UI 中逐项列出，不得用「全量」二字含糊带过 |
| **资产与负债不进分录** | 房产、车辆、房贷没有资金流动，不产生 `TransactionEntry`；它们以「估值快照」表达价值，与账户余额是两套口径 |
| **三方不重复计数** | 净资产 = 资金账户余额 + 证券市值 + 其他资产估值 − 负债账户 − 其他负债快照；同一经济实质只能落在其中一处，UI 必须引导用户不要重复建账 |
| **缺失不撒谎** | 未录估值的资产不计入净资产，并以 `unpricedAssets` 显式返回；绝不把购置价当当前价值 |
| **版本先于兼容** | 备份结构升到 v2。读 v1 包时按「缺域」处理并给出明确警告；v3 以上直接拒绝，不做「尽力而为」的解析 |
| **生命周期可逆** | 注销申请有冷却期、可撤销；管理员批准只做软删除与禁用，不物理删除，历史审计与备份保留 |
| **不阻断主链路** | 邮箱验证是可选增强，未验证不影响登录与记账；SMTP 未配置时注册流程照常完成 |
| **入口先于能力** | 任何后端已实现但用户无法触达的能力，在本阶段必须有可见入口，否则视为未交付 |
| **旧结果不变** | 复利引擎升到 `compound-v2` 后，`modelVersion = compound-v1` 的已存场景仍按 v1 重算，结果逐字节一致 |

---

## 二、Phase 8 开发阶段划分

```
F1 备份与导出完整性 ──┐
                      ├──► F7 前端工程、测试与文档 ──► 交付
F2 邮件与账户生命周期 ─┤
                      │
F3 资产与负债 ────────┤
                      │
F4 站内通知 ──────────┤
                      │
F5 仪表板与入口补齐 ──┤
                      │
F6 复利模拟补全 ──────┘
```

| 阶段 | 内容 | 涉及模块 | 预期工时 |
|------|------|----------|---------|
| **F1 备份与导出完整性** | 补齐 6 个遗漏实体域、汇率备份落地、结构版本升 v2 与 v1 兼容读取、保留清理定时化 | backups + exports + jobs | 5-6 天 |
| **F2 邮件与账户生命周期** | SMTP 发信器、邮箱验证（可选开关）、注销申请与冷却期、软删除标记、密码重置真正投递 | auth + profile + mailer | 5-6 天 |
| **F3 资产与负债** | 4 张新表、18 个接口、净资产衔接、数据质量扩展、导出与备份接入 | assets + liabilities + analytics | 7-8 天 |
| **F4 站内通知** | `notifications` 表、7 类事件源、3 个接口、顶栏铃铛与未读数 | notifications | 4-5 天 |
| **F5 仪表板与入口补齐** | 预算预警聚合、目标进度聚合、审计页、预算预警卡片、管理员删除审批与重发重置邮件按钮 | 前端页面 + admin | 5-6 天 |
| **F6 复利模拟补全** | 递增定投、提款阶段、税费、目标反推接口、引擎 v2 与旧场景兼容 | simulations | 5-6 天 |
| **F7 前端工程、测试与文档** | ESLint 配置、依赖清理、前端测试基线、i18n、文档口径统一、演示数据 | 全项目 | 4-5 天 |

> **合计约 35-42 天（单人开发）**。主要不确定性在三处：资产与负债并入净资产后如何保证不与账户重复计数、备份 v1→v2 的兼容策略、复利引擎加提款阶段后与旧场景的结果一致性。工时已含边界调试。

### 阶段依赖说明

- **F1 完全独立**，只改数据采集范围与版本判断，可与任何阶段并行；建议先做，因为 F3 的新表必须进备份，否则又制造一处缺口。
- **F3 是最大的独立模块**，只依赖已有的 `Account` 与净资产计算；它同时向 F1 提供新增的两个实体域，因此 F1 的域清单要预留 `assets` / `liabilities`。
- **F2 与 F4 有弱依赖**：F4 的通知事件源需要 F2 的「邮箱验证完成」「注销申请提交/批准」事件；建议 F2 先定义事件常量，F4 直接消费。
- **F5 依赖 F2 与 F3**：仪表板目标进度要读 F3 之后的净资产口径；删除审批按钮依赖 F2 的申请接口。
- **F6 独立**，只改模拟模块内部与 schema。
- **F7 收尾**，必须在其余阶段接口冻结后进行，否则 i18n 键会反复返工。

---

## 三、Phase 8 范围界定

### 交付范围

| 模块 | 交付内容 |
|------|---------|
| 备份完整性 | 补齐 `instrument_prices`、`transaction_tags`、`portfolio_targets`、`classification_rules`、`import_templates`、`account_reconciliations` 六个域；汇率备份默认开启；结构版本升 v2 并兼容读取 v1 |
| 导出完整性 | `full` 与对应 scope 补齐上述域对应 CSV；`manifest.json` 的 `excluded` 逐项声明 |
| 保留清理 | 备份与导出过期清理进入每日调度，不再依赖用户新建时触发 |
| 邮件 | `lib/mailer.ts` 基于 nodemailer 的真实投递；开发环境仍写日志，生产环境必须发信 |
| 邮箱验证 | 可选开关；注册后异步发验证邮件；`POST /auth/verify-email`、`POST /auth/resend-verification`；未验证不阻断登录 |
| 注销申请 | 用户发起、冷却期内可撤销、管理员审批后软删除并禁用；`deletion_requested_at` / `deletion_reviewed_at` / `deleted_at` |
| 资产与负债 | 房产、车辆、其他资产与其估值快照；房贷、消费贷、其他负债与其余额快照；18 个接口；并入净资产与资产配置 |
| 站内通知 | 导出完成、备份完成、恢复完成、任务失败、邮箱验证完成、注销审批结果、管理员操作通知；3 个接口；未读数 |
| 仪表板 | `/dashboard/budget-alerts`、`/dashboard/goal-progress`；前端对应区块 |
| 入口补齐 | 个人审计页、预算预警卡片、管理员删除审批按钮、管理员重发重置邮件按钮、管理员任务重试按钮 |
| 复利模拟 | 每年递增定投、提款阶段、税费、目标反推；引擎 `compound-v2`，旧场景按 v1 重算 |
| 前端工程 | ESLint 配置、未使用依赖清理、前端测试基线（Vitest）、文档口径统一 |

### 明确不交付（后续阶段）

| 能力 | 原因 |
|------|------|
| 凭证附件与交易拆分（`split` / `unsplit`） | 附件需要种子文件存储、病毒扫描与配额策略；拆分需要与转账识别的冲突语义。两者都应在文件存储与账本语义稳定后独立设计 |
| 行情自动接入、外部汇率源 | 需要提供方密钥、限流、缓存与复权。本阶段只补资产估值的手工快照，不引入外部价格 |
| OFX / QFX / PDF 账单解析 | Phase 2 已明确不交付；每种格式需独立解析器与测试矩阵，与数据完整性无关 |
| 报表 PDF 导出、报表订阅推送 | Phase 6 已明确不交付；中文字体嵌入与分页成本高 |
| 云端同步、备份异地存储 | 独立产品方向；本阶段只把本地备份做完整 |
| 用户物理删除与数据擦除 | 涉及备份中的残留处理与不可逆操作确认，需独立设计。本阶段只做软删除 |
| 管理后台安全事件中心（`/admin/security/*`） | 需要独立的事件归集与告警策略；本阶段只在通知与审计中体现，不单独建页面 |
| 管理后台脱敏日志查看（`/admin/system/logs`） | 日志脱敏规则需要单独评审，避免把业务内容带进管理界面 |
| 部署级配置中心（`/admin/settings` 与 `security`） | 涉及在线修改安全参数的风险面，需独立设计权限与回滚 |

> **口径说明**：推迟项属于《项目功能全面分析》中的完整个人版能力，属于**产品范围**而非**本阶段范围**。Phase 8 不修改功能文档。

---

## 四、数据模型设计

### 4.1 模型总览（新增 5 张表）

```
assets                 非交易型资产登记（房产、车辆、其他）
asset_valuations       资产估值快照（时点价值，历史可查）
liabilities            非账户型负债登记（房贷、消费贷、其他）
liability_snapshots    负债余额快照（时点余额，历史可查）
notifications          站内通知（事件投递，可标记已读）
```

**为什么不复用 `Account`**：`Account` 是「资金账户」，它的余额由复式分录推导（期初 + 已入账分录），并且可以绑定投资组合、参与转账匹配与对账。房产没有分录、不会发生转账、也不需要每日余额核对；强行塞进去会让 `TransactionEntry.accountId` 出现一堆永远不会有分录的账户，破坏「账户余额 = 分录之和」这条不变式。两类实体在语义、生命周期与校验规则上完全不同，分表是正确取舍。

**为什么不新增「资产类型枚举表」**：资产与负债的类别是有限且稳定的（房产/车辆/其他、房贷/消费贷/其他），用 Prisma 枚举即可。建表只会让前端多一次联表。

并对已有表做**增量扩展**（不破坏前七阶段数据）：

```
users            新增字段：deletionRequestedAt / deletionReviewedAt / deletedAt
                 新增关系：assets / liabilities / notifications
```

### 4.2 新增枚举

```prisma
enum AssetKind {
  property        // 房产
  vehicle         // 车辆
  collectible     // 收藏品
  other           // 其他
}

enum AssetStatus {
  active
  archived
}

enum LiabilityKind {
  mortgage        // 房贷
  consumer_loan   // 消费贷
  auto_loan       // 车贷
  credit_line     // 授信额度
  other           // 其他
}

enum LiabilityStatus {
  active
  archived
}

enum ValuationBasis {
  manual          // 手工录入
  appraised       // 评估价
  market          // 市场参考价
}

enum NotificationKind {
  export_ready
  backup_ready
  restore_done
  job_failed
  email_verified
  deletion_requested
  deletion_approved
  admin_action
}
```

**为什么不给通知加 `NotificationChannel` 枚举**：本阶段只有站内一种渠道。加枚举会让「站内」变成众多选项之一，反而暗示存在别的渠道却没实现。

### 4.3 模型定义

#### assets

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | uuid | 主键 |
| `userId` | uuid | 归属用户，级联删除 |
| `name` | varchar(80) | 资产名称 |
| `kind` | AssetKind | 类别 |
| `currency` | char(3) | 计价币种 |
| `purchaseDate` | date? | 购置日期，可空 |
| `purchasePrice` | decimal(20,6)? | 购置价，可空；**仅作参考，不参与净资产** |
| `note` | varchar(500)? | 备注 |
| `status` | AssetStatus | 默认 `active` |
| `archivedAt` | timestamptz? | 归档时间 |
| `version` | int | 乐观锁 |
| `createdAt` / `updatedAt` | timestamptz | |

索引：`@@index([userId, status])`、`@@index([userId, kind])`。
唯一约束：`@@unique([userId, name])`，避免同名资产在列表中无法区分。

#### asset_valuations

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | uuid | 主键 |
| `userId` | uuid | 归属用户，级联删除 |
| `assetId` | uuid | 所属资产，级联删除 |
| `valuationDate` | date | 估值日期 |
| `value` | decimal(20,6) | 该时点价值，必须 ≥ 0 |
| `basis` | ValuationBasis | 估值依据 |
| `note` | varchar(200)? | |
| `createdAt` | timestamptz | |

索引：`@@unique([assetId, valuationDate])`（同日只留一条）、`@@index([userId, valuationDate(sort: Desc)])`。

#### liabilities

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | uuid | 主键 |
| `userId` | uuid | 归属用户，级联删除 |
| `name` | varchar(80) | 负债名称 |
| `kind` | LiabilityKind | 类别 |
| `currency` | char(3) | 币种 |
| `originalAmount` | decimal(20,6)? | 原始本金，可空；仅作参考 |
| `startDate` | date? | 起贷日，可空 |
| `interestRate` | decimal(10,6)? | 年化利率，可空；**不参与任何计算**，仅供展示 |
| `note` | varchar(500)? | |
| `status` | LiabilityStatus | 默认 `active` |
| `archivedAt` | timestamptz? | |
| `version` | int | 乐观锁 |
| `createdAt` / `updatedAt` | timestamptz | |

索引与唯一约束同 `assets`。

#### liability_snapshots

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | uuid | 主键 |
| `userId` | uuid | 归属用户，级联删除 |
| `liabilityId` | uuid | 所属负债，级联删除 |
| `snapshotDate` | date | 快照日期 |
| `balance` | decimal(20,6) | 该时点未偿余额，必须 ≥ 0 |
| `note` | varchar(200)? | |
| `createdAt` | timestamptz | |

索引：`@@unique([liabilityId, snapshotDate])`、`@@index([userId, snapshotDate(sort: Desc)])`。

#### notifications

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | uuid | 主键 |
| `userId` | uuid | 归属用户，级联删除 |
| `kind` | NotificationKind | 事件类型 |
| `title` | varchar(120) | 标题（服务端已本地化前的稳定 key 由前端翻译时，此处存参数化文本） |
| `body` | varchar(500)? | 正文 |
| `link` | varchar(200)? | 站内跳转路径 |
| `metadata` | Json? | 结构化参数，前端按 kind 渲染 |
| `readAt` | timestamptz? | 已读时间 |
| `createdAt` | timestamptz | |

索引：`@@index([userId, createdAt(sort: Desc)])`、`@@index([userId, readAt])`。

**通知文案不落库为最终文本**：`title` 与 `body` 存的是**渲染参数**（例如 `{ count: 3 }`），实际文案由前端按 `kind` + `metadata` 从 i18n 渲染。这样切换语言时历史通知不会停留在旧语言。

### 4.4 金额与精度

- 全部金额沿用 `DECIMAL(20,6)`，与账本一致；接口层一律字符串。
- `value` / `balance` 必须 ≥ 0，由 schema + 数据库双重约束。负数没有业务含义（负债余额为正数表示欠款）。
- `purchasePrice` / `originalAmount` / `interestRate` 是**参考字段**，不参与净资产、目标进度、数据质量任何计算。这一点必须在字段注释与 UI 提示中写明。

### 4.5 迁移策略

新增迁移 `phase8_assets_liabilities_notifications`：

1. 建 5 张表与 6 个枚举。
2. `users` 增加 3 个可空时间字段，全部 `NULL`，不触碰现有行。
3. 不修改任何既有表结构，不重命名，不删除。

回滚策略：本阶段不写 down migration（与既有阶段一致）；上线前使用 `pg_dump` 完整备份生产库。

---

## 五、关键设计决策

| # | 决策点 | 结论 | 理由 |
|---|--------|------|------|
| 1 | 资产/负债是否复用 `Account` | 不复用，新建 4 张表 | 账户余额由分录推导，资产价值由快照表达；混用会破坏「余额 = 分录之和」不变式 |
| 2 | 资产价值取哪一个 | 取 `valuationDate <= asOf` 的**最新一条** | 与组合估值的取值口径一致；未来日期的估值不参与 |
| 3 | 未录估值的资产怎么办 | 不计入净资产，返回 `unpricedAssets` | 用购置价冒充当前价值是最典型的「撒谎」 |
| 4 | 自重计数的防线 | 净资产分项返回 `accountAssets` / `securitiesValue` / `otherAssets`，UI 分三块展示 | 用户能一眼看出钱落在哪一栏；发现重复可自行纠正 |
| 5 | 资产是否参与数据质量「过期估值」 | 参与，阈值复用 `INVESTMENT_PRICE_STALE_DAYS` | 否则新模块游离在质量检查之外，正是 Phase 7 要消除的问题 |
| 6 | 备份结构版本 | `v1` → `v2`；v2 代码接受 v1 与 v2，拒绝 v3+ | 补域即结构变化；但已下载的 v1 包不能作废 |
| 7 | v1 包恢复时缺域 | 允许恢复，预览返回 `warnings` 逐项列出缺失域 | 恢复部分数据优于拒绝；但必须让用户在点确认前看到 |
| 8 | 汇率是否默认备份 | 是，默认包含，参数可关闭 | 手工汇率重建成本高，且缺失会让历史折算无法复现 |
| 9 | 旧备份包是否含新表 | 不含。`assets` / `liabilities` 仅存于 v2 包 | 老包生成时这些表还不存在，属于客观事实 |
| 10 | 保留清理何时执行 | 启动时一次 + 每 24 小时一次，与导入清理并列 | 用户不再新建备份时，过期文件也必须被清理 |
| 11 | 邮箱验证是否强制 | 不强制。开关默认关闭，开启后仅发信与展示状态 | 自部署单用户场景下强制验证会增加部署门槛 |
| 12 | 验证令牌存哪里 | Redis，与密码重置同模式，TTL 72 小时 | 少一张表；令牌天然可过期、可一次性消费 |
| 13 | 注销是软删还是硬删 | 软删除：`deletedAt` + `status = disabled` | 物理删除牵连备份残留与审计完整性，须独立设计 |
| 14 | 注销冷却期 | 7 天，期间用户可撤销 | 给误操作留出反悔窗口；管理员审批前置条件 |
| 15 | 通知是否发邮件 | 不发。仅站内 | 邮件可靠性不可控，且会与验证邮件混淆优先级 |
| 16 | 复利引擎如何兼容 | 新增 `compound-v2`；按场景的 `modelVersion` 分派 | 已保存场景是用户资产，结果不得因升级而改变 |
| 17 | 提款阶段的语义 | 提款发生在计息之后、追加之前，按月末记 | 与定投时点保持同一套月末结算约定 |
| 18 | 目标反推是同步还是异步 | 同步，带上限（年限 ≤ 100，二分迭代 ≤ 60 次） | 单变量求根，计算量恒定，无需任务承载 |
| 19 | 越权 | 资产、负债、快照、通知一律按 `user_id`；跨用户 404 | 与前七阶段一致 |
| 20 | 管理员能否读资产与负债 | 否 | 净资产口径包含它们，但明细仍属财务内容，产品红线不变 |

---

## 六、F1 — 备份与导出完整性

### 6.1 备份域补齐

`BACKUP_DOMAINS` 由 15 个扩展到 26 个，新增 11 个：

```
instrument_prices        标的全部手工价格历史
transaction_tags         流水与标签的关联
portfolio_targets        组合目标权重
classification_rules     自动分类规则
import_templates         导入映射模板
account_reconciliations  账户对账记录
assets                   非交易型资产（F3）
liabilities              非交易型负债（F3）
asset_valuations          资产估值快照（F3）
liability_snapshots       负债余额快照（F3）
market_exchange_rates    汇率（按 includeRates 决定）
```

采集顺序按外键依赖排列：`categories → tags → accounts → instruments → instrument_prices → portfolios → portfolio_targets → transactions → entries → transaction_tags → budgets → trades → cashflows → valuations → reconciliations → import_templates → classification_rules → assets → asset_valuations → liabilities → liability_snapshots → simulation_scenarios → goals → reports → settings → exchange_rates`。

### 6.2 结构版本与兼容

```ts
export const BACKUP_SCHEMA_VERSION = 'comporalife-backup-v2';
export const BACKUP_SUPPORTED_VERSIONS = ['comporalife-backup-v1', 'comporalife-backup-v2'] as const;
```

恢复流程：

1. 解密 → 解析 → 校验 `schemaVersion` 在支持列表内，否则 `BACKUP_VERSION_UNSUPPORTED`。
2. 校验 SHA-256，不符则 `BACKUP_CORRUPTED`。
3. 比对包内 `domains` 与当前代码的 `BACKUP_DOMAINS`，**缺失的域写入 `warnings`**，格式为 `missing_domain:<name>`。
4. 预览响应返回 `warnings`，前端在确认步之前以醒目列表展示，例如「该备份不包含：标的计价历史、标签关联、组合目标权重……恢复后这些数据将为空」。
5. 用户确认后执行，只写入包内实际存在的域。

### 6.3 汇率备份

- `includeRates` 参数从「声明但未实现」变为真实生效，默认 `true`。
- 汇率域只备份**该用户的** `exchange_rates` 行，不涉及全局汇率。
- 恢复时汇率按 `(baseCurrency, quoteCurrency, rateDate)` 唯一键处理冲突，策略与其它域一致（`skip` / `overwrite`）。

### 6.4 导出包补齐

`SCOPE_DATASETS` 对齐备份域：

| scope | 新增 CSV |
|-------|----------|
| `full` | `instrument_prices.csv`、`transaction_tags.csv`、`portfolio_targets.csv`、`classification_rules.csv`、`import_templates.csv`、`account_reconciliations.csv`、`assets.csv`、`asset_valuations.csv`、`liabilities.csv`、`liability_snapshots.csv`、`exchange_rates.csv` |
| `investments` | `instrument_prices.csv`、`portfolio_targets.csv` |
| `ledger` | `transaction_tags.csv`、`account_reconciliations.csv` |
| `planning` | `assets.csv`、`asset_valuations.csv`、`liabilities.csv`、`liability_snapshots.csv` |

`manifest.json` 的 `excluded` 数组固定包含以下键，逐项说明原因：

```json
{
  "excluded": [
    { "key": "original_statement_files", "reason": "原始账单文件体积大且含银行原文，仅保存在服务端加密存储" },
    { "key": "password_hash", "reason": "凭据不属于业务数据" },
    { "key": "refresh_tokens", "reason": "凭据不属于业务数据" },
    { "key": "sessions", "reason": "会话是有时效的运行态" },
    { "key": "audit_logs", "reason": "审计日志属于安全记录，不随个人数据导出" },
    { "key": "monte_carlo_results", "reason": "结果可按种子与模型版本重算" }
  ]
}
```

### 6.5 保留清理定时化

新增 `scheduleDataCleanup(prisma, onError)`，与 `scheduleImportCleanup` 并列注册在 `index.ts`：

- 启动时立即执行一次。
- 每 24 小时执行一次。
- 任务体：对所有有过期备份/导出的用户，逐用户调用 `pruneBackups` / `pruneExports`。
- 使用游标分批（每批 100 个用户），避免一次性扫描全表。
- `timer.unref()`，不阻止进程退出。

### 6.6 验收

- [ ] 新建备份后解包（测试内解密）能读到 `instrument_prices`、`transaction_tags`、`portfolio_targets` 等全部新增域
- [ ] 关闭 `includeRates` 时包内无 `market_exchange_rates`；开启时有
- [ ] v1 包可被 v2 代码恢复，预览 `warnings` 列出全部缺失域
- [ ] v3 包被拒绝，返回 `BACKUP_VERSION_UNSUPPORTED`
- [ ] 篡改一字节后恢复被拒
- [ ] 恢复后标的、标签、目标权重、分类规则、导入模板、对账记录数量与备份时一致
- [ ] 导出 `full` scope 的文件集合与 `manifest.files` 完全一致
- [ ] 不再新建备份/导出时，过期产物在 24 小时内被清理
- [ ] 前七阶段备份测试全部通过（含 v1 旧包样本）

---

## 七、F2 — 邮件投递与账户生命周期

### 7.1 邮件发信器

新增 `server/src/lib/mailer.ts`：

```ts
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export function isMailConfigured(): boolean;

export async function sendMail(message: MailMessage): Promise<{ delivered: boolean }>;
```

行为约定：

| 环境 | SMTP 已配置 | SMTP 未配置 |
|------|-------------|-------------|
| development | 真实发送 | 只写日志（含完整链接），`delivered: false` |
| test | 不发送，写入内存队列供断言 | 同左 |
| production | 真实发送，失败抛错 | 启动时打印告警；触发发送时抛 `MAIL_NOT_CONFIGURED` |

- 传输器单例，惰性初始化。
- 连接超时 10 秒，单次发送重试 1 次（仅对网络类错误）。
- 日志只记 `to` 的域名部分与消息类型，不记正文。

### 7.2 密码重置真正投递

`requestPasswordReset` 在 SMTP 可用时调用 `sendMail`，正文包含 `APP_BASE_URL` 拼接的重置链接。开发环境保持「写日志」不变，便于本地调试。

### 7.3 邮箱验证

| 项 | 约定 |
|----|------|
| 开关 | `system_settings` 新增键 `auth.email_verification_enabled`，默认 `false`；管理员可在系统页切换 |
| 令牌 | Redis，键 `verify:<sha256(token)>`，TTL 72 小时，一次性消费 |
| 注册行为 | 注册成功照常 `status = active` 并签发会话；若开关开启且 SMTP 可用，异步发验证邮件 |
| 验证接口 | `POST /api/auth/verify-email`，body `{ token }`；成功后写 `emailVerifiedAt`，发通知 |
| 重发接口 | `POST /api/auth/resend-verification`，需要登录，10 分钟内最多 1 次（Redis 计数） |
| 不阻断 | 未验证用户可正常使用全部功能；仅在顶栏用户菜单与个人资料页显示「邮箱未验证」提示与重发入口 |
| 管理员可见 | 用户列表与详情继续展示 `emailVerifiedAt`（现有字段，不改） |

**为什么不复用登录会话的 `status`**：Phase 1 保留了 `pending_verification` 枚举值但从未使用。本阶段**明确不使用它**：一旦把未验证用户置为该状态，登录、限流与审计都要增加分支，且与「不阻断」原则冲突。该枚举值保持保留状态，不消费。

### 7.4 注销申请

状态机：

```
（无申请）
   │  POST /profile/delete-request
   ▼
pending（deletionRequestedAt 非空）
   │  POST /profile/delete-cancel            │  冷却期满 7 天 + 管理员批准
   ▼                                          ▼
（无申请）                                approved（deletedAt 非空，status = disabled）
```

| 接口 | 行为 |
|------|------|
| `POST /api/profile/delete-request` | 写 `deletionRequestedAt = now()`；重复申请返回 `CONFLICT`；写审计 `user.deletion_requested`；发通知 |
| `POST /api/profile/delete-cancel` | 清空 `deletionRequestedAt`；无申请时返回 `NOT_FOUND`；写审计 |
| `GET /api/profile` | 响应新增 `deletionRequestedAt`、`deletionCoolingOffEndsAt`、`deletable: boolean` |

管理员审批（改造已有 `POST /admin/users/:id/deletion-review`）：

- 请求体 `{ decision: 'approve' | 'reject', note? }`。
- `approve` 前置条件：存在申请且冷却期已满，否则 `DELETION_NOT_REVIEWABLE`。
- `approve` 结果：`deletedAt = now()`、`status = disabled`、撤销全部会话、写 `admin.deletion_approved`、发通知。
- `reject` 结果：清空 `deletionRequestedAt`，写 `admin.deletion_rejected`、发通知。
- 不物理删除任何行。

登录拦截：`deletedAt` 非空的用户登录返回 `USER_DISABLED`，与既有禁用逻辑合并。

### 7.5 验收

- [ ] 生产环境配置 SMTP 后，忘记密码能收到邮件并可完成重置
- [ ] SMTP 未配置时生产环境启动打印告警，触发发送返回 `MAIL_NOT_CONFIGURED` 而非静默成功
- [ ] 验证开关开启且 SMTP 可用时注册能收到验证邮件；验证后 `emailVerifiedAt` 非空
- [ ] 验证开关关闭时注册不发信，流程与现在一致
- [ ] 未验证用户可正常登录、记账、导出
- [ ] 注销申请后 7 天内可撤销；撤销后申请时间清空
- [ ] 冷却期未满时管理员批准返回 `DELETION_NOT_REVIEWABLE`
- [ ] 批准后用户立即无法登录，且数据行仍存在
- [ ] 全部生命周期事件写入审计且不含金额

---

## 八、F3 — 非交易型资产与负债

### 8.1 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/assets` | 资产列表，支持 `status` / `kind` 筛选 |
| POST | `/api/assets` | 登记资产 |
| GET | `/api/assets/:id` | 资产详情（含最新估值与估值数量） |
| PATCH | `/api/assets/:id` | 更新名称、类别、币种、备注（乐观锁） |
| DELETE | `/api/assets/:id` | 归档（存在估值时不硬删） |
| POST | `/api/assets/:id/valuations` | 记录估值快照（同日覆盖需显式 `overwrite`） |
| GET | `/api/assets/:id/valuations` | 估值历史 |
| DELETE | `/api/assets/:id/valuations/:valuationId` | 删除错误估值 |
| GET | `/api/assets/summary` | 资产汇总（按类别、按币种，折算基准币种） |
| GET | `/api/liabilities` | 负债列表 |
| POST | `/api/liabilities` | 登记负债 |
| GET | `/api/liabilities/:id` | 负债详情 |
| PATCH | `/api/liabilities/:id` | 更新负债资料（乐观锁） |
| DELETE | `/api/liabilities/:id` | 归档 |
| POST | `/api/liabilities/:id/balance-snapshots` | 记录余额快照 |
| GET | `/api/liabilities/:id/balance-snapshots` | 余额历史 |
| DELETE | `/api/liabilities/:id/balance-snapshots/:snapshotId` | 删除错误快照 |
| GET | `/api/liabilities/summary` | 负债汇总 |

> 接口文档第 5 节列出 14 个；本阶段补 2 个「删除错误快照」接口与 2 个汇总接口。汇总独立成接口而非塞进列表，是因为列表分页时无法同时给出全量合计。
>
> **路由顺序**：`/assets/summary` 与 `/liabilities/summary` 必须在 `/:id` 之前注册，否则会被当成 ID 解析。这与 `budgets.routes.ts` 中 `/budgets/summary` 的处理方式一致。

### 8.2 净资产衔接

`computeNetWorth` 扩展为六项：

```
净资产 = accountAssets            （非负债类账户余额之和）
       + securitiesValue          （证券市值，不含组合现金）
       + otherAssets              （资产最新估值之和）
       − accountLiabilities       （信用卡与贷款账户余额绝对值）
       − otherLiabilities         （负债最新快照之和）
```

新增返回字段：

```ts
interface NetWorthResult {
  // ...已有字段
  accountAssets: Decimal;
  securitiesValue: Decimal;
  otherAssets: Decimal;
  accountLiabilities: Decimal;
  otherLiabilities: Decimal;
  unpricedAssets: Array<{ id: string; name: string; reason: 'no_valuation' | 'future_valuation' | 'missing_rate' }>;
  unpricedLiabilities: Array<{ id: string; name: string; reason: 'no_snapshot' | 'future_snapshot' | 'missing_rate' }>;
}
```

规则：

1. 最新估值取 `valuationDate <= asOf` 的最后一条；全部在 `asOf` 之后则计入 `unpricedAssets`，理由 `future_valuation`。
2. 币种不等于基准币种时走 `convertMany`；缺汇率则不计入并给出 `missing_rate`。
3. 归档资产不计入。
4. `purchasePrice` / `originalAmount` 永不参与。

### 8.3 防重复计数

UI 与文档同时落实三条：

- 资产页顶部固定提示：「房产、车辆等非交易型资产请登记在这里，不要建成资金账户，否则会在净资产里重复计算。」
- 仪表板的净资产卡片分三栏展示：账户、证券、其他资产；负债分两栏：账户负债、其他负债。
- 资产页与账户页互相提供引导链接。

### 8.4 数据质量扩展

- `stale-valuations` 指标纳入资产：最新估值日期距 `asOf` 超过 `INVESTMENT_PRICE_STALE_DAYS` 的资产计入。
- 明细接口 `/data-quality/stale-valuations` 的 `items` 增加 `targetType: 'portfolio' | 'asset'` 区分。
- 新增 `unpriced-assets` 明细分项，与净资产返回一致。

### 8.5 资产配置与目标

- 仪表板资产配置（`/dashboard/asset-allocation`）新增 `other` 维度，口径为「资产最新估值折算后合计」，与账户、证券并列。
- 目标绑定 `fundingSource = net_worth` 时自动受益于新口径，无需改目标逻辑；需在目标页口径说明中补一句「净资产含非交易型资产与负债」。

### 8.6 导出与备份接入

- 导出新增 `assets.csv` / `asset_valuations.csv` / `liabilities.csv` / `liability_snapshots.csv`，归入 `full` 与 `planning`。
- 备份新增四个域，恢复顺序保证 `assets` 先于 `asset_valuations`。

### 8.7 验收

- [ ] 创建资产并录入估值后，仪表板「其他资产」出现对应金额，净资产增加同额
- [ ] 未录估值的资产不计入净资产，`unpricedAssets` 列出
- [ ] 归档资产不计入
- [ ] 外币资产缺汇率时不计入并声明
- [ ] 同日重复估值返回 `CONFLICT`，带 `overwrite=true` 时覆盖
- [ ] 有估值的资产评估删除返回 `ASSET_HAS_VALUATIONS`，提示归档
- [ ] 负债快照与资产估值行为对称
- [ ] 资产估值过期出现在数据质量明细，`targetType = 'asset'`
- [ ] 导出与备份包含四个新域
- [ ] 跨用户访问资产/负债/快照返回 404
- [ ] 管理员接口响应不含任何资产、负债字段

---

## 九、F4 — 站内通知

### 9.1 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/notifications` | 列表，`page` / `pageSize` / `unreadOnly`；响应含 `unreadCount` |
| PATCH | `/api/notifications/:id/read` | 标记单条已读 |
| POST | `/api/notifications/read-all` | 全部标记已读 |

### 9.2 事件源

| 事件 | kind | 触发点 | metadata |
|------|------|--------|----------|
| 导出完成 | `export_ready` | 导出任务成功 | `{ exportId, scope, sizeBytes }` |
| 导出失败 | `job_failed` | 导出任务失败 | `{ taskId, reason }` |
| 备份完成 | `backup_ready` | 备份任务成功 | `{ backupId, sizeBytes }` |
| 恢复完成 | `restore_done` | 恢复成功 | `{ backupId, domains, restoreCount }` |
| 任务失败 | `job_failed` | 通用任务失败 | `{ taskId, kind, reason }` |
| 邮箱验证完成 | `email_verified` | 验证接口成功 | `{}` |
| 注销申请 | `deletion_requested` | 用户申请 | `{ coolingOffEndsAt }` |
| 注销批准 | `deletion_approved` | 管理员批准 | `{}` |
| 管理员操作 | `admin_action` | 禁用、启用、撤销会话、角色变更 | `{ action }` |

写入方式：在既有审计写入点之后追加一次 `createNotification`。通知失败**不得阻断主流程**：捕获异常、记 `warn` 日志后继续。

### 9.3 前端

- 顶栏新增铃铛按钮，未读数以角标展示（> 99 显示 `99+`）。
- 点击展开下拉：最近 10 条，底部「查看全部」跳转 `/notifications`。
- 新增 `/notifications` 页面：分页列表、未读筛选、单条已读、全部已读。
- 通知文案由前端按 `kind` 与 `metadata` 从 `notifications` 命名空间渲染，切换语言时历史通知随之切换。
- 空态、加载态、错误态与既有页面一致。

### 9.4 保留

- 通知保留 90 天，随 F1 的每日清理一并删除。
- 每用户最多保留 500 条，超出按时间倒序删除。

### 9.5 验收

- [ ] 导出完成后 5 秒内出现通知（轮询或失效重取）
- [ ] 未读数与实际未读条数一致
- [ ] 全部已读后角标消失
- [ ] 切换语言后历史通知文案随之切换
- [ ] 通知写入失败不影响导出/备份/恢复本身
- [ ] 通知跨用户 404
- [ ] 超过保留期的通知被清理

---

## 十、F5 — 仪表板与入口补齐

### 10.1 仪表板聚合

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/dashboard/budget-alerts` | 当前周期超支与接近超支的预算项，取前 5 条 |
| GET | `/api/dashboard/goal-progress` | 活跃目标进度前 5 条，含缺口与所需月供 |

两者均复用已有 service（`budgets/alerts`、`goals/summary`），只做裁剪与排序，不重算口径。

前端在「数据质量」区块上方新增两个卡片：

- 预算预警：显示「3 项预算接近超支」并跳转预算页。
- 目标进度：显示进度最高与最接近期限的两个目标。

### 10.2 个人审计页

- 新增 `/audit`（或在「我的数据」新增 Tab，二选一，建议独立页以便深链）。
- 列表：动作类型、目标类型、时间、IP 网段；筛选动作类型与时间区间；分页。
- 详情：单条审计的元数据（白名单字段）。
- 已实现的 `auditApi` 直接复用，不新增后端接口。

### 10.3 预算预警卡片

- 在预算页顶部渲染 `budgetsApi.alerts()` 结果。
- 分两档：`exceeded`（红）、`warning`（琥珀）。
- 无预警时不渲染区块，避免占位空白。

### 10.4 管理后台按钮补齐

| 按钮 | 接口 | 说明 |
|------|------|------|
| 删除审批 | `POST /admin/users/:id/deletion-review` | 已有接口；新增按钮与批准/驳回确认弹窗；展示申请时间与冷却期状态 |
| 重发重置邮件 | `POST /admin/users/:id/send-password-reset` | 新接口；触发后返回 202，不回传令牌 |
| 任务重试 | `POST /admin/jobs/:id/retry` | 新接口；仅允许对失败状态任务重试 |

管理后台用户列表增加一列「注销申请」，显示冷却期剩余天数或「已批准」。

### 10.5 验收

- [ ] 仪表板出现预算预警与目标进度卡片，数据与对应详情页一致
- [ ] 无预警/无目标时卡片不渲染
- [ ] 审计页可筛选动作类型与时间，分页正确
- [ ] 预算页顶部预警与 `alerts` 接口返回一致
- [ ] 管理员可对未满冷却期的申请看到「不可批准」并禁用按钮
- [ ] 管理员重发重置邮件后，用户确实收到（SMTP 可用时）
- [ ] 管理员只能重试失败任务，其它状态返回 `TASK_NOT_RETRYABLE`
- [ ] 三个管理接口均写审计

---

## 十一、F6 — 复利模拟补全

### 11.1 参数扩展

在既有 `compoundParamsSchema` 基础上新增：

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `annualContributionIncrease` | 比率字符串 | `0` | 每年追加额递增率，范围 −0.5 ~ 1 |
| `withdrawalAmount` | 金额字符串 | `0` | 定期提款额 |
| `withdrawalFrequency` | `none` / `monthly` / `annual` | `none` | 提款频率 |
| `withdrawalStartYear` | 整数 | `1` | 开始提款的年份 |
| `taxRate` | 比率字符串 | `0` | 收益税率，范围 0 ~ 0.5，按年度对正收益计税 |

### 11.2 引擎版本

- `MODEL_VERSION` 由 `compound-v1` 升为 `compound-v2`。
- 场景表新增无字段变化：`modelVersion` 已有，旧行保持 `compound-v1`。
- 读取场景时按行内 `modelVersion` 分派：
  - `compound-v1` → 用 v1 引擎（保留现有实现，冻结）
  - `compound-v2` → 用新引擎
- 新建与更新场景一律写 `compound-v2`。
- 对比接口允许跨版本比较，但响应标注每个方案的计算版本。

### 11.3 v2 计算顺序（每年）

```
1. 年初余额 × (1 + 有效年收益)          → 计息
2. 减去年内提款（若已到提款起始年）      → 提款
3. 加年内追加（含当年递增后的金额）      → 定投
4. 正收益部分按 taxRate 计税并从余额扣除 → 税费
5. 记录名义值、按通胀折算的实际值       → 快照
```

顺序固定为「计息 → 提款 → 定投 → 税」，与 v1 的「计息 → 定投」保持同一方向，避免旧场景的语义漂移。v1 路径不变。

### 11.4 目标反推

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/simulations/compound/solve` | 给定目标金额与其它参数，反推所需月供 |

请求可选 `solveFor: 'contribution' | 'years'`：

- `contribution`：固定年限，二分求所需定期投入额，要求其它参数满足可达（否则返回 `SOLVE_UNREACHABLE`）。
- `years`：固定投入额，二分求所需年限（上限 100 年，超出返回不可达）。
- 迭代上限 60 次，精度 0.01（金额）或 1 个月（年限）。
- 响应包含求解值、迭代次数与实际达成金额，与目标金额的差额。

### 11.5 前端

- 复利页参数区新增「进阶假设」可折叠区块：递增率、提款、税费。
- 新增「目标反推」子面板：输入目标金额，选择反推月供或年限。
- 结果区展示提款阶段开始后的资产下降曲线；图表在提款起始年加一条标注线。
- 场景列表显示计算版本徽标（v1 / v2），仅当用户混用旧场景时出现。

### 11.6 验收

- [ ] 所有既有 `compound-v1` 场景结果与升级前逐字节一致（用快照测试锁定）
- [ ] 新增参数为 0 时，v2 结果与 v1 一致（同样的本金、定投、收益）
- [ ] 提款起始年之后资产开始下降
- [ ] 递增率为正时，后续年度追加额逐年上升
- [ ] 税后结果小于税前结果，且差额等于各年正收益 × 税率之和（允许舍入）
- [ ] 目标反推的结果代回计算，达成金额与目标差额 < 0.01
- [ ] 不可达场景返回 `SOLVE_UNREACHABLE` 而非无限迭代
- [ ] 对比接口能并排展示 v1 与 v2 场景

---

## 十二、F7 — 前端工程、测试与文档

### 12.1 前端工程

| 项 | 处置 |
|----|------|
| ESLint | 新增 `frontend/eslint.config.js`，基于 `typescript-eslint` + `eslint-plugin-react-hooks`，与后端配置风格一致；`npm run lint` 必须通过 |
| `@tanstack/react-table` | **移除**。全项目零引用，表格由原生 `<table>` 实现，保留依赖会让技术栈文档与实际不符 |
| `react-hook-form` + `@hookform/resolvers` | **移除**。同理零引用。若后续需要表单库再单独引入并配套改造 |
| `@tanstack/react-virtual` | 保留，导入预览表格在用 |
| 前端测试 | 新增 `frontend/vitest.config.ts` 与 `npm run test`；覆盖纯函数（金额格式化、日期、枚举标签）与至少 3 个关键组件（质量指标卡、恢复向导确认步、预算预警卡片） |

> 移除依赖属于破坏性变更，必须同时更新 `frontend/package.json` 与技术栈文档。按既有约定**不修改 `package-lock.json`**，由用户本地执行 `npm install` 后再提交。

### 12.2 i18n

- 新增命名空间：`assets`、`liabilities`、`notifications`、`audit`。
- `enums` 增补：`asset_kind`、`asset_status`、`liability_kind`、`liability_status`、`valuation_basis`、`notification_kind`。
- `errors` 增补第十三节全部错误码。
- 导航注册：`nav:assets`、`nav:liabilities`、`nav:notifications`、`nav:audit`。
- 中英双语必须键数一致（沿用现有对齐约定）。

### 12.3 测试

| 层级 | 覆盖 |
|------|------|
| 单元 | 备份域序列化与恢复顺序、v1/v2 版本判断、净资产六项分项计算、资产最新估值取值、ValuationBasis 校验、通知文案参数化、复利 v1/v2 分派、v2 一年结算顺序、目标反推二分收敛与不可达 |
| 集成 | 备份全量域往返、v1 旧包恢复与 warnings、导出文件集合、汇率开关、清理调度（伪时钟）、邮件发送（内存传输器）、邮箱验证全流程、注销申请与审批状态机、资产 CRUD 与争议点、负债快照、净资产接入、数据质量过期估值含资产、通知事件与已读、仪表板两个聚合、管理三接口 |
| 回归 | Phase 1–7 全部测试通过；`compound-v1` 场景快照不变；既有导出与备份用例在补齐域后仍通过（更新期望文件集合） |
| 安全 | 资产/负债/快照/通知跨用户 404；管理接口逐字段断言无资产、负债、金额；通知不携带余额；审计不含金额 |

### 12.4 文档

- [ ] `README` 进度表新增「非交易型资产与负债」「站内通知」「账户生命周期」，并把「尚未交付」清单中已实现项移除
- [ ] `docs/API接口全面分析.md` 第 5 节从规划改为已实现，第 10、21、22、23、24、25 节按本计划修正接口清单
- [ ] `docs/项目目录结构.md` 增补 `modules/assets`、`modules/liabilities`、`modules/notifications`、`lib/mailer.ts` 与对应前端页面
- [ ] 修正 `docs/plan-phase7.md` 中「计划交付版本 v0.1.8」与 `appVersion` 的过期表述
- [ ] 修正 `docs/项目功能全面分析.md` 与 `docs/技术栈选型与开发准备清单.md` 中「Vite 8」为实际的 Vite 6
- [ ] 修正接口文档末尾「接口总览」的重复行与合计（当前 260 与实际 296 不符）
- [ ] 补齐前七阶段承诺但缺失的设计文档中的两份：`备份与导出包结构规范`、`资产与负债口径规范`
- [ ] 演示数据：一处房产及其两条估值、一笔房贷及两条余额快照、三条未读通知、一份 v1 备份样本用于兼容测试

---

## 十三、接口清单与错误码

### 13.1 接口清单汇总

| 模块 | 接口数 | 所属阶段 |
|------|--------|----------|
| 资产 | 9 | F3 |
| 负债 | 9 | F3 |
| 邮箱验证 | 2 | F2 |
| 注销申请 | 2 | F2 |
| 站内通知 | 3 | F4 |
| 仪表板聚合 | 2 | F5 |
| 管理后台补充 | 3 | F1/F5 |
| 复利目标反推 | 1 | F6 |
| **合计新增** | **31** | |

> 前七阶段累计 248 个实际路由；本阶段新增 31 个。`/admin/jobs/:id/retry` 在 F1 中先实现（备份与导出重试需要），UI 在 F5 落地。

### 13.2 新增错误码

| 错误码 | HTTP | 说明 |
|--------|------|------|
| `BACKUP_DOMAIN_MISSING` | — | 非错误，仅出现在 `warnings` 数组中 |
| `DELETION_NOT_REVIEWABLE` | 409 | 无申请或冷却期未满，不能批准 |
| `DELETION_ALREADY_REQUESTED` | 409 | 已有进行中的注销申请 |
| `EMAIL_VERIFICATION_DISABLED` | 400 | 验证功能未开启却请求验证 |
| `EMAIL_VERIFICATION_TOKEN_INVALID` | 400 | 令牌不存在、已消费或已过期 |
| `EMAIL_RESEND_TOO_FREQUENT` | 429 | 重发验证邮件过于频繁 |
| `ASSET_NOT_FOUND` | 404 | 资产不存在或不属于当前用户 |
| `ASSET_HAS_VALUATIONS` | 409 | 存在估值记录，不能硬删，请归档 |
| `ASSET_NAME_EXISTS` | 409 | 同名资产已存在 |
| `ASSET_ARCHIVED` | 409 | 已归档资产不可编辑估值 |
| `ASSET_VALUATION_EXISTS` | 409 | 同日估值已存在，需 `overwrite` |
| `LIABILITY_NOT_FOUND` | 404 | 负债不存在或不属于当前用户 |
| `LIABILITY_HAS_SNAPSHOTS` | 409 | 存在余额快照，不能硬删，请归档 |
| `LIABILITY_NAME_EXISTS` | 409 | 同名负债已存在 |
| `LIABILITY_ARCHIVED` | 409 | 已归档负债不可编辑快照 |
| `LIABILITY_SNAPSHOT_EXISTS` | 409 | 同日快照已存在，需 `overwrite` |
| `SOLVE_UNREACHABLE` | 422 | 目标在给定约束下不可达 |
| `NOTIFICATION_NOT_FOUND` | 404 | 通知不存在或不属于当前用户 |
| `MAIL_DELIVERY_FAILED` | 502 | SMTP 投递失败（已重试一次） |

> 越权一律 404；功能未开启而为客户端调用返回 400；资源状态冲突返回 409。
> 「备份缺域」**不产生错误**，走 `warnings`，恢复照常进行。

---

## 十四、技术依赖

### 后端

无新增依赖。`nodemailer` 与 `@types/nodemailer` 已在 `package.json` 中，本阶段首次真正使用。

### 前端

无新增依赖；移除 `@tanstack/react-table`、`react-hook-form`、`@hookform/resolvers`。
新增开发依赖：`eslint`、`typescript-eslint`、`eslint-plugin-react-hooks`、`vitest`、`@testing-library/react`、`jsdom`。

### 数据库

Redis 新增键空间：

```
verify:<sha256>            邮箱验证令牌，TTL 72h
verify:resend:<userId>     重发节流，TTL 10min
```

---

## 十五、环境变量

无必需新增。以下为已有但本阶段首次实际生效：

| 变量 | 默认 | 说明 |
|------|------|------|
| `SMTP_HOST` | 空 | 为空时生产环境不投递，启动打印告警 |
| `SMTP_PORT` | 587 | |
| `SMTP_USER` | 空 | |
| `SMTP_PASS` | 空 | |
| `MAIL_FROM` | 空 | 为空时用 `SMTP_USER` |

可选新增：

| 变量 | 默认 | 说明 |
|------|------|------|
| `EMAIL_VERIFY_TTL_SECONDS` | 259200 | 验证令牌有效期（72 小时） |
| `DELETION_COOLING_OFF_DAYS` | 7 | 注销冷却期 |
| `NOTIFICATION_RETENTION_DAYS` | 90 | 通知保留天数 |
| `NOTIFICATION_MAX_PER_USER` | 500 | 每用户通知条数上限 |

`.env.example` 同步补注释，不得写入真实凭据。

---

## 十六、验证清单

### F1

- [ ] 备份往返后六个补全域的条数一致
- [ ] 汇率开关生效
- [ ] v1 包恢复成功且 warnings 完整
- [ ] v3 包拒绝
- [ ] 导出文件集合与 manifest 一致
- [ ] 过期产物在 24 小时内被清理，无需新建

### F2

- [ ] 生产 SMTP 下密码重置邮件可达并能完成重置
- [ ] SMTP 未配置时生产启动告警、发送报错
- [ ] 验证开关开/关两种行为正确
- [ ] 未验证不阻断任何主流程
- [ ] 注销申请→撤销→再申请均正确
- [ ] 冷却期未满不可批准
- [ ] 批准后登录被拒且数据仍在

### F3

- [ ] 净资产六项之和等于总数
- [ ] 未录估值资产不计入且被列出
- [ ] 归档、外币缺汇率、未来日期估值三种边界正确
- [ ] 资产不进数据质量「未分类」等账本类指标
- [ ] 资产过期估值进质量明细
- [ ] 导出与备份含四个新域
- [ ] 跨用户 404，管理接口无财务字段

### F4

- [ ] 九类事件均能生成通知
- [ ] 未读数准确
- [ ] 切换语言后历史通知随之切换
- [ ] 通知写入失败不阻断主流程
- [ ] 保留与上限生效

### F5

- [ ] 两个仪表板聚合与详情页口径一致
- [ ] 审计页筛选与分页正确
- [ ] 预算预警卡片两档样式正确
- [ ] 管理三个按钮行为与错误码正确

### F6

- [ ] v1 场景结果零变化
- [ ] v2 在新增参数为 0 时等价 v1
- [ ] 提款、递增、税费三种情形曲线正确
- [ ] 目标反推代回校验通过
- [ ] 不可达返回 422

### F7

- [ ] `npm run lint` 通过（前后端）
- [ ] `npm run test` 通过（前后端）
- [ ] i18n 中英键数一致
- [ ] 375px 下资产、负债、通知、审计四页无整页横向滚动
- [ ] 文档四处不一致已修正

---

## 十七、交付标准与后续衔接

### 功能交付

1. 用户的备份与导出包含标的计价、标签关联、组合目标权重、分类规则、导入模板、对账记录、资产与负债、汇率；解包可逐域核对。
2. 恢复旧版（v1）备份时，缺失域在确认前以列表明示，恢复后对应模块为空但数据不被破坏。
3. 用户可登记房产、车辆等非交易型资产并记录估值历史；净资产分三栏展示，未估值资产显式列出。
4. 用户可登记房贷等负债并记录余额快照；负债分两栏展示。
5. 生产环境配置 SMTP 后，密码重置与邮箱验证邮件真实可达。
6. 用户可发起注销申请，7 天内可撤销；管理员批准后账号禁用、数据保留、全程审计。
7. 导出、备份、恢复、任务失败、邮箱验证、注销审批均有站内通知，支持未读数与一键已读。
8. 仪表板可见预算预警与目标进度；个人审计页可查敏感操作。
9. 复利模拟支持递增定投、提款阶段、税费与目标反推，旧场景结果保持不变。

### 质量要求

1. 备份与导出不得再出现「有表无域」的遗漏；测试必须逐域断言条数。
2. 资产与负债不得进入复式分录；`TransactionEntry.accountId` 不指向新表。
3. 净资产六项分项之和必须与总数严格相等（测试断言）。
4. 未估值资产、缺汇率资产不得以任何默认值充数。
5. 通知、邮件、验证的失败均不得阻断主业务。
6. 前七阶段全部测试通过，`compound-v1` 结果零变化。
7. 前端 lint 与测试可执行且通过。

### 已知取舍（需在文档与 UI 中明示）

| 取舍 | 影响 | 后续处理 |
|------|------|---------|
| 资产与负债不产生分录 | 无法像账户那样逐笔核对 | 用估值快照表达；UI 明示「快照不是流水」 |
| 购置价与原始本金仅作参考 | 无法据此推导当前价值 | UI 标注「不参与计算」 |
| 未录估值不计入净资产 | 资产可能暂时「消失」 | 以 `unpricedAssets` 明示并引导补录 |
| v1 备份不含新域 | 老包恢复后新模块为空 | 预览 warnings 逐项列出 |
| 邮箱验证不强制 | 存在未验证账号 | 默认关闭；开启后仅提示不阻断 |
| 注销为软删除 | 数据仍占用存储 | 物理擦除另行设计；文档明示 |
| 通知不发邮件 | 离线用户感知滞后 | 站内为唯一渠道；邮件只用于验证与重置 |
| 复利 v1 引擎冻结 | 旧场景不享受新参数 | 标注版本徽标；用户可复制为新场景 |
| 移除三个未使用前端依赖 | 若有外部插件引用会失效 | 项目内零引用，已确认 |

### 与后续阶段的衔接

| 后续阶段 | 建议内容 | 对 Phase 8 的依赖 |
|---------|---------|------------------|
| 凭证附件与交易拆分 | 文件存储配额、拆分与转账识别冲突语义 | 复用 mailer 之外的存储层；拆分需重新审视转账匹配 |
| 行情自动接入 | 价格提供方、复权、限流 | 直接改善「过期估值」与资产估值体验 |
| 用户物理删除与数据擦除 | 彻底删除、备份残留处理 | 依赖本阶段的软删除标记与备份域清单 |
| 对象存储与异地备份 | S3 适配器、定时上传 | 复用已补齐的 v2 备份包 |
| 管理后台安全事件中心 | 事件归集、告警、日志脱敏 | 复用通知与审计事件源 |
| 云端同步 | 增量同步、冲突合并 | 复用资产/负债实体域划分与备份域清单 |

### 需补齐的设计文档

| 文档 | 最晚需要时间 |
|------|-------------|
| 备份与导出包结构规范（域清单、版本矩阵、缺失域策略） | F1 开始前 |
| 资产与负债口径规范（估值取值、净资产分项、防重复计数） | F3 开始前 |
| 账户生命周期规范（验证开关、注销状态机、软删除边界） | F2 开始前 |
| 复利 v2 计算顺序与税费口径（结算顺序、税基、舍入） | F6 开始前 |
