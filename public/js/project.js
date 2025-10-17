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
      
      // Обновляем ссылки в мобильной навигации
      if (isMember) {
        const mobileNav = document.querySelector('.project-nav-mobile');
        if (mobileNav) {
          const mobileLinks = mobileNav.querySelectorAll('.project-nav-link');
          mobileLinks.forEach((a) => {
            try {
              const url = new URL(a.getAttribute('href'), window.location.origin);
              url.searchParams.set('id', id);
              a.setAttribute('href', url.pathname + '?' + url.searchParams.toString());
            } catch {}
          });
        }
      }
      
      // Показываем ссылку на настройки только управляющему
      if (settingsLink) {
        if (me?.membership?.role === 'manager') {
          settingsLink.hidden = false;
        } else {
          settingsLink.hidden = true;
        }
      }
      
      // Также обновляем ссылку настроек в мобильной навигации
      const mobileSettingsLink = document.querySelector('.project-nav-mobile .only-manager');
      if (mobileSettingsLink) {
        if (me?.membership?.role === 'manager') {
          mobileSettingsLink.hidden = false;
        } else {
          mobileSettingsLink.hidden = true;
        }
      }
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
    svg.style.overflow = 'visible';
    const defs = svgEl('defs');
    const marker = svgEl('marker', { id: 'arrow', viewBox: '0 0 10 10', refX: 6, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' });
    const arrowPath = svgEl('path', { d: 'M 0 0 L 10 5 L 0 10 z' });
    arrowPath.style.fill = 'var(--primary)';
    arrowPath.style.opacity = '0.6';
    marker.appendChild(arrowPath);
    defs.appendChild(marker);
    svg.appendChild(defs);
    return svg;
  }

  function label(svg, x, y, text) {
    const t = svgEl('text', { x, y, class: 'model-label', 'text-anchor': 'middle', 'dominant-baseline': 'middle' });
    t.textContent = text;
    svg.appendChild(t);
  }

  function buildWaterfall({ clickable = false } = {}) {
    const svg = buildBase(900, 400);
    const steps = ['Требования','Проектирование','Реализация','Тестирование','Развертывание'];
    const w = 145, h = 55, gap = 25, drop = 45;
    const startX = 50;
    const startY = 35;
    
    steps.forEach((s, i) => {
      const x = startX + i * (w + gap);
      const y = startY + i * drop;
      
      // Градиентный эффект через несколько прямоугольников
      const rect = svgEl('rect', { x, y, width: w, height: h, rx: 12, ry: 12, class: 'model-node' });
      svg.appendChild(rect);
      label(svg, x + w/2, y + h/2, s);
      
      if (i < steps.length - 1) {
        const ax = x + w; 
        const ay = y + h/2; 
        const bx = x + w + gap; 
        const by = y + drop + h/2;
        const midX = (ax + bx) / 2;
        
        // Плавная кривая вниз
        const path = svgEl('path', { 
          d: `M ${ax} ${ay} C ${midX} ${ay}, ${midX} ${by}, ${bx} ${by}`, 
          class: 'model-arrow',
          style: 'stroke-width: 2.5;'
        });
        svg.appendChild(path);
      }
      if (clickable) rect.classList.add('clickable');
    });
    return svg;
  }

  function buildVModel({ clickable = false } = {}) {
    const svg = buildBase(900, 420);
    const left = ['Требования','Архитектура','Модульный\nдизайн'];
    const right = ['Приемочное\nтестирование','Системное\nтестирование','Модульное\nтестирование'];
    const w = 135, h = 52, drop = 65;
    const leftStartX = 60;
    const rightStartX = 705;
    const startY = 40;
    
    // Левая сторона V (вниз)
    left.forEach((s, i) => {
      const x = leftStartX + i * 45;
      const y = startY + i * drop;
      const rect = svgEl('rect', { x, y, width: w, height: h, rx: 12, ry: 12, class: 'model-node' });
      svg.appendChild(rect); 
      label(svg, x + w/2, y + h/2, s.replace('\\n', ' '));
      
      if (i < left.length - 1) {
        const ax = x + w; 
        const ay = y + h/2;
        const bx = leftStartX + (i+1) * 45;
        const by = startY + (i+1) * drop + h/2;
        svg.appendChild(svgEl('path', { 
          d: `M ${ax} ${ay} L ${bx} ${by}`, 
          class: 'model-arrow',
          style: 'stroke-width: 2.5;'
        }));
      }
      if (clickable) rect.classList.add('clickable');
    });
    
    // Правая сторона V (вверх)
    right.forEach((s, i) => {
      const x = rightStartX - i * 45;
      const y = startY + i * drop;
      const rect = svgEl('rect', { x, y, width: w, height: h, rx: 12, ry: 12, class: 'model-node' });
      svg.appendChild(rect); 
      label(svg, x + w/2, y + h/2, s.replace('\\n', ' '));
      
      if (i < right.length - 1) {
        const ax = x;
        const ay = y + h/2;
        const bx = rightStartX - (i+1) * 45 + w;
        const by = startY + (i+1) * drop + h/2;
        svg.appendChild(svgEl('path', { 
          d: `M ${ax} ${ay} L ${bx} ${by}`, 
          class: 'model-arrow',
          style: 'stroke-width: 2.5;'
        }));
      }
      if (clickable) rect.classList.add('clickable');
    });
    
    // Нижняя фаза - Реализация
    const cx = 450 - 67.5;
    const cy = startY + left.length * drop + 15;
    const code = svgEl('rect', { x: cx, y: cy, width: 135, height: 52, rx: 12, ry: 12, class: 'model-node' });
    svg.appendChild(code); 
    label(svg, cx + 67.5, cy + 26, 'Реализация');
    
    // Соединения с нижней частью
    const leftLastX = leftStartX + (left.length-1) * 45 + w;
    const leftLastY = startY + (left.length-1) * drop + h/2;
    svg.appendChild(svgEl('path', { 
      d: `M ${leftLastX} ${leftLastY} L ${cx} ${cy + h/2}`, 
      class: 'model-arrow',
      style: 'stroke-width: 2.5;'
    }));
    
    const rightLastX = rightStartX - (right.length-1) * 45;
    const rightLastY = startY + (right.length-1) * drop + h/2;
    svg.appendChild(svgEl('path', { 
      d: `M ${cx + 135} ${cy + h/2} L ${rightLastX} ${rightLastY}`, 
      class: 'model-arrow',
      style: 'stroke-width: 2.5;'
    }));
    
    if (clickable) code.classList.add('clickable');
    return svg;
  }

  function buildSpiral({ clickable = false } = {}) {
    const svg = buildBase(900, 420);
    const centerX = 450, centerY = 210;
    const turns = 3; 
    const points = 250; 
    const maxR = 150;
    
    // Рисуем спираль
    let d = '';
    for (let i = 0; i <= points; i++) {
      const t = (i / points) * (Math.PI * 2 * turns);
      const r = (i / points) * maxR;
      const x = centerX + r * Math.cos(t - Math.PI/2);
      const y = centerY + r * Math.sin(t - Math.PI/2);
      d += i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
    }
    svg.appendChild(svgEl('path', { 
      d, 
      class: 'model-arrow', 
      style: 'stroke-width: 3; opacity: 0.6; fill: none;' 
    }));
    
    // Этапы на спирали
    const labels = ['Планирование','Оценка рисков','Разработка','Тестирование'];
    labels.forEach((s, i) => {
      const progress = (i + 0.5) / labels.length;
      const angle = progress * (Math.PI * 2 * turns) - Math.PI/2;
      const r = progress * maxR;
      const x = centerX + r * Math.cos(angle);
      const y = centerY + r * Math.sin(angle);
      
      const rect = svgEl('rect', { 
        x: x-62, 
        y: y-24, 
        width: 124, 
        height: 48, 
        rx: 12, 
        ry: 12, 
        class: 'model-node' 
      });
      svg.appendChild(rect); 
      label(svg, x, y, s);
      if (clickable) rect.classList.add('clickable');
    });
    
    return svg;
  }

  function buildIterative({ clickable = false } = {}) {
    const svg = buildBase(900, 340);
    const cycles = ['Итерация 1','Итерация 2','Итерация 3','Итерация 4'];
    const w = 155, h = 58, gap = 32;
    const startX = 70;
    const startY = 110;
    
    cycles.forEach((s, i) => {
      const x = startX + i * (w + gap);
      const y = startY;
      
      const rect = svgEl('rect', { x, y, width: w, height: h, rx: 12, ry: 12, class: 'model-node' });
      svg.appendChild(rect); 
      label(svg, x + w/2, y + h/2, s);
      
      // Петля обратной связи (дуга сверху)
      const loopTop = y - 45;
      const loopMid = x + w/2;
      const loopPath = `M ${x + w - 12} ${y} 
                        C ${x + w + 12} ${y - 18}, ${x + w + 12} ${loopTop + 8}, ${loopMid} ${loopTop}
                        C ${x - 12} ${loopTop + 8}, ${x - 12} ${y - 18}, ${x + 12} ${y}`;
      const arc = svgEl('path', { 
        d: loopPath, 
        class: 'model-arrow', 
        style: 'fill: none; stroke-width: 2.5;' 
      });
      svg.appendChild(arc);
      
      // Стрелка вперед к следующей итерации
      if (i < cycles.length - 1) {
        const forwardPath = `M ${x + w} ${y + h/2} L ${x + w + gap} ${y + h/2}`;
        svg.appendChild(svgEl('path', { 
          d: forwardPath, 
          class: 'model-arrow',
          style: 'stroke-width: 2.5;'
        }));
      }
      
      if (clickable) rect.classList.add('clickable');
    });
    
    return svg;
  }

  function buildSimpleStages({ clickable = false, stages = [] } = {}) {
    const list = stages.length ? stages.map(s => s.name) : ['Этап 1','Этап 2','Этап 3','Этап 4','Этап 5','Этап 6'];
    const perRow = 6; 
    const rows = Math.ceil(list.length / perRow);
    const w = 130, h = 50, gap = 16; 
    const top = 40; 
    const height = top + rows * (h + 20) + 20; 
    const width = 900;
    const svg = buildBase(width, Math.max(180, height));
    
    list.forEach((s, i) => {
      const row = Math.floor(i / perRow);
      const inRowIndex = i % perRow;
      // Всегда слева направо
      const x = 20 + inRowIndex * (w + gap);
      const y = top + row * (h + 20);
      
      const rect = svgEl('rect', { x, y, width: w, height: h, rx: 10, ry: 10, class: 'model-node' });
      svg.appendChild(rect); 
      label(svg, x + w/2, y + h/2 + 5, s);
      
      // Стрелки
      const nextInRow = inRowIndex < perRow - 1 && (i + 1) < list.length;
      if (nextInRow) {
        const fromX = x + w; 
        const fromY = y + h/2; 
        const toX = x + w + gap - 8; 
        const toY = y + h/2;
        svg.appendChild(svgEl('path', { d: `M ${fromX} ${fromY} L ${toX} ${toY}`, class: 'model-arrow' }));
      }
      
      if (clickable) rect.classList.add('clickable');
    });
    return svg;
  }
})();


