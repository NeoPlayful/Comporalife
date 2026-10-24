# Phase 1 开发计划 — 个人财务主链路垂直切片

> **对应项目**：Comporalife（复利人生）Personal 开源个人版
> **技术栈**：Fastify 5 + TypeScript + Prisma + PostgreSQL 16 + Redis 7 + React 19 + Vite 8 + Tailwind CSS 4 + ECharts 6
> **当前版本**：v1.0-plan
> **文档位置**：本文档替代此前误引入的 Shopirea 电商 Phase 1 计划，内容全部重写为 Comporalife 业务。

---

## 一、Phase 1 目标

> **注册登录 → 建账户 → 记流水（复式分录）→ 净资产/现金流 Dashboard → 复利定投模拟 → 图表呈现**

Phase 1 不追求覆盖《项目功能全面分析》的全部功能，而是用一条**纵向贯通**的链路验证产品骨架：计算内核 → API → 前端页面 → 图表。银行账单导入、投资组合、蒙特卡罗、财富目标、报表与数据管理放入后续阶段。

### 核心原则

| 原则 | 说明 |
|------|------|
| **垂直切片** | 每个子阶段都必须产出「后端接口 + 前端页面 + 可验证结果」，不出现只完成一半的模块 |
| **账本正确性优先** | 复式分录、转账不计支出、Decimal 金额、可冲正不可硬删，是 Phase 1 的硬约束 |
| **计算内核独立** | 复利计算是纯函数模块，不依赖 HTTP、数据库与认证，便于单元测试和未来复用 |
| **不做导入** | CSV/XLSX/OFX/PDF 解析全部推迟；Phase 1 只支持手工录入与转账 |
| **不做投资** | 持仓、成本基础、TWR/XIRR 推迟；账户类型中的 `brokerage` 仅作为普通账户参与净资产 |
| **不做异步队列** | 无 BullMQ、无 Worker Threads、无独立 worker 容器；Phase 1 没有重任务 |
| **不做管理后台** | `/api/admin/*` 与 `/admin` 页面推迟；`users.role` 字段与 seed 超级管理员保留 |
| **单一校验库** | 统一使用 Zod，不再并列 TypeBox |
| **模块化目录** | 采用 `routes/*.ts` + `modules/<domain>/` + `lib/` 结构，不使用分层式 `services/ repositories/` |
| **Docker 开发** | 开发与部署统一走 Docker Compose，数据库不暴露公网 |

---

## 二、Phase 1 开发阶段划分

```
S1 基础设施 ──► S2 认证与设置 ──► S3 账户与分类 ──► S4 交易账本
                                                        │
                                        S6 复利模拟 ◄───┴───► S5 Dashboard 与分析
                                                │
                                                └──► S7 体验完善与交付
```

| 阶段 | 内容 | 涉及模块 | 预期工时 |
|------|------|----------|---------|
| **S1 基础设施** | 前后端脚手架、Prisma 初始模型、Docker Compose、Nginx、健康检查、统一响应与错误处理 | 全项目 | 2-3 天 |
| **S2 用户认证与设置** | 注册/登录/刷新/退出、会话管理、密码重置、个人资料、币种时区偏好 | auth + profile + settings | 3-4 天 |
| **S3 账户、分类与标签** | 账户 CRUD/归档/余额、余额历史、对账、分类树、标签、币种列表 | accounts + categories + tags | 3-4 天 |
| **S4 交易账本** | 复式分录、收入/支出/调整、账户间转账、批量分类、冲正 | ledger + transfers | 4-5 天 |
| **S5 Dashboard 与基础分析** | 净资产、现金流、资产配置、账户余额、数据质量、手工汇率 | dashboard + analytics + currencies | 3-4 天 |
| **S6 复利与定投模拟** | 计算内核、即时计算、场景保存/复制/对比、图表与明细表 | simulations | 3-4 天 |
| **S7 体验完善与交付** | 深色模式、响应式、空/错/加载状态、E2E、Docker 全栈、README 与示例数据 | 全项目 | 3-4 天 |

> **合计约 21-28 天（单人开发）**。工时按熟悉 React/Fastify 的全栈开发者估算，不含需求变更。

### 阶段依赖说明

- S3 依赖 S2 的认证上下文与用户偏好（基准币种、时区）。
- S4 依赖 S3 的账户与分类，账本余额口径在 S4 定型。
- S5 依赖 S4 的分录数据；净值趋势按日快照或按分录重算，二选一在 S5 定稿。
- S6 与 S3/S4 **无强依赖**，可在 S3 完成后与 S4 并行推进；这是 Phase 1 中唯一可以提前交付的完整闭环。

---

## 三、Phase 1 范围界定

### 交付范围

| 模块 | 交付内容 |
|------|---------|
| 认证 | 注册、登录、刷新、退出、会话撤销、修改密码、忘记/重置密码 |
| 资料与设置 | 昵称、时区、日期格式、主题、基准币种、复利默认参数、安全设置 |
| 账户 | 现金/银行/信用卡/证券/贷款/其他账户，期初余额、归档、余额与余额历史、对账记录 |
| 分类与标签 | 收支分类树（含注册时复制的系统预设）、标签、交易标签绑定 |
| 账本 | 收入、支出、账户间转账、余额调整；复式分录；批量分类；批量备注；冲正 |
| Dashboard | 净资产、资产负债构成、现金流趋势、账户余额汇总、最近流水、数据质量 |
| 复利模拟 | 本金、定投、收益率、期限、通胀、费用；年度明细；场景保存、复制、对比 |
| 汇率 | 币种列表、手工汇率维护、折算到基准币种 |
| 运维 | 健康/就绪检查、结构化日志、限流、Docker Compose 一键启动 |

### 明确不交付（后续阶段）

| 能力 | 原因 |
|------|------|
| 银行账单导入（CSV/XLSX/OFX/PDF）、导入批次与撤销 | 解析与映射是独立大模块，建议在账本稳定后开始 |
| 导入模板、去重指纹、错误行导出 | 依赖导入模块 |
| 预算（Budgets）与预算预警 | 依赖完整分类统计，后续与 Analytics 一起做 |
| 投资组合、证券、持仓、成本基础、TWR/XIRR、再平衡 | 成本基础算法风险高，单独成阶段 |
| 蒙特卡罗模拟、异步任务、任务队列、独立 worker | 需要 Worker Threads 与 BullMQ，Phase 1 无队列基础设施 |
| 财富目标、财务独立规划、报告生成与导出 | 依赖投资与模拟结果 |
| 数据导出、备份/恢复、导入批次清理 | 运维模块，建议与部署文档同步交付 |
| 管理后台（`/api/admin/*`、`/admin`） | Phase 1 单人自部署场景不需要；字段与 seed 已预留 |
| 凭证附件、原始账单文件存储 | 文件存储与加密策略应统一设计，避免两套实现 |
| 交易拆分（split/unsplit）、退款冲减、信用卡还款自动识别 | 依赖自动识别与导入，手工场景价值有限 |
| 跨币种转账 | 需要汇兑差额与双侧汇率快照，正确性成本高，Phase 1 直接拒绝 |
| 外部行情源、汇率源自动同步、AI 分析 | 外部依赖，默认关闭 |
| 邮箱验证、头像上传、账号注销 | 非主链路；`emailVerifiedAt` 字段保留 |

> **口径说明**：上述推迟项在《项目功能全面分析》中属于个人版完整功能，属于**产品范围**而非**本阶段范围**。Phase 1 不因此修改功能文档。

---

## 四、数据模型设计

### 4.1 模型总览

```
users                     用户账号与角色状态
user_sessions             刷新会话与设备撤销
user_settings             用户偏好与模拟默认参数
accounts                  财务账户与期初余额
account_reconciliations   账户余额对账记录
categories                收支分类（注册时从系统模板复制）
tags                      用户标签
transactions              交易头（收入/支出/转账/调整）
transaction_entries       资金分录（复式，含外部腿）
transaction_tags          交易与标签关联
simulation_scenarios      复利场景参数
exchange_rates            手工汇率快照
audit_logs                敏感操作审计
```

