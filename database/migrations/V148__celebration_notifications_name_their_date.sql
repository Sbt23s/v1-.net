-- ============================================================
-- V148 - Celebration notifications that still say "today", months later.
--
-- The daily job used to write the word into the text:
--
--   🎂 Birthday today
--   Meena Sudhakaran Kanchana's birthday is today (UI/UX Designer) — wish them well!
--
-- so the bell on 8 September still announced a birthday from the 5th, in the
-- present tense. The job now names the day instead ("Birthday on 5 Sep"), which
-- fixes everything written from here on and does nothing at all for the rows
-- already sitting in the table -- and those are what people are reading.
--
-- WHERE THE DATE COMES FROM
--
-- created_at. The job runs at 09:00 on the morning of the event, so the row's
-- own timestamp IS the date the message is about. Nothing else on the row
-- carries it: the celebration is not a stored entity, and the employee's name
-- is inside a sentence rather than in a column, so there is no way to join back
-- to the person and re-derive their birthday. The timestamp is the record.
--
-- That also bounds the risk. If a row were somehow backdated the message would
-- name the wrong day -- but it already names the wrong day, every day, which is
-- the whole complaint.
--
-- SCOPE
--
-- Only CELEBRATION rows, and only ones whose text still contains the literal
-- "today". A row already written in the new shape has no "today" in it and is
-- left untouched, so this is safe to re-run and safe to apply after the new job
-- has been live for a while.
--
-- The replacements are literal string surgery rather than a rebuild, because
-- the body carries a name, a team and a greeting that this migration has no way
-- to reconstruct. Turning "is today (UI/UX Designer)" into
-- "is on 5 Sep (UI/UX Designer)" keeps every part of the sentence that was
-- true.
-- ============================================================

-- Titles: "🎂 Birthday today" -> "🎂 Birthday on 5 Sep"
UPDATE notifications
SET title = REPLACE(title, 'today', CONCAT('on ', DATE_FORMAT(created_at, '%e %b')))
WHERE type = 'CELEBRATION'
  AND title LIKE '%today%';

-- Bodies, both shapes the job produced:
--   "...'s birthday is today (Team) — wish them well!"
--   "... completes 3 years with the company today (Team)!"
-- Both read "... today ..." at the point being replaced, so one substitution
-- covers them; REPLACE only touches the first occurrence's pattern and leaves
-- the rest of the sentence exactly as written.
UPDATE notifications
SET body = REPLACE(body, 'today', CONCAT('on ', DATE_FORMAT(created_at, '%e %b')))
WHERE type = 'CELEBRATION'
  AND body LIKE '%today%';

-- Verification -- all must hold:
--   SELECT COUNT(*) FROM notifications
--    WHERE type = 'CELEBRATION' AND (title LIKE '%today%' OR body LIKE '%today%');
--   -- 0
--
--   SELECT title, body, created_at FROM notifications
--    WHERE type = 'CELEBRATION' ORDER BY created_at DESC LIMIT 5;
--   -- each names a date, and that date matches its own created_at
