# Citadel

AI-powered traffic safety analytics platform for accident detection from uploaded media and live DOT camera networks.

## What It Does

- Detects accidents from videos/images using a YOLO26 ONNX model.
- Monitors live Caltrans + Iowa DOT cameras (snapshot and HLS stream modes).
- Creates incident events and ticket workflow records (`issued -> pending -> resolved`).
- Stores evidence with a hybrid strategy: local-first + asynchronous Supabase Storage backfill.
- Dispatches alerts through Twilio, Email, Webhook, and Telegram with cooldown controls.
- Provides a TypeScript dashboard with overview stats, incidents, monitoring, cameras, and settings.

## Tech Stack

- Frontend: TypeScript, Vite, Vanilla CSS, Leaflet
- Backend: FastAPI, SQLAlchemy, Uvicorn
- Model runtime: ONNX Runtime + OpenCV + Pillow
- Database: Supabase Postgres
- Auth: Supabase Auth (email/password)
- Storage: Supabase Storage (`ticket-evidence`) with local evidence fallback

## Repository Layout

- `backend/` FastAPI app, services, model pipeline, and API routes
- `frontend/` Vite app and dashboard UI
- `weights/` optional local model artifacts

## Quick Start

Prerequisites:

- Python 3.10+
- Node.js 18+

Clone and install:

```bash
git clone https://github.com/gopesh353/Citadel.git
cd Citadel

python -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt

cd frontend
npm install
cd ..
```

Create env files:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

Run locally:

```bash
# Terminal 1
cd backend
uvicorn app.main:app --reload --port 8000

# Terminal 2
cd frontend
npm run dev
```

- Frontend: `http://localhost:3000`
- API: `http://localhost:8000`
- Swagger: `http://localhost:8000/docs`

## Environment Variables

Use `backend/.env.example` and `frontend/.env.example` as source of truth.

Backend required:

- `DATABASE_URL` - Supabase Postgres connection string
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY`

Backend common optional:

- `MODEL_PATH` (default `./models/model.onnx`)
- `MODEL_URL` (auto-download source)
- `EVIDENCE_DIR` (default `./evidence`)
- `UPLOADS_DIR` (default `./uploads`)
- `CITADEL_BASE_URL` (public URL used in notifications)
- `CAMERA_LIST_CACHE_TTL_HOURS` (default `24`)
- Twilio/Telegram notification credentials

Frontend:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_API_URL` (set for production, optional in local dev)

## Auth and Access Model

- Login endpoint: `POST /api/auth/login`
- Frontend stores Supabase access + refresh tokens and sends bearer token on API calls.
- Most API endpoints require auth via `get_current_admin` (Supabase token validation).
- Public health endpoint: `GET /api/health`

## Evidence Storage Behavior

Current behavior is intentionally resilient:

1. Detection writes evidence locally (`EVIDENCE_DIR`) first.
2. Backend enqueues async upload to Supabase Storage bucket `ticket-evidence`.
3. Event/ticket `evidence_path` is updated to the remote URL after successful upload.
4. Local evidence remains as fallback/back-compat and is served at `/evidence/...`.

This allows safe operation even if transient storage upload issues occur.

## API Summary

Core:

- `GET /api/health`
- `POST /api/auth/login`
- `GET /api/stats`
- `GET /api/stats/services`
- `GET /api/settings`
- `PUT /api/settings`
- `GET /api/settings/notifications`
- `PUT /api/settings/notifications`
- `DELETE /api/settings/data`

Detection:

- `POST /api/detect/video`
- `POST /api/detect/image`
- `POST /api/detect/images`
- `GET /api/detect/progress/{job_id}`

Incidents / Events / Tickets:

- `GET /api/incidents`
- `GET /api/incidents/{incident_id}`
- `PATCH /api/incidents/{incident_id}/status`
- `GET /api/incidents/stats/overview`
- `GET /api/events`
- `GET /api/events/{event_id}`
- `GET /api/tickets`
- `GET /api/tickets/{ticket_id}`
- `PATCH /api/tickets/{ticket_id}`

Alerts:

- `GET /api/alerts`
- `GET /api/alerts/stats`

Cameras and monitoring:

- `GET /api/cameras/districts`
- `GET /api/cameras` (supports `source=caltrans|iowa`, search, limit)
- `GET /api/cameras/{camera_id}/info`
- `GET /api/cameras/{camera_id}/snapshot`
- `GET /api/cameras/{camera_id}/snapshot-url`
- `GET /api/cameras/{camera_id}/snapshot-changed`
- `GET /api/cameras/{camera_id}/stream-info`
- `GET /api/cameras/hls-proxy/{path}`
- `GET /api/cameras/iowa-hls-proxy/{path}`
- `POST /api/cameras/monitor/start`
- `POST /api/cameras/monitor/{camera_id}/pause`
- `POST /api/cameras/monitor/{camera_id}/resume`
- `POST /api/cameras/monitor/{camera_id}/stop`
- `POST /api/cameras/monitor/stop`
- `GET /api/cameras/monitor/status`
- `GET /api/cameras/monitor/{camera_id}/status`

Iowa-specific compatibility routes:

- `GET /api/iowa/cameras`
- `GET /api/iowa/cameras/regions`
- `GET /api/iowa/cameras/{camera_id}/snapshot`
- `GET /api/iowa/cameras/{camera_id}/info`

## Testing

Backend tests:

```bash
cd backend
pytest
```

Frontend production build check:

```bash
cd frontend
npm run build
```

## Deployment Notes

- Frontend can be deployed on Vercel.
- Backend can be deployed on Render/Heroku-like services.
- Ensure backend dependency source includes `backend/requirements.txt` (contains Supabase Python client).

## License

Educational and research use.