**统一约定**：物理表名为 snake_case（Prisma `@@map`），所有业务表含 `user_id`，金额字段为 `DECIMAL(20,6)`，汇率为 `DECIMAL(20,10)`，主键为 UUID v4，时间统一存 UTC。

### 4.2 各模型核心字段

#### User

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| email | String | 唯一，注册后不可直接修改 |
| passwordHash | String | Argon2id；禁止明文与可逆加密 |
| nickname | String | 展示名 |
| role | Enum | `super_admin` / `admin` / `user`，Phase 1 仅 seed 使用 |
| status | Enum | `active` / `disabled` / `pending_verification` |
| emailVerifiedAt | DateTime? | Phase 1 不启用验证流程，字段保留 |
| lastLoginAt | DateTime? | 最近登录时间 |
| lastLoginIp | String? | 最近登录 IP，日志与响应中脱敏 |
| sessionVersion | Int | 全局会话版本，改密/禁用时递增以撤销会话 |
| createdAt / updatedAt | DateTime | |

#### UserSession

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| userId | UUID | 归属用户 |
| refreshTokenHash | String | 刷新令牌的哈希，唯一 |
| userAgent | String? | 设备信息，截断存储 |
| ip | String? | 登录 IP |
| expiresAt | DateTime | 过期时间 |
| revokedAt | DateTime? | 撤销时间 |
| lastUsedAt | DateTime? | 最近使用时间 |
| createdAt | DateTime | |

索引：`(userId, revokedAt)`、`refreshTokenHash` 唯一。

#### UserSettings

| 字段 | 类型 | 说明 |
|------|------|------|
| userId | UUID | 主键，一对一 |
| baseCurrency | String | ISO 4217，默认 `CNY` |
| timezone | String | IANA 时区，默认 `Asia/Shanghai` |
| dateFormat | String | 如 `YYYY-MM-DD` |
| theme | Enum | `dark` / `light` / `system` |
| simulationDefaults | Json | 复利默认参数（收益率、通胀、期限等） |

#### Account

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| userId | UUID | 归属用户 |
| name | String | 账户名称 |
| type | Enum | `cash` / `bank` / `credit_card` / `brokerage` / `loan` / `other` |
| institution | String? | 机构名称 |
| currency | String | 账户币种 |
| openingBalance | Decimal(20,6) | 期初余额，可正可负 |
| openingBalanceDate | Date | 期初余额基准日 |
| status | Enum | `active` / `archived` |
| note | String? | 备注 |
| version | Int | 乐观锁版本 |
| archivedAt | DateTime? | 归档时间 |
| createdAt / updatedAt | DateTime | |

**负债判定**：`credit_card` 与 `loan` 视为负债账户，余额按其绝对值计入负债；不引入额外的 `is_liability` 字段，避免双重口径。

#### AccountReconciliation

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| userId | UUID | 归属用户 |
| accountId | UUID | 关联账户 |
| statementBalance | Decimal(20,6) | 用户填写的对账单余额 |
| computedBalance | Decimal(20,6) | 系统按分录计算的余额 |
| difference | Decimal(20,6) | 对账单 − 系统值 |
| reconciledAt | Date | 对账日期 |
| note | String? | 备注 |
| createdAt | DateTime | |

**规则**：对账只记录差异，**不自动生成调整分录**；用户需要修正时显式创建 `adjustment` 交易。

#### Category

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| userId | UUID | 归属用户（系统预设在建号时复制为该用户数据） |
| kind | Enum | `income` / `expense` |
| name | String | 分类名称 |
| parentId | UUID? | 父分类，最多两级 |
| sortOrder | Int | 排序 |
| archived | Boolean | 归档，默认 false |
| createdAt / updatedAt | DateTime | |

**唯一约束**：`(userId, kind, parentId, name)`。`parentId` 为空时的唯一性由数据库部分索引保证。

**系统预设**：收入侧包含工资、奖金、利息、分红、其他收入；支出侧包含住房、食品、交通、教育、医疗、保险、娱乐、购物、其他支出。预设定义在 `prisma/seed.ts` 的模板常量中，注册事务内复制到新用户。

#### Tag / TransactionTag

| 字段 | 类型 | 说明 |
|------|------|------|
| tags.id | UUID | 主键 |
| tags.userId | UUID | 归属用户 |
| tags.name | String | 标签名，`(userId, name)` 唯一 |
| transaction_tags.transactionId | UUID | 交易 |
| transaction_tags.tagId | UUID | 标签 |
| | | 复合主键 `(transactionId, tagId)` |

#### Transaction

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| userId | UUID | 归属用户 |
| type | Enum | `income` / `expense` / `transfer` / `adjustment` |
| occurredAt | DateTime | 发生时间（UTC） |
| description | String | 摘要，必填 |
| merchant | String? | 商户/对方 |
| note | String? | 备注 |
| categoryId | UUID? | 收入/支出/调整必填，转账必须为空 |
| status | Enum | `posted` / `voided` |
| version | Int | 乐观锁版本 |
| voidedAt | DateTime? | 冲正时间 |
| createdAt / updatedAt | DateTime | |

索引：`(userId, occurredAt DESC)`、`(userId, type, occurredAt DESC)`、`(userId, categoryId)`。

**删除策略**：不提供硬删除。`DELETE /api/transactions/:id` 表示冲正（`status = voided`），历史与分录全部保留。

#### TransactionEntry

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| userId | UUID | 冗余归属，用于统一授权过滤 |
| transactionId | UUID | 所属交易 |
| accountId | UUID? | 真实账户；`null` 表示外部腿（收入/支出/权益对手方） |
| amount | Decimal(20,6) | 有符号金额，正为流入、负为流出 |
| currency | String | 与账户币种一致；外部腿取交易币种 |
| createdAt | DateTime | |

索引：`(transactionId)`、`(accountId, createdAt)`、`(userId, accountId)`。

**复式规则（Phase 1 强约束）**

1. 每笔交易至少两条分录，且 `SUM(amount) = 0`（同币种）。
2. `income` / `expense` / `adjustment`：恰好一条真实账户腿 + 一条外部腿（`accountId IS NULL`），两条金额互为相反数。
3. `transfer`：恰好两条真实账户腿，账户不同、币种相同、金额互为相反数，且 `categoryId` 为空。
4. 任一条不满足则整个事务回滚，返回 `LEDGER_UNBALANCED`。

**账户余额口径**：`openingBalance + SUM(entries.amount WHERE transaction.status = posted AND entry.accountId = :id)`。不做余额冗余字段，避免与分录不一致。

#### SimulationScenario

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| userId | UUID | 归属用户 |
| name | String | 场景名称 |
| principal | Decimal(20,6) | 初始本金 |
| contributionAmount | Decimal(20,6) | 每期投入，可为 0 |
| contributionFrequency | Enum | `none` / `monthly` / `annual` |
| contributionTiming | Enum | `end` / `begin`，默认 `end` |
| annualReturnRate | Decimal(10,6) | 名义年化，小数表示（0.07 = 7%） |
| years | Int | 1–100 |
| inflationRate | Decimal(10,6) | 年通胀率 |
| feeRate | Decimal(10,6) | 年费用率 |
| modelVersion | String | 默认 `compound-v1`，结果可复现 |
| createdAt / updatedAt | DateTime | |

**不存储计算结果**：参数确定则结果确定，读取时实时计算，避免结果与参数不一致。结果导出推迟。

