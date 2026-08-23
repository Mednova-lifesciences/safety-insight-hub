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
 * Authentication: the bearer token comes from the Supabase JS client's own
 * session (see getAuthToken below), not a static copy — Supabase auto-
 * refreshes that session in the background (autoRefreshToken: true), so a
 * call made after the ~1 hour access-token lifetime still gets a valid
 * token instead of a stale one that 401s. No API keys or model credentials
 * ever live in this client.
 */

import { supabase } from "@/integrations/supabase/client";

export const API_BASE_URL: string =
  (import.meta.env["VITE_PV_API_BASE_URL"] as string | undefined)?.replace(/\/$/, "") ?? "";

export const isApiConfigured = () => API_BASE_URL.length > 0;

// Token management
export const getStoredToken = (): string | null => {
  try {
    return localStorage.getItem("auth_token");
  } catch {
    return null;
  }
};

export const setStoredToken = (token: string | null): void => {
  try {
    if (token) {
      localStorage.setItem("auth_token", token);
    } else {
      localStorage.removeItem("auth_token");
    }
  } catch {
    // Silent fail for localStorage access issues
  }
};

/**
 * The token actually sent on every FastAPI request. Prefers the Supabase
 * client's current session token — Supabase transparently refreshes this
 * in the background, so it's still valid long after sign-in — falling
 * back to the static localStorage copy only if no Supabase session exists
 * (e.g. a call made before syncSupabaseSession() has run). Never throws:
 * an errored/missing session just means no token is attached, same as
 * before this existed.
 */
async function getAuthToken(): Promise<string | null> {
  try {
    const { data, error } = await supabase.auth.getSession();
    if (!error && data.session?.access_token) return data.session.access_token;
  } catch {
    /* fall through to the static copy below */
  }
  return getStoredToken();
}

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
  token?: string;
}

export async function apiRequest<T>(
  endpoint: string,
  { method = "GET", body, signal, query, token }: RequestOptions = {},
): Promise<T> {
  if (!isApiConfigured()) throw new ApiNotConfiguredError(endpoint);

  const url = new URL(`${API_BASE_URL}${endpoint}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    }
  }

  // Use the explicitly provided token (rare — a caller doing its own
  // token handling) or the current, Supabase-refreshed session token.
  const authToken = token || (await getAuthToken());
  const headers: Record<string, string> = {};

  if (!body || !(body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  if (authToken) {
    headers["Authorization"] = `Bearer ${authToken}`;
  }

  const isForm = body instanceof FormData;
  const res = await fetch(url.toString(), {
    method,
    credentials: "include",
    signal: signal ?? null,
    headers,
    body: isForm ? (body as FormData) : body ? JSON.stringify(body) : null,
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
