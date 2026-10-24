# Phase 5 开发计划 — 风险模拟与异步任务

> **对应项目**：Comporalife（复利人生）Personal 开源个人版
> **上游计划**：`docs/plan-phase1.md`（S1–S7，v0.1.0）、`docs/plan-phase2.md`（P1–P8，v0.1.1）、`docs/plan-phase3.md`（A1–A7，v0.1.4）、`docs/plan-phase4.md`（B1–B7，v0.1.5）
> **技术栈**：沿用前四阶段：Fastify 5 + TypeScript + Prisma 6 + PostgreSQL 16 + Redis 7 + React 19 + Vite + Tailwind CSS 4 + ECharts 6
> **文档版本**：v5.0-plan
> **计划交付版本**：v0.1.6
> **范围决策**：蒙特卡罗风险模拟 + 异步任务运行与进度 + 组合参数反填 + 压力测试；不做财富目标、报表导出、数据管理与备份

---

## 一、Phase 5 目标

> **把「按 7% 算」变成「大概会落在哪、亏的概率有多大、最坏能有多坏」**

前四个阶段解决的都是**已发生的事实**：记对了账、导进了账单、看懂了支出、算清了持仓与收益。但用户真正规划未来时问的是另一类问题：

- 我有 20 万，每月投 5000，按 8% 收益、15% 波动，20 年后大概是什么区间？
- 同样的计划，有 30% 概率跑不到 300 万，这个概率我接受吗？
- 如果前三年先跌 40%，我的计划还撑得住吗？

复利引擎（Phase 1）只能回答「假设每年正好 7%」，这是一个**不存在的世界**。Phase 5 补上的正是这个缺口：用随机市场路径取代单一路径，用分布取代一个点，用概率取代一个确定值。

Phase 5 的核心不是再加一个计算器，而是四件事：

1. **结果诚实地表达不确定性**：输出的是区间与概率，不是一个「预计能赚 300 万」。任何一个点估计都必须同时给出分位数与样本量。
2. **算得动且不卡死**：单次模拟是千万级的浮点运算，必须异步执行、可看进度、可取消、不阻塞其他请求。
3. **完全可复现**：记录模型版本、完整参数快照与随机种子，一年后再打开这次运行，结果逐位一致。
4. **与真实收益严格分开**：模拟永远不写账本、不进净资产、不产生交易、不污染任何真实指标。

### 核心原则

| 原则 | 说明 |
|------|------|
| **模拟不入账** | 模拟结果只存于模拟表，**永不**写入 `transactions` / `transaction_entries` / 任何账户余额 |
| **种子决定一切** | 同一 `seed` + 同一参数快照 + 同一 `modelVersion` ⇒ 逐位一致的结果，无隐藏状态、无时钟参与 |
| **运行快照不可变** | 每次运行都冻结一份参数快照；之后修改方案不影响历史运行结果 |
| **区间优先于点值** | 响应必须含分位数；只返回均值的接口视为未完成 |
| **精度必须可见** | 同时返回样本量与均值的标准误，避免 5000 条与 20000 条路径看起来一样可信 |
| **假设必须可见** | 收益模型、波动率口径、再平衡频率、通胀与费用处理、提款规则全部随结果返回 |
| **异步任务不阻塞主线程** | 模拟计算分片让出事件循环，任何 HTTP 请求的等待时间不受模拟规模影响 |
| **作业状态单一权威** | 作业状态以 PostgreSQL 为唯一来源，不引入第二套 Redis 作业状态 |
| **失败可重入** | 进程重启后中断的运行自动回到队列并按固定种子重算，结果不变 |
| **不改既有计算口径** | Phase 1 复利引擎、Phase 4 收益引擎保持原样，新代码只读复用其约定 |
| **越权一律 404** | 与前三阶段一致 |

---

## 二、Phase 5 开发阶段划分

```
C1 异步任务基础设施 ──┬──► C3 方案与运行接口 ──┬──► C6 前端风险模拟页 ──► C7 交付
                      │                        │
C2 模拟内核 ──────────┘                        │
                                               │
C4 结果聚合与压力测试 ─────────────────────────┤
                                               │
C5 组合衔接与建议参数 ─────────────────────────┘
```

| 阶段 | 内容 | 涉及模块 | 预期工时 |
|------|------|----------|---------|
| **C1 异步任务基础设施** | 2 张新表、作业状态机、分片执行器、进度、取消、超时、中断恢复、并发上限 | prisma + jobs | 5-6 天 |
| **C2 蒙特卡罗内核** | 纯函数引擎：PRNG、正态抽样、Cholesky 相关性、对数正态月度路径、复利与提款迭代 | simulations/monte-carlo | 6-7 天 |
| **C3 方案与运行接口** | 方案 CRUD 与复制、运行创建、状态轮询、结果与路径、取消、对比、同步预览 | simulations | 4-5 天 |
| **C4 结果聚合与压力测试** | 分位数、亏损/达标/破产概率、最大回撤、年度扇形带、直方图、标准误、压力情景 | simulations/analytics | 4-5 天 |
| **C5 组合衔接** | 从真实组合反填权重、按价格历史估计收益与波动、样本不足时的置信度标记 | portfolios + simulations | 3-4 天 |
| **C6 前端风险模拟页** | 方案管理、参数面板与相关性矩阵、运行进度与取消、扇形图、分布图、回撤图、对比视图 | 前端页面 | 5-6 天 |
| **C7 i18n、测试与交付** | 双语资源、单元与集成测试、演示数据、文档更新 | 全项目 | 4-5 天 |

> **合计约 31-38 天（单人开发）**。相关性矩阵校验、分片执行的中断恢复、以及「零波动必须等于复利引擎结果」这条交叉验证是主要不确定性，工时已含边界调试。

### 阶段依赖说明

- **C2 是纯函数，可以先于 C1 完成并全部用单元测试覆盖**。C1 未就绪时用测试夹具直接调用引擎，不阻塞。
- C1 与 C2 可并行；C3 必须同时依赖两者（要有地方跑、有东西跑）。
- C4 依赖 C2 输出的原始统计量，可在 C2 冻结接口后并行开发。
- C5 只读 Phase 4 的持仓与价格表，与 C4 完全并行，不做任何写入。
- C6 依赖 C3 的状态轮询与 C4 的结果结构；建议先把「运行中/完成/失败」三种状态的骨架跑通，再接图表。
- C7 的回归测试必须在 C1 之后才能验证中断恢复。

---

## 三、Phase 5 范围界定

### 交付范围

| 模块 | 交付内容 |
|------|---------|
| 模拟方案 | 创建、修改、复制、删除、列表；参数快照与模型版本记录 |
| 资产假设 | 多资产权重、预期年化收益、年化波动率、相关矩阵 |
| 现金流假设 | 初始本金、定期追加、投入时点、提款起止、通胀、费用 |
| 模拟运行 | 异步执行、进度、取消、超时、失败重试、运行历史 |
| 统计结果 | 终值分位数、均值与标准误、亏损概率、达标概率、破产概率 |
| 回撤分析 | 最大回撤分布、回撤分位数、最差路径摘要 |
| 可视化数据 | 年度财富扇形带、终值直方图、抽样路径（按需再生成） |
| 压力测试 | 确定性极端情景（崩盘、滞胀、失去的十年），与随机结果显式区分 |
| 组合衔接 | 从真实组合反填资产权重，按历史价格估计收益与波动，标注样本与置信度 |
| 对比 | 2–4 个运行或方案并排比较关键指标 |
| 运维 | 能力声明、审计事件、并发与队列上限、运行保留策略、双语资源 |

### 明确不交付（后续阶段）

| 能力 | 原因 |
|------|------|
| 财富目标与财务自由规划 | Phase 6 范围；本阶段只回答「能否达到某个金额」的概率，不建立目标实体。Phase 6 已实现目标实体与预测，概率通过「目标金额 + 年限 + 币种」匹配本阶段运行取得 |
| 报表导出（PDF/CSV/Excel） | 报表导出（CSV/XLSX）已由 Phase 6 实现，含 BOM、公式注入转义与中文文件名；PDF 仍未实现，见 `docs/plan-phase6.md` |
| 数据备份、恢复与整体导出 | Phase 7 数据管理范围 |
| 管理后台与任务监控面板 | Phase 7；本阶段只提供用户自己的运行历史 |
| 独立 worker 进程 / 多实例分布式调度 | 个人自部署为单节点单进程；多实例需要租约续期与任务重新分配，另行设计 |
| 多资产跳跃扩散、Student-t、GARCH、状态切换等收益模型 | 本阶段只实现对数正态；新增模型须先补模型规范与基准用例，且必须升 `modelVersion` |
| 历史数据自动估计（长周期收益率/波动率回填） | 手工价格历史通常不足两年，自动估计必然给出误导性参数；本阶段只做「有足够样本才给建议」 |
| 期权、杠杆、融资融券、做空 | 与 Phase 4 一致，需要独立的保证金与强平语义 |
| 实时行情接入 | 独立小阶段，不改变本阶段统计口径 |
| 蒙特卡罗结果与真实收益的混合展示 | 二者必须分开呈现。Phase 6 的模拟报表与导出仍分区块呈现，未做同图对比 |

> **口径说明**：推迟项属于《项目功能全面分析》中个人版的完整模拟能力，属于**产品范围**而非**本阶段范围**。Phase 5 不修改功能文档。

