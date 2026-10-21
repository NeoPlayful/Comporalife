# Phase 2 开发计划 — 银行账单导入与自动分类

> **对应项目**：Comporalife（复利人生）Personal 开源个人版
> **上游计划**：`docs/plan-phase1.md`（S1–S7 已完成，v0.1.0；本阶段交付于 v0.1.1）
> **技术栈**：沿用 Phase 1：Fastify 5 + TypeScript + Prisma 6 + PostgreSQL 16 + Redis 7 + React 19 + Vite + Tailwind CSS 4 + ECharts 6
> **文档版本**：v2.0-plan
> **范围决策**：账单导入 + 自动分类规则 + 转账匹配；文件格式支持 CSV 与 XLSX（含 GBK 编码），不支持 OFX/QFX 与 PDF

---

## 一、Phase 2 目标

> **上传银行账单 → 识别编码与列 → 映射字段 → 预览校验 → 去重确认 → 批量入账 → 自动分类 → 撤销批次**

Phase 1 解决了「手工记账」的正确性。Phase 2 解决「数据从哪来」：让用户把银行导出的 CSV/XLSX 变成账本里的复式分录，并且**不重复记账、不把内部资金流动误算成支出**。

Phase 2 的核心不是文件解析本身，而是三件事：

1. **可追溯**：每一笔导入交易都能追溯到批次、原始行号和原文件。
2. **可纠错**：导入前可预览、可跳行、可改映射；导入后可撤销整批。
3. **不重复**：指纹去重必须能挡住重复上传，但**不能把同一天同金额的两笔真实交易错判为重复**。

### 核心原则

| 原则 | 说明 |
|------|------|
| **导入即记账，不分叉** | 导入结果写入与手工记账完全相同的 `transactions` + `transaction_entries`，不新增第二套流水表 |
| **先预览后提交** | 上传后文件只进入暂存区；未经映射、校验与确认，绝不写入账本 |
| **指纹只做「候选重复」** | 精确指纹命中才算确定重复；近似命中必须人工确认，宁多问不误删 |
| **撤销而非删除** | 批次撤销 = 冲正该批次创建的全部交易，保留批次与行记录用于审计 |
| **原始文件加密存放** | 文件落盘前 AES-256-GCM 加密，不进入静态目录，不进日志 |
| **解析内核纯函数** | 编码检测、日期/金额解析、表头推断、指纹计算均为无 IO 的纯函数，便于单测与复用 |
| **不做队列** | 文件与行数设硬上限，导入在请求内同步完成；BullMQ 与 Worker Threads 留给后续的蒙特卡罗 |
| **不自动建分类** | 导入不会凭空创建分类；分类来自规则或用户手工补录 |
| **币种不换算** | 账单币种必须与目标账户币种一致，不一致行报错，不做静默折算 |

---

## 二、Phase 2 开发阶段划分

```
P1 模型与存储 ──► P2 解析内核 ──► P3 批次生命周期 ──► P4 去重与提交
                                                          │
                                          P7 导入工作台 ◄─┤
                                                          │
                     P5 模板与分类规则 ─────────────────────┤
                     P6 转账匹配 ───────────────────────────┤
                                                          │
                                                          └──► P8 规则页与交付
```

| 阶段 | 内容 | 涉及模块 | 预期工时 |
|------|------|----------|---------|
| **P1 模型与存储** | 4 张新表、`transactions` 扩展字段、枚举、加密文件存储、导入配置项 | prisma + storage | 2-3 天 |
| **P2 解析内核** | 编码检测、CSV/XLSX 读取、分隔符与表头推断、日期/金额/方向解析、指纹计算（纯函数） | imports/parser | 4-5 天 |
| **P3 批次生命周期** | 上传、列表、详情、预览、映射、校验、取消、逐行错误 | imports | 4-5 天 |
| **P4 去重与提交** | 候选重复识别与确认、幂等提交、批次撤销、错误行导出 | imports + ledger | 4-5 天 |
| **P5 模板与分类规则** | 映射模板 CRUD、表头签名自动匹配、规则 CRUD、规则测试与批量执行 | imports + rules | 3-4 天 |
| **P6 转账匹配** | 候选配对、匹配/解除匹配、待处理流水查询 | ledger/transfers | 2-3 天 |
| **P7 前端导入工作台** | 上传、映射、虚拟化预览、重复确认、结果与错误下载、批次列表 | imports 页面 | 4-5 天 |
| **P8 规则页与交付** | 规则管理页、待匹配页、E2E、文档与示例账单 | 全项目 | 3-4 天 |

> **合计约 26-34 天（单人开发）**。解析与前端预览是本阶段两个主要不确定性，工时已含格式兼容性调试。
> **可并行点**：P5、P6 只依赖 P1 的模型，可与 P3/P4 并行；P7 的前端骨架可在 P3 接口冻结后先行。

### 阶段依赖说明

- P2 是纯函数层，**不依赖数据库**，可在 P1 迁移落地前先写测试用例与实现。
- P3 产出的 `import_rows` 是 P4 去重与 P7 预览的数据来源；`import_rows` 结构一旦冻结，P4/P7 才能并行。
- P4 的提交动作依赖 P5 的规则执行器，但按「无规则也能提交」设计，规则是可插拔后置步骤。
- P6 修改的是账本语义（两条普通流水合并为一条转账），必须在 P4 完成后做，否则导入与匹配互相干扰。
- P8 的待匹配页依赖 P6 的候选接口。

---

## 三、Phase 2 范围界定

### 交付范围

| 模块 | 交付内容 |
|------|---------|
| 文件导入 | CSV（UTF-8 / UTF-8 BOM / GBK / GB18030）与 XLSX（单表或多表选表） |
| 字段映射 | 日期、金额（单一有符号列或借贷两列）、借贷方向、币种、摘要、商户、余额、外部流水号 |
| 解析校验 | 编码、分隔符、表头行推断；逐行错误与原因；行数/大小限制 |
| 预览 | 映射后样本预览、分页浏览全部行、错误行汇总 |
| 去重 | 指纹精确重复、规则近似重复、人工确认保留或跳过 |
| 提交 | 幂等批量入账、单事务原子提交、自动套用分类规则 |
| 撤销 | 整批冲正，存在依赖时拒绝并列出原因 |
| 映射模板 | 保存、更新、删除、按表头签名自动推荐 |
| 分类规则 | 条件匹配（账户、方向、商户、摘要、金额区间）、动作（设分类、加标签）、优先级、测试、批量执行 |
| 转账匹配 | 跨账户等额反向流水配对、一键合并为转账、解除匹配 |
| 待处理 | 未分类、未匹配流水清单 |
| 运维 | 原始文件加密存储、保留期清理、导入审计 |

### 明确不交付（后续阶段）

| 能力 | 原因 |
|------|------|
| OFX / QFX / PDF 账单解析 | 每种格式需独立解析器与测试矩阵；PDF 本质是按银行模板的启发式解析，不承诺通用 |
| 银行直连、开放银行 API | 外部依赖，与自部署隐私定位冲突 |
| 正则条件规则 | 用户可写正则会带来 ReDoS 风险，且难以给出可解释的匹配原因 |
| 导入时自动创建分类 | 静默创建会污染分类树；规则只能引用已有分类 |
| 跨币种账单自动折算 | 会在导入阶段固化错误的汇率口径；币种不一致直接报错 |
| 投资交易专用导入（买卖、股息、成本基础） | 依赖 Phase 4 投资模型 |
| 异步导入任务与进度推送 | 本阶段用行数上限换取同步实现的简单性 |
| 原始文件下载接口 | 文件只用于服务端重解析与审计，不对外提供下载，减少泄露面 |
| 部分行撤销（撤销批次中的某几行） | 会产生难以解释的对账差异；只支持整批撤销 |
| 机器学习/智能分类 | 无训练数据与评估集，规则引擎已覆盖主要场景 |
| 账单余额与账户余额自动对账 | 余额列可用于提示，但不自动创建对账记录；对账仍是 Phase 1 的手工动作 |

> **口径说明**：以上推迟项属于《项目功能全面分析》中的个人版完整功能，属于**产品范围**而非**本阶段范围**。Phase 2 不修改功能文档。

---

## 四、数据模型设计

### 4.1 模型总览（新增 4 张表）

