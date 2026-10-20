# Comporalife（复利人生）API 接口全面分析

> 项目名称：Comporalife（复利人生）  
> 产品版本：Personal 开源个人版（完整功能范围）  
> 技术栈：React 19 + TypeScript + Vite 8 + Tailwind CSS 4 + ECharts 6 + Fastify 5 + Prisma + PostgreSQL 16 + Redis 7  
> 设计目标：账户与资产管理、银行账单导入、收支预算、投资管理、复利与蒙特卡罗模拟、财富目标、财务报告  
> 范围约束：本文不按 MVP、P0/P1/P2 或阶段划分；闭源商业 SaaS 接口不混入个人开源版。

---

## 接口通用规范

| 项目 | 规范 |
|---|---|
| 基础前缀 | `/api`；生产环境同源反向代理 |
| 数据权限 | 除健康检查、注册登录外均要求登录；所有个人业务记录强制 `user_id` 隔离 |
| 认证 | JWT 短期访问令牌 + HTTP-only Secure SameSite Cookie；敏感变更需 CSRF 防护 |
| 参数校验 | Fastify + Zod/TypeBox，路径参数 ID 使用 UUID |
| 列表分页 | `page`、`pageSize`，或游标 `cursor`；响应返回分页元数据 |
| 时间与币种 | UTC ISO 8601 时间；IANA 时区展示；ISO 4217 币种代码 |
| 金额 | API 使用十进制字符串，如 `"1234.56"`；数据库使用 `NUMERIC/DECIMAL` |
| 幂等性 | 导入提交、转账、投资交易、任务创建等写接口支持 `Idempotency-Key` |
| 变更并发 | 对余额、交易和配置更新支持 `version`/乐观锁，冲突返回 `409` |
| 删除策略 | 涉及账本与审计数据时采用撤销/归档，避免破坏历史可追溯性 |
| 异步任务 | 导入、蒙特卡罗、报告、备份使用 Job 状态与结果接口 |

### 统一响应示例

```json
{
  "success": true,
  "data": { "id": "uuid", "amount": "1234.56", "currency": "USD" },
  "meta": { "requestId": "uuid" }
}
```

### 统一错误示例

```json
{
  "success": false,
  "error": { "code": "VALIDATION_ERROR", "message": "参数校验失败", "details": [] },
  "meta": { "requestId": "uuid" }
}
```

### 列表查询约定

- `GET` 列表统一支持必要的 `page`、`pageSize`、`sort`、`order` 和业务筛选条件。
- 时间范围建议使用 `from`、`to`；资产、交易统计必须显式明确统计口径与时区。
- 返回 `meta.pagination`：`page`、`pageSize`、`total`、`totalPages`。
- 个人数据查询不得允许客户端通过传入任意 `userId` 读取其他用户记录。
- 对导出、报告、模拟等耗时操作，创建返回 `202 Accepted` 和 `jobId`；进度查询返回 `queued/running/succeeded/failed/cancelled`。

---

## 1、认证与会话 (Auth)

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/register` | 注册个人用户 |
| POST | `/api/auth/login` | 账号登录，签发会话 |
| POST | `/api/auth/logout` | 退出并撤销会话 |
| POST | `/api/auth/refresh` | 刷新短期访问令牌 |
| GET | `/api/auth/me` | 当前用户信息 |
| POST | `/api/auth/change-password` | 修改密码并撤销旧会话 |
| POST | `/api/auth/forgot-password` | 请求密码重置邮件 |
| POST | `/api/auth/reset-password` | 使用一次性令牌重置密码 |
| GET | `/api/auth/sessions` | 查询个人登录会话 |
| DELETE | `/api/auth/sessions/:id` | 撤销指定会话 |
| DELETE | `/api/auth/sessions` | 撤销其他全部会话 |


## 2、个人资料与偏好 (Profile)

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/profile` | 个人资料 |
| PATCH | `/api/profile` | 更新昵称、时区等 |
| GET | `/api/profile/preferences` | 用户偏好 |
| PATCH | `/api/profile/preferences` | 更新基础币种、日期格式、主题 |
| POST | `/api/profile/avatar` | 上传头像 |
| DELETE | `/api/profile/avatar` | 删除头像 |
| POST | `/api/profile/delete-request` | 申请删除账号与个人数据 |
| POST | `/api/profile/delete-confirm` | 确认账号注销 |