---

## 四、数据模型设计

### 4.1 模型总览（新增 2 张表）

```
monte_carlo_scenarios   模拟方案（参数、资产假设、相关矩阵）
monte_carlo_runs        模拟运行（状态、参数快照、种子、结果）
```

不新增第三张「路径表」：全量路径（默认 5000 条 × 30 年 × 12 月）体量在千万级，不适合落库；结果只存聚合量与少量样本路径，其余路径凭种子按需再生成。

并对已有表做**增量扩展**（不破坏前四个阶段数据）：

```
users                   新增关系：monteCarloScenarios / monteCarloRuns
```

### 4.2 新增枚举

```prisma
enum RunStatus {
  queued       // 已入队，等待执行
  running      // 正在计算
  succeeded    // 成功完成
  failed       // 计算失败（含超时与中断）
  cancelled    // 用户取消
}

enum RunStage {
  preparing    // 校验与参数展开
  simulating   // 路径模拟
  aggregating  // 统计聚合
  finalizing   // 结果落库
}

enum ReturnModel {
  lognormal    // 对数正态月度收益（本阶段唯一实现）
}

enum RebalanceFrequency {
  none
  monthly
  quarterly
  annual
}
```

`RunStage` 与 `RunStatus` 分离：`stage` 描述「正在做什么」，`status` 描述「是否结束」，两者不互相推导，避免出现「status 是 running 但 stage 是 finalizing」这种需要猜的状态。

### 4.3 模型定义

#### monte_carlo_scenarios

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | uuid | 主键 |
| `userId` | uuid | 归属用户，级联删除 |
| `name` | varchar(80) | 同一用户内唯一 |
| `currency` | char(3) | 展示币种，只用于格式化，不做折算 |
| `years` | int | 模拟年限，1–50 |
| `pathCount` | int | 路径数，100–20000 |
| `rebalance` | RebalanceFrequency | 默认 `annual` |
| `returnModel` | ReturnModel | 默认 `lognormal` |
| `assets` | Json | `[{ key, label, weight, expectedAnnualReturn, annualVolatility }]` |
| `correlation` | Json | n × n 数值矩阵，与 `assets` 顺序对应 |
| `settings` | Json | 初始本金、定投、提款、通胀、费用、目标金额 |
| `modelVersion` | varchar(32) | 默认 `montecarlo-v1` |
| `note` | text? | |
| `createdAt` / `updatedAt` | timestamptz | |

唯一约束：`[userId, name]`；索引：`[userId, updatedAt(sort: Desc)]`。

**为什么用 Json 而不是逐列**：资产数量与相关矩阵维度由用户决定，逐列建模会退化成「三张表 + 动态列」；标量参数（`years`、`pathCount`）仍保留为列，便于列表页排序与容量校验，同时避免全表解析 Json。

> Json 字段的写入前必须经 Zod 校验并归一化（权重和为 1、矩阵对称且正定、维度与资产数一致），绝不允许把原始请求体直接落库。

#### monte_carlo_runs

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | uuid | 主键 |
| `userId` | uuid | 冗余归属，便于列表与越权过滤 |
| `scenarioId` | uuid | 级联删除；方案删除时历史运行一并删除 |
| `scenarioName` | varchar(80) | 快照，方案改名或删除后仍能识别 |
| `status` | RunStatus | 默认 `queued` |
| `stage` | RunStage? | 结束态置空 |
| `progress` | decimal(5,4) | 0.0000–1.0000，单调不减 |
| `attempts` | int | 已尝试次数，默认 0 |
| `assumptions` | Json | **完整不可变参数快照**（含资产、相关性、现金流假设） |
| `seed` | int | 随机种子，0–2147483647 |
| `modelVersion` | varchar(32) | 与方案创建时一致 |
| `pathCount` | int | 快照值，避免方案被改后统计口径漂移 |
| `years` | int | 快照值 |
| `cancelRequestedAt` | timestamptz? | 取消请求时间 |
| `heartbeatAt` | timestamptz? | 执行心跳，用于中断检测 |
| `startedAt` / `finishedAt` | timestamptz? | |
| `durationMs` | int? | 实际计算耗时 |
| `failureCode` | varchar(48)? | `MC_TIMEOUT` / `MC_INTERRUPTED` / `MC_INTERNAL` |
| `failureMessage` | varchar(300)? | 面向用户的短说明，不含堆栈 |
| `result` | Json? | 聚合结果（见第九节结构） |
| `samplePaths` | Json? | 最多 20 条年度采样路径 |
| `createdAt` | timestamptz | |

索引：`[userId, createdAt(sort: Desc)]`、`[scenarioId, createdAt(sort: Desc)]`、`[status, createdAt]`（执行器扫描队列）。

> `assumptions` 是运行结果可复现的根基。即便用户之后改了方案，历史运行仍能原样重算与解释。

### 4.4 数值精度

| 位置 | 类型 | 理由 |
|------|------|------|
| `progress` | decimal(5,4) | 0.0000–1.0000，4 位足以驱动进度条 |
| 模拟内部计算 | `number`（float64） | 千万级迭代，`Decimal` 会慢一到两个数量级；详见第五节决策 7 |
| 输入与输出金额 | `Decimal` 校验 / 6 位小数输出 | 与账本、复利引擎口径一致 |
| 比率与概率 | 6 位小数输出 | 与 Phase 3/4 的比率精度一致 |

**边界规则**：进入引擎前所有金额与比率都经 `Decimal` 解析并校验范围；引擎内部转 `number`；输出在序列化边界统一 `roundMoney` / 6 位小数。**模拟结果永远不会被写进账本**，因此不承担账务精度义务。

### 4.5 迁移策略

- 纯增量：2 个新表 + 4 个新枚举（`RunStatus`、`RunStage`、`ReturnModel`、`RebalanceFrequency`）。
- 不改任何既有表结构，不加列、不改枚举值，前四阶段数据与测试全部不受影响。
- 存量用户无模拟方案，Dashboard、净资产、分析、预算、投资页行为完全不变。

---

## 五、关键设计决策

| # | 决策点 | 结论 | 理由 |
|---|--------|------|------|
| 1 | 模拟结果写不写账本 | 永不写入 | 模拟是假设，写账本会污染净资产与收支；任何「模拟 vs 实际」混淆都是产品事故 |
| 2 | 是否引入 BullMQ | 不引入 | 个人自部署是单节点单进程；引入 Redis 队列后会出现「Redis 里的作业状态」与「数据库里的运行状态」两套权威，取消与进度必须双向同步，维护成本高于收益 |
| 3 | 是否用 Worker Threads | 不用，改为分片协作执行 | 见 5.1，构建与调试成本是真实阻力；分片已能满足「不阻塞请求」的目标 |
| 4 | 作业状态存哪 | PostgreSQL 单表 | 与业务数据同库同事务，创建运行与扣减配额天然原子；重启后状态不会丢 |
| 5 | 取消如何实现 | 数据库标记 + 分片间轮询 | 取消不需要跨线程通信，一次 `UPDATE` 即可，且取消是幂等的 |
| 6 | 进程重启后残留 running | 心跳超时后回到 `queued` 重算，最多重试一次 | 种子固定 ⇒ 重算结果与首次一致；不重试则用户看到永久卡住的运行 |
| 7 | 内部用 float64 还是 Decimal | float64 | 统计模拟是估计值，不承担分厘账务义务；`Decimal` 在千万级迭代下不可接受。输出边界统一舍入，输入仍走 `Decimal` 校验 |
| 8 | 收益模型 | 对数正态，月度离散 | 单一实现、可解释、与零波动时的复利引擎严格一致；跳跃扩散等留给后继模型版本 |
| 9 | 漂移如何换算 | `mu_m = ln(1+R)/12 − σ_m²/2` | 保证「预期年化收益」是年毛收益的算术期望，避免波动把均值悄悄抬高（几何/算术口径混淆是此类工具最常见的错误） |
| 10 | 相关性 | Cholesky 分解；不半正定直接 422 | 静默「修正」用户的矩阵会得到无法解释的结果；宁可拒绝 |
| 11 | 迭代顺序 | 与复利引擎一致：收益 → 费用 → 投入 | 两套引擎在零波动下必须给出同一个数，否则无法交叉验证 |
| 12 | 再平衡 | 频率显式记录，`none` 表示各资产独立增长 | 再平衡频率显著影响结果，隐藏该假设等于隐藏结论 |
| 13 | 最大回撤怎么算 | 基于增长指数，而非含投入的账户值 | 持续定投会掩盖回撤，用账户值算会系统性低估风险 |
| 14 | 分位数算法 | 复用 `lib/percentile.ts` 线性插值 | 与分析模块同一口径，避免同一用户在不同页面看到不同 P90 |
| 15 | 是否存全量路径 | 不存；只存最多 20 条年度采样路径 | 千万级数值落库会让表迅速膨胀；种子固定后可随时再生成任意路径 |
| 16 | 路径再生成的可行性 | 每条路径用 `(seed, pathIndex)` 独立派生随机流 | 只需重算指定索引，无需重跑全量；这是「不存全量」的前提 |
| 17 | 并发与队列 | 并发 2、队列 10，超出 429 | 个人部署的 CPU 有限；无限排队会让用户以为系统卡死 |
| 18 | 运行保留 | 每个方案保留最新 30 次运行，其余删除 | 防止长期使用后表无界增长；删除只针对已结束的运行 |
| 19 | 压力测试定位 | 确定性路径，独立展示，不混入分位数 | 极端情景不是概率事件；混进去会让「P5」变成无意义数字 |
| 20 | 组合反填的边界 | 只做建议，样本不足显式标注 | 短历史估计出的年化与波动极不稳定，必须让用户看见这一点 |
| 21 | 同步预览 | 只允许 ≤ 500 条路径，超时 3 秒 | 编辑参数时需要即时反馈；超过阈值必须走异步，否则请求超时 |
| 22 | 越权 | 一律 404 | 与前三阶段一致 |

