/**
 * Authentication API service
 * Handles signup and signin with the FastAPI backend using real authentication
 */

import { ApiError, apiRequest, setStoredToken, getStoredToken } from "./client";

export interface SignupRequest {
  email: string;
  password: string;
  name: string;
  mode: "CREATE_ORG" | "JOIN_ORG";
  organization_name?: string;
  org_code?: string;
  /** JOIN_ORG only — which role the invite code grants this signup.
   *  Mirrors JoinableRole in lib/auth.tsx; the server re-validates it
   *  against its own list and never trusts this value. The three assessor
   *  roles are absent on purpose: they are provisioned, not self-served. */
  role?: "PV_COORDINATOR" | "FIELD_ASSOCIATE";
}

export interface SigninRequest {
  email: string;
  password: string;
}

export interface AuthResponse {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  user: {
    id: string;
    email: string;
    user_metadata?: {
      name?: string;
    };
  };
  profile: {
    user_id: string;
    email: string;
    organization_id: string;
    role:
      | "REVIEW_OFFICER"
      | "EVALUATOR"
      | "PEER_REVIEWER"
      | "PV_MANAGER"
      | "PV_COORDINATOR"
      | "MANAGER"
      | "COORDINATOR"
      | "FIELD_ASSOCIATE";
    created_at: string;
  };
  organization: {
    id: string;
    name: string;
    slug: string;
    /** Present only on the response to a CREATE_ORG signup — never
     *  returned to a user joining an existing org via JOIN_ORG. */
    invite_code?: string;
  };
}

export const auth = {
  /**
   * Sign up with email and password
   * Creates a new organization for the first user (PV_MANAGER role)
   */
  async signup(request: SignupRequest): Promise<AuthResponse> {
    const response = await apiRequest<AuthResponse>("/api/auth/signup", {
      method: "POST",
      body: request,
    });
    // Store token on signup
    if (response?.access_token) {
      setStoredToken(response.access_token);
    }
    return response;
  },

  /**
   * Sign in with email and password
   * Returns JWT token and user profile
   */
  async signin(request: SigninRequest): Promise<AuthResponse> {
    const response = await apiRequest<AuthResponse>("/api/auth/signin", {
      method: "POST",
      body: request,
    });
    // Store token on signin
    if (response?.access_token) {
      setStoredToken(response.access_token);
    }
    return response;
  },

  /**
   * Get current user profile (uses stored token automatically).
   * Returns null when the token is rejected (signed out). Throws when the
   * server cannot be reached even after retrying, so the caller can keep
   * the session instead of signing someone out over a network outage.
   */
  async getCurrentUser(): Promise<AuthResponse["profile"] | null> {
    const token = getStoredToken();
    if (!token) return null;
    // Only a real "not signed in" (401/403) ends the session. A server or
    // network error is retried briefly, so a blip while reloading a page
    // does not log the person out.
    for (let attempt = 1; ; attempt++) {
      try {
        return await apiRequest<AuthResponse["profile"]>("/api/auth/me", {
          method: "GET",
          token,
        });
      } catch (err) {
        const signedOut = err instanceof ApiError && (err.status === 401 || err.status === 403);
        if (signedOut) return null;
        if (attempt >= 3) throw err;
        await new Promise((resolve) => setTimeout(resolve, 600 * attempt));
      }
    }
  },

  /**
   * Sign out (clears stored token)
   */
  async signout(): Promise<void> {
    const token = getStoredToken();
    if (token) {
      try {
        await apiRequest<void>("/api/auth/signout", {
          method: "POST",
          token,
        });
      } catch {
        // Proceed with logout even if signout API call fails
      }
    }
    setStoredToken(null);
  },

  /**
   * Check if user is authenticated
   */
  isAuthenticated(): boolean {
    return !!getStoredToken();
  },

  /**
   * Clear authentication (for manual logout)
   */
  clearAuth(): void {
    setStoredToken(null);
  },
};
