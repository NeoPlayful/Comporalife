# Phase 7 开发计划 — 数据管理、备份恢复与个人运维

> **对应项目**：Comporalife（复利人生）Personal 开源个人版
> **上游计划**：`docs/plan-phase1.md`（S1–S7，v0.1.0）、`docs/plan-phase2.md`（P1–P8，v0.1.1）、`docs/plan-phase3.md`（A1–A7，v0.1.4）、`docs/plan-phase4.md`（B1–B7，v0.1.5）、`docs/plan-phase5.md`（C1–C7，v0.1.6）、`docs/plan-phase6.md`（D1–D7，v0.1.7）
> **技术栈**：沿用前六阶段：Fastify 5 + TypeScript + Prisma 6 + PostgreSQL 16 + Redis 7 + React 19 + Vite + Tailwind CSS 4 + ECharts 6
> **文档版本**：v7.0-plan
> **计划交付版本**：v0.1.8
> **范围决策**：个人数据整体导出 + 加密备份与恢复向导 + 数据质量检查 + 后台任务面板（个人视角）+ 平台管理后台（账号与运维视角，不触财务内容）+ 异步导出任务；不做多用户租户体系、不做云端同步、不做备份自动上传对象存储

---

## 一、Phase 7 目标

> **把「数据都在我这儿、出事了也能救回来」从一句口号变成可验证的能力**

前六个阶段把功能一层层堆起来了：账本、导入、分析、预算、投资、模拟、目标、报表。数据越积越多，随之出现的是三类此前被推迟、现在必须回答的问题：

- 我想换台机器、换个部署，这些数据怎么完整带走？导出一堆 CSV 算不算「备份」？
- 我误删了一整年的流水，能不能只恢复那部分？恢复会不会把我后来的新数据一起覆盖？
- 现在这份数据可不可信——有多少笔没分类、多少条可能重复、多少个月缺账户、多少估值已过期？
- 服务跑得好不好、任务卡住了没、后台到底在忙什么？
- 我是个自部署者，同时管着家里几个账号，谁把账号禁用了、谁在异常登录，我从哪里看？

Phase 7 补的就是这条收尾闭环。它不是再加一个业务功能，而是五件事：

1. **整体导出与备份不是一回事**：导出是「给人看、给别的工具吃」的明文包；备份是「能原样还原」的加密包。二者在文件格式、完整性校验、可用性验证上完全不同，绝不能拿导出冒充备份。
2. **恢复必须先预览后执行**：恢复前明确告诉用户「会新增多少、覆盖多少、冲突多少」，并由用户勾选范围。任何默认「全量覆盖」的恢复都是灾难。
3. **数据质量是显式指标，不是感觉**：未分类、疑似重复、缺失月份、过期估值、汇率滞后，全部量化到条数并可下钻。
4. **可恢复性要能被验证**：备份文件带校验和与版本号，恢复前先校验，损坏就拒绝；恢复在单事务内完成，失败即整体回滚。
5. **管理后台只看账号与运维，不看财务内容**：管理员能禁用账号、撤销会话、看任务聚合与系统健康，但永远读不到余额、流水、持仓、模拟与目标。

### 核心原则

| 原则 | 说明 |
|------|------|
| **导出 ≠ 备份** | 导出是明文、可读、或许不完整的；备份是加密、带校验、可原样还原的。接口、文件与文档都不许混淆 |
| **全量隔离** | 任何导出、备份、恢复、质量检查、管理查询都严格按 `user_id` 作用域；跨用户一律 404 |
| **恢复先预览** | 恢复必须两段式：`restore-preview` 给出影响面，`restore` 携带确认标记才执行 |
| **恢复原子** | 恢复在单个数据库事务内完成；任一步失败整体回滚，不留半恢复状态 |
| **备份加密** | 备份文件复用 Phase 2 的 AES-256-GCM 口径，AAD 绑定用户与备份 ID；无密钥不可读 |
| **校验先于信任** | 备份/导出下载前校验 SHA-256 与结构版本；校验失败拒绝恢复，不尝试「修复」 |
| **管理员不见财务** | 管理接口只返回账号元数据、聚合计数与运维元数据；不返回金额、名称明细、流水原文 |
| **越权写审计** | 禁用、启用、撤销会话、角色调整、恢复、删除一律写审计事件，不记财务内容 |
| **异步不阻塞** | 大数据量导出走 Phase 5 执行器；小数据量允许同步，由行数阈值决定 |
| **缺失不撒谎** | 质量指标、导出完整性、备份覆盖范围全部显式声明，不以 0 或「完整」默认 |

---

## 二、Phase 7 开发阶段划分

```
E1 数据质量与审计读模型 ──┬──► E2 整体导出 ──┬──► E4 备份与恢复 ──┐
                          │                  │                    │
                          │                  │                    ├──► E6 前端数据管理页 ──► E7 交付
E3 任务面板与执行器泛化 ──┴──────────────────┘                    │
                                                                  │
E5 平台管理后台 ───────────────────────────────────────────────────┘
```

| 阶段 | 内容 | 涉及模块 | 预期工时 |
|------|------|----------|---------|
| **E1 数据质量与审计读模型** | 质量指标计算、下钻查询、审计日志查询、保留策略 | quality + audit | 4-5 天 |
| **E2 整体导出** | `data_exports` 表、导出包结构、分域导出、行数阈值、异步生成、下载 | exports | 5-6 天 |
| **E3 任务面板与执行器泛化** | `job_tasks` 表、执行器从蒙特卡罗专用泛化为多 kind、统一列表/状态/取消/重试 | jobs | 5-6 天 |
| **E4 备份与恢复** | `backups` 表、加密备份包、完整性校验、恢复预览、原子恢复、备份保留 | backups | 6-7 天 |
| **E5 平台管理后台** | `system_settings` 表、管理员角色校验、仪表板聚合、用户账号管理、管理员授权、系统运维视图 | admin | 6-7 天 |
| **E6 前端数据管理页** | 数据质量、导出、备份与恢复向导、任务面板；管理后台独立布局 | 前端页面 | 5-6 天 |
| **E7 i18n、测试与交付** | 双语资源、单元与集成测试、演示数据、文档更新、版本发布 | 全项目 | 4-5 天 |

> **合计约 35-42 天（单人开发）**。主要不确定性在「恢复的冲突判定与原子性」、备份包在跨版本时的兼容策略、以及把 Phase 5 执行器从蒙特卡罗专用泛化时不破坏既有中断恢复语义，工时已含边界调试。

### 阶段依赖说明

- **E1 完全独立**，只读已有表，可与任何阶段并行；建议先做，因为 `data-quality` 是导出与备份「完整性声明」的数据来源。
- **E3 是 E2 与 E4 的前置**：导出与备份都需要以异步任务承载，执行器的泛化必须先完成。泛化时不得改变蒙特卡罗的既有语义（见第八节）。
- E2 依赖 E1（导出包的完整性声明）与 E3（异步执行）。
- E4 依赖 E2 的包结构经验与 E3 的任务承载；恢复的冲突判定依赖 E1 的质量口径（例如重复候选）。
- E5 与 E1–E4 完全并行：它只读账号元数据与任务聚合，不依赖业务数据。
- E6 依赖 E2/E3/E4/E5 的接口；建议先跑通「导出 → 下载」与「备份 → 预览 → 恢复」两条直达路径，再接管理后台。
- E7 的回归必须验证：恢复失败后数据库完全回滚；管理员接口在任何角色下都不返回财务字段。

---

## 三、Phase 7 范围界定

### 交付范围

| 模块 | 交付内容 |
|------|---------|
| 数据质量 | 未分类、疑似重复、缺失月份、过期估值、汇率滞后、导入失败统计；量化到条数并可下钻 |
| 整体导出 | 账本、账户、分类、标签、预算、投资、模拟、目标、报表、设置分域导出；导出包清单与完整性声明 |
| 导出任务 | 大包异步生成、进度、取消、过期清理；小包同步返回 |
| 备份 | 加密备份包（全量）、校验和、结构版本、创建设置与保留策略 |
| 恢复 | 预览影响面（新增/覆盖/冲突/跳过）、范围选择、二次确认、原子执行、恢复记录 |
| 任务面板 | 个人视角统一任务列表、状态、进度、取消、失败重试、失败原因（脱敏） |
| 管理后台 | 管理员仪表板聚合、用户账号管理（启用/禁用/撤会话/删除审批）、角色授予与撤销、系统健康与运维视图、管理员审计 |
| 运维 | 能力声明、审计事件、保留策略、双语资源、部署文档补充 |