### 5.1 架构决策：为什么不用 BullMQ 与 Worker Threads

前四份计划的衔接章节都写着「Phase 5 蒙特卡罗、Worker Threads、BullMQ」。本节明确改变这一结论，理由是实施层面的：

**BullMQ 的问题**

- 作业状态会被拆成两份：Redis 里有一份，`monte_carlo_runs` 里还需一份供用户查询历史。取消、进度、重试要么以 Redis 为准（数据库读到滞后状态），要么双向同步（必然出现不一致窗口）。
- 队列的持久化与清理是第二套运维对象，个人自部署的部署文档会因此变长。
- 本阶段只需要「同一进程内、有限并发、可取消、可恢复」，PostgreSQL 的 `UPDATE ... WHERE status = 'queued' RETURNING` 已能原子领取作业，不需要消费者组。

**Worker Threads 的问题**

- 开发时用 `tsx watch` 加载 TS，worker 线程需要单独注入 loader，构建产物路径又与开发路径不同，是持续性的调试成本。
- 若把量级不合适地调大，跨线程传输大数组的序列化开销会抵消并行收益。
- 真正的阻塞风险来自「一次跑完 1000 万次迭代」；把它切成 10–20 ms 一片，事件循环的延迟就已经回到正常范围。

**落地方案**

```
POST /runs
  └─ INSERT monte_carlo_runs(status = queued)
  └─ executor.kick()
        └─ claimOne()  : UPDATE ... SET status='running' WHERE status='queued' RETURNING  ← 原子领取
        └─ 分片循环
             ├─ 每片处理 N 条路径（约 10–20 ms）
             ├─ 片间 setImmediate 让出事件循环
             ├─ 每 400 ms 写一次 progress 与 heartbeat
             └─ 每 500 ms 读一次 cancel_requested_at
        └─ 聚合 → 落库 → 保留策略
```

- 执行器对外只暴露 `schedule(app)` / `kick()` / `drain()` 三个方法，**内部实现可替换**。若未来确需多实例或更重的任务，替换的是 `claimOne` 与执行循环，接口与表结构不变。
- 单片路径数按「时间预算」而非固定条数决定：每片执行后检查 `performance.now()`，超过 `MONTE_CARLO_CHUNK_MS`（默认 15 ms）即让出，保证小机器上也不会长时间占用。
- 取消与超时都在片间检查，因此最坏响应延迟约等于一~两片的耗时。

> 这一决策需要写进 README 与目录结构说明，并在 Phase 1–4 计划中「Phase 5 用 BullMQ / Worker Threads」的表述处补一句「已被 Phase 5 计划取代」，避免文档自相矛盾。

---

## 六、蒙特卡罗模型与统计口径

### 6.1 输入参数

| 参数 | 约束 | 默认 |
|------|------|------|
| `years` | 1–50，整数 | 20 |
| `pathCount` | 100–20000，整数 | 5000 |
| `seed` | 0–2147483647，整数 | 未提供时随机生成并**回写响应** |
| `initialValue` | ≥ 0 | 0 |
| `contributionAmount` | ≥ 0 | 0 |
| `contributionFrequency` | none / monthly / annual | monthly |
| `contributionTiming` | begin / end | end |
| `withdrawalAmount` | ≥ 0 | 0 |
| `withdrawalFrequency` | none / monthly / annual | none |
| `withdrawalStartYear` | 1–`years`，整数 | 1 |
| `inflationRate` | −0.5–0.5 | 0.025 |
| `feeRate` | 0–0.05 | 0 |
| `targetAmount` | ≥ 0 或空 | 空 |
| `rebalance` | none / monthly / quarterly / annual | annual |
| `assets` | 1–10 项；每组权重 ≥ 0，权重合计 = 1 | 单资产 100% |
| `assets[].expectedAnnualReturn` | −0.99–1 | 0.07 |
| `assets[].annualVolatility` | 0–2 | 0.15 |
| `correlation` | n × n；对角为 1；对称；\|ρ\| ≤ 1；半正定 | 单位矩阵 |

**校验顺序**（顺序本身是规范，错误码依赖它）：

```
1. 标量范围（years / pathCount / 比率）
2. 资产数量与权重（合计与 1 的偏差 > 1e-6 → MC_WEIGHTS_INVALID）
3. 相关矩阵维度、对称性、对角、取值范围（→ MC_CORRELATION_INVALID）
4. Cholesky 分解（失败同样 → MC_CORRELATION_INVALID）
5. 现金流一致性（本金、定投、提款不能同时全为 0）
6. 提款起止与年限不矛盾
```

### 6.2 月度收益生成

对每个资产 `i` 与每月 `m`：

```
σ_m,i = σ_annual,i / √12
μ_m,i = ln(1 + R_annual,i) / 12 − σ_m,i² / 2
z_m   = 相关标准正态向量（见 6.3）
每月毛收益： (1 + r_m,i) = exp(μ_m,i + σ_m,i · z_m,i)
```

**为什么减去 σ²/2**：`E[exp(X)] = exp(E[X] + σ²/2)`。若不减去，年化漂移会被波动系统性抬高，用户会看到一个「比输入更高」的预期收益，这是此类工具最常被诟病的地方。减去后，**零波动时 `r_m` 恰好等于复利引擎的月有效收益 `(1+R)^(1/12) − 1`**，两套引擎可以严格交叉验证。

### 6.3 相关性与 Cholesky

```
给定相关矩阵 Σ，求下三角 L 使 L · Lᵀ = Σ
每月生成 n 个独立标准正态 u = [u₁ … uₙ]
z = L · u
```

- 分解在运行开始时做一次，结果随快照一起送入引擎，不重复计算。
- 任一主元 ≤ 0（非正定）→ `MC_CORRELATION_INVALID`，`details.reason = 'not_positive_definite'`。
- 相关矩阵不对称（`|ρ_ij − ρ_ji| > 1e-9`）→ 422，不做静默对称化。
- `n = 1` 时不调用分解，直接取标准正态。

### 6.4 组合迭代

每个月的顺序与复利引擎完全一致：

```
期末投入 end：
  各资产价值 vᵢ = vᵢ · (1 + r_m,i)
  组合总值 V = Σvᵢ；费用 V ← V · (1 − g)
  若需再平衡：按目标权重重分配
  投入 / 提款：V ← V + contribution 或 V ← max(0, V − withdrawal)
  再按目标权重回填各资产

期初投入 begin：
  投入 / 提款（同上）
  各资产价值增长；费用；再平衡
```

- `g = 1 − (1 − feeRate)^(1/12)`，与复利引擎同一换算。
- 再平衡按 `rebalance` 频率执行：`monthly` 每月末，`quarterly` 每 3 个月末，`annual` 每年末，`none` 不做。再平衡只改变资产内部构成，不改变总值。
- 提款从 `withdrawalStartYear` 的对应月份开始，频率与金额固定（不支持逐年递增，见第三节）。
- 提款使总值降到 0 时，该路径记 `depletedMonth`，后续月份保持为 0，不再接受投入（避免「先破产再复活」的失真结果）。
- 累计投入 `totalContributed` 是该路径实际投入总额（破产后不再计入后续投入）。

### 6.5 统计口径

| 指标 | 定义 | 注意事项 |
|------|------|----------|
| 终值分位数 | 各路径期末组合总值排序后的 P5/P10/P25/P50/P75/P90/P95 | 名义值 |
| 实际终值分位数 | 终值 ÷ (1 + 通胀)^years 后的同一组分位数 | 同一组路径逐条折算，不是「先取中位数再折算」 |
| 累计投入 | 各路径实际投入金额（含初始本金） | 定投固定时所有路径相同，破产后不同 |
| 亏损概率 | `P(名义终值 < 累计投入)` | 名义口径 |
| 实际亏损概率 | `P(实际终值 < 实际累计投入)` | 通胀口径 |
| 达标概率 | `P(终值 ≥ targetAmount)`；未设目标时为 `null` | 不返回 0，避免「0% 达标」的假信号 |
| 破产概率 | `P(路径在期末前触及 0)` | 无提款时通常为 0 |
| 均值与标准误 | `mean`、`sd`、`se = sd / √pathCount` | 必须同时给出，用于判断样本是否够 |
| 最大回撤 | 基于增长指数 `I_m = Π(1 + 组合月收益)` 的峰值到谷底跌幅 | 不使用含投入的账户值（见决策 13） |
| 回撤分位数 | 各路径最大回撤的 P50/P90/P99 与均值 | |
| 年度扇形带 | 每年末的 P10/P25/P50/P75/P90 | 前端画成多层带 |
| 直方图 | 终值等宽 20 桶，附桶边界 | 桶边界随运行确定并落库，保证历史可复现 |

