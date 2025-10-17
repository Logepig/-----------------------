(() => {
  function getParam(name) { try { const u = new URL(window.location.href); return u.searchParams.get(name); } catch { return null; } }

  function canAddStages(modelName) {
    const name = String(modelName || '').toLowerCase();
    return ['agile','skrum','scrum','code & fix','code and fix','пользовательская'].some(k => name.includes(k));
  }

  async function initStages() {
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
    const canvas = document.getElementById('stages-canvas');
    const controls = document.getElementById('stages-controls');
    if (!canvas) return;

    try {
      const [detailsRes, meRes] = await Promise.all([
        fetch(`/api/projects/${encodeURIComponent(id)}`),
        fetch(`/api/projects/${encodeURIComponent(id)}/me`)
      ]);
      const details = await detailsRes.json();
      const me = await meRes.json();
      const role = me?.membership?.role || null;
      const editable = role === 'manager' || role === 'deputy';

      if (!details?.ok || !details.project) return;
      const p = details.project;
      const model = String(p.model || '').toLowerCase();
      const isDiagram = ['каскадная','waterfall','v-образная','v-shaped','v shaped','vmodel','спиральная','spiral','iterative','итеративная','итерационная'].includes(model);
      const canEdit = editable && isDiagram; // На диаграммных моделях можно только переименовывать
      const canAddDelete = editable && !isDiagram; // На пользовательских можно добавлять и удалять
      
      if (controls) {
        controls.hidden = !editable; // Показываем контролы если есть права
        
        const addOpen = document.getElementById('add-stage-open');
        const editOpen = document.getElementById('edit-stage-open');
        const deleteOpen = document.getElementById('delete-stage-open');
        const addModal = document.getElementById('add-stage-modal');
        const editModal = document.getElementById('edit-stage-modal');
        const deleteModal = document.getElementById('delete-stage-modal');
        const addForm = document.getElementById('add-stage-form');
        const editForm = document.getElementById('edit-stage-form');
        const deleteForm = document.getElementById('delete-stage-form');
        const editSelect = document.getElementById('edit-stage-select');
        const deleteSelect = document.getElementById('delete-stage-select');
        const addClose = addModal?.querySelector('.modal-close');
        const editClose = editModal?.querySelector('.modal-close');
        const deleteClose = deleteModal?.querySelector('.modal-close');

        function open(el){ if (el) el.hidden = false; }
        function close(el){ if (el) el.hidden = true; }
        function fillEditOptions(){ if (!editSelect) return; editSelect.innerHTML = stages.map(s => `<option value="${s.id}">${s.name}</option>`).join(''); }
        function fillDeleteOptions(){ if (!deleteSelect) return; deleteSelect.innerHTML = stages.map(s => `<option value="${s.id}">${s.name}</option>`).join(''); }

        // Скрываем/показываем кнопки в зависимости от типа модели
        if (addOpen) addOpen.style.display = canAddDelete ? '' : 'none';
        if (editOpen) editOpen.style.display = (canEdit || canAddDelete) ? '' : 'none';
        if (deleteOpen) deleteOpen.style.display = canAddDelete ? '' : 'none';

        addOpen?.addEventListener('click', () => open(addModal));
        editOpen?.addEventListener('click', () => { fillEditOptions(); open(editModal); });
        deleteOpen?.addEventListener('click', () => { fillDeleteOptions(); open(deleteModal); });
        addClose?.addEventListener('click', () => close(addModal));
        editClose?.addEventListener('click', () => close(editModal));
        deleteClose?.addEventListener('click', () => close(deleteModal));
        addModal?.addEventListener('click', (e) => { if (e.target === addModal) close(addModal); });
        editModal?.addEventListener('click', (e) => { if (e.target === editModal) close(editModal); });
        deleteModal?.addEventListener('click', (e) => { if (e.target === deleteModal) close(deleteModal); });

        addForm?.addEventListener('submit', async (e) => {
          e.preventDefault();
          const fd = new FormData(addForm); const name = fd.get('name');
          if (!name || !String(name).trim()) return;
          const out = await fetch(`/api/projects/${encodeURIComponent(id)}/stages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: String(name).trim() }) }).then(r=>r.json());
          if (out?.ok) { stages.push(out.stage); renderFromStages(); close(addModal); addForm.reset(); }
        });

        editForm?.addEventListener('submit', async (e) => {
          e.preventDefault();
          const fd = new FormData(editForm); const sid = fd.get('stageId'); const newName = fd.get('newName');
          if (!sid || !newName || !String(newName).trim()) return;
          const out = await fetch(`/api/projects/${encodeURIComponent(id)}/stages/${encodeURIComponent(String(sid))}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: String(newName).trim() }) }).then(r=>r.json());
          if (out?.ok) {
            const i = stages.findIndex(s => s.id === sid);
            if (i >= 0) stages[i].name = String(newName).trim();
            renderFromStages(); close(editModal); editForm.reset();
          }
        });

        deleteForm?.addEventListener('submit', async (e) => {
          e.preventDefault();
          const fd = new FormData(deleteForm); const sid = fd.get('stageId');
          if (!sid) return;
          const out = await fetch(`/api/projects/${encodeURIComponent(id)}/stages/${encodeURIComponent(String(sid))}`, { method: 'DELETE' }).then(r=>r.json());
          if (out?.ok) {
            const i = stages.findIndex(s => s.id === sid);
            if (i >= 0) stages.splice(i, 1);
            renderFromStages(); close(deleteModal); deleteForm.reset();
          }
        });
      }

      async function saveSelected(stageId) {
        await fetch(`/api/projects/${encodeURIComponent(id)}/select-stage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stageId }) });
      }

      function highlightSelected(svg, stages, selectedId) {
        if (!selectedId) return;
        const idx = stages.findIndex(s => s.id === selectedId);
        if (idx < 0) return;
        const nodes = svg.querySelectorAll('.model-node');
        if (nodes[idx]) nodes[idx].classList.add('selected');
      }

      function attachConfirm(svg, stages) {
        if (!editable) return svg;
        svg.querySelectorAll('.model-node').forEach((node, idx) => {
          node.style.cursor = 'pointer';
          node.addEventListener('click', async () => {
            const ok = confirm('Выбрать этот этап?');
            if (ok) {
              svg.querySelectorAll('.model-node').forEach(n => n.classList.remove('selected'));
              node.classList.add('selected');
              const stage = stages[idx] || null;
              if (stage?.id) await saveSelected(stage.id);
            }
          });
        });
        return svg;
      }

      // Рендерим из БД этапов, чтобы сохранить порядок и соответствие
      const list = await fetch(`/api/projects/${encodeURIComponent(id)}/stages`).then(r=>r.json());
      const stages = Array.isArray(list?.stages) ? list.stages : [];
      // Выбираем рендерер по модели, но метки берем из БД
      function renderFromStages() {
        const svg = window.renderModelDiagram(model || 'simple', { clickable: editable, stages });
        canvas.innerHTML = '';
        canvas.appendChild(attachConfirm(svg, stages));
        highlightSelected(svg, stages, p.selected_stage_id);
      }
      renderFromStages();

      if (addEnabled && toolbar) {
        toolbar.querySelector('#add-stage-btn')?.addEventListener('click', async () => {
          const name = prompt('Название этапа');
          if (!name || !name.trim()) return;
          const out = await fetch(`/api/projects/${encodeURIComponent(id)}/stages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim() }) }).then(r=>r.json());
          if (out?.ok) { stages.push(out.stage); renderFromStages(); }
        });
      }
    } catch {}
  }

  document.addEventListener('DOMContentLoaded', initStages);
  window.addEventListener('pageshow', (e) => { try { if (e.persisted) initStages(); } catch {} });
})();


