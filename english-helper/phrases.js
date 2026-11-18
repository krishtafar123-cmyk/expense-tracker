// English Helper: Phrases page. Draws phrases-data.js with Listen, Copy,
// Telugu and "Edit & check" buttons for every sentence.
(function () {
  const topicsEl = document.getElementById('topics');
  const search = document.getElementById('search');
  const P = window.PHRASES;

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  // Show [placeholders] highlighted so they're easy to spot and replace.
  const withPlaceholders = (s) => esc(s).replace(/\[([^\]]+)\]/g, '<span class="ph">[$1]</span>');

  function load(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  const voiceLang = () => load('eh-variant') || 'en-US';

  function phraseHtml(t, i, item) {
    const [en, note] = item;
    return '<li class="phrase" data-t="' + t + '" data-i="' + i + '">' +
      '<p class="phrase-en">' + withPlaceholders(en) + '</p>' +
      (note ? '<p class="phrase-note">' + esc(note) + '</p>' : '') +
      '<div class="phrase-actions">' +
        ('speechSynthesis' in window ? '<button type="button" class="btn-small" data-act="listen" aria-label="Listen">🔊 Listen</button>' : '') +
        '<button type="button" class="btn-small" data-act="copy">Copy</button>' +
        '<button type="button" class="btn-small" data-act="telugu" aria-expanded="false">అ Telugu</button>' +
        '<a class="btn btn-small" href="index.html?text=' + encodeURIComponent(en) + '">✎ Edit &amp; check</a>' +
      '</div>' +
      '<p class="phrase-te" lang="te" hidden></p>' +
      '</li>';
  }

  function render() {
    const q = search.value.trim().toLowerCase();
    const html = P.map((topic, t) => {
      const items = topic.items
        .map((item, i) => ({ item, i }))
        .filter(({ item }) => !q || topic.topic.toLowerCase().includes(q) || item.join(' ').toLowerCase().includes(q));
      if (!items.length) return '';
      return '<details class="lesson"' + (q || t === 0 ? ' open' : '') + '>' +
        '<summary>' + topic.icon + ' ' + esc(topic.topic) + ' <span class="sub">' + items.length + ' phrases</span></summary>' +
        '<div class="lesson-body"><ul class="phrase-list">' + items.map(({ item, i }) => phraseHtml(t, i, item)).join('') + '</ul></div>' +
        '</details>';
    }).join('');
    topicsEl.innerHTML = html || '<p class="empty-state">No phrases match “' + esc(search.value) + '”. Try a shorter word.</p>';
  }

  topicsEl.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const li = btn.closest('.phrase');
    const en = P[+li.dataset.t].items[+li.dataset.i][0];
    const act = btn.dataset.act;

    if (act === 'listen') {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(en.replace(/[[\]]/g, ''));
      u.lang = voiceLang();
      u.rate = 0.9;
      speechSynthesis.speak(u);
    } else if (act === 'copy') {
      try {
        await navigator.clipboard.writeText(en);
        btn.textContent = 'Copied ✓';
      } catch (err) {
        btn.textContent = 'Copy failed';
      }
      setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
    } else if (act === 'telugu') {
      const out = li.querySelector('.phrase-te');
      if (!out.hidden) { out.hidden = true; btn.setAttribute('aria-expanded', 'false'); return; }
      out.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      if (out.dataset.done) return;
      out.textContent = 'Translating…';
      try {
        out.textContent = await window.Translate.toTelugu(en);
        out.dataset.done = '1';
      } catch (err) {
        out.textContent = err.code === 'quota'
          ? 'Today’s free translation limit has been used up. It resets tomorrow.'
          : 'Couldn’t translate right now. Check your internet and try again.';
      }
    }
  });

  search.addEventListener('input', render);
  render();
})();
