-- ============================================================
-- V22 — Fix default chatbot voice for free-tier ElevenLabs.
--
-- The original default voice (Rachel, 21m00Tcm4TlvDq8ikWAM) is a shared
-- "library" voice that ElevenLabs blocks for free-tier API keys (HTTP 402),
-- which made text-to-speech silently fall back to the robotic browser voice.
--
-- Switch to "Sarah" (EXAVITQu4vr4xnSDxMaL) — a premade voice usable on the
-- free tier that speaks Tamil / Hindi / English via eleven_multilingual_v2.
-- Only updates rows still on the old default, so an admin's custom choice is kept.
-- ============================================================

UPDATE system_settings
   SET setting_value = 'EXAVITQu4vr4xnSDxMaL'
 WHERE setting_key = 'ELEVENLABS_VOICE_ID'
   AND setting_value = '21m00Tcm4TlvDq8ikWAM';
