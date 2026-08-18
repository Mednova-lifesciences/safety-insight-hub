/**
 * Authentication API service
 * Handles signup and signin with the FastAPI backend using real authentication
 */

import { apiRequest } from "./client";

export interface SignupRequest {
  email: string;
  password: string;
  name: string;
  organization_name?: string;
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
    organization_id: string;
    role: "ADMIN" | "MANAGER" | "COORDINATOR" | "FIELD_ASSOCIATE";
    created_at: string;
  };
  organization: {
    id: string;
    name: string;
  };
}

export const auth = {
  /**
   * Sign up with email and password
   * Creates a new organization for the first user (ADMIN role)
   */
  async signup(request: SignupRequest): Promise<AuthResponse> {
    return apiRequest<AuthResponse>("/api/auth/signup", {
      method: "POST",
      body: request,
    });
  },

  /**
   * Sign in with email and password
   * Returns JWT token and user profile
   */
  async signin(request: SigninRequest): Promise<AuthResponse> {
    return apiRequest<AuthResponse>("/api/auth/signin", {
      method: "POST",
      body: request,
    });
  },

  /**
   * Get current user profile (requires valid JWT token)
   */
  async getCurrentUser(token: string): Promise<AuthResponse["profile"]> {
    return apiRequest<AuthResponse["profile"]>("/api/auth/me", {
      method: "GET",
    }, token);
  },

  /**
   * Sign out (optional - mainly for frontend cleanup)
   */
  async signout(token: string): Promise<void> {
    return apiRequest<void>("/api/auth/signout", {
      method: "POST",
    }, token);
  },
};