### 明确不交付（后续阶段）

| 能力 | 原因 |
|------|------|
| 云端同步、跨设备实时同步 | 需要账号级云端、冲突合并与端到端加密，属于独立产品形态，不是自部署版本的范围 |
| 备份自动上传对象存储、定时异地备份 | 需要对象存储适配器、凭据管理与失败告警；本阶段只做本地加密包与下载，调度只做本地保留清理 |
| 多租户、家庭成员共享账户 | 功能文档已明确个人版不建立 `tenant_id` 与家庭关系；管理后台只维护多个独立账号 |
| 管理员查看用户财务内容 | 产品红线。管理后台只提供账号元数据与聚合计数 |
| 任意断点续传式恢复（部分字段级合并） | 字段级合并需要逐表冲突策略，语义极易出错；本阶段做「按实体域的范围恢复 + 整条覆盖/跳过」 |
| 备份包的跨大版本自动迁移 | 恢复只支持同结构与已声明的兼容版本；更早版本需显式迁移工具，另行设计 |
| PDF 报表导出、报表订阅推送 | Phase 6 已明确不属于报表范围，与数据管理无关 |
| 行情自动接入、AI 分析 | 独立小阶段 |
| 数据库文件级物理备份（pg_dump 直传） | 自部署管理员可用数据库自带工具；应用提供的备份是**用户数据级**逻辑备份，文档须写清二者差异 |
| 邮件投递通知（导出完成、备份完成） | 依赖 SMTP 可靠性；本阶段只做站内任务状态，不做主动外发 |

> **口径说明**：推迟项属于《项目功能全面分析》中的完整个人版与运维能力，属于**产品范围**而非**本阶段范围**。Phase 7 不修改功能文档。

---

## 四、数据模型设计

### 4.1 模型总览（新增 4 张表）

```
data_exports      个人数据导出任务与产物（类型、范围、状态、文件引用、清单）
backups           加密备份包（范围、校验和、结构版本、字节数、恢复次数）
job_tasks         通用异步任务（kind、状态、进度、载荷摘要、结果摘要）
system_settings   部署级配置（注册开关等，单行键值，不存密钥）
```

**为什么新增 `job_tasks` 而不是扩展 `monte_carlo_runs`**：蒙特卡罗运行有 12 个专用字段（种子、路径数、假设快照、样本路径），把它做成通用任务的子集会让通用表长满业务列。相反的做法是：`job_tasks` 只承载**任务生命周期**，具体业务结果仍留在各自的表里，通过 `targetType` / `targetId` 关联。蒙特卡罗运行迁入统一任务面板时，用读模型聚合（`UNION` 查询，见 8.6），不迁移数据、不改已有表。

**不新增「导出明细表」**：导出包是一份文件加上一份清单 JSON；明细由文件内容决定，落表只会产生两份口径。

并对已有表做**增量扩展**（不破坏前六个阶段数据）：

```
users            新增关系：dataExports / backups / jobTasks
```

### 4.2 新增枚举

```prisma
enum ExportStatus {
  queued
  running
  ready
  failed
  expired
}

enum ExportScope {
  full          // 全量
  ledger        // 账本与账户
  investments   // 投资组合与标的
  simulations   // 模拟方案与运行
  planning      // 目标与报表
  settings      // 设置与偏好
}

enum BackupStatus {
  creating
  ready
  failed
  expired
}

enum BackupFormat {
  json_encrypted    // 逻辑数据 + AES-256-GCM
}

enum TaskKind {
  export
  backup
  restore
  recheck
}

enum TaskStatus {
  queued
  running
  succeeded
  failed
  cancelled
}
```

### 4.3 模型定义

#### data_exports

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | uuid | 主键 |
| `userId` | uuid | 归属用户，级联删除 |
| `scope` | ExportScope | 导出范围 |
| `format` | varchar(16) | `csv_zip` / `json`，本阶段固定 `csv_zip` |
| `status` | ExportStatus | 默认 `queued` |
| `params` | Json | 范围参数（起止日期、是否含已归档、实体域清单） |
| `manifest` | Json? | 完成后写入：文件清单、行数、完整性声明、模型版本 |
| `fileKey` | varchar(255)? | 加密导出文件的存储键，过期后置为 `purged` |
| `sizeBytes` | bigint? | 产物大小 |
| `sha256` | char(64)? | 产物校验和 |
| `rowCount` | int? | 总行数 |
| `failureCode` | varchar(64)? | 失败码（脱敏） |
| `expiresAt` | timestamptz? | 过期时间，过期后文件被清理 |
| `createdAt` / `completedAt` | timestamptz | |

索引：`[userId, createdAt(sort: Desc)]`、`[status, createdAt]`、`[expiresAt]`。

#### backups

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | uuid | 主键，同时作为文件 AAD 的一部分 |
| `userId` | uuid | 归属用户，级联删除 |
| `format` | BackupFormat | 默认 `json_encrypted` |
| `schemaVersion` | varchar(32) | 结构版本，例如 `comporalife-backup-v1` |
| `scope` | Json | 覆盖的实体域与记录数快照 |
| `fileKey` | varchar(255) | 加密备份文件存储键 |
| `sizeBytes` | bigint | 字节数 |
| `sha256` | char(64) | **明文包**的校验和，用于恢复前验证内容未被破坏 |
| `status` | BackupStatus | 默认 `creating` |
| `restoreCount` | int | 被成功恢复的次数，默认 0 |
| `lastRestoredAt` | timestamptz? | |
| `expiresAt` | timestamptz? | 保留期到期时间 |
| `createdAt` | timestamptz | |

索引：`[userId, createdAt(sort: Desc)]`、`[status]`、`[expiresAt]`。

> `sha256` 记录的是**解密后的密文内容摘要之前**的明文逻辑包摘要。恢复时先解密、再校验，避免「解密出乱码也被当成好包」。

#### job_tasks

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | uuid | 主键 |
| `userId` | uuid | 归属用户，级联删除 |
| `kind` | TaskKind | 任务类型 |
| `status` | TaskStatus | 默认 `queued` |
| `progress` | decimal(5,4) | 0–1，应用层保证单调不减 |
| `stage` | varchar(32)? | 当前阶段标识（供 UI 展示，不参与逻辑） |
| `targetType` / `targetId` | varchar / uuid? | 指向业务实体（导出 ID、备份 ID） |
| `summary` | Json? | 载荷摘要与结果摘要（不含敏感明细） |
| `failureCode` | varchar(64)? | 失败码 |
| `failureMessage` | varchar(255)? | 短说明，不写堆栈 |
| `attempts` | int | 默认 0 |
| `heartbeatAt` | timestamptz? | 心跳，用于中断恢复 |
| `startedAt` / `finishedAt` | timestamptz? | |
| `cancelRequestedAt` | timestamptz? | |
| `createdAt` | timestamptz | |

索引：`[userId, createdAt(sort: Desc)]`、`[status, createdAt]`、`[kind, status]`。

#### system_settings

| 字段 | 类型 | 说明 |
|------|------|------|
| `key` | varchar(64) | 主键，例如 `registration.enabled` |
| `value` | Json | 配置值（只存开关与可在线调整的部署参数，**不存任何密钥**） |
| `updatedBy` | uuid? | 最近修改的管理员，用于追溯 |
| `updatedAt` | timestamptz | |

> 单行键值表的目的是让「注册开关」这类运维参数可在不重启进程的情况下生效。密钥类配置（`JWT_SECRET`、`FILE_ENCRYPTION_KEY`、SMTP 凭据）永远只来自环境变量，不落库。

### 4.4 金额与精度

本阶段不新增金额计算，只搬运既有数据。导出与备份中的金额一律以**字符串保留 6 位小数**（与接口口径一致），绝不先转浮点再序列化。

### 4.5 迁移策略

