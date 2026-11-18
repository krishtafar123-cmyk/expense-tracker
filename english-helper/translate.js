// English Helper: translation into Telugu (or another language) using the
// free MyMemory API (no key needed). Free limits: about 5,000 characters a
// day per person, and up to 500 bytes per request, so longer text is sent in
// sentence-sized pieces. Results are remembered so nothing is translated twice.
window.Translate = (function () {
  const API_URL = 'https://api.mymemory.translated.net/get';
  const MAX_PIECE = 450; // characters; stays under the 500-byte request limit for English
  const cache = new Map();

  // Split text into pieces of whole sentences, each at most MAX_PIECE long.
  function pieces(text) {
    const sentences = text.match(/[^.!?\n]+[.!?]*[\s]*|\n+/g) || [text];
    const out = [];
    let cur = '';
    const push = () => { if (cur.trim()) out.push(cur); cur = ''; };
    for (const s of sentences) {
      if (s.length > MAX_PIECE) {
        push();
        // A very long sentence: split on spaces instead.
        let part = '';
        for (const word of s.split(/(\s+)/)) {
          if ((part + word).length > MAX_PIECE) { if (part.trim()) out.push(part); part = ''; }
          part += word;
        }
        if (part.trim()) out.push(part);
      } else if ((cur + s).length > MAX_PIECE) {
        push();
        cur = s;
      } else {
        cur += s;
      }
    }
    push();
    return out;
  }

  // The API sometimes returns HTML entities like &#39;; turn them back into characters.
  function decode(s) {
    const t = document.createElement('textarea');
    t.innerHTML = s;
    return t.value;
  }

  function quotaError() {
    const e = new Error('quota');
    e.code = 'quota';
    return e;
  }

  async function translatePiece(piece, to) {
    const key = to + '|' + piece.trim();
    if (cache.has(key)) return cache.get(key);
    const url = API_URL + '?q=' + encodeURIComponent(piece.trim()) + '&langpair=en|' + to;
    const res = await fetch(url);
    if (res.status === 429) throw quotaError();
    if (!res.ok) throw new Error('http ' + res.status);
    const data = await res.json();
    const text = data && data.responseData ? String(data.responseData.translatedText || '') : '';
    if (data.quotaFinished || /MYMEMORY WARNING/i.test(text) || Number(data.responseStatus) === 429) throw quotaError();
    if (Number(data.responseStatus) !== 200 || !text) throw new Error('api ' + data.responseStatus);
    const result = decode(text);
    cache.set(key, result);
    return result;
  }

  // Translate English text, keeping the line breaks between pieces.
  async function translate(text, to) {
    const parts = pieces(text);
    const done = [];
    for (const p of parts) {
      if (!p.trim()) { done.push(p); continue; }
      const t = await translatePiece(p, to);
      // Keep the spacing / newline that followed the piece in the original.
      const trailing = (p.match(/\s*$/) || [''])[0];
      done.push(t + (trailing.includes('\n') ? trailing : trailing ? ' ' : ''));
    }
    return done.join('').trim();
  }

  return {
    toTelugu: (text) => translate(text, 'te'),
    translate,
    _pieces: pieces,
  };
})();
