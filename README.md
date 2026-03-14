# 🏰 Citadel

**AI-Powered Traffic Safety Analytics** — Detect accidents in traffic footage, log events, and auto-generate violation tickets.

## Features

- **AI Detection** — Fine-tuned DETR model for accidents & vehicles
- **Video & Image Processing** — Frame-by-frame analysis with configurable sampling
- **Automated Ticketing** — Violation tickets with status workflow (`issued → pending → resolved`)
- **JWT Authentication** — Admin login with bcrypt + JWT
- **Dashboard** — Real-time stats, event history, upload with live progress
- **Runtime Settings** — Adjust thresholds and toggles on the fly

## Tech Stack

| Layer        | Technology                                |
|--------------|-------------------------------------------|
| **Frontend** | TypeScript, Vite, Vanilla CSS             |
| **Backend**  | Python 3.10+, FastAPI, Uvicorn            |
| **AI/ML**    | PyTorch (CPU), DETR, Timm, Transformers   |
| **Database** | SQLite + SQLAlchemy                       |
| **Vision**   | OpenCV, Pillow                            |
| **Auth**     | JWT (python-jose), bcrypt                 |

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

## Configuration

Environment variables in `backend/.env`:

| Variable               | Default                                    | Description                  |
|------------------------|--------------------------------------------|------------------------------|
| `DATABASE_URL`         | `sqlite:///./citadel.db`                   | Database connection string   |
| `MODEL_NAME`           | `gopesh353/traffic-accident-detection-detr` | Detection model identifier  |
| `CONFIDENCE_THRESHOLD` | `0.7`                                      | Min detection confidence     |
| `EVIDENCE_DIR`         | `./evidence`                               | Saved evidence directory     |
| `UPLOADS_DIR`          | `./uploads`                                | Uploaded files directory     |
| `ADMIN_USERNAME`       | *(required)*                               | Admin login username         |
| `ADMIN_PASSWORD`       | *(required)*                               | Admin login password         |
| `JWT_SECRET`           | *(required)*                               | Secret key for JWT signing   |
| `JWT_EXPIRY_HOURS`     | `24`                                       | Token expiration (hours)     |

Runtime detection settings (confidence, toggles, frame interval) can be changed live via the Settings API or dashboard — persisted in `backend/runtime_settings.json`.

## API

All endpoints except `/api/health` and `/api/auth/login` require `Authorization: Bearer <token>`.

| Method   | Endpoint                        | Description                          |
|----------|---------------------------------|--------------------------------------|
| `GET`    | `/api/health`                   | Health check                         |
| `POST`   | `/api/auth/login`              | Admin login → JWT                    |
| `POST`   | `/api/detect/video`            | Process a video file                 |
| `POST`   | `/api/detect/image`            | Analyze a single image               |
| `POST`   | `/api/detect/images`           | Batch analyze multiple images        |
| `GET`    | `/api/detect/progress/{job_id}`| Poll video processing progress       |
| `GET`    | `/api/events`                  | List detection events                |
| `GET`    | `/api/tickets`                 | List tickets                         |
| `GET`    | `/api/tickets/{id}`            | Get a single ticket                  |
| `PATCH`  | `/api/tickets/{id}`            | Update ticket status                 |
| `GET`    | `/api/settings`                | Get runtime settings                 |
| `PUT`    | `/api/settings`                | Update runtime settings              |
| `DELETE` | `/api/settings/data`           | Delete all events, tickets & files   |
| `GET`    | `/api/stats`                   | Dashboard statistics                 |

## How It Works

1. **Upload** → Video or image submitted via dashboard
2. **Detect** → Frames sampled → DETR model inference
3. **Classify** → Severity assigned (high ≥ 85%, medium ≥ 70%, low)
4. **Log** → Events persisted with bounding boxes + evidence frames
5. **Ticket** → Violation tickets auto-generated for accidents

## Testing

```bash
cd backend && pytest
```

## License

Educational and research purposes.