**分位数算法**：直接调用 `lib/percentile.ts` 的线性插值实现（`index = (n−1)·p`），与 Phase 3 的统计口径一致。

### 6.6 精度与样本量说明

- 默认 5000 条路径时，均值标准误约为终值标准差的 1/70；P5 与 P95 的抽样波动明显大于中位数。
- 界面在结果页固定展示「样本量 + 标准误」，并在样本量 < 2000 时提示「分位数波动较大」。
- 同一 `seed` 加 `pathCount` 的两次运行结果完全一致；改变 `pathCount` 属于**不同样本**，不得横向比较分位数的细小差异。

### 6.7 假设可见性

结果的 `assumptions` 字段必须原样回显，至少包括：

```
returnModel / modelVersion / seed / pathCount / years / rebalance
assets[]（权重、预期收益、波动率）
correlation 矩阵
initialValue / 定投规则 / 提款规则 / inflationRate / feeRate / targetAmount
```

另附 `disclaimers: string[]`（来自语言文件，由前端渲染），固定包含：

1. 收益模型为对数正态，历史均值与正态分布不能覆盖尾部风险。
2. 结果是概率分布，不是收益承诺。
3. 未计入税费与个人实际交易成本（除显式填写的费率）。
4. 抽样存在误差，样本量越大越稳定。

---

## 七、随机数与分布规范（`modules/simulations/monte-carlo/random.ts`）

### 7.1 PRNG

- 算法：**xoshiro128\*\***（32 位整数运算），128 位状态。
- 播种：`splitmix64(seed)` 生成初始状态；`seed` 来自运行记录。
- 不引入第三方随机库，不使用 `Math.random()`（不可播种、不可复现）。
- 非密码学用途，不得用于生成任何密钥、令牌或安全相关随机量。

### 7.2 路径级独立性

每条路径的随机流由 `(seed, pathIndex)` 派生：

```
pathSeed = splitmix32(seed ^ (pathIndex * 0x9E3779B1))
```

- 每条路径拥有独立状态，路径之间互不依赖 ⇒ 可只重算第 k 条路径。
- 同一路径的生成顺序固定（月 → 资产 → 正态），任何顺序调整都必须升 `modelVersion`。

### 7.3 正态抽样

- Box–Muller，每次消耗两个均匀数生成一对正态值，**不使用跨调用缓存**（缓存会让路径之间产生隐式依赖，破坏可单独重算的性质）。
- 均匀数取自 `(0, 1]` 的开区间，避免 `ln(0)`。

### 7.4 确定性边界（必须写进文档）

- 同一平台、同一 Node 主版本、同一 `modelVersion` 下结果逐位一致。
- `Math.exp` / `Math.log` 的末位在不同 V8 版本或平台上可能不同，因此**不承诺跨运行时逐位一致**。
- 运行结果落库后不再重算展示，历史结果永远不变；重算只发生在中断恢复且结果尚未落库时。

---

## 八、异步任务执行规范（`modules/jobs/`）

### 8.1 状态机

```
queued ──claim──► running ──完成──► succeeded
  ▲                  │
  │                  ├──用户取消──► cancelled
  │                  ├──超时──────► failed（MC_TIMEOUT）
  │                  ├──异常──────► failed（MC_INTERNAL）
  └──心跳超时且 attempts < 2────── failed（MC_INTERRUPTED）→ 回到 queued
```

- `attempts` 在每次 `claim` 时 +1。
- 中断恢复只发生一次：`attempts >= 2` 时直接置 `failed`，避免「坏参数反复烧 CPU」。
- `cancelled` / `failed` 的运行磁盘上不保留 `result`，`samplePaths` 为 `null`。

### 8.2 领取（claim）

```sql
UPDATE monte_carlo_runs
   SET status = 'running', stage = 'preparing', attempts = attempts + 1,
       started_at = now(), heartbeat_at = now(), progress = 0
 WHERE id = (
   SELECT id FROM monte_carlo_runs
    WHERE status = 'queued'
    ORDER BY created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
 )
 RETURNING *;
```

- `FOR UPDATE SKIP LOCKED` 保证同进程多执行槽之间不重复领取；即便将来出现第二个进程也不会双跑。
- 队列长度在 `POST /runs` 时先按 `status IN ('queued','running')` 计数，超过上限返回 429。

### 8.3 进度与心跳

- 进度 = `已处理路径数 / 总路径数`，映射到 `preparing 0–0.05`、`simulating 0.05–0.85`、`aggregating 0.85–0.97`、`finalizing 0.97–1`。
- 写入节流：最多每 `MONTE_CARLO_PROGRESS_INTERVAL_MS`（默认 400 ms）一次，且 `progress` 单调不减（用 `GREATEST(progress, $1)` 或应用层保证）。
- 心跳与进度同批写入；心跳超过 `MONTE_CARLO_HEARTBEAT_TIMEOUT_SECONDS`（默认 30 秒）未更新视为中断。

### 8.4 取消

- `POST /runs/:runId/cancel`：`queued` 直接置 `cancelled`；`running` 写 `cancel_requested_at`，返回 202 与当前状态。
- 执行器每 500 ms 读一次未结束运行的 `cancel_requested_at`，命中即停止并置 `cancelled`。
- 对已结束的运行取消 → `MC_RUN_ALREADY_FINISHED` 409。
- 取消幂等：重复取消返回同一结果，不报错。

### 8.5 超时

- 总时限 `MONTE_CARLO_TIMEOUT_SECONDS`（默认 120 秒），从 `started_at` 起算。
- 超时置 `failed` + `failureCode = 'MC_TIMEOUT'`，并清理半成品结果。
- 估算：5000 路径 × 20 年 × 2 资产约 240 万步，在现代 CPU 上远低于 5 秒；超时主要用于兜住异常参数或极端负载。

### 8.6 启动恢复

`src/index.ts` 在 `listen` 之后调用 `resumeInterruptedRuns()`：

```
1. 找出 status = 'running' 且 heartbeat_at 早于阈值（或为 NULL）的运行
2. attempts < 2 → status = 'queued'（保留 attempts，保留种子）
3. attempts >= 2 → status = 'failed', failureCode = 'MC_INTERRUPTED'
4. 调用 executor.kick()
```

与账单清理任务的注册方式一致（`onClose` 时停止执行器），不引入新的生命周期机制。

### 8.7 保留策略

运行结束（任何终态）后，按 `scenarioId` 保留最新 `MONTE_CARLO_RUN_RETENTION`（默认 30）条，其余删除：

- 只删除终态运行，绝不删除 `queued` / `running`。
- 删除在同一事务内完成，避免删到查询中间态。
- 被删除的运行在列表页自然消失，不返回 410。

### 8.8 同步预览通道

`POST /api/simulations/monte-carlo/calculate` 在同一请求内执行，**不走队列**：

- `pathCount` 上限 500（`MC_PREVIEW_PATH_LIMIT`），总时限 3 秒。
- 只返回终值分位数与亏损概率，不返回扇形带、直方图与样本路径。
- 超限返回 `MC_PREVIEW_LIMIT_EXCEEDED` 422，提示改为「运行模拟」。
- 目的：参数面板调整后即时给出方向性反馈，而不是每次都进队列。

---

## 九、C2 — 模拟内核（`modules/simulations/monte-carlo/monte-carlo.engine.ts`）

### 9.1 定位

纯函数模块：输入已校验并归一化的参数、种子与预分解的 Cholesky 下三角矩阵，输出原始统计量。**不访问数据库、不读时钟、不做进度上报**，便于单元测试与基准对照。

进度与取消通过**回调**注入，引擎本身不感知 HTTP 与数据库：

```ts
interface EngineHooks {
  onChunk?: (processedPaths: number) => void;
  shouldCancel?: () => boolean;
}

export function simulate(
  input: MonteCarloInput,
  hooks?: EngineHooks,
): { ok: true; result: MonteCarloResult } | { ok: false; cancelled: true };
```

### 9.2 输入

```ts
interface MonteCarloInput {
  years: number;
  pathCount: number;
  seed: number;
  returnModel: 'lognormal';
  rebalance: 'none' | 'monthly' | 'quarterly' | 'annual';

  assets: Array<{
    key: string;
    label: string;
    weight: number;              // 合计 1
    expectedAnnualReturn: number;
    annualVolatility: number;
  }>;
  cholesky: number[][];          // 下三角，n × n

  initialValue: number;
  contribution: { amount: number; frequency: 'none' | 'monthly' | 'annual'; timing: 'begin' | 'end' };
  withdrawal: { amount: number; frequency: 'none' | 'monthly' | 'annual'; startYear: number };
  inflationRate: number;
  feeRate: number;
  targetAmount: number | null;
}
```

### 9.3 输出

```ts
interface MonteCarloResult {
  // 终值
  terminal: {
    nominal: QuantileSet;         // p5 p10 p25 p50 p75 p90 p95 mean sd
    real: QuantileSet;
  };
  contributed: { nominal: QuantileSet; real: QuantileSet };  // 定投固定时各分位数相同
  standardError: number;          // 名义终值均值的标准误

  probabilities: {
    loss: number;                 // 名义亏损概率
    realLoss: number;
    target: number | null;
    ruin: number;
  };

  drawdown: { p50: number; p90: number; p99: number; mean: number };

  yearlyBands: Array<{
    year: number;
    p10: number; p25: number; p50: number; p75: number; p90: number;
  }>;

  histogram: { min: number; max: number; bins: number[] };

  samplePaths: Array<{ index: number; values: number[] }>;  // 年度分辨率，最多 20 条
}
```