- 纯增量：4 个新表（`data_exports`、`backups`、`job_tasks`、`system_settings`）+ 6 个新枚举。
- 不改任何既有表结构，不加列、不改枚举值，前六阶段数据与测试全部不受影响。
- 蒙特卡罗运行**不迁移**到 `job_tasks`，任务面板用读模型聚合。
- 存量用户无导出、备份与通用任务，既有页面行为完全不变。

---

## 五、关键设计决策

| # | 决策点 | 结论 | 理由 |
|---|--------|------|------|
| 1 | 导出与备份是否同一套文件 | 否，两套 | 导出是给人用的明文；备份是给机器还原的加密包。混用会导致「以为有备份，其实只有导出」 |
| 2 | 导出格式 | CSV 打包为 ZIP（每实体域一个 CSV）+ `manifest.json` | 通用、可被 Excel/脚本直接吃；比单一 JSON 更易人工核对 |
| 3 | 备份格式 | 单文件 JSON 逻辑包，AES-256-GCM 加密 | 结构与导入/导出解耦，恢复可精确到行；复用 Phase 2 文件加密实现 |
| 4 | 备份是否包含原始账单文件 | 不包含，只包含解析后的数据 | 原始文件体积大且可由数据重建业务事实；文档须明示此项 |
| 5 | 恢复粒度 | 按实体域选择，整条覆盖或跳过 | 字段级合并的冲突语义无法解释；整条语义清晰、可回滚 |
| 6 | 恢复冲突策略 | 用户选择「覆盖」或「跳过」，不做自动合并 | 自动合并在财务数据上必然产生无法解释的结果 |
| 7 | 恢复是否清空现有数据 | 默认不清空 | 「恢复」不等于「重置」，清空必须是独立且显式的高危操作 |
| 8 | 恢复的原子性 | 单事务 | 半个账本比没有账本更危险 |
| 9 | 备份校验 | 解密后校验 SHA-256 与 `schemaVersion` | 密钥错误、截断、跨版本都会在校验阶段暴露，而不是在写入一半时 |
| 10 | 数据质量是否需要新表 | 不需要，实时算 | 质量是账本的函数，与 Phase 6 进度同理；落表必然漂移 |
| 11 | 质量检查是否异步 | 同步，带上限 | 覆盖个人数据量级；仅在用户显式「重跑」时走异步任务，避免阻塞 |
| 12 | 任务面板如何统一 | 读模型 `UNION` 蒙特卡罗运行与 `job_tasks` | 迁移历史数据风险高；读模型可随时调整 |
| 13 | 执行器是否重写 | 泛化但保留 MC 语义 | 见第八节：MC 的中断恢复、种子重算、分片聚合均不得改变 |
| 14 | 管理员能否读财务数据 | 否 | 产品红线，接口白名单字段，测试必须覆盖 |
| 15 | 管理员删除用户 | 只做审批流转与禁用，不物理删除 | 物理删除涉及备份与保留规则；本阶段提供「驳回/批准禁用」，物理删除延后 |
| 16 | 最后一个超级管理员 | 禁止降级或禁用 | 与功能文档一致，避免系统失去管理入口 |
| 17 | 管理员自提权 | 禁止 | 角色调整必须由另一个 `super_admin` 完成 |
| 18 | 导出/备份保留 | 导出 7 天、备份保留最新 10 份或 90 天 | 防止本地磁盘无界增长；与 Phase 2 原始文件清理同一调度模型 |
| 19 | 是否支持导出已归档数据 | 支持，导出默认包含，参数可排除 | 「归档」是业务状态，不是删除；备份必须完整 |
| 20 | 恢复是否恢复归档状态 | 是，按备份时的状态还原 | 恢复的意义是回到那一刻 |
| 21 | 备份中的密码哈希 | 不包含密码与令牌 | 恢复后账号凭据不变；跨实例迁移需重新设定密码，文档明示 |
| 22 | 越权 | 一律 404；管理员访问业务接口仍按自身身份 | 与前六阶段一致 |

---

## 六、导出包口径

### 6.1 包结构

```
comporalife-export-<scope>-<yyyyMMdd-HHmmss>.zip
├── manifest.json          清单与完整性声明
├── accounts.csv           账户（含状态、币种、初始余额）
├── transactions.csv       交易（含分录汇总列）
├── entries.csv            分录明细
├── categories.csv
├── tags.csv
├── budgets.csv
├── portfolios.csv
├── trades.csv
├── cashflows.csv
├── valuations.csv
├── simulations.csv        方案参数（不含运行结果）
├── goals.csv
├── reports_index.csv      报表元数据；报表数据在 report-data/<id>.json
└── settings.json          偏好（不含任何密钥）
```

- `scope` 决定生成哪些文件；`full` 生成全部，其余只生成对应域及其依赖域（例如 `ledger` 依赖 `accounts`、`categories`）。
- 每个 CSV 沿用 Phase 6 的 `export.serialize` 口径：UTF-8 BOM、CRLF、RFC 4180 转义、公式注入防护、负数不被误伤。
- 不写 `= + - @` 开头的原始文本，属于注入防护的强制项。

### 6.2 完整性声明（`manifest.json`）

```jsonc
{
  "schemaVersion": "comporalife-export-v1",
  "appVersion": "0.1.8",
  "generatedAt": "2026-10-24T09:30:00.000Z",
  "scope": "full",
  "currency": "CNY",
  "range": { "from": null, "to": null },
  "files": [
    { "name": "transactions.csv", "rows": 4210, "bytes": 812344, "sha256": "..." }
  ],
  "totals": { "accounts": 12, "transactions": 4210, "portfolios": 3, "goals": 4, "reports": 2 },
  "completeness": {
    "isComplete": false,
    "missingMonths": ["2024-03"],
    "unpricedSymbols": ["AAPL"],
    "staleValuations": 2,
    "uncategorizedRatio": "0.018000"
  },
  "excluded": ["original_statement_files", "password_hash", "tokens"],
  "notes": ["导出为明文数据，不含原始账单文件与登录凭据"]
}
```

- `completeness` 直接复用 Phase 6 的 `basis.completeness` 结构，不另造一套。
- `excluded` 是必填项：任何「没导」的内容都必须写出来，不能靠用户猜。

### 6.3 行数阈值与异步

| 条件 | 行为 |
|------|------|
| 预计行数 ≤ `EXPORT_SYNC_MAX_ROWS`（默认 20,000） | 同步生成，响应即为 `status = ready` 的导出记录 |
| 预计行数 > 阈值 | 创建 `job_tasks(kind=export)` 异步执行，返回任务 ID |
| 实际行数 > `EXPORT_MAX_ROWS`（默认 200,000） | 任务失败 `EXPORT_TOO_LARGE`，提示缩小范围 |

> 预计行数用 `count()` 估算，不实际拉取；估算与实际的偏差不影响正确性，只影响走同步还是异步。

### 6.4 与报表导出的关系

Phase 6 的报表导出是「单份报表的 CSV/XLSX」；本阶段是「整份数据的打包导出」。二者共用 `export.serialize`，但入口、文件形态与保留策略不同。文档与界面必须分别命名：**报表下载** vs **数据导出**。

---

## 七、备份与恢复口径

### 7.1 备份内容

| 包含 | 不包含 |
|------|--------|
| 账户、交易、分录、分类、标签 | 原始账单文件（加密存储的 `.bin`） |
| 预算与预算项 | 密码哈希、刷新令牌、会话 |
| 标的、价格、组合、交易、现金流、估值、目标配置 | 汇率（可按需重建；若需要可显式包含） |
| 模拟方案与运行**参数快照**（含种子与模型版本） | 模拟运行的大结果体（按种子可重算） |
| 目标、报表元数据与冻结数据 | 导出任务与备份文件本身 |
| 用户设置与偏好（不含密钥） | 审计日志（恢复不改变历史审计） |

> **为什么模拟结果可以不带**：Phase 5 已确立「种子 + 参数快照 + 模型版本 ⇒ 逐位一致」。备份只带这三样，恢复后可按需重算；这样备份包体积可控。若用户曾删除运行结果，备份不负责复活它——文档明示。

### 7.2 恢复流程（两段式）

