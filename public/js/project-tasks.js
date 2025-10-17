(() => {
  function getParam(name) { const url = new URL(window.location.href); return url.searchParams.get(name); }
  let id = getParam('id');
  if (!id) {
    const saved = localStorage.getItem('currentProjectId');
    if (saved) {
      const u = new URL(window.location.href);
      u.searchParams.set('id', saved);
      window.location.replace(u.pathname + '?' + u.searchParams.toString());
    }
    return;
  }
  try { localStorage.setItem('currentProjectId', id); } catch {}

  const tasksList = document.getElementById('tasks-list');
  const addTaskBtn = document.getElementById('add-task-btn');
  const addTaskModal = document.getElementById('add-task-modal');
  const addTaskForm = document.getElementById('add-task-form');
  const sortSelect = document.getElementById('sort-tasks');
  const taskFilesInput = document.getElementById('task-files');
  const taskFilesPreview = document.getElementById('task-files-preview');
  
  const addFilesToTaskModal = document.getElementById('add-files-to-task-modal');
  const addFilesToTaskForm = document.getElementById('add-files-to-task-form');
  const targetTaskIdInput = document.getElementById('target-task-id');
  const additionalTaskFilesInput = document.getElementById('additional-task-files');
  const additionalFilesPreview = document.getElementById('additional-files-preview');

  let currentSort = 'new';

  async function loadMe() {
    const me = await fetch(`/api/projects/${encodeURIComponent(id)}/me`).then(r=>r.json()).catch(()=>null);
    return me?.membership || null;
  }

  async function loadTasks() {
    const res = await fetch(`/api/projects/${encodeURIComponent(id)}/tasks`).then(r=>r.json()).catch(()=>null);
    if (!res?.ok) return [];
    let tasks = res.tasks || [];
    // Сортировка
    if (currentSort === 'new') {
      tasks.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    } else {
      tasks.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    }
    return tasks;
  }

  function formatDate(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function formatFileSize(bytes) {
    if (bytes === 0) return '0 Б';
    const k = 1024;
    const sizes = ['Б', 'КБ', 'МБ', 'ГБ'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  }

  function renderTasks(tasks, canEdit) {
    if (!tasksList) return;
    if (tasks.length === 0) {
      tasksList.innerHTML = '<p style="text-align:center; padding:40px; color:var(--muted);">Нет задач</p>';
      return;
    }

    tasksList.innerHTML = tasks.map(task => {
      const filesCount = task.files ? task.files.length : 0;
      return `
        <div class="file-group" data-task-id="${task.id}">
          <div class="file-group-header">
            <div class="file-group-info">
              <div class="file-group-topic">${task.title}</div>
              <div class="file-group-meta">Создано: ${formatDate(task.created_at)} • Файлов: ${filesCount}</div>
            </div>
            <div class="file-group-toggle">▼</div>
          </div>
          <div class="file-group-content">
            ${task.description ? `<div class="task-description">${task.description}</div>` : ''}
            ${filesCount > 0 ? `
              <div class="files-items">
                ${task.files.map(file => `
                  <div class="file-item">
                    <div class="file-item-name">${file.filename}</div>
                    <div class="file-item-size">${formatFileSize(file.file_size)}</div>
                    <div class="file-item-actions">
                      <a href="/api/projects/${encodeURIComponent(id)}/tasks/${encodeURIComponent(task.id)}/files/${encodeURIComponent(file.id)}/download" class="file-download-btn" download>Скачать</a>
                      ${canEdit ? `<button class="file-delete-btn" data-file-id="${file.id}">Удалить</button>` : ''}
                    </div>
                  </div>
                `).join('')}
              </div>
            ` : '<p style="padding:10px; color:var(--muted); font-size:14px;">Нет файлов</p>'}
            <div style="display:flex; gap:8px; margin-top:12px;">
              ${canEdit ? `<button class="btn-primary" data-action="add-files-to-task" data-task-id="${task.id}">Добавить файлы</button>` : ''}
              ${canEdit ? `<button class="btn-danger" data-action="delete-task" data-task-id="${task.id}">Удалить задачу</button>` : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Добавляем обработчики раскрытия
    document.querySelectorAll('.file-group-header').forEach(header => {
      header.addEventListener('click', () => {
        const group = header.closest('.file-group');
        group.classList.toggle('expanded');
      });
    });
  }

  async function refresh() {
    const my = await loadMe();
    const canEdit = my?.role === 'manager' || my?.role === 'deputy';
    
    if (addTaskBtn) {
      addTaskBtn.classList.toggle('hidden', !canEdit);
    }

    const tasks = await loadTasks();
    renderTasks(tasks, canEdit);
  }

  // Предпросмотр файлов
  taskFilesInput?.addEventListener('change', (e) => {
    const files = Array.from(e.target.files || []);
    if (!taskFilesPreview) return;
    
    taskFilesPreview.innerHTML = files.map((file, idx) => `
      <div class="file-preview-item">
        <span>${file.name} (${formatFileSize(file.size)})</span>
        <span class="file-preview-remove" data-idx="${idx}">✕</span>
      </div>
    `).join('');

    // Обработчики удаления
    taskFilesPreview.querySelectorAll('.file-preview-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-idx'));
        const dt = new DataTransfer();
        Array.from(taskFilesInput.files).forEach((file, i) => {
          if (i !== idx) dt.items.add(file);
        });
        taskFilesInput.files = dt.files;
        taskFilesInput.dispatchEvent(new Event('change'));
      });
    });
  });

  // Предпросмотр дополнительных файлов
  additionalTaskFilesInput?.addEventListener('change', (e) => {
    const files = Array.from(e.target.files || []);
    if (!additionalFilesPreview) return;
    
    additionalFilesPreview.innerHTML = files.map((file, idx) => `
      <div class="file-preview-item">
        <span>${file.name} (${formatFileSize(file.size)})</span>
        <span class="file-preview-remove" data-idx="${idx}">✕</span>
      </div>
    `).join('');

    // Обработчики удаления
    additionalFilesPreview.querySelectorAll('.file-preview-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-idx'));
        const dt = new DataTransfer();
        Array.from(additionalTaskFilesInput.files).forEach((file, i) => {
          if (i !== idx) dt.items.add(file);
        });
        additionalTaskFilesInput.files = dt.files;
        additionalTaskFilesInput.dispatchEvent(new Event('change'));
      });
    });
  });

  // Модальное окно
  addTaskBtn?.addEventListener('click', () => {
    if (addTaskModal) addTaskModal.hidden = false;
  });

  addTaskModal?.querySelector('.modal-close')?.addEventListener('click', () => {
    if (addTaskModal) addTaskModal.hidden = true;
  });

  addTaskModal?.addEventListener('click', (e) => {
    if (e.target === addTaskModal) addTaskModal.hidden = true;
  });

  // Модальное окно добавления файлов к задаче
  addFilesToTaskModal?.querySelector('.modal-close')?.addEventListener('click', () => {
    if (addFilesToTaskModal) addFilesToTaskModal.hidden = true;
  });

  addFilesToTaskModal?.addEventListener('click', (e) => {
    if (e.target === addFilesToTaskModal) addFilesToTaskModal.hidden = true;
  });

  // Добавление задачи
  addTaskForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const fd = new FormData();
    const titleInput = document.getElementById('task-title');
    const descInput = document.getElementById('task-description');
    const filesInput = document.getElementById('task-files');
    
    if (titleInput?.value) {
      fd.append('title', titleInput.value);
    }
    if (descInput?.value) {
      fd.append('description', descInput.value);
    }
    if (filesInput?.files) {
      Array.from(filesInput.files).forEach(file => {
        fd.append('files', file);
      });
    }
    
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(id)}/tasks`, { method: 'POST', body: fd });
      const out = await res.json();
      if (out.ok) {
        if (addTaskModal) addTaskModal.hidden = true;
        if (addTaskForm) addTaskForm.reset();
        if (taskFilesPreview) taskFilesPreview.innerHTML = '';
        refresh();
      } else {
        alert(out.error || 'Ошибка создания задачи');
      }
    } catch (err) {
      console.error('Error creating task:', err);
      alert('Ошибка при создании задачи');
    }
  });

  // Добавление файлов к задаче
  addFilesToTaskForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const taskId = targetTaskIdInput?.value;
    if (!taskId) return;
    
    const fd = new FormData();
    if (additionalTaskFilesInput?.files) {
      Array.from(additionalTaskFilesInput.files).forEach(file => {
        fd.append('files', file);
      });
    }
    
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(id)}/tasks/${encodeURIComponent(taskId)}/files`, { method: 'POST', body: fd });
      const out = await res.json();
      if (out.ok) {
        if (addFilesToTaskModal) addFilesToTaskModal.hidden = true;
        if (addFilesToTaskForm) addFilesToTaskForm.reset();
        if (additionalFilesPreview) additionalFilesPreview.innerHTML = '';
        refresh();
      } else {
        alert(out.error || 'Ошибка добавления файлов');
      }
    } catch (err) {
      console.error('Error adding files to task:', err);
      alert('Ошибка при добавлении файлов');
    }
  });

  // Удаление задачи и файлов
  document.addEventListener('click', async (e) => {
    const target = e.target;
    
    // Открытие модального окна добавления файлов
    if (target.matches('[data-action="add-files-to-task"]')) {
      const taskId = target.getAttribute('data-task-id');
      if (targetTaskIdInput) targetTaskIdInput.value = taskId;
      if (addFilesToTaskModal) addFilesToTaskModal.hidden = false;
      return;
    }
    
    // Удаление задачи
    if (target.matches('[data-action="delete-task"]')) {
      if (!confirm('Вы уверены, что хотите удалить эту задачу?')) return;
      const taskId = target.getAttribute('data-task-id');
      const res = await fetch(`/api/projects/${encodeURIComponent(id)}/tasks/${encodeURIComponent(taskId)}`, { method: 'DELETE' });
      const out = await res.json();
      if (out.ok) {
        refresh();
      } else {
        alert(out.error || 'Ошибка удаления');
      }
    }

    // Удаление файла
    if (target.matches('.file-delete-btn')) {
      if (!confirm('Удалить файл?')) return;
      const fileId = target.getAttribute('data-file-id');
      const taskId = target.closest('.file-group').getAttribute('data-task-id');
      const res = await fetch(`/api/projects/${encodeURIComponent(id)}/tasks/${encodeURIComponent(taskId)}/files/${encodeURIComponent(fileId)}`, { method: 'DELETE' });
      const out = await res.json();
      if (out.ok) {
        refresh();
      } else {
        alert(out.error || 'Ошибка удаления файла');
      }
    }
  });

  // Сортировка
  sortSelect?.addEventListener('change', (e) => {
    currentSort = e.target.value;
    refresh();
  });

  function boot() { if (id) refresh(); }
  document.addEventListener('DOMContentLoaded', boot);
  window.addEventListener('pageshow', (e) => { try { if (e.persisted) boot(); } catch {} });
  boot();
})();

