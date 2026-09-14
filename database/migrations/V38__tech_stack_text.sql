-- Tech stack now holds a structured, multi-category skills sheet, so widen it
-- from VARCHAR(255) to TEXT.
ALTER TABLE users MODIFY COLUMN tech_stack TEXT NULL;
