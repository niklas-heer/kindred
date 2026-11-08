-- A person may keep a photo and still show the drawn avatar: prefer_avatar = 1 makes Portrait draw the
-- likeness instead. The photo stays in `photo`, so the choice can be undone without a new upload.
-- Defaults to 0 (show the photo when there is one), so existing rows keep what they show now.

ALTER TABLE person ADD COLUMN prefer_avatar INTEGER NOT NULL DEFAULT 0 CHECK (prefer_avatar IN (0, 1));