## 3、个人仪表板 (Dashboard)

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/dashboard/overview` | 净资产、收入、支出、可投资结余 |
| GET | `/api/dashboard/net-worth-trend` | 净资产历史趋势 |
| GET | `/api/dashboard/cashflow` | 现金流趋势 |
| GET | `/api/dashboard/asset-allocation` | 资产分类与占比 |
| GET | `/api/dashboard/account-balances` | 账户余额汇总 |
| GET | `/api/dashboard/recent-transactions` | 最近流水 |
| GET | `/api/dashboard/budget-alerts` | 预算预警 |
| GET | `/api/dashboard/goal-progress` | 财富目标进度 |
| GET | `/api/dashboard/data-quality` | 未分类、未匹配与待核对数据 |


## 4、财务账户 (Accounts)

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/accounts` | 账户列表 |
| POST | `/api/accounts` | 创建现金、银行、信用卡、投资等账户 |
| GET | `/api/accounts/:id` | 账户详情 |
| PATCH | `/api/accounts/:id` | 更新账户元数据 |
| DELETE | `/api/accounts/:id` | 归档或软删除账户（有流水时禁止硬删） |
| POST | `/api/accounts/:id/archive` | 归档账户 |
| POST | `/api/accounts/:id/unarchive` | 恢复归档 |
| GET | `/api/accounts/:id/balance` | 当前余额及计算口径 |
| GET | `/api/accounts/:id/balance-history` | 余额历史 |
| GET | `/api/accounts/:id/transactions` | 指定账户流水 |
| POST | `/api/accounts/:id/reconcile` | 创建余额对账记录 |
| GET | `/api/accounts/:id/reconciliations` | 账户对账历史 |
| GET | `/api/accounts/:id/reconciliations/:reconciliationId` | 对账详情 |


## 5、资产与负债 (Assets & Liabilities)

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/assets` | 非交易型资产列表 |
| POST | `/api/assets` | 登记房产、车辆、其他资产 |
| GET | `/api/assets/:id` | 资产详情 |
| PATCH | `/api/assets/:id` | 更新资产资料 |
| DELETE | `/api/assets/:id` | 删除资产登记 |
| POST | `/api/assets/:id/valuations` | 记录资产估值快照 |
| GET | `/api/assets/:id/valuations` | 资产估值历史 |
| GET | `/api/liabilities` | 负债列表 |
| POST | `/api/liabilities` | 登记贷款或其他负债 |
| GET | `/api/liabilities/:id` | 负债详情 |
| PATCH | `/api/liabilities/:id` | 修改负债资料 |
| DELETE | `/api/liabilities/:id` | 删除负债登记 |
| POST | `/api/liabilities/:id/balance-snapshots` | 记录负债余额 |
| GET | `/api/liabilities/:id/balance-snapshots` | 负债余额历史 |


## 6、账单导入 (Statement Imports)

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/imports/upload` | 上传 CSV/XLSX 银行账单，返回批次 |
| GET | `/api/imports` | 导入批次列表 |
| GET | `/api/imports/:id` | 导入批次详情与处理状态 |
| GET | `/api/imports/:id/preview` | 解析预览、字段映射建议 |
| PATCH | `/api/imports/:id/mapping` | 设置日期、金额、币种、账户等列映射 |
| POST | `/api/imports/:id/validate` | 校验映射与数据质量 |
| GET | `/api/imports/:id/duplicates` | 疑似重复流水清单 |
| PATCH | `/api/imports/:id/duplicates` | 确认重复记录处置 |
| POST | `/api/imports/:id/commit` | 提交有效数据，幂等写入 |
| POST | `/api/imports/:id/cancel` | 取消未提交导入 |
| POST | `/api/imports/:id/rollback` | 撤销批次导入（保留审计） |
| GET | `/api/imports/:id/errors` | 逐行错误与原因 |
| GET | `/api/imports/:id/errors/export` | 导出错误行报告 |
| GET | `/api/imports/templates` | 列出保存的导入映射模板 |
| POST | `/api/imports/templates` | 保存映射模板 |
| PATCH | `/api/imports/templates/:id` | 更新模板 |
| DELETE | `/api/imports/templates/:id` | 删除模板 |

**导入约束：** 先预览和校验，再确认提交；原始文件加密存储并按保留策略清理；按文件指纹、账户、日期、金额、外部流水号等综合去重；批次撤销仅撤销其新增且未被后续依赖的记录。


