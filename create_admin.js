const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');

async function createAdmin() {
  const username = 'admin';
  const password = 'admin123'; // Измените на более безопасный пароль!
  
  console.log('Проверка существования пользователя admin...');
  
  db.get('SELECT username FROM users WHERE username = ?', [username], async (err, row) => {
    if (err) {
      console.error('Ошибка проверки БД:', err);
      process.exit(1);
    }
    
    if (row) {
      console.log('✓ Пользователь admin уже существует');
      process.exit(0);
    }
    
    console.log('Создание пользователя admin...');
    
    try {
      const passwordHash = await bcrypt.hash(password, 10);
      const id = uuidv4();
      const createdAt = new Date().toISOString();
      
      db.run(
        'INSERT INTO users (id, username, password_hash, phone, email, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [id, username, passwordHash, '', 'admin@example.com', createdAt],
        function(insertErr) {
          if (insertErr) {
            console.error('✗ Ошибка создания пользователя:', insertErr);
            process.exit(1);
          }
          
          console.log('✓ Пользователь admin успешно создан!');
          console.log('  Username: admin');
          console.log('  Password: admin123');
          console.log('');
          console.log('⚠ ВАЖНО: Измените пароль после первого входа!');
          process.exit(0);
        }
      );
    } catch (error) {
      console.error('✗ Ошибка хеширования пароля:', error);
      process.exit(1);
    }
  });
}

createAdmin();