```
import_batches          导入批次、状态机与统计
import_rows             逐行原始值与规范化结果、错误、去重与入账结果
import_templates        用户保存的列映射模板与表头签名
classification_rules    自动分类规则（条件 + 动作 + 优先级）
```

并对已有表做**增量扩展**（不破坏 Phase 1 数据）：

```
transactions            新增 source / import_batch_id / import_fingerprint / external_id
users                   新增关系：importBatches / importTemplates / classificationRules
accounts                新增关系：importBatches
```

### 4.2 新增枚举

```prisma
enum ImportStatus {
  uploaded      // 文件已保存，尚未解析
  parsed        // 已解析出表头与原始行
  mapped        // 用户已确认列映射
  validated     // 校验完成，可提交
  committing    // 提交中（防并发重复提交）
  completed     // 已入账
  failed        // 解析或校验失败，不可继续
  cancelled     // 用户取消（未入账）
  rolled_back   // 已入账后撤销
}

enum ImportFormat {
  csv
  xlsx
}

enum ImportRowStatus {
  pending       // 解析完成但未校验
  valid         // 通过校验，待提交
  invalid       // 校验失败
  duplicate     // 精确重复，默认跳过
  suspected     // 疑似重复，需人工确认
  skipped       // 用户主动跳过
  imported      // 已写入账本
  failed        // 提交时失败
}

enum DuplicateKind {
  exact
  suspected
}

enum TransactionSource {
  manual
  import
}
```

### 4.3 模型定义

#### import_batches

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | uuid | 主键 |
| `userId` | uuid | 归属用户，级联删除 |
| `accountId` | uuid | 目标账户，级联删除 |
| `status` | ImportStatus | 状态机当前值，默认 `uploaded` |
| `originalFilename` | varchar(255) | 仅用于展示；落盘文件名由服务端生成 |
| `fileSize` | int | 字节数 |
| `fileSha256` | char(64) | 原文件哈希，用于「同一文件重复上传」提示 |
| `storageKey` | varchar(255) | 加密文件在存储卷中的相对路径 |
| `encryptionIv` | varchar(64) | GCM nonce（base64） |
| `encryptionTag` | varchar(64) | GCM 认证标签（base64） |
| `format` | ImportFormat | csv / xlsx |
| `encoding` | varchar(16) | `utf-8` / `gb18030`；XLSX 为 `-` |
| `delimiter` | char(1) | 仅 CSV |
| `sheetName` | varchar(100)? | 仅 XLSX |
| `headerRow` | int? | 表头所在行号（1 基） |
| `templateId` | uuid? | 使用的映射模板 |
| `mapping` | jsonb? | 已确认的列映射与解析选项 |
| `totalRows` | int | 数据行数（不含表头） |
| `validRows` / `invalidRows` / `duplicateRows` / `suspectedRows` / `skippedRows` / `importedRows` | int | 统计快照，校验与提交后更新 |
| `failureReason` | text? | 失败原因（脱敏，不含行内容） |
| `committedAt` / `rolledBackAt` / `cancelledAt` | timestamptz? | 关键状态时间 |
| `version` | int | 乐观锁，状态推进时自增 |
| `createdAt` / `updatedAt` | timestamptz | |

索引：`[userId, createdAt desc]`、`[userId, status]`、`[userId, fileSha256]`。

#### import_rows

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | uuid | 主键 |
| `batchId` | uuid | 级联删除 |
| `userId` | uuid | 冗余存储，便于越权过滤与批量清理 |
| `rowNumber` | int | 原文件行号（1 基，含表头偏移） |
| `raw` | jsonb | **列名 → 原始字符串**；不存整行二进制，不改写原值 |
| `occurredAt` | timestamptz? | 规范化后的时间（按用户时区） |
| `amount` | decimal(20,6)? | 规范化金额，正数表示流入，负数表示流出 |
| `currency` | char(3)? | |
| `description` | text? | |
| `merchant` | text? | |
| `externalId` | varchar(128)? | 银行流水号/交易编号 |
| `balanceAfter` | decimal(20,6)? | 账单余额列，仅用于提示，不参与记账 |
| `direction` | varchar(8)? | `income` / `expense` |
| `fingerprint` | char(64)? | 指纹；无法计算时为 NULL |
| `status` | ImportRowStatus | 默认 `pending` |
| `errors` | jsonb? | `[{ field, code, message }]`，最多保留 10 条 |
| `transactionId` | uuid? | 提交后关联的交易 |
| `duplicateKind` | DuplicateKind? | |
| `duplicateOfId` | uuid? | 命中的已有交易 ID |
| `createdAt` | timestamptz | |

索引：`[batchId, rowNumber]`、`[batchId, status]`、`[userId, fingerprint]`。
**约束**：`(batchId, rowNumber)` 唯一，防止重复解析产生重复行。

#### import_templates

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | uuid | |
| `userId` | uuid | |
| `name` | varchar(80) | 用户名下的模板名，唯一 |
| `bankName` | varchar(80)? | 展示用，不参与匹配 |
| `format` | ImportFormat | |
| `headerSignature` | char(64) | 表头规范化后的哈希，用于自动推荐 |
| `mapping` | jsonb | 列映射 + 解析选项（日期格式、金额模式等） |
| `createdAt` / `updatedAt` | timestamptz | |

唯一约束：`[userId, name]`；索引：`[userId, format, headerSignature]`。

#### classification_rules

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | uuid | |
| `userId` | uuid | |
| `name` | varchar(80) | 唯一 |
| `priority` | int | 越小越优先，同级按 `createdAt` |
| `enabled` | boolean | 默认 true |
| `conditions` | jsonb | 见 5.7 |
| `actions` | jsonb | 见 5.7 |
| `matchCount` | int | 累计命中次数，仅统计 |
| `lastAppliedAt` | timestamptz? | |
| `createdAt` / `updatedAt` | timestamptz | |

唯一约束：`[userId, name]`；索引：`[userId, priority]`。

### 4.4 transactions 扩展

| 新增字段 | 类型 | 说明 |
|---------|------|------|
| `source` | TransactionSource | 默认 `manual`；导入为 `import` |
| `importBatchId` | uuid? | 批次归属，批次删除时 `SetNull`（但批次不物理删除） |
| `importFingerprint` | char(64)? | 唯一约束 `[userId, importFingerprint]` |
| `externalId` | varchar(128)? | 银行流水号 |
| `balanceAfter` | decimal(20,6)? | 导入时保留的账单余额，仅作参考 |

**迁移策略**：全部为可空字段或带默认值，现有 41 条流水自动成为 `source = manual`，无需回填脚本。

**唯一索引的取舍**：Postgres 允许唯一索引中有多个 NULL，因此手工交易（`importFingerprint = NULL`）不受约束。冲正一笔导入交易时，**必须将 `importFingerprint` 置空**，否则同一笔账单永远无法重新导入；原始指纹保留在 `import_rows.fingerprint` 中，审计链不断。

---

## 五、关键设计决策

| # | 决策点 | 结论 | 理由 |
|---|--------|------|------|
| 1 | 导入写哪张表 | 复用 `transactions` + `transaction_entries` | 避免两套账本导致余额口径分裂 |
| 2 | 文件存储 | 本地卷 + AES-256-GCM，按用户分目录 | 自部署无对象存储；密钥来自环境变量，不落库 |
| 3 | 解析时机 | 上传即解析表头与全部行，存入 `import_rows` | 映射与预览都基于已存的规范化数据，避免重复解析 |
| 4 | 行数上限 | 20,000 行 / 10 MB | 保证单事务提交在可接受时间内完成 |
| 5 | 提交原子性 | 单事务写入，失败整体回滚 | 半成功批次比失败更难解释 |
| 6 | 幂等 | 提交接口要求 `Idempotency-Key` + 批次状态守卫 + 指纹唯一索引 | 三重防重，任何一层失效都不会重复记账 |
| 7 | 重复判定 | 精确指纹 → 自动标记；近似 → 人工确认 | 同金额同日期可能是两笔真实交易 |
| 8 | 日期歧义 | 强制用户选择格式，预览实时展示解析结果 | 绝不猜测 DD/MM 与 MM/DD |
| 9 | 金额解析 | 统一走 `Decimal`，禁止 `parseFloat` | 与 Phase 1 金额口径一致 |
| 10 | 时区 | 日期按用户时区当日零点，存 UTC | 与 Phase 1 月度统计口径一致 |
| 11 | 分类规则 | 只做确定性匹配，不支持正则 | 可解释、可测试、无 ReDoS |
| 12 | 规则执行 | 分类取最高优先级首个命中；标签取全部命中的并集 | 分类互斥，标签可叠加 |
| 13 | 转账匹配 | 新建转账交易 + 冲正两条原流水 | 保持「转账是一条两腿交易」的模型不变 |
| 14 | 解除匹配 | 冲正转账 + 重建两条普通流水（新 ID） | 不复活已冲正记录，避免审计歧义 |
| 15 | 批次撤销 | 仅整批；有依赖则拒绝 | 部分撤销无法对账 |
| 16 | 异步 | 不引入 | 有行数上限，同步足够 |
| 17 | 原始文件保留 | 默认提交后 30 天清理文件，保留批次与行记录 | 兼顾审计与隐私 |