- `QuantileSet` 各项均为 `number`，序列化时统一保留 6 位小数。
- `samplePaths.index` 是路径索引，前端可据此请求完整月频路径。

### 9.4 内存与分片

- 每条路径只保留「月度组合总值 + 增长指数」两个滚动量，年度末落一个采样点；**不做路径级全量缓存**。
- 终值、累计投入、最大回撤各用一个长度 `pathCount` 的 `Float64Array` 暂存，聚合后释放。
- 分片由调用方（执行器）按时间预算切分：引擎暴露「处理 pathIndex 区间」的能力，或接受 `chunkSize` 参数并在片末调用 `onChunk`。

> 不把分片逻辑写死在引擎里，是为了让单元测试能一次跑完并在同一路径上做确定性断言。

### 9.5 交叉验证不变式（必须写成测试）

| 不变式 | 含义 |
|--------|------|
| **零波动等价** | 所有资产 `annualVolatility = 0`、单资产、`rebalance = none` 时，`terminal.nominal.p50` 必须等于复利引擎 `simulate()` 的 `finalNominalValue`（误差 ≤ 1e-6） |
| **同种子可复现** | 相同输入两次调用，输出逐字段相等 |
| **路径独立性** | 只算第 k 条路径与算全量后取第 k 条，年终值相同 |
| **概率边界** | `loss`、`realLoss`、`target`、`ruin` 均 ∈ [0, 1]；未设目标时 `target === null` |
| **分位数单调** | `p5 ≤ p10 ≤ p25 ≤ p50 ≤ p75 ≤ p90 ≤ p95` |
| **回撤非负** | 所有回撤 ∈ [0, 1] |
| **无提款时破产为 0** | `withdrawal.frequency = 'none'` 时 `ruin === 0` |

---

## 十、C1 — 异步任务基础设施

### 10.1 文件布局

```
server/src/modules/jobs/
├── job.types.ts          作业状态与阶段枚举、执行器接口
├── job.repository.ts     领取、心跳、进度、取消、结束、保留策略
├── job.executor.ts       分片循环、并发槽、超时、启动恢复
└── job.errors.ts         作业相关错误工厂（复用 lib/errors）
```

`job.executor.ts` 不感知蒙特卡罗：它接受一个 `JobHandler`，由 `simulations` 注册。这样 Phase 7 若需要引入导出任务或备份任务，只加 handler，不改执行器。

### 10.2 执行器接口

```ts
export interface JobHandler<TPayload, TResult> {
  kind: string;
  load(runId: string): Promise<TPayload | null>;
  run(payload: TPayload, hooks: JobHooks): Promise<TResult>;
  persist(runId: string, result: TResult): Promise<void>;
}

export interface JobHooks {
  setStage(stage: RunStage): Promise<void>;
  reportProgress(value: number, processed: number): Promise<void>;
  isCancelRequested(): Promise<boolean>;
  isExpired(): boolean;
}
```

- `load` 返回 `null` 表示运行已被删除，直接结束本次执行。
- `reportProgress` 内部做节流，handler 可以每片都调用。
- `run` 抛异常 → `failed` + `MC_INTERNAL`，堆栈只进日志，`failureMessage` 写短文案。

### 10.3 并发控制

- 执行槽数量 = `MONTE_CARLO_MAX_CONCURRENT_RUNS`（默认 2）。
- 槽位空出时立即 `kick()`，按 `created_at` 升序领取，保证先到先跑。
- `drain()` 仅供测试：等待所有已排队作业结束，最多等待指定毫秒。

### 10.4 审计事件

| 事件 | 记录内容 |
|------|---------|
| `monte_carlo.scenario.created` | 方案 ID、资产数、年限、路径数 |
| `monte_carlo.scenario.updated` | 方案 ID、变更字段名 |
| `monte_carlo.scenario.deleted` | 方案 ID |
| `monte_carlo.run.queued` | 运行 ID、方案 ID、路径数、种子 |
| `monte_carlo.run.cancelled` | 运行 ID |
| `monte_carlo.run.finished` | 运行 ID、状态、耗时（不记结果数值） |

> 与前三阶段一致：只记标识与计数，不记金额与结果。

### 10.5 验收

- [ ] 队列中运行的 `POST /runs` 不会阻塞其他任意接口（并发压测请求延迟无异常上升）
- [ ] `progress` 单调不减，且同一运行不会出现回退
- [ ] 取消运行后 1 秒内状态变 `cancelled`，且不再占用执行槽
- [ ] 强行杀死进程后重启，残留 `running` 自动回到 `queued` 并在重算后 `succeeded`
- [ ] `attempts` 达到 2 仍失败时置 `failed`，不再无限重试
- [ ] 超过队列上限返回 `MC_QUEUE_FULL` 429
- [ ] 每个方案只保留最新 30 条终态运行

---

## 十一、C3 — 方案与运行接口

### 11.1 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/simulations/monte-carlo` | 方案列表（含最近一次运行摘要） |
| POST | `/api/simulations/monte-carlo` | 创建方案 |
| GET | `/api/simulations/monte-carlo/:id` | 方案详情（含参数与最近运行） |
| PATCH | `/api/simulations/monte-carlo/:id` | 修改方案（不影响历史运行） |
| DELETE | `/api/simulations/monte-carlo/:id` | 删除方案与其全部运行 |
| POST | `/api/simulations/monte-carlo/:id/duplicate` | 复制方案 |
| POST | `/api/simulations/monte-carlo/calculate` | 同步预览（≤500 路径） |
| POST | `/api/simulations/monte-carlo/:id/runs` | 发起运行，返回 `runId` 与队列位置 |
| GET | `/api/simulations/monte-carlo/:id/runs` | 运行历史 |
| GET | `/api/simulations/monte-carlo/:id/runs/:runId` | 运行状态与参数快照 |
| GET | `/api/simulations/monte-carlo/:id/runs/:runId/results` | 聚合结果 |
| GET | `/api/simulations/monte-carlo/:id/runs/:runId/paths` | 抽样路径（按需再生成） |
| POST | `/api/simulations/monte-carlo/:id/runs/:runId/cancel` | 取消运行 |
| POST | `/api/simulations/monte-carlo/compare` | 2–4 个运行或方案并排比较 |
| GET | `/api/simulations/monte-carlo/presets` | 压力情景预设与资产参数模板 |
| GET | `/api/simulations/monte-carlo/suggestions` | 从真实组合反填建议参数 |

> **路由顺序**：`/calculate`、`/compare`、`/presets`、`/suggestions` 必须注册在 `/:id` 之前。Phase 2/3/4 均踩过这个坑，本次在文件头写明。

### 11.2 发起运行

```jsonc
// POST /api/simulations/monte-carlo/:id/runs
// 请求体（可选，用于覆盖本次运行参数）
{ "pathCount": 10000, "seed": 20261023 }

// 响应 202
{
  "run": {
    "id": "...",
    "scenarioId": "...",
    "status": "queued",
    "stage": null,
    "progress": "0.0000",
    "queuePosition": 1,
    "seed": 20261023,
    "pathCount": 10000,
    "years": 20,
    "modelVersion": "montecarlo-v1",
    "createdAt": "2026-10-23T10:00:00.000Z"
  }
}
```

- 请求体只允许覆盖 `pathCount` 与 `seed`；其余参数一律以方案当前值为准并冻结进快照。
- 未提供 `seed` 时由服务端生成（`crypto.randomInt(0, 2**31)`），并在响应中返回，用户可据此复现。
- 同一方案允许同时存在多个排队/运行中的运行，但受队列上限约束。

### 11.3 状态响应

```jsonc
// GET /api/simulations/monte-carlo/:id/runs/:runId
{
  "run": {
    "id": "...", "status": "running", "stage": "simulating",
    "progress": "0.4230", "queuePosition": 0,
    "startedAt": "...", "heartbeatAt": "...", "finishedAt": null,
    "durationMs": null, "failureCode": null, "failureMessage": null,
    "seed": 20261023, "pathCount": 10000, "years": 20,
    "modelVersion": "montecarlo-v1"
  },
  "assumptions": { /* 完整快照 */ }
}
```

- `queuePosition` 仅 `queued` 时有意义（0 表示队首），其余状态为 0。
- 前端按 1 秒轮询；进入终态后停止轮询并拉取结果。

### 11.4 结果响应

```jsonc
// GET /api/simulations/monte-carlo/:id/runs/:runId/results
{
  "runId": "...",
  "status": "succeeded",
  "terminal": {
    "nominal": { "p5": "...", "p10": "...", "p25": "...", "p50": "...", "p75": "...", "p90": "...", "p95": "...", "mean": "...", "sd": "..." },
    "real":    { "p5": "...", "p10": "...", "p25": "...", "p50": "...", "p75": "...", "p90": "...", "p95": "...", "mean": "...", "sd": "..." }
  },
  "contributed": { "nominal": { "p50": "..." }, "real": { "p50": "..." } },
  "standardError": "12345.678900",
  "probabilities": { "loss": "0.312000", "realLoss": "0.441000", "target": "0.587000", "ruin": "0.000000" },
  "drawdown": { "p50": "0.184000", "p90": "0.312000", "p99": "0.402000", "mean": "0.191000" },
  "yearlyBands": [ { "year": 1, "p10": "...", "p25": "...", "p50": "...", "p75": "...", "p90": "..." } ],
  "histogram": { "min": "...", "max": "...", "bins": [12, 45, 130, 240] },
  "assumptions": { /* 完整快照 */ },
  "disclaimers": ["...", "..."]
}
```

