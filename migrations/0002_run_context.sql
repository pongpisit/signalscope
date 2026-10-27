-- Snapshot the country and time zone each run launched with, so changing the
-- configuration later never repaints earlier observations.
ALTER TABLE runs ADD COLUMN country TEXT;
ALTER TABLE runs ADD COLUMN timezone TEXT;
