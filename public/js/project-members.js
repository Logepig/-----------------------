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
  const promotionBox = document.getElementById('promotion-requests');
  const requestBoxes = Array.from(document.querySelectorAll('.requests-box'));
  const requestPromotionBtn = document.getElementById('request-promotion-btn');
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
    membersList.innerHTML = participants.map(p => {
      const showKick = myRole && ROLE_RANK[myRole] > ROLE_RANK[p.role];
      const roleLabel = p.role === 'manager' ? 'Управляющий' : (p.role === 'deputy' ? 'Заместитель' : 'Участник');
      const statusColor = p.online ? '#14ae5c' : '#e5484d';
      const statusText = p.online ? 'онлайн' : 'оффлайн';
      return (
        `<div class="project-row" data-user="${p.id}">
          <div class="flex-block-projects">
            <div class="project-avatar" style="background:transparent; width:32px; height:32px; border-radius:50%; border:1px solid var(--border);"></div>
            <a class="project-name" href="/Profile.html?id=${encodeURIComponent(p.id)}">${p.username}</a>
          </div>
          <div class="project-participants">${roleLabel}</div>
          <div class="project-action">
            <span class="status-dot" style="display:inline-block; width:10px; height:10px; border-radius:50%; background:${statusColor}; margin-right:8px;"></span>
            <span class="status-text">${statusText}</span>
            ${showKick ? ' <button class="kick-btn" data-action="kick">Кикнуть</button>' : ''}
          </div>
        </div>`
      );
    }).join('');
  }

  function renderRequests(joins, promos, myRole) {
    const isManager = myRole === 'manager';
    const isDeputy = myRole === 'deputy';
    // Видимость: заместитель -> только вступление; управляющий -> оба; остальные -> ничего
    requestBoxes.forEach(box => { box.classList.add('hidden'); });
    const joinBoxContainer = joinBox ? joinBox.closest('.requests-box') : null;
    const promoBoxContainer = promotionBox ? promotionBox.closest('.requests-box') : null;
    if (isDeputy && joinBoxContainer) joinBoxContainer.classList.remove('hidden');
    if (isManager) {
      if (joinBoxContainer) joinBoxContainer.classList.remove('hidden');
      if (promoBoxContainer) promoBoxContainer.classList.remove('hidden');
    }
    if (joinBox) {
      joinBox.innerHTML = joins.length ? joins.map(r => (
        `<div class="request-row" data-req="${r.id}" data-user="${r.user_id}">
          <div>${r.username}</div>
          <div>
            <button class="request-approve" data-action="approve-join" title="Принять">+</button>
            <button class="request-reject" data-action="reject-join" title="Отклонить">−</button>
          </div>
        </div>`
      )).join('') : '<div class="muted">Нет заявок</div>';
    }
    if (promotionBox) {
      promotionBox.innerHTML = isManager && promos.length ? promos.map(r => (
        `<div class="request-row" data-req="${r.id}" data-user="${r.user_id}">
          <div>${r.username}</div>
          <div>
            <button class="request-approve" data-action="approve-promotion" title="Повысить">+</button>
            <button class="request-reject" data-action="reject-promotion" title="Отклонить">−</button>
          </div>
        </div>`
      )).join('') : '<div class="muted">Нет заявок</div>';
    }
    if (requestPromotionBtn) {
      // Видна только для участников
      requestPromotionBtn.classList.toggle('hidden', myRole !== 'member');
    }
    if (leaveBtn) {
      // Скрыта у управляющего
      leaveBtn.classList.toggle('hidden', myRole === 'manager');
    }
  }

  async function refresh() {
    const my = await loadMe();
    const participants = await loadParticipants();
    renderMembers(participants, my?.role);
    if (my?.role === 'manager' || my?.role === 'deputy') {
      const { joinRequests, promotionRequests } = await loadRequests();
      renderRequests(joinRequests, promotionRequests, my.role);
    } else {
      renderRequests([], [], my?.role || null);
    }
  }

  document.addEventListener('click', async (e) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    // Кик пользователя
    if (target.matches('.kick-btn')) {
      const row = target.closest('.project-row');
      const userId = row?.getAttribute('data-user');
      if (!userId) return;
      const res = await fetch(`/api/projects/${encodeURIComponent(id)}/kick`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId }) });
      const out = await res.json();
      if (out.ok) refresh(); else alert(out.error || 'Ошибка');
    }
    // Одобрение заявок
    if (target.matches('[data-action="approve-join"]')) {
      const row = target.closest('.request-row');
      const reqId = row?.getAttribute('data-req');
      if (!reqId) return;
      const res = await fetch(`/api/projects/${encodeURIComponent(id)}/requests/${encodeURIComponent(reqId)}/approve-join`, { method: 'POST' });
      const out = await res.json();
      if (out.ok) refresh(); else alert(out.error || 'Ошибка');
    }
    if (target.matches('[data-action="reject-join"]')) {
      const row = target.closest('.request-row');
      const reqId = row?.getAttribute('data-req');
      if (!reqId) return;
      const res = await fetch(`/api/projects/${encodeURIComponent(id)}/requests/${encodeURIComponent(reqId)}/reject-join`, { method: 'POST' });
      const out = await res.json();
      if (out.ok) refresh(); else alert(out.error || 'Ошибка');
    }
    if (target.matches('[data-action="approve-promotion"]')) {
      const row = target.closest('.request-row');
      const reqId = row?.getAttribute('data-req');
      if (!reqId) return;
      const res = await fetch(`/api/projects/${encodeURIComponent(id)}/requests/${encodeURIComponent(reqId)}/approve-promotion`, { method: 'POST' });
      const out = await res.json();
      if (out.ok) refresh(); else alert(out.error || 'Ошибка');
    }
    if (target.matches('[data-action="reject-promotion"]')) {
      const row = target.closest('.request-row');
      const reqId = row?.getAttribute('data-req');
      if (!reqId) return;
      const res = await fetch(`/api/projects/${encodeURIComponent(id)}/requests/${encodeURIComponent(reqId)}/reject-promotion`, { method: 'POST' });
      const out = await res.json();
      if (out.ok) refresh(); else alert(out.error || 'Ошибка');
    }
  });

  requestPromotionBtn?.addEventListener('click', async () => {
    const res = await fetch(`/api/projects/${encodeURIComponent(id)}/request-promotion`, { method: 'POST' });
    const out = await res.json();
    if (out.ok) {
      requestPromotionBtn.classList.add('hidden');
      refresh();
    } else {
      alert(out.error || 'Ошибка');
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