- 运行未成功时返回 `MC_RUN_NOT_READY` 409（`running`/`queued`）或 `MC_RUN_FAILED` 409（`failed`/`cancelled`），不返回空结果。
- 金额字段均为字符串，保留 6 位小数；概率字段为 6 位小数字符串。

### 11.5 路径响应

```jsonc
// GET /api/simulations/monte-carlo/:id/runs/:runId/paths?count=10&resolution=monthly&indexes=3,17
{
  "resolution": "monthly",
  "paths": [
    { "index": 3, "values": ["200000.000000", "..."] }
  ]
}
```

- `count` 默认 5，上限 50；`indexes` 可选，指定则忽略 `count`。
- `resolution` 为 `monthly`（默认）或 `yearly`。
- 服务端用 `(seed, pathIndex)` 重新派生随机流并只算所需路径，**不读 `samplePaths`**；这保证任意历史运行都能被完整下钻。
- 运行未成功 → 409；路径索引越界 → 422 `MC_PATH_INDEX_INVALID`。

### 11.6 对比

```jsonc
// POST /api/simulations/monte-carlo/compare
{ "runIds": ["...", "..."], "metrics": ["median", "p10", "p90", "loss", "drawdownP90"] }

// 响应
{
  "items": [
    {
      "runId": "...", "scenarioName": "...", "seed": 1, "pathCount": 5000,
      "median": "...", "p10": "...", "p90": "...",
      "loss": "0.31", "drawdownP90": "0.29",
      "runStatus": "succeeded"
    }
  ]
}
```

- 只允许比较同一 `years` 的运行；年限不同则拒绝（`MC_COMPARE_INCOMPATIBLE` 422），避免把 10 年与 30 年的终值并排误导用户。
- 请求 2–4 项；允许混排「运行 ID」与「方案 ID」（方案取最近一次成功运行），未完成方案返回 `runStatus: "missing"` 而不是报错。

### 11.7 验收

- [ ] 方案重名 409；跨用户访问 404
- [ ] 修改方案后，历史运行的 `assumptions` 与结果不变
- [ ] 未完成的运行请求结果返回 409，不返回空对象
- [ ] 相同 `seed` 与参数两次运行，结果 JSON 完全一致
- [ ] 路径接口按索引再生成的年终值与 `samplePaths` 中同索引一致
- [ ] 队列满返回 429，且不留下孤立的 `queued` 记录
- [ ] 对比不同年限的运行被 422 拒绝

---

## 十二、C4 — 结果聚合与压力测试

### 12.1 聚合位置

聚合在引擎内完成（一次遍历、流式累积），不在服务层二次扫描：

- 终值、累计投入、最大回撤各占一个 `Float64Array`，排序后取分位数。
- 年度采样用「按年累计和」直接写入二维数组，避免存全量月度值。
- 直方图先用一次遍历确定 min/max，再用第二次遍历计数（两次遍历无关紧要，换来桶边界稳定）。

### 12.2 压力测试

三种预设，**确定性**、与随机模拟严格分离：

| 预设 | 行为 |
|------|------|
| `crash` | 首年单月下跌 35%，随后 24 个月按线性恢复到原水平 |
| `stagflation` | 连续 60 个月年化 1%、通胀 6% |
| `lost_decade` | 连续 120 个月年化 0%（名义持平） |

接口与存储：

- `GET /api/simulations/monte-carlo/presets` 返回预设清单（键、名称键、参数说明、默认冲击描述）。
- `POST /api/simulations/monte-carlo/:id/runs` 请求体可带 `stressPreset`；此时运行标记 `modelVersion = 'montecarlo-v1+stress:crash'`，结果只含单条确定性路径。
- 压力运行的结果结构与普通运行保持一致（分位数全部相同），另加 `deterministic: true`。
- 前端把压力结果画成**叠加线**，不进入扇形带。

> 压力情景不参与分位数统计，也不与随机运行比较「达标概率」——单条路径没有概率。

### 12.3 验收

- [ ] 分位数单调，且与 `lib/percentile.ts` 对同一数组的计算结果一致
- [ ] 直方图桶数为 20，权重（路径数）合计等于 `pathCount`
- [ ] 年度带每年末的 P10 ≤ P50 ≤ P90
- [ ] 回撤口径基于增长指数：无波动 + 定投时回撤为 0
- [ ] 压力运行 `deterministic === true`，且不出现概率字段
- [ ] 未设目标金额时 `probabilities.target === null`
- [ ] `standardError` 与 `sd / √pathCount` 一致（误差 ≤ 1e-6）

---

## 十三、C5 — 组合衔接与建议参数

### 13.1 建议接口

```jsonc
// GET /api/simulations/monte-carlo/suggestions?portfolioId=...
{
  "portfolio": { "id": "...", "name": "...", "currency": "CNY" },
  "assets": [
    { "key": "asset_class:etf", "label": "ETF", "weight": "0.620000",
      "expectedAnnualReturn": null, "annualVolatility": null }
  ],
  "correlation": null,
  "history": { "from": "2025-03-01", "to": "2026-10-21", "samples": 412, "frequency": "daily" },
  "confidence": "low",
  "notes": ["samples_below_2_years", "correlation_requires_manual_input"]
}
```

- 权重来自 Phase 4 的当前持仓市值占比（不含现金，与 `holdings.weight` 同一口径）。
- 收益与波动**只在样本足够时**给出：要求每个标的最少 250 个有效价格点且覆盖至少 1 年；否则返回 `null` 并写入 `notes`。
- 计算方法：日收益对数差 → 年化（×250）与年化波动（×√250），**不扣除无风险利率**；结果作为「历史样本估计」返回，不写成「预期收益」。
- 相关矩阵不自动生成：样本不足时自动生成的相关性比噪声更危险，返回 `null` 要求用户手工填写（界面给单位矩阵作为起点）。
- `confidence` 取值 `high`（≥3 年、每个标的 ≥750 点）/ `medium`（≥1 年）/ `low`（不足 1 年或存在缺失）。

### 13.2 边界

- 只读，不写任何表；不修改组合，不触发估值重算。
- 组合不存在或已归档 → `PORTFOLIO_NOT_FOUND` 404。
- 无持仓 → 返回空 `assets` 与 `notes: ['no_holdings']`，不报错。

### 13.3 验收

- [ ] 建议权重合计为 1（四舍五入误差 ≤ 1e-6）
- [ ] 样本不足时收益与波动为 `null`，且 `confidence !== 'high'`
- [ ] 相关矩阵永远不由系统猜测（返回 `null`）
- [ ] 调用建议接口不产生任何写操作（审计日志无新增记录）

---

## 十四、C6 — 前端风险模拟页

### 14.1 路由与导航

- 新增路由 `/monte-carlo`（单页，方案列表与详情在同一页用主从布局）。
- 侧边栏在「复利模拟」之后新增「风险模拟」，图标使用 `lucide-react` 的 `Shuffle` 或 `Activity`。
- 导航项受 `capabilities.available.includes('monte-carlo')` 控制。

### 14.2 页面结构

```
/monte-carlo
├── 左栏：方案列表
│     ├── 新建 / 复制 / 删除
│     ├── 每项显示年限、路径数、最近运行状态徽标
│     └── 「从投资组合反填」入口
├── 右栏：方案编辑与运行（Tab）
│     ├── Tab 1 参数：本金、定投、提款、通胀、费用、年限、路径数、种子、再平衡
│     ├── Tab 2 资产：权重、预期收益、波动率的可编辑表格；权重合计实时校验
│     ├── Tab 3 相关性：可编辑矩阵（默认单位矩阵），一键「设为对角线」
│     ├── Tab 4 运行：发起运行、进度条、阶段文案、取消按钮、运行历史
│     └── Tab 5 结果：扇形带、终值直方图、回撤分位数、指标卡、样本路径叠加
└── 结果区顶部固定展示：假设摘要、样本量与标准误、风险声明
```

### 14.3 组件

```
components/monte-carlo/
├── ScenarioList.tsx          方案列表与状态徽标
├── ScenarioForm.tsx          现金流与年限参数
├── AssetMatrixEditor.tsx     资产权重 / 收益 / 波动率表格
├── CorrelationEditor.tsx     相关矩阵编辑与正定校验提示
├── RunPanel.tsx              发起运行、进度、阶段、取消
├── FanChart.tsx              年度扇形带（P10–P90、P25–P75、P50 中位线）
├── TerminalHistogram.tsx     终值分布直方图
├── MetricCards.tsx           中位数、亏损概率、达标概率、回撤 P90、标准误
├── DrawdownSummary.tsx       回撤分位数与说明
├── SamplePathsChart.tsx      抽样路径叠加
├── ComparisonTable.tsx       2–4 个运行并排
└── AssumptionNotice.tsx      假设摘要与风险声明
```

### 14.4 轮询与状态