### 5.1 批次状态机

```
uploaded ──parse──► parsed ──map──► mapped ──validate──► validated ──commit──► committing ──► completed
   │                   │               │                    │                                   │
   └─────fail──────────┴─────fail──────┴──────fail──────────┘                                   │
   │                                                                                            │
   └──cancel──► cancelled ◄──cancel────┘                                                        │
                                                                                                │
                                              committed 的批次 ──rollback──► rolled_back ◄───────┘
```

| 当前状态 | 允许动作 | 非法动作返回 |
|---------|---------|-------------|
| `uploaded` | 解析、取消 | 映射/校验/提交 → 409 `IMPORT_STATE_CONFLICT` |
| `parsed` | 设置映射、重新解析（换表/换编码）、取消 | 提交 → 409 |
| `mapped` | 校验、改映射、取消 | 提交 → 409 |
| `validated` | 提交、改映射（回到 `mapped`）、取消 | 重复校验允许，结果幂等 |
| `committing` | 无（进行中） | 任何写操作 → 409 `IMPORT_STATE_CONFLICT` |
| `completed` | 撤销 | 重新提交 → 409 |
| `rolled_back` | 无 | 409 |
| `failed` / `cancelled` | 无（只能重新上传） | 409 |

> `committing` 状态由数据库条件更新 `WHERE status = 'validated'` 抢占，避免并发提交。若进程崩溃残留 `committing`，提供 `committing` 超过 10 分钟的自动回落规则（启动时与每次读取批次时检查）。

### 5.2 事务边界

- **上传**：写文件 → 创建批次 → 解析 → 写行 → 更新为 `parsed`。解析失败则批次 `failed`，文件保留供排查 7 天。
- **映射/校验**：只更新 `import_rows` 的规范化字段与状态，不碰账本。
- **提交**：`import_batches` 状态抢占 → 单事务内创建全部交易与分录 → 回写 `import_rows.transactionId` 与状态 → 更新统计与 `completed`。
- **撤销**：单事务内冲正全部批次交易（并清空其 `importFingerprint`）→ 写审计 → 批次 `rolled_back`。

### 5.3 指纹算法

```
fingerprint = SHA-256( join('|', [
  userId,
  accountId,
  occurredAtUtcDate,          // YYYY-MM-DD，用户时区下的日期
  amount.toFixed(6),          // 带符号的规范金额
  currency,
  externalId ?? normalizedDescription
]) )
```

- 有 `externalId` 时**不**纳入描述，避免银行改写摘要造成漏判。
- 无 `externalId` 时纳入描述与 `balanceAfter`（若存在），降低「同额同日不同笔」的误判。
- 描述规范化：去首尾空白、压缩连续空白、全角转半角、转小写、去除尾部「-」流水后缀。
- 指纹**只用于导入交易**；手工交易不生成指纹。

### 5.4 重复判定分级

| 级别 | 条件 | 默认处置 |
|------|------|---------|
| `exact` | 指纹与已有 `posted` 导入交易完全一致 | 自动标记 `duplicate`，不可提交，除非用户在重复确认中改为「保留」 |
| `suspected` | 同账户 + 同日 + 同金额 + 同方向，但描述/外部号不同 | 标记 `suspected`，必须逐条确认（保留或跳过）后才能提交 |
| 无 | 其他情况 | 正常 `valid` |

> **原则**：宁可多问一次，不可静默丢数据。`suspected` 未确认时提交返回 409 `IMPORT_DUPLICATE_CONFIRMATION_REQUIRED` 并附未确认行号。

### 5.5 撤销的依赖检查

撤销前逐条检查批次内交易：

| 依赖 | 判定 | 结果 |
|------|------|------|
| 已被手工修改 | `version > 1` | 阻止 |
| 已被匹配为转账 | 交易的 `id` 出现在任一转账的关联记录中 | 阻止 |
| 已用于对账 | 同账户在批次 `committedAt` 之后存在对账记录 | 阻止 |
| 已冲正 | `status = 'voided'` | 允许（跳过并计数） |
| 其他 | — | 允许 |

返回结构包含 `blockedTransactions: [{ id, reason }]`，前端展示原因并提示先解除依赖。

### 5.6 安全与隐私

| 风险 | 处置 |
|------|------|
| 恶意文件 | 扩展名 + MIME + magic bytes 三重校验；CSV 仅允许文本，XLSX 校验 zip 头 |
| zip 炸弹 | XLSX 解压后总大小上限 200 MB，超限拒绝 |
| 路径穿越 | 落盘名由服务端生成（`batchId`），原始文件名只存库不用于路径 |
| 公式注入 | 读 XLSX 时关闭公式求值（`cellFormula: false`）；导出错误 CSV 时对 `=+-@` 前缀加 `'` |
| 文件泄露 | 不提供下载；存储目录不挂载到 Nginx；文件加密且密钥不落库 |
| 日志泄露 | 不记录行内容、文件名以外的文件元数据、账户号；只记录批次 ID 与计数 |
| 越权 | 所有批次/模板/规则查询强制 `userId` 过滤，跨用户一律 404 |
| 滥用 | 上传限流 10 次/小时/用户；解析与提交走全局限流 |
| ReDoS | 规则不支持正则表达式 |
| 审计 | `import.committed`、`import.rolled_back`、`import.cancelled`、`rules.applied` 写 `audit_logs`，只记录 ID 与计数 |

### 5.7 分类规则模型

```jsonc
// conditions：所有字段可选，logic 决定组合方式
{
  "logic": "all",                       // all | any
  "accountIds": ["uuid"],               // 限定账户
  "directions": ["expense"],            // income | expense
  "merchant":    { "op": "contains", "value": "星巴克" },
  "description": { "op": "startsWith", "value": "美团" },
  "amount": { "min": "0", "max": "1000" },   // 规范金额绝对值
  "onlyUncategorized": true
}

// actions：至少一项
{
  "categoryId": "uuid",
  "addTagIds": ["uuid"],
  "markReviewed": true
}
```

- `op` 仅允许 `equals` / `contains` / `startsWith`，大小写不敏感，长度上限 100。
- 分类必须存在、未归档，且 `kind` 与流水方向一致；不一致时规则校验失败（`RULE_INVALID`），不会在运行时静默跳过。
- 执行顺序：按 `priority` 升序；**分类由首个命中且设置了分类的规则决定**，标签与 `markReviewed` 累加。
- 规则仅作用于 `posted` 且 `source = import` 的交易；批量执行时可选择包含手工流水。

---

## 六、解析内核规范（`modules/imports/parser/`）

### 6.1 模块划分（全部纯函数）

| 文件 | 职责 |
|------|------|
| `encoding.ts` | BOM 识别、UTF-8 严格解码探测、GB18030 回退、用户覆盖 |
| `csv.ts` | 分隔符推断、引号与换行处理、行迭代 |
| `xlsx.ts` | 工作表枚举、行读取、单元格转字符串 |
| `header.ts` | 表头行推断、表头签名生成 |
| `field-map.ts` | 列名同义词匹配与候选映射 |
| `date.ts` | 多格式日期解析 |
| `amount.ts` | 金额、正负号、千分位、括号、双列借贷 |
| `fingerprint.ts` | 描述规范化与指纹计算 |

### 6.2 编码检测

