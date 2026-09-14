-- Voice messages in community/personal chat: store the recorded audio's
-- served path alongside the (label) text content.
ALTER TABLE community_messages
    ADD COLUMN audio_path VARCHAR(255) NULL AFTER content;
