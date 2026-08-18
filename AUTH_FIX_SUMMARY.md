# 401 Authorization Fix - Complete Implementation

## Problem

After Render deployment, all protected API endpoints returned `401 Unauthorized` even after successful login.

### Root Cause Analysis

1. **Backend** enforced `HTTPBearer` authentication:
   - All protected routes required `Authorization: Bearer <jwt>` header
   - Verified tokens via Supabase identity service

2. **Frontend** sent credentials incorrectly:
   - Used `credentials: "include"` (sends cookies only)
   - Did NOT include `Authorization` header
   - Mismatch: Backend wanted Bearer token, Frontend sent cookies

3. **Missing endpoints** in backend:
   - Frontend called `GET /api/auth/me` to restore session
   - Backend only had `/signup` and `/signin`
   - No way to verify tokens or get user profile

## Solution Architecture

### Frontend Authentication Flow

```
User Login
    ↓
1. Form submits email + password
    ↓
2. Frontend calls POST /api/auth/signin
    ↓
3. Backend validates with Supabase, returns JWT
    ↓
4. Frontend stores JWT in localStorage
    ↓
5. All subsequent requests include Bearer token:
   fetch(..., {
     headers: {
       Authorization: "Bearer <jwt_token>"
     }
   })
    ↓
6. Backend validates Bearer token for each request
    ↓
7. Backend returns protected resource (200 OK)
```

## Implementation Details

### 1. Frontend Changes

#### `src/services/api/client.ts`

- **Added token storage**:
  - `getStoredToken()` - retrieves JWT from localStorage
  - `setStoredToken()` - stores JWT in localStorage
- **Modified `apiRequest()` function**:
  - Accepts optional `token` parameter
  - Falls back to localStorage if token not provided
  - Injects `Authorization: Bearer <token>` header
  - All API calls automatically include Bearer token

#### `src/services/api/auth.ts`

- **Updated response handling**:
  - `signin()` now stores token after successful login
  - `signup()` stores token for new accounts
  - `getCurrentUser()` uses stored token automatically
  - `signout()` clears token and calls backend signout
  - Added `isAuthenticated()` helper

#### `src/lib/auth.tsx` (AuthProvider)

- **Real backend integration**:
  - Checks `isApiConfigured()` to detect backend availability
  - Calls real auth API when backend is available
  - Falls back to mock auth for local development
- **Session restoration**:
  - On app load, checks for stored JWT token
  - Automatically restores user session
  - No need to re-login after page refresh
- **Updated auth flow**:
  - `signIn()` now takes email + password (not email + role)
  - Backend determines user role from identity service
  - Mock mode still allows role selection for testing

#### `src/routes/index.tsx` (Login Page)

- **Captures password input**:
  - Password field now has value state
  - Password sent to `signIn()` function
- **Conditional UI**:
  - Role selector shown only in mock mode (no backend)
  - Hidden when backend is configured
  - Error messages display auth failures
- **Proper error handling**:
  - Catch and display auth errors
  - Disable submit button during request

### 2. Backend Changes

#### `src/server/routes/auth.py`

- **Added missing endpoints**:

  ```
  POST   /api/auth/signup    - Create new user
  POST   /api/auth/signin    - Login with email/password
  GET    /api/auth/me        - Get current user profile (requires Bearer token)
  POST   /api/auth/signout   - Sign out (optional)
  ```

- **Fixed response structures**:
  - `signin()` returns full `AuthResponse` with:
    - `access_token` - JWT for Bearer auth
    - `refresh_token` - Optional, for token refresh
    - `user` - User identity from Supabase
    - `profile` - User role and organization
    - `organization` - Organization details

- **Added token verification**:
  - `GET /api/auth/me` validates Bearer token
  - Uses HTTPBearer security scheme
  - Returns user profile if token valid
  - Returns 401 if token invalid or expired

- **Security improvements**:
  - Uses `HTTPBearer()` dependency
  - Validates tokens with Supabase
  - Proper error handling and logging

## Deployment Checklist

### Before Deployment

- [x] All code committed to GitHub
- [x] No TypeScript errors
- [x] render.yaml configured with `cd src && python -m uvicorn ...`
- [x] .python-version pinned to 3.13.5
- [x] requirements.txt includes all dependencies
- [x] SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY set as Render environment variables

### Deployment Steps

1. **Code pushed to GitHub** ✓
   - Commits: 99124b9, 1e0279a, a08eb79, 1c79f0d
   - Latest main branch ready

2. **Render triggers redeploy** (automatic on push)
   - Builds Docker image
   - Installs dependencies
   - Runs `cd src && python -m uvicorn server.main:app`
   - Starts health check

3. **Frontend builds automatically**
   - Vite reads VITE_PV_API_BASE_URL
   - Compiles TypeScript/React
   - Bundles JavaScript

### Post-Deployment Verification

#### Check Backend

```bash
# 1. Health check
curl https://backend-url/health
# Expected: {"status":"ok","timestamp":"..."}

# 2. Test signin endpoint
curl -X POST https://backend-url/api/auth/signin \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password"}'
# Expected: {"access_token":"eyJ...","user":{...},"profile":{...}}

# 3. Test /me endpoint with token
TOKEN="eyJ..."  # from signin response
curl https://backend-url/api/auth/me \
  -H "Authorization: Bearer $TOKEN"
# Expected: {"user_id":"...","email":"...","role":"..."}
```