## 7、交易流水与分录 (Transactions & Ledger)

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/transactions` | 分页搜索、筛选流水 |
| POST | `/api/transactions` | 手工创建流水 |
| GET | `/api/transactions/:id` | 流水详情与分录 |
| PATCH | `/api/transactions/:id` | 修改可编辑字段并重新校验分录 |
| DELETE | `/api/transactions/:id` | 撤销流水（保留审计记录） |
| POST | `/api/transactions/bulk-categorize` | 批量分类 |
| POST | `/api/transactions/bulk-update` | 批量更新备注/标签 |
| GET | `/api/transactions/:id/entries` | 获取复式分录 |
| POST | `/api/transactions/:id/split` | 拆分多类别交易 |
| POST | `/api/transactions/:id/unsplit` | 取消拆分 |
| POST | `/api/transfers` | 建立账户间转账 |
| GET | `/api/transfers` | 转账列表 |
| POST | `/api/transfers/match` | 匹配两端流水为内部转账 |
| POST | `/api/transfers/:id/unmatch` | 解除错误转账匹配 |
| GET | `/api/transactions/unmatched` | 待分类或待匹配流水 |
| POST | `/api/transactions/:id/attachments` | 添加凭证附件 |
| GET | `/api/transactions/:id/attachments` | 凭证列表 |
| DELETE | `/api/transactions/:id/attachments/:attachmentId` | 删除凭证 |

**账本约束：** 内部转账、信用卡还款、证券买入不计为消费；交易分录借贷平衡；更正采用可追溯冲正/修订；跨币种转账保留原币金额、汇率及汇兑差额。


## 8、分类与标签 (Categories & Tags)

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/categories` | 分类树 |
| POST | `/api/categories` | 新增收支分类 |
| GET | `/api/categories/:id` | 分类详情 |
| PATCH | `/api/categories/:id` | 修改分类名称/父级 |
| DELETE | `/api/categories/:id` | 删除分类（先迁移引用） |
| POST | `/api/categories/reorder` | 分类排序 |
| GET | `/api/tags` | 标签列表 |
| POST | `/api/tags` | 创建标签 |
| PATCH | `/api/tags/:id` | 更新标签 |
| DELETE | `/api/tags/:id` | 删除标签 |
| POST | `/api/transactions/:id/tags` | 绑定交易标签 |
| DELETE | `/api/transactions/:id/tags/:tagId` | 解绑交易标签 |


## 9、自动分类规则 (Classification Rules)

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/classification-rules` | 规则列表 |
| POST | `/api/classification-rules` | 创建商户/摘要/金额条件规则 |
| GET | `/api/classification-rules/:id` | 规则详情 |
| PATCH | `/api/classification-rules/:id` | 修改规则与优先级 |
| DELETE | `/api/classification-rules/:id` | 删除规则 |
| POST | `/api/classification-rules/:id/test` | 规则测试预览 |
| POST | `/api/classification-rules/apply` | 批量执行分类规则 |
| POST | `/api/classification-rules/reorder` | 更新规则优先级 |


## 10、收支分析 (Analytics)

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/analytics/income-expense` | 收入与支出汇总 |
| GET | `/api/analytics/cashflow-trend` | 现金流时间序列 |
| GET | `/api/analytics/categories` | 分类收支及占比 |
| GET | `/api/analytics/merchants` | 商户支出统计 |
| GET | `/api/analytics/accounts` | 账户维度统计 |
| GET | `/api/analytics/recurring` | 周期性收入支出识别 |
| GET | `/api/analytics/savings-rate` | 储蓄率及可投资结余 |
| GET | `/api/analytics/period-comparison` | 同比环比比较 |
| GET | `/api/analytics/uncategorized` | 未分类流水统计 |
| GET | `/api/analytics/large-expenses` | 大额支出统计 |