#### ExchangeRate

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| userId | UUID | 归属用户（个人汇率，非全局） |
| baseCurrency | String | 基准币种 |
| quoteCurrency | String | 计价币种 |
| rate | Decimal(20,10) | 1 base = rate quote |
| rateDate | Date | 生效日期 |
| source | Enum | Phase 1 仅 `manual` |
| createdAt | DateTime | |

唯一约束：`(userId, baseCurrency, quoteCurrency, rateDate)`。

#### AuditLog

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| userId | UUID? | 操作人 |
| action | String | 如 `auth.login`、`transaction.void`、`account.archive` |
| targetType | String? | 对象类型 |
| targetId | String? | 对象 ID |
| metadata | Json? | 脱敏后的元数据 |
| ip / userAgent | String? | 来源 |
| createdAt | DateTime | |

**禁止写入**：密码、令牌、完整交易金额明细、账户完整号码。审计只记录动作与对象标识。

---

## 五、关键设计决策

| # | 决策点 | 结论 | 理由 |
|---|--------|------|------|
| 1 | 后端目录风格 | `routes/` + `modules/<domain>/` + `lib/` | 与《项目目录结构》一致；分层式 `services/repositories` 对该规模过度抽象 |
| 2 | 服务入口 | `src/index.ts` 启动 + `src/app.ts` 装配 | 与目录文档一致，便于测试注入 |
| 3 | 请求校验 | 仅 Zod | 避免 Zod/TypeBox 双轨，Fastify schema 由 Zod 转换生成 |
| 4 | 金额精度 | `DECIMAL(20,6)`，汇率 `DECIMAL(20,10)` | 覆盖多数法币与证券价格；运算与舍入统一走 `lib/money.ts` |
| 5 | 金额传输 | JSON 字符串（`"1234.560000"`） | 避免 JS number 精度丢失，与 API 文档一致 |
| 6 | 复式分录 | 交易头 + 分录，含外部腿 | 支撑转账、调整与未来信用卡还款的同一模型 |
| 7 | 分类归属 | 系统预设在建号时复制给用户 | 避免 `userId = NULL` 的权限分支与唯一索引空值问题 |
| 8 | 交易删除 | 冲正替代硬删 | 保留余额可追溯性，符合功能文档要求 |
| 9 | 转账币种 | Phase 1 仅同币种 | 跨币种需汇兑差额与双侧汇率，正确性成本高 |
| 10 | 汇率来源 | 仅手工维护 | 无外部依赖，Dashboard 缺失汇率时明确报错 |
| 11 | 时区处理 | 存储 UTC，统计按用户时区切月 | 避免月末跨时区错分 |
| 12 | 分页 | `page` + `pageSize`，上限 100 | Phase 1 数据量小，不需要游标分页 |
| 13 | 乐观锁 | `accounts.version`、`transactions.version` | 冲突返回 409，避免并发覆盖 |
| 14 | 幂等 | 写接口支持 `Idempotency-Key`，Redis 缓存 24h | 转账与交易创建必须防重复提交 |
| 15 | 密码重置令牌 | Redis 存储哈希，TTL 30 分钟，一次性 | 免去额外表；重置成功即删除 |
| 16 | 异步任务 | 不引入 | Phase 1 无长任务，全部同步返回 |

### 统一错误码（Phase 1 子集）

| 错误码 | HTTP | 说明 |
|--------|------|------|
| `UNAUTHORIZED` | 401 | 未登录或会话失效 |
| `FORBIDDEN` | 403 | 无权访问该资源（含跨用户访问） |
| `NOT_FOUND` | 404 | 资源不存在或不属于当前用户 |
| `VALIDATION_ERROR` | 400 | 参数校验失败 |
| `CONFLICT` | 409 | 版本冲突或状态冲突 |
| `IDEMPOTENCY_CONFLICT` | 409 | 幂等键内容不一致 |
| `EMAIL_EXISTS` | 409 | 邮箱已注册 |
| `USER_DISABLED` | 403 | 账号已禁用 |
| `ACCOUNT_ARCHIVED` | 409 | 账户已归档，不可记账 |
| `ACCOUNT_HAS_TRANSACTIONS` | 409 | 账户存在流水，只能归档 |
| `LEDGER_UNBALANCED` | 422 | 分录不平衡或腿数不合法 |
| `CATEGORY_KIND_MISMATCH` | 422 | 分类类型与交易类型不符 |
| `CROSS_CURRENCY_TRANSFER_UNSUPPORTED` | 422 | Phase 1 不支持跨币种转账 |
| `CURRENCY_RATE_MISSING` | 422 | 折算所需汇率缺失 |
| `SIMULATION_PARAMETERS_INVALID` | 422 | 模拟参数越界 |
| `RATE_LIMITED` | 429 | 请求过于频繁 |
| `SYSTEM_ERROR` | 500 | 服务内部错误 |

---

## 六、S1 — 基础设施搭建

### 6.1 项目初始化

- [ ] 初始化 `server/`：TypeScript + Fastify 5 + tsx 开发启动
- [ ] 初始化 `frontend/`：Vite 8 + React 19 + TypeScript + Tailwind CSS 4
- [ ] 配置 `npm` 工作脚本：`dev` / `build` / `test` / `lint` / `typecheck`
- [ ] 配置 ESLint + Prettier，前后端共用规则
- [ ] 配置 `docker-compose.yml`（postgres + redis + api + nginx）
- [ ] 配置 `nginx/default.conf`：静态资源、`/api` 反代、SPA fallback
- [ ] 编写 `.env.example`
- [ ] 配置 `.gitignore`：排除 `.env`、`node_modules`、`uploads/`、`backups/`、构建产物

### 6.2 Prisma 与数据库

- [ ] 编写 `schema.prisma`：第四节全部 13 个模型
- [ ] 首条迁移 `init`，确认表、索引、唯一约束生成
- [ ] 编写 `prisma/seed.ts`：创建超级管理员、分类模板常量
- [ ] 编写 `src/lib/db.ts`：Prisma 单例与优雅关闭
- [ ] 配置金额字段映射为 `Decimal`，禁止使用 `Float`

### 6.3 后端基础架构

| 文件 | 说明 |
|------|------|
| `src/index.ts` | 启动、监听 4000、信号处理、优雅退出 |
| `src/app.ts` | Fastify 实例与插件/路由注册，导出 `buildApp()` 供测试注入 |
| `src/config/env.ts` | 环境变量 Zod 校验，缺失即启动失败 |
| `src/config/constants.ts` | 业务枚举、分页上限、币种精度表 |
| `src/plugins/prisma.ts` | Prisma 生命周期 |
| `src/plugins/redis.ts` | Redis 连接与关闭 |
| `src/plugins/security.ts` | Helmet、CORS、限流 |
| `src/plugins/error-handler.ts` | 统一错误响应与 `requestId` |
| `src/lib/api-utils.ts` | 统一响应封装、分页元数据 |
| `src/lib/errors.ts` | 业务错误类型与错误码 |
| `src/lib/logger.ts` | Pino 配置与敏感字段脱敏 |
| `src/lib/money.ts` | Decimal 运算、舍入与展示 |
| `src/routes/system.ts` | 健康、就绪、版本、能力声明 |

### 6.4 前端基础架构

- [ ] `api/client.ts`：统一 fetch 封装、凭据携带、错误码映射、401 自动刷新
- [ ] `App.tsx` + 路由骨架、`AuthGuard`
- [ ] `AppLayout`：侧边栏 + 顶栏 + 内容区（侧边栏使用独立全屏根布局，内容区独立滚动）
- [ ] 通用状态组件：`LoadingState` / `EmptyState` / `ErrorState`
- [ ] 金额组件 `MoneyDisplay`：千分位、币种符号、精度按币种
- [ ] Zustand 仅存放 UI 偏好（侧栏折叠、主题），服务端状态全部走 TanStack Query