```
① POST /api/backups/:id/restore-preview
   下载并解密 → 校验 sha256 与 schemaVersion → 逐域比对现有数据
   → 返回：新增 / 覆盖 / 冲突 / 跳过 的计数与实体域清单

② POST /api/backups/:id/restore
   { "domains": ["ledger","investments"], "conflict": "skip" | "overwrite",
     "confirm": "RESTORE" }
   → 单事务执行 → 写恢复记录 → 返回各域写入计数
```

- `conflict` 默认 `skip`，必须显式传 `overwrite` 才覆盖；`confirm` 必须精确等于 `RESTORE`。
- 恢复不删除备份中不存在的现有记录（除非域内策略明确声明「整域替换」——本阶段不提供该模式）。
- 恢复完成后，任何派生数据（净资产、进度、报表）都会因账本变化而自然重算；报表快照**不重算**（Phase 6 语义不变）。

### 7.3 冲突判定

| 实体 | 判定键 | 冲突含义 |
|------|--------|---------|
| 账户 | `id` | 同 ID 已存在 → 覆盖或跳过 |
| 交易 | `id` 与 `externalId` | 同 ID 或同外部标识已存在 → 冲突 |
| 分类 | `id` 与 `(userId, name, kind)` | 同名同类型但 ID 不同 → 冲突 |
| 组合 | `id` | 同 ID → 覆盖或跳过 |
| 目标 | `id` 与 `(userId, name)` | 同名不同 ID → 冲突 |

- 冲突清单在预览中逐条列出（最多 `RESTORE_PREVIEW_LIMIT` 条，超出显示计数）。
- `skip` 时冲突项不写、不删，原数据保持。

### 7.4 原子性与失败

- 恢复在 `prisma.$transaction` 内完成，超时与批量插入由 `RESTORE_BATCH_SIZE` 控制。
- 任何一步失败（约束冲突、外键缺失、磁盘满）→ 整体回滚，返回 `RESTORE_FAILED`，不写恢复记录。
- 恢复记录只在成功后写入 `backups.restoreCount` 与 `lastRestoredAt`，并写审计 `backup.restored`。

### 7.5 备份保留与清理

- 每用户保留最新 `BACKUP_RETENTION_COUNT`（默认 10）份，或超过 `BACKUP_RETENTION_DAYS`（默认 90）天的置为 `expired`。
- 清理只删文件与置状态，不删 `backups` 行（保留历史痕迹，供审计与列表展示「已过期」）。
- 与 Phase 2 的导入文件清理共用每日调度模型，不新增调度器。

---

## 八、任务执行规范（`modules/jobs/`）

### 8.1 泛化原则

Phase 5 的执行器已经很接近通用，只是常量名带有蒙特卡罗前缀。泛化必须遵守：

| 约束 | 说明 |
|------|------|
| **MC 语义不变** | 中断恢复、种子重算、分片可能重复计算、聚合在全部切片到齐后进行——全部原样保留 |
| **常量分层** | 新增通用前缀常量（`TASK_*`），蒙特卡罗专用常量继续保留；不要为了「统一」改名 |
| **注册制** | 新任务通过 `register(kind, handler)` 注册，执行器不感知业务 |
| **表不混用** | `job_tasks` 与 `monte_carlo_runs` 各自独立；统一面板靠读模型 |
| **失败可重入** | 任何任务中断后按 `attempts` 与心跳判定回队；重试必须幂等 |

### 8.2 任务状态机

```
queued ──► running ──┬──► succeeded
   ▲                 ├──► failed（可重试）
   │                 └──► cancelled
   └── retry（仅 failed 且 attempts < max）
```

- `progress` 单调不减，节流写入。
- `cancelRequestedAt` 由取消接口写入，执行器在每个切片后轮询。

### 8.3 重试规则

- 仅 `failed` 可重试，且 `attempts < TASK_MAX_ATTEMPTS`（默认 3）。
- 重试复用原任务行（不新建），清空 `failureCode`，`attempts += 1`。
- `cancelled` 与 `succeeded` 不可重试。

### 8.4 导出任务

- 逐域生成 CSV → 写 ZIP → 计算 SHA-256 → 更新 `data_exports`（`ready`、`fileKey`、`manifest`）。
- 每完成一个域上报一次进度，域数即进度分母。
- 取消：删除临时文件，状态置 `cancelled`。

### 8.5 备份任务

- 逐域读取 → 组装 JSON 逻辑包 → 计算明文 SHA-256 → 加密写盘 → 更新 `backups`（`ready`）。
- 心跳与中断恢复沿用执行器机制；中断的备份置 `failed`，可重试。

### 8.6 统一任务读模型

```
GET /api/jobs?kind=...&status=...
→ UNION(
      job_tasks(id, kind, status, progress, createdAt, ...),
      monte_carlo_runs(id, 'monte-carlo' as kind, status, progress, createdAt, ...)
   )
   ORDER BY createdAt DESC
```

- 读模型只做展示，不改变任何写路径。
- `GET /api/jobs/:id` 先查 `job_tasks`，未命中再查运行表；两者 ID 不冲突（UUID）。
- 取消与重试按 `kind` 分派到对应实现；蒙特卡罗沿用 Phase 5 逻辑。

### 8.7 验收

- [ ] 蒙特卡罗既有测试全部通过，中断恢复与种子重跑结果不变
- [ ] 导出任务可取消，取消后无残留临时文件
- [ ] 备份任务中断后可重试，且最终产物校验和一致
- [ ] 任务面板按时间倒序合并两类任务，进度单调
- [ ] `cancelled` 与 `succeeded` 不可重试

---

## 九、E1 — 数据质量与审计读模型

### 9.1 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/data-quality/summary` | 质量总览（各指标计数与判定口径） |
| GET | `/api/data-quality/uncategorized` | 未分类流水明细（分页） |
| GET | `/api/data-quality/duplicates` | 疑似重复流水（分页） |
| GET | `/api/data-quality/missing-months` | 缺失月份清单 |
| GET | `/api/data-quality/stale-valuations` | 过期估值清单 |
| GET | `/api/data-quality/rate-lag` | 汇率滞后情况 |
| POST | `/api/data-quality/recheck` | 异步重跑检查并返回任务 ID |
| GET | `/api/audit-logs` | 本人审计日志（分页、按动作/时间筛选） |
| GET | `/api/audit-logs/:id` | 审计事件详情（脱敏） |

### 9.2 指标口径

| 指标 | 定义 | 边界 |
|------|------|------|
| 未分类流水 | `categoryId IS NULL` 的已过账交易数 | 排除转账与投资转换 |
| 疑似重复 | 同账户、金额相反或相同、日期差 ≤ `DUPLICATE_WINDOW_DAYS`、且未被人工标记为非重复 | 只提示，不自动处理 |
| 缺失月份 | 最近 N 个完整月中，某有余额账户在该月无任何流水 | 多次出现只计一月 |
| 过期估值 | 组合估值日期距今 > `INVESTMENT_PRICE_STALE_DAYS` | 与 Phase 4 口径一致 |
| 汇率滞后 | 需要折算但最新汇率日期距今 > `RATE_STALE_DAYS` | 逐币种对列出 |
| 导入失败 | 失败的导入批次与行数 | 只读导入表 |

- 总览返回 `checkedAt`、`rangeDays` 与各指标「是否可用」（样本不足时为 `null` 并给原因）。
- 质量检查**不写任何业务表**；`recheck` 只写 `job_tasks`，结果仍实时算。

### 9.3 审计查询

- 只返回本人 `audit_logs`；管理员另有管理视图（见 E5），二者不共用接口。
- 返回字段：`action`、`targetType`、`targetId`、`createdAt`、`ip`（脱敏到网段）、`metadata`（仅保留白名单键）。
- 任何情况下不返回金额、名称、流水内容。

### 9.4 验收

- [ ] 质量指标与对应明细页条数一致
- [ ] 质量检查前后账本、组合、报表零变化
- [ ] 样本不足时指标为 `null` 并带原因，不显示 0
- [ ] 审计查询跨用户 404，字段白名单生效
- [ ] 疑似重复只提示，不自动合并

---

## 十、E2 — 整体导出

