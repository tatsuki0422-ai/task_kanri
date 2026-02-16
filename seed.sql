-- Seed data for testing
INSERT OR IGNORE INTO tasks (id, title, category, minutes, status, due_date, priority) VALUES 
  ('test-1', '新規事業提案資料作成', 'future', 120, 'todo', date('now', '+2 days'), 'high'),
  ('test-2', '顧客A社との商談準備', 'now', 60, 'todo', date('now', '+1 day'), 'high'),
  ('test-3', '週次レポート作成', 'maintain', 30, 'todo', date('now'), 'medium'),
  ('test-4', 'メールチェック', 'chore', 15, 'done', date('now', '-1 day'), 'low');