### 6.5 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/system/health` | 存活探针，不访问数据库 |
| GET | `/api/system/ready` | 数据库与 Redis 就绪探针 |
| GET | `/api/system/version` | 版本与构建信息 |
| GET | `/api/system/capabilities` | 声明 Phase 1 可用能力，便于前端按能力渲染 |

### 6.6 边界状态处理

| 场景 | 处理 |
|------|------|
| 环境变量缺失 | 启动即失败并打印缺失项名称，不打印值 |
| 数据库不可用 | `/api/system/ready` 返回 503，`/health` 仍返回 200 |
| Redis 不可用 | 就绪探针返回 503；限流与幂等降级为进程内实现并记录告警 |
| 前端请求 401 | 客户端自动尝试刷新一次，失败则清空状态跳转登录 |
| 未知路由（API） | 统一 404 响应体，不返回 HTML |

---

## 七、S2 — 用户认证、资料与设置

### 7.1 后端接口

#### 认证与会话（11）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/register` | 注册，事务内创建用户、设置、分类 |
| POST | `/api/auth/login` | 登录，签发访问令牌与刷新 Cookie |
| POST | `/api/auth/logout` | 撤销当前会话 |
| POST | `/api/auth/refresh` | 轮换刷新令牌并签发新访问令牌 |
| GET | `/api/auth/me` | 当前用户与角色 |
| POST | `/api/auth/change-password` | 改密并撤销其他会话 |
| POST | `/api/auth/forgot-password` | 发送重置邮件（未配置 SMTP 时的处理见下） |
| POST | `/api/auth/reset-password` | 一次性令牌重置 |
| GET | `/api/auth/sessions` | 我的登录会话列表 |
| DELETE | `/api/auth/sessions/:id` | 撤销指定会话 |
| DELETE | `/api/auth/sessions` | 撤销其他全部会话 |

#### 资料与偏好（4）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/profile` | 个人资料 |
| PATCH | `/api/profile` | 更新昵称 |
| GET | `/api/profile/preferences` | 偏好 |
| PATCH | `/api/profile/preferences` | 更新基准币种、时区、日期格式、主题 |

#### 设置（4）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/settings` | 个人设置汇总 |
| PATCH | `/api/settings` | 修改基础设置 |
| GET | `/api/settings/security` | 安全偏好（会话有效期展示等） |
| PATCH | `/api/settings/security` | 修改可在线调整的安全项 |

### 7.2 业务逻辑

#### 注册

```
1. Zod 校验 email / password / nickname
2. 检查邮箱唯一（唯一约束兜底，冲突转 EMAIL_EXISTS）
3. Argon2id 哈希密码
4. 事务内：
   a. 创建 users（role=user, status=active）
   b. 创建 user_settings（默认 CNY / Asia/Shanghai / dark）
   c. 从分类模板复制二级分类树给该用户
   d. 写入 audit_logs: auth.register
5. 自动登录（复用登录流程）并返回用户信息
```

#### 登录

```
1. 按 email 查用户
2. 用户不存在或密码错误 → 统一 401，提示“邮箱或密码错误”，不区分
3. status != active → 403 USER_DISABLED
4. 签发 access token（15 分钟，jose HS256）
5. 生成 refresh token（随机 32 字节），存 SHA-256 哈希到 user_sessions（7 天）
6. 设置 Cookie：refresh 令牌 HttpOnly + Secure(生产) + SameSite=Lax + Path=/api/auth
7. 更新 lastLoginAt / lastLoginIp，写入审计
8. 返回用户信息（不含哈希）与 access token
```

#### 刷新与轮换

```
1. 从 Cookie 读取 refresh token → 计算哈希查会话
2. 会话不存在 / 已撤销 / 已过期 → 401，并清除 Cookie
3. 校验 users.sessionVersion 与令牌内版本一致（改密/禁用后自动失效）
4. 生成新 refresh token，更新同一会话记录（旧令牌立即失效）
5. 返回新 access token
```

#### 改密与撤销

```
1. 校验旧密码
2. 更新 passwordHash，sessionVersion += 1
3. 撤销除当前会话外的全部 user_sessions
4. 写审计 auth.password_changed
```

#### 忘记密码

```
1. 无论邮箱是否存在都返回 202，避免账号枚举
2. 存在则生成随机令牌，Redis 键 pwdreset:{sha256(token)} → userId，TTL 30 分钟
3. 通过 SMTP 发送链接；未配置 SMTP 时：
   - NODE_ENV=development：将链接写入服务端日志（仅开发环境）
   - 生产：返回 503 MAIL_NOT_CONFIGURED，提示需配置 SMTP
4. 重置成功后删除键并撤销全部会话
```

#### 权限上下文

```
- 认证插件解析 access token → 注入 request.auth = { userId, role, sessionId }
- 所有业务查询强制带 userId 条件，不从请求体/查询参数读取归属
- 访问他人资源统一返回 404（不暴露存在性）
```

### 7.3 前端页面

#### 认证页

- **LoginPage**：邮箱 + 密码；提交中禁用按钮；错误区分「凭据错误」「账号已禁用」「请求过于频繁」
- **RegisterPage**：邮箱、昵称、密码、确认密码；密码强度提示；成功后进入 Dashboard
- **ForgotPasswordPage**：输入邮箱，统一提示「若邮箱存在，已发送重置链接」
- **ResetPasswordPage**：读取链接令牌，设置新密码，成功后跳登录

#### 资料与设置

- **ProfilePage**：昵称编辑、邮箱只读、修改密码、会话列表（设备、IP 脱敏、最近使用时间、撤销按钮）
- **SettingsPage**：Tab 分栏——基础设置（基准币种、时区、日期格式、主题）、安全设置

### 7.4 边界状态处理

| 场景 | 处理 |
|------|------|
| 邮箱已注册 | 409 `EMAIL_EXISTS`，注册页就地提示 |
| 密码错误 | 401，不区分邮箱不存在与密码错误 |
| 账号禁用 | 403 `USER_DISABLED` |
| 访问令牌过期 | 前端自动刷新一次；刷新失败跳登录 |
| 刷新令牌重放 | 会话已轮换导致哈希不匹配 → 401，同时撤销该会话 |
| 改密后旧会话 | 因 sessionVersion 递增全部失效 |
| 跨用户访问 | 统一 404，不返回 403（避免资源枚举） |
| 时区非法 | 400，校验 IANA 时区数据库 |
| 基准币种非法 | 400，仅接受支持列表内代码 |
| SMTP 未配置 | 生产返回 503 并提示管理员配置；开发仅写日志 |

---

## 八、S3 — 账户、分类与标签

### 8.1 后端接口

#### 账户（13）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/accounts` | 账户列表，支持状态与类型筛选 |
| POST | `/api/accounts` | 创建账户 |
| GET | `/api/accounts/:id` | 账户详情 |
| PATCH | `/api/accounts/:id` | 更新元数据（名称、机构、备注、期初余额） |
| DELETE | `/api/accounts/:id` | 有流水时拒绝，无流水时归档 |
| POST | `/api/accounts/:id/archive` | 归档 |
| POST | `/api/accounts/:id/unarchive` | 取消归档 |
| GET | `/api/accounts/:id/balance` | 当前余额与计算口径 |
| GET | `/api/accounts/:id/balance-history` | 按日/月余额曲线 |
| GET | `/api/accounts/:id/transactions` | 该账户的分页流水 |
| POST | `/api/accounts/:id/reconcile` | 创建对账记录 |
| GET | `/api/accounts/:id/reconciliations` | 对账历史 |
| GET | `/api/accounts/:id/reconciliations/:reconciliationId` | 对账详情 |

#### 分类（6）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/categories` | 两级分类树，可按 `kind` 过滤 |
| POST | `/api/categories` | 新建分类（一级或二级） |
| GET | `/api/categories/:id` | 详情 |
| PATCH | `/api/categories/:id` | 改名、调整父级、排序 |
| DELETE | `/api/categories/:id` | 有引用时拒绝，提示迁移 |
| POST | `/api/categories/reorder` | 批量排序 |

