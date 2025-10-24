const express = require('express');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const fs = require('fs');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 80;

// Сессии (срок действия - 7 дней)
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 } // 7 дней
}));

// Обновляем last_seen для авторизованных пользователей
app.use((req, res, next) => {
  if (req.session && req.session.user) {
    const now = new Date().toISOString();
    db.run('UPDATE users SET last_seen = ? WHERE id = ?', [now, req.session.user.id], () => {});
  }
  next();
});

// Парсинг тела запроса
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Отдача статических файлов
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Middleware для проверки прав администратора
const isAdmin = (req, res, next) => {
  if (!req.session.user || req.session.user.username !== 'admin') {
    return res.status(403).json({ ok: false, error: 'Admin access required' });
  }
  next();
};

// Базовые роуты для страниц (опционально, так как статические файлы уже отдаются)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/MyProjects', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'MyProjects.html'));
});

app.get('/Profile', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'Profile.html'));
});

app.get('/administrator', (req, res) => {
  // Проверяем права администратора
  if (!req.session.user || req.session.user.username !== 'admin') {
    return res.redirect('/');
  }
  res.sendFile(path.join(__dirname, 'public', 'administrator.html'));
});

// API: Авторизация
app.get('/api/me', (req, res) => {
  if (!req.session.user) return res.json({ ok: true, user: null });
  db.get('SELECT id, username, display_name, email, phone FROM users WHERE id = ?', [req.session.user.id], (err, row) => {
    if (err) return res.status(500).json({ ok: false, error: 'DB error' });
    if (!row) return res.json({ ok: true, user: null });
    
    // Добавляем информацию о необходимости перенаправления для admin
    if (row.username === 'admin') {
      res.json({ ok: true, user: row, isAdmin: true });
    } else {
      res.json({ ok: true, user: row });
    }
  });
});

// Публичная информация о пользователе (просмотр чужих профилей)
app.get('/api/users/:id', (req, res) => {
  const userId = req.params.id;
  db.get('SELECT id, username, display_name, email FROM users WHERE id = ?', [userId], (err, row) => {
    if (err) return res.status(500).json({ ok: false, error: 'DB error' });
    if (!row) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({ ok: true, user: row });
  });
});

