# Comporalife（复利人生）

开源自部署的个人财富管理工具：**银行账单 → 收支分析 → 可投资结余 → 复利与风险模拟**。

数据保存在你自己的部署里，不做云端托管，不建租户与家庭共享。

## 当前进度

**Phase 1 已完成** —— 个人财务主链路垂直切片。

| 已交付 | 说明 |
|---|---|
| 认证与账户 | 注册、登录、会话轮换、密码重置、多用户数据隔离 |
| 财务账户 | 六类账户、期初余额、实时余额、余额历史、对账 |
| 交易账本 | 复式分录、收入/支出/转账/调整、冲正、批量操作 |
| 收支分析 | 净资产、现金流、储蓄率、资产配置、数据质量 |
| 复利模拟 | 复利与定投计算、年度明细、场景保存与对比 |
| 多币种 | 手工汇率、折算到基准币种、缺失汇率显式提示 |

尚未交付（后续阶段）：银行账单导入、预算、投资组合、蒙特卡罗、财富目标、报表导出、管理后台。

详见 [Phase 1 开发计划](docs/plan-phase1.md)。

## 技术栈

| 层级 | 选型 |
|---|---|
| 前端 | React 19 + TypeScript + Vite + Tailwind CSS 4.3 + ECharts |
| 后端 | Fastify 5 + TypeScript + Prisma |
| 数据 | PostgreSQL 16 + Redis 7 |
| 部署 | Docker Compose + Nginx |

## 快速开始

### 一键部署

```bash
cp .env.example .env
# 生成至少 32 位的 JWT_SECRET 写入 .env
# 例：node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"

docker compose up -d --build
docker compose exec api npx prisma migrate deploy
```

访问 http://localhost:3000，注册第一个账号即可使用。

### 本地开发

```bash
# 只启动依赖服务（会暴露 5432 / 6379 到宿主机）
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres redis

cp .env.example .env
cp .env server/.env
# 在 server/.env 中设置 LOG_PRETTY=true 开启可读日志

cd server
npm install
npx prisma migrate dev
npm run seed          # 创建超级管理员与分类模板
npm run seed:demo     # 可选：生成演示账号与虚构流水
npm run dev           # http://localhost:4000

cd ../frontend
npm install
npm run dev           # http://localhost:5173
```

演示账号（执行 `seed:demo` 后）：`demo@comporalife.local` / `DemoPass123`

## 常用命令

```bash
cd server
npm run typecheck     # 类型检查
npm run lint          # ESLint
npm test              # 单元 + 集成测试（需要 postgres 与 redis）
npm run seed          # 超级管理员与分类模板
npm run seed:demo     # 演示数据（禁止生产环境运行）

cd frontend
npm run typecheck
npm run build
```

## 端口

| 服务 | 端口 | 说明 |
|---|---:|---|
| Nginx | 3000 | 唯一对外入口 |
| Fastify API | 4000 | 内部 API |
| Vite | 5173 | 仅开发 |
| PostgreSQL | 5432 | 仅开发映射，生产不暴露 |
| Redis | 6379 | 仅开发映射，生产不暴露 |

## 核心设计约定

这几条不是可选风格，而是产品正确性的前提：

1. **账本用复式分录**。收入与支出配一条外部对手方分录，转账是两条真实账户分录；每笔交易求和必须为零，否则整笔回滚。
2. **余额不冗余存储**。账户余额 = 期初余额 + 已入账分录之和，避免两套权威数据。
3. **交易不物理删除**。删除语义是冲正，分录保留，历史可追溯。
4. **转账、信用卡还款、投资买入都不是消费**。内部转账单独统计，不进入收入或支出。
5. **金额全程 Decimal**。数据库 `DECIMAL(20,6)`，后端 `decimal.js`，API 传输字符串，不用浮点。
6. **模拟结果不落库**。参数确定则结果确定，读取时实时计算，防止结果与参数不一致。
7. **缺失汇率不猜**。缺少汇率时相关账户从折算中排除并显式提示，不按 1:1 处理。
8. **统计必须带口径**。所有指标随数值返回时间区间、基准币种、时区与数据完整性标记。

## 文档

- [项目功能全面分析](docs/项目功能全面分析.md)
- [API 接口全面分析](docs/API接口全面分析.md)
- [技术栈选型与开发准备清单](docs/技术栈选型与开发准备清单.md)
- [项目目录结构](docs/项目目录结构.md)
- [Phase 1 开发计划](docs/plan-phase1.md)

## 安全说明

- 所有财务数据按 `user_id` 隔离，服务端从认证上下文取归属，不信任客户端传入的 ID。
- 密码使用 Argon2id；访问令牌短期有效，刷新令牌轮换且仅存哈希。
- 日志脱敏密码、令牌与金额明细。
- `uploads/` 不做静态目录映射，文件读取必须走鉴权 API。
- 管理员默认无权查看用户财务数据。

## 许可证

MIT，见 [LICENSE](LICENSE)。