#### 标签（6）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/tags` | 标签列表 |
| POST | `/api/tags` | 创建标签 |
| PATCH | `/api/tags/:id` | 重命名 |
| DELETE | `/api/tags/:id` | 删除（同时解除绑定） |
| POST | `/api/transactions/:id/tags` | 绑定标签 |
| DELETE | `/api/transactions/:id/tags/:tagId` | 解绑标签 |

#### 币种（1）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/currencies` | 支持币种、符号、小数位 |

### 8.2 业务逻辑

#### 账户余额

```
balance(accountId, asOf?) =
  openingBalance
  + SUM(transaction_entries.amount)
    WHERE entry.accountId = :accountId
      AND transaction.status = 'posted'
      AND (:asOf IS NULL OR transaction.occurredAt <= :asOf)
```

- 响应必须带 `asOf`、`openingBalanceDate`、`entryCount`，明确口径。
- 不缓存余额；账户数量与流水量在个人场景下可接受实时计算。
- 归档账户不参与新建交易，但历史余额与统计仍保留。

#### 期初余额修改

```
1. 校验 version 乐观锁
2. 若该账户已有 posted 分录且用户修改期初余额：
   允许修改，但响应中返回提示与新的当前余额（历史流水不变）
3. 写审计 account.opening_balance_changed，记录前后值
```

#### 对账

```
1. 计算当前系统余额
2. difference = statementBalance - computedBalance
3. 保存 reconciliation 记录（不做任何自动调整）
4. 返回差异与建议：差异非零时提示用户可创建 adjustment 交易
```

#### 分类删除

```
1. 统计 transactions / 子分类 引用数
2. 有引用 → 409 CONFLICT，返回引用数量
3. 无引用 → archived = true（不物理删除，保留历史语义）
```

#### 列表与分页

- 统一 `page`（默认 1）、`pageSize`（默认 20，上限 100）。
- 返回 `meta.pagination`：`page`、`pageSize`、`total`、`totalPages`。
- 排序白名单：`createdAt`、`name`、`balance`（账户），其余字段拒绝。

### 8.3 前端页面

- **AccountsPage**：账户卡片/表格，展示名称、机构、类型、币种、当前余额、负债标识；顶部汇总资产与负债；新建/编辑弹窗；归档开关；空状态引导「创建第一个账户」
- **AccountDetailPage**：余额与口径说明、余额曲线、该账户流水列表、对账记录与新建对账、归档操作
- **CategoriesPage**：两级分类树，按收入/支出分栏；新增、改名、排序；删除时提示引用数量
- **TagsPage**（可并入设置）：标签管理
- 组件：`AccountCard`、`MoneyDisplay`、`ConfirmDialog`、`DateRangePicker`

### 8.4 边界状态处理

| 场景 | 处理 |
|------|------|
| 删除有流水的账户 | 409 `ACCOUNT_HAS_TRANSACTIONS`，提示改为归档 |
| 归档账户上新建交易 | 409 `ACCOUNT_ARCHIVED` |
| 期初余额日期晚于已有流水 | 允许，但响应提示余额曲线可能不连续 |
| 账户币种变更 | Phase 1 禁止（422），需新建账户迁移 |
| 二级分类再挂子级 | 400，最多两级 |
| 分类类型与父级不符 | 400 |
| 删除仍被引用的分类 | 409，返回引用数 |
| 标签重名 | 409 |
| 余额历史区间过大 | 按日聚合并限制最多 2 年，超出转月度聚合 |

---

## 九、S4 — 交易账本

### 9.1 后端接口

#### 交易（8）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/transactions` | 分页查询，支持日期、账户、分类、类型、金额、关键词筛选 |
| POST | `/api/transactions` | 创建收入/支出/调整（服务端生成分录） |
| GET | `/api/transactions/:id` | 详情与分录 |
| PATCH | `/api/transactions/:id` | 修改并可重算分录，需 `version` |
| DELETE | `/api/transactions/:id` | 冲正（status=voided），不物理删除 |
| POST | `/api/transactions/bulk-categorize` | 批量分类，最多 500 条 |
| POST | `/api/transactions/bulk-update` | 批量备注/标签 |
| GET | `/api/transactions/:id/entries` | 分录明细 |

#### 转账（3）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/transfers` | 创建账户间转账（一条交易两条分录） |
| GET | `/api/transfers` | 转账列表（`type=transfer` 的视图） |
| DELETE | `/api/transfers/:id` | 冲正转账，两条分录同时失效 |

### 9.2 业务逻辑

#### 创建收入/支出

```
1. Zod 校验：description、occurredAt、amountMagnitude > 0、categoryId、accountId
2. 账户归属当前用户且 status=active
3. 分类归属当前用户，kind 与 type 匹配
4. 事务内：
   a. 创建 transactions(type, categoryId, occurredAt, ...)
   b. 创建两条分录：
      income:     账户腿 +amount，外部腿 -amount
      expense:    账户腿 -amount，外部腿 +amount
   c. 校验 SUM(amount) = 0，否则抛 LEDGER_UNBALANCED
   d. 写审计（仅在敏感操作时，普通记账不写）
5. 返回交易与账户新余额
```

#### 余额调整

```
1. 用户输入目标余额或调整金额（二者其一）
2. 计算当前余额，得出差额
3. 差额为 0 → 400，无需调整
4. 创建 adjustment 交易：账户腿 = 差额，外部腿 = -差额
5. 分类：使用系统「其他收入/其他支出」，保留调整语义
```

#### 账户间转账

```
1. 校验 fromAccount != toAccount
2. 两者归属当前用户且 active
3. 币种相同，否则 CROSS_CURRENCY_TRANSFER_UNSUPPORTED
4. 事务内创建：
   transactions(type=transfer, categoryId=NULL)
   entry A: fromAccount, -amount
   entry B: toAccount,   +amount
5. 校验 SUM = 0 与两条真实腿
6. 返回转账记录与两个账户的新余额
```

#### 修改交易

```
1. 校验 version（不匹配 → 409 CONFLICT）
2. 仅 posted 状态可修改，voided 返回 409
3. 涉及金额/账户/类型变更时，事务内删除并重建分录后再次校验平衡
4. version += 1
5. 写审计 transaction.updated（记录变更字段名，不记录金额明细）
```

#### 冲正

```
1. 校验交易归属与 status=posted
2. status = voided，voidedAt = now
3. 分录保留但不再计入余额（查询统一按 posted 过滤）
4. 写审计 transaction.void
```

#### 批量操作

```
1. ids 数量上限 500，去重
2. 一次性校验全部交易归属当前用户；任一不属于 → 404（整体失败）
3. 分类操作额外校验 kind 匹配
4. 单事务更新，返回成功条数与失败明细
```

### 9.3 前端页面

- **TransactionsPage**：表格（日期、类型、摘要、商户、分类、账户、金额、状态）；筛选栏（日期区间、账户、分类、类型、关键词）；多选后批量分类/批量备注；新建与编辑使用侧滑抽屉；冲正需二次确认
- **交易表单**：类型切换（收入/支出/转账/调整）动态变更字段；转账时选择转出/转入账户；金额输入做正数校验；提交失败保留已填内容
- **分录视图**：详情抽屉内展开，展示两条腿的账户、方向、金额
- 组件：`TransactionTable`、`TransactionForm`、`TransferDialog`

### 9.4 边界状态处理

