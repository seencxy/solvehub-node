export type TaskType =
  | 'turnstile'
  | 'interstitial'
  | 'datadome'
  | 'akamai'
  | 'perimeterx'
  | 'imperva'
  | 'aws_waf'
  | 'alibaba'
  | 'funcaptcha'
  | 'image';

export type TaskStatus =
  | 'queued'
  | 'processing'
  | 'done'
  | 'failed'
  | 'cancelled'
  | 'uncertain';

export interface TaskSolution {
  /** Token to post back to the site (Turnstile, Interstitial, WAF). */
  value?: string;
  /** Cookies to reuse from the same IP and User-Agent. */
  cookies?: Record<string, string>;
  userAgent?: string;
  [key: string]: unknown;
}

export interface Task {
  id: string;
  type: TaskType;
  status: TaskStatus;
  price?: string;
  error?: string;
  solution?: TaskSolution;
  createdAt?: string;
  [key: string]: unknown;
}

export interface TaskPayload {
  websiteURL: string;
  websiteKey?: string;
  captchaUrl?: string;
  [key: string]: unknown;
}

export interface ClientOptions {
  baseUrl?: string;
  timeout?: number;
}

export interface SolveOptions {
  proxy?: string;
  idempotencyKey?: string;
  timeout?: number;
  interval?: number;
}

export declare const VERSION: string;
export declare const TASK_TYPES: ReadonlyArray<TaskType>;
export declare const PENDING_STATUSES: ReadonlyArray<TaskStatus>;
export declare const TERMINAL_STATUSES: ReadonlyArray<TaskStatus>;

export declare class SolveHubError extends Error {
  status?: number;
  payload: Record<string, unknown>;
  requestId?: string;
}

export declare class TaskTimeout extends SolveHubError {
  task: Task;
}

export declare class TaskFailed extends SolveHubError {
  task: Task;
}

export declare function verifyWebhook(
  rawBody: string | Buffer | Uint8Array,
  signature: string | undefined,
  secret: string,
): boolean;

export declare class SolveHub {
  constructor(apiKey: string, options?: ClientOptions);
  prices(): Promise<Record<string, unknown>>;
  balance(): Promise<{ available?: string; reserved?: string }>;
  createTask(
    type: TaskType,
    task: TaskPayload,
    options?: Pick<SolveOptions, 'proxy' | 'idempotencyKey'>,
  ): Promise<Task>;
  getTask(taskId: string): Promise<Task>;
  listTasks(options?: { limit?: number }): Promise<{ tasks?: Task[] }>;
  cancelTask(taskId: string): Promise<Task>;
  wait(taskId: string, options?: { timeout?: number; interval?: number }): Promise<Task>;
  solve(type: TaskType, task: TaskPayload, options?: SolveOptions): Promise<Task>;
  setWebhook(url: string, options?: { secret?: string }): Promise<Record<string, unknown>>;
  webhook(): Promise<Record<string, unknown>>;
  webhookDeliveries(options?: { limit?: number }): Promise<Record<string, unknown>>;
}

export default SolveHub;
