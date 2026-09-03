/**
 * Authentication API service
 * Handles signup and signin with the FastAPI backend using real authentication
 */

import { apiRequest, setStoredToken, getStoredToken } from "./client";

export interface SignupRequest {
  email: string;
  password: string;
  name: string;
  mode: "CREATE_ORG" | "JOIN_ORG";
  organization_name?: string;
  org_code?: string;
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
    role: "ADMIN" | "PV_MANAGER" | "PV_COORDINATOR" | "MANAGER" | "COORDINATOR" | "FIELD_ASSOCIATE";
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
   * Creates a new organization for the first user (ADMIN role)
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
   * Get current user profile (uses stored token automatically)
   */
  async getCurrentUser(): Promise<AuthResponse["profile"] | null> {
    try {
      const token = getStoredToken();
      if (!token) return null;
      return await apiRequest<AuthResponse["profile"]>("/api/auth/me", {
        method: "GET",
        token,
      });
    } catch {
      return null;
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
