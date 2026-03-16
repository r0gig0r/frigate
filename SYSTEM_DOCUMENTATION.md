# Frigate Custom Installation - System Documentation

**Last Updated:** 2025-12-10
**System:** Ubuntu Linux with NVIDIA GPU (TensorRT support)
**Maintainer:** rogigor

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Directory Structure](#directory-structure)
3. [Git Repository Information](#git-repository-information)
4. [Custom Modifications Summary](#custom-modifications-summary)
5. [Docker Image Build Process](#docker-image-build-process)
6. [Battery Camera Processor Service](#battery-camera-processor-service)
7. [Configuration Files](#configuration-files)
8. [Important Paths and Mounts](#important-paths-and-mounts)
9. [Maintenance and Operations](#maintenance-and-operations)
10. [Troubleshooting](#troubleshooting)

---

## System Overview

This is a custom Frigate NVR (Network Video Recorder) installation with the following key features:

- **Base:** Frigate NVR fork with custom face recognition and UI enhancements
- **Hardware Acceleration:** NVIDIA TensorRT for GPU-accelerated object detection
- **Custom Features:**
  - Enhanced face recognition UI with debug tab
  - File-once camera source type for battery-powered cameras
  - Battery camera processor service for automatic video ingestion
  - Face recognition tab in Tracked Object Details dialog
- **Deployment:** Docker Compose with custom-built image

### Hardware Requirements
- NVIDIA GPU with TensorRT support
- Sufficient RAM for 8+ camera streams
- NAS storage for video archive (mounted via SMB/CIFS)

---

## Directory Structure

```
~/
├── frigate/                              # Production Frigate deployment
│   ├── config/
│   │   └── config.yml                   # Main Frigate configuration
│   ├── media/                           # Frigate media storage
│   │   └── battery-cam/
│   │       └── current.mp4              # Symlink to current battery cam video
│   ├── docker-compose.yml               # Docker Compose configuration
│   └── frigate.db                       # Frigate SQLite database
│
├── frigate-custom/                      # Custom Frigate source code (Git repo)
│   ├── frigate/                         # Backend Python code
│   │   ├── api/
│   │   ├── config/
│   │   │   └── camera/
│   │   │       └── ffmpeg.py           # MODIFIED: Added SourceTypeEnum
│   │   ├── ffmpeg_presets.py           # MODIFIED: Added preset-file-once
│   │   ├── video.py                    # MODIFIED: File-once camera handling
│   │   └── ...
│   ├── web/                            # Frontend React code
│   │   ├── src/
│   │   │   ├── components/
│   │   │   │   └── overlay/detail/
│   │   │   │       ├── SearchDetailDialog.tsx  # MODIFIED: Added tabs
│   │   │   │       ├── FaceRecognitionTab.tsx  # NEW: Face recognition UI
│   │   │   │       └── FaceDebugTab.tsx        # NEW: Face debug UI
│   │   │   └── views/events/
│   │   │       └── EventView.tsx       # MODIFIED: Face recognition icon
│   │   └── ...
│   ├── docker/                         # Docker build configurations
│   │   └── tensorrt/
│   │       └── trt.hcl                 # TensorRT build config
│   ├── Makefile                        # Build commands
│   ├── SYSTEM_DOCUMENTATION.md         # This file
│   └── docs/face_improvements/
│       └── FACE_RECOGNITION_INTEGRATION.md
│
├── battery-cam-processor/              # Battery camera processor service
│   ├── process-battery-cam.py          # MODIFIED: Main processor script
│   ├── processed.db                    # SQLite DB of processed files
│   ├── battery-cam-processor.service   # Systemd service definition
│   └── SETUP.md
│
└── face-recognition/                   # Face recognition working directory
    └── double-take/                    # Additional face recognition tools
```

---

## Git Repository Information

### Repository Details

- **Remote URL:** https://github.com/r0gig0r/frigate.git
- **Working Branch:** `codex/create-detailed-documentation-for-person-detection-and-face`
- **Base Branch:** `dev`
- **Fork of:** https://github.com/blakeblackshear/frigate

### Current Branch Status

```bash
cd ~/frigate-custom
git status
```

**Modified Files (Not Committed):**
- `frigate/config/camera/ffmpeg.py` - Added SourceTypeEnum for file-once sources
- `frigate/ffmpeg_presets.py` - Added preset-file-once preset
- `frigate/video.py` - Modified CameraWatchdog to handle file-once sources
- `frigate/api/classification.py` - Face recognition API enhancements
- `frigate/comms/embeddings_updater.py` - Embeddings update handling
- `frigate/data_processing/real_time/face.py` - Face processing updates
- `frigate/embeddings/__init__.py` - Embeddings initialization
- `web/src/components/overlay/detail/SearchDetailDialog.tsx` - Added debug & face tabs
- `web/src/views/events/EventView.tsx` - Added face recognition icon
- `web/public/locales/en/views/explore.json` - Translations

**New Files (Untracked):**
- `docs/face_improvements/FACE_RECOGNITION_INTEGRATION.md` - Face recognition documentation
- `web/src/components/overlay/detail/FaceDebugTab.tsx` - Face debug tab component
- `web/src/components/overlay/detail/FaceRecognitionTab.tsx` - Face recognition tab component

### Recent Commits

```
118ad38c Add review face recognition entry point
df86c699 Add face tagging controls to recognition dialogs
c230d4c9 Add upgrade and rollback guide
```

---

## Custom Modifications Summary

### 1. File-Once Camera Source Type

**Purpose:** Support battery-powered cameras that upload video files to NAS, treating the end of the file as camera stop rather than looping.

**Files Modified:**

#### `~/frigate-custom/frigate/config/camera/ffmpeg.py`
- Added `SourceTypeEnum` class with `stream` and `file_once` values
- Added `source_type` field to `CameraInput` class (default: `SourceTypeEnum.stream`)

```python
class SourceTypeEnum(str, Enum):
    """Source type for camera input."""
    stream = "stream"       # Default: continuous stream (RTSP, RTMP, etc.)
    file_once = "file_once" # File-based source - stops when file ends
```

#### `~/frigate-custom/frigate/ffmpeg_presets.py`
- Added `preset-file-once` input preset without `-stream_loop -1` flag
- Uses `-re` flag to read at native frame rate

```python
"preset-file-once": [
    "-re",  # Read input at native frame rate
    "-avoid_negative_ts", "make_zero",
    "-fflags", "+genpts+discardcorrupt",
    "-use_wallclock_as_timestamps", "1",
],
```

#### `~/frigate-custom/frigate/video.py`
- Modified `CameraWatchdog.__init__()` to detect source type from detect input
- Modified `CameraWatchdog.run()` to handle file-once cameras:
  - When FFmpeg exits for file-once source, set status to "stopped" instead of "offline"
  - Log informational message instead of error
  - Don't attempt to restart capture thread
  - Keep watchdog alive waiting for camera re-enable

**Configuration Example:**
```yaml
cameras:
  Argus4ProEntrance:
    ffmpeg:
      inputs:
        - path: /media/frigate/battery-cam/current.mp4
          input_args: preset-file-once
          source_type: file_once
          roles:
            - detect
            - record
```

### 2. Face Recognition UI Enhancements

**Purpose:** Provide advanced face recognition debugging and management UI directly from tracked object details.

**New Components:**

#### `FaceDebugTab.tsx`
- Technical debug information for face detection/recognition
- Face bounding boxes with confidence scores
- Recognition thresholds and quality metrics
- Face embeddings visualization
- Located in: `~/frigate-custom/web/src/components/overlay/detail/`

#### `FaceRecognitionTab.tsx`
- User-friendly face tagging and management interface
- Snapshot with color-coded face boxes (green=matched, orange=potential, red=unknown)
- Extracted face thumbnails with tag/train actions
- Reprocess snapshot functionality
- Technical details panel
- Located in: `~/frigate-custom/web/src/components/overlay/detail/`

#### `SearchDetailDialog.tsx` Modifications
- Added "debug" and "face_recognition" tabs to SEARCH_TABS array
- Conditional tab rendering based on event attributes
- Tab switching logic

#### `EventView.tsx` Modifications
- Replaced large "Face recognition" button with small corner icon
- Icon positioned at bottom-right of preview thumbnail
- Click opens SearchDetailDialog with face_recognition tab pre-selected

### 3. Shared Memory Configuration

**File:** `~/frigate/docker-compose.yml`

Changed `shm_size` from `512mb` to `1gb` to accommodate 8 cameras.

```yaml
services:
  frigate:
    shm_size: "1gb"  # Increased from 512mb
```

**Rationale:** Frigate uses `/dev/shm` for inter-process communication. With 8 cameras (including 5120x1440 resolution Argus4ProEntrance), 554MB minimum was required. Set to 1GB for headroom.

---

## Docker Image Build Process

### Current Image

- **Image Name:** `frigate:latest-tensorrt`
- **Image ID:** `2087d424bcb5`
- **Size:** 13GB (3.94GB compressed)
- **Built:** 2025-12-10 10:23:19

### Build Command

```bash
cd ~/frigate-custom

# Build TensorRT-enabled image
ARCH=amd64 COMPUTE_LEVEL="50 60 70 80 90" docker buildx bake \
  --file=docker/tensorrt/trt.hcl \
  tensorrt \
  --set tensorrt.tags=frigate:latest-tensorrt \
  --load
```

**Build Parameters:**
- `ARCH=amd64` - Target architecture
- `COMPUTE_LEVEL="50 60 70 80 90"` - CUDA compute capabilities (supports Maxwell to Hopper GPUs)
- `--load` - Load image into local Docker daemon

**Alternative Build Methods:**

```bash
# Using Makefile (recommended)
cd ~/frigate-custom
make local-trt

# Clean build (no cache)
ARCH=amd64 COMPUTE_LEVEL="50 60 70 80 90" docker buildx bake \
  --file=docker/tensorrt/trt.hcl \
  tensorrt \
  --set tensorrt.tags=frigate:latest-tensorrt \
  --no-cache \
  --load
```

### Deploying New Image

After building a new image, restart the container:

```bash
cd ~/frigate
docker compose down
docker compose up -d
```

**IMPORTANT:** Use `docker compose down` followed by `docker compose up -d`, not `docker compose restart`. The `restart` command doesn't recreate containers with new image layers.

### Development Container

For development, there's also a devcontainer image:
- **Image:** `frigate-custom-devcontainer:latest`
- **Size:** 7.91GB

---

## Battery Camera Processor Service

### Overview

Autonomous service that monitors NAS for new battery camera videos and processes them through Frigate sequentially.

### Service Configuration

**Service File:** `/etc/systemd/system/battery-cam-processor.service`

```ini
[Unit]
Description=Battery Camera Video Processor for Frigate
After=network.target docker.service
Requires=docker.service

[Service]
Type=simple
User=rogigor
WorkingDirectory=~/battery-cam-processor
ExecStart=/usr/bin/python3 -u ~/battery-cam-processor/process-battery-cam.py
StandardOutput=journal
StandardError=journal
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

### Service Management

```bash
# Start service
sudo systemctl start battery-cam-processor.service

# Stop service
sudo systemctl stop battery-cam-processor.service

# Restart service (apply code changes)
sudo systemctl restart battery-cam-processor.service

# Check status
sudo systemctl status battery-cam-processor.service

# View logs
sudo journalctl -u battery-cam-processor.service -f

# Enable autostart
sudo systemctl enable battery-cam-processor.service
```

### Processor Script

**Location:** `~/battery-cam-processor/process-battery-cam.py`

**Key Features:**
- Monitors `/mnt/nas-reolink/ReoLink` for `Argus4ProEntrance_*.mp4` files
- SQLite database tracking (`processed.db`) prevents duplicate processing
- Symlink-based file handoff to Frigate (`~/frigate/media/battery-cam/current.mp4`)
- MQTT integration for camera enable/disable control
- FPS monitoring via Frigate stats for completion detection
- **Zero-byte file handling:** Files with 0 bytes older than 30 seconds are automatically marked as processed and skipped

**Recent Modification (2025-12-10):**

Added automatic zero-byte file handling to prevent infinite loop on corrupted files:

```python
# Check for zero-byte files that are older than 30 seconds
file_size = os.path.getsize(filepath)
if file_size == 0:
    file_age = time.time() - os.path.getmtime(filepath)
    if file_age > 30:
        print(f"  Zero-byte file older than 30s (age: {int(file_age)}s), marking as processed and skipping...")
        mark_processed(filepath, 0)
        return True
    else:
        print(f"  Zero-byte file is recent (age: {int(file_age)}s), waiting for upload to complete...")
        return False
```

### Database Schema

**File:** `~/battery-cam-processor/processed.db`

```sql
CREATE TABLE processed_files (
    filepath TEXT PRIMARY KEY,
    processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    file_size INTEGER,
    duration REAL
);
```

**Query Examples:**

```bash
# Count processed files
sqlite3 ~/battery-cam-processor/processed.db \
  "SELECT COUNT(*) FROM processed_files"

# Show recent files
sqlite3 ~/battery-cam-processor/processed.db \
  "SELECT filepath, processed_at FROM processed_files ORDER BY processed_at DESC LIMIT 10"

# Show file statistics
sqlite3 ~/battery-cam-processor/processed.db \
  "SELECT COUNT(*) as total, SUM(file_size)/1024/1024/1024 as total_gb, AVG(duration) as avg_duration FROM processed_files"
```

### Processing Workflow

1. **File Discovery:** Watchdog monitors NAS directory recursively
2. **Age Check:** Files must be older than 30 seconds (MIN_FILE_AGE)
3. **Zero-Byte Check:** Files with 0 bytes older than 30s are auto-skipped
4. **Stability Check:** Verifies file size doesn't change over 10 seconds
5. **Camera Disable:** Sends MQTT command to disable camera
6. **Symlink Creation:** Creates/updates symlink to current video
7. **Camera Enable:** Sends MQTT command to enable camera (starts processing)
8. **FPS Monitoring:** Monitors `frigate/stats` MQTT topic for camera FPS
9. **Completion Detection:** Three consecutive FPS=0 readings indicate completion
10. **Timeout Fallback:** Duration + 10s buffer as fallback
11. **Camera Disable:** Disables camera to prevent looping
12. **Database Update:** Marks file as processed with metadata

### Configuration Constants

```python
NAS_MOUNT = "/mnt/nas-reolink/ReoLink"
PROCESSING_DIR = "~/frigate/media/battery-cam"
CURRENT_VIDEO_LINK = f"{PROCESSING_DIR}/current.mp4"
DB_PATH = "~/battery-cam-processor/processed.db"
MIN_FILE_AGE = 30  # seconds
MQTT_HOST = "localhost"
MQTT_PORT = 1883
CAMERA_NAME = "Argus4ProEntrance"
STATS_CHECK_INTERVAL = 2  # seconds
```

---

## Configuration Files

### Frigate Main Configuration

**File:** `~/frigate/config/config.yml`

**Key Sections:**

#### MQTT Configuration
```yaml
mqtt:
  enabled: true
  host: 172.17.0.1  # Docker host IP to reach Mosquitto
```

#### Detectors
```yaml
detectors:
  onnx:
    type: onnx
```

#### Model Configuration
```yaml
model:
  model_type: yolo-generic
  width: 640
  height: 640
  input_tensor: nchw
  input_dtype: float
  path: /config/yolov9-s-640.onnx
  labelmap_path: /labelmap/coco-80.txt
```

#### GenAI Integration
```yaml
genai:
  provider: gemini
  api_key: AIzaSyAZD-DMM1r7frQucsqL1MgUSBw88lMZkv8
  model: gemini-flash-latest
```

#### Cameras (Example - Argus4ProEntrance)
```yaml
cameras:
  Argus4ProEntrance:
    enabled: true
    ffmpeg:
      inputs:
        - path: /media/frigate/battery-cam/current.mp4
          input_args: preset-file-once
          source_type: file_once
          roles:
            - detect
            - record
    detect:
      enabled: true
      width: 5120
      height: 1440
      fps: 15
    record:
      enabled: true
      continuous:
        days: 30
      motion:
        days: 0
    snapshots:
      enabled: true
      retain:
        default: 30
```

**Other Cameras:**
- Main_Entrance (720x1280)
- Garden_Overview (1280x720)
- Parking_Left (1280x720)
- Parking_Right (1280x720)
- Main_Gate (720x1280)
- Pool_Entrance (1280x720)
- Street_Entrance (1280x720)

All RTSP cameras use:
- Hardware acceleration: `preset-nvidia-h264`
- Motion-based recording: 7 days retention
- Snapshot retention: 14 days (Argus4ProEntrance: 30 days)

#### Face Recognition Settings
```yaml
face_recognition:
  enabled: true
  model_size: large
  detection_threshold: 0.8   # Increased from 0.7
  recognition_threshold: 0.95 # Increased from 0.9
  min_area: 1500             # Increased from 750
  unknown_score: 0.85        # Increased from 0.8
```

#### Other Features
```yaml
semantic_search:
  enabled: true
  model_size: large

lpr:
  enabled: true

objects:
  genai:
    enabled: true
```

### Docker Compose Configuration

**File:** `~/frigate/docker-compose.yml`

```yaml
version: "3.9"
services:
  frigate:
    container_name: frigate
    privileged: true
    restart: unless-stopped
    image: frigate:latest-tensorrt
    shm_size: "1gb"
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
    volumes:
      - /etc/localtime:/etc/localtime:ro
      - ./config:/config
      - ./media:/media/frigate
      - /mnt/nas-reolink/ReoLink:/mnt/nas-reolink:ro
      - type: tmpfs
        target: /tmp/cache
        tmpfs:
          size: 1000000000
    ports:
      - "5000:5000"   # API
      - "8971:8971"   # Web UI
      - "8554:8554"   # RTSP feeds
      - "8555:8555/tcp"  # WebRTC over tcp
      - "8555:8555/udp"  # WebRTC over udp
    environment:
      FRIGATE_RTSP_PASSWORD: "password"
```

---

## Important Paths and Mounts

### Container to Host Mappings

| Container Path | Host Path | Purpose | Access |
|---------------|-----------|---------|--------|
| `/config` | `~/frigate/config` | Frigate configuration | RW |
| `/media/frigate` | `~/frigate/media` | Recordings, snapshots, clips | RW |
| `/mnt/nas-reolink` | `/mnt/nas-reolink/ReoLink` | Battery cam video source | RO |
| `/tmp/cache` | tmpfs (1GB) | Temporary cache | RW |
| `/dev/shm` | Container shm (1GB) | Shared memory | RW |

### NAS Mount

**Host Mount Point:** `/mnt/nas-reolink/ReoLink`
**NAS Share:** `\\192.168.20.188\dvr\ReoLink`
**Protocol:** SMB/CIFS

**Verify Mount:**
```bash
df -h | grep nas-reolink
mount | grep nas-reolink
ls -la /mnt/nas-reolink/ReoLink/
```

### Symlink for Battery Camera

**Symlink:** `~/frigate/media/battery-cam/current.mp4`
**Target:** `/mnt/nas-reolink/ReoLink/YYYY/MM/DD/Argus4ProEntrance_*.mp4` (via container path)

**Note:** The symlink uses the container path (`/mnt/nas-reolink/...`) not the host path, since Frigate accesses it from inside the container.

---

## Maintenance and Operations

### Starting Frigate

```bash
cd ~/frigate
docker compose up -d
```

### Stopping Frigate

```bash
cd ~/frigate
docker compose down
```

### Viewing Logs

```bash
# Real-time logs
docker logs -f frigate

# Last 100 lines
docker logs --tail 100 frigate

# With timestamps
docker logs -f --timestamps frigate

# Filter for errors
docker logs frigate 2>&1 | grep -i error
```

### Accessing Frigate Container

```bash
# Bash shell
docker exec -it frigate bash

# Check processes
docker exec frigate ps aux

# Check disk usage
docker exec frigate df -h

# Check shared memory usage
docker exec frigate df -h | grep shm
```

### Rebuilding After Code Changes

```bash
cd ~/frigate-custom

# Build new image
make local-trt

# Stop old container
cd ~/frigate
docker compose down

# Start with new image
docker compose up -d

# Verify
docker logs -f frigate
```

### Committing Changes

```bash
cd ~/frigate-custom

# Check status
git status

# Review changes
git diff

# Stage changes
git add frigate/config/camera/ffmpeg.py
git add frigate/ffmpeg_presets.py
git add frigate/video.py
git add web/src/components/overlay/detail/FaceRecognitionTab.tsx
git add web/src/components/overlay/detail/FaceDebugTab.tsx

# Commit
git commit -m "Add file-once camera source type and face recognition UI"

# Push to remote
git push origin codex/create-detailed-documentation-for-person-detection-and-face
```

### Database Maintenance

**Frigate Database:**
```bash
# Vacuum database
docker exec frigate sqlite3 /db/frigate.db "VACUUM;"

# Check database size
docker exec frigate ls -lh /db/frigate.db
```

**Battery Processor Database:**
```bash
# Vacuum database
sqlite3 ~/battery-cam-processor/processed.db "VACUUM;"

# Check size
ls -lh ~/battery-cam-processor/processed.db
```

### Backup Procedures

**Configuration Backup:**
```bash
# Backup config directory
cd ~
tar -czf frigate-config-backup-$(date +%Y-%m-%d).tgz frigate/config/

# Backup docker-compose
cp frigate/docker-compose.yml frigate/docker-compose.yml.backup
```

**Database Backup:**
```bash
# Frigate DB
docker exec frigate sqlite3 /db/frigate.db ".backup '/media/frigate/frigate.db.backup'"

# Battery processor DB
cp ~/battery-cam-processor/processed.db \
   ~/battery-cam-processor/processed.db.backup
```

**Docker Image Backup:**
```bash
# Save current image
docker save frigate:latest-tensorrt | gzip > frigate-tensorrt-backup-$(date +%Y-%m-%d).tar.gz

# Load image later
gunzip -c frigate-tensorrt-backup.tar.gz | docker load
```

---

## Troubleshooting

### Frigate Container Won't Start

**Check logs:**
```bash
docker logs frigate
```

**Common issues:**
- GPU not accessible: Check `nvidia-smi` and docker GPU runtime
- Port conflicts: Check if ports 5000, 8971, 8554, 8555 are available
- Volume mount issues: Verify paths exist and permissions are correct
- Config syntax errors: Validate YAML syntax

**Verify GPU access:**
```bash
docker run --rm --gpus all nvidia/cuda:12.0-base nvidia-smi
```

### Battery Camera Not Processing

**Check service status:**
```bash
sudo systemctl status battery-cam-processor.service
sudo journalctl -u battery-cam-processor.service -n 100
```

**Common issues:**
- Service not running: `sudo systemctl start battery-cam-processor.service`
- NAS mount failed: Check `/mnt/nas-reolink/ReoLink` is accessible
- MQTT connection failed: Check Mosquitto is running
- Symlink broken: Check `~/frigate/media/battery-cam/current.mp4`
- Zero-byte files: Service auto-skips files >30s old with 0 bytes

**Manual processing test:**
```bash
cd ~/battery-cam-processor
python3 -u process-battery-cam.py
```

### Argus4ProEntrance Camera Shows "Offline"

**Check camera status:**
```bash
# Via MQTT
mosquitto_sub -h localhost -t "frigate/Argus4ProEntrance/status/#" -v

# Check symlink
ls -la ~/frigate/media/battery-cam/current.mp4

# Check target file exists
readlink ~/frigate/media/battery-cam/current.mp4
```

**Enable camera:**
```bash
mosquitto_pub -h localhost -t "frigate/Argus4ProEntrance/enabled/set" -m "ON"
```

**Check Frigate logs:**
```bash
docker logs frigate 2>&1 | grep -i argus
```

### UI Changes Not Appearing

**Possible causes:**
1. Browser cache - **Hard refresh:** Ctrl+Shift+R (Chrome) or Cmd+Shift+R (Mac)
2. Container not recreated - Use `docker compose down && docker compose up -d`
3. New image not built - Check image timestamp matches build time

**Verify image timestamp:**
```bash
docker images frigate:latest-tensorrt --format "{{.CreatedAt}}"
```

**Verify container creation time:**
```bash
docker inspect frigate --format "{{.Created}}"
```

**Build timestamp must be BEFORE container creation time.**

### High Shared Memory Usage

**Check current usage:**
```bash
docker exec frigate df -h | grep shm
```

**If usage >90%, increase shm_size in docker-compose.yml:**
```yaml
shm_size: "2gb"  # Increase as needed
```

Then restart:
```bash
cd ~/frigate
docker compose down && docker compose up -d
```

### Face Recognition Not Working

**Check configuration:**
```bash
docker exec frigate grep -A 10 "face_recognition:" /config/config.yml
```

**Check face library:**
```bash
docker exec frigate ls -la /config/faces/
```

**Check API:**
```bash
curl http://localhost:5000/api/faces
```

**View face processing logs:**
```bash
docker logs frigate 2>&1 | grep -i "face\|recognition"
```

### Zero-Byte Files Issue (Historical)

**Background:** Previously, the battery-cam-processor would get stuck in an infinite loop trying to process 0-byte corrupted files.

**Solution:** Updated `process-battery-cam.py` on 2025-12-10 to automatically skip files with 0 bytes that are older than 30 seconds.

**If issue reoccurs, manually mark zero-byte files:**
```bash
# Count zero-byte files
find /mnt/nas-reolink/ReoLink -name "Argus4ProEntrance*.mp4" -size 0 | wc -l

# Create script to mark them
cat > /tmp/mark_zero_byte_files.py << 'EOF'
#!/usr/bin/env python3
import os
import sqlite3
import glob
from datetime import datetime

DB_PATH = "~/battery-cam-processor/processed.db"
NAS_PATH = "/mnt/nas-reolink/ReoLink/"

conn = sqlite3.connect(DB_PATH)
cursor = conn.cursor()

pattern = f"{NAS_PATH}**/Argus4ProEntrance*.mp4"
zero_byte_files = []

for file_path in glob.glob(pattern, recursive=True):
    if os.path.getsize(file_path) == 0:
        zero_byte_files.append(file_path)

print(f"Found {len(zero_byte_files)} zero-byte files to mark as processed")

for file_path in zero_byte_files:
    cursor.execute(
        "INSERT OR IGNORE INTO processed_files (filepath, processed_at, file_size) VALUES (?, ?, ?)",
        (file_path, datetime.now().isoformat(), 0)
    )
    print(f"Marked: {file_path}")

conn.commit()
conn.close()
print(f"\nCompleted! Marked {len(zero_byte_files)} files as processed.")
EOF

python3 /tmp/mark_zero_byte_files.py
sudo systemctl restart battery-cam-processor.service
```

---

## Additional Resources

### Documentation Files

- **Face Recognition Integration:** `~/frigate-custom/docs/face_improvements/FACE_RECOGNITION_INTEGRATION.md`
- **Battery Processor Setup:** `~/battery-cam-processor/SETUP.md`
- **Frigate Official Docs:** https://docs.frigate.video/

### Useful Commands Reference

```bash
# System status at a glance
docker ps
sudo systemctl status battery-cam-processor.service
df -h | grep -E "shm|nas"

# Network connectivity
ping 192.168.20.188  # NAS
ping 192.168.10.105  # Main_Entrance camera
mosquitto_sub -h localhost -t "frigate/#" -v  # MQTT monitor

# GPU status
nvidia-smi
docker exec frigate nvidia-smi

# Database queries
sqlite3 ~/battery-cam-processor/processed.db \
  "SELECT COUNT(*), MAX(processed_at) FROM processed_files"

# Git workflow
cd ~/frigate-custom
git status
git diff
git log --oneline -10
git pull origin codex/create-detailed-documentation-for-person-detection-and-face
```

### Network Topology

```
[NAS: 192.168.20.188]
  └─ SMB Share: \\192.168.20.188\dvr\ReoLink
      └─ Mounted at: /mnt/nas-reolink/ReoLink

[Cameras - RTSP]
  ├─ Main_Entrance: 192.168.10.105
  ├─ Garden_Overview: 192.168.10.101
  ├─ Parking_Left: 192.168.10.102
  ├─ Parking_Right: 192.168.10.103
  ├─ Main_Gate: 192.168.10.104
  ├─ Pool_Entrance: 192.168.10.106
  └─ Street_Entrance: 192.168.10.107

[Battery Camera - File-based]
  └─ Argus4ProEntrance: Files on NAS → Symlink → Frigate

[Services]
  ├─ Frigate: localhost:8971 (Web UI), :5000 (API)
  ├─ MQTT Broker: localhost:1883 (Mosquitto)
  └─ Battery Processor: Systemd service (Python daemon)

[Docker Network]
  └─ Bridge: 172.17.0.1 (Docker host IP for MQTT access)
```

---

## Version History

| Date | Version | Changes |
|------|---------|---------|
| 2025-12-10 | 1.0 | Initial documentation created |
| 2025-12-10 | 1.1 | Added zero-byte file handling to battery processor |
| 2025-12-10 | 1.2 | Increased shm_size to 1GB |

---

**End of Documentation**

For questions or issues, refer to:
- Frigate GitHub: https://github.com/blakeblackshear/frigate
- Custom Fork: https://github.com/r0gig0r/frigate
- Frigate Community: https://github.com/blakeblackshear/frigate/discussions
