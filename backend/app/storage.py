"""Supabase Storage service for evidence image uploads.

Handles all evidence image storage operations:
- Upload annotated accident frames to Supabase Storage
- Date-based folder organization (YYYY/MM/DD/)
- Public URL generation for frontend access
- Bulk deletion support
"""

import io
import logging
import os
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Optional

import cv2
import numpy as np
from supabase import create_client, Client

from app.config import get_settings
from app.database import SessionLocal

logger = logging.getLogger(__name__)


def is_remote_evidence_path(path: str | None) -> bool:
    """Return whether an evidence path is an absolute remote URL."""
    return bool(path and (path.startswith("http://") or path.startswith("https://")))


class SupabaseStorageService:
    """Service for managing evidence images in Supabase Storage."""

    def __init__(self):
        self.settings = get_settings()
        self.bucket_name = "ticket-evidence"
        self._client: Optional[Client] = None
        self._executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="evidence-upload")
        self._inflight_uploads: set[str] = set()
        self._inflight_lock = threading.Lock()

    @property
    def client(self) -> Client:
        """Lazy-load Supabase client."""
        if self._client is None:
            self._client = create_client(
                self.settings.supabase_url,
                self.settings.supabase_secret_key  # Use service role key for storage operations
            )
        return self._client

    def _get_date_path(self, timestamp: Optional[datetime] = None) -> str:
        """Generate date-based path for file organization.
        
        Args:
            timestamp: Optional datetime to use. Defaults to now.
            
        Returns:
            Path string like "2026/04/07"
        """
        dt = timestamp or datetime.now(timezone.utc)
        return dt.strftime("%Y/%m/%d")

    def upload_evidence(
        self,
        image: np.ndarray,
        filename: str,
        timestamp: Optional[datetime] = None
    ) -> str:
        """Upload an evidence image to Supabase Storage.
        
        Args:
            image: OpenCV image array (BGR format) to upload
            filename: Base filename (e.g., "evidence_abc123_f0.jpg")
            timestamp: Optional timestamp for date-based organization
            
        Returns:
            Full public URL to the uploaded image
            
        Raises:
            Exception: If upload fails
        """
        try:
            # Encode image to JPEG bytes in memory
            success, buffer = cv2.imencode('.jpg', image, [cv2.IMWRITE_JPEG_QUALITY, 85])
            if not success:
                raise ValueError("Failed to encode image as JPEG")
            
            image_bytes = buffer.tobytes()
            
            # Build storage path with date organization
            date_path = self._get_date_path(timestamp)
            storage_path = f"{date_path}/{filename}"
            
            # Upload to Supabase Storage
            logger.info("Uploading evidence to Supabase Storage: %s", storage_path)
            
            response = self.client.storage.from_(self.bucket_name).upload(
                path=storage_path,
                file=image_bytes,
                file_options={
                    "content-type": "image/jpeg",
                    "cache-control": "3600",  # Cache for 1 hour
                    "upsert": "false"  # Don't overwrite - each evidence is unique
                }
            )
            
            # Get public URL for the uploaded file
            public_url = self.client.storage.from_(self.bucket_name).get_public_url(storage_path)
            
            logger.info("Evidence uploaded successfully: %s", public_url)
            return public_url
            
        except Exception as e:
            logger.error("Failed to upload evidence to Supabase Storage: %s", e)
            raise

    def upload_evidence_file(self, evidence_path: str, timestamp: Optional[datetime] = None) -> str:
        """Upload a local evidence file by filename/path.

        Args:
            evidence_path: Local filename or path under ``evidence_dir``.
            timestamp: Optional timestamp for date-based organization.

        Returns:
            Public URL of the uploaded evidence.
        """
        filename = os.path.basename(evidence_path)
        full_path = os.path.join(self.settings.evidence_dir, filename)
        if not os.path.isfile(full_path):
            raise FileNotFoundError(f"Evidence file not found: {full_path}")

        image = cv2.imread(full_path)
        if image is None:
            raise ValueError(f"Failed to read evidence image: {full_path}")

        return self.upload_evidence(image=image, filename=filename, timestamp=timestamp)

    def enqueue_event_evidence_upload(self, event_id: str, evidence_path: Optional[str]) -> None:
        """Upload local evidence asynchronously and update DB references.

        No-op when evidence is missing or already a remote URL.
        """
        if not event_id or not evidence_path:
            return
        if is_remote_evidence_path(evidence_path):
            return

        filename = os.path.basename(evidence_path)
        key = f"{event_id}:{filename}"

        with self._inflight_lock:
            if key in self._inflight_uploads:
                return
            self._inflight_uploads.add(key)

        self._executor.submit(self._upload_and_persist_event_evidence, event_id, filename, key)

    def _upload_and_persist_event_evidence(self, event_id: str, filename: str, inflight_key: str) -> None:
        """Background task: upload local evidence and update Event/Ticket rows."""
        try:
            public_url = self.upload_evidence_file(filename)
        except Exception as e:
            logger.warning("Async evidence upload failed for event %s: %s", event_id, e)
            with self._inflight_lock:
                self._inflight_uploads.discard(inflight_key)
            return

        db = SessionLocal()
        try:
            from app.models import Event, Ticket

            event = db.query(Event).filter(Event.id == event_id).first()
            if not event:
                logger.warning("Event %s no longer exists for evidence backfill", event_id)
                return

            # Don't overwrite if another process already set a remote URL.
            if event.evidence_path and is_remote_evidence_path(event.evidence_path):
                return

            event.evidence_path = public_url

            db.query(Ticket).filter(Ticket.event_id == event_id).update(
                {Ticket.evidence_path: public_url}
            )
            db.commit()
            logger.info("Backfilled remote evidence URL for event %s", event_id)
        except Exception as e:
            logger.error("Failed to persist async evidence URL for event %s: %s", event_id, e)
            db.rollback()
        finally:
            db.close()
            with self._inflight_lock:
                self._inflight_uploads.discard(inflight_key)

    def delete_evidence(self, file_path: str) -> bool:
        """Delete a single evidence file from Supabase Storage.
        
        Args:
            file_path: Path within bucket or full URL
            
        Returns:
            True if successful, False otherwise
        """
        try:
            # Extract path from full URL if needed
            if file_path.startswith("http"):
                # Extract path after /storage/v1/object/public/ticket-evidence/
                parts = file_path.split(f"/storage/v1/object/public/{self.bucket_name}/")
                if len(parts) == 2:
                    file_path = parts[1]
                else:
                    logger.warning("Could not parse URL for deletion: %s", file_path)
                    return False
            
            logger.info("Deleting evidence from Supabase Storage: %s", file_path)
            self.client.storage.from_(self.bucket_name).remove([file_path])
            return True
            
        except Exception as e:
            logger.error("Failed to delete evidence from Supabase Storage: %s", e)
            return False

    def delete_all_evidence(self) -> int:
        """Delete all evidence files from the bucket.
        
        Returns:
            Number of files deleted
        """
        try:
            logger.info("Listing all files in bucket for bulk deletion...")
            
            # List all files in the bucket
            response = self.client.storage.from_(self.bucket_name).list()
            
            if not response:
                logger.info("No files found in bucket")
                return 0
            
            # Recursively collect all file paths
            all_files = self._collect_all_files(response)
            
            if not all_files:
                logger.info("No files to delete")
                return 0
            
            logger.info("Deleting %d files from Supabase Storage...", len(all_files))
            
            # Delete in batches (Supabase has limits on batch operations)
            batch_size = 100
            deleted_count = 0
            
            for i in range(0, len(all_files), batch_size):
                batch = all_files[i:i + batch_size]
                self.client.storage.from_(self.bucket_name).remove(batch)
                deleted_count += len(batch)
                logger.info("Deleted batch: %d/%d files", deleted_count, len(all_files))
            
            logger.info("Successfully deleted %d evidence files", deleted_count)
            return deleted_count
            
        except Exception as e:
            logger.error("Failed to delete all evidence: %s", e)
            return 0

    def _collect_all_files(self, items: list, prefix: str = "") -> list[str]:
        """Recursively collect all file paths from storage listing.
        
        Args:
            items: List of storage objects from Supabase
            prefix: Current path prefix
            
        Returns:
            List of file paths
        """
        files = []
        
        for item in items:
            name = item.get("name", "")
            current_path = f"{prefix}/{name}" if prefix else name
            
            # Check if it's a folder or file
            if item.get("id") is None:  # Folder
                # List contents of this folder
                try:
                    folder_contents = self.client.storage.from_(self.bucket_name).list(current_path)
                    files.extend(self._collect_all_files(folder_contents, current_path))
                except Exception as e:
                    logger.warning("Failed to list folder %s: %s", current_path, e)
            else:  # File
                files.append(current_path)
        
        return files


# Singleton instance
_storage_service: Optional[SupabaseStorageService] = None


def get_storage_service() -> SupabaseStorageService:
    """Get or create the Supabase Storage service singleton."""
    global _storage_service
    if _storage_service is None:
        _storage_service = SupabaseStorageService()
    return _storage_service


def enqueue_event_evidence_upload(event_id: str, evidence_path: Optional[str]) -> None:
    """Convenience wrapper for background evidence upload/backfill."""
    get_storage_service().enqueue_event_evidence_upload(event_id, evidence_path)
