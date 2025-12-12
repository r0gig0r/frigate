# Updating a Running Frigate Instance Without Data Loss (and With Rollback)

This guide assumes an existing Frigate deployment using the documented Docker setup (Debian + Docker Engine, bind-mounted `config/` and `storage/` directories). It covers safe update steps while preserving recordings, database state, and custom models, plus an explicit rollback path.

## Key Locations to Protect

- **Configuration:** `config/` on the host (mounted to `/config` in the container). Contains `config.yml`, secrets, and UI-generated settings.
- **Recordings and events:** `storage/` on the host (mounted to `/media/frigate`). Contains recordings, clips, snapshots, database files (`frigate.db`), and embeddings.
- **Optional tmpfs cache:** `/tmp/cache` if configured; not required to back up.

> **Important:** Do not delete or recreate the bind-mounted host directories. Updates should only change the container image and configuration, not the persistent volumes.

## Pre-update Checklist

1. **Confirm current image tag**
   - `docker compose images` (note the current `ghcr.io/blakeblackshear/frigate:<tag>`)
2. **Confirm hardware readiness**
   - GPU drivers and runtime (NVIDIA Container Toolkit for CUDA, VAAPI for Intel, etc.) still installed.
3. **Check free space**
   - Ensure enough disk for a copy of `storage/` and the new image download.
4. **Notify users/automations**
   - Plan a maintenance window; the service will restart.

## Create a Rollback Point

1. **Export current image (optional but recommended)**
   - `docker save ghcr.io/blakeblackshear/frigate:<tag> -o frigate-<tag>.tar`
   - Store the tarball somewhere off the Frigate host if possible.
2. **Backup configuration and database**
   - Stop Frigate to flush SQLite and recordings cleanly:
     - `docker compose stop frigate`
   - Create compressed backups:
     - `tar -czvf frigate-config-backup-$(date +%F).tgz config/`
     - `tar -czvf frigate-storage-db-backup-$(date +%F).tgz storage/frigate.db storage/embeddings.db`
   - Optional: snapshot the entire `storage/` directory if capacity allows.
3. **Resume service (optional)**
   - If downtime must be minimized, start Frigate again while you download the new image:
     - `docker compose start frigate`

## Upgrade Procedure

1. **Pull the new image**
   - `docker compose pull frigate`
2. **Apply database-safe stop**
   - `docker compose down frigate` (or `docker compose stop frigate` if other services in the stack must stay up)
3. **Start with the new image**
   - `docker compose up -d frigate`
4. **Verify startup**
   - `docker compose logs -f frigate` (watch for migrations completing, detector startup, and camera connections)
   - Confirm UI access at `https://<host>:8971`.
   - Validate GPU usage if expected (e.g., `nvidia-smi` shows Frigate processes).

## Post-update Validation

- Play recent recordings and clips from multiple cameras.
- Confirm detections, face recognition, and search are functioning.
- Check MQTT/webhooks automations and Home Assistant integration.
- Ensure the database size and event counts look normal; `sqlite3 storage/frigate.db "PRAGMA integrity_check;"` is optional.

## Rollback Procedure (if the new version fails)

1. **Stop the faulty container**
   - `docker compose down frigate`
2. **Restore the previous image**
   - If you exported it: `docker load -i frigate-<tag>.tar`
   - Otherwise, edit `docker-compose.yml` to pin the prior tag you noted (e.g., `ghcr.io/blakeblackshear/frigate:<previous-tag>`) and run `docker compose pull frigate` if the tag is still available.
3. **Restore configuration/database (if corruption is suspected)**
   - Replace from backups:
     - `tar -xzvf frigate-config-backup-<date>.tgz -C .`
     - `tar -xzvf frigate-storage-db-backup-<date>.tgz -C .`
4. **Start the previous version**
   - `docker compose up -d frigate`
5. **Validate**
   - Repeat the post-update checks; verify cameras, detections, and the UI.

## Tips to Avoid Data Loss

- Never run `docker compose down -v` (it removes volumes).
- Keep `storage/` on a reliable disk with regular host-level backups/snapshots.
- Avoid editing `config.yml` inside the container; edit the host file so backups stay current.
- Before large upgrades, reduce retention temporarily to shrink backup size, then restore your normal policy.
- For HA users, temporarily disable the add-on auto-update until manual validation is complete.

## Optional Zero-downtime Strategy

If your hardware allows, run a parallel Frigate container on a different port using a copy of the config and pointing to **read-only** camera streams and a **separate** storage path. After validation, swap over by stopping the old container and promoting the new one. This avoids touching production recordings during testing.
