PRAGMA foreign_keys=OFF;
BEGIN TRANSACTION;
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT NOT NULL CHECK(category IN ('future', 'now', 'maintain', 'chore')),
  minutes INTEGER DEFAULT 15,
  status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo', 'done', 'deleted')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  due_date TEXT,
  priority TEXT CHECK(priority IN ('high', 'medium', 'low'))
);
INSERT INTO tasks VALUES('test-1','新規事業提案資料作成','future',120,'done','2026-02-12 06:39:37','2026-02-14','high');
INSERT INTO tasks VALUES('test-2','顧客A社との商談準備','now',60,'done','2026-02-12 06:39:37','2026-02-13','high');
INSERT INTO tasks VALUES('test-3','週次レポート作成','maintain',30,'deleted','2026-02-12 06:39:37','2026-02-12','medium');
INSERT INTO tasks VALUES('test-4','メールチェック','chore',15,'done','2026-02-12 06:39:37','2026-02-11','low');
INSERT INTO tasks VALUES('a1b2c3d4-0001-4000-8000-000000000001','3章のスライド作成','now',120,'todo','2026-02-15 07:13:01','2026-02-15','high');
INSERT INTO tasks VALUES('a1b2c3d4-0002-4000-8000-000000000002','ZoomとTLDVの解約をする','chore',30,'todo','2026-02-15 07:13:01','2026-02-21','medium');
INSERT INTO tasks VALUES('a1b2c3d4-0003-4000-8000-000000000003','TLDVの動画をGoogle Driveに移行（解約前に実施）','chore',60,'todo','2026-02-15 07:13:01','2026-02-20','high');
INSERT INTO tasks VALUES('a1b2c3d4-0004-4000-8000-000000000004','ボブさんに実績をまとめて報告','now',60,'todo','2026-02-15 07:13:01',NULL,'medium');
INSERT INTO tasks VALUES('a1b2c3d4-0005-4000-8000-000000000005','コネクトのスライド作成をする','now',120,'todo','2026-02-15 07:13:01',NULL,'medium');
INSERT INTO tasks VALUES('a1b2c3d4-0006-4000-8000-000000000006','SYNQTANKの資料作成する','now',120,'todo','2026-02-15 07:13:01',NULL,'medium');
INSERT INTO tasks VALUES('a1b2c3d4-0007-4000-8000-000000000007','スイミーの諸々の調整','chore',60,'todo','2026-02-15 07:13:01',NULL,'medium');
INSERT INTO tasks VALUES('a1b2c3d4-0008-4000-8000-000000000008','ライトアップとの共催セミナーを組む','now',60,'todo','2026-02-15 09:17:04','2026-02-16','high');
INSERT INTO tasks VALUES('a1b2c3d4-0009-4000-8000-000000000009','元気さんとみずきさんに今後のことを伝える','now',30,'todo','2026-02-15 09:21:52','2026-02-16','high');
INSERT INTO tasks VALUES('a1b2c3d4-0010-4000-8000-000000000010','claudecodeセミナーの告知','now',60,'todo','2026-02-15 10:32:29','2026-02-16','high');
INSERT INTO tasks VALUES('a1b2c3d4-0011-4000-8000-000000000011','3章の資料作成','now',120,'todo','2026-02-15 15:59:32','2026-02-16','high');
INSERT INTO tasks VALUES('464e53eb-f34b-40c8-b0a7-6181d5c62a9f','3章の資料作成','now',120,'todo','2026-02-15T15:59:54.961Z','2026-02-17','high');
COMMIT;
PRAGMA foreign_keys=OFF;
BEGIN TRANSACTION;
CREATE TABLE subtasks (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  title TEXT NOT NULL,
  minutes INTEGER NOT NULL DEFAULT 15,
  order_index INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo', 'done')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO subtasks VALUES('sub-0001-01','a1b2c3d4-0001-4000-8000-000000000001','3章のアウトライン(見出し・構成)を書き出す',15,1,'todo','2026-02-15 16:04:58');
INSERT INTO subtasks VALUES('sub-0001-02','a1b2c3d4-0001-4000-8000-000000000001','各スライドのキーメッセージを箇条書きで下書き',20,2,'todo','2026-02-15 16:04:58');
INSERT INTO subtasks VALUES('sub-0001-03','a1b2c3d4-0001-4000-8000-000000000001','スライドに使う図・データを収集する',20,3,'todo','2026-02-15 16:04:58');
INSERT INTO subtasks VALUES('sub-0001-04','a1b2c3d4-0001-4000-8000-000000000001','スライドを作成する(本文・レイアウト)',40,4,'todo','2026-02-15 16:04:58');
INSERT INTO subtasks VALUES('sub-0001-05','a1b2c3d4-0001-4000-8000-000000000001','見直し・修正して完成させる',15,5,'todo','2026-02-15 16:04:58');
INSERT INTO subtasks VALUES('sub-0010-01','a1b2c3d4-0010-4000-8000-000000000010','セミナーの日時・内容・申込リンクを確認する',10,1,'todo','2026-02-15 16:05:06');
INSERT INTO subtasks VALUES('sub-0010-02','a1b2c3d4-0010-4000-8000-000000000010','告知文を作成する(SNS/メール用)',20,2,'done','2026-02-15 16:05:06');
INSERT INTO subtasks VALUES('sub-0010-03','a1b2c3d4-0010-4000-8000-000000000010','SNS・メーリングリスト等で告知を配信する',15,3,'todo','2026-02-15 16:05:06');
INSERT INTO subtasks VALUES('sub-0010-04','a1b2c3d4-0010-4000-8000-000000000010','告知後の反応を確認する',10,4,'todo','2026-02-15 16:05:06');
INSERT INTO subtasks VALUES('sub-0009-01','a1b2c3d4-0009-4000-8000-000000000009','伝える内容の要点を整理する',10,1,'done','2026-02-15 16:05:13');
INSERT INTO subtasks VALUES('sub-0009-02','a1b2c3d4-0009-4000-8000-000000000009','元気さんに連絡する',10,2,'todo','2026-02-15 16:05:13');
INSERT INTO subtasks VALUES('sub-0009-03','a1b2c3d4-0009-4000-8000-000000000009','みずきさんに連絡する',10,3,'todo','2026-02-15 16:05:13');
INSERT INTO subtasks VALUES('sub-0008-01','a1b2c3d4-0008-4000-8000-000000000008','セミナーのテーマ・ターゲットを決める',15,1,'done','2026-02-15 16:05:17');
INSERT INTO subtasks VALUES('sub-0008-02','a1b2c3d4-0008-4000-8000-000000000008','候補日程を3つ以上リストアップする',10,2,'todo','2026-02-15 16:05:17');
INSERT INTO subtasks VALUES('sub-0008-03','a1b2c3d4-0008-4000-8000-000000000008','ライトアップ担当者に提案メールを送る',15,3,'todo','2026-02-15 16:05:17');
INSERT INTO subtasks VALUES('sub-0008-04','a1b2c3d4-0008-4000-8000-000000000008','返信を受けて日程・内容を確定する',15,4,'todo','2026-02-15 16:05:17');
INSERT INTO subtasks VALUES('sub-0003-01','a1b2c3d4-0003-4000-8000-000000000003','TLDVで保存対象の動画一覧を確認する',10,1,'todo','2026-02-15 16:05:44');
INSERT INTO subtasks VALUES('sub-0003-02','a1b2c3d4-0003-4000-8000-000000000003','動画をダウンロードする',20,2,'todo','2026-02-15 16:05:44');
INSERT INTO subtasks VALUES('sub-0003-03','a1b2c3d4-0003-4000-8000-000000000003','Google Driveにフォルダを作りアップロードする',20,3,'todo','2026-02-15 16:05:44');
INSERT INTO subtasks VALUES('sub-0003-04','a1b2c3d4-0003-4000-8000-000000000003','アップロード完了を確認し、TLDV側のデータ削除可否を判断する',10,4,'todo','2026-02-15 16:05:44');
INSERT INTO subtasks VALUES('sub-0002-01','a1b2c3d4-0002-4000-8000-000000000002','Zoomの管理画面で解約手続きをする',10,1,'todo','2026-02-15 16:06:56');
INSERT INTO subtasks VALUES('sub-0002-02','a1b2c3d4-0002-4000-8000-000000000002','TLDVの管理画面で解約手続きをする',10,2,'todo','2026-02-15 16:06:56');
INSERT INTO subtasks VALUES('sub-0002-03','a1b2c3d4-0002-4000-8000-000000000002','解約完了メールを確認する',10,3,'todo','2026-02-15 16:06:56');
INSERT INTO subtasks VALUES('sub-0004-01','a1b2c3d4-0004-4000-8000-000000000004','報告対象の実績データを収集する',15,1,'todo','2026-02-15 16:06:59');
INSERT INTO subtasks VALUES('sub-0004-02','a1b2c3d4-0004-4000-8000-000000000004','実績を整理して報告資料にまとめる',25,2,'todo','2026-02-15 16:06:59');
INSERT INTO subtasks VALUES('sub-0004-03','a1b2c3d4-0004-4000-8000-000000000004','ボブさんに報告を送る',10,3,'todo','2026-02-15 16:06:59');
INSERT INTO subtasks VALUES('sub-0005-01','a1b2c3d4-0005-4000-8000-000000000005','コネクト用スライドの目的とゴールを確認する',10,1,'todo','2026-02-15 16:07:03');
INSERT INTO subtasks VALUES('sub-0005-02','a1b2c3d4-0005-4000-8000-000000000005','アウトラインを作成する',15,2,'todo','2026-02-15 16:07:03');
INSERT INTO subtasks VALUES('sub-0005-03','a1b2c3d4-0005-4000-8000-000000000005','スライド本文を作成する',45,3,'todo','2026-02-15 16:07:03');
INSERT INTO subtasks VALUES('sub-0005-04','a1b2c3d4-0005-4000-8000-000000000005','図やデータを挿入して仕上げる',30,4,'todo','2026-02-15 16:07:03');
INSERT INTO subtasks VALUES('sub-0005-05','a1b2c3d4-0005-4000-8000-000000000005','見直し・修正して完成させる',15,5,'todo','2026-02-15 16:07:03');
INSERT INTO subtasks VALUES('sub-0006-01','a1b2c3d4-0006-4000-8000-000000000006','SYNQTANKの目的・ターゲットを確認する',10,1,'todo','2026-02-15 16:08:27');
INSERT INTO subtasks VALUES('sub-0006-02','a1b2c3d4-0006-4000-8000-000000000006','アウトラインを作成する',15,2,'todo','2026-02-15 16:08:27');
INSERT INTO subtasks VALUES('sub-0006-03','a1b2c3d4-0006-4000-8000-000000000006','資料本文を作成する',45,3,'todo','2026-02-15 16:08:27');
INSERT INTO subtasks VALUES('sub-0006-04','a1b2c3d4-0006-4000-8000-000000000006','図やデータを挿入して仕上げる',30,4,'todo','2026-02-15 16:08:27');
INSERT INTO subtasks VALUES('sub-0006-05','a1b2c3d4-0006-4000-8000-000000000006','見直し・修正して完成させる',15,5,'todo','2026-02-15 16:08:27');
INSERT INTO subtasks VALUES('sub-0007-01','a1b2c3d4-0007-4000-8000-000000000007','調整が必要な項目を洗い出す',15,1,'todo','2026-02-15 16:08:30');
INSERT INTO subtasks VALUES('sub-0007-02','a1b2c3d4-0007-4000-8000-000000000007','各項目について関係者に連絡・調整する',30,2,'todo','2026-02-15 16:08:30');
INSERT INTO subtasks VALUES('sub-0007-03','a1b2c3d4-0007-4000-8000-000000000007','調整結果を確認して完了する',15,3,'todo','2026-02-15 16:08:30');
INSERT INTO subtasks VALUES('sub-0011-01','a1b2c3d4-0011-4000-8000-000000000011','アウトライン(章構成・見出し)を作る',15,1,'todo','2026-02-15 16:08:34');
INSERT INTO subtasks VALUES('sub-0011-02','a1b2c3d4-0011-4000-8000-000000000011','各セクションの要点を下書きする',25,2,'todo','2026-02-15 16:08:34');
INSERT INTO subtasks VALUES('sub-0011-03','a1b2c3d4-0011-4000-8000-000000000011','図表・データを準備する',20,3,'todo','2026-02-15 16:08:34');
INSERT INTO subtasks VALUES('sub-0011-04','a1b2c3d4-0011-4000-8000-000000000011','資料を仕上げる',40,4,'todo','2026-02-15 16:08:34');
INSERT INTO subtasks VALUES('sub-0011-05','a1b2c3d4-0011-4000-8000-000000000011','最終確認して提出する',15,5,'todo','2026-02-15 16:08:34');
COMMIT;
PRAGMA foreign_keys=OFF;
BEGIN TRANSACTION;
CREATE TABLE calendar_events (
  id TEXT PRIMARY KEY,
  summary TEXT NOT NULL,
  description TEXT,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  synced_at TEXT NOT NULL DEFAULT (datetime('now')),
  converted_to_task INTEGER DEFAULT 0
);
COMMIT;
