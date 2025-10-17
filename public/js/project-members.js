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

  const membersList = document.getElementById('members-list');
  const joinBox = document.getElementById('join-requests');
  const joinRequestsBtn = document.getElementById('join-requests-btn');
  const joinRequestsBadge = document.getElementById('join-requests-badge');
  const joinRequestsModal = document.getElementById('join-requests-modal');
  const leaveBtn = document.getElementById('leave-project-btn');

  const ROLE_RANK = { manager: 3, deputy: 2, member: 1 };

  async function loadMe() {
    const me = await fetch(`/api/projects/${encodeURIComponent(id)}/me`).then(r=>r.json()).catch(()=>null);
    return me?.membership || null;
  }

  async function loadParticipants() {
    const res = await fetch(`/api/projects/${encodeURIComponent(id)}/participants`).then(r=>r.json()).catch(()=>null);
    return res?.participants || [];
  }

  async function loadRequests() {
    const res = await fetch(`/api/projects/${encodeURIComponent(id)}/requests`).then(r=>r.json()).catch(()=>null);
    if (!res?.ok) return { joinRequests: [], promotionRequests: [] };
    return { joinRequests: res.joinRequests || [], promotionRequests: res.promotionRequests || [] };
  }

  function renderMembers(participants, myRole) {
    if (!membersList) return;
    const membersTotal = document.getElementById('members-total');
    if (membersTotal) membersTotal.textContent = participants.length;
    
    membersList.innerHTML = participants.map(p => {
      const canPromote = myRole === 'manager' && p.role === 'member';
      const canDemote = myRole === 'manager' && p.role === 'deputy';
      const canRemove = myRole && ROLE_RANK[myRole] > ROLE_RANK[p.role];
      const roleLabel = p.role === 'manager' ? 'Управляющий' : (p.role === 'deputy' ? 'Заместитель' : 'Участник');
      const roleClass = p.role;
      const displayName = p.display_name || p.username;
      const initial = p.username.charAt(0).toUpperCase();
      const avatarHtml = `<span>${initial}</span>`;
      const isOnline = p.online ? 'true' : 'false';
      
      let actionsHtml = '';
      if (canPromote) {
        actionsHtml += `<button class="member-action-btn btn-promote" data-action="promote" data-user="${p.id}">Повысить</button>`;
      }
      if (canDemote) {
        actionsHtml += `<button class="member-action-btn btn-demote" data-action="demote" data-user="${p.id}">Понизить</button>`;
      }
      if (canRemove) {
        actionsHtml += `<button class="member-action-btn btn-remove" data-action="remove" data-user="${p.id}">Удалить</button>`;
      }
      
      return (
        `<div class="member-card" data-user="${p.id}" data-online="${isOnline}">
          <a href="/Profile?id=${p.id}" class="member-avatar-link">
            <div class="member-avatar">${avatarHtml}</div>
          </a>
          <div class="member-info">
            <h3 class="member-display-name">${displayName}</h3>
            <p class="member-username">@${p.username}</p>
            <span class="member-role ${roleClass}">${roleLabel}</span>
          </div>
          ${actionsHtml ? `<div class="member-actions">${actionsHtml}</div>` : ''}
        </div>`
      );
    }).join('');
  }

  function renderRequests(joins, myRole) {
    const isManager = myRole === 'manager';
    const isDeputy = myRole === 'deputy';
    const canSeeRequests = isManager || isDeputy;
    
    // Отображаем кнопку заявок только для управляющего и заместителя
    if (joinRequestsBtn) {
      joinRequestsBtn.classList.toggle('hidden', !canSeeRequests);
    }
    
    // Обновляем счётчик заявок
    if (joinRequestsBadge) {
      if (joins.length > 0) {
        joinRequestsBadge.textContent = joins.length;
        joinRequestsBadge.classList.remove('hidden');
      } else {
        joinRequestsBadge.classList.add('hidden');
      }
    }
    
    // Рендерим список заявок
    if (joinBox) {
      joinBox.innerHTML = joins.length ? joins.map(r => {
        const displayName = r.display_name || r.username;
        return (
          `<div class="request-item" data-req="${r.id}" data-user="${r.user_id}">
            <p class="request-user">${displayName}</p>
            <p class="request-username">@${r.username}</p>
            <div class="request-actions">
              <button class="request-btn btn-accept" data-action="approve-join">Принять</button>
              <button class="request-btn btn-reject" data-action="reject-join">Отклонить</button>
            </div>
          </div>`
        );
      }).join('') : '<p class="no-requests">Нет заявок</p>';
    }
    
    // Кнопка покинуть проект (скрыта у управляющего)
    if (leaveBtn) {
      leaveBtn.classList.toggle('hidden', myRole === 'manager' || !myRole);
    }
  }

  async function refresh() {
    const my = await loadMe();
    const participants = await loadParticipants();
    renderMembers(participants, my?.role);
    if (my?.role === 'manager' || my?.role === 'deputy') {
      const { joinRequests } = await loadRequests();
      renderRequests(joinRequests, my.role);
    } else {
      renderRequests([], my?.role || null);
    }
  }
  
  // Модальное окно заявок
  joinRequestsBtn?.addEventListener('click', () => {
    if (joinRequestsModal) joinRequestsModal.hidden = false;
  });
  
  joinRequestsModal?.querySelector('.modal-close')?.addEventListener('click', () => {
    if (joinRequestsModal) joinRequestsModal.hidden = true;
  });
  
  joinRequestsModal?.addEventListener('click', (e) => {
    if (e.target === joinRequestsModal) joinRequestsModal.hidden = true;
  });

  document.addEventListener('click', async (e) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    
    // Повышение участника
    if (target.matches('[data-action="promote"]')) {
      const userId = target.getAttribute('data-user');
      if (!userId) return;
      const res = await fetch(`/api/projects/${encodeURIComponent(id)}/promote`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId }) });
      const out = await res.json();
      if (out.ok) refresh(); else alert(out.error || 'Ошибка');
    }
    
    // Понижение заместителя
    if (target.matches('[data-action="demote"]')) {
      const userId = target.getAttribute('data-user');
      if (!userId) return;
      const res = await fetch(`/api/projects/${encodeURIComponent(id)}/demote`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId }) });
      const out = await res.json();
      if (out.ok) refresh(); else alert(out.error || 'Ошибка');
    }
    
    // Удаление участника
    if (target.matches('[data-action="remove"]')) {
      const userId = target.getAttribute('data-user');
      if (!userId) return;
      if (!confirm('Вы уверены, что хотите удалить этого участника?')) return;
      const res = await fetch(`/api/projects/${encodeURIComponent(id)}/kick`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId }) });
      const out = await res.json();
      if (out.ok) refresh(); else alert(out.error || 'Ошибка');
    }
    
    // Обработка заявок на вступление
    if (target.matches('[data-action="approve-join"]')) {
      const item = target.closest('.request-item');
      const reqId = item?.getAttribute('data-req');
      if (!reqId) return;
      const res = await fetch(`/api/projects/${encodeURIComponent(id)}/requests/${encodeURIComponent(reqId)}/approve-join`, { method: 'POST' });
      const out = await res.json();
      if (out.ok) {
        await refresh();
        // Закрываем модальное окно если нет больше заявок
        const joinRequests = await loadRequests().then(r => r.joinRequests || []);
        if (joinRequests.length === 0 && joinRequestsModal) {
          joinRequestsModal.hidden = true;
        }
      } else {
        alert(out.error || 'Ошибка');
      }
    }
    if (target.matches('[data-action="reject-join"]')) {
      const item = target.closest('.request-item');
      const reqId = item?.getAttribute('data-req');
      if (!reqId) return;
      const res = await fetch(`/api/projects/${encodeURIComponent(id)}/requests/${encodeURIComponent(reqId)}/reject-join`, { method: 'POST' });
      const out = await res.json();
      if (out.ok) {
        await refresh();
        // Закрываем модальное окно если нет больше заявок
        const joinRequests = await loadRequests().then(r => r.joinRequests || []);
        if (joinRequests.length === 0 && joinRequestsModal) {
          joinRequestsModal.hidden = true;
        }
      } else {
        alert(out.error || 'Ошибка');
      }
    }
  });

  leaveBtn?.addEventListener('click', async () => {
    if (!confirm('Вы уверены, что хотите покинуть проект?')) return;
    const res = await fetch(`/api/projects/${encodeURIComponent(id)}/leave`, { method: 'POST' });
    const out = await res.json();
    if (out.ok) {
      window.location.href = '/';
    } else {
      alert(out.error || 'Ошибка');
    }
  });

  function boot() { if (id) refresh(); }
  document.addEventListener('DOMContentLoaded', boot);
  window.addEventListener('pageshow', (e) => { try { if (e.persisted) boot(); } catch {} });
  // Также запускаем сразу для обычной загрузки
  boot();
})();


