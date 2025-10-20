(() => {
  const root = document.documentElement;
  const themeToggle = document.querySelector('.theme-toggle');
  const logoutBtn = document.getElementById('logout-btn');
  const logoutBtnMobile = document.getElementById('logout-btn-mobile');
  const tableSelector = document.getElementById('table-selector');
  const tableContainer = document.getElementById('table-container');
  const recordCount = document.getElementById('record-count');
  
  // Состояние сортировки
  let sortState = {
    column: null,
    order: null, // null, 'desc', 'asc'
    originalData: null
  };
  
  // Hamburger menu
  const hamburgerBtn = document.getElementById('hamburger-btn');
  const navDropdown = document.getElementById('nav-dropdown');

  // Загрузка темы из localStorage
  const savedTheme = localStorage.getItem('theme') || 'light';
  root.setAttribute('data-theme', savedTheme);

  // Theme toggle
  themeToggle?.addEventListener('click', () => {
    const current = root.getAttribute('data-theme') || 'light';
    const next = current === 'light' ? 'dark' : 'light';
    root.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
  });

  // Hamburger menu toggle
  hamburgerBtn?.addEventListener('click', () => {
    hamburgerBtn.classList.toggle('active');
    navDropdown?.classList.toggle('active');
  });

  // Закрытие меню при клике вне его
  document.addEventListener('click', (e) => {
    if (navDropdown?.classList.contains('active') && 
        !navDropdown.contains(e.target) && 
        !hamburgerBtn?.contains(e.target)) {
      hamburgerBtn?.classList.remove('active');
      navDropdown?.classList.remove('active');
    }
  });

  // Logout
  const handleLogout = async () => {
    await fetch('/api/logout', { method: 'POST' });
    window.location.href = '/';
  };
  
  logoutBtn?.addEventListener('click', handleLogout);
  logoutBtnMobile?.addEventListener('click', handleLogout);

  // Проверяем авторизацию и права администратора
  fetch('/api/me').then(r => r.json()).then((data) => {
    if (!data?.user || data.user.username !== 'admin') {
      // Если не admin, перенаправляем на главную
      window.location.href = '/';
    }
  }).catch(() => {
    window.location.href = '/';
  });

  // Рендеринг таблицы
  const renderTable = (tableName, rows) => {
    if (!rows || rows.length === 0) {
      tableContainer.innerHTML = '<div class="empty-state"><p>Таблица пуста</p></div>';
      recordCount.textContent = 'Записей: 0';
      return;
    }

    // Получаем колонки из первой строки
    const columns = Object.keys(rows[0]);
    
    // Проверяем, есть ли колонка created_at
    const hasCreatedAt = columns.includes('created_at');
    const isSortableTable = (tableName === 'users' || tableName === 'projects') && hasCreatedAt;
    
    // Создаем таблицу
    const table = document.createElement('table');
    table.className = 'data-table';
    
    // Создаем заголовок
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    
    columns.forEach(col => {
      const th = document.createElement('th');
      
      // Для created_at в users и projects добавляем сортировку
      if (col === 'created_at' && isSortableTable) {
        th.className = 'sortable-header';
        th.style.cursor = 'pointer';
        th.style.userSelect = 'none';
        
        const textSpan = document.createElement('span');
        textSpan.textContent = col;
        th.appendChild(textSpan);
        
        // Добавляем индикатор сортировки
        const sortIndicator = document.createElement('span');
        sortIndicator.className = 'sort-indicator';
        
        if (sortState.column === col) {
          if (sortState.order === 'desc') {
            sortIndicator.textContent = ' ↓';
            th.classList.add('sorted-desc');
          } else if (sortState.order === 'asc') {
            sortIndicator.textContent = ' ↑';
            th.classList.add('sorted-asc');
          }
        }
        
        th.appendChild(sortIndicator);
        
        // Добавляем обработчик клика
        th.addEventListener('click', () => {
          handleSort(tableName, col);
        });
      } else {
        th.textContent = col;
      }
      
      headerRow.appendChild(th);
    });
    
    // Добавляем колонку для действий
    const actionsHeader = document.createElement('th');
    actionsHeader.textContent = 'Действия';
    actionsHeader.style.width = '60px';
    actionsHeader.style.textAlign = 'center';
    headerRow.appendChild(actionsHeader);
    
    thead.appendChild(headerRow);
    table.appendChild(thead);
    
    // Создаем тело таблицы
    const tbody = document.createElement('tbody');
    
    rows.forEach(row => {
      const tr = document.createElement('tr');
      
      columns.forEach(col => {
        const td = document.createElement('td');
        const value = row[col];
        
        // Форматируем значение
        if (value === null || value === undefined) {
          td.textContent = 'NULL';
          td.style.color = 'var(--muted)';
          td.style.fontStyle = 'italic';
        } else if (typeof value === 'string' && value.length > 100) {
          td.textContent = value.substring(0, 100) + '...';
          td.title = value;
        } else {
          td.textContent = value;
        }
        
        tr.appendChild(td);
      });
      
      // Добавляем кнопку удаления
      const actionsTd = document.createElement('td');
      actionsTd.className = 'cell-actions';
      
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'btn-delete';
      deleteBtn.textContent = '+';
      deleteBtn.title = 'Удалить запись';
      deleteBtn.setAttribute('data-table', tableName);
      deleteBtn.setAttribute('data-row', JSON.stringify(row));
      
      deleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm('Вы уверены, что хотите удалить эту запись?')) {
          return;
        }
        
        await handleDelete(tableName, row);
      });
      
      actionsTd.appendChild(deleteBtn);
      tr.appendChild(actionsTd);
      
      tbody.appendChild(tr);
    });
    
    table.appendChild(tbody);
    
    // Отображаем таблицу
    tableContainer.innerHTML = '';
    tableContainer.appendChild(table);
    
    // Обновляем счетчик
    recordCount.textContent = `Записей: ${rows.length}`;
  };

  // Обработка сортировки
  const handleSort = (tableName, column) => {
    if (!sortState.originalData) return;
    
    // Определяем следующее состояние сортировки
    let nextOrder;
    if (sortState.column !== column || sortState.order === null) {
      nextOrder = 'desc'; // Первый клик - новые сверху
    } else if (sortState.order === 'desc') {
      nextOrder = 'asc'; // Второй клик - старые сверху
    } else {
      nextOrder = null; // Третий клик - исходный порядок
    }
    
    sortState.column = column;
    sortState.order = nextOrder;
    
    let sortedRows;
    
    if (nextOrder === null) {
      // Возвращаем исходный порядок
      sortedRows = [...sortState.originalData];
    } else {
      // Сортируем данные
      sortedRows = [...sortState.originalData].sort((a, b) => {
        const aVal = a[column];
        const bVal = b[column];
        
        // Обработка null/undefined
        if (!aVal && !bVal) return 0;
        if (!aVal) return 1;
        if (!bVal) return -1;
        
        // Сравнение дат (ISO строки)
        const comparison = aVal > bVal ? 1 : (aVal < bVal ? -1 : 0);
        return nextOrder === 'desc' ? -comparison : comparison;
      });
    }
    
    // Перерисовываем таблицу
    renderTable(tableName, sortedRows);
  };

  // Загрузка и отображение таблицы
  const loadTable = async (tableName) => {
    if (!tableName) {
      tableContainer.innerHTML = '<div class="empty-state"><p>Выберите таблицу для просмотра данных</p></div>';
      recordCount.textContent = 'Записей: 0';
      sortState = { column: null, order: null, originalData: null };
      return;
    }

    // Показываем индикатор загрузки
    tableContainer.innerHTML = '<div class="loading">Загрузка данных</div>';

    try {
      const response = await fetch(`/api/admin/tables/${tableName}`);
      if (!response.ok) {
        throw new Error('Failed to load table data');
      }

      const data = await response.json();
      
      if (!data.ok || !data.rows || data.rows.length === 0) {
        tableContainer.innerHTML = '<div class="empty-state"><p>Таблица пуста</p></div>';
        recordCount.textContent = 'Записей: 0';
        sortState = { column: null, order: null, originalData: null };
        return;
      }

      // Сохраняем исходные данные и сбрасываем сортировку
      sortState = {
        column: null,
        order: null,
        originalData: data.rows
      };
      
      // Рендерим таблицу
      renderTable(tableName, data.rows);
      
    } catch (error) {
      console.error('Error loading table:', error);
      tableContainer.innerHTML = '<div class="empty-state"><p style="color: #ef4444;">Ошибка загрузки данных</p></div>';
      recordCount.textContent = 'Записей: 0';
      sortState = { column: null, order: null, originalData: null };
    }
  };

  // Удаление записи
  const handleDelete = async (tableName, row) => {
    try {
      const response = await fetch('/api/admin/tables/delete', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ table: tableName, row })
      });

      const data = await response.json();
      
      if (data.ok) {
        // Перезагружаем таблицу
        await loadTable(tableName);
      } else {
        alert('Ошибка при удалении: ' + (data.error || 'Неизвестная ошибка'));
      }
    } catch (error) {
      console.error('Error deleting row:', error);
      alert('Ошибка при удалении записи');
    }
  };

  // Обработчик изменения выбора таблицы
  tableSelector?.addEventListener('change', (e) => {
    const tableName = e.target.value;
    loadTable(tableName);
  });

  // Инициализация
  loadTable('');
})();