```
1. 读取前 4 字节判断 BOM：EF BB BF → UTF-8（剥离 BOM）
2. 用 TextDecoder('utf-8', { fatal: true }) 解码；成功 → utf-8
3. 失败则用 TextDecoder('gb18030') 解码；再验证解码结果不含 U+FFFD
4. 二者都失败 → 422 IMPORT_PARSE_FAILED（不猜测）
```

允许用户在上传时强制指定编码；强制指定优先于检测结果。**不接受** UTF-16（银行导出罕见，且易与二进制混淆）。

### 6.3 CSV 读取

- 分隔符候选：`,` `;` `\t` `|`，取前 10 行中各候选出现次数的众数且方差最小者。
- 引号：`"` 包裹，支持 `""` 转义；引号内的换行不切行。
- `relax_column_count: true`：列数不齐的行保留并标记 `COLUMN_COUNT_MISMATCH`，不整文件失败。
- `skip_empty_lines: true` 但**保留行号**；空行不计入 `totalRows`。
- 全空行、仅分隔符行 → 直接丢弃并计入 `skippedRows`。

### 6.4 XLSX 读取

- `sheetRows` 上限 20,001（含表头），超出报 `IMPORT_ROW_LIMIT_EXCEEDED`。
- 只读单元格值，关闭公式、样式、HTML、VBA。
- 日期单元格：若单元格本身是日期类型，直接取日期值；文本日期走 `date.ts`。
- 多工作表时：默认取第一个非空表，前端允许切换后重新解析。

### 6.5 表头推断

```
score(row) = 非空且互不相同的单元格数 − 全数字单元格数
候选行 = 前 20 行中 score 最大且 score >= 2 的行
若并列 → 取行号最小者
用户可手动指定 headerRow，覆盖推断结果
```

表头签名 = `SHA-256(表头单元格规范化后按顺序 join('|'))`，用于模板自动推荐。

### 6.6 字段同义词

| 规范字段 | 同义词（大小写、全半角不敏感） |
|---------|------------------------------|
| `occurredAt` | 日期, 交易日期, 记账日期, 发生日期, date, transaction date, posting date, 时间 |
| `amount` | 金额, 交易金额, 发生额, amount, 金额(元) |
| `debit` | 支出, 借方, 付款, 转出, debit, withdrawal |
| `credit` | 收入, 贷方, 收款, 转入, credit, deposit |
| `direction` | 方向, 收支, 借贷, direction, type |
| `currency` | 币种, 货币, currency, ccy |
| `description` | 摘要, 备注, 交易说明, 用途, description, memo, narrative |
| `merchant` | 商户, 对方户名, 交易对方, 对手方, merchant, payee |
| `externalId` | 流水号, 交易号, 交易编号, 参考号, reference, transaction id |
| `balanceAfter` | 余额, 账户余额, 交易后余额, balance |

同义词命中多个时，取第一个未被占用的列并在前端高亮提示「自动推断，请确认」。

### 6.7 日期解析

支持的格式（用户必须选择其一，或选择「自动」并逐行记录实际格式）：

| 格式 | 示例 |
|------|------|
| `YYYY-MM-DD` | 2026-03-01 |
| `YYYY/MM/DD` | 2026/03/01 |
| `YYYYMMDD` | 20260301 |
| `DD/MM/YYYY` | 01/03/2026 |
| `MM/DD/YYYY` | 03/01/2026 |
| `YYYY-MM-DD HH:mm` / `YYYY-MM-DD HH:mm:ss` | 2026-03-01 09:30:00 |

规则：

1. 仅日期时，按用户时区当日 `00:00:00` 解析后转 UTC 存储。
2. 「自动」模式下，只在**无歧义**时接受（日 > 12 可判定为 DD/MM）；存在歧义则报 `DATE_AMBIGUOUS`，要求用户显式选择。
3. 年份 < 1970 或 > 当前年 + 1 → `DATE_OUT_OF_RANGE`。
4. 非法日期（2 月 30 日）→ `DATE_INVALID`。

### 6.8 金额解析

```
输入示例： "1,234.56"  "¥1,234.56"  "-123.45"  "(123.45)"  "123.45-"  "−123.45"
1. 去空白与货币符号（¥ $ € £ ￥）
2. 去千分位逗号；去除 RMB/CNY 等前缀文本
3. 括号包裹 → 负数；尾部/前部负号 → 负数；Unicode 减号归一
4. 用 Decimal 构造，禁止 Number()
5. 小数位 > 6 → AMOUNT_PRECISION_INVALID
6. 空值或无法解析 → AMOUNT_INVALID
```

**两种金额模式**：

- **单列有符号**：金额列直接决定正负。
- **借贷双列**：`amount = credit − debit`；两列都非空且非零 → `AMOUNT_CONFLICT`；两列都空 → 该行无效。

**方向推导**：`amount > 0` → `income`，`amount < 0` → `expense`，`amount = 0` → `AMOUNT_ZERO_INVALID`（零金额交易不入账）。

### 6.9 行校验规则

| 错误码 | 触发条件 |
|--------|---------|
| `DATE_INVALID` / `DATE_AMBIGUOUS` / `DATE_OUT_OF_RANGE` | 见 6.7 |
| `AMOUNT_INVALID` / `AMOUNT_PRECISION_INVALID` / `AMOUNT_CONFLICT` / `AMOUNT_ZERO_INVALID` | 见 6.8 |
| `CURRENCY_MISMATCH` | 行币种与账户币种不一致 |
| `CATEGORY_UNKNOWN` | 映射中指定了分类但不存在（正常导入不使用此字段） |
| `COLUMN_COUNT_MISMATCH` | 列数与表头不一致 |
| `ROW_TOO_LONG` | 单行超过 8 KB |
| `DUPLICATE_IN_FILE` | 同一批次内指纹重复（第 2 次及以后标记） |

> 单行错误不阻断其他行；错误行不参与提交。批次只有在 `validRows > 0` 时才允许进入 `validated`。

---

## 七、P1 — 模型与存储

### 7.1 数据库

- [ ] `schema.prisma` 新增 6 个枚举与 4 张表，`transactions` 增加 5 个字段
- [ ] 迁移必须为纯增量：不重命名、不改类型、不删除既有列
- [ ] 为 `transactions` 加唯一索引 `[userId, importFingerprint]`
- [ ] 为 `import_rows` 加唯一约束 `[batchId, rowNumber]`
- [ ] 迁移后执行 `prisma migrate dev`，确认现有 121 条测试数据与演示数据不受影响

### 7.2 文件存储 `src/lib/file-storage.ts`

```ts
interface StoredFile {
  storageKey: string;
  iv: string;
  tag: string;
  size: number;
  sha256: string;
}

saveEncrypted(buffer: Buffer, userId: string): Promise<StoredFile>
readEncrypted(stored: Pick<StoredFile, 'storageKey' | 'iv' | 'tag'>): Promise<Buffer>
deleteStored(storageKey: string): Promise<void>
```

- 目录：`${FILE_STORAGE_DIR}/imports/${userId}/${batchId}.bin`，目录权限 `0700`（容器内非 root 用户）。
- 密钥：`FILE_ENCRYPTION_KEY`，32 字节 base64；启动时校验长度，缺失则启动失败。
- GCM nonce 每次写入随机生成；AAD 使用 `userId + batchId`，防止文件被跨用户替换。

### 7.3 配置

新增环境变量（同步写入 `.env.example` 与 README）：

```env
FILE_STORAGE_DIR=./data/imports
FILE_ENCRYPTION_KEY=            # base64 编码的 32 字节密钥
IMPORT_MAX_FILE_MB=10
IMPORT_MAX_ROWS=20000
IMPORT_FILE_RETENTION_DAYS=30
IMPORT_ROW_RETENTION_DAYS=365
```

`src/config/constants.ts` 增加导入相关常量与 `IMPORT_ROW_ERROR_LIMIT = 10`。

### 7.4 能力声明

`/api/system/capabilities` 的 `available` 增加 `imports`、`import-templates`、`classification-rules`、`transfer-matching`，并从 `planned` 移除 `imports`。

### 7.5 清理任务

`src/modules/imports/cleanup.ts`：