### 10.1 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/exports` | 创建导出（小包同步完成，大包返回任务 ID） |
| GET | `/api/exports` | 导出列表 |
| GET | `/api/exports/:id` | 导出状态与清单 |
| GET | `/api/exports/:id/download` | 下载 ZIP |
| DELETE | `/api/exports/:id` | 删除导出与文件 |

### 10.2 请求

```jsonc
// POST /api/exports
{
  "scope": "full",              // full | ledger | investments | simulations | planning | settings
  "from": "2024-01-01",         // 可选，仅对账本域生效
  "to": "2026-10-24",
  "includeArchived": true,
  "format": "csv_zip"
}
```

- `scope` 与 `from`/`to` 同时传入时，区间只裁剪账本域；其他域仍全量，并在 `manifest.range` 中注明「仅账本域受区间限制」。
- 区间超过 `ANALYTICS_MAX_RANGE_DAYS` → `EXPORT_RANGE_INVALID` 400。
- 已归档数据默认包含，「归档 ≠ 删除」。

### 10.3 同步与异步

- 估算行数 ≤ 阈值 → 同步生成，响应返回 `{ exportId, status: 'ready', rowCount, expiresAt }`，随后可直接调用 `/api/exports/:id/download`。
- 超阈值 → 返回 `{ exportId, taskId, status: 'queued' }`；客户端轮询 `/api/exports/:id` 或查看任务面板。
- 异步导出完成后，`/api/exports/:id` 返回 `ready` 与 `manifest`。

### 10.4 下载

- 校验用户归属与 `status = ready`；过期或已删除 → 404。
- 响应头沿用 Phase 6 的 RFC 5987 中文文件名方案。
- 下载写审计 `export.downloaded`，不改变导出记录状态。

### 10.5 验收

- [ ] 各 scope 生成的文件集合与 `manifest.files` 完全一致
- [ ] 导出 ZIP 中的 CSV 在 Windows Excel 中文不乱码、负数正常、公式不执行
- [ ] `manifest.completeness` 与数据质量总览口径一致
- [ ] 超过行数上限返回 `EXPORT_TOO_LARGE` 且不产生半成品
- [ ] 导出全程只读账本与组合
- [ ] 下载跨用户 404，过期文件 404
- [ ] 导出中不包含原始账单文件、密码哈希、令牌（检查 ZIP 内容）

---

## 十一、E3 — 任务面板与执行器泛化

### 11.1 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/jobs` | 本人任务列表（含蒙特卡罗运行，合并读模型） |
| GET | `/api/jobs/:id` | 任务详情与进度 |
| POST | `/api/jobs/:id/cancel` | 取消可取消任务 |
| POST | `/api/jobs/:id/retry` | 重试失败的本人任务 |

### 11.2 列表响应

```jsonc
{
  "items": [
    { "id": "...", "kind": "export", "status": "running", "progress": "0.6000",
      "targetType": "data_exports", "targetId": "...", "createdAt": "...", "finishedAt": null },
    { "id": "...", "kind": "monte-carlo", "status": "succeeded", "progress": "1.0000",
      "targetType": "monte_carlo_runs", "targetId": "...", "createdAt": "...", "finishedAt": "..." }
  ],
  "nextCursor": null,
  "counts": { "queued": 1, "running": 1, "failed": 0 }
}
```

- 分页用游标（`createdAt` + `id`），避免大偏移。
- `kind` 可用于筛选；不传则全类型。

### 11.3 取消与重试分派

- `kind = monte-carlo` → 走 Phase 5 的取消与重试实现，行为完全不变。
- `kind ∈ {export, backup, restore, recheck}` → 走通用实现。
- 不可重试的状态返回 `TASK_NOT_RETRYABLE` 409。

### 11.4 验收

- [ ] 蒙特卡罗运行与通用任务在同一列表中按时间倒序
- [ ] `GET /api/jobs/:id` 对两类任务都能命中
- [ ] 取消蒙特卡罗运行的行为与 Phase 5 完全一致
- [ ] 不可取消/不可重试返回 409，不静默成功
- [ ] 跨用户访问任务 404

---

## 十二、E4 — 备份与恢复

### 12.1 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/backups` | 创建加密备份（异步返回任务 ID） |
| GET | `/api/backups` | 备份列表 |
| GET | `/api/backups/:id` | 备份元数据与覆盖范围 |
| GET | `/api/backups/:id/download` | 下载加密备份文件 |
| POST | `/api/backups/:id/restore-preview` | 恢复预览（影响面） |
| POST | `/api/backups/:id/restore` | 执行恢复（需确认标记） |
| DELETE | `/api/backups/:id` | 删除备份与文件 |

### 12.2 创建

```jsonc
// POST /api/backups
{ "format": "json_encrypted", "includeRates": false }
```

- 返回 `{ backupId, taskId, status: 'creating' }`。
- 完成后 `status = ready`，`sizeBytes` / `sha256` / `scope` 一并可查。

### 12.3 恢复预览响应

```jsonc
// POST /api/backups/:id/restore-preview
{
  "backupId": "...",
  "schemaVersion": "comporalife-backup-v1",
  "createdAt": "2026-09-01T03:00:00.000Z",
  "domains": [
    { "domain": "accounts", "insert": 12, "overwrite": 0, "conflict": 0, "skip": 0 },
    { "domain": "transactions", "insert": 3800, "overwrite": 12, "conflict": 40, "skip": 40 },
    { "domain": "budgets", "insert": 6, "overwrite": 0, "conflict": 0, "skip": 0 }
  ],
  "conflicts": [ { "domain": "transactions", "key": "externalId=2026-09-01-星巴克", "reason": "existing_different_id" } ],
  "truncated": false,
  "warnings": ["restore_does_not_delete_current_data"],
  "requiresConfirm": "RESTORE"
}
```

- 预览只读，不写任何表。
- `conflicts` 最多 `RESTORE_PREVIEW_LIMIT` 条，超出置 `truncated = true`。
- `warnings` 固定包含「恢复不会删除现有多余数据」。

### 12.4 执行

```jsonc
// POST /api/backups/:id/restore
{
  "domains": ["accounts", "transactions", "budgets"],
  "conflict": "skip",
  "confirm": "RESTORE"
}
```

- `domains` 为空 → `RESTORE_PARAMETERS_INVALID` 422。
- `confirm` 不等于 `RESTORE` → 422。
- 成功后返回各域写入计数、`restoreCount` 与新值 `lastRestoredAt`。

### 12.5 验收

- [ ] 备份文件用正确密钥可解密，错误密钥解密失败且无部分输出
- [ ] 篡改任一字节后 `sha256` 校验失败，恢复被拒绝
- [ ] `schemaVersion` 不兼容时拒绝恢复并给出原因
- [ ] 预览不影响任何数据
- [ ] `conflict=skip` 时冲突项保持原值；`overwrite` 时被覆盖
- [ ] 恢复失败整体回滚，数据库无半写状态
- [ ] 恢复不删除现有记录（构造备份后新增的数据，恢复后仍在）
- [ ] 恢复写审计，且不记录任何金额或流水内容
- [ ] 备份保留策略生效，过期后下载 404
- [ ] 管理员的备份接口与普通用户完全同权限（不能跨用户）

---

## 十三、E5 — 平台管理后台

### 13.1 角色与访问

```ts
// 路由守卫：所有 /api/admin/* 都要求 role ∈ {admin, super_admin}
// 涉及角色授予/撤销、管理员列表：仅 super_admin
```

- `user` 访问 → `FORBIDDEN` 403；未登录 → `UNAUTHORIZED` 401。
- 管理员访问业务接口（`/api/accounts` 等）时仍按**自身 user_id** 作用域，不获得任何跨用户业务读取能力。

