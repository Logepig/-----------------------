(() => {
  function getParam(name) {
    const url = new URL(window.location.href);
    return url.searchParams.get(name);
  }

  async function init() {
    let id = getParam('id');
    if (!id) {
      const saved = localStorage.getItem('currentProjectId');
      if (saved) {
        const u = new URL(window.location.href);
        u.searchParams.set('id', saved);
        window.location.replace(u.pathname + '?' + u.searchParams.toString());
        return;
      }
      return;
    }
    // Сохраняем ID текущего проекта для надежной навигации
    try { localStorage.setItem('currentProjectId', id); } catch {}
    const header = document.getElementById('project-header');
    const detailsBox = document.getElementById('project-details');
    const sideNav = document.querySelector('.project-sidenav');
    const settingsLink = document.querySelector('.only-manager');

    try {
      const [detailsRes, meRes, stagesRes] = await Promise.all([
        fetch(`/api/projects/${encodeURIComponent(id)}`),
        fetch(`/api/projects/${encodeURIComponent(id)}/me`),
        fetch(`/api/projects/${encodeURIComponent(id)}/stages`)
      ]);
      const details = await detailsRes.json();
      const me = await meRes.json();
      const stagesOut = await stagesRes.json().catch(()=>({}));
      const stages = Array.isArray(stagesOut?.stages) ? stagesOut.stages : [];
      if (details?.ok && details.project) {
        const p = details.project;
        header.innerHTML = `
          <div class="project-hero">
            <img class="project-avatar-large" src="${p.avatar_url || '/img/icon_avatar_1.svg'}" alt="Аватар">
            <div class="project-meta">
              <h1>${p.name}</h1>
              <div class="project-sub">${p.participants_count} участников • ${p.project_type || ''}</div>
            </div>
          </div>
        `;
        if (detailsBox) {
          const model = p.model || '—';
          const topic = p.topic || '—';
          const type = p.project_type || '—';
          detailsBox.innerHTML = `
            <div class="kv">
              <div class="row"><div class="k">Модель:</div><div class="v">${model}</div></div>
              <div class="row"><div class="k">Тема:</div><div class="v">${topic}</div></div>
              <div class="row"><div class="k">Тип проекта:</div><div class="v">${type}</div></div>
            </div>
          `;
        }
        // Отображаем изображение модели, если есть
        const modelView = document.getElementById('model-view');
        if (modelView) {
          modelView.innerHTML = '';
          const svg = renderModelDiagram(p.model || '', { clickable: false, stages });
          if (svg) modelView.appendChild(svg); else modelView.innerHTML = '<span>Пока нет модели для отображения</span>';
          // Подсвечиваем выбранный этап, если есть
          if (svg && p.selected_stage_id) {
            const idx = stages.findIndex(s => s.id === p.selected_stage_id);
            const nodes = svg.querySelectorAll('.model-node');
            if (idx >= 0 && nodes[idx]) nodes[idx].classList.add('selected');
          }
        }
      }
      const isMember = !!me?.membership;
      if (!isMember && sideNav) {
        sideNav.remove();
      }
      // Убеждаемся, что ссылки боковой навигации содержат ID текущего проекта
      if (isMember && sideNav) {
        const links = sideNav.querySelectorAll('.project-nav a');
        links.forEach((a) => {
          try {
            const url = new URL(a.getAttribute('href'), window.location.origin);
            url.searchParams.set('id', id);
            a.setAttribute('href', url.pathname + '?' + url.searchParams.toString());
          } catch {}
        });
      }
      if (me?.membership?.role === 'manager' && settingsLink) settingsLink.hidden = false;
    } catch {}
  }

  document.addEventListener('DOMContentLoaded', init);
  // Гарантируем правильное восстановление состояния после назад/вперед в браузере (bfcache)
  window.addEventListener('pageshow', (e) => { try { if (e.persisted) init(); } catch {} });

  // Экспортируем для повторного использования на странице этапов
  window.renderModelDiagram = renderModelDiagram;

  function renderModelDiagram(modelName, options = {}) {
    const name = String(modelName || '').toLowerCase();
    if (!name) return null;
    if (['каскадная','waterfall'].includes(name)) {
      return buildWaterfall(options);
    }
    if (['v-образная','v-образная модель','v-shaped','v shaped','vmodel','v-образная модель разработки'].includes(name)) {
      return buildVModel(options);
    }
    if (['спиральная','spiral'].includes(name)) {
      return buildSpiral(options);
    }
    if (['iterative','итеративная','итерационная'].includes(name)) {
      return buildIterative(options);
    }
    // Другие модели: показываем простой ряд этапов (до 6 на строку)
    return buildSimpleStages(options);
  }

  function svgEl(tag, attrs = {}) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, String(v)));
    return el;
  }

  function buildBase(width, height) {
    const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: 'xMidYMid meet' });
    const defs = svgEl('defs');
    const marker = svgEl('marker', { id: 'arrow', viewBox: '0 0 10 10', refX: 6, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' });
    marker.appendChild(svgEl('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: 'currentColor' }));
    defs.appendChild(marker);
    svg.appendChild(defs);
    return svg;
  }

  function label(svg, x, y, text) {
    const t = svgEl('text', { x, y, class: 'model-label' });
    t.textContent = text;
    svg.appendChild(t);
  }

  function buildWaterfall({ clickable = false } = {}) {
    const svg = buildBase(900, 320);
    const steps = ['Требования','Проектирование','Реализация','Тестирование','Ввод в эксплуатацию'];
    const w = 160, h = 64, gap = 24, drop = 30;
    steps.forEach((s, i) => {
      const x = 40 + i * (w + gap);
      const y = 20 + i * drop;
      const rect = svgEl('rect', { x, y, width: w, height: h, rx: 10, ry: 10, class: 'model-node' });
      svg.appendChild(rect);
      label(svg, x + 12, y + h/2 + 4, s);
      if (i < steps.length - 1) {
        const ax = x + w; const ay = y + h/2; const bx = x + w + gap - 8; const by = y + drop + h/2;
        const path = svgEl('path', { d: `M ${ax} ${ay} C ${ax+18} ${ay}, ${bx-18} ${by}, ${bx} ${by}`, class: 'model-arrow' });
        svg.appendChild(path);
      }
      if (clickable) rect.classList.add('clickable');
    });
    return svg;
  }

  function buildVModel({ clickable = false } = {}) {
    const svg = buildBase(900, 360);
    const left = ['Требования','Проектирование','Дизайн'];
    const right = ['Верификация','Тестирование','Валидация'];
    const w = 160, h = 56, gap = 32, drop = 42;
    left.forEach((s, i) => {
      const x = 40 + i * (w/2 + 10); const y = 20 + i * drop;
      const rect = svgEl('rect', { x, y, width: w, height: h, rx: 10, ry: 10, class: 'model-node' });
      svg.appendChild(rect); label(svg, x + 12, y + h/2 + 4, s);
      if (i < left.length - 1) svg.appendChild(svgEl('path', { d: `M ${x+w} ${y+h/2} C ${x+w+18} ${y+h/2}, ${x+w/2+gap-18} ${y+drop+h/2}, ${x+w/2+gap} ${y+drop+h/2}`, class: 'model-arrow' }));
      if (clickable) rect.classList.add('clickable');
    });
    right.forEach((s, i) => {
      const x = 900 - 40 - (i+1)*w + i*(w/2 + 10); const y = 20 + i * drop;
      const rect = svgEl('rect', { x, y, width: w, height: h, rx: 10, ry: 10, class: 'model-node' });
      svg.appendChild(rect); label(svg, x + 12, y + h/2 + 4, s);
      if (i < right.length - 1) svg.appendChild(svgEl('path', { d: `M ${x} ${y+h/2} C ${x-18} ${y+h/2}, ${x - w/2 - gap + 18} ${y+drop+h/2}, ${x - w/2 - gap} ${y+drop+h/2}`, class: 'model-arrow' }));
      if (clickable) rect.classList.add('clickable');
    });
    // Нижняя фаза кодирования
    const cx = 900/2 - 80; const cy = Math.max(left.length, right.length) * drop + 80;
    const code = svgEl('rect', { x: cx, y: cy, width: 160, height: 58, rx: 10, ry: 10, class: 'model-node' });
    svg.appendChild(code); label(svg, cx + 12, cy + 34, 'Реализация');
    // Соединяем диагонали с нижней частью
    svg.appendChild(svgEl('path', { d: `M ${left.length*(w/2)+w/2+gap + 40} ${(left.length-1)*drop + h/2 + 20} C ${left.length*(w/2)+w/2+gap + 60} ${(left.length-1)*drop + h/2 + 20}, ${cx-20} ${cy+h/2}, ${cx} ${cy+h/2}`, class: 'model-arrow' }));
    svg.appendChild(svgEl('path', { d: `M ${900 - 40 - right.length*w + (right.length-1)*(w/2)} ${(right.length-1)*drop + h/2 + 20} C ${900 - 40 - right.length*w + (right.length-1)*(w/2) - 60} ${(right.length-1)*drop + h/2 + 20}, ${cx+180} ${cy+h/2}, ${cx+160} ${cy+h/2}`, class: 'model-arrow' }));
    if (clickable) code.classList.add('clickable');
    return svg;
  }

  function buildSpiral({ clickable = false } = {}) {
    const svg = buildBase(900, 420);
    const centerX = 450, centerY = 210;
    const turns = 3; const points = 260; const maxR = 150;
    let d = '';
    for (let i = 0; i <= points; i++) {
      const t = (i / points) * (Math.PI * 2 * turns);
      const r = (i / points) * maxR;
      const x = centerX + r * Math.cos(t);
      const y = centerY + r * Math.sin(t);
      d += i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
    }
    svg.appendChild(svgEl('path', { d, class: 'model-arrow' }));
    // Вехи
    const labels = ['Планирование','Риски','Разработка','Тесты'];
    labels.forEach((s, i) => {
      const t = (i / (labels.length-1)) * (Math.PI * 2 * (turns-0.2));
      const r = (i / (labels.length-1)) * maxR;
      const x = centerX + r * Math.cos(t);
      const y = centerY + r * Math.sin(t);
      const rect = svgEl('rect', { x: x-70, y: y-22, width: 140, height: 44, rx: 10, ry: 10, class: 'model-node' });
      svg.appendChild(rect); label(svg, x-56, y+6, s);
      if (clickable) rect.classList.add('clickable');
    });
    return svg;
  }

  function buildIterative({ clickable = false } = {}) {
    const svg = buildBase(900, 300);
    const cycles = ['Итерация 1','Итерация 2','Итерация 3','Итерация 4'];
    const w = 170, h = 64, gap = 24;
    cycles.forEach((s, i) => {
      const x = 40 + i * (w + gap), y = 90;
      const rect = svgEl('rect', { x, y, width: w, height: h, rx: 8, ry: 8, class: 'model-node' });
      svg.appendChild(rect); label(svg, x + 20, y + 36, s);
      // Петля обратной связи
      const arc = svgEl('path', { d: `M ${x+w-6} ${y-4} C ${x+w+24} ${y-38}, ${x+w+24} ${y-38}, ${x+w-6} ${y-38}`, class: 'model-arrow' });
      svg.appendChild(arc);
      if (i < cycles.length - 1) svg.appendChild(svgEl('path', { d: `M ${x+w} ${y+h/2} C ${x+w+12} ${y+h/2}, ${x+w+gap-12} ${y+h/2}, ${x+w+gap} ${y+h/2}`, class: 'model-arrow' }));
      if (clickable) rect.classList.add('clickable');
    });
    return svg;
  }

  function buildSimpleStages({ clickable = false, stages = [] } = {}) {
    const list = stages.length ? stages.map(s => s.name) : ['Этап 1','Этап 2','Этап 3','Этап 4','Этап 5','Этап 6'];
    const perRow = 6; const rows = Math.ceil(list.length / perRow);
    const w = 120, h = 44, gap = 14; const top = 50; const height = top + rows * (h + 18) + 20; const width = 860;
    const svg = buildBase(width, Math.max(180, height));
    list.forEach((s, i) => {
      const row = Math.floor(i / perRow);
      const inRowIndex = i % perRow;
      const reversedIndex = (row % 2 === 1) ? (perRow - 1 - inRowIndex) : inRowIndex;
      const x = reversedIndex * (w + gap);
      const y = top + row * (h + 18);
      const rect = svgEl('rect', { x, y, width: w, height: h, rx: 8, ry: 8, class: 'model-node' });
      svg.appendChild(rect); label(svg, x + 18, y + 28, s);
      // Стрелки внутри ряда (учитываем обратный порядок визуально)
      const nextInRow = inRowIndex < perRow - 1 && (i + 1) < list.length;
      if (nextInRow) {
        const fromX = x + w; const fromY = y + h/2; const toX = x + w + gap; const toY = y + h/2;
        svg.appendChild(svgEl('path', { d: `M ${fromX} ${fromY} L ${toX} ${toY}`, class: 'model-arrow' }));
      }
      if (clickable) rect.classList.add('clickable');
    });
    return svg;
  }
})();