- 每次上传前、每日定时（启动时注册 `setInterval`，24 小时）执行：
  1. 删除 `completed` 且 `committedAt` 超过 `IMPORT_FILE_RETENTION_DAYS` 的加密文件，`storageKey` 置为 `purged`；
  2. 删除 `createdAt` 超过 `IMPORT_ROW_RETENTION_DAYS` 的 `import_rows`（批次统计保留）；
  3. 删除 `failed` 且超过 7 天的文件。
- 清理失败只记录警告，不影响服务启动。

---

## 八、P2 — 解析内核

### 8.1 接口

```ts
// parser/index.ts
interface ParseInput {
  buffer: Buffer;
  format: 'csv' | 'xlsx';
  encoding?: 'utf-8' | 'gb18030';
  sheetName?: string;
  rowLimit: number;
}

interface ParsedFile {
  format: 'csv' | 'xlsx';
  encoding: 'utf-8' | 'gb18030' | '-';
  delimiter?: string;
  sheetNames?: string[];
  sheetName?: string;
  headerRow: number;
  headers: string[];
  headerSignature: string;
  rows: Array<{ rowNumber: number; cells: string[] }>;
  truncated: boolean;
}

parseFile(input: ParseInput): Promise<ParsedFile>
```

### 8.2 映射与规范化

```ts
interface ColumnMapping {
  occurredAt: number;              // 列索引
  amountMode: 'signed' | 'debitCredit';
  amount?: number;                 // signed 模式
  debit?: number;                  // debitCredit 模式
  credit?: number;
  currency?: number;
  description?: number;
  merchant?: number;
  externalId?: number;
  balanceAfter?: number;
  dateFormat: DateFormat;
}

normalizeRows(parsed, mapping, context: { accountCurrency; timezone }): NormalizedRow[]
```

`context.timezone` 来自 `user_settings.timezone`，不得取自客户端。

### 8.3 单元测试矩阵

| 用例 | 输入 | 断言 |
|------|------|------|
| UTF-8 带 BOM | 含 `EF BB BF` | 首列表头无不可见字符 |
| GBK 编码 | GB18030 编码的中文表头 | 正确解码 |
| 分隔符 | 逗号/分号/制表符/竖线 | 推断正确 |
| 引号内换行 | `"多行\n备注"` | 不被切成两行 |
| 列数不齐 | 第 3 行缺一列 | 该行 `COLUMN_COUNT_MISMATCH`，其他行正常 |
| 表头行不在首行 | 前两行是账户信息 | `headerRow = 3` |
| 金额格式 | 8 种示例 | 全部得到预期符号与数值 |
| 借贷双列 | 仅 debit 非空 | 金额为负 |
| 借贷双列冲突 | 两列均非零 | `AMOUNT_CONFLICT` |
| 日期歧义 | `03/04/2026` + auto | `DATE_AMBIGUOUS` |
| 日期显式 | `DD/MM/YYYY` | 解析为 4 月 3 日 |
| 时区 | 用户 `Asia/Shanghai`，账单 2026-03-01 | 存储为 `2026-02-28T16:00:00Z` |
| 指纹稳定性 | 同一行两次计算 | 结果完全相同 |
| 描述规范化 | 全角空格、大小写、尾部流水号 | 规范化后一致 |
| 超行数 | 20,001 行 | `IMPORT_ROW_LIMIT_EXCEEDED` |

### 8.4 测试夹具

`server/tests/fixtures/imports/` 下放置**虚构**账单：

```
utf8-basic.csv          全角符号与中文表头
gbk-basic.csv           GB18030 编码
semicolon.csv           分号分隔
quoted-multiline.csv    引号内换行
debit-credit.csv        借贷两列
xlsx-multi-sheet.xlsx   两个工作表
xlsx-dates.xlsx         日期型单元格
malformed.csv           列数缺失与非法日期
```

> 夹具中不得包含真实银行账号、真实姓名与真实金额；统一使用「示例银行」「张三」「1,234.56」这类虚构数据。

---

## 九、P3 — 批次生命周期

### 9.1 后端接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/imports/upload` | multipart 上传，返回批次 ID 与解析摘要 |
| GET | `/api/imports` | 批次列表，按创建时间倒序，分页 |
| GET | `/api/imports/:id` | 批次详情、统计、映射、可用动作 |
| GET | `/api/imports/:id/preview` | 映射后预览（默认 100 行，可翻页） |
| GET | `/api/imports/:id/rows` | 全量行分页查询（含状态与错误） |
| PATCH | `/api/imports/:id/mapping` | 设置映射与解析选项，触发重新规范化 |
| POST | `/api/imports/:id/validate` | 校验并统计，推进到 `validated` |
| POST | `/api/imports/:id/cancel` | 取消未提交批次 |
| GET | `/api/imports/:id/errors` | 错误行汇总（按错误码分组 + 前 N 行） |

### 9.2 上传实现

```
1. 认证 + 限流（10 次/小时/用户）
2. multipart 单文件：检查大小 <= IMPORT_MAX_FILE_MB
3. 校验扩展名与 magic bytes：
   csv → 文本（无 NUL 字节）
   xlsx → 50 4B 03 04（zip 头）
4. 创建批次（status=uploaded），生成 batchId
5. 加密落盘（AAD = userId + batchId）
6. 解析：
   a. 推断编码/分隔符/表头
   b. 行数超限 → failed(IMPORT_ROW_LIMIT_EXCEEDED) 并返回明确提示
   c. 写入 import_rows（raw 为字符串映射），分批 createMany（每批 500）
   d. 计算表头签名，匹配用户模板 → 若命中，自动填入 mapping（仍需用户确认）
   e. status = parsed，写统计
7. 返回批次摘要
```

**同一文件重复上传**：若同用户 `fileSha256` 已存在且状态为 `completed`，返回 409 `IMPORT_ALREADY_UPLOADED` 并附已有批次 ID（允许用户强制重新上传，参数 `force=true`）。

### 9.3 映射接口

```jsonc
// PATCH /api/imports/:id/mapping
{
  "version": 3,
  "mapping": {
    "occurredAt": 0,
    "amountMode": "signed",
    "amount": 2,
    "currency": 3,
    "description": 4,
    "externalId": 5,
    "dateFormat": "YYYY-MM-DD"
  },
  "headerRow": 1
}
```

- 必填项：`occurredAt`、金额来源、`dateFormat`、至少一个描述类字段（`description` 或 `merchant`）。
- 列索引越界、重复占用同一列、缺少必填项 → 422 `IMPORT_MAPPING_INVALID`，附字段级错误。
- 保存映射后重新规范化全部 `pending` 行，已 `skipped` 的行保持跳过。
- 映射变更使批次回退到 `mapped`，并清空此前的校验结果。

### 9.4 校验

```
1. 要求 status ∈ {mapped, validated}
2. 对每行执行校验规则（6.9），写 status / errors
3. 计算指纹（成功解析的行）
4. 精确指纹查库 → duplicate；近似条件查库 → suspected
5. 同一批次内指纹重复 → 第 2 次起 DUPLICATE_IN_FILE
6. 汇总统计，validRows > 0 → validated；否则 failed
7. 返回统计、错误分组与前 20 条错误行
```

> 去重的**正式判定**在 P4 的提交前重新执行一次，因为校验与提交之间账本可能变化。

### 9.5 边界状态

| 场景 | 行为 |
|------|------|
| 空文件 / 0 数据行 | 422 `IMPORT_EMPTY` |
| 只有表头 | 422 `IMPORT_EMPTY` |
| 全部行无效 | 批次 `failed`，返回第一页错误 |
| 文件加密失败 | 批次 `failed`，删除半成品文件 |
| 解析超时（> 30 秒） | 终止并 `failed`，提示拆分文件 |
| 用户删除目标账户 | 批次保留，后续操作返回 409（账户不存在） |
| 目标账户归档 | 上传与提交均拒绝，`ACCOUNT_ARCHIVED` |
| 重新上传同文件 | 409 `IMPORT_ALREADY_UPLOADED`（可强制） |

---

## 十、P4 — 去重与提交

### 10.1 后端接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/imports/:id/duplicates` | 重复分组（exact / suspected）与命中交易摘要 |
| PATCH | `/api/imports/:id/duplicates` | 批量确认：保留或跳过指定行 |
| POST | `/api/imports/:id/commit` | 幂等提交，返回导入结果 |
| POST | `/api/imports/:id/rollback` | 整批撤销 |
| GET | `/api/imports/:id/errors/export` | 导出错误行 CSV |

