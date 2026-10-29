// ============================================================
// GuionEditor — Lógica principal
// Organizador de guiones (formato estándar) y escaletas por proyecto.
// Persistencia en localStorage. Sin servidor ni dependencias.
// ============================================================

(() => {
  'use strict';

  // ====== Configuración ======
  const STORAGE_KEY = 'guionEditor_v1';

  // Definición de tipos de elemento de guion y sus ciclos
  const TAB_CYCLE = {
    scene_heading: 'action',
    action: 'character',
    character: 'parenthetical',
    parenthetical: 'dialogue',
    dialogue: 'transition',
    transition: 'shot',
    shot: 'scene_heading',
  };

  const TAB_CYCLE_BACK = {
    scene_heading: 'shot',
    action: 'scene_heading',
    character: 'action',
    parenthetical: 'character',
    dialogue: 'parenthetical',
    transition: 'dialogue',
    shot: 'transition',
  };

  // Tipo automático al presionar Enter (comportamiento tipo WriterDuet)
  const ENTER_NEXT = {
    scene_heading: 'action',
    action: 'action',
    character: 'dialogue',
    parenthetical: 'dialogue',
    dialogue: 'action',
    transition: 'scene_heading',
    shot: 'scene_heading',
  };

  const TYPE_LABELS = {
    scene_heading: 'Escena',
    action: 'Acción',
    character: 'Personaje',
    parenthetical: 'Paréntesis',
    dialogue: 'Diálogo',
    transition: 'Transición',
    shot: 'Plano',
  };

  const TYPE_PLACEHOLDERS = {
    scene_heading: 'Ej: INT. CAFETERÍA — DÍA',
    action: 'Describe la acción...',
    character: 'NOMBRE DEL PERSONAJE',
    parenthetical: '(acotación)',
    dialogue: 'Escribe el diálogo...',
    transition: 'CORTE A:',
    shot: 'PLANO GENERAL',
  };

  const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

  // ====== Estado ======
  let state = {
    projects: [],
    currentProjectId: null,
    currentTab: 'escaleta',
    spellLang: 'es',
  };

  let autocompleteState = { elId: null, items: [], activeIndex: -1, replaceMode: 'full' };

  // ====== Utilidades ======
  function uid(prefix) {
    return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function getCurrentProject() {
    return state.projects.find(p => p.id === state.currentProjectId) || null;
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.error('No se pudo guardar:', e);
    }
  }

  function migrateSequence(seq) {
    if (seq.heading !== undefined) return seq;
    let heading = '';
    if (seq.setting) heading += seq.setting;
    if (seq.location) heading += (heading ? ' ' : '') + seq.location;
    if (seq.timeOfDay) heading += ' - ' + seq.timeOfDay;
    if (seq.duration) heading += ' (' + seq.duration + ')';
    return { id: seq.id, heading: heading.trim(), notes: seq.description || '' };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        state = JSON.parse(raw);
        if (!state.projects) state.projects = [];
        if (!state.currentTab) state.currentTab = 'notas';
        if (state.spellLang === undefined) state.spellLang = 'es';
        // Migrar proyectos: añadir notas y migrar escaleta al nuevo formato
        state.projects.forEach(p => {
          if (!p.notas) p.notas = [];
          p.notas.forEach(n => { if (!n.images) n.images = []; });
          if (p.escaleta) {
            p.escaleta = p.escaleta.map(migrateSequence);
          }
        });
      }
    } catch (e) {
      console.error('No se pudo cargar:', e);
      state = { projects: [], currentProjectId: null, currentTab: 'notas', spellLang: 'es' };
    }
  }

  function formatDate(ts) {
    const d = new Date(ts);
    return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ====== Corrector ortográfico propio (Typo.js + diccionarios Hunspell) ======
  // Funciona sin depender del navegador. Subraya errores en rojo.
  let typoInstances = {};
  let spellCheckTimers = {};

  function getTypo(lang) {
    if (typoInstances[lang]) return typoInstances[lang];
    try {
      if (lang === 'es' && typeof es_aff_data !== 'undefined' && typeof es_dic_data !== 'undefined') {
        typoInstances.es = new Typo('es', es_aff_data, es_dic_data);
        return typoInstances.es;
      }
      if (lang === 'en' && typeof en_aff_data !== 'undefined' && typeof en_dic_data !== 'undefined') {
        typoInstances.en = new Typo('en', en_aff_data, en_dic_data);
        return typoInstances.en;
      }
    } catch (e) {
      console.error('Error cargando diccionario ' + lang + ':', e);
    }
    return null;
  }

  // Verifica si una palabra es correcta según el idioma configurado
  function isWordCorrect(word) {
    const lang = state.spellLang || '';
    if (lang === 'es') {
      const t = getTypo('es');
      return t ? t.check(word) : true;
    }
    if (lang === 'en') {
      const t = getTypo('en');
      return t ? t.check(word) : true;
    }
    // Auto: correcta si está en cualquiera de los dos
    const tEs = getTypo('es');
    const tEn = getTypo('en');
    if (tEs && tEn) return tEs.check(word) || tEn.check(word);
    if (tEs) return tEs.check(word);
    if (tEn) return tEn.check(word);
    return true;
  }

  // Convierte texto a HTML con palabras erróneas subrayadas en rojo
  function highlightSpelling(text) {
    let result = '';
    let word = '';
    let nonWord = '';
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (/[a-záéíóúüñA-ZÁÉÍÓÚÜÑ]/.test(ch)) {
        if (nonWord) { result += escapeHtml(nonWord); nonWord = ''; }
        word += ch;
      } else {
        if (word) {
          if (word.length > 1 && !isWordCorrect(word)) {
            result += '<span class="spell-error">' + escapeHtml(word) + '</span>';
          } else {
            result += escapeHtml(word);
          }
          word = '';
        }
        nonWord += ch;
      }
    }
    if (word) {
      if (word.length > 1 && !isWordCorrect(word)) {
        result += '<span class="spell-error">' + escapeHtml(word) + '</span>';
      } else {
        result += escapeHtml(word);
      }
    }
    if (nonWord) result += escapeHtml(nonWord);
    return result;
  }

  // Guardar y restaurar posición del cursor por offset de caracteres
  function saveCaretOffset(element) {
    const sel = window.getSelection();
    if (sel.rangeCount === 0) return 0;
    const range = sel.getRangeAt(0);
    const preRange = range.cloneRange();
    preRange.selectNodeContents(element);
    preRange.setEnd(range.endContainer, range.endOffset);
    return preRange.toString().length;
  }

  function restoreCaretOffset(element, offset) {
    let charCount = 0;
    const range = document.createRange();
    let found = false;
    function traverse(node) {
      if (found) return;
      if (node.nodeType === Node.TEXT_NODE) {
        const nextCount = charCount + node.textContent.length;
        if (offset >= charCount && offset <= nextCount) {
          range.setStart(node, Math.min(offset - charCount, node.textContent.length));
          range.collapse(true);
          found = true;
        }
        charCount = nextCount;
      } else {
        for (let i = 0; i < node.childNodes.length; i++) {
          traverse(node.childNodes[i]);
          if (found) return;
        }
      }
    }
    traverse(element);
    if (found) {
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }

  // Corrección ortográfica con debounce (espera a que el usuario deje de escribir)
  function runSpellCheck(divEl, elId) {
    const p = getCurrentProject();
    if (!p) return;
    const el = p.guion.find(e => e.id === elId);
    if (!el) return;
    if (spellCheckTimers[elId]) clearTimeout(spellCheckTimers[elId]);
    spellCheckTimers[elId] = setTimeout(() => {
      const text = divEl.textContent;
      const caretPos = saveCaretOffset(divEl);
      divEl.innerHTML = highlightSpelling(text);
      restoreCaretOffset(divEl, caretPos);
    }, 600);
  }

  // ====== Helpers de cursor en contenteditable ======
  function placeCaretAtEnd(el) {
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function placeCaretAtStart(el) {
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function isCaretAtStart(el) {
    const sel = window.getSelection();
    if (sel.rangeCount === 0) return true;
    const range = sel.getRangeAt(0);
    const testRange = range.cloneRange();
    testRange.selectNodeContents(el);
    testRange.setEnd(range.startContainer, range.startOffset);
    return testRange.toString().length === 0;
  }

  function isCaretAtEnd(el) {
    const sel = window.getSelection();
    if (sel.rangeCount === 0) return true;
    const range = sel.getRangeAt(0);
    const testRange = range.cloneRange();
    testRange.selectNodeContents(el);
    testRange.setStart(range.endContainer, range.endOffset);
    return testRange.toString().length === 0;
  }

  // ====== Proyectos ======
  function createProject() {
    const project = {
      id: uid('proj'),
      name: 'Proyecto sin título',
      createdAt: Date.now(),
      notas: [],
      escaleta: [],
      guion: [],
    };
    state.projects.push(project);
    state.currentProjectId = project.id;
    state.currentTab = 'notas';
    saveState();
    renderProjectList();
    renderProjectView();
    setTimeout(() => {
      const input = document.getElementById('projectName');
      if (input) { input.focus(); input.select(); }
    }, 50);
  }

  function selectProject(id) {
    state.currentProjectId = id;
    saveState();
    renderProjectList();
    renderProjectView();
  }

  function deleteProject(id) {
    showModal('Eliminar proyecto', '¿Seguro que quieres eliminar este proyecto y todo su contenido? Esta acción no se puede deshacer.', () => {
      state.projects = state.projects.filter(p => p.id !== id);
      if (state.currentProjectId === id) {
        state.currentProjectId = state.projects.length > 0 ? state.projects[0].id : null;
      }
      saveState();
      renderProjectList();
      renderProjectView();
    });
  }

  function renameProject(id, name) {
    const p = state.projects.find(p => p.id === id);
    if (p) { p.name = name || 'Proyecto sin título'; saveState(); renderProjectList(); }
  }

  // ====== Blog de notas ======
  function addNote() {
    const p = getCurrentProject();
    if (!p) return;
    p.notas.push({
      id: uid('note'),
      content: '',
      images: [],
      createdAt: Date.now(),
    });
    saveState();
    renderNotas();
    renderProjectList();
    setTimeout(() => {
      const all = document.querySelectorAll('.note-body');
      if (all.length > 0) all[all.length - 1].focus();
    }, 30);
  }

  function updateNote(noteId, value) {
    const p = getCurrentProject();
    if (!p) return;
    const note = p.notas.find(n => n.id === noteId);
    if (note) { note.content = value; saveState(); }
  }

  function deleteNote(noteId) {
    const p = getCurrentProject();
    if (!p) return;
    p.notas = p.notas.filter(n => n.id !== noteId);
    saveState();
    renderNotas();
    renderProjectList();
  }

  // Imágenes en notas
  function addImageToNote(noteId, dataUrl) {
    const p = getCurrentProject();
    if (!p) return;
    const note = p.notas.find(n => n.id === noteId);
    if (note) {
      if (!note.images) note.images = [];
      note.images.push(dataUrl);
      saveState();
      renderNotas();
    }
  }

  function deleteImageFromNote(noteId, imageIndex) {
    const p = getCurrentProject();
    if (!p) return;
    const note = p.notas.find(n => n.id === noteId);
    if (note && note.images) {
      note.images.splice(imageIndex, 1);
      saveState();
      renderNotas();
    }
  }

  function handleNoteImageUpload(noteId, fileInput) {
    const files = fileInput.files;
    if (!files || files.length === 0) return;
    const maxSize = 2 * 1024 * 1024; // 2MB por imagen
    Array.from(files).forEach(file => {
      if (!file.type.startsWith('image/')) return;
      if (file.size > maxSize) {
        alert('La imagen "' + file.name + '" es muy grande (máx 2MB). Reduce su tamaño antes de subirla.');
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => addImageToNote(noteId, e.target.result);
      reader.readAsDataURL(file);
    });
    fileInput.value = '';
  }

  function renderNotas() {
    const p = getCurrentProject();
    if (!p) return;
    const container = document.getElementById('notasList');
    const emptyMsg = document.getElementById('notasEmpty');

    if (!p.notas || p.notas.length === 0) {
      container.innerHTML = '';
      emptyMsg.style.display = 'block';
      container.style.display = 'none';
      return;
    }
    emptyMsg.style.display = 'none';
    container.style.display = 'flex';
    container.innerHTML = '';

    p.notas.forEach(note => {
      const card = document.createElement('div');
      card.className = 'note-card';

      // Cabecera: fecha + eliminar
      const header = document.createElement('div');
      header.className = 'note-card-header';
      const date = document.createElement('span');
      date.className = 'note-date';
      date.textContent = formatDate(note.createdAt);
      const del = document.createElement('button');
      del.className = 'note-delete';
      del.innerHTML = '✕';
      del.title = 'Eliminar nota';
      del.addEventListener('click', () => deleteNote(note.id));
      header.appendChild(date);
      header.appendChild(del);

      // Cuerpo: texto libre
      const body = document.createElement('textarea');
      body.className = 'note-body';
      body.placeholder = 'Escribe lo que quieras...';
      body.value = note.content;
      body.addEventListener('input', () => {
        updateNote(note.id, body.value);
        autoGrow(body);
      });
      setTimeout(() => autoGrow(body), 0);

      // Imágenes
      const images = note.images || [];
      let imageGrid = null;
      if (images.length > 0) {
        imageGrid = document.createElement('div');
        imageGrid.className = 'note-images';
        images.forEach((imgData, imgIdx) => {
          const wrapper = document.createElement('div');
          wrapper.className = 'note-image-wrapper';
          const img = document.createElement('img');
          img.src = imgData;
          img.addEventListener('click', () => window.open(imgData, '_blank'));
          const imgDel = document.createElement('button');
          imgDel.className = 'note-image-delete';
          imgDel.innerHTML = '✕';
          imgDel.addEventListener('click', () => deleteImageFromNote(note.id, imgIdx));
          wrapper.appendChild(img);
          wrapper.appendChild(imgDel);
          imageGrid.appendChild(wrapper);
        });
      }

      // Barra de acciones: subir imagen
      const actions = document.createElement('div');
      actions.className = 'note-actions';
      const uploadLabel = document.createElement('label');
      uploadLabel.className = 'note-upload-btn';
      uploadLabel.innerHTML = '📎 Adjuntar imagen';
      const uploadInput = document.createElement('input');
      uploadInput.type = 'file';
      uploadInput.accept = 'image/*';
      uploadInput.multiple = true;
      uploadInput.style.display = 'none';
      uploadInput.addEventListener('change', () => handleNoteImageUpload(note.id, uploadInput));
      uploadLabel.appendChild(uploadInput);
      uploadLabel.addEventListener('click', () => uploadInput.click());
      actions.appendChild(uploadLabel);

      card.appendChild(header);
      card.appendChild(body);
      if (imageGrid) card.appendChild(imageGrid);
      card.appendChild(actions);
      container.appendChild(card);
    });
  }

  // ====== Escaleta — tarjetas estilo cuaderno ======
  function addSequence() {
    const p = getCurrentProject();
    if (!p) return;
    p.escaleta.push({
      id: uid('seq'),
      heading: '',
      notes: '',
    });
    saveState();
    renderEscaleta();
    renderProjectList();
    setTimeout(() => {
      const inputs = document.querySelectorAll('.seq-title-input');
      if (inputs.length > 0) inputs[inputs.length - 1].focus();
    }, 30);
  }

  function updateSequence(seqId, field, value) {
    const p = getCurrentProject();
    if (!p) return;
    const seq = p.escaleta.find(s => s.id === seqId);
    if (seq) { seq[field] = value; saveState(); }
  }

  function deleteSequence(seqId) {
    const p = getCurrentProject();
    if (!p) return;
    p.escaleta = p.escaleta.filter(s => s.id !== seqId);
    saveState();
    renderEscaleta();
    renderProjectList();
  }

  function moveSequence(seqId, dir) {
    const p = getCurrentProject();
    if (!p) return;
    const idx = p.escaleta.findIndex(s => s.id === seqId);
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= p.escaleta.length) return;
    [p.escaleta[idx], p.escaleta[newIdx]] = [p.escaleta[newIdx], p.escaleta[idx]];
    saveState();
    renderEscaleta();
  }

  // ====== Guion (screenplay) ======
  function addGuionElement(type) {
    const p = getCurrentProject();
    if (!p) return;
    const el = { id: uid('el'), type: type || 'scene_heading', text: '' };
    p.guion.push(el);
    saveState();
    renderGuion();
    renderProjectList();
    setTimeout(() => focusElement(el.id), 30);
  }

  function updateGuionElement(elId, text) {
    const p = getCurrentProject();
    if (!p) return;
    const el = p.guion.find(e => e.id === elId);
    if (el) { el.text = text; saveState(); }
  }

  function setElementType(elId, type) {
    const p = getCurrentProject();
    if (!p) return;
    const el = p.guion.find(e => e.id === elId);
    if (el) { el.type = type; saveState(); }
  }

  function deleteGuionElement(elId) {
    const p = getCurrentProject();
    if (!p) return;
    p.guion = p.guion.filter(e => e.id !== elId);
    saveState();
    renderGuion();
    renderProjectList();
  }

  function getElementIndex(elId) {
    const p = getCurrentProject();
    if (!p) return -1;
    return p.guion.findIndex(e => e.id === elId);
  }

  function getCharacterNames() {
    const p = getCurrentProject();
    if (!p) return [];
    const names = new Set();
    p.guion.forEach(el => {
      if (el.type === 'character' && el.text.trim()) {
        names.add(el.text.trim().toUpperCase());
      }
    });
    return Array.from(names).sort();
  }

  // Ubicaciones usadas previamente en encabezados de escena
  function getUsedLocations() {
    const p = getCurrentProject();
    if (!p) return [];
    const locs = new Set();
    p.guion.forEach(el => {
      if (el.type === 'scene_heading' && el.text.trim()) {
        let loc = el.text.trim().replace(/^(INT\.\/EXT\.|INT\.|EXT\.)\s*/i, '');
        loc = loc.split(/\s*-\s*/)[0].trim().toUpperCase();
        if (loc) locs.add(loc);
      }
    });
    return Array.from(locs).sort();
  }

  function focusElement(elId, atEnd) {
    const el = document.querySelector('.guion-el[data-id="' + elId + '"]');
    if (el) {
      el.focus();
      if (atEnd !== false) placeCaretAtEnd(el);
      else placeCaretAtStart(el);
    }
  }

  // ====== Autocompletado inteligente (estilo WriterDuet) ======

  // Devuelve sugerencias según el tipo de elemento y lo que se ha escrito
  function getSmartSuggestions(element, text) {
    const trimmed = text.trim();
    const upper = trimmed.toUpperCase();

    if (element.type === 'scene_heading') {
      // Si hay " - " estamos en la parte del tiempo del día
      const dashIdx = text.indexOf(' - ');
      if (dashIdx >= 0) {
        const timePart = text.substring(dashIdx + 3).trim().toUpperCase();
        const times = ['DÍA', 'NOCHE', 'AMANECER', 'ATARDECER', 'MEDIODÍA', 'CONT.'];
        if (timePart.length === 0) return times;
        return times.filter(t => t.indexOf(timePart) === 0 && t !== timePart);
      }

      // Sugerir prefijo INT./EXT. si el texto es corto y sin punto
      if (upper.length <= 7 && !upper.includes('.')) {
        const presets = [
          { trigger: 'INT', expand: 'INT. ' },
          { trigger: 'EXT', expand: 'EXT. ' },
          { trigger: 'I/E', expand: 'INT./EXT. ' },
          { trigger: 'INT/EXT', expand: 'INT./EXT. ' },
        ];
        const seen = new Set();
        const result = [];
        presets.forEach(s => {
          if (s.trigger.indexOf(upper) === 0 && !seen.has(s.expand)) {
            if (s.expand.trim() !== upper) {
              seen.add(s.expand);
              result.push(s.expand);
            }
          }
        });
        if (result.length > 0) return result;
      }

      // Sugerir ubicaciones usadas previamente (después del prefijo)
      if (upper.includes('.')) {
        const prefixMatch = trimmed.match(/^(INT\.\/EXT\.|INT\.|EXT\.)\s*/i);
        const prefix = prefixMatch ? prefixMatch[1].toUpperCase() : '';
        const afterPrefix = trimmed.replace(/^(INT\.\/EXT\.|INT\.|EXT\.)\s*/i, '').toUpperCase();
        if (afterPrefix.length > 0) {
          const locations = getUsedLocations();
          const locMatches = locations.filter(l => l.indexOf(afterPrefix) === 0 && l !== afterPrefix);
          return locMatches.map(l => prefix + ' ' + l);
        }
      }
      return [];
    }

    if (element.type === 'character') {
      if (upper.length < 1) return [];
      return getCharacterNames().filter(n => n.indexOf(upper) === 0 && n !== upper);
    }

    if (element.type === 'transition') {
      const trans = ['CORTE A:', 'CORTE SECO:', 'FADE IN:', 'FADE OUT.', 'DISOLVER A:', 'INTERCORTE A:', 'FUNDIDO A NEGRO:'];
      if (upper.length === 0) return trans;
      return trans.filter(t => t.indexOf(upper) === 0 && t !== upper);
    }

    return [];
  }

  function showSmartAutocomplete(divEl, elId) {
    const p = getCurrentProject();
    if (!p) return;
    const el = p.guion.find(e => e.id === elId);
    if (!el) return;

    const text = divEl.textContent;
    const suggestions = getSmartSuggestions(el, text);

    // Determinar modo de reemplazo
    let replaceMode = 'full';
    if (el.type === 'scene_heading' && text.indexOf(' - ') >= 0) {
      replaceMode = 'time';
    }

    if (suggestions.length === 0) {
      hideAutocomplete();
      return;
    }

    autocompleteState = { elId: elId, items: suggestions, activeIndex: 0, replaceMode: replaceMode };
    const dropdown = document.getElementById('autocomplete');
    dropdown.innerHTML = '';
    suggestions.forEach((sug, i) => {
      const item = document.createElement('div');
      item.className = 'autocomplete-item' + (i === 0 ? ' active' : '');
      item.textContent = sug;
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        acceptAutocomplete(sug, elId);
      });
      dropdown.appendChild(item);
    });

    const rect = divEl.getBoundingClientRect();
    dropdown.style.left = rect.left + 'px';
    dropdown.style.top = (rect.bottom + 4) + 'px';
    dropdown.style.display = 'block';
  }

  function updateAutocompleteActive() {
    const dropdown = document.getElementById('autocomplete');
    const items = dropdown.querySelectorAll('.autocomplete-item');
    items.forEach((item, i) => {
      item.classList.toggle('active', i === autocompleteState.activeIndex);
    });
  }

  function hideAutocomplete() {
    document.getElementById('autocomplete').style.display = 'none';
    autocompleteState = { elId: null, items: [], activeIndex: -1, replaceMode: 'full' };
  }

  function acceptAutocomplete(suggestion, elId) {
    const p = getCurrentProject();
    if (!p) return;
    const el = p.guion.find(e => e.id === elId);
    if (!el) return;

    if (autocompleteState.replaceMode === 'time') {
      // Reemplazar solo la parte del tiempo (después de " - ")
      const dashIdx = el.text.indexOf(' - ');
      if (dashIdx >= 0) {
        el.text = el.text.substring(0, dashIdx + 3) + suggestion;
      } else {
        el.text = el.text + ' - ' + suggestion;
      }
    } else {
      el.text = suggestion;
    }

    saveState();
    hideAutocomplete();
    renderGuion();
    setTimeout(() => focusElement(elId), 0);
  }

  // ====== Manejo de teclado del guion ======
  function handleGuionKeydown(e, elId) {
    const div = e.currentTarget;
    const idx = getElementIndex(elId);
    const p = getCurrentProject();
    if (!p || idx === -1) return;
    const element = p.guion[idx];

    const acOpen = autocompleteState.elId === elId && autocompleteState.items.length > 0;

    // Navegación del autocompletado (cualquier tipo con sugerencias abiertas)
    if (acOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        autocompleteState.activeIndex = Math.min(autocompleteState.activeIndex + 1, autocompleteState.items.length - 1);
        updateAutocompleteActive();
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        autocompleteState.activeIndex = Math.max(autocompleteState.activeIndex - 1, 0);
        updateAutocompleteActive();
        return;
      }
      if (e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault();
        acceptAutocomplete(autocompleteState.items[autocompleteState.activeIndex], elId);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        hideAutocomplete();
        return;
      }
      // Enter acepta sugerencia solo en encabezado de escena y transición
      // (en personaje/diálogo Enter crea nueva línea como es habitual)
      if (e.key === 'Enter' && (element.type === 'scene_heading' || element.type === 'transition')) {
        e.preventDefault();
        acceptAutocomplete(autocompleteState.items[autocompleteState.activeIndex], elId);
        return;
      }
    }

    // Tab: cambiar tipo de elemento
    if (e.key === 'Tab') {
      e.preventDefault();
      updateGuionElement(elId, div.textContent); // guardar texto actual antes de re-renderizar
      const newType = e.shiftKey ? TAB_CYCLE_BACK[element.type] : TAB_CYCLE[element.type];
      setElementType(elId, newType);
      hideAutocomplete();
      renderGuion();
      setTimeout(() => focusElement(elId), 0);
      return;
    }

    // Enter: nueva línea con tipo automático
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      updateGuionElement(elId, div.textContent);
      const newType = ENTER_NEXT[element.type] || 'action';
      const newEl = { id: uid('el'), type: newType, text: '' };
      p.guion.splice(idx + 1, 0, newEl);
      saveState();
      hideAutocomplete();
      renderGuion();
      setTimeout(() => focusElement(newEl.id), 0);
      return;
    }

    // Backspace en elemento vacío: borrar y enfocar el anterior
    if (e.key === 'Backspace' && div.textContent.trim() === '') {
      e.preventDefault();
      hideAutocomplete();
      if (idx > 0) {
        const prevId = p.guion[idx - 1].id;
        deleteGuionElement(elId);
        setTimeout(() => {
          const prevEl = document.querySelector('.guion-el[data-id="' + prevId + '"]');
          if (prevEl) { prevEl.focus(); placeCaretAtEnd(prevEl); }
        }, 0);
      }
      return;
    }

    // Flecha arriba al inicio: ir al elemento anterior
    if (e.key === 'ArrowUp' && isCaretAtStart(div) && idx > 0) {
      e.preventDefault();
      const prevEl = document.querySelector('.guion-el[data-id="' + p.guion[idx - 1].id + '"]');
      if (prevEl) { prevEl.focus(); placeCaretAtEnd(prevEl); }
      return;
    }

    // Flecha abajo al final: ir al siguiente elemento
    if (e.key === 'ArrowDown' && isCaretAtEnd(div) && idx < p.guion.length - 1) {
      e.preventDefault();
      const nextEl = document.querySelector('.guion-el[data-id="' + p.guion[idx + 1].id + '"]');
      if (nextEl) { nextEl.focus(); placeCaretAtStart(nextEl); }
      return;
    }
  }

  // Pegar como texto plano (evitar formato pegado)
  function handleGuionPaste(e) {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    document.execCommand('insertText', false, text);
  }

  // ====== Renderizado ======
  function renderProjectList() {
    const container = document.getElementById('projectList');
    container.innerHTML = '';
    if (state.projects.length === 0) {
      const hint = document.createElement('p');
      hint.style.cssText = 'color:var(--text-muted);font-size:12px;padding:16px;text-align:center;';
      hint.textContent = 'No hay proyectos todavía.';
      container.appendChild(hint);
      return;
    }
    state.projects.forEach(p => {
      const item = document.createElement('div');
      item.className = 'project-item' + (p.id === state.currentProjectId ? ' active' : '');
      const seqCount = p.escaleta.length;
      const guionCount = p.guion.length;
      const noteCount = (p.notas || []).length;
      const total = seqCount + guionCount + noteCount;
      item.innerHTML =
        '<span class="project-item-icon">📁</span>' +
        '<span class="project-item-name"></span>' +
        '<span class="project-item-count">' + total + '</span>';
      item.querySelector('.project-item-name').textContent = p.name;
      item.addEventListener('click', () => selectProject(p.id));
      container.appendChild(item);
    });
  }

  function renderProjectView() {
    const p = getCurrentProject();
    const emptyState = document.getElementById('emptyState');
    const projectView = document.getElementById('projectView');
    if (!p) {
      emptyState.style.display = 'flex';
      projectView.style.display = 'none';
      return;
    }
    emptyState.style.display = 'none';
    projectView.style.display = 'flex';

    const nameInput = document.getElementById('projectName');
    nameInput.value = p.name;
    document.getElementById('projectDate').textContent = 'Creado ' + formatDate(p.createdAt);

    // Pestaña activa
    switchTab(state.currentTab);
    renderNotas();
    renderEscaleta();
    renderGuion();
  }

  function switchTab(tab) {
    state.currentTab = tab;
    saveState();
    document.querySelectorAll('.tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === tab);
    });
    document.getElementById('notasView').classList.toggle('active', tab === 'notas');
    document.getElementById('escaletaView').classList.toggle('active', tab === 'escaleta');
    document.getElementById('guionView').classList.toggle('active', tab === 'guion');
  }

  function renderEscaleta() {
    const p = getCurrentProject();
    if (!p) return;
    const container = document.getElementById('escaletaList');
    const emptyMsg = document.getElementById('escaletaEmpty');

    if (p.escaleta.length === 0) {
      container.innerHTML = '';
      emptyMsg.style.display = 'block';
      container.style.display = 'none';
      return;
    }
    emptyMsg.style.display = 'none';
    container.style.display = 'flex';
    container.innerHTML = '';

    p.escaleta.forEach((seq, i) => {
      const card = document.createElement('div');
      card.className = 'sequence-card';

      // Franja de color
      const stripe = document.createElement('div');
      stripe.className = 'seq-stripe';
      card.appendChild(stripe);

      // Cabecera: número + título libre
      const header = document.createElement('div');
      header.className = 'seq-card-header';

      const badge = document.createElement('span');
      badge.className = 'seq-badge';
      badge.textContent = 'Sec ' + (i + 1);

      const titleInput = document.createElement('input');
      titleInput.type = 'text';
      titleInput.className = 'seq-title-input';
      titleInput.placeholder = 'Título de la secuencia (ej: INT. CAFETERÍA - DÍA)';
      titleInput.value = seq.heading || '';
      titleInput.addEventListener('input', () => updateSequence(seq.id, 'heading', titleInput.value));

      header.appendChild(badge);
      header.appendChild(titleInput);
      card.appendChild(header);

      // Cuerpo: área de notas libre
      const body = document.createElement('div');
      body.className = 'seq-card-body';

      const notes = document.createElement('textarea');
      notes.className = 'seq-notes';
      notes.placeholder = '¿Qué pasa en esta secuencia? Escribe libremente tus ideas...';
      notes.value = seq.notes || '';
      notes.addEventListener('input', () => {
        updateSequence(seq.id, 'notes', notes.value);
        autoGrow(notes);
      });
      setTimeout(() => autoGrow(notes), 0);

      body.appendChild(notes);
      card.appendChild(body);

      // Pie: reordenar + eliminar
      const footer = document.createElement('div');
      footer.className = 'seq-card-footer';

      const orderBtns = document.createElement('div');
      orderBtns.className = 'seq-order-btns';

      const upBtn = document.createElement('button');
      upBtn.className = 'seq-order-btn';
      upBtn.innerHTML = '↑';
      upBtn.title = 'Subir';
      if (i === 0) upBtn.disabled = true;
      upBtn.addEventListener('click', () => moveSequence(seq.id, -1));

      const downBtn = document.createElement('button');
      downBtn.className = 'seq-order-btn';
      downBtn.innerHTML = '↓';
      downBtn.title = 'Bajar';
      if (i === p.escaleta.length - 1) downBtn.disabled = true;
      downBtn.addEventListener('click', () => moveSequence(seq.id, 1));

      orderBtns.appendChild(upBtn);
      orderBtns.appendChild(downBtn);

      const delBtn = document.createElement('button');
      delBtn.className = 'seq-del-btn';
      delBtn.innerHTML = 'Eliminar';
      delBtn.addEventListener('click', () => deleteSequence(seq.id));

      footer.appendChild(orderBtns);
      footer.appendChild(delBtn);
      card.appendChild(footer);

      container.appendChild(card);
    });
  }

  function autoGrow(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = textarea.scrollHeight + 'px';
  }

  function renderGuion() {
    const p = getCurrentProject();
    if (!p) return;
    const container = document.getElementById('guionEditor');
    const emptyMsg = document.getElementById('guionEmpty');

    if (p.guion.length === 0) {
      container.innerHTML = '';
      emptyMsg.style.display = 'block';
      container.style.display = 'none';
      return;
    }
    emptyMsg.style.display = 'none';
    container.style.display = 'block';
    container.innerHTML = '';

    let sceneNumber = 0;
    p.guion.forEach(el => {
      const div = document.createElement('div');
      div.className = 'guion-el el-' + el.type;
      div.contentEditable = 'true';
      // Corrector ortográfico propio (desactivamos el del navegador)
      const spellTypes = ['action', 'parenthetical', 'dialogue'];
      const shouldSpellcheck = spellTypes.indexOf(el.type) !== -1;
      div.spellcheck = false;
      div.setAttribute('spellcheck', 'false');
      div.dataset.id = el.id;
      div.dataset.type = el.type;
      div.dataset.typelabel = TYPE_LABELS[el.type] || el.type;
      div.dataset.placeholder = TYPE_PLACEHOLDERS[el.type] || '';
      div.textContent = el.text;

      // Numeración automática de escenas
      if (el.type === 'scene_heading') {
        sceneNumber++;
        div.dataset.sceneNumber = sceneNumber;
      }

      // Aplicar corrección ortográfica inicial (subrayado rojo)
      if (shouldSpellcheck && el.text.trim()) {
        div.innerHTML = highlightSpelling(el.text);
      }

      div.addEventListener('keydown', (e) => handleGuionKeydown(e, el.id));
      div.addEventListener('input', () => {
        updateGuionElement(el.id, div.textContent);
        showSmartAutocomplete(div, el.id);
        if (shouldSpellcheck) runSpellCheck(div, el.id);
      });
      div.addEventListener('paste', handleGuionPaste);
      div.addEventListener('blur', () => {
        setTimeout(hideAutocomplete, 150);
      });

      container.appendChild(div);
    });
  }

  // ====== Exportar / Importar ======
  function padLeft(str, width) {
    str = String(str);
    while (str.length < width) str = ' ' + str;
    return str;
  }

  function pad(str, indent) {
    return ' '.repeat(indent) + str;
  }

  function wrapText(text, maxWidth, indent) {
    const words = text.split(/\s+/);
    const lines = [];
    let line = '';
    words.forEach(w => {
      if (!w) return;
      if (line.length + w.length + 1 <= maxWidth) {
        line = line ? line + ' ' + w : w;
      } else {
        lines.push(line);
        line = w;
      }
    });
    if (line) lines.push(line);
    return lines.map(l => pad(l, indent)).join('\n');
  }

  function exportGuionTxt() {
    const p = getCurrentProject();
    if (!p || p.guion.length === 0) return;
    let text = '';
    let prevType = '';

    p.guion.forEach(el => {
      const content = el.text.trim();
      if (!content) { prevType = el.type; return; }

      // Línea en blanco antes de encabezado de escena (excepto el primero)
      if (el.type === 'scene_heading' && prevType) text += '\n';
      // Línea en blanco antes de personaje
      if (el.type === 'character' && prevType && prevType !== 'scene_heading') text += '\n';

      switch (el.type) {
        case 'scene_heading':
          text += content.toUpperCase() + '\n\n';
          break;
        case 'action':
          text += wrapText(content, 68, 0) + '\n\n';
          break;
        case 'character':
          text += pad(content.toUpperCase(), 38) + '\n';
          break;
        case 'parenthetical':
          text += pad('(' + content.replace(/^\(|\)$/g, '') + ')', 30) + '\n';
          break;
        case 'dialogue':
          text += wrapText(content, 38, 25) + '\n';
          break;
        case 'transition':
          text += padLeft(content.toUpperCase(), 68) + '\n\n';
          break;
        case 'shot':
          text += content.toUpperCase() + '\n\n';
          break;
        default:
          text += content + '\n';
      }
      prevType = el.type;
    });

    downloadBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }),
      (p.name || 'guion').replace(/[^\w\-]+/g, '_') + '_guion.txt');
  }

  // ====== Exportar a PDF (vía impresión del navegador → Guardar como PDF) ======
  function exportGuionPdf() {
    const p = getCurrentProject();
    if (!p || p.guion.length === 0) return;

    // Generar el HTML del guion con formato de guion profesional
    let bodyHtml = '';
    p.guion.forEach(el => {
      const raw = el.text.trim();
      if (!raw) return;
      const escaped = escapeHtml(raw);
      let cls = el.type;
      let html = escaped;

      switch (el.type) {
        case 'scene_heading':
          html = escaped.toUpperCase();
          break;
        case 'character':
          html = escaped.toUpperCase();
          break;
        case 'parenthetical':
          html = '(' + escaped.replace(/^\(|\)$/g, '') + ')';
          break;
        case 'transition':
          html = escaped.toUpperCase();
          break;
        case 'shot':
          html = escaped.toUpperCase();
          break;
      }
      bodyHtml += '<div class="el-' + cls + '">' + html + '</div>\n';
    });

    const title = escapeHtml(p.name || 'Guion');
    const printHtml =
      '<!DOCTYPE html>\n' +
      '<html lang="es"><head><meta charset="UTF-8">\n' +
      '<title>' + title + ' — Guion</title>\n' +
      '<style>\n' +
      '@page { size: letter; margin: 1in 1in 1in 1.5in; }\n' +
      '@page :first { margin-top: 1in; }\n' +
      'body { font-family: "Courier New", Courier, monospace; font-size: 12pt; line-height: 1; color: #000; }\n' +
      '.el-scene_heading { font-weight: bold; text-transform: uppercase; margin-top: 1.5em; }\n' +
      '.el-scene_heading:first-child { margin-top: 0; }\n' +
      '.el-action { margin-top: 0.75em; }\n' +
      '.el-character { margin-left: 2.2in; text-transform: uppercase; font-weight: bold; margin-top: 0.75em; page-break-after: avoid; }\n' +
      '.el-parenthetical { margin-left: 1.6in; font-style: italic; page-break-after: avoid; }\n' +
      '.el-dialogue { margin-left: 1in; margin-right: 1.5in; page-break-after: avoid; }\n' +
      '.el-transition { text-align: right; text-transform: uppercase; font-weight: bold; margin-top: 0.75em; }\n' +
      '.el-shot { text-transform: uppercase; font-weight: bold; margin-top: 0.75em; }\n' +
      '.el-character + .el-parenthetical { page-break-before: avoid; }\n' +
      '.el-character + .el-dialogue { page-break-before: avoid; }\n' +
      '.el-parenthetical + .el-dialogue { page-break-before: avoid; }\n' +
      '</style></head><body>\n' +
      bodyHtml +
      '</body></html>';

    // Usar un iframe oculto para imprimir (evita bloqueo de popups)
    let iframe = document.getElementById('printFrame');
    if (!iframe) {
      iframe = document.createElement('iframe');
      iframe.id = 'printFrame';
      iframe.style.cssText = 'position:fixed;left:-9999px;top:0;width:8in;height:11in;border:none;';
      document.body.appendChild(iframe);
    }

    const doc = iframe.contentWindow.document;
    doc.open();
    doc.write(printHtml);
    doc.close();

    // Dar tiempo a que renderice y luego imprimir
    setTimeout(() => {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    }, 400);
  }

  function exportAllJson() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    downloadBlob(blob, 'guionEditor_backup.json');
  }

  function importAllJson(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (data.projects && Array.isArray(data.projects)) {
          state = data;
          if (!state.currentTab) state.currentTab = 'notas';
          if (state.spellLang === undefined) state.spellLang = 'es';
          // Migrar proyectos importados
          state.projects.forEach(p => {
            if (!p.notas) p.notas = [];
            if (p.escaleta) p.escaleta = p.escaleta.map(migrateSequence);
          });
          saveState();
          renderProjectList();
          renderProjectView();
          alert('Proyectos importados correctamente.');
        } else {
          alert('El archivo no tiene el formato esperado.');
        }
      } catch (err) {
        alert('Error al leer el archivo: ' + err.message);
      }
    };
    reader.readAsText(file);
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ====== Modal ======
  let modalConfirmCb = null;
  function showModal(title, message, onConfirm) {
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalMessage').textContent = message;
    modalConfirmCb = onConfirm;
    document.getElementById('modalOverlay').style.display = 'flex';
  }

  function hideModal() {
    document.getElementById('modalOverlay').style.display = 'none';
    modalConfirmCb = null;
  }

  // ====== Eventos globales ======
  function bindEvents() {
    document.getElementById('newProjectBtn').addEventListener('click', createProject);
    document.getElementById('emptyNewProjectBtn').addEventListener('click', createProject);
    document.getElementById('deleteProjectBtn').addEventListener('click', () => {
      if (state.currentProjectId) deleteProject(state.currentProjectId);
    });
    document.getElementById('projectName').addEventListener('input', (e) => {
      if (state.currentProjectId) renameProject(state.currentProjectId, e.target.value);
    });

    // Pestañas
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    // Blog de notas
    document.getElementById('addNoteBtn').addEventListener('click', addNote);
    document.getElementById('notasEmpty').addEventListener('click', addNote);

    // Escaleta
    document.getElementById('addSequenceBtn').addEventListener('click', addSequence);
    document.getElementById('escaletaEmpty').addEventListener('click', addSequence);

    // Guion
    document.getElementById('addElementBtn').addEventListener('click', () => {
      const sel = document.getElementById('elementTypeSelect');
      addGuionElement(sel.value);
    });
    document.getElementById('insertSceneBtn').addEventListener('click', () => addGuionElement('scene_heading'));
    document.getElementById('exportGuionTxtBtn').addEventListener('click', exportGuionTxt);
    document.getElementById('exportGuionPdfBtn').addEventListener('click', exportGuionPdf);

    // Selector de idioma del corrector ortográfico
    const spellSelect = document.getElementById('spellLangSelect');
    if (spellSelect) {
      spellSelect.value = state.spellLang || 'es';
      spellSelect.addEventListener('change', () => {
        state.spellLang = spellSelect.value;
        saveState();
        renderGuion();
      });
    }

    // Clic en el mensaje de guion vacío inicia una escena
    document.getElementById('guionEmpty').addEventListener('click', () => addGuionElement('scene_heading'));

    // Exportar/Importar
    document.getElementById('exportAllBtn').addEventListener('click', exportAllJson);
    document.getElementById('importBtn').addEventListener('click', () => {
      document.getElementById('importFile').click();
    });
    document.getElementById('importFile').addEventListener('change', (e) => {
      if (e.target.files[0]) importAllJson(e.target.files[0]);
      e.target.value = '';
    });

    // Modal
    document.getElementById('modalCancel').addEventListener('click', hideModal);
    document.getElementById('modalConfirm').addEventListener('click', () => {
      if (modalConfirmCb) modalConfirmCb();
      hideModal();
    });
    document.getElementById('modalOverlay').addEventListener('click', (e) => {
      if (e.target.id === 'modalOverlay') hideModal();
    });

    // Cerrar autocompletado al hacer clic fuera
    document.addEventListener('mousedown', (e) => {
      if (!e.target.closest('.autocomplete') && !e.target.closest('.guion-el')) {
        hideAutocomplete();
      }
    });

    // Atajos de teclado globales
    document.addEventListener('keydown', (e) => {
      // Ctrl+S: guardar (evitar diálogo del navegador; ya se guarda en automático)
      if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        saveState();
      }
      // Esc cierra modal
      if (e.key === 'Escape') {
        hideModal();
        hideAutocomplete();
      }
    });
  }

  // ====== Inicialización ======
  function init() {
    loadState();
    bindEvents();
    renderProjectList();
    renderProjectView();

    // Precargar diccionarios en segundo plano
    setTimeout(() => {
      getTypo(state.spellLang || 'es');
      getTypo('en');
    }, 500);

    // Si no hay proyectos, mostrar estado vacío
    if (state.projects.length === 0) {
      document.getElementById('emptyState').style.display = 'flex';
      document.getElementById('projectView').style.display = 'none';
    }
  }

  init();
})();
