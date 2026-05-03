/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 旧版变量名，向后兼容 */
  readonly VITE_API_URL?: string;
  /** 新版统一基址，优先使用 */
  readonly VITE_API_BASE_URL?: string;
  /** ApiClient debug 日志开关（'1' / 'true' 启用） */
  readonly VITE_API_DEBUG?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
