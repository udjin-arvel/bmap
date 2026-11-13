export type ApiErrorCode =
  | "SELF_CONNECTION"
  | "DUPLICATE_EDGE"
  | "CYCLE_DETECTED"
  | "NODE_NOT_FOUND"
  | "INVALID_COLOR"
  | "UNAUTHORIZED"
  | "USERNAME_TAKEN"
  | "FORBIDDEN"
  | "AI_CHAIN_EXISTS"
  | "NETWORK"
  | "UNKNOWN";

export const ERROR_MESSAGES: Record<ApiErrorCode, string> = {
  SELF_CONNECTION: "Нельзя соединить узел с самим собой",
  DUPLICATE_EDGE: "Такая связь уже существует",
  CYCLE_DETECTED: "Связь создаст цикл — карта должна оставаться иерархичной",
  NODE_NOT_FOUND: "Узел не найден — возможно, он уже удалён",
  INVALID_COLOR: "Цвет не из палитры",
  UNAUTHORIZED: "Сессия истекла — войдите снова",
  USERNAME_TAKEN: "Такой логин уже занят",
  FORBIDDEN: "Недостаточно прав для этого действия",
  AI_CHAIN_EXISTS: "У узла уже есть AI-продолжение — подтвердите замену",
  NETWORK: "Сервер недоступен — проверьте подключение",
  UNKNOWN: "Что-то пошло не так",
};

export class ApiError extends Error {
  status: number;
  code: ApiErrorCode;
  detail?: string | undefined;

  constructor(status: number, code: ApiErrorCode, detail?: string) {
    super(detail ?? code);
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

const KNOWN_CODES = new Set(Object.keys(ERROR_MESSAGES));

/**
 * Turns a backend error body into an ApiError. Accepts both the spec format
 * `{ detail, code }` and Okapi's wrapped `{ detail: { detail, code } }`.
 */
export function parseApiError(status: number, body: unknown): ApiError {
  let code: string | undefined;
  let detail: string | undefined;
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    if (typeof b["code"] === "string") code = b["code"];
    if (typeof b["detail"] === "string") detail = b["detail"];
    if (b["detail"] && typeof b["detail"] === "object" && !Array.isArray(b["detail"])) {
      const inner = b["detail"] as Record<string, unknown>;
      if (typeof inner["code"] === "string") code = inner["code"];
      if (typeof inner["detail"] === "string") detail = inner["detail"];
    }
    if (Array.isArray(b["detail"])) {
      const first = b["detail"][0] as Record<string, unknown> | undefined;
      if (first && typeof first["msg"] === "string") detail = first["msg"];
      if (detail && /palette|палитр/i.test(detail)) code = "INVALID_COLOR";
    }
  }
  if (!code || !KNOWN_CODES.has(code)) {
    if (status === 401) code = "UNAUTHORIZED";
    else if (status === 403) code = "FORBIDDEN";
    else if (status === 409) code = "AI_CHAIN_EXISTS";
    else if (status === 404) code = "NODE_NOT_FOUND";
    else code = "UNKNOWN";
  }
  return new ApiError(status, code as ApiErrorCode, detail);
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === "UNKNOWN" && err.detail) return err.detail;
    return ERROR_MESSAGES[err.code];
  }
  return ERROR_MESSAGES.UNKNOWN;
}
