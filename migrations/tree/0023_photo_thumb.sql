-- A gallery photo's small copy, about 400 pixels on its long side, made by the browser at upload beside the full picture
-- (src/components/photos/UploadDialog.tsx): the gallery's tiles, album covers and the panel's peeks show it, the lightbox
-- the photo itself. `thumb` is its key in media storage (`thumb/<uuid>.jpg`). Photos uploaded before have none (NULL), and
-- /api/media serves them whole. Plain SQL, as every migration here: D1 and node:sqlite run it.

ALTER TABLE media ADD COLUMN thumb TEXT;
