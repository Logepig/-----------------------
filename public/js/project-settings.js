(() => {
  function getParam(name) {
    const url = new URL(window.location.href);
    return url.searchParams.get(name);
  }

  let currentProject = null;

  async function loadProjectSettings() {
    const projectId = getParam('id');
    if (!projectId) {
      alert('ID проекта не указан');
      window.location.href = '/MyProjects';
      return;
    }

    try {
      // Проверяем права доступа
      const meRes = await fetch(`/api/projects/${encodeURIComponent(projectId)}/me`);
      const meData = await meRes.json();
      
      if (!meData?.membership || meData.membership.role !== 'manager') {
        alert('Доступ запрещён. Только управляющий может редактировать настройки проекта.');
        window.location.href = `/Project.html?id=${encodeURIComponent(projectId)}`;
        return;
      }

      // Загружаем данные проекта
      const projectRes = await fetch(`/api/projects/${encodeURIComponent(projectId)}`);
      const projectData = await projectRes.json();

      if (!projectData?.ok || !projectData.project) {
        alert('Ошибка загрузки проекта');
        return;
      }

      currentProject = projectData.project;
      fillForm(currentProject);
    } catch (error) {
      console.error('Ошибка загрузки настроек:', error);
      alert('Ошибка загрузки настроек проекта');
    }
  }

  function fillForm(project) {
    const nameInput = document.getElementById('project-name');
    const topicInput = document.getElementById('project-topic');
    const typeInput = document.getElementById('project-type');
    const modelSelect = document.getElementById('project-model');
    const avatarInput = document.getElementById('project-avatar');

    if (nameInput) nameInput.value = project.name || '';
    if (topicInput) topicInput.value = project.topic || '';
    if (typeInput) typeInput.value = project.project_type || '';
    if (modelSelect) modelSelect.value = project.model || '';
    if (avatarInput) avatarInput.value = project.avatar_url || '/img/icon_avatar_1.svg';

    // Выделяем выбранный аватар
    selectAvatar(project.avatar_url || '/img/icon_avatar_1.svg');
  }

  function selectAvatar(avatarUrl) {
    const options = document.querySelectorAll('.avatar-option');
    options.forEach(option => {
      if (option.getAttribute('data-avatar') === avatarUrl) {
        option.classList.add('selected');
      } else {
        option.classList.remove('selected');
      }
    });
  }

  // Обработка выбора аватара
  const avatarSelector = document.getElementById('avatar-selector');
  avatarSelector?.addEventListener('click', (e) => {
    const option = e.target.closest('.avatar-option');
    if (option) {
      const avatarUrl = option.getAttribute('data-avatar');
      const avatarInput = document.getElementById('project-avatar');
      if (avatarInput) avatarInput.value = avatarUrl;
      selectAvatar(avatarUrl);
    }
  });

  // Обработка формы настроек
  const settingsForm = document.getElementById('project-settings-form');
  settingsForm?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const projectId = getParam('id');
    if (!projectId) return;

    const formData = new FormData(settingsForm);
    const payload = Object.fromEntries(formData.entries());

    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();

      if (data.ok) {
        alert('Настройки проекта успешно обновлены');
        // Обновляем текущие данные
        await loadProjectSettings();
      } else {
        alert(data.error || 'Ошибка обновления настроек');
      }
    } catch (error) {
      console.error('Ошибка обновления:', error);
      alert('Ошибка обновления настроек проекта');
    }
  });

  // Обработка удаления проекта
  const deleteBtn = document.getElementById('delete-project-btn');
  const deleteModal = document.getElementById('delete-confirm-modal');
  const deleteConfirmBtn = document.getElementById('delete-confirm-btn');
  const deleteCancelBtn = document.getElementById('delete-cancel-btn');
  const deleteInput = document.getElementById('delete-confirm-input');
  const modalClose = deleteModal?.querySelector('.modal-close');

  deleteBtn?.addEventListener('click', () => {
    if (deleteModal) {
      deleteModal.hidden = false;
      if (deleteInput) deleteInput.value = '';
    }
  });

  deleteCancelBtn?.addEventListener('click', () => {
    if (deleteModal) deleteModal.hidden = true;
  });

  modalClose?.addEventListener('click', () => {
    if (deleteModal) deleteModal.hidden = true;
  });

  deleteModal?.addEventListener('click', (e) => {
    if (e.target === deleteModal) deleteModal.hidden = true;
  });

  deleteConfirmBtn?.addEventListener('click', async () => {
    const projectId = getParam('id');
    if (!projectId || !currentProject) return;

    const confirmName = deleteInput?.value || '';
    if (confirmName !== currentProject.name) {
      alert('Название проекта не совпадает');
      return;
    }

    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
        method: 'DELETE'
      });

      const data = await res.json();

      if (data.ok) {
        alert('Проект успешно удалён');
        window.location.href = '/MyProjects';
      } else {
        alert(data.error || 'Ошибка удаления проекта');
      }
    } catch (error) {
      console.error('Ошибка удаления:', error);
      alert('Ошибка удаления проекта');
    }
  });

  // Инициализация при загрузке страницы
  document.addEventListener('DOMContentLoaded', loadProjectSettings);
  window.addEventListener('pageshow', (e) => {
    try {
      if (e.persisted) loadProjectSettings();
    } catch {}
  });
})();