## 11、预算管理 (Budgets)

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/budgets` | 预算列表 |
| POST | `/api/budgets` | 创建月度/年度/分类预算 |
| GET | `/api/budgets/:id` | 预算详情 |
| PATCH | `/api/budgets/:id` | 修改预算额度与周期 |
| DELETE | `/api/budgets/:id` | 删除预算 |
| GET | `/api/budgets/:id/progress` | 预算实际执行进度 |
| GET | `/api/budgets/summary` | 预算总览 |
| GET | `/api/budgets/alerts` | 预算超支预警 |
| POST | `/api/budgets/:id/copy` | 复制预算到下一周期 |


## 12、投资组合与持仓 (Portfolios & Holdings)

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/portfolios` | 投资组合列表 |
| POST | `/api/portfolios` | 创建投资组合 |
| GET | `/api/portfolios/:id` | 组合详情 |
| PATCH | `/api/portfolios/:id` | 修改组合 |
| DELETE | `/api/portfolios/:id` | 归档组合 |
| GET | `/api/portfolios/:id/holdings` | 组合持仓及成本 |
| GET | `/api/portfolios/:id/allocation` | 资产类别/标的配置 |
| GET | `/api/portfolios/:id/performance` | 组合历史收益与风险 |
| GET | `/api/portfolios/:id/valuation-history` | 组合估值历史 |
| GET | `/api/instruments` | 搜索证券与自定义标的 |
| POST | `/api/instruments` | 登记自定义投资标的 |
| GET | `/api/instruments/:id` | 标的详情 |
| PATCH | `/api/instruments/:id` | 修改自定义标的 |
| GET | `/api/instruments/:id/prices` | 标的历史价格 |
| POST | `/api/instruments/:id/prices` | 录入手动价格 |
| DELETE | `/api/instruments/:id/prices/:priceId` | 删除错误价格记录 |


## 13、投资交易与收益 (Investment Trades)

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/investment-trades` | 投资交易记录 |
| POST | `/api/investment-trades` | 新增买卖/股息/费用等交易 |
| GET | `/api/investment-trades/:id` | 交易详情 |
| PATCH | `/api/investment-trades/:id` | 修改交易并重算成本 |
| DELETE | `/api/investment-trades/:id` | 撤销交易并回滚关联分录 |
| GET | `/api/portfolios/:id/realized-gains` | 已实现损益 |
| GET | `/api/portfolios/:id/unrealized-gains` | 未实现损益 |
| GET | `/api/portfolios/:id/income` | 股息与利息收入 |
| GET | `/api/portfolios/:id/cashflows` | 组合现金流 |
| GET | `/api/portfolios/:id/returns` | 时间加权/资金加权收益 |
| POST | `/api/portfolios/:id/recalculate` | 重建组合成本和估值缓存 |

**投资约束：** 买入证券是现金与证券资产之间的转换；股息、手续费、税费分别记账；持仓成本计算方法必须配置且前后一致；历史行情缺失需标记而非静默补零。


## 14、资产配置与再平衡 (Allocation)

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/portfolios/:id/targets` | 目标配置比例 |
| PUT | `/api/portfolios/:id/targets` | 设置资产配置目标（合计100%） |
| GET | `/api/portfolios/:id/drift` | 当前配置偏离 |
| POST | `/api/portfolios/:id/rebalance-preview` | 模拟再平衡建议，不直接交易 |
| GET | `/api/portfolios/:id/risk-summary` | 组合集中度与风险摘要 |


## 15、复利与定投模拟 (Compound Simulations)

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/simulations/compound` | 复利场景列表 |
| POST | `/api/simulations/compound` | 保存复利/定投场景 |
| GET | `/api/simulations/compound/:id` | 场景详情 |
| PATCH | `/api/simulations/compound/:id` | 更新场景参数 |
| DELETE | `/api/simulations/compound/:id` | 删除场景 |
| POST | `/api/simulations/compound/calculate` | 即时计算本金、定投、复利、通胀、提取 |
| POST | `/api/simulations/compound/compare` | 比较多个场景 |
| GET | `/api/simulations/compound/:id/results` | 获取已保存结果 |
| POST | `/api/simulations/compound/:id/duplicate` | 复制场景 |
| GET | `/api/simulations/compound/:id/export` | 导出模拟数据 |

**模拟参数：** 初始本金、周期投入、收益率、复利频率、期限、通胀率、费用率、税费假设、提款方式；返回名义/实际购买力、累计投入、累计收益、逐期明细；模拟结果不得被误认为实际账户余额。


## 16、蒙特卡罗模拟 (Monte Carlo)

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/simulations/monte-carlo` | 模拟方案列表 |
| POST | `/api/simulations/monte-carlo` | 创建模拟方案及假设 |
| GET | `/api/simulations/monte-carlo/:id` | 方案详情 |
| PATCH | `/api/simulations/monte-carlo/:id` | 更新模型假设 |
| DELETE | `/api/simulations/monte-carlo/:id` | 删除方案 |
| POST | `/api/simulations/monte-carlo/:id/run` | 异步启动模拟任务 |
| GET | `/api/simulations/monte-carlo/:id/runs` | 历史运行列表 |
| GET | `/api/simulations/monte-carlo/:id/runs/:runId` | 运行状态与假设快照 |
| GET | `/api/simulations/monte-carlo/:id/runs/:runId/results` | 分位数、亏损概率、尾部风险 |
| GET | `/api/simulations/monte-carlo/:id/runs/:runId/paths` | 抽样路径与置信区间 |
| POST | `/api/simulations/monte-carlo/:id/runs/:runId/cancel` | 取消运行任务 |
| POST | `/api/simulations/monte-carlo/compare` | 比较不同资产配置和假设 |
| GET | `/api/simulations/monte-carlo/:id/runs/:runId/export` | 导出模拟结果 |

