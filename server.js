const express = require('express');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Сессии
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 }
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

// API: Авторизация
app.get('/api/me', (req, res) => {
  if (!req.session.user) return res.json({ ok: true, user: null });
  db.get('SELECT id, username, email, phone FROM users WHERE id = ?', [req.session.user.id], (err, row) => {
    if (err) return res.status(500).json({ ok: false, error: 'DB error' });
    if (!row) return res.json({ ok: true, user: null });
    res.json({ ok: true, user: row });
  });
});

// Публичная информация о пользователе (просмотр чужих профилей)
app.get('/api/users/:id', (req, res) => {
  const userId = req.params.id;
  db.get('SELECT id, username, email FROM users WHERE id = ?', [userId], (err, row) => {
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
    res.json({ ok: true, user: { id: row.id, username: row.username } });
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
    SELECT u.id, u.username, u.last_seen, m.role
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
      return { id: r.id, username: r.username, role: r.role, online };
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
    const joinSql = `SELECT r.id, u.username, r.user_id, r.status FROM project_join_requests r JOIN users u ON u.id = r.user_id WHERE r.project_id = ? AND r.status = 'pending'`;
    const promSql = `SELECT r.id, u.username, r.user_id, r.status FROM project_promotion_requests r JOIN users u ON u.id = r.user_id WHERE r.project_id = ? AND r.status = 'pending'`;
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
    db.get('SELECT id FROM project_stages WHERE id = ? AND project_id = ?', [stageId, projectId], (e2, srow) => {
      if (e2) return res.status(500).json({ ok: false, error: 'DB error' });
      if (!srow) return res.status(404).json({ ok: false, error: 'Stage not found' });
      db.run('UPDATE projects SET selected_stage_id = ? WHERE id = ?', [stageId, projectId], function(updErr){
        if (updErr) return res.status(500).json({ ok: false, error: 'DB error' });
        res.json({ ok: true });
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


