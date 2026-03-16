# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a custom fork of Frigate NVR with enhancements for:
- **File-once camera source type** for battery-powered cameras
- **Advanced face recognition UI** with debug capabilities
- **TensorRT GPU acceleration** for NVIDIA hardware
- Integration with external battery camera processor service

**Base Project:** Frigate - Complete local NVR with AI object detection for Home Assistant
**Main Branch:** `dev` (use for PRs)
**Production Deployment:** Docker Compose with custom TensorRT image

## Build and Development Commands

### Docker Image Building

```bash
# Build TensorRT-enabled image (primary method)
cd ~/frigate-custom
make local-trt

# Or manually with specific compute levels
ARCH=amd64 COMPUTE_LEVEL="50 60 70 80 90" docker buildx bake \
  --file=docker/tensorrt/trt.hcl \
  tensorrt \
  --set tensorrt.tags=frigate:latest-tensorrt \
  --load

# Build standard image (no TensorRT)
make local
```

### Deploying Changes

**CRITICAL:** After building a new image, always use `down` then `up`, NOT `restart`:

```bash
cd ~/frigate
docker compose down
docker compose up -d
```

The `restart` command does NOT recreate containers with new image layers.

### Frontend Development

```bash
cd web

# Start dev server with hot reload
npm run dev

# Lint and fix
npm run lint:fix

# Format code
npm run prettier:write

# Build for production
npm run build

# Run tests
npm test
```

### Backend Development

```bash
# Run Python tests (requires local image)
make run_tests

# This runs both:
# - unittest suite
# - mypy type checking
```

### Testing Single Camera or Feature

Access the running container:
```bash
docker exec -it frigate bash
```

Monitor specific camera logs:
```bash
docker logs -f frigate | grep "CameraName"
```

## Code Architecture

### Backend (Python)

**Process-Based Architecture:**
- Main `FrigateApp` (frigate/app.py) spawns multiple processes
- Each camera gets dedicated `CameraCapture` and `CameraTracker` processes
- Shared processes: ObjectDetect, EmbeddingProcess, RecordProcess, EventProcessor
- Communication via ZMQ, multiprocessing queues, and shared memory (`/dev/shm`)

**Key Backend Modules:**

| Path | Purpose |
|------|---------|
| `frigate/app.py` | Core application orchestration |
| `frigate/video.py` | FFmpeg capture, frame processing, camera watchdog |
| `frigate/api/` | FastAPI REST endpoints |
| `frigate/comms/dispatcher.py` | Central message hub for all IPC |
| `frigate/embeddings/` | Face recognition, semantic search, LPR embeddings |
| `frigate/data_processing/real_time/face.py` | Real-time face detection/recognition |
| `frigate/object_detection/` | Object detection orchestration |
| `frigate/track/` | Object tracking with Norfair |
| `frigate/config/` | YAML configuration parsing |
| `frigate/db/` | SQLite with vector extensions |

**Communication Patterns:**
- **ZMQ:** Frame and detection data between processes
- **MQTT:** Camera control (`frigate/{camera}/enabled/set`), status publishing
- **WebSocket:** Real-time frontend updates
- **REST API:** Frontend data access
- **Shared Memory:** Zero-copy frame buffers in `/dev/shm`

### Frontend (React/TypeScript)

**Tech Stack:**
- React 18 + TypeScript
- React Router for navigation
- SWR for data fetching and caching
- Tailwind CSS + shadcn/ui components
- Vite for bundling

**Key Frontend Paths:**

| Path | Purpose |
|------|---------|
| `web/src/App.tsx` | Root routing and layout |
| `web/src/pages/` | Page-level views (lazy loaded) |
| `web/src/components/overlay/detail/` | Event detail dialogs, face recognition UI |
| `web/src/views/` | Page-specific view logic |
| `web/src/api/` | API client utilities |
| `web/src/hooks/` | Custom React hooks |
| `web/public/locales/` | i18n translation files |

**Component Organization:**
- Pages are lazy-loaded via React Router
- Reusable components in `components/`
- Feature-specific components colocated with views

### Custom Modifications in This Fork

#### 1. File-Once Camera Source Type

Allows battery cameras to upload video files that play once instead of looping:

**Backend Changes:**
- `frigate/config/camera/ffmpeg.py` - Added `SourceTypeEnum` with `file_once` type
- `frigate/ffmpeg_presets.py` - Added `preset-file-once` (no `-stream_loop -1`)
- `frigate/video.py` - Modified `CameraWatchdog` to handle file end gracefully

**Config Example:**
```yaml
cameras:
  Argus4ProEntrance:
    ffmpeg:
      inputs:
        - path: /media/frigate/battery-cam/current.mp4
          input_args: preset-file-once
          source_type: file_once
          roles: [detect, record]
```

#### 2. Face Recognition UI Enhancements

Advanced face management directly from event details:

**New Components:**
- `web/src/components/overlay/detail/FaceRecognitionTab.tsx` - User-friendly face tagging interface
- `web/src/components/overlay/detail/FaceDebugTab.tsx` - Technical debug information

**Modified Components:**
- `web/src/components/overlay/detail/SearchDetailDialog.tsx` - Added face tabs
- `web/src/views/events/EventView.tsx` - Added face recognition icon

**Backend Integration:**
- `frigate/api/classification.py` - Face recognition API endpoints
- `frigate/data_processing/real_time/face.py` - Face detection/recognition pipeline

## Critical Development Practices

### Frontend String Management

**NEVER write strings directly in frontend code.** Always use translation files:

```typescript
// ❌ WRONG
<button>Save Face</button>

// ✅ CORRECT
import { useTranslation } from "react-i18next";
const { t } = useTranslation();
<button>{t("face_save")}</button>
```

