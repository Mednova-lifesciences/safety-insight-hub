# SafetyCore Deployment: Git Submodule Setup

## Problem

SafetyCore's FastAPI backend depends on the `mednova-pv-assist` Python package. Locally, the backend finds it in `~/Downloads/mednova-pv-assist`. **This will NOT exist when Render clones SafetyCore.**

## Solution

Use Git submodules to include mednova-pv-assist as part of the SafetyCore repository.

---

## Prerequisites

✅ mednova-pv-assist is already initialized as a git repository locally:
```
c:/Users/DELL/Downloads/mednova-pv-assist/.git (initialized)
```

✅ SafetyCore backend is already configured to find pv_assist via flexible path resolution:
- `src/server/main.py` - main canonical backend
- `backend/app.py` - legacy backend (optional)

Both will search for pv_assist in:
1. `mednova-pv-assist/mednova-pv-assist/` (submodule at repo root) ← **for deployment**
2. `~/Downloads/mednova-pv-assist/mednova-pv-assist/` (local dev) ← **for development**

---

## GitHub Setup (Required for Render)

### Step 1: Create a Private GitHub Repository for mednova-pv-assist

**On GitHub.com:**
1. Click "New Repository"
2. Name: `mednova-pv-assist`
3. **Set to PRIVATE** (you do not want to publish proprietary PV logic)
4. Initialize empty (no README, .gitignore, or license)

Get the repo URL: `https://github.com/YOUR_USERNAME/mednova-pv-assist.git`

### Step 2: Push mednova-pv-assist to GitHub

```bash
cd c:\Users\DELL\Downloads\mednova-pv-assist

# Add GitHub as remote
git remote add origin https://github.com/YOUR_USERNAME/mednova-pv-assist.git

# Push to GitHub (replace with your remote)
git branch -M main
git push -u origin main
```

**Verify:**
```bash
git remote -v
# Should show:
# origin  https://github.com/YOUR_USERNAME/mednova-pv-assist.git (fetch)
# origin  https://github.com/YOUR_USERNAME/mednova-pv-assist.git (push)
```

---

## SafetyCore Setup (Local)

### Step 1: Add mednova-pv-assist as Git Submodule

```bash
cd c:\Users\DELL\safety-insight-hub

# Add the submodule pointing to GitHub
git submodule add https://github.com/YOUR_USERNAME/mednova-pv-assist.git mednova-pv-assist

# Verify .gitmodules was created
git status
# Should show:
# new file:   .gitmodules
# new file:   mednova-pv-assist (with @ commit hash)
```

### Step 2: Commit the Submodule

```bash
git add .gitmodules mednova-pv-assist
git commit -m "Add mednova-pv-assist as git submodule"
git push origin main
```

### Step 3: Verify Locally

```bash
cd mednova-pv-assist
pwd  # Should show: c:/Users/DELL/safety-insight-hub/mednova-pv-assist

# Check pv_assist is present
ls mednova-pv-assist/pv_assist/
# Should list: audit.py, coding/, linelist/, psur/, seriousness/, etc.

cd ..
```

### Step 4: Test Backend Import

```bash
# From repo root
python -c "import sys; sys.path.insert(0, 'src'); from server.main import app; print('✓ Imports work')"
# Should output: ✓ Imports work
```

---

## Render Deployment Configuration

When deploying SafetyCore to Render, configure it to clone submodules:

### Option A: Via Render Dashboard

1. Go to your SafetyCore service on Render
2. Settings → Environment
3. Add environment variable: `RENDER_GIT_REPO=true` (Render default)
4. Deploy → Build & Deploy command should include:
   ```bash
   git submodule update --init --recursive && pip install -r backend/requirements.txt && cd src && python -m uvicorn server.main:app --host 0.0.0.0 --port $PORT
   ```

### Option B: Via render.yaml (Recommended)

Create `render.yaml` at repo root:

