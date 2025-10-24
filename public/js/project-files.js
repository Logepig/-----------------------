(() => {
  function getParam(name) {
    const url = new URL(window.location.href);
    return url.searchParams.get(name);
  }

  let currentProjectId = null;
  let currentSortOrder = 'desc';
  let fileGroups = [];
  let currentUserId = null;
  let currentUserRole = null;

  // Модальное окно
  const addFilesBtn = document.getElementById('add-files-btn');
  const addFilesModal = document.getElementById('add-files-modal');
  const addFilesForm = document.getElementById('add-files-form');
  const modalClose = addFilesModal?.querySelector('.modal-close');
  const filesInput = document.getElementById('files-input');
  const filesPreview = document.getElementById('files-preview');
  const sortOrderSelect = document.getElementById('sort-order');

  // Открытие/закрытие модального окна
  addFilesBtn?.addEventListener('click', () => {
    if (addFilesModal) addFilesModal.hidden = false;
  });

  modalClose?.addEventListener('click', () => {
    if (addFilesModal) {
      addFilesModal.hidden = true;
      addFilesForm?.reset();
      if (filesPreview) filesPreview.innerHTML = '';
    }
  });

  addFilesModal?.addEventListener('click', (e) => {
    if (e.target === addFilesModal) {
      addFilesModal.hidden = true;
      addFilesForm?.reset();
      if (filesPreview) filesPreview.innerHTML = '';
    }
  });

  // Предварительный просмотр выбранных файлов
  filesInput?.addEventListener('change', (e) => {
    if (!filesPreview) return;
    filesPreview.innerHTML = '';
    const files = Array.from(e.target.files || []);
    
    files.forEach((file, index) => {
      const item = document.createElement('div');
      item.className = 'file-preview-item';
      item.innerHTML = `
        <span>${file.name} (${formatFileSize(file.size)})</span>
        <span class="file-preview-remove" data-index="${index}">&times;</span>
      `;
      filesPreview.appendChild(item);
    });
  });

  // Удаление файла из предпросмотра
  filesPreview?.addEventListener('click', (e) => {
    if (e.target.classList.contains('file-preview-remove')) {
      const index = parseInt(e.target.getAttribute('data-index'));
      const dt = new DataTransfer();
      const files = Array.from(filesInput.files || []);
      
      files.forEach((file, i) => {
        if (i !== index) dt.items.add(file);
      });
      
      filesInput.files = dt.files;
      filesInput.dispatchEvent(new Event('change'));
    }
  });

  // Отправка формы
  addFilesForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    if (!currentProjectId) return;

    const formData = new FormData(addFilesForm);
    formData.append('projectId', currentProjectId);

    try {
      const res = await fetch('/api/project-files', {
        method: 'POST',
        body: formData
      });

      const data = await res.json();

      if (data.ok) {
        alert('Файлы успешно загружены');
        addFilesModal.hidden = true;
        addFilesForm.reset();
        filesPreview.innerHTML = '';
        await loadFileGroups();
      } else {
        alert(data.error || 'Ошибка загрузки файлов');
      }
    } catch (error) {
      console.error('Ошибка загрузки файлов:', error);
      alert('Ошибка загрузки файлов');
    }
  });

  // Сортировка
  sortOrderSelect?.addEventListener('change', (e) => {
    currentSortOrder = e.target.value;
    renderFileGroups();
  });

  // Получение информации о текущем пользователе
  async function loadCurrentUser() {
    try {
      const meRes = await fetch('/api/me');
      const meData = await meRes.json();
      if (meData.ok && meData.user) {
        currentUserId = meData.user.id;
      }
    } catch (error) {
      console.error('Ошибка загрузки пользователя:', error);
    }
  }

  // Получение роли пользователя в проекте
  async function loadUserRole() {
    const projectId = getParam('id');
    if (!projectId) return;

    try {
      const roleRes = await fetch(`/api/projects/${encodeURIComponent(projectId)}/me`);
      const roleData = await roleRes.json();
      if (roleData.ok && roleData.membership) {
        currentUserRole = roleData.membership.role;
      }
    } catch (error) {
      console.error('Ошибка загрузки роли:', error);
    }
  }

  // Загрузка групп файлов (включая файлы из задач)
  async function loadFileGroups() {
    const projectId = getParam('id');
    if (!projectId) return;

    currentProjectId = projectId;

    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/all-files`);
      const data = await res.json();

      if (data.ok) {
        fileGroups = data.groups || [];
        renderFileGroups();
      }
    } catch (error) {
      console.error('Ошибка загрузки файлов:', error);
    }
  }

  // Отрисовка групп файлов
  function renderFileGroups() {
    const filesList = document.getElementById('files-list');
    if (!filesList) return;

    // Сортировка
    const sorted = [...fileGroups].sort((a, b) => {
      const dateA = new Date(a.created_at).getTime();
      const dateB = new Date(b.created_at).getTime();
      return currentSortOrder === 'desc' ? dateB - dateA : dateA - dateB;
    });

    if (sorted.length === 0) {
      filesList.innerHTML = '<p style="color: var(--muted); text-align: center; padding: 40px 0;">Файлов пока нет</p>';
      return;
    }

    filesList.innerHTML = sorted.map(group => {
      const date = formatDate(group.created_at);
      const filesCount = group.files ? group.files.length : 0;
      const isTask = group.source_type === 'task';
      
      // Проверяем права на удаление: manager, deputy или создатель группы
      const canDeleteGroup = currentUserRole === 'manager' || 
                             currentUserRole === 'deputy' || 
                             group.created_by === currentUserId;
      
      return `
        <div class="file-group" data-group-id="${group.id}" data-source-type="${group.source_type || 'file_group'}">
          <div class="file-group-header">
            <div class="file-group-info">
              <div class="file-group-topic">
                ${escapeHtml(group.topic)}
                ${isTask ? `<span class="task-badge">Файлы из задачи <a href="/ProjectTasks.html?id=${encodeURIComponent(currentProjectId)}&taskId=${encodeURIComponent(group.id)}" class="task-link">[Перейти к задаче]</a></span>` : ''}
              </div>
              <div class="file-group-meta">${date} • ${filesCount} ${pluralizeFiles(filesCount)}</div>
            </div>
            <div class="file-group-toggle">▼</div>
          </div>
          <div class="file-group-content">
            <div class="files-items">
              ${group.files && group.files.length > 0 ? group.files.map(file => `
                <div class="file-item" data-file-id="${file.id}">
                  <div class="file-item-name">${escapeHtml(file.filename)}</div>
                  <div class="file-item-size">${formatFileSize(file.file_size)}</div>
                  <div class="file-item-actions">
                    <button class="file-download-btn" data-file-id="${file.id}" data-source-type="${group.source_type || 'file_group'}" data-task-id="${group.task_id || ''}">Скачать</button>
                    ${canDeleteGroup ? `<button class="file-delete-btn" data-file-id="${file.id}" data-source-type="${group.source_type || 'file_group'}" data-task-id="${group.task_id || ''}">Удалить</button>` : ''}
                  </div>
                </div>
              `).join('') : '<p style="color: var(--muted); padding: 10px;">Нет файлов</p>'}
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Добавляем обработчики
    attachEventHandlers();
  }

  // Обработчики событий
  function attachEventHandlers() {
    const filesList = document.getElementById('files-list');
    if (!filesList) return;

    // Раскрытие/скрытие групп
    filesList.querySelectorAll('.file-group-header').forEach(header => {
      header.addEventListener('click', () => {
        const group = header.closest('.file-group');
        group.classList.toggle('expanded');
      });
    });

    // Скачивание файлов
    filesList.querySelectorAll('.file-download-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const fileId = btn.getAttribute('data-file-id');
        const sourceType = btn.getAttribute('data-source-type');
        const taskId = btn.getAttribute('data-task-id');
        
        if (fileId) {
          if (sourceType === 'task' && taskId) {
            window.location.href = `/api/projects/${encodeURIComponent(currentProjectId)}/tasks/${encodeURIComponent(taskId)}/files/${encodeURIComponent(fileId)}/download`;
          } else {
            window.location.href = `/api/project-files/${encodeURIComponent(fileId)}/download`;
          }
        }
      });
    });

    // Удаление файлов
    filesList.querySelectorAll('.file-delete-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const fileId = btn.getAttribute('data-file-id');
        const sourceType = btn.getAttribute('data-source-type');
        const taskId = btn.getAttribute('data-task-id');
        if (!fileId) return;

        if (!confirm('Удалить этот файл?')) return;

        try {
          let url;
          if (sourceType === 'task' && taskId) {
            url = `/api/projects/${encodeURIComponent(currentProjectId)}/tasks/${encodeURIComponent(taskId)}/files/${encodeURIComponent(fileId)}`;
          } else {
            url = `/api/project-files/${encodeURIComponent(fileId)}`;
          }
          
          const res = await fetch(url, { method: 'DELETE' });
          const data = await res.json();

          if (data.ok) {
            await loadFileGroups();
          } else {
            alert(data.error || 'Ошибка удаления файла');
          }
        } catch (error) {
          console.error('Ошибка удаления файла:', error);
          alert('Ошибка удаления файла');
        }
      });
    });
  }

  // Вспомогательные функции
  function formatDate(isoString) {
    const date = new Date(isoString);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}.${month}.${year}`;
  }

  function formatFileSize(bytes) {
    if (bytes === 0) return '0 Б';
    const k = 1024;
    const sizes = ['Б', 'КБ', 'МБ', 'ГБ'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  }

  function pluralizeFiles(count) {
    const lastDigit = count % 10;
    const lastTwoDigits = count % 100;
    
    if (lastTwoDigits >= 11 && lastTwoDigits <= 14) return 'файлов';
    if (lastDigit === 1) return 'файл';
    if (lastDigit >= 2 && lastDigit <= 4) return 'файла';
    return 'файлов';
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Инициализация
  async function init() {
    await loadCurrentUser();
    await loadUserRole();
    await loadFileGroups();
  }

  document.addEventListener('DOMContentLoaded', init);
  window.addEventListener('pageshow', (e) => {
    try {
      if (e.persisted) init();
    } catch {}
  });
})();