Translation files are in `web/public/locales/{lang}/` organized by feature.

### Git Workflow

```bash
# Check status
git status

# Stage specific files (be selective)
git add frigate/video.py web/src/components/NewComponent.tsx

# Commit with descriptive message
git commit -m "Add file-once support for battery cameras

- Added SourceTypeEnum to ffmpeg.py
- Modified CameraWatchdog to handle file end gracefully
- Added preset-file-once to ffmpeg_presets.py"

# Push to feature branch
git push origin codex/your-feature-branch
```

**When ready for PR:** Always target the `dev` branch, not `main`.

### Shared Memory Configuration

With 8 cameras, shared memory usage is critical. Monitor with:

```bash
docker exec frigate df -h | grep shm
```

Current allocation: `1gb` in docker-compose.yml. Increase if usage >90%.

### Configuration Hot Reload

Some config changes can be applied via MQTT without restart:

```bash
# Disable camera temporarily
mosquitto_pub -h localhost -t "frigate/CameraName/enabled/set" -m "OFF"

# Re-enable camera
mosquitto_pub -h localhost -t "frigate/CameraName/enabled/set" -m "ON"
```

## Embeddings and Face Recognition System

### Architecture

Three-tier system for real-time processing:

1. **EmbeddingsContext** - Front-facing API
2. **EmbeddingMaintainer** - Thread managing data processors
3. **Data Processors:**
   - `FaceRealTimeProcessor` - Live face detection/recognition
   - `CustomClassificationProcessor` - Custom models
   - `LicensePlateRealTimeProcessor` - LPR
   - Post-processors - Audio transcription, semantic triggers

### Face Recognition Pipeline

```
Person Detected in Frame
    ↓
FaceRealTimeProcessor.detect_recognize_faces()
    ↓
Extract face embeddings (FaceNet or ArcFace)
    ↓
Compare against trained face database (SQLite-vec)
    ↓
Assign sub_label with confidence score
    ↓
Unknown faces → save to /media/frigate/clips/faces/train/
    ↓
User tags face via FaceRecognitionTab
    ↓
Move to /media/frigate/clips/faces/{personName}/
    ↓
Retrain classifier
```

### Face Storage Structure

```
/media/frigate/clips/faces/
├── train/                           # Unclassified faces
│   └── {eventId}-{timestamp}-{score}.webp
└── {personName}/                    # Per-person training data
    └── {uuid}.webp
```

### Key Face Recognition Files

- `frigate/data_processing/real_time/face.py` - Core face processing logic
- `frigate/data_processing/common/face/model.py` - FaceNet/ArcFace models
- `frigate/api/classification.py` - Face API endpoints
- `web/src/components/overlay/detail/FaceRecognitionTab.tsx` - UI for tagging

## Database

SQLite with vector extensions (`sqlite-vec`) for embeddings:

**Key Tables:**
- `event` - Detected events
- `timeline` - Frame-by-frame object tracking
- `recordings` - Video recordings metadata
- `review_segment` - Review UI segments
- `vec_faces` - Face recognition embeddings
- `vec_thumbnails` - Event thumbnail vectors (semantic search)
- `vec_descriptions` - Description vectors (semantic search)

**Access Database:**
```bash
docker exec frigate sqlite3 /db/frigate.db

# Common queries
SELECT COUNT(*) FROM event WHERE camera='CameraName';
SELECT sub_label, COUNT(*) FROM event WHERE label='person' GROUP BY sub_label;
```

## External Services Integration

### Battery Camera Processor

Standalone Python service (not in this repo) at `~/battery-cam-processor/`:
- Monitors NAS for new battery camera videos
- Creates symlink at `~/frigate/media/battery-cam/current.mp4`
- Enables/disables camera via MQTT
- Managed by systemd: `battery-cam-processor.service`

**Restart after backend changes:**
```bash
sudo systemctl restart battery-cam-processor.service
sudo journalctl -u battery-cam-processor.service -f
```

### MQTT Broker

Mosquitto runs on host (not in container):
- Frigate connects to `172.17.0.1:1883` (Docker bridge IP)
- Used for camera control and status

**Monitor MQTT:**
```bash
mosquitto_sub -h localhost -t "frigate/#" -v
```

## Troubleshooting

### UI Changes Not Appearing

1. **Hard refresh browser:** Ctrl+Shift+R (or Cmd+Shift+R on Mac)
2. **Verify container recreated:** `docker inspect frigate --format "{{.Created}}"`
3. **Verify image timestamp:** `docker images frigate:latest-tensorrt --format "{{.CreatedAt}}"`
4. Container creation time must be AFTER image build time

### Camera Shows "Offline"

```bash
# Check FFmpeg logs
docker logs frigate | grep "CameraName"

# Check camera status
mosquitto_sub -h localhost -t "frigate/CameraName/status/#" -v

# For file-once cameras, check symlink
ls -la ~/frigate/media/battery-cam/current.mp4
```

### High Memory/CPU Usage

Check detector configuration - ensure using GPU:
```bash
docker exec frigate nvidia-smi
```

Verify detectors config uses `onnx` type with GPU support.

## Documentation References

- **System Documentation:** `SYSTEM_DOCUMENTATION.md` (deployment, services, paths)
- **Face Recognition Integration:** `docs/face_improvements/FACE_RECOGNITION_INTEGRATION.md`
- **Official Frigate Docs:** https://docs.frigate.video/
- **Upstream Repository:** https://github.com/blakeblackshear/frigate

## Skills

- **frigate-system-manager**: Use this skill for system-level operations including:
  - Managing Docker containers and images
  - Monitoring system services (battery-cam-processor, MQTT)
  - Database operations and queries
  - Log analysis and troubleshooting
  - NAS mount verification
  - GPU and system resource monitoring