#### Check Frontend

```javascript
// In browser console
// 1. Check backend is configured
console.log(isApiConfigured()); // true if VITE_PV_API_BASE_URL set

// 2. Check token storage
console.log(localStorage.getItem("auth_token")); // JWT after login

// 3. Check Authorization header
// Open DevTools → Network tab → Login → Check request headers
// Should show: Authorization: Bearer eyJ...
```

## Testing Plan

### Manual Testing

1. **Login Flow**
   - Navigate to app
   - Enter valid Supabase credentials
   - Click Sign In
   - Expected: Redirect to dashboard (no 401)

2. **API Calls**
   - In dashboard, interact with any feature
   - Open DevTools → Network
   - Check Authorization header is sent
   - Check responses are 200 (not 401)

3. **Session Persistence**
   - Login successfully
   - Refresh page (F5)
   - Expected: Stay logged in
   - API calls continue to work

4. **Logout**
   - Click Sign Out
   - Expected: Redirect to login
   - localStorage cleared
   - Going back to dashboard: redirected to login

### Automated Testing (if available)

```bash
# Backend auth tests
python -m pytest src/server/routes/test_auth.py -v

# Frontend auth tests
npm test -- auth
```

## Troubleshooting Guide

### Still Getting 401?

1. **Check backend is running**

   ```bash
   # SSH into Render instance
   # Check if uvicorn is running
   ps aux | grep uvicorn
   # Check logs
   tail -f render-build.log
   ```

2. **Verify token is stored**

   ```javascript
   localStorage.getItem("auth_token"); // Should have JWT
   ```

3. **Check Authorization header**
   - DevTools → Network tab
   - Click any API request after login
   - Headers section should show:
     ```
     Authorization: Bearer eyJhbGciOiJIUzI1NiI...
     ```

4. **Test backend auth directly**

   ```bash
   # Test signin
   curl -X POST https://backend/api/auth/signin \
     -H "Content-Type: application/json" \
     -d '{"email":"user@example.com","password":"password"}'

   # If 401: Check Supabase credentials
   # If success: Get token and test /me
   TOKEN="<access_token_from_above>"
   curl https://backend/api/auth/me \
     -H "Authorization: Bearer $TOKEN"
   ```

5. **Check Supabase connection**
   - Verify SUPABASE_URL in env vars
   - Verify SUPABASE_SERVICE_ROLE_KEY in env vars
   - Test Supabase API directly
   ```bash
   curl -X POST "https://your-supabase.supabase.co/auth/v1/token?grant_type=password" \
     -H "apikey: YOUR_ANON_KEY" \
     -H "Content-Type: application/json" \
     -d '{"email":"user@example.com","password":"password"}'
   ```

### 401 on Backend but Token Seems Valid

1. Check token expiration
2. Check Supabase JWT secret
3. Verify token format (should start with `eyJ`)
4. Check backend logs for token validation errors

### localStorage not persisting

1. Check browser privacy settings
2. Check if running in incognito/private mode
3. Try clearing cache and retrying
4. Check browser console for storage quota errors

## Files Modified

### Frontend

- `src/services/api/client.ts` - Token storage and injection
- `src/services/api/auth.ts` - Auth service methods
- `src/lib/auth.tsx` - AuthProvider integration
- `src/routes/index.tsx` - Login form

### Backend

- `src/server/routes/auth.py` - Auth endpoints

### Configuration

- `render.yaml` - Already configured
- `.python-version` - Already created
- `requirements.txt` - Already created

### Documentation

- `AUTH_DEPLOYMENT_CHECKLIST.md` - Testing guide
- `AUTH_FIX_SUMMARY.md` - This file

## Key Commits

| Commit  | Description                                                           |
| ------- | --------------------------------------------------------------------- |
| 99124b9 | Fix frontend auth to send JWT bearer tokens                           |
| 1e0279a | Update login flow to capture password and integrate with backend auth |
| a08eb79 | Add auth deployment checklist and testing guide                       |
| 1c79f0d | Add missing auth endpoints and fix response structures                |

## Next Steps

1. **Render Deployment**
   - Push code to GitHub (already done)
   - Render auto-deploys on push
   - Monitor deployment logs

2. **Testing**
   - Follow manual testing plan above
   - Check all 401 errors are resolved
   - Verify session persistence works

3. **Production Considerations**
   - Monitor auth error rates
   - Set up auth-related alerts
   - Plan token refresh implementation
   - Consider httpOnly cookies for token storage

## Security Notes

### Current Implementation

- ✓ JWT tokens only sent to same backend
- ✓ HTTPS enforced on Render
- ✓ Token stored in localStorage (not httpOnly)
- ✓ Backend validates token with Supabase

### Potential Improvements

- Consider httpOnly cookies (reduces XSS risk)
- Implement token refresh logic
- Add token expiration handling
- Monitor for suspicious login patterns

## Support

For questions or issues:

1. Check browser DevTools → Console for errors
2. Check Render logs for backend errors
3. Review troubleshooting section above
4. Check GitHub commit history for implementation details