| 场景 | 处理 |
|------|------|
| 分录取和不为零 | 422 `LEDGER_UNBALANCED`，整笔回滚 |
| 转账同名账户 | 400 |
| 跨币种转账 | 422 `CROSS_CURRENCY_TRANSFER_UNSUPPORTED`，提示后续版本支持 |
| 归档账户记账 | 409 `ACCOUNT_ARCHIVED` |
| 收入用了支出分类 | 422 `CATEGORY_KIND_MISMATCH` |
| 修改已冲正交易 | 409，提示已冲正不可修改 |
| 版本冲突 | 409 `CONFLICT`，提示刷新后重试 |
| 发生时间在未来 | 允许至当前时间 +24h（时区容差），超出 400 |
| 金额为 0 或负 | 400 |
| 批量操作含他人交易 | 404，不做部分成功 |
| 重复提交（双击） | 幂等键拦截，返回首次结果 |

---

## 十、S5 — Dashboard 与基础分析

### 10.1 后端接口

#### Dashboard（7）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/dashboard/overview` | 总资产、总负债、净资产、当月收入/支出/结余 |
| GET | `/api/dashboard/net-worth-trend` | 净资产趋势（按日或月） |
| GET | `/api/dashboard/cashflow` | 收入/支出/净结余时间序列 |
| GET | `/api/dashboard/asset-allocation` | 按账户类型与币种的资产占比 |
| GET | `/api/dashboard/account-balances` | 账户余额汇总 |
| GET | `/api/dashboard/recent-transactions` | 最近流水 |
| GET | `/api/dashboard/data-quality` | 未分类数、汇率缺失、对账差异 |

#### 汇率（3）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/exchange-rates` | 查询指定日期与币种对汇率 |
| POST | `/api/exchange-rates/manual` | 录入手工汇率 |
| DELETE | `/api/exchange-rates/manual/:id` | 删除手工汇率 |

### 10.2 业务逻辑

#### 折算

```
convert(amount, from, to, asOf):
  1. from == to → 原值
  2. 查 exchange_rates：userId + 币种对 + rateDate <= asOf，取最近一条
  3. 支持反向（用 1/rate）但禁止链式套算（A→B→C）
  4. 缺失 → 422 CURRENCY_RATE_MISSING，响应列出缺失币种对
```

**禁止链式套算**：避免因中间汇率精度产生难以解释的净值偏差；响应中明确要求用户补齐直接汇率。

#### 净资产

```
totalAssets      = Σ(账户余额折算) WHERE type NOT IN (credit_card, loan) AND status = active
totalLiabilities = Σ(|账户余额折算|) WHERE type IN (credit_card, loan) AND status = active
netWorth         = totalAssets - totalLiabilities
```

- 响应必须包含：`asOf`、`baseCurrency`、`rateDateUsed`、`excludedAccounts`（无汇率被排除的账户）。
- 余额为负的资产账户按负值计入资产，不自动转为负债（信用卡/贷款类型才计负债）。

#### 现金流

```
区间按用户时区切分自然月
income  = Σ 分录中 type=income 且 posted 的账户腿正向金额
expense = Σ |type=expense 且 posted 的账户腿负向金额|
transfer、adjustment 不计入收入与支出
savingsRate = income > 0 ? (income - expense) / income : null
```

- 响应带 `isComplete` 标记：区间内无任何流水的月份标记为「数据不完整」，前端不得显示为 0 支出。
- 转账在单独指标中统计，不混入消费。

#### 净资产趋势

Phase 1 采用**按分录重算**：对每个采样点（日或月）计算 `openingBalance + Σ entries <= 采样点`。

- 采样粒度：区间 ≤ 90 天按日，否则按月。
- 账户数 × 采样点超出阈值（如 200,000 次聚合）时降级为月度，并在响应中返回 `granularity`。
- 不引入余额快照表，避免与分录双口径。

#### 资产配置

- 维度一：按账户类型（现金、银行、证券、其他）。
- 维度二：按币种（原币金额，不折算）。
- 占比以折算后的基准币种计算，保留 2 位小数，前端图表自行处理尾差。

#### 数据质量

| 指标 | 口径 |
|------|------|
| 未分类流水数 | `type IN (income, expense, adjustment)` 且 `categoryId IS NULL` 且 posted |
| 汇率缺失 | 存在非基准币种账户但其币种无可用汇率 |
| 对账差异 | 最近一次对账 `difference != 0` 的账户数 |
| 归档但仍有余额 | 归档账户余额非零（提示用户核实） |

### 10.3 前端页面

- **DashboardPage**
  - 顶部指标卡：净资产、总资产、总负债、当月结余、储蓄率（不可计算时显示「—」）
  - 净资产趋势图（`NetWorthChart`，折线 + 面积）
  - 现金流图（`CashflowChart`，收入/支出分组柱状 + 结余折线）
  - 资产配置图（`AllocationChart`，环形图，按类型）
  - 账户余额列表与最近流水
  - 数据质量卡片：未分类数与跳转链接、汇率缺失提示、对账差异提示
  - 每张图下方以灰字展示统计口径：区间、基准币种、汇率日期、是否完整

- **SettingsPage 增补**：手工汇率维护表（币种对、汇率、生效日期、删除）

### 10.4 边界状态处理

| 场景 | 处理 |
|------|------|
| 无任何账户 | Dashboard 展示空状态引导创建账户，不显示 0 净值 |
| 无任何流水 | 现金流图显示空状态，明确「暂无数据」而非 0 线 |
| 汇率缺失 | 相关账户从折算中排除并显式提示，不静默按 1:1 处理 |
| 收入为 0 | 储蓄率返回 null，前端显示「—」 |
| 多币种且缺少汇率 | 422，响应列出缺失币种对 |
| 采样点过多 | 自动降级为月度并在响应标记 `granularity` |
| 用户时区变更 | 统计按其当前时区重算并在口径说明中展示 |
| 仅有归档账户 | 提示「所有账户已归档」，指标基于归档账户并标注 |

---

## 十一、S6 — 复利与定投模拟

### 11.1 后端接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/simulations/compound` | 场景列表 |
| POST | `/api/simulations/compound` | 保存场景 |
| GET | `/api/simulations/compound/:id` | 场景详情（含实时计算结果） |
| PATCH | `/api/simulations/compound/:id` | 更新参数 |
| DELETE | `/api/simulations/compound/:id` | 删除场景 |
| POST | `/api/simulations/compound/calculate` | 即时计算，不落库 |
| POST | `/api/simulations/compound/compare` | 2–4 个场景并排对比 |
| POST | `/api/simulations/compound/:id/duplicate` | 复制场景 |

### 11.2 计算内核规范（`modules/simulations/compound.engine.ts`）

**输入**

| 参数 | 约束 | 默认 |
|------|------|------|
| principal | ≥ 0 | 0 |
| contributionAmount | ≥ 0 | 0 |
| contributionFrequency | none / monthly / annual | monthly |
| contributionTiming | begin / end | end |
| annualReturnRate | > -1，≤ 1 | 0.07 |
| years | 1–100，整数 | 20 |
| inflationRate | ≥ -0.5，≤ 0.5 | 0.025 |
| feeRate | ≥ 0，≤ 0.05 | 0 |

**换算约定（必须在实现与测试中固定）**

```
月度有效收益率： i = (1 + annualReturnRate)^(1/12) - 1
月度有效费用率： g = 1 - (1 - feeRate)^(1/12)
不采用 r/12 简单除法；换算方式作为 modelVersion 的一部分
```

**逐月迭代顺序（每期固定为：收益 → 费用 → 投入）**

```
期末投入 end：
  value = value * (1 + i)
  value = value * (1 - g)
  value = value + contribution
期初投入 begin：
  value = value + contribution
  value = value * (1 + i)
  value = value * (1 - g)
```

**年付的处理**：仍以月为子步迭代（保证与月付同一复利粒度），年付投入落在每年第一个月的子步上，投入时点仍遵循 `end` / `begin`。不得用「按年一次性复利」的写法，否则年付与月付结果不可比。

**输出**