```yaml
services:
  - type: web
    name: safetycore-backend
    env: python
    plan: standard
    pythonVersion: 3.11
    buildCommand: >
      git submodule update --init --recursive &&
      pip install -r backend/requirements.txt
    startCommand: cd src && python -m uvicorn server.main:app --host 0.0.0.0 --port $PORT
    envVars:
      - key: SUPABASE_URL
        sync: false
      - key: SUPABASE_SERVICE_ROLE_KEY
        sync: false
      - key: JWT_SECRET
        sync: false
      - key: CORS_ORIGINS
        value: https://yourdomain.vercel.app
```

---

## GitHub Credentials for Render (Private Submodule)

Since mednova-pv-assist is a **private repository**, Render needs credentials to clone it.

### Option A: Deploy Key (Recommended)

1. **On your local machine**, generate an SSH key (if you don't have one):
   ```bash
   ssh-keygen -t ed25519 -C "safetycore-deploy@render.local" -N "" -f deploy-key
   ```

2. **Add SSH key to mednova-pv-assist repo on GitHub:**
   - Go to `github.com/YOUR_USERNAME/mednova-pv-assist/settings/keys`
   - Click "Add deploy key"
   - Paste the public key (`deploy-key.pub` contents)
   - Check "Allow write access"

3. **Add private key to Render:**
   - Render dashboard → Service settings → Environment
   - Add secret: `GIT_SSH_KEY` = contents of `deploy-key` (private key)
   - Add: `GIT_KNOWN_HOSTS` = (let Render auto-populate)

### Option B: HTTPS + GitHub Token

1. Create a Personal Access Token on GitHub with `repo` scope
2. In mednova-pv-assist `.gitmodules`, update the submodule URL:
   ```
   [submodule "mednova-pv-assist"]
       path = mednova-pv-assist
       url = https://YOUR_TOKEN@github.com/YOUR_USERNAME/mednova-pv-assist.git
   ```
3. Add token as `GITHUB_TOKEN` secret on Render (less secure than deploy key)

---

## Verification Checklist

- [ ] mednova-pv-assist is pushed to GitHub (private repo)
- [ ] SafetyCore has `.gitmodules` file pointing to mednova-pv-assist GitHub URL
- [ ] `git submodule status` shows mednova-pv-assist at the correct commit
- [ ] `ls mednova-pv-assist/mednova-pv-assist/pv_assist/` shows pv_assist modules
- [ ] Local backend imports work: `python -c "import sys; sys.path.insert(0, 'src'); from server.main import app"`
- [ ] Render build command includes `git submodule update --init --recursive`
- [ ] Render has access credentials (deploy key or token) for private mednova-pv-assist repo
- [ ] Backend starts on Render without "Could not locate mednova-pv-assist" error

---

## Troubleshooting

### Error: "Could not locate the mednova-pv-assist project directory"

**Local:**
- Ensure `mednova-pv-assist/mednova-pv-assist/pv_assist/` exists
- Run: `git submodule update --init --recursive`

**Render:**
- Check Render build logs for `git submodule update` success
- Verify deploy key or token has access to mednova-pv-assist repo
- Add `GIT_TERMINAL_PROMPT=0` to Render env to prevent hanging on auth prompts

### Error: "Permission denied" cloning submodule

- Verify deploy key is added to mednova-pv-assist repo (not SafetyCore repo)
- Verify deploy key has "Allow write access" checked
- For HTTPS token method, ensure token has `repo` scope

---

## Summary

| Aspect | Local Dev | Render Production |
|--------|-----------|---|
| mednova-pv-assist location | `~/Downloads/mednova-pv-assist/` or submodule | Git submodule (private GitHub repo) |
| Backend finds pv_assist via | Flexible path resolution (tries multiple locations) | Submodule at `mednova-pv-assist/` |
| Import statement | Same in both | `from pv_assist.coding.coder import ...` |
| No code changes needed? | ✅ Yes | ✅ Yes |

---

## Next Steps

1. Create `mednova-pv-assist` private repo on GitHub
2. Push local mednova-pv-assist to GitHub
3. Add as submodule to SafetyCore: `git submodule add https://github.com/YOUR_USERNAME/mednova-pv-assist.git mednova-pv-assist`
4. Commit and push: `git push origin main`
5. Set up deploy key on Render
6. Configure Render build to use `git submodule update --init --recursive`
7. Deploy and verify backend starts without errors
