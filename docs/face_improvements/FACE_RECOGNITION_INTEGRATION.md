# Face Recognition Integration Documentation

This document provides a comprehensive overview of the face recognition system in Frigate, including frontend components, backend API endpoints, data structures, and integration patterns.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Frontend Components](#frontend-components)
3. [Backend API Endpoints](#backend-api-endpoints)
4. [Data Structures](#data-structures)
5. [Face Training Workflow](#face-training-workflow)
6. [UI/UX Patterns](#uiux-patterns)
7. [Configuration Options](#configuration-options)

---

## Architecture Overview

The face recognition system consists of three main layers:

```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend (React)                        │
│  ┌──────────────┐  ┌─────────────────┐  ┌───────────────────┐  │
│  │ Face Library │  │ SearchDetail    │  │ EventView         │  │
│  │   View       │  │    Dialog       │  │ (Review Page)     │  │
│  └──────────────┘  └─────────────────┘  └───────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      REST API Layer                             │
│  /api/faces  /api/faces/train  /api/faces/reprocess_event      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Backend (Python)                             │
│  ┌────────────────────┐  ┌────────────────────────────────┐    │
│  │ Face Recognition   │  │ File Storage                   │    │
│  │ Models (FaceNet/   │  │ /media/frigate/clips/faces/    │    │
│  │ ArcFace)           │  │                                │    │
│  └────────────────────┘  └────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

### File Storage Structure

```
/media/frigate/clips/faces/
├── train/                    # Training queue images
│   ├── {eventId}-{timestamp}-{name}-{score}.webp
│   └── ...
├── {personName}/             # Trained face images per person
│   ├── {uuid}.webp
│   └── ...
└── ...
```

---

## Frontend Components

### 1. Face Library View

**Location:** `/web/src/views/face-library/FaceLibraryView.tsx`

The main face management interface with tabs for:
- **Train tab**: Shows faces pending classification from recent detections
- **Per-person tabs**: Shows trained faces for each known person

**Key Features:**
- Grid layout of face thumbnails
- Hover actions for tagging, training, and deleting
- Batch operations support
- Quality score display with color coding

### 2. SearchDetailDialog (Tracked Object Details)

**Location:** `/web/src/components/overlay/detail/SearchDetailDialog.tsx`

Three-tab dialog for examining tracked objects:
- **Snapshot**: Full event snapshot view
- **Tracking Details**: Object tracking information
- **Face Recognition**: Face-specific operations (new)

**Tab Configuration:**
```typescript
const SEARCH_TABS = ["snapshot", "tracking_details", "face_recognition"] as const;
export type SearchTab = (typeof SEARCH_TABS)[number];
```

### 3. FaceRecognitionTab Component

**Location:** `/web/src/components/overlay/detail/FaceRecognitionTab.tsx`

New component for face operations within the detail dialog.

**Props:**
```typescript
type FaceRecognitionTabProps = {
  event: SearchResult;        // The tracked object event
  config?: FrigateConfig;     // Frigate configuration
  faceNames: string[];        // List of known face names
  isDesktop: boolean;         // Responsive layout flag
};
```

**Layout (Desktop):**
```
+----------------------------------+------------------+
|  LEFT SIDE                       |  RIGHT SIDE      |
|  +--------------------------+    |                  |
|  |  Snapshot with face      |    |  [Reprocess]     |
|  |  boxes overlay           |    |                  |
|  +--------------------------+    |  Technical Info: |
|                                  |  - Face count    |
|  Detected Faces:                 |  - Recognition   |
|  +----+ +----+ +----+           |    threshold     |
|  |face| |face| |face|           |  - Unknown       |
|  |img | |img | |img |           |    threshold     |
|  +----+ +----+ +----+           |  - Box coords    |
|  [Tag] [FP]  [Tag] [FP]         |                  |
+----------------------------------+------------------+
```

**Features:**
- Zoomable snapshot with face box overlays
- Color-coded confidence scores (green/orange/red)
- Per-face action buttons (tag, mark false positive)
- Reprocess button for re-running face detection
- Technical details panel

### 4. FaceSelectionDialog

**Location:** `/web/src/components/overlay/FaceSelectionDialog.tsx`

Reusable dialog for selecting a face name when tagging.

**Usage:**
```tsx
<FaceSelectionDialog
  faceNames={faceNames}
  onTrainAttempt={(name) => handleTagFace(face.filename, name)}
>
  <Button>Tag Face</Button>
</FaceSelectionDialog>
```

### 5. EventView (Review Page)

**Location:** `/web/src/views/events/EventView.tsx`

Review page with face recognition icon overlay.

**Face Recognition Access:**
- Small icon in bottom-right corner of each preview thumbnail
- Click opens SearchDetailDialog directly to "Face Recognition" tab
- Positioned inside the preview div for clean visual integration

```tsx
<div className="aspect-video overflow-hidden rounded-lg relative">
  <PreviewThumbnailPlayer ... />
  <button
    className="absolute bottom-2 right-2 p-1.5 rounded-full bg-black/50 hover:bg-black/70"
    onClick={(e) => {
      e.stopPropagation();
      setDetailDialogTab("face_recognition");
      setSelectedReview(value);
    }}
  >
    <FaUserCircle className="size-4 text-white" />
  </button>
</div>
```

---

## Backend API Endpoints

### Face Library

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/faces` | GET | Get all faces grouped by category |
| `/api/faces/{name}` | GET | Get faces for specific person |
| `/api/faces/{name}` | DELETE | Delete a person and all their faces |

### Face Training

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/faces/train/{name}/classify` | POST | Tag/classify a training face |
| `/api/faces/{name}/flag_false_positive` | POST | Mark face as false positive |
| `/api/faces/reprocess` | POST | Reprocess a specific training file |
| `/api/faces/reprocess_event/{event_id}` | PUT | Reprocess all faces for an event |

### Face Images

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/faces/{filepath}` | GET | Get face image file |
| `/api/faces/train/{filename}` | GET | Get training face image |

### Request/Response Examples

**Tag Face Request:**
```http
POST /api/faces/train/john_doe/classify
Content-Type: application/json

{
  "training_file": "1765275625-abc123-0.85.webp"
}
```

**Mark False Positive:**
```http
POST /api/faces/john_doe/flag_false_positive
Content-Type: application/json

{
  "ids": ["1765275625-abc123-0.85.webp"]
}
```

**Reprocess Event:**
```http
PUT /api/faces/reprocess_event/1765275625.546075-7tljsi
```

---

## Data Structures

### SearchResult (Event Data)

```typescript
interface SearchResult {
  id: string;              // Event ID
  camera: string;          // Camera name
  start_time: number;      // Unix timestamp
  end_time?: number;       // Unix timestamp
  label: string;           // Object label (e.g., "person")
  sub_label?: string;      // Recognized face name
  zones: string[];         // Zones where detected
  has_snapshot: boolean;
  has_clip: boolean;
  data: {
    top_score: number;     // Highest detection score
    score: number;         // Current score
    region: number[];      // Detection region [x1, y1, x2, y2]
    box: number[];         // Bounding box [x, y, w, h] (normalized)
    sub_label_score?: number; // Face recognition score
    attributes?: FaceAttribute[];
  };
}
```

### FaceAttribute

```typescript
interface FaceAttribute {
  box: number[];    // [x, y, width, height] normalized 0-1
  label?: string;   // "face"
  score?: number;   // Detection confidence
}
```

### TrainingFaceData

```typescript
interface TrainingFaceData {
  filepath: string;    // "train/{filename}"
  filename: string;    // Full filename
  name: string;        // Person name or "unknown"
  score?: number;      // Recognition confidence
  eventId?: string;    // Associated event ID
}
```

### Training Filename Format

```
{eventId1}-{eventId2}-{timestamp}-{faceName}-{score}.webp

Example: 1765275625-7tljsi-1733789123-john_doe-0.85.webp
```

---

## Face Training Workflow

### Detection Flow

```
┌─────────────┐    ┌──────────────┐    ┌────────────────┐
│ Person      │───▶│ Face         │───▶│ Face           │
│ Detected    │    │ Detected     │    │ Recognized     │
└─────────────┘    └──────────────┘    └────────────────┘
                          │                    │
                          ▼                    ▼
                   ┌──────────────┐    ┌────────────────┐
                   │ Saved to     │    │ sub_label      │
                   │ train/       │    │ assigned       │
                   └──────────────┘    └────────────────┘
```

### Training Flow

1. **Face appears in Train tab** with confidence score
2. **User reviews** the detected face
3. **User tags** the face with a name:
   - New person: Creates new folder
   - Existing person: Adds to existing folder
4. **Face moved** from `train/` to `{personName}/`
5. **Model updated** with new training data

### Score Thresholds

```typescript
// From FrigateConfig
const recognitionThreshold = config?.face_recognition?.recognition_threshold ?? 0.7;
const unknownThreshold = config?.face_recognition?.unknown_score ?? 0.5;

// Color coding
function getScoreColor(score: number) {
  if (score >= recognitionThreshold) return "green";  // High confidence
  if (score >= unknownThreshold) return "orange";     // Potential match
  return "red";                                        // Unknown/low confidence
}
```

---

## UI/UX Patterns

### Face Box Overlay

Face boxes are rendered as positioned divs over the snapshot:

```tsx
{faceAttributes.map((face, index) => {
  const [x, y, w, h] = face.box; // Normalized coordinates (0-1)
  return (
    <div
      className={cn("absolute border-2", getBoxColor(face.score))}
      style={{
        left: `${x * 100}%`,
        top: `${y * 100}%`,
        width: `${w * 100}%`,
        height: `${h * 100}%`,
      }}
    >
      <span className="absolute -top-5 text-xs">
        {(face.score * 100).toFixed(0)}%
      </span>
    </div>
  );
})}
```

### Zoomable Image

Using `react-zoom-pan-pinch` for image zoom:

```tsx
<TransformWrapper minScale={1} maxScale={10} wheel={{ smoothStep: 0.04 }}>
  <TransformComponent>
    <img src={snapshotUrl} />
    {/* Face box overlays */}
  </TransformComponent>
</TransformWrapper>
```

### Hover Actions

Face thumbnails show action buttons on hover:

```tsx
<div className="relative group">
  <img src={faceUrl} />
  <div className="absolute inset-0 opacity-0 group-hover:opacity-100 bg-black/50">
    <FaceSelectionDialog onTrainAttempt={handleTag}>
      <Button><FaUserPlus /></Button>
    </FaceSelectionDialog>
    <Button onClick={handleFalsePositive}><FaTimes /></Button>
  </div>
</div>
```

---

## Configuration Options

### Face Recognition Config

```yaml
face_recognition:
  enabled: true
  model_size: large              # "small" or "large"
  detection_threshold: 0.7       # Min face detection confidence
  recognition_threshold: 0.9     # Min recognition confidence for sub_label
  unknown_score: 0.8             # Below this = unknown
  min_area: 500                  # Min face pixel area
  min_faces: 1                   # Min recognitions for sub_label
  save_attempts: 200             # Max training images to save
  blur_confidence_filter: true   # Adjust confidence for blurry faces
```

### Accessing Config in Frontend

```typescript
const { data: config } = useSWR<FrigateConfig>("config");

// Use thresholds
const recognitionThreshold = config?.face_recognition?.recognition_threshold ?? 0.7;
const unknownThreshold = config?.face_recognition?.unknown_score ?? 0.5;
```

---

## Component Dependencies

```
FaceRecognitionTab
├── react-zoom-pan-pinch (TransformWrapper, TransformComponent)
├── FaceSelectionDialog
├── useImageLoaded (hook)
├── ImageLoadingIndicator
├── Button, cn (UI utilities)
├── axios (API calls)
├── useSWR (data fetching)
└── react-icons/fa (FaUserCircle, FaUserPlus, FaTimes)
```

---

## Related Files

| File | Purpose |
|------|---------|
| `web/src/views/face-library/FaceLibraryView.tsx` | Main face library page |
| `web/src/components/overlay/detail/SearchDetailDialog.tsx` | Tracked object dialog |
| `web/src/components/overlay/detail/FaceRecognitionTab.tsx` | Face recognition tab |
| `web/src/components/overlay/FaceSelectionDialog.tsx` | Face name selection |
| `web/src/views/events/EventView.tsx` | Review page with face icon |
| `web/src/types/frigateConfig.ts` | Config type definitions |
| `web/src/types/search.ts` | SearchResult type |

---

## Changelog

- **2024-12-09**: Added FaceRecognitionTab component
- **2024-12-09**: Added "Face Recognition" tab to SearchDetailDialog
- **2024-12-09**: Added face recognition icon overlay in EventView
