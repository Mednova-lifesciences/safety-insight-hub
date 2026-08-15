/**
 * HTTP client for the MedNova PV Assist FastAPI layer.
 *
 * The FastAPI service wraps the existing Python `pv_assist` package
 * (audit, llm, seriousness, coding, linelist, psur). Nothing in this
 * repository re-implements those algorithms.
 *
 * Configure the backend by setting VITE_PV_API_BASE_URL (e.g.
 * http://localhost:8000) before running the app locally. Until that is set,
 * every call rejects with `ApiNotConfiguredError` and the UI renders an
 * explicit "pending integration" state instead of inventing results.
 *
 * Authentication: credentials are sent as cookies (`credentials: "include"`).
 * No API keys or model credentials ever live in this client.
 */

export const API_BASE_URL: string =
  (import.meta.env["VITE_PV_API_BASE_URL"] as string | undefined)?.replace(/\/$/, "") ??
  "";

export const isApiConfigured = () => API_BASE_URL.length > 0;

export class ApiNotConfiguredError extends Error {
  readonly kind = "not_configured";
  constructor(public endpoint: string) {
    super(
      `The PV Assist backend is not connected. Set VITE_PV_API_BASE_URL and expose ${endpoint} from the FastAPI layer.`,
    );
    this.name = "ApiNotConfiguredError";
  }
}

export class ApiError extends Error {
  readonly kind = "http_error";
  constructor(
    public status: number,
    message: string,
    public detail?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const isNotConfigured = (e: unknown): e is ApiNotConfiguredError =>
  e instanceof ApiNotConfiguredError;

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
  query?: Record<string, string | number | boolean | undefined>;
}

export async function apiRequest<T>(
  endpoint: string,
  { method = "GET", body, signal, query }: RequestOptions = {},
): Promise<T> {
  if (!isApiConfigured()) throw new ApiNotConfiguredError(endpoint);

  const url = new URL(`${API_BASE_URL}${endpoint}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    }
  }

  const isForm = body instanceof FormData;
  const res = await fetch(url.toString(), {
    method,
    credentials: "include",
    signal,
    headers: isForm ? undefined : body ? { "Content-Type": "application/json" } : undefined,
    body: isForm ? body : body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    let detail: unknown;
    try {
      detail = await res.json();
    } catch {
      detail = await res.text().catch(() => undefined);
    }
    throw new ApiError(res.status, `${method} ${endpoint} failed (${res.status})`, detail);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export async function apiUpload<T>(endpoint: string, file: File, fields?: Record<string, string>) {
  const form = new FormData();
  form.append("file", file);
  for (const [k, v] of Object.entries(fields ?? {})) form.append(k, v);
  return apiRequest<T>(endpoint, { method: "POST", body: form });
}