- 发起运行后以 1 秒间隔轮询运行状态，进入终态立即停止；页面隐藏（`document.hidden`）时降为 5 秒。
- `queued` 显示队列位置；`running` 显示阶段（参数准备 / 路径模拟 / 结果聚合 / 写入结果）与百分比。
- `failed` 显示 `failureCode` 对应文案与「重试」按钮（沿用原方案参数，生成新运行）。
- `cancelled` 明确显示「已取消，结果未保存」，不显示半成品图表。
- 结果页所有金额带币种；概率一律百分比展示，保留 1 位小数，悬停显示 6 位原值。

### 14.5 图表规范

- 扇形带使用 `connectNulls: false`；任何缺失点断线而不是补零。
- 直方图 x 轴为区间中值，tooltip 显示区间与频数（频数 ÷ 总路径 = 占比）。
- 抽样路径最多同时显示 20 条，颜色不区分含义，仅作形状参考，并在图例注明「任意抽样，不代表特定路径」。
- 压力情景以虚线叠加，图例明确「确定性情景，非模拟结果」。
- 中位数、P10、P90 三条线必须有可区分的线型（不只是颜色），满足色盲可读。

### 14.6 移动端

- 375px 宽度下：资产表格切换为卡片式（资产名 + 权重 + 收益/波动），相关矩阵改为横向滚动容器但**同时提供「表格视图/摘要视图」切换**，避免窄屏无法核对。
- 扇形图在窄屏隐藏 P25/P75 带，只保留 P10–P90 与中位线。

### 14.7 验收

- [ ] 权重合计不为 1 时就地提示，且不允许提交
- [ ] 非正定相关矩阵提交后端返回 422，前端把错误定位到「相关性」Tab
- [ ] 运行中可取消，取消后不再轮询且不显示结果
- [ ] 结果页始终可见样本量、标准误与风险声明
- [ ] 中英文切换后无残留硬编码中文/英文
- [ ] 375px 下无横向滚动条（相关矩阵的滚动被限制在容器内）

---

## 十五、C7 — i18n、测试与交付

### 15.1 i18n

- 新增命名空间 `monte-carlo`，`zh-CN` 与 `en-US` 键完全对齐。
- `enums` 增补：`run_status`、`run_stage`、`return_model`、`rebalance_frequency`、`stress_preset`、`confidence_level`。
- `errors` 增补第十六节全部错误码。
- 风险声明、阶段名称、假设说明全部放语言文件，禁止硬编码。
- 导航注册：`nav:monte-carlo`。

### 15.2 测试

| 层级 | 覆盖 |
|------|------|
| 单元 | PRNG 可复现与均匀性、`splitmix` 路径派生、Box–Muller 均值方差、Cholesky 正确性与非正定拒绝、对数正态漂移校正、零波动等价复利引擎、概率边界、分位数单调、回撤口径、破产路径截断、压力预设路径、分片回调顺序 |
| 集成 | 方案 CRUD 与唯一约束、参数校验顺序与错误码、运行生命周期、队列上限 429、取消幂等、结果未就绪 409、中断恢复（构造心跳超时）、保留策略（第 31 条被删）、同种子两次运行结果一致、路径接口索引再生成一致、对比年限不符 422、跨用户 404、`calculate` 上限 |
| 回归 | Phase 1–4 全部测试通过；无模拟数据时 Dashboard、净资产、分析、预算、投资页响应完全不变；`/api/system/capabilities` 中 `monte-carlo` 从 `planned` 移至 `available` |
| 口径对齐 | 模拟运行前后所有账户余额、交易条数、净资产不变（模拟不写账本的反向断言） |

### 15.3 文档

- [ ] README 增加「风险模拟」章节：模型假设、统计口径、精度说明、与复利引擎的关系
- [ ] `docs/API接口全面分析.md` 第 17 节标记为已实现，并修正 `/run` 为 `/runs`
- [ ] `docs/项目目录结构.md` 增补 `modules/jobs` 与 `modules/simulations/monte-carlo`、前端页面与组件
- [ ] 演示数据脚本增补一个已完成运行的方案，使风险模拟页在演示账号下有可看数据
- [ ] 在 Phase 1–4 计划中「Phase 5 使用 BullMQ / Worker Threads」的表述处补注本计划的架构决策
- [ ] 明确记录「跨运行时末位可能不同」的确定性边界

---

## 十六、接口清单与错误码

### 16.1 接口清单汇总

| 模块 | 接口数 | 所属阶段 |
|------|--------|----------|
| 方案 CRUD 与复制 | 6 | C3 |
| 同步预览 | 1 | C3 |
| 运行与状态 | 5 | C3 |
| 结果与路径 | 2 | C3 |
| 取消 | 1 | C3 |
| 对比 | 1 | C3 |
| 预设与建议 | 2 | C4 / C5 |
| **合计新增** | **18** | |

> 相比前四阶段累计的 165 个接口，本阶段新增 18 个；全项目累计 183 个。（实现时路由合并后实际为 16 个，全项目累计 181 个；Phase 6 在其上新增 27 个，累计 208 个。）

### 实现说明（与计划的差异）

| 项 | 计划 | 实际实现 | 原因 |
|---|---|---|---|
| 执行器绑定 | 未明确启动时机 | `listen` 成功后调用 `jobs.start()` | 若在 `buildApp` 内启动，测试与关闭流程无法控制；先监听再恢复中断运行，顺序也不能颠倒 |
| 分片粒度的归属 | 引擎内按路径切分 | 引擎导出 `simulatePaths(start,end)` 与 `aggregatePaths(batches)`，切片循环在 handler | 各片自行取分位数再合并会得到统计上错误的分布，必须等全部 batch 到齐后统一聚合 |
| 采样路径索引 | 未明确 | 由 `(pathCount, 采样数)` 决定，与分片边界无关 | 否则改一次 chunkSize 就会让「同种子的样本路径」跟着变 |
| 运行列表刷新 | 未明确 | 存在未结束项时按 1.5 秒轮询 | 只刷新单条运行会让左侧列表徽标永远停在「运行中」 |
| 结果 Tab 的默认运行 | 未明确 | 无选中时自动挂到最近一次成功的运行 | 否则进入页面后结果页恒为「还没有可查看的结果」 |
| 单路径月度序列 | 未明确 | 新增 `simulateSinglePath`，路径接口用它 | 批量分片按区间返回原始数组，月度序列需要独立的单路径导出 |
| 演示数据 | 「增补一个已完成运行的方案」 | 演示脚本直接调用引擎计算并落库 | 保证演示结果与真实口径完全一致，不写死数字 |
| 对比接口 | 未限制年限 | 年限或模型版本不一致一律 422 | 把 10 年与 30 年的终值并排会直接误导用户 |

### 新增错误码

### 16.2 新增错误码

| 错误码 | HTTP | 说明 |
|--------|------|------|
| `MC_SCENARIO_NOT_FOUND` | 404 | 方案不存在或不属于当前用户 |
| `MC_SCENARIO_NAME_EXISTS` | 409 | 同一用户下方案名重复 |
| `MC_PARAMETERS_INVALID` | 422 | 标量参数越界或现金流假设自相矛盾 |
| `MC_WEIGHTS_INVALID` | 422 | 资产权重为负或合计不为 1，`details.total` 给出合计 |
| `MC_CORRELATION_INVALID` | 422 | 矩阵维度不符、不对称、越界或非正定，`details.reason` 给出原因 |
| `MC_RUN_NOT_FOUND` | 404 | 运行不存在或不属于当前用户 |
| `MC_RUN_NOT_READY` | 409 | 运行尚未完成，结果不可用 |
| `MC_RUN_FAILED` | 409 | 运行已失败或已取消，无结果 |
| `MC_RUN_ALREADY_FINISHED` | 409 | 对已终态运行发起取消 |
| `MC_QUEUE_FULL` | 429 | 排队与运行中的作业已达上限 |
| `MC_PREVIEW_LIMIT_EXCEEDED` | 422 | 同步预览路径数超限，需改为异步运行 |
| `MC_PATH_INDEX_INVALID` | 422 | 请求的路径索引越界 |
| `MC_COMPARE_INCOMPATIBLE` | 422 | 对比的运行年限或模型版本不一致 |
| `MC_STRESS_PRESET_UNKNOWN` | 422 | 未知的压力情景键 |
| `MC_RANGE_INVALID` | 400 | 运行历史或路径参数区间不合法 |

`failureCode`（非 HTTP 错误码，写入运行记录）：

| 代码 | 含义 |
|------|------|
| `MC_TIMEOUT` | 超过总时限 |
| `MC_INTERRUPTED` | 心跳超时且重试次数用尽 |
| `MC_INTERNAL` | 未预期异常，详情仅在日志 |

> 越权访问一律 404（`MC_SCENARIO_NOT_FOUND` / `MC_RUN_NOT_FOUND`），与前三阶段一致。

---

## 十七、技术依赖

### 后端

**不新增依赖。**

- PRNG、Box–Muller、Cholesky 均为纯计算，使用原生 `number` 与 `Float64Array`。
- 输入校验与解析用既有 `zod`，金额解析用既有 `decimal.js`。
- 异步执行使用 `setImmediate` 与 `performance.now()`（Node 内置），不引入队列库、不引入 `piscina`。
- 统计复用 `lib/percentile.ts`，与 Phase 3 同口径。