| 字段 | 说明 |
|------|------|
| totalContributed | 累计投入本金（含初始本金） |
| finalNominalValue | 期末名义价值 |
| totalGain | 名义收益 = 期末 − 累计投入 |
| finalRealValue | 按通胀折算的实际购买力 |
| yearlySchedule | 每年末：累计投入、名义价值、实际价值、累计收益、当年收益 |
| effectiveAnnualReturn | 由结果反推的有效年化，用于交叉验证 |

**约束**

- 全部使用 `decimal.js`，内部保留 6 位小数，仅在展示层舍入。
- 纯函数：输入相同则输出完全相同，不读时钟、不读数据库。
- 不生成任何真实交易或账户余额。

### 11.3 业务逻辑

#### 即时计算

```
1. Zod 校验参数边界
2. 调用 compound.engine
3. 返回结果与 `assumptions`（字段化列出全部假设，含 modelVersion）
4. 不写库
```

#### 保存场景

```
1. 校验参数并试算一次，失败则不入库
2. 同一用户场景名唯一（冲突返回 409）
3. 写库并返回 id
```

#### 对比

```
1. 接收 2–4 个 scenarioId，或直接传入 2–4 组参数
2. 全部归属当前用户（id 模式）
3. 分别计算，返回并排结果与终值差额
4. 场景数超限 → 400
```

### 11.4 前端页面

- **CompoundPage**
  - 左侧参数面板：本金、每期投入、频率、投入时点、年化收益率、期限、通胀、费用
  - 参数变更后防抖 300ms 调 `/calculate` 实时更新
  - 右侧图表：本金与收益分色堆叠面积图（`CompoundChart`）
  - 下方年度明细表：年份、当年投入、累计投入、名义价值、实际价值
  - 明显标注「固定收益率仅为数学假设，不代表实际收益」
  - 场景管理：保存、命名、复制、删除、对比视图（最多 4 条曲线）
  - 假设说明卡片：列出全部假设与换算方式

### 11.5 边界状态处理

| 场景 | 处理 |
|------|------|
| 收益率 ≤ -100% | 422 `SIMULATION_PARAMETERS_INVALID` |
| 收益率 > 100% | 422，提示超出合理区间 |
| 期限为 0 或 > 100 年 | 422 |
| 每期投入为负 | 422 |
| 本金与投入都为 0 | 422，提示至少需要一项 |
| 费用率过高导致价值衰减 | 正常计算并在图表中如实体现，不截断 |
| 参数与已保存场景相同 | 提示「参数无变化，未保存」 |
| 对比超过 4 个场景 | 400 |
| 浮点显示 | 后端返回字符串，前端按两位小数展示，表格可切换精度 |

---

## 十二、S7 — 体验完善与交付

### 12.1 前端完善

- [ ] 深色模式为默认，浅色可切换，偏好持久化到用户设置
- [ ] 移动端断点：侧栏折叠为抽屉，表格转卡片列表
- [ ] 全站空状态、错误状态、加载骨架
- [ ] 金额千分位与币种符号统一走 `MoneyDisplay`
- [ ] 键盘可达性：抽屉与对话框焦点陷阱、Esc 关闭、表单标签关联
- [ ] 全局错误边界与请求失败重试提示

### 12.2 测试

| 类型 | 内容 |
|------|------|
| 单元 | 复利内核黄金用例、金额舍入、汇率折算、分录平衡校验 |
| 集成 | 注册→登录→建账户→记账→余额一致；跨用户访问全部 404；冲正后余额回退 |
| 端到端 | Playwright 跑通：注册 → 建账户 → 记一笔支出 → Dashboard 指标变化 → 保存复利场景 |

**复利黄金用例（作为快照测试基线，实现时须用独立工具复核）**

| 用例 | 输入 | 期望 |
|------|------|------|
| A | 本金 10000，无定投，7%，20 年 | 38,696.84 |
| B | 本金 0，每月末 500，7%，20 年 | 253,768.19 |
| C | 本金 10000，每月末 500，7%，20 年 | 292,465.03 |
| D | 本金 10000，年化 0%，20 年，无定投 | 10,000.00 |
| E | 用例 C + 通胀 2.5%，20 年 | 实际价值 178,482.91 |
| F | 本金 0，每年末 6000，7%，20 年 | 261,711.31 |
| G | 对照：用例 A 若改用 r/12 简单除法 | 40,387.39（**不应出现**） |

> 数值按「月度有效利率 `i = (1+r)^(1/12) - 1`、期末投入」约定计算，允许 ±0.01 舍入误差。用例 G 是对照项：如果实现用了 `r/12`，A 会得到约 40,387 而非 38,697，测试必须能区分这两种口径。用例 F 同时验证年付通过 12 个月子步迭代、在每月第 1 步投入的实现方式。

### 12.3 部署与文档

- [ ] Docker Compose 全栈启动：postgres、redis、api、nginx
- [ ] 前端在生产镜像内构建，由 Nginx 托管，不常驻 Vite
- [ ] `README.md`：定位、功能范围、快速启动、环境变量、备份说明
- [ ] `LICENSE` 定稿
- [ ] 示例数据脚本（虚构流水，供截图与演示）
- [ ] `.env.example` 与部署文档同步

---

## 十三、接口清单汇总

| 模块 | 接口数 | 所属阶段 |
|------|--------|----------|
| 系统维护（health/ready/version/capabilities） | 4 | S1 |
| 认证与会话 | 11 | S2 |
| 个人资料与偏好 | 4 | S2 |
| 设置 | 4 | S2 |
| 财务账户 | 13 | S3 |
| 分类 | 6 | S3 |
| 标签 | 6 | S3 |
| 币种 | 1 | S3 |
| 交易流水与分录 | 8 | S4 |
| 转账 | 3 | S4 |
| Dashboard | 7 | S5 |
| 汇率（查询与手工） | 3 | S5 |
| 复利模拟 | 8 | S6 |
| **合计** | **80** | |

> 后续阶段新增：账单导入 17、资产与负债 14、自动分类规则 8、收支分析扩展 10、预算 9、投资组合 16、投资交易 11、资产配置 5、蒙特卡罗 13、财富目标 10、报告 10、数据管理 14、任务 4、通知与审计 5、管理后台约 31、系统设置扩展 6。

---

## 十四、技术依赖清单

### 后端

```
fastify @fastify/cookie @fastify/helmet @fastify/rate-limit @fastify/cors
@prisma/client prisma
jose argon2 zod decimal.js
ioredis pino pino-pretty
nodemailer date-fns date-fns-tz
typescript tsx vitest @types/node
```

> Fastify 的 schema 由 Zod 定义后转换生成，不额外引入 TypeBox。

### 前端

```
react react-dom react-router-dom
@tanstack/react-query @tanstack/react-table
zustand
echarts echarts-for-react
react-hook-form zod @hookform/resolvers
lucide-react date-fns date-fns-tz
tailwindcss @tailwindcss/vite
vite @vitejs/plugin-react typescript
@playwright/test
```

### 环境变量

```env
NODE_ENV=development
DATABASE_URL=postgresql://comporalife:comporalife@localhost:5432/comporalife
REDIS_URL=redis://localhost:6379

JWT_SECRET=change-me-to-a-high-entropy-value
COOKIE_SECURE=false

APP_BASE_URL=http://localhost:3000
DEFAULT_CURRENCY=CNY

SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
MAIL_FROM=

SIMULATION_MAX_YEARS=100
SESSION_ACCESS_TTL=15m
SESSION_REFRESH_TTL=7d
```

---

## 十五、Docker 服务编排

```yaml
services:
  postgres:   # PostgreSQL 16，持久化卷，不映射宿主机端口
  redis:      # Redis 7，持久化卷，不映射宿主机端口
  api:        # Fastify，内部 4000
  nginx:      # 前端静态资源 + /api 反代，宿主机 3000
```

**端口规划**

