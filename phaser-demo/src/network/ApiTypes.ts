/**
 * ApiClient 公共类型定义
 *
 * 这里集中存放跨多个 API 调用复用的类型。
 * 单个端点专属的请求/响应 shape 可在调用方就近定义后传入泛型。
 */

/** HTTP 方法 */
export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

/** query 参数允许的值 */
export type QueryValue = string | number | boolean | null | undefined;
export type QueryParams = Record<string, QueryValue>;

/** 单次请求的可选配置 */
export interface RequestOptions {
  /** 单次请求超时（毫秒），覆盖默认值 */
  timeoutMs?: number;
  /** query string 参数 */
  query?: QueryParams;
  /** 是否跳过自动注入 Authorization 头部 */
  skipAuth?: boolean;
  /** 额外自定义头部 */
  headers?: Record<string, string>;
  /** 透传给底层 fetch 的 signal（与 timeoutMs 同时存在时取较短的） */
  signal?: AbortSignal;
}

/** 后端返回的统一错误负载（推测；视后端实现存在偏差） */
export interface ApiErrorPayload {
  error?: string;
  message?: string;
  code?: string;
  [key: string]: unknown;
}

/** 网络层失败事件信息（供 onNetworkFailure 钩子使用） */
export interface NetworkFailureInfo {
  /** 触发失败的请求路径 */
  path: string;
  /** HTTP 方法 */
  method: HttpMethod;
  /** 失败类型 */
  kind: 'timeout' | 'network' | 'http';
  /** 当为 http 类型时，附带状态码 */
  status?: number;
  /** 原始错误对象（如有） */
  cause?: unknown;
}

/** 网络失败回调签名 */
export type NetworkFailureHandler = (info: NetworkFailureInfo) => void;

/**
 * 通用「成功 + data」响应包装。后端目前没有强约束，多数返回直接是数据对象，
 * 这里仅作为可选包装类型，调用方按需使用。
 */
export interface OkResponse<T> {
  ok?: boolean;
  data?: T;
  [key: string]: unknown;
}

/**
 * 角色快照响应 stats 子结构（与后端 SnapshotService 返回的 stats 对齐）。
 * 仅列出前端会消费的关键字段，其它字段保留 unknown 兜底。
 */
export interface SnapshotStats {
  level?: number;
  exp?: number;
  gold?: number;
  skillPoints: number;
  [key: string]: unknown;
}

/**
 * 角色快照响应（GET /api/characters/:id/snapshot）。
 * 当前后端返回结构不固定，统一用宽松定义；stats 字段已加入 skillPoints。
 */
export interface SnapshotResponse {
  snapshot?: Record<string, unknown>;
  save?: Record<string, unknown>;
  stats?: SnapshotStats;
  skillLevels?: Record<string, number>;
  skillPoints?: number;
  [key: string]: unknown;
}

/**
 * 技能升级成功响应（POST /api/skills/upgrade）。
 */
export interface UpgradeSkillResponse {
  skillPoints: number;
  skillLevels: Record<string, number>;
  upgradedSkillId: string;
  newLevel: number;
}

/**
 * 技能升级业务错误码（后端返回 400 + error: code + message）。
 */
export interface UpgradeSkillError {
  error:
    | 'CHARACTER_NOT_FOUND'
    | 'SKILL_TEMPLATE_NOT_FOUND'
    | 'SKILL_UPGRADE_CLASS_MISMATCH'
    | 'SKILL_UPGRADE_LEVEL_LOCKED'
    | 'SKILL_UPGRADE_MAXED'
    | 'SKILL_UPGRADE_INSUFFICIENT_SP';
  message?: string;
}

/**
 * 装备图鉴单条记录
 */
export interface EquipmentCodexEntry {
  templateId: string;
  name: string;
  slot: string;
  rarity: string;
  description: string | null;
  unlocked: boolean;
  obtainCount: number;
  firstObtainAt: string | null;
}

/**
 * 装备图鉴查询响应
 */
export interface EquipmentCodexResponse {
  codex: EquipmentCodexEntry[];
}
