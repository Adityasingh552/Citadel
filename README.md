# 🏰 Citadel

**AI-Powered Traffic Safety Analytics** — Detect accidents in real-time from live California traffic cameras, process uploaded footage, log events, and auto-generate violation tickets.

## Features

- **AI Detection** — Fine-tuned DETR model for accidents & vehicles with bounding-box evidence
- **Live Camera Monitoring** — Connect to 12 Caltrans CCTV districts (~thousands of cameras) with HLS video & snapshot support
- **Automated Ticketing** — Auto-generate violation tickets with an `issued → pending → resolved` workflow
- **Multi-Channel Alerts** — Automated notifications for severe accidents via Twilio (voice calls), Email, and Webhooks with configurable cooldowns
- **Interactive Map** — Leaflet-based map showing camera locations across all California districts
- **JWT Authentication** — Admin login with bcrypt + JWT
- **Dashboard** — Live monitoring, real-time activity feed, evidence gallery, and comprehensive statistics
- **Runtime Settings** — Adjust AI confidence thresholds and alert toggles on the fly

## Tech Stack

| Layer        | Technology                                |
|--------------|-------------------------------------------|
| **Frontend** | TypeScript, Vite, Vanilla CSS, Leaflet    |
| **Backend**  | Python 3.10+, FastAPI, Uvicorn            |
| **AI/ML**    | PyTorch (CPU), DETR, Timm, Transformers   |
| **Database** | SQLite + SQLAlchemy                       |
| **Vision**   | OpenCV, Pillow                            |
| **Auth**     | JWT (python-jose), bcrypt                 |
| **Cameras**  | Caltrans CCTV CSV feeds, 3-tier caching   |

## Quick Start

**Prerequisites:** Python 3.10+, Node.js 18+

```bash
# Clone
git clone https://github.com/Adityasingh552/Citadel.git && cd Citadel

# Backend
python -m venv venv && source venv/bin/activate
pip install -r backend/requirements.txt
cp backend/.env.example backend/.env
# Edit backend/.env — set ADMIN_USERNAME, ADMIN_PASSWORD, JWT_SECRET

# Frontend
cd frontend && npm install && cd ..
```

**Run** (two terminals):

```bash
# Terminal 1 — API
cd backend && uvicorn app.main:app --reload --port 8000

# Terminal 2 — UI
cd frontend && npm run dev
```

Frontend → `http://localhost:3000` · API → `http://localhost:8000` · Docs → `http://localhost:8000/docs`

> Model weights (~170 MB) are downloaded automatically on first startup.
> Caltrans camera data is cached locally and refreshed automatically.

## Recent Updates

**Latest updates:**

- **Pause & Resume Monitoring** — Temporarily pause individual camera analysis threads without losing state
- **Evidence Gallery & Activity Feed** — Dedicated UI views for browsing detection snapshots and tracking real-time events
- **Multi-Channel Emergency Alerts** — Automated notifications via Twilio (voice calls), Email, and Webhooks for severe accidents, featuring configurable cooldowns and dispatch tracking
- **Camera Stream Resilience** — HLS Proxy support, exponential backoff, and URL validation for robust ffmpeg stream capture

## Configuration

Environment variables in `backend/.env`:

| Variable               | Default                                    | Description                  |
|------------------------|--------------------------------------------|------------------------------|
| `DATABASE_URL`         | `sqlite:///./citadel.db`                   | Database connection string   |
| `MODEL_NAME`           | `gopesh353/traffic-accident-detection-detr` | Detection model identifier  |
| `CONFIDENCE_THRESHOLD` | `0.7`                                      | Min detection confidence     |
| `EVIDENCE_DIR`         | `./evidence`                               | Saved evidence directory     |
| `UPLOADS_DIR`          | `./uploads`                                | Uploaded files directory     |
| `DATA_DIR`             | `./data`                                   | Local cache for camera CSV data |
| `ADMIN_USERNAME`       | *(required)*                               | Admin login username         |
| `ADMIN_PASSWORD`       | *(required)*                               | Admin login password         |
| `JWT_SECRET`           | *(required)*                               | Secret key for JWT signing   |
| `JWT_EXPIRY_HOURS`     | `24`                                       | Token expiration (hours)     |

Runtime detection settings (confidence thresholds, alert toggles, etc.) can be changed live via the Settings API or dashboard — persisted in `backend/runtime_settings.json`.

## API

All endpoints except `/api/health` and `/api/auth/login` require `Authorization: Bearer <token>`.

### Core