**模拟参数：** 资产权重、预期收益、波动率、相关矩阵、分布假设、模拟路径数、随机种子、投入/提款与再平衡策略；输出中位数、P5/P25/P75/P95、亏损概率、目标达成概率、最大回撤及尾部风险。结果附模型版本与假设快照，避免将模拟当作收益承诺。


## 17、财富目标与财务自由 (Financial Goals)

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/goals` | 个人目标列表 |
| POST | `/api/goals` | 创建净资产、储蓄、退休等目标 |
| GET | `/api/goals/:id` | 目标详情 |
| PATCH | `/api/goals/:id` | 更新目标金额、期限、假设 |
| DELETE | `/api/goals/:id` | 删除目标 |
| GET | `/api/goals/:id/progress` | 实际进度与差距 |
| POST | `/api/goals/:id/projection` | 预测达标时间和所需定投 |
| GET | `/api/goals/:id/history` | 目标进度历史 |
| GET | `/api/financial-independence/overview` | 财务自由指标与缺口 |
| POST | `/api/financial-independence/calculate` | 退休支出、提取率、通胀敏感性计算 |


## 18、财务报告 (Reports)

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/reports` | 报告列表 |
| POST | `/api/reports` | 创建个人财务报告 |
| GET | `/api/reports/:id` | 报告元数据 |
| GET | `/api/reports/:id/data` | 报告结构化数据 |
| GET | `/api/reports/:id/download` | 下载报告文件 |
| DELETE | `/api/reports/:id` | 删除报告 |
| POST | `/api/reports/net-worth` | 生成资产负债报告 |
| POST | `/api/reports/cashflow` | 生成现金流报告 |
| POST | `/api/reports/investment` | 生成投资绩效报告 |
| POST | `/api/reports/simulation` | 生成模拟分析报告 |


## 19、汇率与行情 (Exchange Rates & Prices)

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/currencies` | 支持币种列表 |
| GET | `/api/exchange-rates` | 指定日期/币种汇率 |
| POST | `/api/exchange-rates/manual` | 手工维护个人汇率 |
| DELETE | `/api/exchange-rates/manual/:id` | 删除手工汇率 |
| GET | `/api/market-data/providers` | 已配置行情来源状态 |
| POST | `/api/market-data/refresh` | 刷新授权范围内的行情数据 |
| GET | `/api/market-data/status` | 行情与汇率更新状态 |


## 20、数据导出、备份与恢复 (Data Management)

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/exports` | 创建个人数据导出任务 |
| GET | `/api/exports` | 导出任务列表 |
| GET | `/api/exports/:id` | 导出状态 |
| GET | `/api/exports/:id/download` | 下载本人数据 |
| DELETE | `/api/exports/:id` | 删除导出包 |
| POST | `/api/backups` | 创建个人数据备份 |
| GET | `/api/backups` | 个人备份列表 |
| GET | `/api/backups/:id` | 备份元数据 |
| GET | `/api/backups/:id/download` | 下载备份文件 |
| POST | `/api/backups/restore-preview` | 预览恢复影响及冲突 |
| POST | `/api/backups/restore` | 恢复本人数据（需二次确认） |
| DELETE | `/api/backups/:id` | 删除备份 |
| GET | `/api/data-quality/summary` | 重复、未分类、对账异常总览 |
| POST | `/api/data-quality/recheck` | 异步重跑数据质量检查 |


