# Frontend Auth Deployment Checklist

## Problem Resolved
**401 Unauthorized on all protected API endpoints**

### Root Cause
- Backend requires `Authorization: Bearer <jwt>` header (HTTPBearer)
- Frontend was only sending `credentials: "include"` (cookies)
- No mechanism to pass JWT tokens from login to subsequent API calls

### Solution
Updated frontend auth flow to properly store and send JWT Bearer tokens:

## Files Modified (Commits: 99124b9, 1e0279a)

1. **src/services/api/client.ts**
   - Added `getStoredToken()` / `setStoredToken()` for localStorage persistence
   - Modified `apiRequest()` to inject `Authorization: Bearer <token>` header
   - Token flows: localStorage → apiRequest → all API calls

2. **src/services/api/auth.ts**
   - `signin()` now stores token with `setStoredToken(access_token)`
   - `signup()` stores token on successful account creation
   - `getCurrentUser()` auto-includes stored token
   - `signout()` clears stored token

3. **src/lib/auth.tsx** (AuthProvider)
   - Loads backend API when available (`isApiConfigured()`)
   - Restores session from stored JWT on app load
   - `signIn()` now takes email + password (backend determines role)
   - Mock auth still available for local dev (no backend)

4. **src/routes/index.tsx** (Login Page)
   - Captures password input field value
   - Passes email + password to `signIn()`
   - Role selector hidden when backend is configured
   - Shows errors from auth failures

## Deployment Flow

### When Deployed to Render
1. **Frontend loads** (index.html, JS bundles)
2. **App checks backend** via `isApiConfigured()` (checks VITE_PV_API_BASE_URL)
3. **If backend configured:**
   - Login form accepts email + password
   - `signIn()` calls `POST /api/auth/signin` with email + password
   - Backend returns `{ access_token, user, profile, organization }`
   - Frontend stores token: `localStorage.setItem("auth_token", access_token)`
4. **All subsequent API calls:**
   - `apiRequest()` retrieves token from localStorage
   - Injects header: `Authorization: Bearer <access_token>`
   - Backend validates token via Supabase
   - Returns user data or 401 if invalid

### When Backend Not Configured
- Mock auth enabled (for development)
- Password required but not validated
- Role selector shown (pick any role for testing)
- API calls fail gracefully with `ApiNotConfiguredError`

## Testing Post-Deployment

### 1. Verify Backend Is Running
```bash
# On Render dashboard, check:
- Service status: "Live" ✓
- Health check: GET /health → 200 OK
- Logs: No Python errors
```

### 2. Verify Frontend Can Reach Backend
```bash
# In browser console:
console.log(isApiConfigured())  // Should be true if VITE_PV_API_BASE_URL set
```

### 3. Test Login Flow
```
1. Navigate to app (https://safety-insight-hub.onrender.com)
2. Enter valid Supabase user email + password
3. Click "Sign in"
4. Expected: Redirects to dashboard (status: 200, not 401)
```

### 4. Verify Bearer Token Sent
```bash
# In browser DevTools → Network tab:
1. Perform any API call after login
2. Request headers should show:
   Authorization: Bearer eyJhbGciOiJIUzI1NiI...
```

### 5. Test Session Persistence
```
1. Log in successfully
2. Refresh page (F5)
3. Expected: Still logged in (token loaded from localStorage)
4. API calls still work (no 401)
```

### 6. Test Logout
```
1. Click "Sign out" button
2. Expected: localStorage cleared, redirected to login
3. Navigate back: Still on login page (not authenticated)
```

## Error Scenarios

### Still Getting 401?
1. **Check backend is running:**
   - `GET https://backend-url/health` returns 200
   
2. **Check token is stored:**
   - DevTools → Application → LocalStorage → `auth_token`
   - Should contain JWT (starts with `eyJ`)

3. **Check Authorization header:**
   - DevTools → Network → API request headers
   - Should have: `Authorization: Bearer <token>`

4. **Check backend auth endpoint:**
   - `GET /api/auth/me` with valid Bearer token
   - Backend should return user profile (not 401)

### Backend Returning 401 on /api/auth/signin
1. Check Supabase credentials in backend
2. Verify email + password are correct
3. Check backend logs for auth errors

## Browser Compatibility
- localStorage: Supported in all modern browsers
- Credentials: "include": Supported in all modern browsers
- Authorization header: Standard HTTP, all browsers

## Security Notes
- JWT stored in localStorage (vulnerable to XSS)
- In production: Consider httpOnly cookies (requires backend support)
- Current implementation: Acceptable for internal PV tool
- Token never logged or exposed in URLs

## Rollback
If issues occur:
1. Previous working version: commit b621abb
2. Has: deployment fixes (cd src && uvicorn)
3. Missing: Bearer token auth (will cause 401)
4. Recommendation: Keep current version, fix backend issues instead

## Post-Deployment Validation

- [ ] Backend health check passes
- [ ] Frontend VITE_PV_API_BASE_URL configured
- [ ] Login form accepts email + password
- [ ] Successful login redirects to dashboard
- [ ] API calls include Authorization header
- [ ] Session persists on page refresh
- [ ] Logout clears token
- [ ] 401 errors resolved
- [ ] No JavaScript errors in console

## Next Steps (If Issues Persist)
1. Check backend logs on Render for auth-related errors
2. Verify Supabase URL and service role key are correct
3. Test backend auth endpoint directly: `curl -H "Authorization: Bearer <token>" https://backend/api/auth/me`
4. Check if backend expects different auth format than HTTPBearer