| Method   | Endpoint                        | Description                          |
|----------|---------------------------------|--------------------------------------|
| `GET`    | `/api/health`                   | Health check                         |
| `POST`   | `/api/auth/login`              | Admin login → JWT                    |
| `GET`    | `/api/events`                  | List detection events                |
| `GET`    | `/api/events/feed`             | Real-time activity feed (SSE/polling)|
| `GET`    | `/api/events/evidence`         | Fetch evidence gallery               |
| `GET`    | `/api/tickets`                 | List tickets                         |
| `GET`    | `/api/tickets/{id}`            | Get a single ticket                  |
| `PATCH`  | `/api/tickets/{id}`            | Update ticket status                 |
| `GET`    | `/api/settings`                | Get runtime settings                 |
| `PUT`    | `/api/settings`                | Update runtime settings              |
| `DELETE` | `/api/settings/data`           | Delete all events, tickets & files   |
| `GET`    | `/api/stats`                   | Dashboard statistics                 |

### Detection

| Method   | Endpoint                         | Description                          |
|----------|----------------------------------|--------------------------------------|
| `POST`   | `/api/detect/video`             | Process a video file                 |
| `POST`   | `/api/detect/image`             | Analyze a single image               |
| `POST`   | `/api/detect/images`            | Batch analyze multiple images        |
| `GET`    | `/api/detect/progress/{job_id}` | Poll video processing progress       |

### Cameras

| Method   | Endpoint                                  | Description                                |
|----------|-------------------------------------------|--------------------------------------------|
| `GET`    | `/api/cameras/districts`                  | List available Caltrans districts           |
| `GET`    | `/api/cameras`                            | List cameras (filter by district, search)   |
| `GET`    | `/api/cameras/{camera_id}/info`           | Get full camera details                     |
| `GET`    | `/api/cameras/{camera_id}/snapshot`       | Fetch latest camera snapshot (proxied JPEG) |
| `GET`    | `/api/cameras/{camera_id}/snapshot-url`   | Get direct snapshot URL                     |
| `GET`    | `/api/cameras/{camera_id}/snapshot-changed` | Check if snapshot has changed (HEAD-based) |

### Monitoring

| Method   | Endpoint                                  | Description                                |
|----------|-------------------------------------------|--------------------------------------------|
| `POST`   | `/api/cameras/monitor/start`             | Start auto-monitoring a camera feed         |
| `POST`   | `/api/cameras/monitor/{camera_id}/pause` | Pause an active monitor             |
| `POST`   | `/api/cameras/monitor/{camera_id}/resume`| Resume a paused monitor             |
| `POST`   | `/api/cameras/monitor/{camera_id}/stop`  | Stop monitoring a specific camera           |
| `POST`   | `/api/cameras/monitor/stop`              | Stop all active monitoring sessions         |
| `GET`    | `/api/cameras/monitor/status`            | Get status for all monitors                 |
| `GET`    | `/api/cameras/monitor/{camera_id}/status`| Get monitoring status for a specific camera |

## How It Works

### Upload Detection

1. **Upload** → Video or image submitted via dashboard
2. **Detect** → Frames sampled → DETR model inference
3. **Classify** → Severity assigned (high ≥ 85%, medium ≥ 70%, low)
4. **Log** → Events persisted with bounding boxes + evidence frames
5. **Ticket** → Violation tickets auto-generated for accidents

### Live Camera Monitoring

1. **Discover** → Browse cameras across 12 California Caltrans districts via interactive map
2. **Monitor** → Start AI monitoring on selected cameras (one daemon thread per camera)
3. **Detect Changes** → HEAD-based ETag/Last-Modified checks skip unchanged snapshots
4. **Analyze** → New frames run through the DETR model with current runtime settings
5. **Alert** → Detections create Events and auto-generate Tickets for accidents
6. **Persist** → Active monitors survive restarts via database persistence

### Camera Caching

Camera metadata is cached in three tiers for performance and resilience:

| Tier | TTL | Description |
|------|-----|-------------|
| **In-memory** | 10 min | Fastest — per-district Python dict |
| **Local CSV** | 24 hours | Survives restarts — stored in `DATA_DIR` |
| **Caltrans HTTP** | On-demand | Fetches fresh CSV from Caltrans servers |

On failure, the system falls back through stale caches to maintain availability.

## Caltrans Districts

| ID | Name | ID | Name |
|----|------|----|------|
| 1 | Northwest | 7 | Los Angeles |
| 2 | Northeast | 8 | San Bernardino |
| 3 | Sacramento | 9 | Bishop |
| 4 | SF Bay Area | 10 | Stockton |
| 5 | Central Coast | 11 | San Diego |
| 6 | Fresno | 12 | Orange County |

## Testing

```bash
cd backend && pytest
```

## License

Educational and research purposes.