### 13.2 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/admin/dashboard/overview` | 用户数、状态分布、任务统计、服务概况（纯聚合） |
| GET | `/api/admin/dashboard/registrations` | 注册趋势（按日/周聚合） |
| GET | `/api/admin/dashboard/security` | 登录失败与安全事件聚合 |
| GET | `/api/admin/dashboard/jobs` | 任务状态聚合 |
| GET | `/api/admin/users` | 用户列表（邮箱/ID 搜索、角色/状态筛选、分页） |
| GET | `/api/admin/users/:id` | 账号元数据（白名单字段） |
| POST | `/api/admin/users/:id/disable` | 禁用并撤销全部会话 |
| POST | `/api/admin/users/:id/enable` | 启用 |
| POST | `/api/admin/users/:id/revoke-sessions` | 撤销全部会话 |
| GET | `/api/admin/users/:id/login-logs` | 登录记录（脱敏 IP） |
| GET | `/api/admin/users/:id/audit-logs` | 针对该账号的管理操作记录 |
| POST | `/api/admin/users/:id/deletion-review` | 审批删除请求（批准=禁用标记，不物理删除） |
| GET | `/api/admin/admins` | 管理员列表（仅 super_admin） |
| POST | `/api/admin/admins/:id/grant` | 授予 `admin`（仅 super_admin） |
| POST | `/api/admin/admins/:id/revoke` | 撤销 `admin`（仅 super_admin） |
| GET | `/api/admin/permissions/me` | 当前管理员角色与可用操作 |
| GET | `/api/admin/audit-logs` | 管理员操作审计 |
| GET | `/api/admin/jobs` | 系统任务聚合（脱敏） |
| GET | `/api/admin/jobs/:id` | 任务元数据与脱敏失败原因 |
| GET | `/api/admin/system/info` | 版本、运行时长、Node 版本 |
| GET | `/api/admin/system/metrics` | 队列积压、活动任务数、数据库/Redis 状态 |
| GET | `/api/admin/settings/registration` | 注册开关状态 |
| PATCH | `/api/admin/settings/registration` | 修改注册开关 |

### 13.3 用户详情白名单字段

```jsonc
{
  "id": "...", "email": "u***@example.com", "nickname": "u***",
  "role": "user", "status": "active",
  "emailVerifiedAt": "...", "lastLoginAt": "...", "lastLoginIp": "203.0.113.0/24",
  "sessionCount": 2, "createdAt": "..."
}
```

- 邮箱与昵称按需脱敏（保留首字符），完整值仅在明确需要定位账号时由 `?reveal=true` 二次确认返回，并写审计。
- **绝不包含**：账户余额、交易、持仓、方案、目标、报表、导入原文。

### 13.4 安全约束

| 约束 | 实现 |
|------|------|
| 禁止自提权 | `grant`/`revoke` 的目标不能是操作者本人 |
| 禁止降级最后一个 super_admin | 事务内 `count(role=super_admin, status=active)` ≤ 1 时拒绝 |
| 禁止管理员禁用自己 | 同上 |
| 禁用即撤会话 | 禁用与 `sessionVersion` 递增 + 会话撤销在同一事务 |
| 角色变更写审计 | `admin.role_granted` / `admin.role_revoked` |

### 13.5 注册开关

- 注册开关持久化在 `system_settings` 表（见 4.3），读取时优先查表、缺失则回退环境变量默认值；这样既支持在线切换，也保留「全部配置来自环境变量」的部署方式。
- 关闭注册时，`POST /api/auth/register` 返回 `REGISTRATION_DISABLED` 403。

### 13.6 验收

- [ ] `user` 访问任何 `/api/admin/*` 返回 403
- [ ] `admin` 访问管理员权限接口返回 403（仅 super_admin）
- [ ] 管理员无法看到任何用户财务字段（逐字段断言响应体）
- [ ] 最后一个 super_admin 无法被降级或禁用
- [ ] 禁用用户后其现有 access token 立即失效（`sessionVersion` 递增）
- [ ] 所有管理写操作写审计，且审计不含财务内容
- [ ] 注册开关关闭后注册接口返回 403

> 注：`system_settings` 是独立的配置表，与三张业务表（导出、备份、任务）分开计数，部署迁移时一并建表。

---

## 十四、E6 — 前端数据管理与管理后台

### 14.1 路由与导航

- 新增 `/data`（数据质量 + 导出 + 备份恢复）、`/jobs`（任务面板）。
- 新增 `/admin`（独立布局，不进入普通用户侧边栏；仅 `role != user` 可见入口）。
- 侧边栏在「财务报表」之后新增「数据管理」；「任务」作为数据管理页的一个 Tab，避免菜单过长。
- 管理后台使用独立 `AdminLayout`，顶部标注「管理后台」与环境，避免与用户界面混淆。

### 14.2 页面结构

```
/data
├── Tab 1 数据质量
│     ├── 指标卡：未分类 / 疑似重复 / 缺失月份 / 过期估值 / 汇率滞后
│     ├── 下钻表（分页）
│     └── 「重新检查」按钮（异步任务，带进度）
├── Tab 2 数据导出
│     ├── 范围选择（全量 / 账本 / 投资 / 模拟 / 规划 / 设置）
│     ├── 区间（仅账本域）
│     ├── 导出列表：状态、行数、大小、过期时间
│     └── 下载 / 删除
└── Tab 3 备份与恢复
      ├── 创建备份
      ├── 备份列表：时间、大小、校验和、恢复次数
      ├── 恢复向导（三步）
      │     ① 选择备份 → ② 预览影响面（新增/覆盖/冲突/跳过）→ ③ 选择域与冲突策略 + 输入 RESTORE 确认
      └── 下载 / 删除

/jobs
├── 任务列表（类型、状态、进度、创建时间）
├── 筛选：全部 / 运行中 / 失败
└── 操作：取消 / 重试 / 查看详情

/admin
├── 仪表板（用户、任务、安全、服务健康）
├── 用户管理（列表、详情、禁用/启用、撤会话、登录记录）
├── 管理员（仅 super_admin：授予/撤销）
└── 系统（任务聚合、系统信息、注册开关）
```

### 14.3 组件

```
components/data/
├── QualitySummaryCards.tsx      质量指标卡（不可用显示原因，不显示 0）
├── QualityDetailTable.tsx       下钻表（分页）
├── ExportBuilder.tsx            范围与区间选择
├── ExportList.tsx               导出列表与下载
├── BackupList.tsx               备份列表与校验和展示
├── RestoreWizard.tsx            三步向导（预览 → 选择 → 确认）
├── RestorePreviewTable.tsx      影响面表格与冲突清单
└── DangerConfirmInput.tsx       输入 RESTORE 才可提交的确认框

components/jobs/
├── JobList.tsx                  统一任务列表
├── JobProgress.tsx              进度与阶段
└── JobActions.tsx               取消 / 重试

components/admin/
├── AdminLayout.tsx              独立布局
├── AdminGuard.tsx               角色守卫
├── UserTable.tsx                账号元数据表
├── UserDetailDrawer.tsx         白名单字段详情
├── RoleActions.tsx              授予/撤销（含自提权与最后管理员保护提示）
└── SystemHealth.tsx             队列、数据库、Redis 状态
```

### 14.4 交互与口径展示

- 恢复向导的第三步必须显示「本次将影响 N 个域、M 条记录，且不会删除现有多余数据」。
- 高危操作（禁用账号、撤销管理员、恢复覆盖）全部使用输入确认，不使用「确定/取消」二选一。
- 数据质量的不可用指标显示「样本不足：需要至少 N 个月数据」，不显示 `0`。
- 导出与备份列表明确区分，页面上分别标注「导出是明文，备份可还原」。

### 14.5 移动端

- 375px 下质量指标卡两列、表格只显示关键列并可展开。
- 恢复向导改为纵向步骤条，确认输入框全宽。
- 管理后台在窄屏只提供只读视图与最必要的禁用/启用操作，不做复杂表格。

### 14.6 验收

- [ ] 恢复向导必须完成预览才能进入执行步
- [ ] 未输入 `RESTORE` 时提交按钮禁用
- [ ] 质量不可用指标显示原因而非 0
- [ ] 导出与备份在视觉上明确区分
- [ ] 非管理员看不到 `/admin` 入口，直接访问被拒
- [ ] 375px 无整页横向滚动
- [ ] 中英文切换无残留硬编码

---

## 十五、E7 — i18n、测试与交付

### 15.1 i18n

- 新增命名空间 `data`、`jobs`、`admin`。
- `enums` 增补：`export_status`、`export_scope`、`backup_status`、`task_kind`、`task_status`。
- `errors` 增补第十六节全部错误码。
- 管理后台文案与普通用户文案分离，避免误用。
- 导航注册：`nav:data`、`nav:jobs`、`nav:admin`。

