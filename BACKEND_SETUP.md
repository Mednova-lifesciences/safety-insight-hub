# Backend Setup Guide

This guide walks you through setting up and running the MedNova PV-Assist FastAPI backend.

## Prerequisites

- Python 3.8+
- Supabase account with project created (https://supabase.com)
- PV-Assist Python library available at `~/Downloads/mednova-pv-assist/mednova-pv-assist/`

## Step 1: Install Backend Dependencies

```bash
# From the safety-insight-hub directory
pip install -r requirements-server.txt
```

This installs:
- **fastapi**: Web framework
- **uvicorn**: ASGI server
- **httpx**: Async HTTP client
- **pydantic**: Data validation
- **python-dotenv**: Environment configuration
- **pyjwt**: JWT token handling
- **cryptography**: Security library

## Step 2: Configure Environment

1. Copy `.env.server` to `.env` (or just update existing `.env`):
   ```bash
   cp .env.server .env
   ```

2. Get your Supabase credentials:
   - Go to https://app.supabase.com
   - Select your project
   - Settings → API → Copy URL and Service Role Key
   - Update `.env`:
     ```
     SUPABASE_URL=https://your-project.supabase.co
     SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
     ```

3. Verify frontend is configured:
   ```
   VITE_PV_API_BASE_URL=http://localhost:8000
   ```

## Step 3: Deploy Database Schema

The Supabase migration file is at `supabase/migrations/001_initial_schema.sql`

**Option A: Using Supabase CLI**
```bash
# If you have Supabase CLI installed
supabase db push
```

**Option B: Manual via Dashboard**
1. Go to https://app.supabase.com → Your Project
2. SQL Editor → New Query
3. Copy entire contents of `supabase/migrations/001_initial_schema.sql`
4. Paste and click "Run"

**What the migration creates:**
- `organizations` table - multi-tenant isolation
- `profiles` table - user roles and org membership
- `cases` table - ICSR (Individual Case Safety Report) data
- `seriousness_assessments` table - analysis results
- `coding_suggestions` table - MedDRA/WHODrug matches
- `audit_events` table - append-only event log
- Row-Level Security (RLS) policies - org data isolation
- Indexes - query performance

## Step 4: Start the Backend Server

```bash
# Option A: Using the provided startup script
python run_server.py

# Option B: Direct uvicorn
cd src
python -m uvicorn server.main:app --reload --host 0.0.0.0 --port 8000
```

Expected output:
```
Starting FastAPI server on 0.0.0.0:8000...
API will be available at http://localhost:8000
INFO:     Uvicorn running on http://0.0.0.0:8000 (Press CTRL+C to quit)
```

## Step 5: Verify Backend is Running

```bash
# In another terminal
curl http://localhost:8000/health

# Expected response:
{"status": "ok"}
```

## Step 6: Start Frontend

```bash
# In another terminal
npm run dev
# or
bun run dev
```

Frontend will be at http://localhost:5173

## Step 7: Test End-to-End Flow

1. **Sign Up**: Create account at http://localhost:5173/login
   - Email: `test@example.com`
   - Password: `SecurePassword123!`
   - First user gets ADMIN role automatically

2. **Dashboard**: Should see empty case list

3. **Create Case**: Click "New ICSR"
   - Fill in reporter, patient, product, reaction details
   - Click "Submit"

4. **Verify Persistence**: 
   - Check Supabase dashboard: SQL Editor → `SELECT * FROM cases;`
   - Case should appear in the list

5. **Test Seriousness Assessment**:
   - Open case detail
   - Click "Assess Seriousness"
   - Should call real PV-Assist algorithm

6. **Test Coding Suggestion**:
   - On case detail, click "Suggest Coding"
   - Should return MedDRA/WHODrug matches

## Troubleshooting

### 1. "Backend not configured" error in frontend
- Check `VITE_PV_API_BASE_URL` is set to `http://localhost:8000`
- Restart frontend dev server after changing env

### 2. JWT token validation failed
- Check `.env` has correct `SUPABASE_SERVICE_ROLE_KEY`
- Verify Supabase project is the same one frontend is configured for

### 3. Database schema not found
- Run Supabase migration (Step 3)
- Verify no SQL errors in Supabase dashboard

### 4. PV-Assist module not found
- Verify path: `~/Downloads/mednova-pv-assist/mednova-pv-assist/pv_assist/` exists
- Check Python path in `run_server.py`

### 5. CORS errors when frontend calls API
- Make sure backend is running
- Check `CORS_ORIGINS` in `.env` includes frontend URL

## API Documentation

When backend is running, browse to:
- http://localhost:8000/docs - Interactive Swagger UI
- http://localhost:8000/redoc - ReDoc documentation

## Key Routes

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/auth/signup` | Create account (first user = ADMIN) |
| POST | `/api/auth/signin` | Login with email/password |
| GET | `/api/auth/me` | Get current user profile |
| POST | `/api/auth/signout` | Logout |
| POST | `/api/cases` | Create new ICSR |
| GET | `/api/cases` | List org's cases |
| GET | `/api/cases/{id}` | Get case detail |
| POST | `/api/seriousness/analyze/{id}` | Assess seriousness |
| POST | `/api/coding/suggest/{id}` | Get coding suggestions |
| GET | `/api/audit` | View audit trail |

## Architecture

```
Frontend (React)
     ↓
API Client (fetch + Bearer token)
     ↓
FastAPI Backend (src/server/)
     ├── main.py (entry point, routes)
     ├── db.py (Supabase HTTP client)
     ├── dependencies.py (JWT auth)
     └── routes/
          ├── auth.py (signup/signin)
          ├── cases.py (ICSR CRUD)
          ├── seriousness.py (→ pv_assist)
          ├── coding.py (→ pv_assist)
          └── audit.py (audit trail)
     ↓
Supabase PostgreSQL + Auth + RLS
     ↓
PV-Assist Library (Python algorithms)
```

## Development Tips

1. **Auto-reload**: Both frontend and backend watch for file changes
2. **Database**: Check data via Supabase dashboard → SQL Editor
3. **Audit Trail**: Every case operation logged automatically
4. **RLS**: Database enforces org isolation; no client-side trust
5. **Tokens**: Stored in localStorage (httpOnly cookies in production)

## Next Steps

- [ ] Integrate additional PV-Assist features (linelist, PSUR, etc.)
- [ ] Add real user management (invite teams, multi-tenant invites)
- [ ] Implement file upload for CSV case batches
- [ ] Add WebSocket for real-time case updates
- [ ] Deploy to production (Vercel frontend + Cloud Run backend)