### 10.2 重复确认

```jsonc
// PATCH /api/imports/:id/duplicates
{
  "decisions": [
    { "rowId": "uuid", "action": "keep" },   // 保留：status → valid
    { "rowId": "uuid", "action": "skip" }    // 跳过：status → skipped
  ]
}
```

- 仅 `duplicate` 与 `suspected` 行可设置。
- `exact` 默认 `skip`；用户可以改成 `keep`，但响应中返回 `warning: "与已有交易完全一致"`。
- 未确认的 `suspected` 行会阻止提交。

### 10.3 提交

```
1. 校验 Idempotency-Key（缺失 → 400）
2. 条件更新抢占：UPDATE import_batches SET status='committing'
   WHERE id = ? AND userId = ? AND status = 'validated'
   影响行数 0 → 409 IMPORT_STATE_CONFLICT
3. 重新执行去重判定；若出现新的 suspected 未确认 → 回退状态并 409
4. 读取 account（active、币种）与用户时区
5. 单事务：
   a. 对每行 status ∈ {valid} 创建 transaction + 两条分录
      - source = 'import'
      - importBatchId、importFingerprint、externalId、balanceAfter
      - occurredAt 来自行数据，description 来自映射
      - categoryId = NULL（分类交给规则或人工）
   b. 分批 createMany（每批 500 行）后回填 import_rows.transactionId
   c. 执行启用的分类规则（见 10.4）
   d. 更新 import_rows.status = 'imported'
   e. 更新批次统计、committedAt、status = 'completed'
   f. 写审计 import.committed（只记批次 ID 与计数）
6. 缓存幂等响应（24h）
7. 返回导入结果统计与未分类数量
```

**单事务与行数上限的关系**：20,000 行 × 2 条分录在单事务内的写入时间在本地环境下约 3–6 秒。若压测超过 10 秒，**降低上限**而不是改成非原子提交——原子性优先于吞吐。

### 10.4 规则执行

```
对本次导入的每笔交易：
  1. 规则按 priority 升序
  2. 分类：首个命中且 actions.categoryId 非空的规则决定，后续规则不再改分类
  3. 标签：所有命中规则的 addTagIds 取并集
  4. markReviewed：任一命中即置位（Phase 2 用 note 不变，仅在行记录中标记）
  5. 命中计数 matchCount += 1（批量更新，不逐条写）
```

规则执行失败不回滚提交，但记录警告到批次 `failureReason`（例如某分类已被归档）。

### 10.5 撤销

```
1. 要求 status = 'completed'
2. 依赖检查（5.5）：存在阻塞 → 409 IMPORT_ROLLBACK_BLOCKED + blockedTransactions
3. 单事务：
   a. 批次内 posted 交易 → status='voided'、voidedAt、version+1、importFingerprint=NULL
   b. 写审计 import.rolled_back
   c. 批次 status='rolled_back'、rolledBackAt
4. 不删除 import_rows；transactionId 保留指向已冲正交易
```

### 10.6 错误导出

- `text/csv; charset=utf-8`，带 BOM，便于 Excel 直接打开中文。
- 列：`行号, 错误码, 错误说明, 原始值`。
- 原始值做公式注入转义（`= + - @` 前加 `'`）。
- 单次导出上限 20,000 行；文件名 `import-errors-<batchId>.csv`。

### 10.7 边界状态

| 场景 | 行为 |
|------|------|
| 重复提交（同一幂等键） | 返回缓存结果，200 |
| 幂等键相同但批次不同 | 409 `IDEMPOTENCY_CONFLICT` |
| 提交中进程崩溃 | `committing` 超 10 分钟自动回落到 `validated`（事务本身已回滚） |
| 提交时账户被归档 | 409，批次回到 `validated` |
| 提交时发现新重复 | 409，批次回到 `validated` 并提示重新确认 |
| 撤销时批次交易已被手工修改 | 409 + 阻塞清单 |
| 撤销空批次 | 幂等返回成功 |
| 撤销后再次导入同一文件 | 允许（指纹已随冲正释放） |

---

## 十一、P5 — 映射模板与分类规则

### 11.1 模板接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/imports/templates` | 列表 |
| POST | `/api/imports/templates` | 创建（从批次或手工） |
| PATCH | `/api/imports/templates/:id` | 更新名称与映射 |
| DELETE | `/api/imports/templates/:id` | 删除（不影响已使用模板的批次） |

> 路由注册顺序：`/imports/templates` 必须在 `/imports/:id` 之前注册，否则会被参数路由吞掉。这是本阶段最容易踩的坑之一。

### 11.2 模板自动推荐

```
1. 计算上传文件的 headerSignature
2. 查 [userId, format, headerSignature] 命中的模板
3. 命中多个 → 取 updatedAt 最新者，前端提示「已套用模板 X，请确认」
4. 未命中 → 使用同义词自动推断（6.6）
```

### 11.3 规则接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/classification-rules` | 列表（含条件与动作摘要） |
| POST | `/api/classification-rules` | 创建 |
| GET | `/api/classification-rules/:id` | 详情 |
| PATCH | `/api/classification-rules/:id` | 更新条件、动作、启用状态 |
| DELETE | `/api/classification-rules/:id` | 删除 |
| POST | `/api/classification-rules/:id/test` | 试运行：返回命中交易样本（不写库） |
| POST | `/api/classification-rules/apply` | 批量执行：`{ transactionIds? , onlyUncategorized? }` |
| POST | `/api/classification-rules/reorder` | 批量更新优先级 |

### 11.4 规则校验

| 校验项 | 失败码 |
|--------|--------|
| 条件为空 | `RULE_INVALID`（至少一个条件，避免全量命中） |
| 动作全空 | `RULE_INVALID` |
| 分类不存在/已归档 | `RULE_INVALID` |
| 分类 kind 与 `directions` 不兼容 | `RULE_INVALID` |
| 标签不存在 | `RULE_INVALID` |
| `amount.min > amount.max` | `RULE_INVALID` |
| 字符串长度 > 100 | `RULE_INVALID` |

### 11.5 批量执行

```
1. 目标集合：指定 transactionIds（上限 500）或「全部未分类导入流水」
2. 只处理 posted 状态
3. 分类命中：仅当交易当前 categoryId 为 NULL 时设置（除非显式 overwrite=true）
4. 标签：并集写入，skipDuplicates
5. 单事务更新，返回 { matched, categorized, tagged, skipped }
6. 写审计 rules.applied（规则 ID 列表与计数）
```

### 11.6 规则批量更新性能

`matchCount` 不逐条累加，而是在执行结束后用一次 `updateMany` 增量更新（`matchCount: { increment: n }`）。

---

## 十二、P6 — 转账匹配

### 12.1 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/transactions/unmatched` | 待分类/待匹配流水（可筛选账户、日期区间） |
| POST | `/api/transfers/match` | 将两条流水合并为转账 |
| POST | `/api/transfers/:id/unmatch` | 解除匹配 |

### 12.2 候选配对

```
候选条件（必须全部满足）：
- 同一用户，两个不同账户
- 均为 posted，类型 ∈ {income, expense}
- 一正一负，|amount| 相等，币种相同
- 日期差 <= 3 天
- 两条都未挂分类，或分类为「转账/内部划转」类

评分（用于排序，不影响是否可选）：
+3  共享 externalId
+2  同一天
+1  描述相似（规范化后包含关系或编辑距离 <= 2）
+1  账户名出现在对方描述中
```

响应按分数倒序，返回前 50 组。

### 12.3 匹配

```
1. 校验两条交易归属、状态、金额与币种（不信任客户端传来的金额）
2. 若任一已被匹配 → 409
3. 单事务：
   a. 创建 type=transfer 的交易，两条分录：
      流出账户 -|amount|，流入账户 +|amount|
   b. 冲正两条原交易（status=voided，voidedAt，version+1，importFingerprint=NULL）
   c. 在两条原交易的 note 中追加「已匹配为转账 <transferId>」（不改原描述）
   d. 写审计 transfer.matched
4. 返回转账详情
```

> 用 note 记录匹配关系而**不新增表**，是因为匹配关系只需单向可追溯：从原流水能找到转账即可。若后续需要结构化关联，再在 Phase 3 引入 `transaction_links`。