### 15.2 测试

| 层级 | 覆盖 |
|------|------|
| 单元 | 导出 CSV 复用断言（BOM/CRLF/注入/负数）、manifest 完整性、备份包序列化与校验和、恢复冲突判定（五种实体键）、任务状态机迁移、进度单调、重试次数上限 |
| 集成 | 质量指标与明细一致、导出各 scope 文件集合、同步/异步阈值、导出超限、备份创建与下载、错误密钥解密失败、篡改校验失败、跨版本拒绝、恢复预览只读、skip/overwrite 行为、恢复失败回滚、恢复不删除现有数据、任务面板合并与分页、取消/重试分派、管理员 403/白名单字段、最后管理员保护、自提权拒绝、禁用即失效、注册开关、审计事件 |
| 回归 | Phase 1–6 全部测试通过；无导出/备份/任务时数据管理页空态正常；蒙特卡罗中断恢复与种子重跑结果不变；`/api/system/capabilities` 中 `admin` 从 `planned` 移至 `available`，`exports`/`backups`/`data-quality`/`jobs` 加入 `available` |
| 安全 | 管理员接口逐字段断言无财务字段；导出 ZIP 内容断言无 `password_hash`/令牌/原始文件；恢复与导出跨用户 404；审计不含金额 |

### 15.3 文档

- [ ] README 增加「数据管理（导出 / 备份 / 恢复）」「管理后台」章节，明确导出 ≠ 备份
- [ ] `docs/API接口全面分析.md` 第 21、22、23、25 节标记为已实现，并按本计划修正接口清单
- [ ] `docs/项目目录结构.md` 增补 `modules/exports`、`modules/backups`、`modules/quality`、`modules/admin`、前端页面与组件
- [ ] 演示数据补充：一份可用的导出记录、一份备份、若干质量问题（未分类、重复候选）
- [ ] 在 Phase 1–6 计划中「Phase 7 数据管理与运维」的表述处补注本计划实际范围（不含云端同步、不含物理备份）
- [ ] 部署文档说明：**应用备份 ≠ `pg_dump`**；恢复会保留现有多余数据；跨实例迁移需重置密码
- [ ] 明确记录「导出保留 7 天、备份保留 10 份/90 天」

---

## 十六、接口清单与错误码

### 16.1 接口清单汇总

| 模块 | 接口数 | 所属阶段 |
|------|--------|----------|
| 数据质量 | 7 | E1 |
| 审计读模型 | 2 | E1 |
| 数据导出 | 5 | E2 |
| 通用任务 | 4 | E3 |
| 备份与恢复 | 7 | E4 |
| 管理后台 | 23 | E5 |
| **合计新增** | **48** | |

> 前六阶段累计 208 个接口；本阶段新增 48 个，全项目累计 256 个。

### 实现说明（与计划的差异）

| 项 | 计划 | 实际实现 | 原因 |
|---|---|---|---|
| 执行器泛化方式 | 「把执行器从蒙特卡罗专用泛化」 | 新增并列的 `TaskExecutor`，MC 执行器原样保留 | 两条生命周期不同（MC 有种子、分片聚合、专用表）；替换式改造会重写已验证的中断恢复语义 |
| 任务面板统一 | 计划写 `UNION` 查询 | 分别查询后内存合并 + 游标分页 | Prisma 对跨模型 UNION 支持有限；单用户任务量级下内存合并更简单，排序语义完全一致 |
| 导出包压缩 | 计划未定 | 默认 store（不压缩），写入器支持可选 deflate | 任何解压工具都能打开；压缩作为显式选项保留 |
| 备份下载内容 | 计划写「下载加密备份文件」 | 返回密文原样字节，服务端不解密 | 下载即备份本体；解密只发生在服务端恢复流程内 |
| ZIP 实现 | 计划写「项目内最小写入器」 | 新增 `lib/zip.ts`，含 CRC32、UTF-8 标志位、路径穿越拒绝 | 不新增 npm 依赖，且用单元测试验证结构合法 |
| 导出区间作用域 | 计划未明确 | 区间只裁账本、交易与估值，其余域全量 | 缩小设置或目标区间没有业务含义；清单用 `range.scopeLimited` 明示 |
| 恢复冲突处理 | 计划写「冲突但未提供策略 → 409」 | 冲突按 `conflict` 策略执行，未提供时默认 `skip` | 默认跳过比报错更安全；覆盖必须显式选择 |
| 恢复中的交易指纹 | 计划未提 | 恢复时置空 `importFingerprint` | 该字段是导入期去重手段，跨时间恢复旧包必然冲突；置空不改变业务事实 |
| 备份中的模拟结果 | 计划写「只带参数快照」 | 只带方案，不带运行与结果体 | 按种子与模型版本可重算；包体积可控 |
| 演示账号角色 | 计划写「管理后台可见」 | 演示账号设为 `super_admin` | 否则无法体验管理后台；角色不放大任何数据读取权限 |
| 管理员删除用户 | 计划写「审批流转」 | 批准即禁用，不物理删除 | 物理删除牵涉备份与保留规则，属独立设计 |
| 登录失败审计 | 计划未提 | 新增 `auth.login_failed`，只记 IP | 安全聚合需要失败计数；不记邮箱避免账号枚举面扩大 |

### 16.2 新增错误码

| 错误码 | HTTP | 说明 |
|--------|------|------|
| `EXPORT_NOT_FOUND` | 404 | 导出不存在或不属于当前用户 |
| `EXPORT_NOT_READY` | 409 | 导出尚未完成或已过期 |
| `EXPORT_TOO_LARGE` | 422 | 行数超过上限，`details.rows` / `details.maxRows` |
| `EXPORT_RANGE_INVALID` | 400 | 区间非法或超过允许天数 |
| `EXPORT_SCOPE_UNSUPPORTED` | 422 | 未知导出范围 |
| `BACKUP_NOT_FOUND` | 404 | 备份不存在或不属于当前用户 |
| `BACKUP_NOT_READY` | 409 | 备份仍在创建或已失败 |
| `BACKUP_CORRUPTED` | 422 | 解密后校验和不匹配 |
| `BACKUP_VERSION_UNSUPPORTED` | 422 | `schemaVersion` 不兼容 |
| `BACKUP_DECRYPT_FAILED` | 422 | 密钥不正确或文件被截断 |
| `RESTORE_PARAMETERS_INVALID` | 422 | 域为空、确认标记错误 |
| `RESTORE_CONFLICT_UNRESOLVED` | 409 | 存在冲突但未提供策略 |
| `RESTORE_FAILED` | 500 | 恢复过程中失败，已整体回滚 |
| `TASK_NOT_FOUND` | 404 | 任务不存在或不属于当前用户 |
| `TASK_NOT_CANCELLABLE` | 409 | 任务已结束或被拒绝 |
| `TASK_NOT_RETRYABLE` | 409 | 状态或次数不允许重试 |
| `ADMIN_FORBIDDEN` | 403 | 非管理员访问管理接口 |
| `ADMIN_SELF_MODIFICATION` | 422 | 管理员尝试修改自身角色或禁用自己 |
| `ADMIN_LAST_SUPER_ADMIN` | 422 | 试图降级或禁用最后一个超级管理员 |
| `REGISTRATION_DISABLED` | 403 | 公开注册已关闭 |

> 越权访问一律 404（业务实体）或 403（管理接口），与前六阶段一致。
> 数据不足（质量指标、导出完整性）**不产生错误**，返回 `null` + 原因码。

---

## 十七、技术依赖

### 后端

**不新增依赖。**

- 加密复用 Phase 2 `lib/file-storage.ts` 的 AES-256-GCM 实现；备份包只换 AAD 与存储子目录。
- ZIP 打包**不新增 npm 依赖**：在项目内实现最小 ZIP 写入器，仅支持 store（不压缩）与可选 `zlib.deflateRawSync` 两种模式；写入 CRC32 与 UTF-8 文件名标志位。
- CSV 复用 Phase 6 `reports/export.serialize.ts`，不复制转义逻辑。
- 任务执行器复用 Phase 5 `jobs/`，只做注册制扩展。

