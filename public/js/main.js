(() => {
  const root = document.documentElement;
  const themeToggle = document.querySelector('.theme-toggle');
  const authOpen = document.querySelector('.auth-open');
  const modal = document.getElementById('auth-modal');
  const modalClose = modal?.querySelector('.modal-close');
  const tabButtons = modal?.querySelectorAll('.tab-button');
  const profileLink = document.querySelector('.profile-link');
  const logoutBtn = document.getElementById('logout-btn');
  const profileEdit = document.getElementById('profile-edit');
  const profileForm = document.getElementById('profile-form');
  const emailCurrent = document.getElementById('email-current');
  const phoneCurrent = document.getElementById('phone-current');

  // Загрузка сохраненной темы из localStorage при загрузке страницы
  const savedTheme = localStorage.getItem('theme') || 'light';
  root.setAttribute('data-theme', savedTheme);

  // Theme toggle с сохранением в localStorage
  themeToggle?.addEventListener('click', () => {
    const current = root.getAttribute('data-theme') || 'light';
    const next = current === 'light' ? 'dark' : 'light';
    root.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
  });

  // Открытие/закрытие модального окна авторизации
  authOpen?.addEventListener('click', () => {
    if (modal) modal.hidden = false;
  });
  modalClose?.addEventListener('click', () => {
    if (modal) modal.hidden = true;
  });
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) modal.hidden = true;
  });

  // Переключатель вкладок
  tabButtons?.forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-tab');
      modal.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      modal.querySelectorAll('.tab-content').forEach((el) => {
        el.hidden = el.getAttribute('data-tab') !== tab;
      });
    });
  });

  // Обработка форм входа и регистрации
  const loginForm = modal?.querySelector('#login-form');
  const registerForm = modal?.querySelector('#register-form');
  loginForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(loginForm);
    const payload = Object.fromEntries(formData.entries());
    const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await res.json();
    if (data.ok) {
      profileLink?.classList.remove('hidden');
      authOpen?.classList.add('hidden');
      modal.hidden = true;
    } else {
      alert(data.error || 'Ошибка входа');
    }
  });
  registerForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(registerForm);
    const payload = Object.fromEntries(formData.entries());
    const res = await fetch('/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await res.json();
    if (data.ok) {
      profileLink?.classList.remove('hidden');
      authOpen?.classList.add('hidden');
      modal.hidden = true;
    } else {
      alert(data.error || 'Ошибка регистрации');
    }
  });

  // При загрузке проверяем авторизацию
  fetch('/api/me').then(r => r.json()).then((data) => {
    if (data?.user) {
      profileLink?.classList.remove('hidden');
      authOpen?.classList.add('hidden');
      logoutBtn?.classList.remove('hidden');
      profileEdit?.classList.remove('hidden');
      if (emailCurrent && typeof data.user.email === 'string') emailCurrent.textContent = data.user.email || 'email';
      if (phoneCurrent && typeof data.user.phone === 'string') phoneCurrent.textContent = data.user.phone || 'phone';
      // Показываем кнопку создания только авторизованным пользователям
      const fab = document.getElementById('fab-add');
      if (fab) fab.classList.remove('hidden');
    } else {
      // Скрываем кнопку создания для гостей
      const fab = document.getElementById('fab-add');
      if (fab) fab.classList.add('hidden');
    }
  }).catch(() => {});

  // Просмотр публичного профиля по ID
  if (document.body.getAttribute('data-page') === 'profile') {
    const profileInfo = document.querySelector('.profile-info');
    function getParam(name) { try { const u = new URL(window.location.href); return u.searchParams.get(name); } catch { return null; } }
    const viewId = getParam('id');
    if (viewId) {
      // Скрываем редактирование и выход для чужих профилей
      profileEdit?.classList.add('hidden');
      logoutBtn?.classList.add('hidden');
      fetch(`/api/users/${encodeURIComponent(viewId)}`).then(r=>r.json()).then((out) => {
        if (out?.ok && out.user) {
          const { username, email } = out.user;
          if (profileInfo) profileInfo.textContent = `${username} • ${email || ''}`.trim();
        } else if (profileInfo) {
          profileInfo.textContent = 'Пользователь не найден';
        }
      }).catch(() => { if (profileInfo) profileInfo.textContent = 'Ошибка загрузки профиля'; });
    }
  }

  logoutBtn?.addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' });
    // Redirect to home after logout
    window.location.href = '/';
  });

  profileForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(profileForm);
    const payload = Object.fromEntries(fd.entries());
    // Удаляем пустые поля, чтобы не перезаписывать пустыми строками
    if (!payload.email) delete payload.email;
    if (!payload.phone) delete payload.phone;
    if (!payload.password) delete payload.password;
    const res = await fetch('/api/profile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const out = await res.json();
    if (out.ok) {
      alert('Данные обновлены');
      // Перезагружаем текущие значения
      const me = await fetch('/api/me').then(r=>r.json()).catch(()=>null);
      if (me?.user) {
        if (emailCurrent) emailCurrent.textContent = me.user.email || 'email';
        if (phoneCurrent) phoneCurrent.textContent = me.user.phone || 'phone';
      }
      profileForm.reset();
    } else {
      alert(out.error || 'Ошибка обновления');
    }
  });

  // Отображаем проекты в зависимости от страницы
  const projectsList = document.getElementById('projects-list');
  const page = document.body.getAttribute('data-page');
  if (projectsList) {
    const url = page === 'myprojects' ? '/api/my-projects' : '/api/projects';
    fetch(url).then(r => r.json()).then((data) => {
      if (!data?.ok) {
        projectsList.innerHTML = '<div class="project-row"><div class="project-name">Ошибка загрузки</div><div class="project-participants"></div><div class="project-action"></div></div>';
        return;
      }
      const projects = data.projects || [];
      if (projects.length === 0) {
        projectsList.innerHTML = '<div class="project-row"><div class="project-name">Пока нет проектов</div><div class="project-participants">0 участников</div><div class="project-action"></div></div>';
        return;
      }
      projectsList.innerHTML = projects.map(p => {
        const roleLabel = page === 'myprojects' ? (p.role === 'manager' ? 'Управляющий' : (p.role === 'deputy' ? 'Заместитель' : 'Участник')) : '';
        return (
          `<div class="project-row" data-id="${p.id}">
            <div class="flex-block-projects">
              <img class="project-avatar" src="${p.avatar_url || '/img/icon_avatar_1.svg'}" alt="Аватар">
              <div class="project-name">${p.name}</div>
            </div>
            <div class="project-participants"><span class="count">${p.participants_count}</span> участников</div>
            <div class="project-action">${page === 'myprojects' ? `<span class=\"role\">${roleLabel}</span>` : (p.is_member ? '' : '<span class=\"plus\" title=\"Присоединиться\">+</span>')}</div>
          </div>`
        );
      }).join('');
    }).catch(() => {
      projectsList.innerHTML = '<div class="project-row"><div class="project-name">Ошибка загрузки</div><div class="project-participants"></div><div class="project-action"></div></div>';
    });
  }

  // Добавление проекта (только на главной странице)
  const fabAdd = document.getElementById('fab-add');
  const addProjectModal = document.getElementById('add-project-modal');
  const addProjectClose = addProjectModal?.querySelector('.modal-close');
  const addProjectForm = document.getElementById('add-project-form');
  fabAdd?.addEventListener('click', () => { if (addProjectModal) addProjectModal.hidden = false; });
  addProjectClose?.addEventListener('click', () => { if (addProjectModal) addProjectModal.hidden = true; });
  addProjectModal?.addEventListener('click', (e) => { if (e.target === addProjectModal) addProjectModal.hidden = true; });
  addProjectForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(addProjectForm);
    const payload = Object.fromEntries(fd.entries());
    const res = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (res.status === 401) {
      // Требуется авторизация для создания проекта
      if (modal) modal.hidden = false;
      return;
    }
    const out = await res.json();
    if (out.ok) {
      // На главной мы не показываем проекты, где уже являемся участником,
      // поэтому не добавляем созданный проект в список.
      // Просто закрываем модалку и сбрасываем форму.
      addProjectModal.hidden = true;
      addProjectForm.reset();
    } else {
      alert(out.error || 'Ошибка создания проекта');
    }
  });

  // Присоединение к проекту с главной страницы
  if (projectsList) {
    projectsList.addEventListener('click', async (e) => {
      const target = e.target;
      const row = target && target.closest ? target.closest('.project-row') : null;
      if (row && !target.classList.contains('plus')) {
        const id = row.getAttribute('data-id');
        if (id) window.location.href = `/Project.html?id=${encodeURIComponent(id)}`;
        return;
      }
      if (target && target.classList && target.classList.contains('plus')) {
        const row = target.closest('.project-row');
        const id = row?.getAttribute('data-id');
        if (!id) return;
        // Отправляем заявку на присоединение вместо немедленного вступления
        const res = await fetch(`/api/projects/${id}/request-join`, { method: 'POST' });
        if (res.status === 401) {
          if (modal) modal.hidden = false;
          return;
        }
        const out = await res.json();
        if (out.ok) target.remove(); else alert(out.error || 'Ошибка заявки');
      }
    });
  }
})();