| 服务 | 开发端口 | 生产访问 |
|------|---:|---|
| Nginx | 3000 | 唯一对外入口 |
| Fastify API | 4000 | 内部网络 |
| Vite 开发服务器 | 5173 | 仅开发 |
| PostgreSQL | 5432 | 不对公网暴露 |
| Redis | 6379 | 不对公网暴露 |

**约束**：数据库与 Redis 不暴露宿主机端口；启动顺序由健康检查控制；`api` 以非 root 用户运行；上传目录即使 Phase 1 未使用也不做静态映射。

---

## 十六、验证清单

### S1

- [ ] `docker compose up` 后四个服务健康
- [ ] `/api/system/health` 返回 200，`/ready` 在数据库就绪后返回 200
- [ ] Prisma 迁移成功，13 张表与索引齐备
- [ ] seed 创建超级管理员与分类模板
- [ ] 前端脚手架可访问，`/api` 代理生效

### S2

- [ ] 注册成功，自动创建设置与分类树
- [ ] 登录返回用户信息，Cookie 为 HttpOnly
- [ ] 刷新令牌轮换后旧令牌立即失效
- [ ] 未登录访问业务接口返回 401
- [ ] 改密后其他会话全部失效
- [ ] 忘记密码在开发环境可拿到重置链接，重置令牌仅可用一次
- [ ] 会话列表可撤销指定会话

### S3

- [ ] 六种账户类型均可创建，负债账户余额计入负债
- [ ] 有流水的账户删除被拒绝，可归档
- [ ] 余额 = 期初 + 分录，且响应带口径字段
- [ ] 对账记录保存差异且不自动调整余额
- [ ] 分类最多两级，收入/支出分栏正确
- [ ] 分类被引用时删除被拒绝
- [ ] 标签绑定与解绑正确

### S4

- [ ] 收入与支出生成两条平衡分录
- [ ] 转账生成两条真实腿且不计入收支
- [ ] 人为构造不平衡分录被 422 拒绝
- [ ] 调整交易后账户余额等于目标值
- [ ] 冲正后余额回退且记录仍可在列表中以「已冲正」查看
- [ ] 版本冲突返回 409
- [ ] 跨用户访问交易返回 404
- [ ] 批量分类不超过 500 条且原子生效

### S5

- [ ] 净资产 = 资产 − 负债，且口径字段完整
- [ ] 转账不出现在收入或支出中
- [ ] 缺失汇率时返回 422 并列出币种对
- [ ] 收入为 0 时储蓄率为 null
- [ ] 无数据月份标记为不完整
- [ ] 趋势采样粒度随区间自动切换
- [ ] 数据质量指标与真实数据一致

### S6

- [ ] 五个黄金用例通过（含换算方式断言）
- [ ] 相同输入重复计算结果完全一致
- [ ] 参数越界全部返回 422
- [ ] 场景保存、复制、删除、对比正常
- [ ] 对比视图最多 4 条曲线
- [ ] 模拟结果不写入任何交易或余额

### S7

- [ ] Playwright 主链路通过
- [ ] 移动端 375px 宽度无横向滚动
- [ ] 深色/浅色切换正常且持久化
- [ ] 所有图表有空状态与错误状态
- [ ] 全新环境 `docker compose up` 后可直接注册使用
- [ ] 日志中不出现密码、令牌与金额明细

---

## 十七、开发顺序建议

```
server/
├── src/
│   ├── config/              → S1
│   ├── plugins/             → S1
│   ├── lib/                 → S1（money / errors / api-utils 优先）
│   ├── routes/system.ts     → S1
│   ├── modules/auth/        → S2
│   ├── modules/profile/     → S2
│   ├── modules/settings/    → S2
│   ├── modules/accounts/    → S3
│   ├── modules/categories/  → S3
│   ├── modules/tags/        → S3
│   ├── modules/ledger/      → S4（transaction / entry / transfer 三个 service）
│   ├── modules/analytics/   → S5（cashflow / networth）
│   ├── modules/currencies/  → S5
│   └── modules/simulations/ → S6（compound.engine 先行，纯函数无依赖）
└── prisma/                  → S1 建全量模型，随阶段补 seed

frontend/
├── src/lib/                 → 与后端同步
├── src/components/ui/       → S1
├── src/components/layout/   → S1
├── src/pages/auth|profile   → S2
├── src/pages/accounts|categories → S3
├── src/pages/transactions   → S4
├── src/pages/dashboard      → S5
└── src/pages/compound       → S6
```

**推荐节奏**：每个阶段先写 `modules/` 的纯业务逻辑与单元测试，再接 `routes/`，最后做页面。复利内核可在 S1 完成后立刻开工，作为首个可独立验证的模块。

---

## 十八、Phase 1 交付标准

### 功能交付

1. 用户可注册、登录、维护资料与偏好、管理会话。
2. 用户可创建多类型账户，查看余额与余额历史，完成对账。
3. 用户可记录收入、支出、转账与余额调整，账本分录平衡可验证。
4. Dashboard 展示净资产、资产/负债构成、现金流与数据质量，且每项指标附口径。
5. 用户可进行复利与定投模拟，保存、复制与对比场景。
6. 手工汇率支持多币种账户折算到基准币种。

### 质量要求

1. 所有接口统一响应格式与错误码，列表统一分页结构。
2. 金额全程 Decimal，前后端均无浮点账务计算。
3. 跨用户访问一律 404，且集成测试覆盖。
4. 任何导致分录不平衡的写入被拒绝并回滚。
5. 复利结果可复现，相同参数两次计算完全一致。
6. 全部接口响应时间 < 300ms（个人数据量下）。
7. Docker Compose 一键启动即可完成注册到记账的完整流程。

### 非交付（Phase 2 起）

账单导入与去重、预算、完整收支分析、投资组合与收益、资产配置与再平衡、蒙特卡罗、财富目标、报告与数据管理、后台任务队列、管理后台、凭证附件、交易拆分、退款冲减、跨币种转账、账号注销与邮箱验证。

---

## 十九、与后续阶段的衔接

| 后续阶段 | 建议内容 | 对 Phase 1 的依赖 |
|---------|---------|------------------|
| Phase 2 账单导入 | CSV/XLSX 解析、字段映射、预览、去重、批次撤销 | 依赖 S4 账本与 S3 账户/分类；导入结果复用 `transactions` + `entries` |
| Phase 3 分析与预算 | 分类趋势、商户排行、预算执行、异常支出 | 依赖 S5 聚合层 |
| Phase 4 投资 | 组合、证券、成本基础、TWR/XIRR、再平衡 | 依赖 S3 的 `brokerage` 账户与 S4 账本 |
| Phase 5 风险模拟 | 蒙特卡罗、分片异步执行、任务进度 | 依赖 S6 参数模型与 `modelVersion` 机制。**注**：Phase 5 计划已改为进程内分片执行器，不使用 BullMQ 与 Worker Threads，理由见 `docs/plan-phase5.md` 第 5.1 节 |
| Phase 6 目标与报告 | 财富目标、财务独立、报表导出 | 依赖 S5 与投资结果 |
| Phase 7 数据管理与运维 | 备份恢复、导出、管理后台、审计扩展 | 依赖 S1 的基础设施与 `audit_logs` |

### 需补齐的设计文档

以下文档在《项目目录结构》中已列出但尚未编写，建议在对应阶段开工前完成：

| 文档 | 最晚需要时间 |
|------|-------------|
| 数据库设计（Prisma 定稿、索引、约束、迁移策略） | S1 开始前 |
| 账单导入与对账设计（格式、去重、转账匹配） | Phase 2 开始前 |
| 投资收益与复利计算规范（成本基础、TWR/XIRR 用例） | Phase 4 开始前 |
| 安全与隐私设计（加密、日志、保留策略） | Phase 2 开始前 |
| 开发计划任务（本文件之后的阶段拆分） | Phase 2 规划时 |
