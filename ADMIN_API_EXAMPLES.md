# API примеры для административной панели

## Авторизация

### Вход под admin
```bash
curl -X POST http://localhost/api/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "admin",
    "password": "admin123"
  }' \
  -c cookies.txt
```

Ответ:
```json
{
  "ok": true,
  "user": {
    "id": "uuid",
    "username": "admin"
  },
  "redirect": "/administrator.html"
}
```

### Проверка сессии
```bash
curl http://localhost/api/me \
  -b cookies.txt
```

Ответ:
```json
{
  "ok": true,
  "user": {
    "id": "uuid",
    "username": "admin",
    "display_name": null,
    "email": "admin@example.com",
    "phone": ""
  },
  "isAdmin": true
}
```

## Получение данных таблиц

### Получить всех пользователей
```bash
curl http://localhost/api/admin/tables/users \
  -b cookies.txt
```

Ответ:
```json
{
  "ok": true,
  "rows": [
    {
      "id": "uuid-1",
      "username": "admin",
      "password_hash": "...",
      "phone": "",
      "email": "admin@example.com",
      "created_at": "2025-01-01T00:00:00.000Z",
      "last_seen": "2025-01-01T12:00:00.000Z",
      "display_name": null,
      "avatar_url": null
    },
    {
      "id": "uuid-2",
      "username": "user1",
      "password_hash": "...",
      "phone": "+1234567890",
      "email": "user1@example.com",
      "created_at": "2025-01-02T00:00:00.000Z",
      "last_seen": "2025-01-02T10:00:00.000Z",
      "display_name": "User One",
      "avatar_url": null
    }
  ]
}
```

### Получить все проекты
```bash
curl http://localhost/api/admin/tables/projects \
  -b cookies.txt
```

### Получить членство в проектах
```bash
curl http://localhost/api/admin/tables/project_memberships \
  -b cookies.txt
```

### Получить заявки на вступление
```bash
curl http://localhost/api/admin/tables/project_join_requests \
  -b cookies.txt
```

### Получить этапы проектов
```bash
curl http://localhost/api/admin/tables/project_stages \
  -b cookies.txt
```

### Получить задачи
```bash
curl http://localhost/api/admin/tables/project_tasks \
  -b cookies.txt
```

## Удаление записей

### Удалить пользователя
```bash
curl -X DELETE http://localhost/api/admin/tables/delete \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{
    "table": "users",
    "row": {
      "id": "uuid-to-delete"
    }
  }'
```

Ответ:
```json
{
  "ok": true,
  "deleted": 1
}
```

### Удалить проект
```bash
curl -X DELETE http://localhost/api/admin/tables/delete \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{
    "table": "projects",
    "row": {
      "id": "project-uuid-to-delete"
    }
  }'
```

### Удалить членство (составной ключ)
```bash
curl -X DELETE http://localhost/api/admin/tables/delete \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{
    "table": "project_memberships",
    "row": {
      "user_id": "user-uuid",
      "project_id": "project-uuid"
    }
  }'
```

### Удалить задачу
```bash
curl -X DELETE http://localhost/api/admin/tables/delete \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{
    "table": "project_tasks",
    "row": {
      "id": "task-id"
    }
  }'
```

## Ошибки

### Попытка доступа без авторизации
```bash
curl http://localhost/api/admin/tables/users
```

Ответ:
```json
{
  "ok": false,
  "error": "Admin access required"
}
```

### Попытка доступа не-админа
```bash
# Войти под обычным пользователем
curl -X POST http://localhost/api/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "user1",
    "password": "password"
  }' \
  -c user_cookies.txt

# Попытаться получить данные таблицы
curl http://localhost/api/admin/tables/users \
  -b user_cookies.txt
```

Ответ:
```json
{
  "ok": false,
  "error": "Admin access required"
}
```

### Неверное имя таблицы
```bash
curl http://localhost/api/admin/tables/invalid_table \
  -b cookies.txt
```

Ответ:
```json
{
  "ok": false,
  "error": "Invalid table name"
}
```

### Попытка удалить несуществующую запись
```bash
curl -X DELETE http://localhost/api/admin/tables/delete \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{
    "table": "users",
    "row": {
      "id": "non-existent-uuid"
    }
  }'
```

Ответ:
```json
{
  "ok": false,
  "error": "Row not found"
}
```

## Выход
```bash
curl -X POST http://localhost/api/logout \
  -b cookies.txt
```

Ответ:
```json
{
  "ok": true
}
```

## Примеры использования в JavaScript

### Получить данные таблицы
```javascript
const response = await fetch('/api/admin/tables/users');
const data = await response.json();

if (data.ok) {
  console.log('Users:', data.rows);
} else {
  console.error('Error:', data.error);
}
```

### Удалить запись
```javascript
const response = await fetch('/api/admin/tables/delete', {
  method: 'DELETE',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    table: 'users',
    row: { id: 'user-uuid' }
  })
});

const data = await response.json();

if (data.ok) {
  console.log('Deleted successfully');
} else {
  console.error('Error:', data.error);
}
```

## Первичные ключи таблиц

Для удаления записей используются следующие первичные ключи:

| Таблица                        | Первичный ключ(и)          |
|--------------------------------|----------------------------|
| users                          | id                         |
| projects                       | id                         |
| project_memberships            | user_id, project_id        |
| project_join_requests          | id                         |
| project_promotion_requests     | id                         |
| project_stages                 | id                         |
| project_file_groups            | id                         |
| project_files                  | id                         |
| project_tasks                  | id                         |
| project_task_files             | id                         |

## Безопасность

⚠️ **ВАЖНО**: Все эти эндпоинты защищены:
- Требуется активная сессия
- Требуется username === 'admin'
- Whitelist разрешенных таблиц
- Защита от SQL injection

🔒 **РЕКОМЕНДАЦИИ**:
- Используйте HTTPS в продакшене
- Смените пароль admin по умолчанию
- Регулярно проверяйте логи доступа
- Создавайте резервные копии БД перед массовым удалением

