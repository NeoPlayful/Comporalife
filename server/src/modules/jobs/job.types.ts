import type { RunStage } from '@prisma/client';

/** 作业状态的取值范围，与 Prisma 枚举保持一致 */
export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

/** 结束态：进入终态后不再接受进度与取消 */
export const FINAL_STATUSES: readonly JobStatus[] = ['succeeded', 'failed', 'cancelled'];

export function isFinalStatus(status: string): boolean {
  return FINAL_STATUSES.includes(status as JobStatus);
}

/** 写入运行的失败原因码，与 HTTP 错误码区分 */
export const JobFailureCode = {
  TIMEOUT: 'MC_TIMEOUT',
  INTERRUPTED: 'MC_INTERRUPTED',
  INTERNAL: 'MC_INTERNAL',
} as const;

export type JobFailureCodeValue = (typeof JobFailureCode)[keyof typeof JobFailureCode];

export interface JobHooks {
  /** 切换阶段并写入进度，内部节流 */
  setStage(stage: RunStage): Promise<void>;
  /** 报告已完成的工作量，节流写入且保证单调不减 */
  reportProgress(value: number): Promise<void>;
  /** 片间轮询取消标记 */
  isCancelRequested(): Promise<boolean>;
  /** 是否已超过总时限 */
  isExpired(): boolean;
}

/**
 * 执行器只依赖这个接口，不认识任何具体业务。
 * 将来接入导出或备份任务时只需再实现一个 handler，执行器与表结构不变。
 */
export interface JobHandler<TPayload extends JobPayload, TResult> {
  /** 任务类型标识，仅用于日志 */
  readonly kind: string;

  /** 读取执行所需数据；返回 null 表示记录已被删除，本次执行直接结束 */
  load(runId: string): Promise<TPayload | null>;

  /** 执行计算。不得自行读取时钟用于结果，时间只能用于日志与超时 */
  run(payload: TPayload, hooks: JobHooks): Promise<TResult>;

  /** 成功落库：写入结果并置终态 */
  persist(runId: string, result: TResult): Promise<void>;

  /** 失败落库：写入失败码与短说明，不写堆栈 */
  fail(runId: string, code: JobFailureCodeValue, message: string): Promise<void>;
}

/** 执行器启动 handler 时需要的、与任务无关的最小上下文 */
export interface JobPayload {
  runId: string;
  startedAt: Date;
}
