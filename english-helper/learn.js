// English Helper: Learn page. Draws the lessons in learn-data.js.
(function () {
  const L = window.LEARN;
  const panel = document.getElementById('panel');
  const search = document.getElementById('search');
  const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
  const TAB_NAMES = tabs.map((t) => t.dataset.tab);
  let current = 'tenses';

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  // "Future Simple (will) and “going to”" → "future-simple-will-and-going-to".
  // The Explain feature links to lessons by these ids.
  const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const tryLink = (sentence) =>
    '<a class="btn btn-small try" href="index.html?text=' + encodeURIComponent(sentence) + '">Try “' + esc(sentence) + '” in the checker</a>';

  function lesson(t) {
    const form = Object.entries(t.form).map(([k, v]) => '<b>' + esc(k) + '</b><span>' + esc(v) + '</span>').join('');
    return '<details class="lesson" id="' + slug(t.name) + '"><summary>' + esc(t.name) + ' <span class="sub">' + esc(t.sub) + '</span></summary>' +
      '<div class="lesson-body">' +
      '<p>' + esc(t.use) + '</p>' +
      '<h3>How to make it</h3><div class="formula">' + form + '</div>' +
      '<h3>Examples</h3><ul class="examples">' + t.examples.map((e) => '<li>' + esc(e) + '</li>').join('') + '</ul>' +
      (t.signals ? '<h3>Clue words</h3><p>' + esc(t.signals) + '</p>' : '') +
      '<h3>Common mistake</h3><div class="pair"><span class="x">' + esc(t.mistake[0]) + '</span><span class="v">' + esc(t.mistake[1]) + '</span></div>' +
      '<p><strong>Tip:</strong> ' + esc(t.tip) + '</p>' +
      tryLink(t.mistake[0]) +
      '</div></details>';
  }

  function vocabTopic(v) {
    const rows = v.words.map((w) =>
      '<tr><td>' + esc(w[0]) + '</td><td>' + esc(w[1]) + '</td><td class="ex">' + esc(w[2]) + '</td></tr>').join('');
    return '<details class="lesson"><summary>' + esc(v.topic) + ' <span class="sub">' + v.words.length + ' words &amp; phrases</span></summary>' +
      '<div class="lesson-body"><table class="word-table"><thead><tr><th>Word / phrase</th><th>Meaning</th><th>Example</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div></details>';
  }

  function mistakeCard(m) {
    return '<div class="card"><div class="pair"><span class="x">' + esc(m[0]) + '</span><span class="v">' + esc(m[1]) + '</span></div>' +
      '<p class="note">' + esc(m[2]) + '</p></div>';
  }

  const matches = (q, ...parts) => !q || parts.join(' ').toLowerCase().includes(q);

  function render() {
    const q = search.value.trim().toLowerCase();
    let html = '';
    let count = 0;
    if (current === 'tenses' || current === 'questions') {
      const list = L[current].filter((t) => matches(q, t.name, t.sub, t.use, t.examples.join(' '), t.mistake.join(' '), t.tip, t.signals || ''));
      count = list.length;
      html = list.map(lesson).join('');
    } else if (current === 'vocabulary') {
      const list = L.vocabulary
        .map((v) => ({ topic: v.topic, words: matches(q, v.topic) ? v.words : v.words.filter((w) => matches(q, w.join(' '))) }))
        .filter((v) => v.words.length);
      count = list.length;
      html = list.map(vocabTopic).join('');
    } else {
      const list = L.mistakes.filter((m) => matches(q, m.join(' ')));
      count = list.length;
      html = '<div class="mistake-grid">' + list.map(mistakeCard).join('') + '</div>';
    }
    panel.innerHTML = count ? html : '<p class="empty-state">Nothing matches “' + esc(search.value) + '”.</p>';
    // While searching, open the matching lessons so the result is visible.
    if (q) panel.querySelectorAll('details').forEach((d) => { d.open = true; });
  }

  function select(name, focus) {
    current = TAB_NAMES.includes(name) ? name : 'tenses';
    tabs.forEach((t) => {
      const on = t.dataset.tab === current;
      t.setAttribute('aria-selected', on);
      t.tabIndex = on ? 0 : -1;
      if (on && focus) t.focus();
    });
    search.value = '';
    history.replaceState(null, '', '#' + current);
    render();
  }

  tabs.forEach((t, i) => {
    t.addEventListener('click', () => select(t.dataset.tab));
    t.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (d) select(tabs[(i + d + tabs.length) % tabs.length].dataset.tab, true);
    });
  });
  search.addEventListener('input', render);

  // A link like learn.html#tenses:past-simple opens that tab and lesson.
  const [tab, lessonId] = decodeURIComponent(location.hash.slice(1)).split(':');
  select(tab);
  const target = lessonId && document.getElementById(lessonId);
  if (target && target.tagName === 'DETAILS') {
    target.open = true;
    history.replaceState(null, '', '#' + tab + ':' + lessonId);
    requestAnimationFrame(() => target.scrollIntoView({ block: 'start' }));
  }
})();
