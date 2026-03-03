# 🏰 Citadel

**AI-Powered Traffic Safety Analytics** — Detect accidents in traffic footage, log events, and auto-generate violation tickets.

## Features

- **AI Detection** — Fine-tuned DETR model identifies accidents & vehicles in traffic scenes
- **Video & Image Processing** — Frame-by-frame analysis with configurable sampling and deduplication
- **Event Logging** — Timestamped events with severity classification and evidence capture
- **Automated Ticketing** — Violation tickets linked to detection events
- **Dashboard** — Real-time stats, event history, and file upload
- **Runtime Settings** — Adjust confidence thresholds, detection toggles, and frame intervals on the fly

## Tech Stack

| Layer        | Technology                                |
|--------------|-------------------------------------------|
| **Frontend** | TypeScript, Vite, Vanilla CSS             |
| **Backend**  | Python 3.10+, FastAPI, Uvicorn            |
| **AI/ML**    | PyTorch, DETR, Timm                       |
| **Database** | SQLite + SQLAlchemy                       |
| **Vision**   | OpenCV, Pillow                            |

## Quick Start

**Prerequisites:** Python 3.10+, Node.js 18+, CUDA (optional)

```bash
# Clone
git clone https://github.com/your-username/Citadel.git && cd Citadel

# Backend
python -m venv .venv && source .venv/bin/activate
pip install -r backend/requirements.txt
cp backend/.env.example backend/.env

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

Frontend → `http://localhost:3000` · API → `http://localhost:8000` · Swagger → `http://localhost:8000/docs`

> On first startup, model weights (~170 MB) are downloaded and cached automatically.

## Configuration

Environment variables in `backend/.env`:

| Variable               | Default                                    | Description                       |
|------------------------|--------------------------------------------|-----------------------------------|
| `DATABASE_URL`         | `sqlite:///./citadel.db`                   | Database connection string        |
| `MODEL_NAME`           | `gopesh353/traffic-accident-detection-detr` | Detection model identifier        |
| `CONFIDENCE_THRESHOLD` | `0.7`                                      | Min confidence for detections     |
| `EVIDENCE_DIR`         | `./evidence`                               | Saved evidence frames directory   |
| `UPLOADS_DIR`          | `./uploads`                                | Uploaded files directory          |

## API

| Method | Endpoint            | Description                       |
|--------|---------------------|-----------------------------------|
| `GET`  | `/api/health`       | Health check                      |
| `POST` | `/api/detect/video` | Process a video file              |
| `POST` | `/api/detect/image` | Analyze a single image            |
| `GET`  | `/api/events`       | List detection events             |
| `GET`  | `/api/tickets`      | List generated tickets            |
| `GET`  | `/api/stats`        | Dashboard statistics              |
| `GET`  | `/api/settings`     | Get runtime settings              |
| `PUT`  | `/api/settings`     | Update runtime settings           |

## How It Works

1. **Upload** → Video or image submitted via dashboard
2. **Detect** → Frames sampled at intervals → DETR model inference
3. **Classify** → Severity assigned (high ≥85%, medium ≥70%, low)
4. **Log** → Events persisted with bounding boxes + evidence frames saved as JPEG
5. **Ticket** → Violation tickets auto-generated and linked to events

## Testing

```bash
cd backend && pytest
```

## License

Educational and research purposes.
