const db = require('./db');

console.log('Начинаем миграцию: удаление avatar_url из таблицы users...');

db.serialize(() => {
  // Проверяем наличие колонки avatar_url
  db.all("PRAGMA table_info(users)", (err, rows) => {
    if (err) {
      console.error('✗ Ошибка проверки структуры таблицы:', err);
      process.exit(1);
    }

    const hasAvatarUrl = rows.some(row => row.name === 'avatar_url');
    
    if (!hasAvatarUrl) {
      console.log('✓ Колонка avatar_url уже отсутствует в таблице users');
      console.log('✓ Миграция не требуется');
      process.exit(0);
    }

    console.log('⚠ Найдена колонка avatar_url, начинаем удаление...');
    
    // SQLite не поддерживает DROP COLUMN напрямую, поэтому нужно пересоздать таблицу
    db.run('BEGIN TRANSACTION', (beginErr) => {
      if (beginErr) {
        console.error('✗ Ошибка начала транзакции:', beginErr);
        process.exit(1);
      }

      // Создаем временную таблицу без avatar_url
      db.run(`
        CREATE TABLE users_new (
          id TEXT PRIMARY KEY,
          username TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          phone TEXT,
          email TEXT,
          created_at TEXT NOT NULL,
          last_seen TEXT,
          display_name TEXT
        )
      `, (createErr) => {
        if (createErr) {
          console.error('✗ Ошибка создания временной таблицы:', createErr);
          db.run('ROLLBACK');
          process.exit(1);
        }

        // Копируем данные (без avatar_url)
        db.run(`
          INSERT INTO users_new (id, username, password_hash, phone, email, created_at, last_seen, display_name)
          SELECT id, username, password_hash, phone, email, created_at, last_seen, display_name
          FROM users
        `, (copyErr) => {
          if (copyErr) {
            console.error('✗ Ошибка копирования данных:', copyErr);
            db.run('ROLLBACK');
            process.exit(1);
          }

          // Удаляем старую таблицу
          db.run('DROP TABLE users', (dropErr) => {
            if (dropErr) {
              console.error('✗ Ошибка удаления старой таблицы:', dropErr);
              db.run('ROLLBACK');
              process.exit(1);
            }

            // Переименовываем новую таблицу
            db.run('ALTER TABLE users_new RENAME TO users', (renameErr) => {
              if (renameErr) {
                console.error('✗ Ошибка переименования таблицы:', renameErr);
                db.run('ROLLBACK');
                process.exit(1);
              }

              // Коммитим транзакцию
              db.run('COMMIT', (commitErr) => {
                if (commitErr) {
                  console.error('✗ Ошибка завершения транзакции:', commitErr);
                  db.run('ROLLBACK');
                  process.exit(1);
                }

                console.log('✓ Колонка avatar_url успешно удалена из таблицы users');
                console.log('✓ Все данные пользователей сохранены');
                console.log('✓ Миграция завершена успешно!');
                process.exit(0);
              });
            });
          });
        });
      });
    });
  });
});

