-- A development capture is local storage, never provider acceptance/delivery.
-- Add a nullable receipt without rewriting existing attempts or outcome history.
ALTER TABLE notification_delivery_attempts ADD COLUMN local_capture_id TEXT
  CHECK (local_capture_id IS NULL OR
    (length(local_capture_id) > 0 AND provider_message_id IS NULL AND error IS NULL));