## 21、后台任务 (Jobs)

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/jobs` | 本人任务列表 |
| GET | `/api/jobs/:id` | 本人任务状态与进度 |
| POST | `/api/jobs/:id/cancel` | 取消可取消任务 |
| POST | `/api/jobs/:id/retry` | 重试失败的本人任务 |


## 22、通知与审计 (Notifications & Audit)

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/notifications` | 个人通知列表 |
| PATCH | `/api/notifications/:id/read` | 标记通知已读 |
| POST | `/api/notifications/read-all` | 全部标记已读 |
| GET | `/api/audit-logs` | 查询个人敏感操作日志 |
| GET | `/api/audit-logs/:id` | 审计事件详情 |


## 23、系统设置 (Settings)

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/settings` | 个人设置 |
| PATCH | `/api/settings` | 修改个人设置 |
| GET | `/api/settings/import` | 导入偏好与默认映射 |
| PATCH | `/api/settings/import` | 修改导入偏好 |
| GET | `/api/settings/simulation` | 模拟器默认假设 |
| PATCH | `/api/settings/simulation` | 修改默认通胀/收益率等 |
| GET | `/api/settings/security` | 安全偏好 |
| PATCH | `/api/settings/security` | 修改安全设置 |
| GET | `/api/settings/privacy` | 隐私与保留策略 |
| PATCH | `/api/settings/privacy` | 修改隐私偏好 |


## 24、平台管理后台 (Admin Console)

> 统一账户系统：`super_admin` / `admin` / `user`。所有 `/api/admin/*` 必须验证平台管理员角色；管理员默认无权查看用户财务流水、余额、持仓和模拟数据。除特别说明，`admin` 和 `super_admin` 均可访问；角色授予、撤销仅限 `super_admin`。

### 24.1 管理仪表板

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/admin/dashboard/overview` | 用户数量、状态分布、任务统计、服务概况 |
| GET | `/api/admin/dashboard/registrations` | 注册趋势，聚合统计 |
| GET | `/api/admin/dashboard/security` | 登录失败与安全事件聚合 |
| GET | `/api/admin/dashboard/jobs` | 后台任务状态聚合 |

### 24.2 用户管理

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/admin/users` | 用户列表，分页、邮箱、角色、状态筛选 |
| GET | `/api/admin/users/:id` | 用户账号元数据，不返回财务信息 |
| POST | `/api/admin/users/:id/disable` | 禁用用户并撤销现有会话 |
| POST | `/api/admin/users/:id/enable` | 启用用户 |
| POST | `/api/admin/users/:id/revoke-sessions` | 撤销全部登录会话 |
| POST | `/api/admin/users/:id/send-password-reset` | 触发安全密码重置流程，不返回重置凭据 |
| GET | `/api/admin/users/:id/login-logs` | 用户登录记录，敏感字段脱敏 |
| GET | `/api/admin/users/:id/security-events` | 用户安全事件 |
| GET | `/api/admin/users/:id/audit-logs` | 针对该账号的管理操作记录 |
| POST | `/api/admin/users/:id/deletion-review` | 处理用户删除请求，需明确确认与审计 |

### 24.3 管理员权限

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/admin/admins` | 管理员列表，仅超级管理员 |
| POST | `/api/admin/admins/:id/grant` | 授予 `admin` 角色，仅超级管理员 |
| POST | `/api/admin/admins/:id/revoke` | 撤销 `admin` 角色，仅超级管理员 |
| GET | `/api/admin/permissions/me` | 当前管理员角色与可用操作 |

### 24.4 安全、审计与系统运维

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/admin/security/login-logs` | 登录记录查询与筛选 |
| GET | `/api/admin/security/events` | 安全事件列表 |
| GET | `/api/admin/audit-logs` | 管理员操作审计日志 |
| GET | `/api/admin/jobs` | 系统任务状态汇总（脱敏） |
| GET | `/api/admin/jobs/:id` | 任务元数据及脱敏失败原因 |
| POST | `/api/admin/jobs/:id/retry` | 对允许重试的失败任务发起幂等重试 |
| GET | `/api/admin/system/info` | 服务版本与资源概况 |
| GET | `/api/admin/system/logs` | 脱敏服务运行日志 |
| GET | `/api/admin/system/metrics` | 系统运行指标 |
| GET | `/api/admin/settings` | 部署级设置（不返回密钥明文） |
| PATCH | `/api/admin/settings/registration` | 修改公开注册开关 |
| PATCH | `/api/admin/settings/security` | 更新可在线管理的安全参数 |
| GET | `/api/admin/system/backups` | 备份状态和历史记录 |

**访问与一致性约束：**

- `user` 访问管理路由返回 `403 FORBIDDEN`；未登录返回 `401 UNAUTHORIZED`。
- 对目标用户状态或角色的修改必须验证操作者权限，并记录不可抵赖的审计事件。
- 禁止管理员自我提权；禁止移除最后一个有效超级管理员。
- 管理员用户详情响应采用白名单字段，不包含账户余额、交易流水、持仓、账单原文、模拟方案。
- `revoke-sessions` 需要服务端可撤销会话机制（例如会话版本号或刷新令牌记录），不能仅依赖无状态 JWT 过期。
- 用户删除应遵守既有备份与数据保留规则，不承诺立即清除历史备份中的数据。


## 25、系统维护 (System)

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/system/health` | 存活探针 |
| GET | `/api/system/ready` | 数据库与依赖就绪探针 |
| GET | `/api/system/version` | 版本信息 |
| GET | `/api/system/capabilities` | 开源个人版功能能力声明 |

---

## 接口状态与枚举说明

| 类型 | 建议状态 |
|---|---|
| 导入批次 | `uploaded` / `previewed` / `validated` / `committing` / `completed` / `failed` / `cancelled` / `rolled_back` |
| 异步任务 | `queued` / `running` / `succeeded` / `failed` / `cancelled` |
| 账户 | `active` / `archived` |
| 交易类型 | `income` / `expense` / `transfer` / `adjustment` / `investment` |
| 投资交易 | `buy` / `sell` / `dividend` / `interest` / `fee` / `tax` / `split` |
| 财务目标 | `active` / `completed` / `paused` / `archived` |

## 错误码设计

| 错误码 | HTTP | 说明 |
|---|---:|---|
| `UNAUTHORIZED` | 401 | 未登录或会话失效 |
| `FORBIDDEN` | 403 | 无权操作 |
| `NOT_FOUND` | 404 | 资源不存在或不属于当前用户 |
| `VALIDATION_ERROR` | 400 | 参数不合法 |
| `CONFLICT` | 409 | 数据版本冲突 |
| `IDEMPOTENCY_CONFLICT` | 409 | 相同幂等键请求内容不一致 |
| `ACCOUNT_HAS_TRANSACTIONS` | 409 | 账户存在历史交易，不能直接删除 |
| `LEDGER_UNBALANCED` | 422 | 交易分录不平衡 |
| `TRANSFER_MATCH_CONFLICT` | 409 | 转账匹配冲突 |
| `IMPORT_MAPPING_INVALID` | 422 | 导入列映射无效 |
| `IMPORT_DUPLICATE` | 409 | 批次或流水重复 |
| `IMPORT_NOT_READY` | 409 | 导入尚未通过校验 |
| `CURRENCY_RATE_MISSING` | 422 | 汇率缺失 |
| `PRICE_DATA_MISSING` | 422 | 行情缺失 |
| `ALLOCATION_NOT_100_PERCENT` | 422 | 目标配置不等于 100% |
| `SIMULATION_PARAMETERS_INVALID` | 422 | 模拟参数不合法 |
| `SIMULATION_LIMIT_EXCEEDED` | 429 | 模拟资源配额超限 |
| `JOB_NOT_CANCELLABLE` | 409 | 任务不可取消 |
| `RATE_LIMITED` | 429 | 请求频率过高 |
| `SYSTEM_ERROR` | 500 | 服务内部错误 |

## 关键接口请求与响应示例

### 1. 创建账户

```http
POST /api/accounts
Content-Type: application/json

{"name":"储蓄账户","type":"bank","currency":"USD","openingBalance":"10000.00"}
```

### 2. 创建转账

```http
POST /api/transfers
Idempotency-Key: transfer-20261020-001
Content-Type: application/json

{"fromAccountId":"uuid-1","toAccountId":"uuid-2","amount":"500.00","currency":"USD","occurredAt":"2026-10-20T02:00:00Z"}
```

### 3. 复利计算

```http
POST /api/simulations/compound/calculate
Content-Type: application/json

{"principal":"10000","monthlyContribution":"500","annualReturnRate":"0.07","years":20,"inflationRate":"0.025","contributionTiming":"end_of_period"}
```

### 4. 蒙特卡罗运行

```http
POST /api/simulations/monte-carlo/uuid/run
Idempotency-Key: mc-run-001
Content-Type: application/json

{"paths":10000,"seed":20261020,"model":"correlated-lognormal","rebalance":"annual"}
```

```json
{"success":true,"data":{"jobId":"uuid","status":"queued"}}
```

### 5. 财务统计

```http
GET /api/analytics/income-expense?from=2026-01-01&to=2026-12-31&currency=USD
```

**统计原则：** 同一账户的账单导入记录与手工交易不能重复计算；内部转账不计收入/支出；投资购买不计消费；资产估值变动不计工资收入；所有跨币种统计附汇率日期和换算规则。

## 数据隔离、安全与审计

1. 每条个人业务记录绑定 `user_id`，服务端从认证上下文读取，不信任客户端传入的所有者 ID。
2. Prisma 查询必须统一执行所有者过滤；嵌套资源也需验证父级归属，防止 IDOR。
3. JWT Cookie 使用 `HttpOnly`、`Secure`、`SameSite`；状态变更采用 CSRF Token 或同源策略防护。
4. 银行账单、备份、凭证等敏感文件需要加密、访问鉴权、短时下载链接和保留期限。
5. 密码使用安全散列；不在日志记录令牌、账户完整号码或原始账单内容。
6. 交易更正、导入撤销、恢复备份、修改持仓等操作需要审计记录与二次确认。
7. 后台管理员只能管理账户状态和系统运行，默认无权浏览个人银行流水、持仓和财务报告。
8. 所有外部行情/汇率和导入数据都需要数据来源、更新时间和缺失状态标记。

## 开源个人版与商业 SaaS 边界

| 能力 | Personal 开源版 | 未来 Cloud 闭源版 |
|---|---|---|
| 个人账号与用户隔离 | 完整支持 | 复用核心 |
| 账户、账单、预算、投资、模拟 | 完整支持 | 复用核心 |
| 个人数据导出、备份、恢复 | 完整支持 | 复用核心并增加托管服务 |
| 家庭邀请与成员共享 | 不包含 | 商业专属 |
| 租户管理、组织权限 | 不包含 | 商业专属 |
| 订阅、账单与支付 | 不包含 | 商业专属 |
| 云端银行自动连接与托管 | 不作为个人版基础接口 | 商业服务可扩展 |

**边界原则：** 本文不设计 `/api/tenants`、`/api/households`、`/api/subscriptions` 等商业专属路由；未来通过独立闭源模块或服务扩展，避免在开源核心中提前引入租户表。

## 接口总览

| 模块 | 接口数量 |
|---|---:|
| 认证与会话 (Auth) | 11 |
| 个人资料与偏好 (Profile) | 8 |
| 个人仪表板 (Dashboard) | 9 |
| 财务账户 (Accounts) | 13 |
| 资产与负债 (Assets & Liabilities) | 14 |
| 账单导入 (Statement Imports) | 17 |
| 交易流水与分录 (Transactions & Ledger) | 18 |
| 分类与标签 (Categories & Tags) | 12 |
| 自动分类规则 (Classification Rules) | 8 |
| 收支分析 (Analytics) | 10 |
| 预算管理 (Budgets) | 9 |
| 投资组合与持仓 (Portfolios & Holdings) | 16 |
| 投资交易与收益 (Investment Trades) | 11 |
| 资产配置与再平衡 (Allocation) | 5 |
| 复利与定投模拟 (Compound Simulations) | 10 |
| 蒙特卡罗模拟 (Monte Carlo) | 13 |
| 财富目标与财务自由 (Financial Goals) | 10 |
| 财务报告 (Reports) | 10 |
| 汇率与行情 (Exchange Rates & Prices) | 7 |
| 数据导出、备份与恢复 (Data Management) | 14 |
| 后台任务 (Jobs) | 4 |
| 通知与审计 (Notifications & Audit) | 5 |
| 系统设置 (Settings) | 10 |
| 最小平台管理 (Admin) | 8 |
| 系统维护 (System) | 4 |
| **合计** | **256** |

## 总结

本文件列出 Comporalife（复利人生）Personal 开源版的完整 API 功能范围，不进行 MVP 或 P0/P1/P2 划分。接口设计以个人财务数据一致性、跨账户防重复统计、金融金额精度、可追溯导入和可复现投资模拟为核心；未来商业 SaaS 的多租户、家庭协作和订阅系统保持独立。
