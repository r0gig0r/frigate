# Face Improvement Implementation Plan

## Objectives
- Add user-facing controls to flag false-positive face recognitions, trigger retraining, and surface candidates for correction.
- Support multi-select tagging workflows for assigning several faces to a single identity from the face library and tracked objects.
- Gate training and auto-labeling on face image quality (blur/size) with a minimum number of high-quality samples while still surfacing best-match suggestions.
- Enable tagging from the "Tracked Object Details" dialog without leaving event context.
- Balance GPU utilization across dual NVIDIA GPUs for face and embedding workloads without heavy orchestration.

## Backend Changes
### Configuration
- Extend `FaceRecognitionConfig` with:
  - `device_pool`: optional list of device identifiers (e.g., `"0"`, `"1"`) for GPU load balancing.
  - `min_quality_variance`: Laplacian variance threshold to accept a face for training.
  - `min_quality_faces`: required count of high-quality faces before persisting a sub-label.
- Default to existing behavior when new fields are unset.

### GPU Load Balancing
- Introduce a lightweight `GpuDeviceBalancer` (module-level) in `frigate/util/model.py` to track runner allocations per device id.
- Enhance `get_ort_providers`/`get_optimized_runner` to accept a pool of devices and pick the least-loaded GPU when `device_pool` is supplied.
- Apply the balancer to ArcFace embeddings and Jina v2 embedding creation (face recognition and semantic search paths).

### Face Quality Gate
- Add a blur/size quality scorer in `FaceRealTimeProcessor` using Laplacian variance.
- Skip training/auto-label attempts below `min_quality_variance`; record quality metadata alongside saved attempts.
- Require `min_quality_faces` high-quality recognitions before publishing a sub-label but continue to emit weighted best-match suggestions to the UI.

### False-Positive Handling and Retraining
- New API: `POST /faces/{name}/flag_false_positive` accepting training image IDs. Actions:
  - Move the specified face images back into `faces/train` for retraining and remove them from the labeled folder.
  - Clear the face classifier cache and return fresh recognition suggestions for the moved images.
- Add metadata to the response to help the UI flag related events as needing review.

### Multi-Select Tagging & Batch Training
- Extend `train_face` to optionally accept multiple `training_files` so batches of collected attempts can be assigned to one identity in a single request.
- Preserve existing single-file and `event_id` flows for compatibility.

### Tagging from Tracked Object Details
- Expose a lightweight endpoint to trigger `train_face` from a tracked object image reference (uses existing event snapshot helper) so the UI can tag directly from the modal.

## Frontend Changes
### Shared Face Actions
- Surface face names and trainable examples through existing `FaceSelectionDialog`.
- Add reusable hooks/utilities for batch training and false-positive flagging with optimistic updates and toasts.

### Face Library
- Enable multi-select of train images with a "Tag selected as…" action wired to the batch training API.
- Provide a "Mark as false positive" bulk action that calls the new backend, refreshes faces, and re-opens suggestions.
- Indicate low-quality samples (below variance) in the UI and prevent tagging them.

### Tracked Object Details Modal
- Add a "Tag face" action that opens the face selector and posts the cropped face image to the batch training API (reusing the tracked object snapshot).
- Include a "Mark false positive" control when a face sub-label is present, using the new endpoint.

## Testing
- Backend: add/update unit tests for configuration defaults, quality gating, batch training, and false-positive API responses.
- Frontend: add integration/behavior coverage where feasible (React Testing Library) for new controls and API flows; manual smoke test tagging and false-positive actions.
