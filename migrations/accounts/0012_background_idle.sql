-- Background tasks that find nothing to do leave no run: the schedule only needs to know when a task last looked
-- (last_checked, set by an idle scheduled check; last_started stays "when it last did something"). ai_task_giveup counts
-- the tries of one item that failed for a reason of its own, so an item that can never succeed stops being asked after
-- a few tries instead of keeping its task busy for ever; changing the item (its key holds what it was made from) starts it afresh.
ALTER TABLE ai_background_task ADD COLUMN last_checked INTEGER;

CREATE TABLE IF NOT EXISTS ai_task_giveup (
  tree TEXT NOT NULL,
  task TEXT NOT NULL,
  item TEXT NOT NULL,
  failures INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tree, task, item)
);