### 12.4 解除匹配

```
1. 校验转账归属且 status=posted
2. 单事务：
   a. 冲正转账交易
   b. 依据转账的两条分录重建两条普通交易（新 ID）：
      流出账户 → expense（负数分录）
      流入账户 → income（正数分录）
      保留原日期、金额、币种；描述使用「解除匹配：<转账描述>」
   c. 写审计 transfer.unmatched
3. 返回两条新交易
```

**为什么不复活原交易**：冲正记录一旦产生就不再回到 `posted`，否则 `voidedAt` 与后续审计会自相矛盾。重建新交易让每一步都可解释。

### 12.5 边界状态

| 场景 | 行为 |
|------|------|
| 两条交易同一账户 | 422 `TRANSFER_MATCH_INVALID` |
| 金额不等 | 422 |
| 币种不同 | 422 `CROSS_CURRENCY_TRANSFER_UNSUPPORTED` |
| 其中一条已冲正 | 409 |
| 其中一条已是转账 | 409 |
| 转账已被手工修改后再解除 | 允许，按当前分录重建 |
| 仅一条交易 | 422（匹配必须成对） |

---

## 十三、P7 — 前端导入工作台

### 13.1 页面与路由

| 路由 | 页面 | 说明 |
|------|------|------|
| `/imports` | `ImportsPage` | 批次列表、上传入口、状态筛选 |
| `/imports/:id` | `ImportWorkbenchPage` | 五步工作台 |
| `/imports/rules` | `RulesPage` | 分类规则管理（P8） |
| `/imports/unmatched` | `UnmatchedPage` | 待匹配流水（P8） |

侧边栏「分类管理」下方新增「账单导入」入口（`Upload` 图标）。

### 13.2 工作台步骤

```
① 上传 ──► ② 映射 ──► ③ 预览与校验 ──► ④ 重复确认 ──► ⑤ 结果
```

**① 上传**

- 拖拽或选择文件；选择目标账户（只列 active 账户）。
- 上传前本地校验扩展名与大小；编码可选「自动 / UTF-8 / GB18030」。
- 上传后展示：识别出的编码、分隔符、表头行、总行数、自动套用的模板名。

**② 映射**

- 左侧：每个规范字段一个下拉框，列出原表头与首行样例。
- 右侧：实时预览前 20 行，展示解析后的日期与带符号金额。
- 日期格式选择器旁展示「解析示例」，歧义格式直接标红提示。
- 金额模式切换：单列有符号 / 借贷双列，切换时字段随之变化。
- 「保存为模板」按钮（需填写模板名）。

**③ 预览与校验**

- 表格列：行号、日期、金额（带正负色）、摘要、商户、状态、错误。
- 虚拟滚动（TanStack Virtual），20,000 行不卡顿。
- 顶部统计卡：有效 / 无效 / 重复 / 疑似 / 跳过。
- 「开始校验」按钮 → 进度态 → 结果。
- 错误筛选与错误码分组。

**④ 重复确认**

- 两组卡片：完全重复（默认全部跳过）、疑似重复（默认待确认）。
- 疑似组每条展示：本次行 vs 已有交易（日期、金额、摘要、账户），并排对比。
- 支持「全部保留」「全部跳过」「逐条切换」。
- 未确认完成时提交按钮禁用，并提示剩余条数。

**⑤ 结果**

- 成功统计、失败统计、自动分类命中数、未分类数。
- 「查看导入流水」（跳转 `/transactions?batchId=...`）。
- 「导出错误行」、「撤销本批次」（二次确认 + 阻塞原因展示）。

### 13.3 前端数据层

`src/lib/imports.ts`：

```ts
export const importsApi = {
  upload: (form: FormData) => ...,        // 需要 multipart，client.ts 增加 upload 方法
  list, detail, preview, rows,
  setMapping, validate, cancel,
  duplicates, decideDuplicates,
  commit, rollback, exportErrors,
};

export const importTemplatesApi = { list, create, update, remove };
export const classificationRulesApi = { list, create, update, remove, test, apply, reorder };
```

> `client.ts` 目前只处理 JSON。P7 需新增 `requestMultipart`，**不设 `Content-Type`**（交给浏览器带 boundary），其余错误与刷新逻辑复用。

### 13.4 组件拆分

```
components/imports/
├── UploadDropzone.tsx        拖拽上传与本地校验
├── MappingEditor.tsx         字段映射与样例预览
├── DateFormatPicker.tsx      格式选择与实时解析示例
├── PreviewTable.tsx          虚拟滚动表格
├── DuplicateReview.tsx       重复确认对比
├── ImportResult.tsx          结果与后续动作
├── BatchStatusBadge.tsx      状态徽标（含状态机文案）
└── ImportStepper.tsx         五步进度
```

### 13.5 交互与可访问性

- 步骤条支持点击回退（只能回到已完成步骤，不能跳过）。
- 所有破坏性操作（撤销、取消、覆盖映射）二次确认。
- 表格键盘可导航；状态不只用颜色表达，附带文字与图标。
- 空状态：无批次时引导上传；无规则时引导创建第一条规则。
- 移动端：工作台纵向堆叠，映射编辑器改为逐个字段折叠面板。

---

## 十四、P8 — 规则页、待匹配页与交付

### 14.1 规则页

- 列表按优先级排序，支持拖拽调整（HTML5 拖拽，不引入重型依赖）。
- 每条规则展示：名称、条件摘要（自然语言，如「支出 · 商户包含 星巴克 · 0–1000 元 → 餐饮」）、启用开关、命中次数。
- 编辑器支持动态增删条件；「测试」弹窗展示最多 50 条命中样本。
- 删除需二次确认，并提示「已分类的交易不会被回退」。

### 14.2 待匹配页

- 上半区：候选配对卡片（两条流水并排 + 分数 + 「匹配」按钮）。
- 下半区：未分类流水表格，支持批量分类。
- 匹配成功后从列表移除，提示「已合并为转账」。

### 14.3 交易页增强

- 列表增加「来源」列（手工 / 导入）。
- 支持 `batchId` 筛选参数（从导入结果跳转过来）。
- 冲正导入交易时，前端提示「该交易来自导入批次，冲正后不影响批次状态」。

### 14.4 测试

| 层级 | 覆盖 |
|------|------|
| 单元 | 解析矩阵（6.x 全部用例）、指纹、规则匹配、匹配评分、错误导出转义 |
| 集成 | 上传→映射→校验→提交→撤销全链路；幂等；跨用户 404；状态机非法流转；行数与大小上限；GBK 文件；XLSX 多表 |
| 回归 | Phase 1 的 121 个测试全部通过；手工记账与转账行为不变 |
| 权限 | 批次、模板、规则的跨用户访问一律 404 |

> 按既有约定，**不使用 Playwright 截图或视觉识别**验证。前端正确性通过组件测试、接口集成测试与手动键盘/表单验证覆盖。

### 14.5 文档与示例

- README 增加导入章节：支持的格式、编码、上限、模板、撤销语义、隐私说明。
- 提供两份**虚构**示例账单：`examples/statement-csv-demo.csv`、`examples/statement-xlsx-demo.xlsx`。
- 更新 `docs/项目目录结构.md` 与 `docs/API接口全面分析.md` 的接口状态。

---

## 十五、接口清单汇总

| 模块 | 接口数 | 所属阶段 |
|------|--------|----------|
| 导入批次 | 9 | P3 |
| 去重与提交 | 5 | P4 |
| 导入模板 | 4 | P5 |
| 分类规则 | 8 | P5 |
| 转账匹配与待处理 | 3 | P6 |
| **合计** | **29** | |

### 实现说明（与计划的两处差异）

| 项 | 计划 | 实际实现 | 原因 |
|---|---|---|---|
| 模板签名 | 由表头推断 | `import_batches.headers` 持久化去重表头后计算签名 | 重名表头下按位置还原需要稳定的键序列 |
| 规则分类与撤销 | 未提及相互影响 | 规则分类会自增 `transactions.version`，从而阻止批次撤销 | `version > 1` 是「导入后被修改」的统一判据，避免规则静默改写已入账数据后仍能整批撤销 |

> 相比 Phase 1 的 80 个接口，本阶段新增 29 个；全项目累计 109 个。

### 新增错误码

