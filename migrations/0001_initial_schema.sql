-- Tasks table
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT NOT NULL CHECK(category IN ('future', 'now', 'maintain', 'chore')),
  minutes INTEGER DEFAULT 15,
  status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo', 'done', 'deleted')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  due_date TEXT,
  priority TEXT CHECK(priority IN ('high', 'medium', 'low'))
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_category ON tasks(category);
CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at);

-- Google Calendar events cache table
CREATE TABLE IF NOT EXISTS calendar_events (
  id TEXT PRIMARY KEY,
  summary TEXT NOT NULL,
  description TEXT,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  synced_at TEXT NOT NULL DEFAULT (datetime('now')),
  converted_to_task INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_calendar_events_start ON calendar_events(start_time);
CREATE INDEX IF NOT EXISTS idx_calendar_events_converted ON calendar_events(converted_to_task);