app.post('/api/register', async (req, res) => {
  try {
    const { username, password, phone, email } = req.body || {};
    if (!username || !password) return res.status(400).json({ ok: false, error: 'Missing fields' });
    if (phone && !phone.startsWith('+')) return res.status(400).json({ ok: false, error: 'Phone must start with +' });
    
    // Проверяем на существование username, email или телефона
    db.get('SELECT username, email, phone FROM users WHERE username = ? OR email = ? OR phone = ?', 
      [username, email || '', phone || ''], async (err, row) => {
        try {
          if (err) return res.status(500).json({ ok: false, error: 'DB error' });
          if (row) {
            if (row.username === username) return res.status(409).json({ ok: false, error: 'Username taken' });
            if (row.email === email && email) return res.status(409).json({ ok: false, error: 'Email taken' });
            if (row.phone === phone && phone) return res.status(409).json({ ok: false, error: 'Phone taken' });
          }
          
          // Продолжаем регистрацию
          const passwordHash = await bcrypt.hash(password, 10);
          const id = uuidv4();
          const createdAt = new Date().toISOString();
          db.run(
            'INSERT INTO users (id, username, password_hash, phone, email, created_at) VALUES (?, ?, ?, ?, ?, ?)',
            [id, username, passwordHash, phone || '', email || '', createdAt],
            function(insertErr) {
              if (insertErr) {
                return res.status(500).json({ ok: false, error: 'DB error' });
              }
              req.session.user = { id, username };
              res.json({ ok: true, user: { id, username } });
            }
          );
        } catch (innerErr) {
          res.status(500).json({ ok: false, error: 'Server error' });
        }
      }
    );
  } catch (e) {
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ ok: false, error: 'Missing fields' });
  db.get('SELECT * FROM users WHERE username = ?', [username], async (err, row) => {
    if (err) return res.status(500).json({ ok: false, error: 'DB error' });
    if (!row) return res.status(401).json({ ok: false, error: 'Invalid credentials' });
    const match = await bcrypt.compare(password, row.password_hash);
    if (!match) return res.status(401).json({ ok: false, error: 'Invalid credentials' });
    req.session.user = { id: row.id, username: row.username };
    
    // Если это admin, перенаправляем на админ-панель
    if (row.username === 'admin') {
      res.json({ ok: true, user: { id: row.id, username: row.username }, redirect: '/administrator.html' });
    } else {
      res.json({ ok: true, user: { id: row.id, username: row.username } });
    }
  });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

// Обновление профиля (email, телефон, пароль)
app.post('/api/profile', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  const { email, phone, password } = req.body || {};
  
  // Проверяем формат телефона
  if (phone && !phone.startsWith('+')) return res.status(400).json({ ok: false, error: 'Phone must start with +' });
  
  try {
    // Проверяем на существование email или телефона (исключая текущего пользователя)
    if (email || phone) {
      db.get('SELECT id, email, phone FROM users WHERE (email = ? OR phone = ?) AND id != ?', 
        [email || '', phone || '', req.session.user.id], async (err, row) => {
          try {
            if (err) return res.status(500).json({ ok: false, error: 'DB error' });
            if (row) {
              if (row.email === email && email) return res.status(409).json({ ok: false, error: 'Email taken' });
              if (row.phone === phone && phone) return res.status(409).json({ ok: false, error: 'Phone taken' });
            }
            
            // Продолжаем обновление
            const sets = [];
            const params = [];
            if (typeof email === 'string') { sets.push('email = ?'); params.push(email); }
            if (typeof phone === 'string') { sets.push('phone = ?'); params.push(phone); }
            if (typeof password === 'string' && password.length > 0) {
              const passwordHash = await bcrypt.hash(password, 10);
              sets.push('password_hash = ?');
              params.push(passwordHash);
            }
            if (sets.length === 0) return res.json({ ok: true });

            params.push(req.session.user.id);
            const sql = `UPDATE users SET ${sets.join(', ')} WHERE id = ?`;
            db.run(sql, params, function(updateErr) {
              if (updateErr) return res.status(500).json({ ok: false, error: 'DB error' });
              res.json({ ok: true });
            });
          } catch (innerErr) {
            res.status(500).json({ ok: false, error: 'Server error' });
          }
        }
      );
    } else {
      // Только обновление пароля, проверка email/телефона не нужна
      if (typeof password === 'string' && password.length > 0) {
        const passwordHash = await bcrypt.hash(password, 10);
        db.run('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, req.session.user.id], function(updateErr) {
          if (updateErr) return res.status(500).json({ ok: false, error: 'DB error' });
          res.json({ ok: true });
        });
      } else {
        res.json({ ok: true });
      }
    }
  } catch (e) {
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

// Список проектов
app.get('/api/projects', (req, res) => {
  const userId = req.session.user?.id || null;
  const sql = `
    SELECT p.id, p.name, p.participants_count, p.avatar_url,
           CASE WHEN m.user_id IS NOT NULL THEN 1 ELSE 0 END AS is_member,
           m.role
    FROM projects p
    LEFT JOIN project_memberships m
      ON m.project_id = p.id AND m.user_id = ?
    ORDER BY p.created_at DESC
  `;
  db.all(sql, [userId], (err, rows) => {
    if (err) return res.status(500).json({ ok: false, error: 'DB error' });
    res.json({ ok: true, projects: rows || [] });
  });
});

app.post('/api/projects', (req, res) => {
  if (!req.session.user) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  const { name, model, topic, projectType, avatarUrl } = req.body || {};
  if (!name || String(name).trim().length === 0) return res.status(400).json({ ok: false, error: 'Name required' });
  // Базовая валидация новых полей
  const modelValue = typeof model === 'string' ? model : '';
  const topicValue = typeof topic === 'string' ? topic : '';
  const projectTypeValue = typeof projectType === 'string' ? projectType : '';
  const avatarUrlValue = typeof avatarUrl === 'string' ? avatarUrl : '';
  const { v4: uuidv4 } = require('uuid');
  const id = uuidv4();
  const createdAt = new Date().toISOString();
  const managerId = req.session.user.id;

  db.serialize(() => {
    db.run('BEGIN TRANSACTION');
    db.run(
      'INSERT INTO projects (id, name, participants_count, created_at, manager_id, model, topic, project_type, avatar_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, String(name).trim(), 1, createdAt, managerId, modelValue, topicValue, projectTypeValue, avatarUrlValue],
      function(err){
        if (err) {
          db.run('ROLLBACK');
          return res.status(500).json({ ok: false, error: 'DB error' });
        }
        // Вставляем этапы по умолчанию на основе модели
        const lower = (modelValue || '').toLowerCase();
        let stages = [];
        if (['каскадная','waterfall'].includes(lower)) stages = ['Требования','Проектирование','Реализация','Тестирование','Ввод в эксплуатацию'];
        else if (['v-образная','v-shaped','v shaped','vmodel'].includes(lower)) stages = ['Требования','Проектирование','Дизайн','Реализация','Верификация','Валидация'];
        else if (['спиральная','spiral'].includes(lower)) stages = ['Планирование','Риски','Разработка','Тестирование'];
        else if (['iterative','итеративная','итерационная'].includes(lower)) stages = ['Итерация 1','Итерация 2','Итерация 3','Итерация 4'];
        else stages = ['Этап 1','Этап 2','Этап 3'];

        const { v4: uuidv4 } = require('uuid');
        let insertedFirstStageId = null;
        stages.forEach((name, idx) => {
          const sid = uuidv4();
          if (idx === 0) insertedFirstStageId = sid;
          db.run('INSERT INTO project_stages (id, project_id, name, position) VALUES (?, ?, ?, ?)', [sid, id, name, idx], () => {});
        });
        // Вставляем членство и коммитим
        db.run(
          'INSERT OR IGNORE INTO project_memberships (user_id, project_id, role, created_at) VALUES (?, ?, ?, ?)',
          [managerId, id, 'manager', createdAt],
          function(memErr){
            if (memErr) {
              db.run('ROLLBACK');
              return res.status(500).json({ ok: false, error: 'DB error' });
            }
            db.run('UPDATE projects SET selected_stage_id = ? WHERE id = ?', [insertedFirstStageId, id], function(){
              db.run('COMMIT', (commitErr) => {
                if (commitErr) return res.status(500).json({ ok: false, error: 'DB error' });
                res.json({ ok: true, project: { id, name: String(name).trim(), participants_count: 1, manager_id: managerId, model: modelValue, topic: topicValue, project_type: projectTypeValue, avatar_url: avatarUrlValue } });
              });
            });
          }
        );
      }
    );
  });
});

// Список проектов, в которых участвует текущий пользователь
app.get('/api/my-projects', (req, res) => {
  if (!req.session.user) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  const sql = `
    SELECT p.id, p.name, p.participants_count, p.avatar_url, m.role
    FROM projects p
    JOIN project_memberships m ON m.project_id = p.id
    WHERE m.user_id = ?
    ORDER BY p.created_at DESC
  `;
  db.all(sql, [req.session.user.id], (err, rows) => {
    if (err) return res.status(500).json({ ok: false, error: 'DB error' });
    res.json({ ok: true, projects: rows || [] });
  });
});

// Детали проекта
app.get('/api/projects/:id', (req, res) => {
  const projectId = req.params.id;
  db.get('SELECT id, name, avatar_url, model, topic, project_type, participants_count, manager_id, selected_stage_id FROM projects WHERE id = ?', [projectId], (err, row) => {
    if (err) return res.status(500).json({ ok: false, error: 'DB error' });
    if (!row) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({ ok: true, project: row });
  });
});

// Обновление проекта (только управляющий)
app.put('/api/projects/:id', (req, res) => {
  if (!req.session.user) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  const projectId = req.params.id;
  const userId = req.session.user.id;
  const { name, model, topic, projectType, avatarUrl } = req.body || {};

  // Проверяем, что пользователь является управляющим
  db.get('SELECT role FROM project_memberships WHERE project_id = ? AND user_id = ?', [projectId, userId], (err, membership) => {
    if (err) return res.status(500).json({ ok: false, error: 'DB error' });
    if (!membership || membership.role !== 'manager') {
      return res.status(403).json({ ok: false, error: 'Only manager can update project' });
    }

    // Валидация: название обязательно
    if (!name || String(name).trim().length === 0) {
      return res.status(400).json({ ok: false, error: 'Name required' });
    }

    const sets = [];
    const params = [];

    sets.push('name = ?');
    params.push(String(name).trim());

    if (typeof model === 'string') {
      sets.push('model = ?');
      params.push(model);
    }

    if (typeof topic === 'string') {
      sets.push('topic = ?');
      params.push(topic);
    }

    if (typeof projectType === 'string') {
      sets.push('project_type = ?');
      params.push(projectType);
    }

    if (typeof avatarUrl === 'string') {
      sets.push('avatar_url = ?');
      params.push(avatarUrl);
    }

    params.push(projectId);
    const sql = `UPDATE projects SET ${sets.join(', ')} WHERE id = ?`;

    db.run(sql, params, function(updateErr) {
      if (updateErr) return res.status(500).json({ ok: false, error: 'DB error' });
      if (this.changes === 0) return res.status(404).json({ ok: false, error: 'Project not found' });
      res.json({ ok: true });
    });
  });
});

// Удаление проекта (только управляющий)
app.delete('/api/projects/:id', (req, res) => {
  if (!req.session.user) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  const projectId = req.params.id;
  const userId = req.session.user.id;

  // Проверяем, что пользователь является управляющим
  db.get('SELECT role FROM project_memberships WHERE project_id = ? AND user_id = ?', [projectId, userId], (err, membership) => {
    if (err) return res.status(500).json({ ok: false, error: 'DB error' });
    if (!membership || membership.role !== 'manager') {
      return res.status(403).json({ ok: false, error: 'Only manager can delete project' });
    }

    // Удаляем проект (каскадное удаление членства и других связанных данных настроено через foreign keys)
    db.run('DELETE FROM projects WHERE id = ?', [projectId], function(deleteErr) {
      if (deleteErr) return res.status(500).json({ ok: false, error: 'DB error' });
      if (this.changes === 0) return res.status(404).json({ ok: false, error: 'Project not found' });
      res.json({ ok: true });
    });
  });
});

// Членство/роль текущего пользователя в проекте
app.get('/api/projects/:id/me', (req, res) => {
  if (!req.session.user) return res.json({ ok: true, membership: null });
  const projectId = req.params.id;
  const userId = req.session.user.id;
  db.get('SELECT role FROM project_memberships WHERE project_id = ? AND user_id = ?', [projectId, userId], (err, row) => {
    if (err) return res.status(500).json({ ok: false, error: 'DB error' });
    res.json({ ok: true, membership: row || null });
  });
});

// Список участников
app.get('/api/projects/:id/participants', (req, res) => {
  const projectId = req.params.id;
  const sql = `
    SELECT u.id, u.username, u.display_name, u.last_seen, m.role
    FROM project_memberships m
    JOIN users u ON u.id = m.user_id
    WHERE m.project_id = ?
    ORDER BY CASE m.role WHEN 'manager' THEN 1 WHEN 'deputy' THEN 2 ELSE 3 END, u.username
  `;
  db.all(sql, [projectId], (err, rows) => {
    if (err) return res.status(500).json({ ok: false, error: 'DB error' });
    const now = Date.now();
    const participants = (rows || []).map(r => {
      const last = r.last_seen ? Date.parse(r.last_seen) : 0;
      const online = last && (now - last) <= 2 * 60 * 1000; // 2 минуты
      return { id: r.id, username: r.username, display_name: r.display_name, role: r.role, online };
    });
    res.json({ ok: true, participants });
  });
});

// Кик участника (управляющий может кикнуть кого угодно; заместитель только участников)
app.post('/api/projects/:id/kick', (req, res) => {
  if (!req.session.user) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  const projectId = req.params.id;
  const { userId } = req.body || {};
  const actorId = req.session.user.id;
  if (!userId) return res.status(400).json({ ok: false, error: 'userId required' });
  const createdAt = new Date().toISOString();
  db.get('SELECT role FROM project_memberships WHERE project_id = ? AND user_id = ?', [projectId, actorId], (err, actor) => {
    if (err) return res.status(500).json({ ok: false, error: 'DB error' });
    if (!actor) return res.status(403).json({ ok: false, error: 'Forbidden' });
    db.get('SELECT role FROM project_memberships WHERE project_id = ? AND user_id = ?', [projectId, userId], (err2, target) => {
      if (err2) return res.status(500).json({ ok: false, error: 'DB error' });
      if (!target) return res.status(404).json({ ok: false, error: 'Not a member' });
      const rank = (r) => r === 'manager' ? 3 : (r === 'deputy' ? 2 : 1);
      if (rank(actor.role) <= rank(target.role)) return res.status(403).json({ ok: false, error: 'Insufficient role' });
      db.serialize(() => {
        db.run('BEGIN');
        db.run('DELETE FROM project_memberships WHERE project_id = ? AND user_id = ?', [projectId, userId]);
        db.run('UPDATE projects SET participants_count = MAX(participants_count - 1, 0) WHERE id = ?', [projectId]);
        db.run('COMMIT', (e) => {
          if (e) return res.status(500).json({ ok: false, error: 'DB error' });
          res.json({ ok: true });
        });
      });
    });
  });
});

// Повышение участника до заместителя (только для управляющего)
app.post('/api/projects/:id/promote', (req, res) => {
  if (!req.session.user) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  const projectId = req.params.id;
  const { userId } = req.body || {};
  const actorId = req.session.user.id;
  if (!userId) return res.status(400).json({ ok: false, error: 'userId required' });
  
  db.get('SELECT role FROM project_memberships WHERE project_id = ? AND user_id = ?', [projectId, actorId], (err, actor) => {
    if (err) return res.status(500).json({ ok: false, error: 'DB error' });
    if (!actor || actor.role !== 'manager') return res.status(403).json({ ok: false, error: 'Only manager can promote' });
    
    db.get('SELECT role FROM project_memberships WHERE project_id = ? AND user_id = ?', [projectId, userId], (err2, target) => {
      if (err2) return res.status(500).json({ ok: false, error: 'DB error' });
      if (!target) return res.status(404).json({ ok: false, error: 'Not a member' });
      if (target.role !== 'member') return res.status(400).json({ ok: false, error: 'Can only promote members' });
      
      db.run('UPDATE project_memberships SET role = "deputy" WHERE project_id = ? AND user_id = ?', [projectId, userId], function(updErr){
        if (updErr) return res.status(500).json({ ok: false, error: 'DB error' });
        res.json({ ok: true });
      });
    });
  });
});

// Понижение заместителя до участника (только для управляющего)
app.post('/api/projects/:id/demote', (req, res) => {
  if (!req.session.user) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  const projectId = req.params.id;
  const { userId } = req.body || {};
  const actorId = req.session.user.id;
  if (!userId) return res.status(400).json({ ok: false, error: 'userId required' });
  
  db.get('SELECT role FROM project_memberships WHERE project_id = ? AND user_id = ?', [projectId, actorId], (err, actor) => {
    if (err) return res.status(500).json({ ok: false, error: 'DB error' });
    if (!actor || actor.role !== 'manager') return res.status(403).json({ ok: false, error: 'Only manager can demote' });
    
    db.get('SELECT role FROM project_memberships WHERE project_id = ? AND user_id = ?', [projectId, userId], (err2, target) => {
      if (err2) return res.status(500).json({ ok: false, error: 'DB error' });
      if (!target) return res.status(404).json({ ok: false, error: 'Not a member' });
      if (target.role !== 'deputy') return res.status(400).json({ ok: false, error: 'Can only demote deputies' });
      
      db.run('UPDATE project_memberships SET role = "member" WHERE project_id = ? AND user_id = ?', [projectId, userId], function(updErr){
        if (updErr) return res.status(500).json({ ok: false, error: 'DB error' });
        res.json({ ok: true });
      });
    });
  });
});

// Отправка заявки на вступление (с главной страницы)
app.post('/api/projects/:id/request-join', (req, res) => {
  if (!req.session.user) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  const projectId = req.params.id;
  const userId = req.session.user.id;
  const createdAt = new Date().toISOString();
  // Если уже участник, заявка не нужна
  db.get('SELECT 1 FROM project_memberships WHERE project_id = ? AND user_id = ?', [projectId, userId], (memErr, memRow) => {
    if (memErr) return res.status(500).json({ ok: false, error: 'DB error' });
    if (memRow) return res.json({ ok: true, alreadyMember: true });
    // Проверяем существующую заявку и восстанавливаем или создаем новую
    db.get('SELECT id, status FROM project_join_requests WHERE project_id = ? AND user_id = ?', [projectId, userId], (selErr, reqRow) => {
      if (selErr) return res.status(500).json({ ok: false, error: 'DB error' });
      if (reqRow) {
        if (reqRow.status === 'pending') return res.json({ ok: true, alreadyPending: true });
        db.run('UPDATE project_join_requests SET status = "pending", created_at = ? WHERE id = ?', [createdAt, reqRow.id], function(updErr){
          if (updErr) return res.status(500).json({ ok: false, error: 'DB error' });
          res.json({ ok: true, revived: true });
        });
      } else {
        const id = uuidv4();
        db.run('INSERT INTO project_join_requests (id, project_id, user_id, status, created_at) VALUES (?, ?, ?, ?, ?)', [id, projectId, userId, 'pending', createdAt], function(insErr){
          if (insErr) return res.status(500).json({ ok: false, error: 'DB error' });
          res.json({ ok: true });
        });
      }
    });
  });
});

// Список заявок (управляющий/заместитель видят заявки на вступление; только управляющий видит заявки на повышение)
app.get('/api/projects/:id/requests', (req, res) => {
  if (!req.session.user) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  const projectId = req.params.id;
  const userId = req.session.user.id;
  db.get('SELECT role FROM project_memberships WHERE project_id = ? AND user_id = ?', [projectId, userId], (err, actor) => {
    if (err) return res.status(500).json({ ok: false, error: 'DB error' });
    if (!actor || (actor.role !== 'manager' && actor.role !== 'deputy')) {
      return res.status(403).json({ ok: false, error: 'Forbidden' });
    }
    const joinSql = `SELECT r.id, u.username, u.display_name, r.user_id, r.status FROM project_join_requests r JOIN users u ON u.id = r.user_id WHERE r.project_id = ? AND r.status = 'pending'`;
    const promSql = `SELECT r.id, u.username, u.display_name, r.user_id, r.status FROM project_promotion_requests r JOIN users u ON u.id = r.user_id WHERE r.project_id = ? AND r.status = 'pending'`;
    db.all(joinSql, [projectId], (e1, joins) => {
      if (e1) return res.status(500).json({ ok: false, error: 'DB error' });
      if (actor.role !== 'manager') {
        return res.json({ ok: true, joinRequests: joins || [], promotionRequests: [] });
      }
      db.all(promSql, [projectId], (e2, promos) => {
        if (e2) return res.status(500).json({ ok: false, error: 'DB error' });
        res.json({ ok: true, joinRequests: joins || [], promotionRequests: promos || [] });
      });
    });
  });
});

// Одобрение заявки на вступление (управляющий/заместитель)
app.post('/api/projects/:id/requests/:reqId/approve-join', (req, res) => {
  if (!req.session.user) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  const projectId = req.params.id; const reqId = req.params.reqId; const actorId = req.session.user.id;
  db.get('SELECT role FROM project_memberships WHERE project_id = ? AND user_id = ?', [projectId, actorId], (err, actor) => {
    if (err) return res.status(500).json({ ok: false, error: 'DB error' });
    if (!actor) return res.status(403).json({ ok: false, error: 'Forbidden' });
    db.get('SELECT * FROM project_join_requests WHERE id = ? AND project_id = ? AND status = "pending"', [reqId, projectId], (e1, reqRow) => {
      if (e1) return res.status(500).json({ ok: false, error: 'DB error' });
      if (!reqRow) return res.status(404).json({ ok: false, error: 'Not found' });
      const createdAt = new Date().toISOString();
      db.serialize(() => {
        db.run('BEGIN');
        db.run('UPDATE project_join_requests SET status = "approved" WHERE id = ?', [reqId]);
        db.run('INSERT OR IGNORE INTO project_memberships (user_id, project_id, role, created_at) VALUES (?, ?, ?, ?)', [reqRow.user_id, projectId, 'member', createdAt]);
        db.run('UPDATE projects SET participants_count = participants_count + 1 WHERE id = ?', [projectId]);
        db.run('COMMIT', (e) => {
          if (e) return res.status(500).json({ ok: false, error: 'DB error' });
          res.json({ ok: true });
        });
      });
    });
  });
});

// Отклонение заявки на вступление (управляющий/заместитель)
app.post('/api/projects/:id/requests/:reqId/reject-join', (req, res) => {
  if (!req.session.user) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  const projectId = req.params.id; const reqId = req.params.reqId; const actorId = req.session.user.id;
  db.get('SELECT role FROM project_memberships WHERE project_id = ? AND user_id = ?', [projectId, actorId], (err, actor) => {
    if (err) return res.status(500).json({ ok: false, error: 'DB error' });
    if (!actor || (actor.role !== 'manager' && actor.role !== 'deputy')) return res.status(403).json({ ok: false, error: 'Forbidden' });
    db.get('SELECT * FROM project_join_requests WHERE id = ? AND project_id = ? AND status = "pending"', [reqId, projectId], (e1, reqRow) => {
      if (e1) return res.status(500).json({ ok: false, error: 'DB error' });
      if (!reqRow) return res.status(404).json({ ok: false, error: 'Not found' });
      db.run('UPDATE project_join_requests SET status = "rejected" WHERE id = ?', [reqId], function(e2){
        if (e2) return res.status(500).json({ ok: false, error: 'DB error' });
        res.json({ ok: true });
      });
    });
  });
});

// Отправка заявки на повышение (только участники)
app.post('/api/projects/:id/request-promotion', (req, res) => {
  if (!req.session.user) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  const projectId = req.params.id; const userId = req.session.user.id; const createdAt = new Date().toISOString(); const id = uuidv4();
  db.get('SELECT role FROM project_memberships WHERE project_id = ? AND user_id = ?', [projectId, userId], (err, row) => {
    if (err) return res.status(500).json({ ok: false, error: 'DB error' });
    if (!row || row.role !== 'member') return res.status(403).json({ ok: false, error: 'Only members can request' });
    db.run('INSERT OR IGNORE INTO project_promotion_requests (id, project_id, user_id, status, created_at) VALUES (?, ?, ?, ?, ?)', [id, projectId, userId, 'pending', createdAt], function(e){
      if (e) return res.status(500).json({ ok: false, error: 'DB error' });
      res.json({ ok: true });
    });
  });
});

// Одобрение повышения (только управляющий)
app.post('/api/projects/:id/requests/:reqId/approve-promotion', (req, res) => {
  if (!req.session.user) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  const projectId = req.params.id; const reqId = req.params.reqId; const actorId = req.session.user.id;
  db.get('SELECT role FROM project_memberships WHERE project_id = ? AND user_id = ?', [projectId, actorId], (err, actor) => {
    if (err) return res.status(500).json({ ok: false, error: 'DB error' });
    if (!actor || actor.role !== 'manager') return res.status(403).json({ ok: false, error: 'Only manager' });
    db.get('SELECT * FROM project_promotion_requests WHERE id = ? AND project_id = ? AND status = "pending"', [reqId, projectId], (e1, reqRow) => {
      if (e1) return res.status(500).json({ ok: false, error: 'DB error' });
      if (!reqRow) return res.status(404).json({ ok: false, error: 'Not found' });
      db.serialize(() => {
        db.run('BEGIN');
        db.run('UPDATE project_promotion_requests SET status = "approved" WHERE id = ?', [reqId]);
        db.run('UPDATE project_memberships SET role = "deputy" WHERE project_id = ? AND user_id = ?', [projectId, reqRow.user_id]);
        db.run('COMMIT', (e) => {
          if (e) return res.status(500).json({ ok: false, error: 'DB error' });
          res.json({ ok: true });
        });
      });
    });
  });
});

// Отклонение повышения (только управляющий)
app.post('/api/projects/:id/requests/:reqId/reject-promotion', (req, res) => {
  if (!req.session.user) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  const projectId = req.params.id; const reqId = req.params.reqId; const actorId = req.session.user.id;
  db.get('SELECT role FROM project_memberships WHERE project_id = ? AND user_id = ?', [projectId, actorId], (err, actor) => {
    if (err) return res.status(500).json({ ok: false, error: 'DB error' });
    if (!actor || actor.role !== 'manager') return res.status(403).json({ ok: false, error: 'Only manager' });
    db.get('SELECT * FROM project_promotion_requests WHERE id = ? AND project_id = ? AND status = "pending"', [reqId, projectId], (e1, reqRow) => {
      if (e1) return res.status(500).json({ ok: false, error: 'DB error' });
      if (!reqRow) return res.status(404).json({ ok: false, error: 'Not found' });
      db.run('UPDATE project_promotion_requests SET status = "rejected" WHERE id = ?', [reqId], function(e2){
        if (e2) return res.status(500).json({ ok: false, error: 'DB error' });
        res.json({ ok: true });
      });
    });
  });
});

// Покинуть проект (не разрешено для управляющего)
app.post('/api/projects/:id/leave', (req, res) => {
  if (!req.session.user) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  const projectId = req.params.id; const userId = req.session.user.id;
  db.get('SELECT role FROM project_memberships WHERE project_id = ? AND user_id = ?', [projectId, userId], (err, row) => {
    if (err) return res.status(500).json({ ok: false, error: 'DB error' });
    if (!row) return res.status(404).json({ ok: false, error: 'Not a member' });
    if (row.role === 'manager') return res.status(403).json({ ok: false, error: 'Manager cannot leave' });
    db.serialize(() => {
      db.run('BEGIN');
      db.run('DELETE FROM project_memberships WHERE project_id = ? AND user_id = ?', [projectId, userId]);
      db.run('UPDATE projects SET participants_count = MAX(participants_count - 1, 0) WHERE id = ?', [projectId]);
      db.run('COMMIT', (e) => {
        if (e) return res.status(500).json({ ok: false, error: 'DB error' });
        res.json({ ok: true });
      });
    });
  });
});

// Присоединиться к проекту
app.post('/api/projects/:id/join', (req, res) => {
  if (!req.session.user) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  const projectId = req.params.id;
  const userId = req.session.user.id;
  const createdAt = new Date().toISOString();
  // Вставляем членство если не существует, затем обновляем счетчик если была вставка
  db.run(
    'INSERT OR IGNORE INTO project_memberships (user_id, project_id, created_at) VALUES (?, ?, ?)',
    [userId, projectId, createdAt],
    function(err) {
      if (err) return res.status(500).json({ ok: false, error: 'DB error' });
      const changes = this.changes || 0; // 1 если была вставка новой строки, 0 если уже участник
      if (changes === 0) {
        return res.json({ ok: true, joined: false, alreadyMember: true });
      }
      db.run(
        'UPDATE projects SET participants_count = participants_count + 1 WHERE id = ?',
        [projectId],
        function(updateErr) {
          if (updateErr) return res.status(500).json({ ok: false, error: 'DB error' });
          db.get('SELECT id, name, participants_count FROM projects WHERE id = ?', [projectId], (selErr, row) => {
            if (selErr) return res.status(500).json({ ok: false, error: 'DB error' });
            res.json({ ok: true, joined: true, project: row });
          });
        }
      );
    }
  );
});

// Настройка multer для загрузки файлов
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}-${file.originalname}`;
    cb(null, uniqueName);
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB max
});

// API для файлов проекта
// Загрузка файлов
app.post('/api/project-files', upload.array('files', 10), (req, res) => {
  if (!req.session.user) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  
  const { projectId, topic } = req.body || {};
  const userId = req.session.user.id;
  const uploadedFiles = req.files || [];

  if (!projectId || !topic || uploadedFiles.length === 0) {
    // Удаляем загруженные файлы при ошибке
    uploadedFiles.forEach(file => {
      try { fs.unlinkSync(file.path); } catch {}
    });
    return res.status(400).json({ ok: false, error: 'Missing required fields' });
  }

  // Проверяем членство в проекте
  db.get('SELECT 1 FROM project_memberships WHERE project_id = ? AND user_id = ?', [projectId, userId], (err, membership) => {
    if (err || !membership) {
      uploadedFiles.forEach(file => {
        try { fs.unlinkSync(file.path); } catch {}
      });
      return res.status(403).json({ ok: false, error: 'Not a member' });
    }

    const groupId = uuidv4();
    const createdAt = new Date().toISOString();

    db.serialize(() => {
      db.run('BEGIN TRANSACTION');

      // Создаем группу файлов
      db.run(
        'INSERT INTO project_file_groups (id, project_id, topic, created_at, created_by) VALUES (?, ?, ?, ?, ?)',
        [groupId, projectId, topic, createdAt, userId],
        function(groupErr) {
          if (groupErr) {
            db.run('ROLLBACK');
            uploadedFiles.forEach(file => {
              try { fs.unlinkSync(file.path); } catch {}
            });
            return res.status(500).json({ ok: false, error: 'DB error' });
          }

          // Добавляем файлы
          let insertedCount = 0;
          uploadedFiles.forEach(file => {
            const fileId = uuidv4();
            db.run(
              'INSERT INTO project_files (id, group_id, filename, file_path, file_size, created_at) VALUES (?, ?, ?, ?, ?, ?)',
              [fileId, groupId, file.originalname, file.path, file.size, createdAt],
              function(fileErr) {
                if (fileErr) {
                  db.run('ROLLBACK');
                  uploadedFiles.forEach(f => {
                    try { fs.unlinkSync(f.path); } catch {}
                  });
                  return res.status(500).json({ ok: false, error: 'DB error' });
                }
                
                insertedCount++;
                if (insertedCount === uploadedFiles.length) {
                  db.run('COMMIT', (commitErr) => {
                    if (commitErr) {
                      uploadedFiles.forEach(f => {
                        try { fs.unlinkSync(f.path); } catch {}
                      });
                      return res.status(500).json({ ok: false, error: 'DB error' });
                    }
                    res.json({ ok: true, groupId });
                  });
                }
              }
            );
          });
        }
      );
    });
  });
});

// Получение групп файлов проекта
app.get('/api/projects/:id/file-groups', (req, res) => {
  const projectId = req.params.id;
  
  const sql = `
    SELECT 
      g.id, 
      g.topic, 
      g.created_at, 
      g.created_by,
      u.username as created_by_username
    FROM project_file_groups g
    LEFT JOIN users u ON u.id = g.created_by
    WHERE g.project_id = ?
    ORDER BY g.created_at DESC
  `;

  db.all(sql, [projectId], (err, groups) => {
    if (err) return res.status(500).json({ ok: false, error: 'DB error' });
    
    if (!groups || groups.length === 0) {
      return res.json({ ok: true, groups: [] });
    }

    // Загружаем файлы для каждой группы
    const groupsWithFiles = [];
    let processed = 0;

    groups.forEach(group => {
      db.all('SELECT id, filename, file_size, created_at FROM project_files WHERE group_id = ?', [group.id], (fileErr, files) => {
        if (!fileErr) {
          group.files = files || [];
        } else {
          group.files = [];
        }
        
        groupsWithFiles.push(group);
        processed++;

        if (processed === groups.length) {
          res.json({ ok: true, groups: groupsWithFiles });
        }
      });
    });
  });
});

// Получить все файлы проекта (из групп файлов и из задач)
app.get('/api/projects/:id/all-files', (req, res) => {
  const projectId = req.params.id;
  
  // Получаем файлы из групп файлов
  const fileGroupsSql = `
    SELECT 
      g.id, 
      g.topic, 
      g.created_at, 
      g.created_by,
      u.username as created_by_username,
      'file_group' as source_type,
      NULL as task_id,
      NULL as task_title
    FROM project_file_groups g
    LEFT JOIN users u ON u.id = g.created_by
    WHERE g.project_id = ?
  `;

  // Получаем задачи с файлами
  const tasksSql = `
    SELECT 
      t.id,
      t.title as topic,
      t.created_at,
      t.created_by,
      u.username as created_by_username,
      'task' as source_type,
      t.id as task_id,
      t.title as task_title
    FROM project_tasks t
    LEFT JOIN users u ON u.id = t.created_by
    WHERE t.project_id = ? AND EXISTS (SELECT 1 FROM project_task_files WHERE task_id = t.id)
  `;

  db.all(fileGroupsSql, [projectId], (err1, fileGroups) => {
    if (err1) return res.status(500).json({ ok: false, error: 'DB error' });

    db.all(tasksSql, [projectId], (err2, tasks) => {
      if (err2) return res.status(500).json({ ok: false, error: 'DB error' });

      const allGroups = [...(fileGroups || []), ...(tasks || [])];

      if (allGroups.length === 0) {
        return res.json({ ok: true, groups: [] });
      }

      // Загружаем файлы для каждой группы
      const groupsWithFiles = [];
      let processed = 0;

      allGroups.forEach(group => {
        if (group.source_type === 'file_group') {
          db.all('SELECT id, filename, file_size, created_at FROM project_files WHERE group_id = ?', [group.id], (fileErr, files) => {
            group.files = fileErr ? [] : (files || []);
            groupsWithFiles.push(group);
            processed++;
            if (processed === allGroups.length) {
              res.json({ ok: true, groups: groupsWithFiles });
            }
          });
        } else {
          db.all('SELECT id, filename, file_size, created_at FROM project_task_files WHERE task_id = ?', [group.id], (fileErr, files) => {
            group.files = fileErr ? [] : (files || []);
            groupsWithFiles.push(group);
            processed++;
            if (processed === allGroups.length) {
              res.json({ ok: true, groups: groupsWithFiles });
            }
          });
        }
      });
    });
  });
});

// Скачивание файла
app.get('/api/project-files/:fileId/download', (req, res) => {
  const fileId = req.params.fileId;

  db.get('SELECT * FROM project_files WHERE id = ?', [fileId], (err, file) => {
    if (err) return res.status(500).json({ ok: false, error: 'DB error' });
    if (!file) return res.status(404).json({ ok: false, error: 'File not found' });

    // Проверяем существование файла
    if (!fs.existsSync(file.file_path)) {
      return res.status(404).json({ ok: false, error: 'File not found on disk' });
    }

    res.download(file.file_path, file.filename);
  });
});

// Удаление файла
app.delete('/api/project-files/:fileId', (req, res) => {
  if (!req.session.user) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  
  const fileId = req.params.fileId;
  const userId = req.session.user.id;

  // Получаем информацию о файле и проверяем права
  const sql = `
    SELECT f.*, g.project_id, g.created_by
    FROM project_files f
    JOIN project_file_groups g ON g.id = f.group_id
    WHERE f.id = ?
  `;

  db.get(sql, [fileId], (err, file) => {
    if (err) return res.status(500).json({ ok: false, error: 'DB error' });
    if (!file) return res.status(404).json({ ok: false, error: 'File not found' });

    // Проверяем права: управляющий, заместитель или создатель группы
    db.get(
      'SELECT role FROM project_memberships WHERE project_id = ? AND user_id = ?',
      [file.project_id, userId],
      (memErr, membership) => {
        if (memErr) return res.status(500).json({ ok: false, error: 'DB error' });
        
        const canDelete = membership && (
          membership.role === 'manager' || 
          membership.role === 'deputy' || 
          file.created_by === userId
        );

        if (!canDelete) {
          return res.status(403).json({ ok: false, error: 'Forbidden' });
        }

        // Удаляем файл из БД
        db.run('DELETE FROM project_files WHERE id = ?', [fileId], function(delErr) {
          if (delErr) return res.status(500).json({ ok: false, error: 'DB error' });

          // Удаляем файл с диска
          try {
            if (fs.existsSync(file.file_path)) {
              fs.unlinkSync(file.file_path);
            }
          } catch (fsErr) {
            console.error('Error deleting file from disk:', fsErr);
          }

          // Проверяем, остались ли файлы в группе
          db.get('SELECT COUNT(*) as count FROM project_files WHERE group_id = ?', [file.group_id], (cntErr, result) => {
            if (!cntErr && result && result.count === 0) {
              // Удаляем пустую группу
              db.run('DELETE FROM project_file_groups WHERE id = ?', [file.group_id]);
            }
            res.json({ ok: true });
          });
        });
      }
    );
  });
});

// === TASKS ENDPOINTS ===

// Получение задач проекта
app.get('/api/projects/:id/tasks', (req, res) => {
  const projectId = req.params.id;
  
  const sql = `
    SELECT 
      t.id, 
      t.title, 
      t.description,
      t.status,
      t.stage_id,
      t.created_at, 
      t.created_by,
      u.username as created_by_username,
      s.name as stage_name
    FROM project_tasks t
    LEFT JOIN users u ON u.id = t.created_by
    LEFT JOIN project_stages s ON s.id = t.stage_id
    WHERE t.project_id = ?
    ORDER BY t.created_at DESC
  `;

  db.all(sql, [projectId], (err, tasks) => {
    if (err) return res.status(500).json({ ok: false, error: 'DB error' });
    
    if (!tasks || tasks.length === 0) {
      return res.json({ ok: true, tasks: [] });
    }

    // Загружаем файлы для каждой задачи
    const tasksWithFiles = [];
    let processed = 0;

    tasks.forEach(task => {
      db.all('SELECT id, filename, file_size, created_at FROM project_task_files WHERE task_id = ?', [task.id], (fileErr, files) => {
        if (!fileErr) {
          task.files = files || [];
        } else {
          task.files = [];
        }
        
        tasksWithFiles.push(task);
        processed++;

        if (processed === tasks.length) {
          res.json({ ok: true, tasks: tasksWithFiles });
        }
      });
    });
  });
});

// Создание задачи
app.post('/api/projects/:id/tasks', upload.array('files', 10), (req, res) => {
  if (!req.session.user) return res.status(401).json({ ok: false, error: 'Unauthorized' });

  const projectId = req.params.id;
  const userId = req.session.user.id;
  const { title, description, stageId } = req.body;

  console.log('Creating task:', { projectId, userId, title, description, stageId, filesCount: req.files?.length || 0 });

  if (!title || !title.trim()) {
    // Удаляем загруженные файлы если есть
    if (req.files) {
      req.files.forEach(file => {
        if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
      });
    }
    return res.status(400).json({ ok: false, error: 'Title required' });
  }

  // Проверяем права: управляющий или заместитель
  db.get(
    'SELECT role FROM project_memberships WHERE project_id = ? AND user_id = ?',
    [projectId, userId],
    (memErr, membership) => {
      if (memErr) return res.status(500).json({ ok: false, error: 'DB error' });
      
      if (!membership || (membership.role !== 'manager' && membership.role !== 'deputy')) {
        // Удаляем загруженные файлы
        if (req.files) {
          req.files.forEach(file => {
            if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
          });
        }
        return res.status(403).json({ ok: false, error: 'Only manager/deputy can create tasks' });
      }

      const taskId = Date.now().toString(36) + Math.random().toString(36).substring(2);
      const createdAt = new Date().toISOString();
      const status = 'in_progress'; // По умолчанию статус "выполняется"

      // Создаем задачу
      db.run(
        'INSERT INTO project_tasks (id, project_id, title, description, status, stage_id, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [taskId, projectId, title.trim(), description?.trim() || null, status, stageId || null, createdAt, userId],
        function(taskErr) {
          if (taskErr) {
            // Удаляем загруженные файлы
            if (req.files) {
              req.files.forEach(file => {
                if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
              });
            }
            return res.status(500).json({ ok: false, error: 'DB error' });
          }

          // Если есть файлы, добавляем их
          if (req.files && req.files.length > 0) {
            let filesAdded = 0;
            req.files.forEach(file => {
              const fileId = Date.now().toString(36) + Math.random().toString(36).substring(2);
              db.run(
                'INSERT INTO project_task_files (id, task_id, filename, file_path, file_size, created_at) VALUES (?, ?, ?, ?, ?, ?)',
                [fileId, taskId, file.originalname, file.path, file.size, createdAt],
                (fileInsertErr) => {
                  if (fileInsertErr) {
                    console.error('Error inserting file:', fileInsertErr);
                    if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
                  }
                  filesAdded++;
                  if (filesAdded === req.files.length) {
                    console.log('Task created successfully:', taskId);
                    res.json({ ok: true, taskId });
                  }
                }
              );
            });
          } else {
            console.log('Task created successfully (no files):', taskId);
            res.json({ ok: true, taskId });
          }
        }
      );
    }
  );
});

// Добавление файлов к существующей задаче
app.post('/api/projects/:id/tasks/:taskId/files', upload.array('files', 10), (req, res) => {
  if (!req.session.user) return res.status(401).json({ ok: false, error: 'Unauthorized' });

  const projectId = req.params.id;
  const taskId = req.params.taskId;
  const userId = req.session.user.id;

  console.log('Adding files to task:', { projectId, taskId, userId, filesCount: req.files?.length || 0 });

  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ ok: false, error: 'No files provided' });
  }

  // Проверяем членство в проекте (все участники могут добавлять файлы к задачам)
  db.get(
    'SELECT role FROM project_memberships WHERE project_id = ? AND user_id = ?',
    [projectId, userId],
    (memErr, membership) => {
      if (memErr) {
        // Удаляем загруженные файлы
        req.files.forEach(file => {
          if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
        });
        return res.status(500).json({ ok: false, error: 'DB error' });
      }
      
      if (!membership) {
        // Удаляем загруженные файлы
        req.files.forEach(file => {
          if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
        });
        return res.status(403).json({ ok: false, error: 'Not a member of this project' });
      }

      const createdAt = new Date().toISOString();
      let filesAdded = 0;

      req.files.forEach(file => {
        const fileId = Date.now().toString(36) + Math.random().toString(36).substring(2);
        db.run(
          'INSERT INTO project_task_files (id, task_id, filename, file_path, file_size, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          [fileId, taskId, file.originalname, file.path, file.size, createdAt],
          (fileInsertErr) => {
            if (fileInsertErr) {
              console.error('Error inserting file:', fileInsertErr);
              if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
            }
            filesAdded++;
            if (filesAdded === req.files.length) {
              console.log('Files added to task successfully');
              res.json({ ok: true });
            }
          }
        );
      });
    }
  );
});

// Скачивание файла задачи
app.get('/api/projects/:id/tasks/:taskId/files/:fileId/download', (req, res) => {
  const fileId = req.params.fileId;

  db.get('SELECT * FROM project_task_files WHERE id = ?', [fileId], (err, file) => {
    if (err) return res.status(500).json({ ok: false, error: 'DB error' });
    if (!file) return res.status(404).json({ ok: false, error: 'File not found' });

    // Проверяем существование файла
    if (!fs.existsSync(file.file_path)) {
      return res.status(404).json({ ok: false, error: 'File not found on disk' });
    }

    res.download(file.file_path, file.filename);
  });
});

// Удаление файла задачи
app.delete('/api/projects/:id/tasks/:taskId/files/:fileId', (req, res) => {
  if (!req.session.user) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  
  const fileId = req.params.fileId;
  const userId = req.session.user.id;
  const projectId = req.params.id;

  // Получаем информацию о файле
  const sql = `
    SELECT f.*, t.created_by
    FROM project_task_files f
    JOIN project_tasks t ON t.id = f.task_id
    WHERE f.id = ?
  `;

  db.get(sql, [fileId], (err, file) => {
    if (err) return res.status(500).json({ ok: false, error: 'DB error' });
    if (!file) return res.status(404).json({ ok: false, error: 'File not found' });

    // Проверяем права: управляющий, заместитель или создатель задачи
    db.get(
      'SELECT role FROM project_memberships WHERE project_id = ? AND user_id = ?',
      [projectId, userId],
      (memErr, membership) => {
        if (memErr) return res.status(500).json({ ok: false, error: 'DB error' });
        
        const canDelete = membership && (
          membership.role === 'manager' || 
          membership.role === 'deputy' || 
          file.created_by === userId
        );

        if (!canDelete) {
          return res.status(403).json({ ok: false, error: 'Forbidden' });
        }

        // Удаляем файл из БД
        db.run('DELETE FROM project_task_files WHERE id = ?', [fileId], function(delErr) {
          if (delErr) return res.status(500).json({ ok: false, error: 'DB error' });

          // Удаляем файл с диска
          try {
            if (fs.existsSync(file.file_path)) {
              fs.unlinkSync(file.file_path);
            }
          } catch (fsErr) {
            console.error('Error deleting file from disk:', fsErr);
          }

          res.json({ ok: true });
        });
      }
    );
  });
});

// Удаление задачи
app.delete('/api/projects/:id/tasks/:taskId', (req, res) => {
  if (!req.session.user) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  
  const taskId = req.params.taskId;
  const userId = req.session.user.id;
  const projectId = req.params.id;

  // Проверяем права: управляющий или заместитель
  db.get(
    'SELECT role FROM project_memberships WHERE project_id = ? AND user_id = ?',
    [projectId, userId],
    (memErr, membership) => {
      if (memErr) return res.status(500).json({ ok: false, error: 'DB error' });
      
      if (!membership || (membership.role !== 'manager' && membership.role !== 'deputy')) {
        return res.status(403).json({ ok: false, error: 'Only manager/deputy can delete tasks' });
      }

      // Получаем все файлы задачи для удаления с диска
      db.all('SELECT file_path FROM project_task_files WHERE task_id = ?', [taskId], (fileErr, files) => {
        if (fileErr) return res.status(500).json({ ok: false, error: 'DB error' });

        // Удаляем задачу (файлы удалятся автоматически через CASCADE)
        db.run('DELETE FROM project_tasks WHERE id = ?', [taskId], function(delErr) {
          if (delErr) return res.status(500).json({ ok: false, error: 'DB error' });

          // Удаляем файлы с диска
          if (files && files.length > 0) {
            files.forEach(file => {
              try {
                if (fs.existsSync(file.file_path)) {
                  fs.unlinkSync(file.file_path);
                }
              } catch (fsErr) {
                console.error('Error deleting file from disk:', fsErr);
              }
            });
          }

          res.json({ ok: true });
        });
      });
    }
  );
});

// Изменение статуса задачи
app.put('/api/projects/:id/tasks/:taskId/status', (req, res) => {
  if (!req.session.user) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  
  const taskId = req.params.taskId;
  const userId = req.session.user.id;
  const projectId = req.params.id;
  const { status } = req.body;

  // Проверка валидности статуса
  if (!status || !['in_progress', 'completed'].includes(status)) {
    return res.status(400).json({ ok: false, error: 'Invalid status' });
  }

  // Проверяем права: управляющий или заместитель
  db.get(
    'SELECT role FROM project_memberships WHERE project_id = ? AND user_id = ?',
    [projectId, userId],
    (memErr, membership) => {
      if (memErr) return res.status(500).json({ ok: false, error: 'DB error' });
      
      if (!membership || (membership.role !== 'manager' && membership.role !== 'deputy')) {
        return res.status(403).json({ ok: false, error: 'Only manager/deputy can change task status' });
      }

      // Получаем текущую задачу
      db.get('SELECT stage_id FROM project_tasks WHERE id = ? AND project_id = ?', [taskId, projectId], (taskErr, task) => {
        if (taskErr) return res.status(500).json({ ok: false, error: 'DB error' });
        if (!task) return res.status(404).json({ ok: false, error: 'Task not found' });

        // Обновляем статус задачи
        db.run('UPDATE project_tasks SET status = ? WHERE id = ?', [status, taskId], function(updateErr) {
          if (updateErr) return res.status(500).json({ ok: false, error: 'DB error' });

          // Если задача выполнена и привязана к этапу, переключаем проект на следующий этап
          if (status === 'completed' && task.stage_id) {
            // Получаем следующий этап
            db.get(
              `SELECT id FROM project_stages 
               WHERE project_id = ? AND position > (
                 SELECT position FROM project_stages WHERE id = ?
               )
               ORDER BY position ASC LIMIT 1`,
              [projectId, task.stage_id],
              (stageErr, nextStage) => {
                if (stageErr) {
                  console.error('Error getting next stage:', stageErr);
                  return res.json({ ok: true, stageChanged: false });
                }

                if (nextStage) {
                  // Обновляем выбранный этап проекта
                  db.run('UPDATE projects SET selected_stage_id = ? WHERE id = ?', [nextStage.id, projectId], (projErr) => {
                    if (projErr) {
                      console.error('Error updating project stage:', projErr);
                      return res.json({ ok: true, stageChanged: false });
                    }
                    res.json({ ok: true, stageChanged: true, newStageId: nextStage.id });
                  });
                } else {
                  // Нет следующего этапа
                  res.json({ ok: true, stageChanged: false, message: 'No next stage available' });
                }
              }
            );
          } else {
            res.json({ ok: true, stageChanged: false });
          }
        });
      });
    }
  );
});

// API: Обновление профиля пользователя
app.put('/api/profile', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  
  const { displayName, email, phone } = req.body || {};
  const userId = req.session.user.id;
  
  // Валидация телефона
  if (phone && !phone.startsWith('+')) {
    return res.status(400).json({ ok: false, error: 'Phone must start with +' });
  }
  
  // Проверка на уникальность email и phone (только если они переданы и не пустые)
  let checkSql = 'SELECT id FROM users WHERE id != ?';
  let checkParams = [userId];
  
  if (email && email.trim() !== '') {
    checkSql += ' AND email = ?';
    checkParams.push(email.trim());
  }
  
  if (phone && phone.trim() !== '') {
    checkSql += (email && email.trim() !== '' ? ' OR ' : ' AND ') + 'phone = ?';
    checkParams.push(phone.trim());
  }
  
  // Если нет email и phone для проверки, пропускаем проверку
  if (checkParams.length === 1) {
    checkSql = null;
  }
  
  const performUpdate = () => {
    // Обновляем профиль
    db.run(
      'UPDATE users SET display_name = ?, email = ?, phone = ? WHERE id = ?',
      [displayName || null, email || '', phone || '', userId],
      function(updateErr) {
        if (updateErr) {
          return res.status(500).json({ ok: false, error: 'DB error' });
        }
        
        // Возвращаем обновленные данные
        db.get('SELECT id, username, display_name, email, phone FROM users WHERE id = ?', [userId], (finalErr, updated) => {
          if (finalErr) return res.status(500).json({ ok: false, error: 'DB error' });
          res.json({ ok: true, user: updated });
        });
      }
    );
  };
  
  // Проверяем уникальность если нужно
  if (checkSql) {
    db.get(checkSql, checkParams, (err, row) => {
      if (err) {
        return res.status(500).json({ ok: false, error: 'DB error' });
      }
      if (row) {
        return res.status(409).json({ ok: false, error: 'Email or phone already taken' });
      }
      performUpdate();
    });
  } else {
    performUpdate();
  }
});

// ===== ADMIN API =====

// Получение данных таблицы
app.get('/api/admin/tables/:tableName', isAdmin, (req, res) => {
  const tableName = req.params.tableName;
  
  // Список разрешенных таблиц (защита от SQL injection)
  const allowedTables = [
    'users',
    'projects',
    'project_memberships',
    'project_join_requests',
    'project_promotion_requests',
    'project_stages',
    'project_file_groups',
    'project_files',
    'project_tasks',
    'project_task_files'
  ];
  
  if (!allowedTables.includes(tableName)) {
    return res.status(400).json({ ok: false, error: 'Invalid table name' });
  }
  
  // Получаем все данные из таблицы
  db.all(`SELECT * FROM ${tableName}`, [], (err, rows) => {
    if (err) {
      console.error('Error fetching table data:', err);
      return res.status(500).json({ ok: false, error: 'DB error' });
    }
    
    res.json({ ok: true, rows: rows || [] });
  });
});

// Удаление записи из таблицы
app.delete('/api/admin/tables/delete', isAdmin, (req, res) => {
  const { table, row } = req.body || {};
  
  if (!table || !row) {
    return res.status(400).json({ ok: false, error: 'Missing parameters' });
  }
  
  // Список разрешенных таблиц
  const allowedTables = [
    'users',
    'projects',
    'project_memberships',
    'project_join_requests',
    'project_promotion_requests',
    'project_stages',
    'project_file_groups',
    'project_files',
    'project_tasks',
    'project_task_files'
  ];
  
  if (!allowedTables.includes(table)) {
    return res.status(400).json({ ok: false, error: 'Invalid table name' });
  }
  
  // Определяем первичный ключ для каждой таблицы
  const primaryKeys = {
    'users': ['id'],
    'projects': ['id'],
    'project_memberships': ['user_id', 'project_id'],
    'project_join_requests': ['id'],
    'project_promotion_requests': ['id'],
    'project_stages': ['id'],
    'project_file_groups': ['id'],
    'project_files': ['id'],
    'project_tasks': ['id'],
    'project_task_files': ['id']
  };
  
  const keys = primaryKeys[table];
  if (!keys) {
    return res.status(400).json({ ok: false, error: 'Unknown primary key' });
  }
  
  // Строим WHERE clause
  const whereConditions = keys.map(key => `${key} = ?`).join(' AND ');
  const whereValues = keys.map(key => row[key]);
  
  // Проверяем, что все значения ключей присутствуют
  if (whereValues.some(val => val === undefined || val === null)) {
    return res.status(400).json({ ok: false, error: 'Missing primary key values' });
  }
  
  const sql = `DELETE FROM ${table} WHERE ${whereConditions}`;
  
  db.run(sql, whereValues, function(err) {
    if (err) {
      console.error('Error deleting row:', err);
      return res.status(500).json({ ok: false, error: 'DB error' });
    }
    
    if (this.changes === 0) {
      return res.status(404).json({ ok: false, error: 'Row not found' });
    }
    
    res.json({ ok: true, deleted: this.changes });
  });
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

// API этапов
app.get('/api/projects/:id/stages', (req, res) => {
  const projectId = req.params.id;
  db.all('SELECT id, name, position FROM project_stages WHERE project_id = ? ORDER BY position ASC', [projectId], (err, rows) => {
    if (err) return res.status(500).json({ ok: false, error: 'DB error' });
    res.json({ ok: true, stages: rows || [] });
  });
});

app.post('/api/projects/:id/stages', (req, res) => {
  if (!req.session.user) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  const projectId = req.params.id; const { name } = req.body || {};
  if (!name || String(name).trim().length === 0) return res.status(400).json({ ok: false, error: 'Name required' });
  db.get('SELECT role FROM project_memberships WHERE project_id = ? AND user_id = ?', [projectId, req.session.user.id], (err, row) => {
    if (err) return res.status(500).json({ ok: false, error: 'DB error' });
    if (!row || (row.role !== 'manager' && row.role !== 'deputy')) return res.status(403).json({ ok: false, error: 'Forbidden' });
    // Запрещаем добавление этапов для диаграммных моделей
    db.get('SELECT model FROM projects WHERE id = ?', [projectId], (mErr, proj) => {
      if (mErr) return res.status(500).json({ ok: false, error: 'DB error' });
      const model = String(proj?.model || '').toLowerCase();
      const isDiagram = ['каскадная','waterfall','v-образная','v-shaped','v shaped','vmodel','спиральная','spiral','iterative','итеративная','итерационная'].includes(model);
      if (isDiagram) return res.status(400).json({ ok: false, error: 'Stages cannot be added for this model' });
      db.get('SELECT MAX(position) as maxPos FROM project_stages WHERE project_id = ?', [projectId], (e2, maxRow) => {
      if (e2) return res.status(500).json({ ok: false, error: 'DB error' });
      const nextPos = (maxRow?.maxPos ?? -1) + 1;
      const id = uuidv4();
      db.run('INSERT INTO project_stages (id, project_id, name, position) VALUES (?, ?, ?, ?)', [id, projectId, String(name).trim(), nextPos], function(insErr){
        if (insErr) return res.status(500).json({ ok: false, error: 'DB error' });
        res.json({ ok: true, stage: { id, name: String(name).trim(), position: nextPos } });
      });
      });
    });
  });
});

app.post('/api/projects/:id/select-stage', (req, res) => {
  if (!req.session.user) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  const projectId = req.params.id; const { stageId } = req.body || {};
  if (!stageId) return res.status(400).json({ ok: false, error: 'stageId required' });
  
  db.get('SELECT role FROM project_memberships WHERE project_id = ? AND user_id = ?', [projectId, req.session.user.id], (err, row) => {
    if (err) return res.status(500).json({ ok: false, error: 'DB error' });
    if (!row || (row.role !== 'manager' && row.role !== 'deputy')) return res.status(403).json({ ok: false, error: 'Forbidden' });
    
    // Получаем текущий этап и новый этап с их позициями
    db.get('SELECT selected_stage_id FROM projects WHERE id = ?', [projectId], (projErr, project) => {
      if (projErr) return res.status(500).json({ ok: false, error: 'DB error' });
      
      const oldStageId = project?.selected_stage_id;
      
      // Получаем позиции старого и нового этапов
      const stageQuery = `
        SELECT id, position FROM project_stages 
        WHERE project_id = ? AND (id = ? OR id = ?)
      `;
      
      db.all(stageQuery, [projectId, oldStageId, stageId], (stagesErr, stages) => {
        if (stagesErr) return res.status(500).json({ ok: false, error: 'DB error' });
        
        const oldStage = stages.find(s => s.id === oldStageId);
        const newStage = stages.find(s => s.id === stageId);
        
        if (!newStage) return res.status(404).json({ ok: false, error: 'Stage not found' });
        
        const oldPosition = oldStage ? oldStage.position : -1;
        const newPosition = newStage.position;
        
        // Обновляем выбранный этап проекта
        db.run('UPDATE projects SET selected_stage_id = ? WHERE id = ?', [stageId, projectId], function(updErr){
          if (updErr) return res.status(500).json({ ok: false, error: 'DB error' });
          
          // Автоматическое изменение статусов задач
          if (oldPosition !== -1) {
            if (newPosition < oldPosition) {
              // Откат назад: возвращаем задачи привязанного этапа в работу
              db.run(
                'UPDATE project_tasks SET status = "in_progress" WHERE project_id = ? AND stage_id = ?',
                [projectId, stageId],
                (taskErr) => {
                  if (taskErr) console.error('Error updating task statuses on stage rollback:', taskErr);
                  res.json({ ok: true, stageDirection: 'backward' });
                }
              );
            } else if (newPosition > oldPosition) {
              // Переход вперед: завершаем задачи всех пройденных этапов
              db.run(
                `UPDATE project_tasks SET status = "completed" 
                 WHERE project_id = ? 
                 AND stage_id IN (
                   SELECT id FROM project_stages 
                   WHERE project_id = ? AND position < ?
                 )
                 AND status = "in_progress"`,
                [projectId, projectId, newPosition],
                (taskErr) => {
                  if (taskErr) console.error('Error updating task statuses on stage advance:', taskErr);
                  res.json({ ok: true, stageDirection: 'forward' });
                }
              );
            } else {
              res.json({ ok: true, stageDirection: 'same' });
            }
          } else {
            res.json({ ok: true, stageDirection: 'initial' });
          }
        });
      });
    });
  });
});

// Переименование этапа
app.put('/api/projects/:id/stages/:stageId', (req, res) => {
  if (!req.session.user) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  const projectId = req.params.id; const stageId = req.params.stageId; const { name } = req.body || {};
  if (!name || String(name).trim().length === 0) return res.status(400).json({ ok: false, error: 'Name required' });
  db.get('SELECT role FROM project_memberships WHERE project_id = ? AND user_id = ?', [projectId, req.session.user.id], (err, row) => {
    if (err) return res.status(500).json({ ok: false, error: 'DB error' });
    if (!row || (row.role !== 'manager' && row.role !== 'deputy')) return res.status(403).json({ ok: false, error: 'Forbidden' });
    db.get('SELECT model FROM projects WHERE id = ?', [projectId], (mErr, proj) => {
      if (mErr) return res.status(500).json({ ok: false, error: 'DB error' });
      const model = String(proj?.model || '').toLowerCase();
      const isDiagram = ['каскадная','waterfall','v-образная','v-shaped','v shaped','vmodel','спиральная','spiral','iterative','итеративная','итерационная'].includes(model);
      if (isDiagram) return res.status(400).json({ ok: false, error: 'Stages cannot be edited for this model' });
      db.run('UPDATE project_stages SET name = ? WHERE id = ? AND project_id = ?', [String(name).trim(), stageId, projectId], function(updErr){
        if (updErr) return res.status(500).json({ ok: false, error: 'DB error' });
        if (this.changes === 0) return res.status(404).json({ ok: false, error: 'Stage not found' });
        res.json({ ok: true });
      });
    });
  });
});

// Удаление этапа
app.delete('/api/projects/:id/stages/:stageId', (req, res) => {
  if (!req.session.user) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  const projectId = req.params.id; const stageId = req.params.stageId;
  db.get('SELECT role FROM project_memberships WHERE project_id = ? AND user_id = ?', [projectId, req.session.user.id], (err, row) => {
    if (err) return res.status(500).json({ ok: false, error: 'DB error' });
    if (!row || (row.role !== 'manager' && row.role !== 'deputy')) return res.status(403).json({ ok: false, error: 'Forbidden' });
    db.get('SELECT model FROM projects WHERE id = ?', [projectId], (mErr, proj) => {
      if (mErr) return res.status(500).json({ ok: false, error: 'DB error' });
      const model = String(proj?.model || '').toLowerCase();
      const isDiagram = ['каскадная','waterfall','v-образная','v-shaped','v shaped','vmodel','спиральная','spiral','iterative','итеративная','итерационная'].includes(model);
      if (isDiagram) return res.status(400).json({ ok: false, error: 'Stages cannot be deleted for this model' });
      db.serialize(() => {
      db.run('BEGIN');
      db.run('DELETE FROM project_stages WHERE id = ? AND project_id = ?', [stageId, projectId]);
      // Если удаленный этап был выбран, выбираем первый этап как новый
      db.get('SELECT selected_stage_id FROM projects WHERE id = ?', [projectId], (e1, prow) => {
        if (e1) { db.run('ROLLBACK'); return res.status(500).json({ ok: false, error: 'DB error' }); }
        const wasSelected = prow && prow.selected_stage_id === stageId;
        if (!wasSelected) {
          db.run('COMMIT', (e2) => { if (e2) return res.status(500).json({ ok: false, error: 'DB error' }); res.json({ ok: true }); });
        } else {
          db.get('SELECT id FROM project_stages WHERE project_id = ? ORDER BY position ASC LIMIT 1', [projectId], (e3, first) => {
            if (e3) { db.run('ROLLBACK'); return res.status(500).json({ ok: false, error: 'DB error' }); }
            const newSel = first ? first.id : null;
            db.run('UPDATE projects SET selected_stage_id = ? WHERE id = ?', [newSel, projectId], (e4) => {
              if (e4) { db.run('ROLLBACK'); return res.status(500).json({ ok: false, error: 'DB error' }); }
              db.run('COMMIT', (e5) => { if (e5) return res.status(500).json({ ok: false, error: 'DB error' }); res.json({ ok: true }); });
            });
          });
        }
        });
      });
    });
  });
});


