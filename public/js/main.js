(() => {
  const root = document.documentElement;
  const themeToggle = document.querySelector('.theme-toggle');
  const authOpen = document.querySelector('.auth-open');
  const authOpenMobile = document.querySelector('.auth-open-mobile');
  const modal = document.getElementById('auth-modal');
  const modalClose = modal?.querySelector('.modal-close');
  const tabButtons = modal?.querySelectorAll('.auth-tab');
  const profileLink = document.querySelector('.profile-link');
  const profileLinkMobile = document.querySelector('.profile-link-mobile');
  const logoutBtn = document.getElementById('logout-btn');
  const profileEdit = document.getElementById('profile-edit');
  const profileForm = document.getElementById('profile-form');
  const emailCurrent = document.getElementById('email-current');
  const phoneCurrent = document.getElementById('phone-current');
  
  // Hamburger menu
  const hamburgerBtn = document.getElementById('hamburger-btn');
  const navDropdown = document.getElementById('nav-dropdown');

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

  // Открытие/закрытие модального окна авторизации
  authOpen?.addEventListener('click', () => {
    if (modal) modal.hidden = false;
  });
  authOpenMobile?.addEventListener('click', () => {
    if (modal) modal.hidden = false;
    hamburgerBtn?.classList.remove('active');
    navDropdown?.classList.remove('active');
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
      modal.querySelectorAll('.auth-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      modal.querySelectorAll('.auth-form-container').forEach((el) => {
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
      // Если это admin, перенаправляем на админ-панель
      if (data.redirect) {
        window.location.href = data.redirect;
        return;
      }
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
      // Если это admin, перенаправляем на админ-панель (хотя регистрация admin маловероятна)
      if (data.redirect) {
        window.location.href = data.redirect;
        return;
      }
      profileLink?.classList.remove('hidden');
      authOpen?.classList.add('hidden');
      modal.hidden = true;
    } else {
      alert(data.error || 'Ошибка регистрации');
    }
  });

  // Проверяем, смотрим ли мы чужой профиль
  function getParam(name) { try { const u = new URL(window.location.href); return u.searchParams.get(name); } catch { return null; } }
  const isViewingOtherProfile = document.body.getAttribute('data-page') === 'profile' && getParam('id');

  // При загрузке проверяем авторизацию
  fetch('/api/me').then(r => r.json()).then((data) => {
    if (data?.user) {
      // Если это admin и мы НЕ на странице администратора, перенаправляем
      const currentPage = window.location.pathname;
      if (data.isAdmin && !currentPage.includes('administrator.html')) {
        window.location.href = '/administrator.html';
        return;
      }
      
      profileLink?.classList.remove('hidden');
      profileLinkMobile?.classList.remove('hidden');
      authOpen?.classList.add('hidden');
      document.querySelector('.auth-open-mobile')?.classList.add('hidden');
      logoutBtn?.classList.remove('hidden');
      if (!isViewingOtherProfile) {
        profileEdit?.classList.remove('hidden');
      }
      if (emailCurrent && typeof data.user.email === 'string') emailCurrent.textContent = data.user.email || 'email';
      if (phoneCurrent && typeof data.user.phone === 'string') phoneCurrent.textContent = data.user.phone || 'phone';
      
      // Обновляем профиль (только если это НЕ чужой профиль)
      if (!isViewingOtherProfile) {
        const profileUsername = document.getElementById('profile-username');
        const profileDisplayName = document.getElementById('profile-display-name');
        const profileInfo = document.getElementById('profile-info');
        const avatarInitial = document.getElementById('avatar-initial');
        const usernameLogin = document.getElementById('username-login');
        const profileEmailInput = document.getElementById('profile-email');
        const profilePhoneInput = document.getElementById('profile-phone');
        const profileDisplayNameInput = document.getElementById('profile-display-name-input');
        
        if (profileUsername && data.user.username) {
          profileUsername.textContent = `@${data.user.username}`;
        }
        if (profileDisplayName) {
          profileDisplayName.textContent = data.user.display_name || data.user.username;
        }
        if (profileInfo) {
          const email = data.user.email || 'не указан';
          const phone = data.user.phone || 'не указан';
          profileInfo.textContent = `Email: ${email} • Телефон: ${phone}`;
        }
        
        // Отображаем инициал
        if (avatarInitial && data.user.username) {
          avatarInitial.textContent = data.user.username.charAt(0).toUpperCase();
        }
        
        // Заполнение формы редактирования
        if (usernameLogin && data.user.username) {
          usernameLogin.textContent = data.user.username;
        }
        if (profileEmailInput) {
          profileEmailInput.value = data.user.email || '';
        }
        if (profilePhoneInput) {
          profilePhoneInput.value = data.user.phone || '';
        }
        if (profileDisplayNameInput) {
          profileDisplayNameInput.value = data.user.display_name || '';
        }
      }
      
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
    function getParam(name) { try { const u = new URL(window.location.href); return u.searchParams.get(name); } catch { return null; } }
    const viewId = getParam('id');
    if (viewId) {
      // Скрываем редактирование и выход для чужих профилей
      profileEdit?.classList.add('hidden');
      logoutBtn?.classList.add('hidden');
      
      // Загружаем данные пользователя
      fetch(`/api/users/${encodeURIComponent(viewId)}`).then(r=>r.json()).then((out) => {
        if (out?.ok && out.user) {
          const user = out.user;
          const profileDisplayName = document.getElementById('profile-display-name');
          const profileUsername = document.getElementById('profile-username');
          const profileInfo = document.getElementById('profile-info');
          const avatarInitial = document.getElementById('avatar-initial');
          
          // Устанавливаем данные профиля
          if (profileDisplayName) {
            profileDisplayName.textContent = user.display_name || user.username;
          }
          if (profileUsername) {
            profileUsername.textContent = `@${user.username}`;
          }
          if (profileInfo) {
            const email = user.email || 'не указан';
            profileInfo.textContent = `Email: ${email}`;
          }
          
          // Устанавливаем инициал
          if (avatarInitial) {
            avatarInitial.textContent = user.username.charAt(0).toUpperCase();
          }
        } else {
          const profileInfo = document.getElementById('profile-info');
          if (profileInfo) profileInfo.textContent = 'Пользователь не найден';
        }
      }).catch(() => {
        const profileInfo = document.getElementById('profile-info');
        if (profileInfo) profileInfo.textContent = 'Ошибка загрузки профиля';
      });
    }
  }

  logoutBtn?.addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' });
    // Redirect to home after logout
    window.location.href = '/';
  });

  profileForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    // Получаем текущие данные пользователя
    const currentData = await fetch('/api/me').then(r => r.json()).catch(() => null);
    if (!currentData?.user) {
      alert('Ошибка загрузки данных пользователя');
      return;
    }
    
    const fd = new FormData(profileForm);
    const newDisplayName = fd.get('displayName')?.trim();
    const newEmail = fd.get('email')?.trim();
    const newPhone = fd.get('phone')?.trim();
    
    // Проверяем, есть ли изменения
    let hasChanges = false;
    const payload = {};
    
    // Проверяем displayName (отправляем даже пустое значение, чтобы можно было очистить)
    if (newDisplayName !== (currentData.user.display_name || '')) {
      hasChanges = true;
      payload.displayName = newDisplayName;
    }
    
    // Проверяем email
    if (newEmail && newEmail !== (currentData.user.email || '')) {
      hasChanges = true;
      payload.email = newEmail;
    }
    
    // Проверяем phone
    if (newPhone && newPhone !== (currentData.user.phone || '')) {
      hasChanges = true;
      payload.phone = newPhone;
    }
    
    // Если нет изменений, не отправляем запрос
    if (!hasChanges) {
      alert('Нет изменений для сохранения');
      return;
    }
    
    const res = await fetch('/api/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const out = await res.json();
    if (out.ok) {
      alert('Данные обновлены');
      // Перезагружаем страницу для обновления всех данных
      window.location.reload();
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
  const avatarSelectorModal = document.getElementById('avatar-selector-modal');
  const projectAvatarInput = document.getElementById('project-avatar-input');

  // Обработка выбора аватара
  avatarSelectorModal?.addEventListener('click', (e) => {
    const option = e.target.closest('.avatar-option-modal');
    if (option) {
      const avatarUrl = option.getAttribute('data-avatar');
      if (projectAvatarInput) projectAvatarInput.value = avatarUrl;
      
      // Убираем выделение со всех и добавляем на выбранный
      avatarSelectorModal.querySelectorAll('.avatar-option-modal').forEach(opt => {
        opt.classList.remove('selected');
      });
      option.classList.add('selected');
    }
  });

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
      
      // Сбрасываем выбор аватара
      if (avatarSelectorModal) {
        avatarSelectorModal.querySelectorAll('.avatar-option-modal').forEach((opt, idx) => {
          opt.classList.toggle('selected', idx === 0);
        });
      }
      if (projectAvatarInput) projectAvatarInput.value = '/img/icon_avatar_1.svg';
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


