const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const DB_PATH = path.join(__dirname, 'data.sqlite');
const db = new sqlite3.Database(DB_PATH);

db.serialize(() => {
  // Включаем поддержку внешних ключей
  db.run('PRAGMA foreign_keys = ON');
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    created_at TEXT NOT NULL,
    last_seen TEXT,
    display_name TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    participants_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    manager_id TEXT,
    model TEXT,
    topic TEXT,
    project_type TEXT,
    avatar_url TEXT,
    selected_stage_id TEXT,
    FOREIGN KEY(manager_id) REFERENCES users(id) ON DELETE SET NULL
  )`);

  // Безопасные миграции - добавляем столбцы только если их нет
  db.all("PRAGMA table_info(projects)", (err, rows) => {
    if (!err && rows) {
      const hasManagerId = rows.some(row => row.name === 'manager_id');
      const hasModel = rows.some(row => row.name === 'model');
      const hasTopic = rows.some(row => row.name === 'topic');
      const hasProjectType = rows.some(row => row.name === 'project_type');
      const hasAvatarUrl = rows.some(row => row.name === 'avatar_url');
      const hasSelectedStage = rows.some(row => row.name === 'selected_stage_id');
      if (!hasManagerId) {
        db.run('ALTER TABLE projects ADD COLUMN manager_id TEXT');
      }
      if (!hasModel) {
        db.run('ALTER TABLE projects ADD COLUMN model TEXT');
      }
      if (!hasTopic) {
        db.run('ALTER TABLE projects ADD COLUMN topic TEXT');
      }
      if (!hasProjectType) {
        db.run('ALTER TABLE projects ADD COLUMN project_type TEXT');
      }
      if (!hasAvatarUrl) {
        db.run('ALTER TABLE projects ADD COLUMN avatar_url TEXT');
      }
      if (!hasSelectedStage) {
        db.run('ALTER TABLE projects ADD COLUMN selected_stage_id TEXT');
      }
    }
  });

  // Безопасная миграция для users (last_seen, display_name)
  db.all("PRAGMA table_info(users)", (err, rows) => {
    if (!err && rows) {
      const hasLastSeen = rows.some(row => row.name === 'last_seen');
      const hasDisplayName = rows.some(row => row.name === 'display_name');
      
      if (!hasLastSeen) {
        db.run('ALTER TABLE users ADD COLUMN last_seen TEXT');
      }
      if (!hasDisplayName) {
        db.run('ALTER TABLE users ADD COLUMN display_name TEXT');
      }
    }
  });

  // Членство в проектах: какие пользователи участвуют в каких проектах
  // Обеспечиваем внешние ключи к users и projects с каскадным удалением
  db.run(`CREATE TABLE IF NOT EXISTS project_memberships (
    user_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    created_at TEXT NOT NULL,
    UNIQUE(user_id, project_id),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
  )`);

  // Безопасная миграция для столбца role
  db.all("PRAGMA table_info(project_memberships)", (err, rows) => {
    if (!err && rows) {
      const hasRole = rows.some(row => row.name === 'role');
      if (!hasRole) {
        db.run('ALTER TABLE project_memberships ADD COLUMN role TEXT DEFAULT "member"');
      }
    }
  });

  // Заявки на вступление в проект
  db.run(`CREATE TABLE IF NOT EXISTS project_join_requests (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    UNIQUE(project_id, user_id),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
  )`);

  // Заявки на повышение до заместителя
  db.run(`CREATE TABLE IF NOT EXISTS project_promotion_requests (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    UNIQUE(project_id, user_id),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
  )`);

  // Этапы проекта
  db.run(`CREATE TABLE IF NOT EXISTS project_stages (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    position INTEGER NOT NULL,
    UNIQUE(project_id, name),
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
  )`);

  // Группы файлов проекта (темы)
  db.run(`CREATE TABLE IF NOT EXISTS project_file_groups (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    topic TEXT NOT NULL,
    created_at TEXT NOT NULL,
    created_by TEXT NOT NULL,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE CASCADE
  )`);

  // Файлы в группах
  db.run(`CREATE TABLE IF NOT EXISTS project_files (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(group_id) REFERENCES project_file_groups(id) ON DELETE CASCADE
  )`);

  // Задачи проекта
  db.run(`CREATE TABLE IF NOT EXISTS project_tasks (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'in_progress',
    stage_id TEXT,
    created_at TEXT NOT NULL,
    created_by TEXT NOT NULL,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(stage_id) REFERENCES project_stages(id) ON DELETE SET NULL
  )`);

  // Безопасная миграция для project_tasks (status, stage_id)
  db.all("PRAGMA table_info(project_tasks)", (err, rows) => {
    if (!err && rows) {
      const hasStatus = rows.some(row => row.name === 'status');
      const hasStageId = rows.some(row => row.name === 'stage_id');
      
      if (!hasStatus) {
        db.run('ALTER TABLE project_tasks ADD COLUMN status TEXT DEFAULT "in_progress"', () => {
          db.run('UPDATE project_tasks SET status = "in_progress" WHERE status IS NULL');
        });
      }
      if (!hasStageId) {
        db.run('ALTER TABLE project_tasks ADD COLUMN stage_id TEXT');
      }
    }
  });

  // Файлы задач
  db.run(`CREATE TABLE IF NOT EXISTS project_task_files (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(task_id) REFERENCES project_tasks(id) ON DELETE CASCADE
  )`);
});

module.exports = db;