> ZIP 写入器是本节唯一需要自行实现的格式代码，必须写单元测试验证：标准工具能解压、CRC32 正确、文件名编码为 UTF-8。

### 前端

**不新增依赖。**

- 管理后台用既有 Tailwind 与组件库。
- 下载用原生 `<a download>` 与 `fetch` + `Blob`（与 Phase 6 一致）。
- 上传（如果恢复需要选择本地备份文件）用既有表单，不引入上传库。

### 数据库

- 纯增量迁移：4 张新表 + 6 个枚举。
- 不修改任何既有表。

---

## 十八、环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `EXPORT_SYNC_MAX_ROWS` | `20000` | 同步导出的行数阈值 |
| `EXPORT_MAX_ROWS` | `200000` | 单次导出的行数上限 |
| `EXPORT_RETENTION_DAYS` | `7` | 导出文件保留天数 |
| `BACKUP_RETENTION_COUNT` | `10` | 每用户保留的备份份数 |
| `BACKUP_RETENTION_DAYS` | `90` | 备份保留天数 |
| `RESTORE_PREVIEW_LIMIT` | `200` | 预览中冲突条目上限 |
| `RESTORE_BATCH_SIZE` | `500` | 恢复批量写入大小 |
| `TASK_MAX_ATTEMPTS` | `3` | 通用任务最大重试次数 |
| `TASK_MAX_CONCURRENT` | `2` | 通用任务并发上限 |
| `TASK_TIMEOUT_SECONDS` | `600` | 通用任务超时 |
| `DUPLICATE_WINDOW_DAYS` | `3` | 疑似重复的日期窗口 |
| `RATE_STALE_DAYS` | `7` | 汇率滞后阈值 |

> 写入 `src/config/constants.ts`，并在 `/api/system/capabilities` 的 `exportLimits`、`backupLimits`、`taskLimits` 中暴露。不新增外部服务。

---

## 十九、验证清单

### E1

- [ ] 质量指标与明细页条数一致
- [ ] 质量检查零写入（除 `recheck` 的任务行）
- [ ] 样本不足指标返回 `null` 与原因
- [ ] 审计查询字段白名单生效

### E2

- [ ] 各 scope 文件集合与 `manifest.files` 一致
- [ ] CSV 在 Windows Excel 中文正常、负数正常、公式被阻断
- [ ] 导出包不含密码哈希、令牌、原始账单文件
- [ ] 超限 422 不产生半成品
- [ ] 导出全程只读

### E3

- [ ] 蒙特卡罗运行与通用任务合并列表、时间倒序
- [ ] 蒙特卡罗取消/重试行为与 Phase 5 完全一致
- [ ] 不可取消/不可重试 409

### E4

- [ ] 错误密钥解密失败且无部分输出
- [ ] 篡改后校验失败，恢复被拒
- [ ] 跨版本备份拒绝恢复
- [ ] 预览零写入
- [ ] `skip` 与 `overwrite` 行为正确
- [ ] 恢复失败整体回滚
- [ ] 恢复不删除现有多余数据
- [ ] 备份过期后下载 404

### E5

- [ ] `user` 访问管理接口 403
- [ ] `admin` 访问权限接口 403
- [ ] 管理响应逐字段无财务数据
- [ ] 最后 super_admin 保护生效
- [ ] 禁用后 token 立即失效
- [ ] 管理写操作审计完整

### E6 / E7

- [ ] 恢复向导必须预览后才能执行
- [ ] 确认输入未填时按钮禁用
- [ ] 非管理员无入口且直访被拒
- [ ] 375px 无横向滚动
- [ ] 中英文无残留
- [ ] 前六阶段测试全部通过
- [ ] `/api/system/capabilities` 中 `admin` 在 `available`

---

## 二十、交付标准与后续衔接

### 功能交付

1. 用户可查看数据质量总览（未分类、疑似重复、缺失月份、过期估值、汇率滞后），并可下钻到明细。
2. 用户可按范围导出整体数据，得到带清单与完整性声明的 ZIP；大包走异步任务并可在任务面板查看进度。
3. 用户可创建加密备份，下载、查看校验和与覆盖范围。
4. 用户可在恢复前预览影响面（新增/覆盖/冲突/跳过），选择域与冲突策略，输入确认标记后原子恢复。
5. 用户可在任务面板查看导出、备份、恢复、重检与蒙特卡罗运行的统一列表，并可取消与重试。
6. 管理员可查看账号与运维聚合、禁用/启用账号、撤销会话、查看登录与操作审计。
7. 超级管理员可授予/撤销管理员角色，且无法自提权、无法移除最后一个超级管理员。
8. 注册开关可在线调整，关闭后注册接口返回 403。

### 质量要求

1. 导出与备份在格式、加密、校验与文档上完全区分，任何界面与文案不得混用。
2. 全部导出、备份、恢复、质量与任务接口严格按 `user_id` 隔离；跨用户 404。
3. 恢复必须两段式且原子；失败零残留。
4. 备份文件解密后校验 SHA-256 与结构版本；任何校验失败都拒绝恢复。
5. 管理员接口逐字段断言不含任何财务数据。
6. 任务执行器泛化不改变蒙特卡罗的任何既有语义。
7. 前六阶段测试全部通过，行为无回归。

### 已知取舍（需在文档与 UI 中明示）

| 取舍 | 影响 | 后续处理 |
|------|------|---------|
| 应用备份不含原始账单文件 | 恢复后无法重新解析原文件，但业务事实完整 | 部署文档说明；若需保留原文件应另做文件级备份 |
| 备份不含密码与令牌 | 跨实例恢复需重设密码 | 文档明示；恢复后首次登录用密码重置流程 |
| 恢复不删除现有数据 | 无法用旧备份「回到过去」 | 「重置」必须是独立的显式高危操作，另行设计 |
| 恢复为整条覆盖/跳过 | 不做字段级合并 | 字段级合并语义不可解释，产品上不做 |
| 备份只保留 10 份/90 天 | 更早的备份被清理 | 长期归档需外部对象存储，另行设计 |
| 导出保留 7 天 | 过期需重新生成 | 明文包不应长期留存 |
| 管理员不能删用户 | 只能禁用与审批 | 物理删除涉及备份与保留规则 |
| 管理员看不到财务数据 | 排障能力有限 | 产品红线；如需排障应基于日志与聚合 |
| 通用任务与 MC 运行分表 | 统一面板靠读模型 | 避免把 MC 专用字段塞进通用表 |
| 导出包默认不压缩 | 包体积偏大 | 写入器已支持可选 `deflateRaw`，默认关闭以保证解压兼容性 |

### 与后续阶段的衔接

| 后续阶段 | 建议内容 | 对 Phase 7 的依赖 |
|---------|---------|------------------|
| 云端同步（独立产品方向） | 账号级云端、增量同步、冲突合并、端到端加密 | 复用恢复的冲突判定与实体域划分，但需要独立的版本向量与传输协议 |
| 对象存储与异地备份 | S3 兼容存储适配器、定时上传、失败告警 | 复用备份包结构与校验和，只替换存储层 |
| 物理备份与部署运维 | `pg_dump` 封装、恢复演练脚本、备份监控 | 与逻辑备份并列，文档需说明差异 |
| 行情自动接入（独立小阶段） | 价格提供方、复权、限流 | 提升质量指标中「过期估值」的可改善程度 |
| 通知与订阅推送 | 任务完成通知、备份提醒 | 复用任务事件与审计，另加投递与退订 |
| 用户物理删除与数据擦除 | 彻底删除、备份中的残留处理 | 依赖本阶段的备份清单与保留策略 |

### 需补齐的设计文档

| 文档 | 最晚需要时间 |
|------|-------------|
| 导出包与备份包结构规范（文件清单、清单字段、校验和、结构版本） | E2 开始前 |
| 恢复冲突判定与原子恢复规范（判定键、冲突策略、回滚边界） | E4 开始前 |
| 管理后台权限与脱敏规范（角色矩阵、白名单字段、审计事件） | E5 开始前 |
| 任务执行器泛化说明（kind 注册、状态机、MC 语义不变性） | E3 开始前 |
