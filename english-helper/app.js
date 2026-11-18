// English Helper: checker page.
// Uses the free public LanguageTool API (no key needed). Limits on the free
// service: about 20 requests per minute per person and 20 KB per request.
(function () {
  const API_URL = 'https://api.languagetool.org/v2/check';
  const MAX_CHARS = 5000;

  const $ = (id) => document.getElementById(id);
  const input = $('input');
  const variant = $('variant');
  const counter = $('counter');
  const checkBtn = $('check');
  const statusEl = $('status');
  const correctedCard = $('corrected-card');
  const originalCard = $('original-card');
  const mistakesCard = $('mistakes-card');
  const correctedEl = $('corrected');
  const originalEl = $('original');
  const mistakesEl = $('mistakes');

  // Current result: the text that was checked, the mistakes found, and which
  // suggestion is chosen for each (-1 = keep the original wording).
  let state = null;

  const TYPE_LABELS = {
    misspelling: 'Spelling',
    grammar: 'Grammar',
    typographical: 'Punctuation',
    whitespace: 'Spacing',
    style: 'Style',
    uncategorized: 'Grammar',
    duplication: 'Repeated word',
    inconsistency: 'Consistency',
    register: 'Formality',
    'locale-violation': 'Spelling (region)',
    terminology: 'Word choice',
    mistranslation: 'Word choice',
    omission: 'Missing word',
    addition: 'Extra word',
  };

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function save(key, value) { try { localStorage.setItem(key, value); } catch (e) { /* storage unavailable */ } }
  function load(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }

  function showStatus(kind, html) {
    statusEl.className = 'status ' + kind;
    statusEl.innerHTML = html;
    statusEl.hidden = false;
  }
  function hideResults() {
    statusEl.hidden = true;
    correctedCard.hidden = originalCard.hidden = mistakesCard.hidden = true;
    hideExplain();
    hideTelugu();
  }

  // ----- Telugu translation of the input and the corrected version -----
  const teluguBtn = $('telugu-btn');
  const teluguBox = $('telugu');
  let teluguOn = load('eh-telugu') === '1'; // remembered, so it stays on for later checks
  let teluguRun = 0; // ignore answers from an older request

  function setTeluguBtn() {
    teluguBtn.textContent = teluguOn ? 'Hide Telugu' : 'అ Show in Telugu';
    teluguBtn.setAttribute('aria-pressed', String(teluguOn));
  }

  function hideTelugu() {
    teluguRun++;
    teluguBox.hidden = true;
    teluguBox.innerHTML = '';
  }

  const teluguItem = (label, sub, text) =>
    '<div class="tl-item"><p class="tl-label">' + escapeHtml(label) + ' <span lang="te">' + escapeHtml(sub) + '</span></p>' +
    '<p class="tl-text" lang="te">' + escapeHtml(text) + '</p></div>';

  async function showTelugu() {
    if (!state) return;
    const run = ++teluguRun;
    const original = state.text;
    const corrected = currentGoodText();
    const same = original.trim() === corrected.trim();
    teluguBox.hidden = false;
    teluguBox.innerHTML = '<p class="note"><span class="spinner" aria-hidden="true"></span> Translating into Telugu…</p>';
    try {
      const [mine, fixed] = await Promise.all([
        window.Translate.toTelugu(original),
        same ? Promise.resolve(null) : window.Translate.toTelugu(corrected),
      ]);
      if (run !== teluguRun) return;
      teluguBox.innerHTML =
        (same
          ? teluguItem('Your sentence in Telugu', '(మీ వాక్యం)', mine)
          : teluguItem('What you wrote, in Telugu', '(మీరు రాసింది)', mine) +
            teluguItem('Corrected version, in Telugu', '(సరిచేసిన వాక్యం)', fixed)) +
        '<p class="note">Machine translation, so it shows the meaning but may not be word-perfect.' +
        (same ? '' : ' If the two mean different things, the correction changed your meaning, so check it’s what you wanted to say.') + '</p>';
    } catch (err) {
      if (run !== teluguRun) return;
      const msg = err.code === 'quota'
        ? 'Today’s free translation limit has been used up. It resets tomorrow, and checking still works as normal.'
        : !navigator.onLine
          ? 'You seem to be offline. Connect to the internet to see the Telugu translation.'
          : 'Couldn’t translate right now. Please try again in a moment.';
      teluguBox.innerHTML = '<p class="status err">' + escapeHtml(msg) + '</p>';
    }
  }

  teluguBtn.addEventListener('click', () => {
    teluguOn = !teluguOn;
    save('eh-telugu', teluguOn ? '1' : '0');
    setTeluguBtn();
    if (teluguOn) showTelugu(); else hideTelugu();
  });
  setTeluguBtn();

  // ----- "Explain it": how the (correct or corrected) sentence works -----
  const explainBtn = $('explain-btn');
  const explainCard = $('explain-card');
  const explainOut = $('explain-out');

  function hideExplain() {
    explainCard.hidden = true;
    explainOut.innerHTML = '';
    explainBtn.setAttribute('aria-expanded', 'false');
    explainBtn.textContent = '💡 Explain it';
  }

  function currentGoodText() {
    if (!state) return correctedEl.textContent;
    return state.matches.length ? correctedPlain() : state.text;
  }

  async function explainNow() {
    if (!explainCard.hidden) { hideExplain(); return; }
    const text = currentGoodText();
    if (!text.trim()) return;
    explainBtn.disabled = true;
    explainBtn.innerHTML = '<span class="spinner" aria-hidden="true"></span> Explaining…';
    try {
      explainOut.innerHTML = await window.EnglishExplain.explainHtml(text);
      $('explain-title').textContent = state && state.matches.length
        ? 'How the corrected sentence works'
        : 'Why your sentence is correct';
      explainCard.hidden = false;
      explainBtn.setAttribute('aria-expanded', 'true');
      explainBtn.textContent = 'Hide explanation';
      explainCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      explainBtn.textContent = '💡 Explain it';
      showStatus('err', 'Couldn’t load the explanation. Check your internet connection and try again.');
    } finally {
      explainBtn.disabled = false;
    }
  }
  explainBtn.addEventListener('click', explainNow);

  function updateCounter() {
    const n = input.value.length;
    counter.textContent = n + ' / ' + MAX_CHARS;
    counter.classList.toggle('over', n > MAX_CHARS);
  }

  // Keep only mistakes that don't overlap an earlier one, so corrections can
  // be applied in a single left-to-right pass.
  function nonOverlapping(matches) {
    const sorted = matches.slice().sort((a, b) => a.offset - b.offset);
    const kept = [];
    let end = -1;
    for (const m of sorted) {
      if (m.offset >= end) { kept.push(m); end = m.offset + m.length; }
    }
    return kept;
  }

  // Walk the text once, calling piece(plain) for unchanged text and
  // fix(match, index) for each mistake.
  function walk(text, matches, plain, fix) {
    let pos = 0;
    const out = [];
    matches.forEach((m, i) => {
      out.push(plain(text.slice(pos, m.offset)));
      out.push(fix(m, i));
      pos = m.offset + m.length;
    });
    out.push(plain(text.slice(pos)));
    return out.join('');
  }

  function chosenText(i) {
    const m = state.matches[i];
    const c = state.choice[i];
    return c >= 0 ? m.replacements[c].value : state.text.substr(m.offset, m.length);
  }

  function correctedPlain() {
    return walk(state.text, state.matches, (s) => s, (m, i) => chosenText(i));
  }

  function render() {
    const { text, matches } = state;

    correctedEl.innerHTML = walk(text, matches, escapeHtml, (m, i) =>
      state.choice[i] >= 0 ? '<ins>' + escapeHtml(chosenText(i)) + '</ins>' : escapeHtml(chosenText(i))
    );

    originalEl.innerHTML = walk(text, matches, escapeHtml, (m, i) => {
      const wrong = text.substr(m.offset, m.length);
      return '<mark data-i="' + i + '"' + (wrong.trim() ? '' : ' class="empty"') +
        ' title="' + escapeHtml(m.message) + '">' + escapeHtml(wrong) + '</mark>';
    });

    mistakesEl.innerHTML = matches.map((m, i) => {
      const wrong = text.substr(m.offset, m.length);
      const c = state.choice[i];
      const type = TYPE_LABELS[m.rule && m.rule.issueType] || (m.rule && m.rule.category && m.rule.category.name) || 'Tip';
      const fixed = c >= 0 ? m.replacements[c].value : null;
      const change = fixed !== null
        ? '<span class="from">' + escapeHtml(wrong.trim() ? wrong : '(space)') + '</span> → <span class="to">' +
          escapeHtml(fixed === '' ? '(remove)' : fixed) + '</span>'
        : '<span>' + escapeHtml(wrong) + '</span>';
      const alts = m.replacements.slice(0, 5).map((r, j) =>
        '<button type="button" class="btn-small alt" data-i="' + i + '" data-j="' + j + '" aria-pressed="' + (c === j) + '">' +
        escapeHtml(r.value === '' ? '(remove)' : r.value) + '</button>'
      ).join('');
      const keep = m.replacements.length
        ? '<button type="button" class="btn-small btn-ghost alt" data-i="' + i + '" data-j="-1" aria-pressed="' + (c === -1) + '">Keep mine</button>'
        : '';
      return '<li class="mistake' + (c === -1 && m.replacements.length ? ' ignored' : '') + '" id="m' + i + '">' +
        '<span class="tag">' + escapeHtml(type) + '</span>' +
        '<div class="change">' + change + '</div>' +
        '<p class="why">' + escapeHtml(m.message) + '</p>' +
        (alts || keep ? '<div class="alts">' + alts + keep + '</div>' : '') +
        '</li>';
    }).join('');

    $('mistakes-title').textContent = matches.length === 1
      ? '1 thing to fix, and why'
      : matches.length + ' things to fix, and why';
  }

  async function check() {
    const text = input.value;
    if (!text.trim()) { input.focus(); return; }
    if (text.length > MAX_CHARS) {
      showStatus('err', 'That’s a bit long. Please check up to ' + MAX_CHARS + ' characters at a time.');
      return;
    }

    checkBtn.disabled = true;
    checkBtn.innerHTML = '<span class="spinner" aria-hidden="true"></span> Checking…';
    hideResults();

    try {
      const body = new URLSearchParams({ text, language: variant.value });
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body,
      });
      if (res.status === 429) throw new Error('rate');
      if (!res.ok) throw new Error('http ' + res.status);
      const data = await res.json();

      const matches = nonOverlapping(data.matches || []);
      state = {
        text,
        matches,
        choice: matches.map((m) => (m.replacements && m.replacements.length ? 0 : -1)),
      };

      if (!matches.length) {
        showStatus('ok', '✓ Looks good! No mistakes found. Tap “Explain it” to see why it’s correct.');
        correctedCard.hidden = false;
        correctedEl.textContent = text;
        if (teluguOn) showTelugu();
        return;
      }
      render();
      correctedCard.hidden = originalCard.hidden = mistakesCard.hidden = false;
      if (teluguOn) showTelugu();
      correctedCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      if (err.message === 'rate') {
        showStatus('err', 'Too many checks in a short time. The free service allows about 20 a minute, so please wait a moment and try again.');
      } else if (!navigator.onLine) {
        showStatus('err', 'You seem to be offline. Connect to the internet and try again.');
      } else {
        showStatus('err', 'Couldn’t check right now. Please try again in a moment.');
      }
    } finally {
      checkBtn.disabled = false;
      checkBtn.textContent = 'Check my English';
    }
  }

  // Choosing a different suggestion, or keeping the original.
  mistakesEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.alt');
    if (!btn || !state) return;
    state.choice[+btn.dataset.i] = +btn.dataset.j;
    render();
    hideExplain();
    if (teluguOn) showTelugu();
  });

  // Tapping a marked mistake jumps to its explanation.
  originalEl.addEventListener('click', (e) => {
    const mark = e.target.closest('mark');
    if (!mark) return;
    const card = $('m' + mark.dataset.i);
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.classList.remove('flash'); void card.offsetWidth; card.classList.add('flash');
  });

  $('copy').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const text = state && state.matches.length ? correctedPlain() : correctedEl.textContent;
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = 'Copied ✓';
    } catch (err) {
      btn.textContent = 'Copy failed';
    }
    setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
  });

  $('use').addEventListener('click', () => {
    input.value = state && state.matches.length ? correctedPlain() : correctedEl.textContent;
    updateCounter();
    save('eh-draft', input.value);
    hideResults();
    input.focus();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // Read the corrected version aloud (free, built into the browser).
  const listenBtn = $('listen');
  if ('speechSynthesis' in window) {
    listenBtn.addEventListener('click', () => {
      speechSynthesis.cancel();
      const text = state && state.matches.length ? correctedPlain() : correctedEl.textContent;
      const u = new SpeechSynthesisUtterance(text);
      u.lang = variant.value;
      u.rate = 0.95;
      speechSynthesis.speak(u);
    });
  } else {
    listenBtn.hidden = true;
  }

  // Speak instead of typing (free, built into Chrome, Edge, Safari and Android).
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const micBtn = $('mic');
  const micStatus = $('mic-status');
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isInstalledApp = window.navigator.standalone === true ||
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  const KEYBOARD_TIP = 'You can also tap the 🎤 on your phone’s keyboard and speak into the box.';

  function micMessage(kind, text) {
    if (!text) { micStatus.hidden = true; micStatus.textContent = ''; return; }
    micStatus.className = 'mic-status ' + kind;
    micStatus.textContent = text;
    micStatus.hidden = false;
  }

  if (SR) {
    micBtn.hidden = false;
    let rec = null;
    let session = 0;    // each tap of Speak is a new session; old events are ignored
    let base = '';      // what was in the box before speaking
    let spokenText = ''; // everything recognised so far in this session
    let errored = false;
    let gotAudio = false;
    let silenceTimer = null;
    let stopWatchdog = null;

    // iPhone Safari often sends nothing in "stop after a pause" mode, so on
    // iPhone we listen continuously and stop ourselves after a short silence.
    // Android stays in pause mode, because continuous mode repeats words there.
    const CONTINUOUS = isIOS;
    const PAUSE_MS = 2000;        // stop this long after the last word (iPhone)
    const NOTHING_MS = 9000;      // stop if nothing at all is heard
    const SAFETY_MS = 15000;      // longest wait for a single piece of speech

    const showSpeech = () => {
      let spoken = spokenText.trim();
      // Speech comes back in lower case; start a new sentence with a capital.
      if (spoken && (!base.trim() || /[.!?]\s*$/.test(base))) spoken = spoken[0].toUpperCase() + spoken.slice(1);
      const sep = base && spoken && !/\s$/.test(base) ? ' ' : '';
      input.value = base + sep + spoken;
      updateCounter();
    };

    // Join the recognised pieces. Some phones resend everything said so far
    // in every piece, so a piece that already contains the text replaces it.
    const joinResults = (results) => {
      let text = '';
      for (let i = 0; i < results.length; i++) {
        const t = String(results[i][0] && results[i][0].transcript || '').trim();
        if (!t) continue;
        if (!text || t.toLowerCase().startsWith(text.toLowerCase())) text = t;
        else if (!text.toLowerCase().endsWith(t.toLowerCase())) text += ' ' + t;
      }
      return text;
    };

    const setIdle = () => {
      micBtn.classList.remove('listening');
      micBtn.setAttribute('aria-pressed', 'false');
      micBtn.querySelector('span').textContent = 'Speak';
    };

    const finish = (id) => {
      if (id !== session || !rec) return; // already finished
      clearTimeout(silenceTimer);
      clearTimeout(stopWatchdog);
      rec = null;
      setIdle();
      showSpeech();
      save('eh-draft', input.value);
      if (errored) return;
      if (spokenText.trim()) { micMessage('', ''); return; }
      if (!gotAudio) {
        micMessage('err', isIOS
          ? 'No sound reached the microphone. Check Settings → Safari → Microphone is set to Ask or Allow, that you tapped Allow, and that no call or other app is using the microphone. ' + KEYBOARD_TIP
          : 'No sound reached the microphone. Check the microphone is allowed for this site and not used by another app. ' + KEYBOARD_TIP);
      } else {
        micMessage('err', 'The microphone heard you, but no words came back. Try again, speaking a little slower and closer to the phone. ' + KEYBOARD_TIP);
      }
    };

    // Ask the recogniser to stop, and finish anyway if it never says it ended
    // (this happens on iPhone).
    const stopListening = (id) => {
      if (id !== session || !rec) return;
      try { rec.stop(); } catch (e) { /* already stopped */ }
      clearTimeout(stopWatchdog);
      stopWatchdog = setTimeout(() => {
        if (id !== session || !rec) return;
        try { rec.abort(); } catch (e) { /* ignore */ }
        finish(id);
      }, 1500);
    };

    const armSilence = (ms, id) => {
      clearTimeout(silenceTimer);
      silenceTimer = setTimeout(() => stopListening(id), ms);
    };

    const ERRORS = {
      'no-speech': 'I didn’t hear anything. Tap Speak and start talking straight away.',
      'audio-capture': 'No microphone was found, or another app is using it. Close other apps using the microphone and try again.',
      'network': 'Voice input needs an internet connection. Check you’re online and try again.',
      'language-not-supported': 'Voice input doesn’t support this English type on your phone. Try “American English” in the list and speak again.',
      'aborted': '',
    };

    micBtn.addEventListener('click', () => {
      if (rec) { stopListening(session); return; }
      // Only silence our own Listen voice if it is actually talking: on iPhone,
      // touching the speech voice can stop the microphone from getting sound.
      if ('speechSynthesis' in window && (speechSynthesis.speaking || speechSynthesis.pending)) speechSynthesis.cancel();
      const id = ++session;
      base = input.value;
      spokenText = '';
      errored = false;
      gotAudio = false;
      try {
        rec = new SR();
        rec.lang = variant.value;
        rec.interimResults = true;   // show words as they are spoken
        rec.continuous = CONTINUOUS;
        rec.maxAlternatives = 1;
        rec.onaudiostart = () => { if (id === session) gotAudio = true; };
        rec.onsoundstart = rec.onspeechstart = rec.onaudiostart;
        rec.onresult = (ev) => {
          if (id !== session) return;
          gotAudio = true;
          const text = joinResults(ev.results);
          if (text) spokenText = text;
          showSpeech();
          // Keep listening while words keep coming; stop after a pause.
          armSilence(CONTINUOUS ? PAUSE_MS : SAFETY_MS, id);
        };
        rec.onerror = (ev) => {
          if (id !== session) return;
          let msg = ERRORS[ev.error];
          if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
            if (isIOS && isInstalledApp) {
              msg = 'On iPhone, voice input doesn’t work inside the installed app. Open the site in Safari to use Speak. ' + KEYBOARD_TIP;
            } else if (isIOS) {
              msg = 'Voice input is turned off. On iPhone, turn on Settings → General → Keyboard → Enable Dictation, and allow the microphone for Safari. ' + KEYBOARD_TIP;
            } else {
              msg = 'Microphone access is blocked. Tap the lock icon next to the web address, allow the microphone, then try again. ' + KEYBOARD_TIP;
            }
          }
          if (msg === undefined) msg = 'Voice input stopped unexpectedly (' + ev.error + '). Please try again. ' + KEYBOARD_TIP;
          // "No speech" after some words were already heard isn't a problem.
          if (ev.error === 'no-speech' && spokenText.trim()) msg = '';
          if (msg) { errored = true; micMessage('err', msg); }
        };
        rec.onend = () => finish(id);
        rec.start();
        armSilence(NOTHING_MS, id);
        micBtn.classList.add('listening');
        micBtn.setAttribute('aria-pressed', 'true');
        micBtn.querySelector('span').textContent = 'Listening… tap to stop';
        micMessage('info', '🎙️ Listening… speak now. It stops by itself when you pause.');
      } catch (err) {
        rec = null;
        setIdle();
        micMessage('err', 'Couldn’t start voice input. Please try again. ' + KEYBOARD_TIP);
      }
    });
  } else {
    // No voice input in this browser (for example Firefox): explain instead of hiding silently.
    micBtn.hidden = false;
    micBtn.addEventListener('click', () => {
      micMessage('err', 'This browser doesn’t support voice input. Use Chrome on Android or Safari on iPhone. ' + KEYBOARD_TIP);
    });
  }

  $('clear').addEventListener('click', () => {
    input.value = '';
    updateCounter();
    save('eh-draft', '');
    hideResults();
    state = null;
    input.focus();
  });

  checkBtn.addEventListener('click', check);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); check(); }
  });
  input.addEventListener('input', () => { updateCounter(); save('eh-draft', input.value); });
  variant.addEventListener('change', () => save('eh-variant', variant.value));

  // Start-up: a sentence sent from the Learn page wins over the saved draft.
  const savedVariant = load('eh-variant');
  if (savedVariant && variant.querySelector('option[value="' + savedVariant + '"]')) variant.value = savedVariant;
  const fromLink = new URLSearchParams(location.search).get('text');
  if (fromLink) {
    input.value = fromLink;
    history.replaceState(null, '', location.pathname);
    updateCounter();
    check();
  } else {
    input.value = load('eh-draft') || '';
    updateCounter();
  }
})();