> 不引入 BullMQ / Worker Threads 的完整理由见 5.1；若未来需要多实例或更重的任务，替换执行器即可，表结构与接口不变。

### 前端

**不新增依赖。**

- 扇形带、直方图、路径叠加均用既有 `echarts` + `echarts-for-react`。
- 轮询用既有 TanStack Query 的 `refetchInterval`。
- 相关矩阵编辑器为原生 input 网格，不引入矩阵编辑组件库。

---

## 十八、环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `MONTE_CARLO_MAX_PATHS` | `20000` | 单次运行路径上限 |
| `MONTE_CARLO_DEFAULT_PATHS` | `5000` | 新建方案默认路径数 |
| `MONTE_CARLO_MAX_YEARS` | `50` | 模拟年限上限；复利引擎为 100 年，蒙特卡罗逐年存采样点，故取更保守的值 |
| `MONTE_CARLO_PREVIEW_PATHS` | `500` | 同步预览路径上限 |
| `MONTE_CARLO_PREVIEW_TIMEOUT_MS` | `3000` | 同步预览时限 |
| `MONTE_CARLO_MAX_CONCURRENT_RUNS` | `2` | 并发执行槽 |
| `MONTE_CARLO_QUEUE_LIMIT` | `10` | 排队 + 运行中的总上限 |
| `MONTE_CARLO_TIMEOUT_SECONDS` | `120` | 单次运行总时限 |
| `MONTE_CARLO_HEARTBEAT_TIMEOUT_SECONDS` | `30` | 心跳超时判定 |
| `MONTE_CARLO_CHUNK_MS` | `15` | 单次分片的时间预算 |
| `MONTE_CARLO_PROGRESS_INTERVAL_MS` | `400` | 进度写入节流间隔 |
| `MONTE_CARLO_RUN_RETENTION` | `30` | 每个方案保留的终态运行数 |
| `MONTE_CARLO_SAMPLE_PATHS` | `20` | 落库的样本路径数 |
| `MONTE_CARLO_HISTOGRAM_BINS` | `20` | 终值直方图桶数 |

> 全部写入 `src/config/constants.ts` 并在 `/api/system/capabilities` 的 `simulationLimits` 中暴露，供前端做输入校验与提示。不新增外部服务。

---

## 十九、验证清单

### C1

- [ ] 运行模拟期间，任意读写接口的 P95 延迟无明显上升
- [ ] 进度单调、阶段文案正确、取消后 1 秒内生效
- [ ] 进程被强制结束后重启，残留运行自动恢复并成功
- [ ] 重试两次仍失败时不再排队，`failureCode = 'MC_INTERRUPTED'`
- [ ] 队列上限触发 429
- [ ] 保留策略生效，运行数不超过 30

### C2

- [ ] 零波动单资产时终值中位数与复利引擎 `finalNominalValue` 一致（≤1e-6）
- [ ] 相同参数与种子两次调用输出逐字段相等
- [ ] 单独计算第 k 条路径与全量运行中的第 k 条年终值一致
- [ ] 非正定相关矩阵被拒绝，错误码与 `details.reason` 正确
- [ ] 所有概率 ∈ [0,1]，未设目标时 `target === null`
- [ ] 分位数单调、回撤 ∈ [0,1]、无提款时破产概率为 0

### C3

- [ ] 编辑方案不影响历史运行的参数快照与结果
- [ ] 运行中请求结果返回 409 而非空对象
- [ ] 同种子两次运行结果一致，跨不同 `pathCount` 的比较被前端提示为不同样本
- [ ] 路径接口的索引再生成与落库样本一致
- [ ] 不同年限的运行对比被 422 拒绝
- [ ] 跨用户访问方案与运行均 404

### C4

- [ ] 直方图频数合计等于路径数
- [ ] 年度带满足 P10 ≤ P50 ≤ P90，且每年一个点
- [ ] 压力情景结果标记 `deterministic: true`，不含概率字段
- [ ] `standardError` 与 `sd / √pathCount` 一致
- [ ] 分位数与 `lib/percentile.ts` 直接计算结果一致

### C5

- [ ] 建议权重合计为 1，且与组合持仓权重一致
- [ ] 样本不足时收益与波动为 `null`，`confidence` 不为 `high`
- [ ] 相关矩阵不由系统自动生成
- [ ] 建议接口零写入（审计日志无新增）

### C6 / C7

- [ ] 权重合计校验、非正定矩阵错误定位到正确 Tab
- [ ] 结果页固定显示样本量、标准误与风险声明
- [ ] 中英文切换无残留
- [ ] 375px 无整页横向滚动
- [ ] 无方案时展示引导而非空图表
- [ ] 前四阶段全部测试通过，无模拟数据时所有既有页面响应不变
- [ ] `/api/system/capabilities` 中 `monte-carlo` 在 `available`、不在 `planned`

---

## 二十、交付标准与后续衔接

### 功能交付

1. 用户可创建模拟方案，设置年限、路径数、本金、定投、提款、通胀、费用与再平衡频率。
2. 用户可配置多资产权重、预期年化收益、年化波动率与相关矩阵，非正定矩阵会被明确拒绝。
3. 用户可异步发起模拟，查看实时进度并随时取消；运行可复现、可在重启后恢复。
4. 用户可查看终值分位数（名义与实际）、均值与标准误、亏损/实际亏损/达标/破产概率。
5. 用户可查看最大回撤分布、年度财富扇形带、终值直方图与抽样路径。
6. 用户可运行崩盘、滞胀、失去的十年三种确定性压力情景，并与随机结果显式区分。
7. 用户可从真实投资组合反填资产权重，并在样本充足时获得历史估计的收益与波动建议。
8. 用户可并排比较 2–4 次运行的关键指标。

### 质量要求

1. 模拟结果永不写入账本，账户余额、净资产、收支统计、投资持仓在任何运行前后完全不变。
2. 同一 `seed` + 同一参数快照 + 同一 `modelVersion` 的结果逐位一致；变更该组合必须升版本。
3. 结果永不返回单一点估计：任何终值展示都带分位数，任何概率展示都带样本量。
4. 零波动退化必须与复利引擎一致，作为长期回归用例保留。
5. 异步执行不阻塞其他接口，进度单调，取消与超时在片间生效。
6. 进程重启后中断的运行自动恢复，且结果与首次一致。
7. 收益模型、再平衡频率、通胀与费用处理、随机种子随结果完整返回，不得隐藏假设。
8. 跨用户访问一律 404；前四阶段测试全部通过，行为无回归。

### 已知取舍（需在文档与 UI 中明示）

| 取舍 | 影响 | 后续处理 |
|------|------|---------|
| 仅对数正态 | 无法刻画跳跃、厚尾与波动聚集 | 新增模型须先补规范与基准用例，并升 `modelVersion` |
| 单进程分片执行 | 无法横向扩展，重任务会与其他请求争用 CPU | 需要多实例时替换执行器（表与接口不变） |
| 不存全量路径 | 路径只能按索引再生成 | 种子固定使再生成成本可接受；若需批量导出路径另立阶段 |
| 提款不支持逐年递增 | 退休支取只能按固定金额模拟 | 与复利引擎的「每年递增定投」一并设计 |
| 相关矩阵手工填写 | 用户需自备相关性假设 | 样本足够时可在后继阶段提供估计与提示 |
| 历史估计不扣无风险利率 | 估计值是样本统计量而非超额收益 | 接入行情与无风险利率后统一口径 |
| 保留 30 次运行 | 更早的历史会被清理 | 若需要长期归档，随 Phase 7 数据管理一并设计 |
| 跨运行时末位可能不同 | 极端情况下不同 V8 版本结果末位有差异 | 结果落库后不再重算，历史展示不受影响 |
| 同步预览仅 500 路径 | 参数面板反馈是方向性的 | 精确结果必须走异步运行 |

### 与后续阶段的衔接

| 后续阶段 | 建议内容 | 对 Phase 5 的依赖 |
|---------|---------|------------------|
| Phase 6 目标与报告 | 财富目标、财务自由、报表导出 | 直接复用达标概率、终值分位数与假设快照；报告必须并列真实收益与模拟区间并分别标注来源。**已实现**，见 `docs/plan-phase6.md`：概率按目标金额/年限/币种匹配，模拟导出首区块固定含 `modelVersion` 与 `seed` |
| Phase 7 数据管理与运维 | 备份恢复、整体导出、管理后台、任务监控 | 复用 `monte_carlo_runs` 的状态机与保留策略；备份需覆盖方案参数与结果快照，导出需说明结果不可脱离 `modelVersion` 解读 |
| 行情接入（独立小阶段） | 价格提供方、缓存、限流、复权 | 使 C5 的历史估计从「样本不足」变为可用，不改变模拟内核与统计口径 |
| 执行器演进（按需） | 多实例租约、独立 worker 进程 | 替换 `claimOne` 与执行循环，表结构与 API 保持不变 |

### 需补齐的设计文档

| 文档 | 最晚需要时间 |
|------|-------------|
| 蒙特卡罗模型与统计口径规范（收益模型、漂移换算、相关性、回撤与概率定义、基准用例） | C2 开始前 |
| 异步任务运行与失败恢复规范（状态机、领取语义、心跳、超时、保留） | C1 开始前 |
| 模拟结果展示规范（分位数、标准误、风险声明的固定文案与排版） | C6 开始前 |
