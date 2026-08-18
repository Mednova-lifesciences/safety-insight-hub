# Connecting MedNova PV Assist to the Python backend

The frontend is a pure client of the existing `pv_assist` Python package. No
pharmacovigilance logic (seriousness rules, dictionary coding, line-list
normalisation, E2B generation, PSUR analysis) is implemented in TypeScript.

## 1. Configure the API base URL

Create `.env.local`:

```
VITE_PV_API_BASE_URL=http://localhost:8000
```

Without it, every screen shows either a "backend not connected" panel or the
clearly-labelled seeded demo dataset (toggle in the app header). Nothing is
fabricated as a real engine result.

## 2. Expose the endpoints from FastAPI

| Endpoint | Python module | Notes |
| --- | --- | --- |
| `GET/POST /api/cases`, `GET /api/cases/{id}`, `POST /api/cases/{id}/workflow` | case store | Workflow steps: INTAKE → TRIAGE → CODING → REVIEW → QC → REGULATORY_READY → CLOSED |
| `GET /api/cases/follow-ups`, `POST /api/cases/{id}/follow-ups` | case store | |
| `POST /api/seriousness/analyze/{caseId}`, `GET /api/seriousness/{caseId}`, `POST /api/seriousness/{caseId}/decision` | `pv_assist.seriousness` | Assistive only; must never mutate the official case value |
| `GET /api/coding/suggest/{caseId}`, `GET /api/coding/dictionary/search`, `POST /api/coding/{caseId}/accept|reject`, `GET /api/coding/{caseId}/history` | `pv_assist.coding` | Codes must come from the real MedDRA/WHODrug dictionaries; the LLM may only rank retrieved candidates |
| `POST /api/linelist/upload`, `GET /api/linelist/jobs`, `.../inspect`, `.../map`, `.../normalize`, `POST /api/linelist/validate/{jobId}`, `.../issues` | `pv_assist.linelist` | Return every row-level error and warning |
| `GET /api/e2b/readiness/{jobId}`, `POST /api/e2b/generate/{jobId}`, `GET /api/e2b/download/{artifactId}` | `pv_assist.linelist` / E2B writer | Preparation only — no regulatory transmission |
| `POST /api/psur/upload`, `GET /api/psur/documents`, `.../extract`, `POST /api/psur/review/{documentId}`, `.../assessment` | `pv_assist.psur` | Findings labelled as review assistance |
| `GET /api/signals`, `POST /api/signals/{id}/review`, `POST /api/signals/{id}/decision` | signal store | Confirm/refute requires a rationale |
| `GET/POST /api/audit` | `pv_assist.audit` | Append-only |
| `GET /api/intake/conversations`, `.../{id}`, `.../request-information`, `.../convert` | intake channel | Minimum ICSR criteria: reporter, patient, product, event |
| `GET /api/notifications`, `POST /api/notifications/{id}/read` | notification store | |

Response shapes are declared in `src/types/pv.ts`; call signatures live in
`src/services/api/*.ts`.

## 3. Security expectations

- Session cookies are sent with `credentials: "include"`. Issue httpOnly,
  `Secure`, `SameSite` cookies from FastAPI.
- No API keys, model credentials or dictionary licences may reach the client;
  keep them in the FastAPI environment.
- The role gates in `src/lib/auth.tsx` and `PermissionGate` protect the UI only.
  Re-check the caller's role in every endpoint.
- Do not return direct patient identifiers to list endpoints; the UI expects
  pseudonymised identifiers and masked contact details.