| 错误码 | HTTP | 说明 |
|--------|------|------|
| `IMPORT_EMPTY` | 422 | 文件无数据行 |
| `IMPORT_FILE_TOO_LARGE` | 413 | 超过大小上限 |
| `IMPORT_FORMAT_UNSUPPORTED` | 415 | 格式/扩展名不受支持 |
| `IMPORT_PARSE_FAILED` | 422 | 编码或结构无法解析 |
| `IMPORT_ROW_LIMIT_EXCEEDED` | 422 | 超过行数上限 |
| `IMPORT_MAPPING_INVALID` | 422 | 列映射无效 |
| `IMPORT_NOT_READY` | 409 | 未通过校验即提交 |
| `IMPORT_STATE_CONFLICT` | 409 | 非法状态流转 |
| `IMPORT_DUPLICATE_CONFIRMATION_REQUIRED` | 409 | 存在未确认的疑似重复 |
| `IMPORT_ALREADY_UPLOADED` | 409 | 同一文件已完成导入 |
| `IMPORT_ROLLBACK_BLOCKED` | 409 | 存在依赖，无法撤销 |
| `RULE_INVALID` | 422 | 规则条件或动作不合法 |
| `TRANSFER_MATCH_INVALID` | 422 | 配对条件不满足 |

---

## 十六、技术依赖清单

### 后端新增

```
csv-parse                 CSV 流式解析（引号、换行、BOM）
xlsx                      SheetJS，XLSX 读取（只读、关闭公式）
@fastify/multipart        文件上传
```

- `csv-parse` 与 `xlsx` 的版本需锁定；`xlsx` 发布在 SheetJS 自有源时需确认镜像可用性，若不可用则改为读取 zip + XML 的轻量实现（备选方案，仅当依赖不可获得时启用）。
- 不引入 `jschardet` 一类重型编码探测库：两级 TextDecoder 策略已覆盖 CVS/GBK 场景。

### 前端新增

```
@tanstack/react-virtual   大表格虚拟滚动
```

> 其余沿用 Phase 1 依赖，不新增 UI 组件库。

---

## 十七、环境变量与编排

新增（写入 `.env.example`、`docker-compose.yml` 的 api 服务）：

```env
FILE_STORAGE_DIR=/app/data/imports
FILE_ENCRYPTION_KEY=            # 必填，base64 的 32 字节
IMPORT_MAX_FILE_MB=10
IMPORT_MAX_ROWS=20000
IMPORT_FILE_RETENTION_DAYS=30
IMPORT_ROW_RETENTION_DAYS=365
```

- `api` 服务新增卷 `imports-data:/app/data/imports`，**不映射到 Nginx**。
- `.gitignore` 增加 `data/`（Phase 1 已包含，确认无误）。
- 备份说明更新：备份数据库时需同时备份 `imports-data` 卷，否则批次无法重新解析；但即使文件丢失，已入账交易与行记录仍完整可用。

---

## 十八、验证清单

### P1

- [ ] 迁移为纯增量，Phase 1 数据无损，121 个测试全部通过
- [ ] 新表与索引、唯一约束全部生成
- [ ] `FILE_ENCRYPTION_KEY` 缺失时启动失败，密钥长度错误时启动失败
- [ ] 加密文件落盘后无法直接以文本读取
- [ ] `/api/system/capabilities` 返回新能力

### P2

- [ ] 单元测试覆盖 6.7/6.8/6.9 全部用例
- [ ] UTF-8 BOM 与 GB18030 文件均能正确解码
- [ ] 引号内换行不被切行
- [ ] 日期歧义必须报错，不自动猜测
- [ ] 同一行两次指纹计算完全一致

### P3

- [ ] 上传后批次为 `parsed`，行数与文件一致
- [ ] 超出大小/行数上限返回明确错误码
- [ ] 映射缺失必填项返回 422 并标注字段
- [ ] 修改映射后旧校验结果被清空
- [ ] 全无效行批次进入 `failed`
- [ ] 重复上传同一文件返回 409 且可强制

### P4

- [ ] 精确重复自动跳过，疑似重复未确认时提交被拒
- [ ] 同一幂等键重复提交只入账一次
- [ ] 提交失败时账本无任何残留
- [ ] 撤销后余额回到导入前，指纹释放，可重新导入
- [ ] 已手工修改的交易阻止撤销并返回原因
- [ ] 错误导出 CSV 中文正常、公式前缀已转义

### P5

- [ ] 模板按表头签名自动命中
- [ ] `/imports/templates` 不会被 `/imports/:id` 吞路由
- [ ] 规则优先级决定分类归属，标签取并集
- [ ] 规则测试不写库
- [ ] 归档分类无法被规则引用

### P6

- [ ] 等额反向流水可合并为转账，余额不变
- [ ] 不满足条件（金额/币种/账户）返回 422
- [ ] 解除匹配后生成两条新流水，原转账为冲正态
- [ ] 转账不被计入收入或支出统计

### P7 / P8

- [ ] 五步工作台不可跳步
- [ ] 20,000 行预览滚动流畅
- [ ] 疑似重复对比信息足以判断
- [ ] 撤销按钮在存在依赖时禁用并说明原因
- [ ] 规则页拖拽排序后优先级持久化
- [ ] 移动端工作台可用

---

## 十九、交付标准与后续衔接

### 功能交付

1. 用户可上传 CSV/XLSX 账单，识别编码、分隔符与表头，并保存映射模板。
2. 导入前可预览、校验、处理重复行，导入结果可追溯到批次与原始行号。
3. 导入的交易进入与手工记账相同的复式账本，余额与 Dashboard 指标自动更新。
4. 已完成的批次可整批撤销；存在依赖时给出明确原因。
5. 分类规则可按优先级自动归类并打标签，支持测试与批量执行。
6. 跨账户等额反向流水可合并为转账，避免重复计入收支。

### 质量要求

1. 导入不产生重复交易：指纹唯一约束 + 幂等键 + 状态守卫三重保障。
2. 任何一批导入要么全部入账，要么完全不入账。
3. 原始账单文件加密存储，不进入日志、静态目录或未授权响应。
4. 解析内核为纯函数，单元测试覆盖全部格式与边界用例。
5. 跨用户访问一律 404，集成测试覆盖。
6. 20,000 行文件的上传、校验与提交在 30 秒内完成（本地环境）。
7. Phase 1 全部测试保持通过，手工记账与转账行为无回归。

### 已知取舍（需在文档中明示）

| 取舍 | 影响 | 后续处理 |
|------|------|---------|
| 不支持 OFX/QFX/PDF | 部分银行文件需先转 CSV | 视用户需求单独立项 |
| 不支持正则规则 | 复杂匹配需拆成多条规则 | 若确有需求，需先做安全评估 |
| 只支持整批撤销 | 无法撤销批次中的单行 | 单行更正走「冲正 + 手工补录」 |
| 文件保留 30 天 | 之后无法重新解析原文件 | 行数据与交易仍完整 |
| 匹配关系存于 note | 无结构化反向查询 | Phase 3 引入 `transaction_links` |

### 与后续阶段的衔接

| 后续阶段 | 建议内容 | 对 Phase 2 的依赖 |
|---------|---------|------------------|
| Phase 3 分析与预算 | 分类趋势、商户排行、周期识别、预算执行 | 依赖 Phase 2 的分类覆盖率与商户字段 |
| Phase 4 投资 | 组合、证券、成本基础、TWR/XIRR | 依赖 Phase 2 的导入框架扩展投资交易模板 |
| Phase 5 风险模拟 | 蒙特卡罗、Worker Threads、BullMQ | 需要队列时复用 Phase 2 的批次状态机思路 |
| Phase 6 目标与报告 | 财富目标、报表导出 | 依赖 Phase 1/2 的账本与分类数据 |
| Phase 7 数据管理与运维 | 备份恢复、导出、管理后台、审计扩展 | 依赖 Phase 2 的加密存储与审计事件 |

### 需补齐的设计文档

| 文档 | 最晚需要时间 |
|------|-------------|
| 账单导入与对账设计（格式矩阵、去重策略、银行模板库） | P2 开始前 |
| 安全与隐私设计（文件加密、密钥轮换、保留期与删除证明） | P1 开始前 |
| 分类规则语义说明（优先级、互斥与叠加、命中解释） | P5 开始前 |
