// English Helper: "Explain it". Breaks a correct sentence down: what kind of
// sentence it is, its tense, the job of each word, and the rules that make it
// right. Runs entirely in the browser using the free compromise library
// (vendor/compromise.min.js, MIT licence), loaded only when first needed.
(function (root) {
  const LESSON = (slug) => 'learn.html#tenses:' + slug;

  // compromise verb form → [tense name, lesson slug or null, what it's for]
  const FORMS = {
    'simple-present': ['Present Simple', 'present-simple', 'a habit, a fact or something that is generally true'],
    'auxiliary-present': ['Present Simple', 'present-simple', 'a habit, a fact or something that is generally true'],
    'present-progressive': ['Present Continuous', 'present-continuous', 'something happening now or around now'],
    'present-perfect': ['Present Perfect', 'present-perfect', 'a past action that is connected to now'],
    'present-perfect-progressive': ['Present Perfect Continuous', 'present-perfect-continuous', 'an activity that started in the past and is still going on'],
    'simple-past': ['Past Simple', 'past-simple', 'a finished action in the past'],
    'auxiliary-past': ['Past Simple', 'past-simple', 'a finished action in the past'],
    'past-progressive': ['Past Continuous', 'past-continuous', 'an action that was in progress at a moment in the past'],
    'past-perfect': ['Past Perfect', 'past-perfect', 'something that happened before another past action'],
    'past-perfect-progressive': ['Past Perfect Continuous', 'past-perfect-continuous', 'an activity that had been going on before something else in the past'],
    'simple-future': ['Future Simple (will)', 'future-simple-will-and-going-to', 'a decision, promise or prediction about the future'],
    'auxiliary-future': ['Future with “going to”', 'future-simple-will-and-going-to', 'a plan you have already decided on'],
    'future-progressive': ['Future Continuous', 'future-continuous', 'an action that will be in progress at a future moment'],
    'future-perfect': ['Future Perfect', 'future-perfect', 'something that will be finished before a future time'],
    'future-perfect-progressive': ['Future Perfect Continuous', 'future-perfect-continuous', 'how long something will have been going on at a future point'],
    'passive-present': ['Present Simple (passive)', 'present-simple', 'the action is done to the subject, not by it'],
    'passive-past': ['Past Simple (passive)', 'past-simple', 'the action was done to the subject, not by it'],
    'passive-future': ['Future (passive)', 'future-simple-will-and-going-to', 'the action will be done to the subject'],
    'modal-infinitive': ['Modal verb + base verb', null, 'ability, permission, advice, a request or possibility'],
    'modal-past': ['Modal + have + past participle', null, 'something possible or expected in the past'],
    'modal-perfect-progressive': ['Modal + have been + -ing', null, 'a possible ongoing action in the past'],
    'present-conditional': ['Conditional (would)', null, 'an imagined situation or a polite request'],
    'past-conditional': ['Past conditional (would have)', null, 'an imagined past that did not happen'],
    'imperative': ['Command or request', null, 'telling or asking someone to do something'],
    'want-infinitive': ['Verb + to + verb', null, 'wanting, needing or planning to do something'],
    'gerund-phrase': ['Verb + -ing', null, 'an activity used as part of the sentence'],
  };

  const MODALS = ['can', 'could', 'will', 'would', 'shall', 'should', 'may', 'might', 'must'];
  const DO_FORMS = { do: 'present', does: 'present', did: 'past', "don't": 'present', "doesn't": 'present', "didn't": 'past' };
  const THIRD_PERSON = ['he', 'she', 'it'];
  const WH = ['what', 'where', 'when', 'why', 'who', 'whom', 'whose', 'which', 'how'];
  const CLUES = {
    past: ['yesterday', 'ago', 'last'],
    perfectSince: ['since', 'for'],
    habit: ['always', 'usually', 'often', 'sometimes', 'never', 'every'],
    now: ['now', 'currently', 'moment'],
    future: ['tomorrow', 'next', 'soon', 'later'],
    by: ['by'],
  };

  const ROLE_INFO = {
    question: ['Question word', 'r-question'],
    helper: ['Helping verb', 'r-helper'],
    verb: ['Main verb', 'r-verb'],
    be: ['Verb “be”', 'r-verb'],
    negative: ['Negative', 'r-negative'],
    subject: ['Subject (who/what)', 'r-subject'],
    object: ['Noun', 'r-noun'],
    pronoun: ['Pronoun', 'r-noun'],
    possessive: ['Possessive', 'r-other'],
    adjective: ['Describing word', 'r-adjective'],
    adverb: ['Adverb', 'r-adverb'],
    time: ['Time', 'r-adverb'],
    preposition: ['Preposition', 'r-other'],
    linking: ['Linking word', 'r-other'],
    article: ['Article', 'r-other'],
    number: ['Number', 'r-other'],
    polite: ['Polite word', 'r-other'],
    to: ['“to”', 'r-other'],
    other: ['', 'r-other'],
  };

  // ---------- analysis (no HTML here, so it can be tested in Node) ----------

  const low = (s) => String(s || '').toLowerCase().replace(/[^a-z']/g, '');
  const has = (t, tag) => t.tags.includes(tag);

  function roleOf(t, i, terms, isQuestion) {
    const w = t.norm;
    if (w === "n't" || w === 'not' || w === 'never' || has(t, 'Negative')) return 'negative';
    if (WH.includes(w) && (i === 0 || has(t, 'QuestionWord'))) return 'question';
    if (has(t, 'Verb')) {
      if (has(t, 'Modal') || has(t, 'Auxiliary')) return 'helper';
      if (isQuestion && i === 0 && DO_FORMS[w]) return 'helper';
      if (has(t, 'Copula')) return 'be';
      return 'verb';
    }
    if (w === 'to') return 'to';
    if (['here', 'there', 'today', 'tonight', 'now'].includes(w)) return w === 'here' || w === 'there' ? 'adverb' : 'time';
    if (has(t, 'Possessive')) return 'possessive';
    if (has(t, 'Pronoun')) return 'pronoun';
    if (has(t, 'Date') || has(t, 'Duration')) return 'time';
    if (has(t, 'Value')) return 'number';
    if (has(t, 'Noun')) return 'object';
    if (has(t, 'Adjective') || has(t, 'Comparable')) return 'adjective';
    if (has(t, 'Adverb')) return 'adverb';
    if (has(t, 'Preposition')) return 'preposition';
    if (has(t, 'Conjunction')) return 'linking';
    if (has(t, 'Determiner')) return 'article';
    if (has(t, 'Expression')) return w === 'please' ? 'polite' : 'other';
    return 'other';
  }

  // Words that can be part of a noun group like "the old car" or "my brother".
  const inNounGroup = (r) => ['pronoun', 'object', 'possessive', 'article', 'adjective', 'number'].includes(r);

  // Mark the noun group just before `vi` (statements) or just after `vi`
  // (questions with the helping verb first) as the subject.
  function markSubject(roles, from, dir) {
    let i = from + dir;
    let marked = null;
    while (i >= 0 && i < roles.length && inNounGroup(roles[i])) {
      if (roles[i] === 'pronoun' || roles[i] === 'object') { roles[i] = 'subject'; marked = marked === null ? i : marked; }
      i += dir;
    }
    return marked;
  }

  function analyseSentence(nlp, text) {
    const doc = nlp(text);
    const json = doc.json({ offset: true })[0];
    if (!json) return null;
    const terms = json.terms.map((t) => ({ text: t.text, norm: low(t.text), tags: t.tags, pre: t.pre, post: t.post }));
    // "didn't" comes through as a word plus an empty negative part; join them.
    for (let i = terms.length - 1; i > 0; i--) {
      if (!terms[i].text && has(terms[i], 'Negative')) {
        terms[i - 1].tags = terms[i - 1].tags.concat('Negative-Holder');
        terms[i - 1].negHolder = true;
        terms.splice(i, 1);
      }
    }
    const trimmed = text.trim();
    const isQuestion = /\?\s*$/.test(trimmed) || doc.questions().found;
    const roles = terms.map((t, i) => roleOf(t, i, terms, isQuestion));
    terms.forEach((t, i) => { if (t.negHolder) roles[i] = 'helper'; });

    // Verb groups, with "Does … like", "Can … tell", "Have … eaten" joined
    // back together when a question splits them.
    const raw = doc.verbs().json({ offset: true }).map((v) => ({
      text: v.text.replace(/[?.!,]+$/, ''),
      index: v.offset ? v.offset.index : -1,
      length: v.terms.length,
      form: v.verb && v.verb.grammar ? v.verb.grammar.form : '',
      infinitive: v.verb ? v.verb.infinitive : '',
      auxiliary: v.verb ? (v.verb.auxiliary || '') : '',
      negative: v.verb ? !!v.verb.negative : false,
    }));
    const groups = [];
    for (let k = 0; k < raw.length; k++) {
      const v = raw[k];
      const first = low(v.text.split(/\s+/)[0]);
      const next = raw[k + 1];
      const lone = v.text.trim().split(/\s+/).length === 1;
      if (isQuestion && lone && next && next.index > v.index) {
        const subj = terms.slice(v.index + 1, next.index).map((t) => t.text).join(' ');
        if (DO_FORMS[first] !== undefined) {
          groups.push({ text: v.text + ' … ' + next.text, form: DO_FORMS[first] === 'past' ? 'auxiliary-past' : 'auxiliary-present',
            helper: v.text, main: next.text, infinitive: next.infinitive, start: v.index, negative: v.negative || next.negative, split: true });
          k++; continue;
        }
        if (MODALS.includes(first) || ['am', 'is', 'are', 'was', 'were', 'have', 'has', 'had'].includes(first)) {
          const re = nlp(((subj || 'they') + ' ' + v.text + ' ' + next.text).toLowerCase()).verbs().json()[0];
          const form = re && re.verb && re.verb.grammar ? re.verb.grammar.form : next.form;
          groups.push({ text: v.text + ' … ' + next.text, form, helper: v.text, main: next.text,
            infinitive: next.infinitive, start: v.index, negative: v.negative || next.negative, split: true });
          k++; continue;
        }
      }
      // "Did you …" questions can also come through as one "infinitive" verb.
      let form = v.form;
      if (DO_FORMS[first] !== undefined && v.text.trim().split(/\s+/).length > 1) {
        form = DO_FORMS[first] === 'past' ? 'auxiliary-past' : 'auxiliary-present';
      }
      if (form === 'infinitive' && MODALS.includes(first)) form = 'modal-infinitive';
      if (form === 'infinitive' && v.index === 0 && !isQuestion) form = 'imperative';
      if (form === 'infinitive' && v.index > 0 && terms[v.index - 1] && low(terms[v.index - 1].text) === 'please') form = 'imperative';
      groups.push({ text: v.text, form, helper: v.auxiliary, main: v.text, infinitive: v.infinitive, start: v.index, negative: v.negative });
    }

    groups.forEach((g) => { if (g.split && g.start >= 0) roles[g.start] = 'helper'; });

    // Subjects: for each verb group, the noun group before it, or after the
    // helping verb when a question puts the helping verb first.
    groups.forEach((g) => {
      if (g.start < 0) return;
      const helperFirst = isQuestion && (g.split || (roles[g.start] === 'helper' || roles[g.start] === 'be'));
      let si = null;
      if (helperFirst && g.start <= 1) si = markSubject(roles, g.start, +1);
      if (si === null) si = markSubject(roles, g.start, -1);
      if (si === null && helperFirst) si = markSubject(roles, g.start, +1);
      g.subject = si !== null ? low(terms[si].text) : '';
      g.subjectText = si !== null ? terms[si].text : '';
      g.subjectSingularNoun = si !== null && !has(terms[si], 'Pronoun') && has(terms[si], 'Singular') && !has(terms[si], 'Plural');
    });

    // Sentence type.
    let type;
    const firstWord = terms[0] ? terms[0].norm : '';
    const whWord = WH.includes(firstWord) ? firstWord : '';
    const isImperative = !isQuestion && groups.length > 0 && groups[0].form === 'imperative';
    if (isQuestion) type = whWord ? 'whq' : 'ynq';
    else if (isImperative) type = 'command';
    else if (/!\s*$/.test(trimmed)) type = 'exclamation';
    else type = 'statement';
    const negative = groups.some((g) => g.negative) || roles.includes('negative');

    // An indirect question inside: "… tell me where the bank is".
    let indirect = null;
    for (let i = 1; i < terms.length - 2; i++) {
      if (WH.includes(terms[i].norm) || terms[i].norm === 'if' || terms[i].norm === 'whether') {
        const rest = roles.slice(i + 1);
        const firstVerb = rest.findIndex((r) => r === 'verb' || r === 'be' || r === 'helper');
        const firstNoun = rest.findIndex((r) => ['subject', 'object', 'pronoun'].includes(r));
        if (firstNoun !== -1 && firstVerb !== -1 && firstNoun < firstVerb && /\b(tell|know|wonder|ask|sure|explain|remember|understand|idea)\b/i.test(terms.slice(0, i).map((t) => t.text).join(' '))) {
          roles[i] = 'linking';
          indirect = { word: terms[i].text, rest: terms.slice(i + 1).map((t) => t.text).join(' ').replace(/[?.!]+$/, '') };
          break;
        }
      }
    }

    return { text: trimmed, terms, roles, groups, type, negative, isQuestion, whWord, indirect };
  }

  // Plain-English reasons why the sentence is built the way it is.
  function rulesFor(a) {
    const rules = [];
    const words = a.terms.map((t) => t.norm);
    const g0 = a.groups[0];
    const add = (r) => { if (!rules.includes(r)) rules.push(r); };

    if (a.type === 'whq' && g0) {
      const helper = g0.split ? g0.helper : a.terms[1] ? a.terms[1].text : '';
      add('This is a wh- question, so the order is: question word (' + a.terms[0].text + ') + helping verb (' + helper + ') + subject' +
        (g0.subjectText ? ' (' + g0.subjectText + ')' : '') + '. The helping verb comes before the subject.');
    }
    if (a.type === 'ynq' && g0) {
      add('This is a yes/no question, so the helping verb (' + (g0.split ? g0.helper : a.terms[0].text) + ') comes first, before the subject' +
        (g0.subjectText ? ' (' + g0.subjectText + ')' : '') + '.');
    }
    if (a.type === 'command') {
      add('This is a command or request: it starts with the base verb and doesn’t need a subject, because “you” is understood.' +
        (words.includes('please') ? ' “Please” makes it polite.' : ''));
    }
    if (a.indirect) {
      add('After “' + a.terms.slice(0, a.terms.findIndex((t) => t.text === a.indirect.word)).map((t) => t.text).join(' ') +
        '”, the second part uses normal statement order: “' + a.indirect.word + ' ' + a.indirect.rest + '”, not question order.');
    }

    a.groups.forEach((g) => {
      const subj = g.subject;
      const parts = g.text.split(/\s+/).map(low);
      const main = parts[parts.length - 1];
      switch (g.form) {
        case 'simple-present':
          if (THIRD_PERSON.includes(subj) && /s$/.test(main) && main !== 'is' && main !== 'has') {
            add('With he / she / it, the present simple verb takes -s or -es: “' + g.subjectText + ' ' + g.main + '”.');
          } else if (g.subjectSingularNoun && /s$/.test(main) && main !== 'is' && main !== 'has') {
            add('“' + g.subjectText + '” is one person or thing, so it works like he / she / it: the verb takes -s (“' + g.subjectText + ' ' + g.main + '”).');
          } else if (['i', 'you', 'we', 'they'].includes(subj) && main !== 'am' && main !== 'are') {
            add('With I / you / we / they, the present simple uses the base verb with no -s: “' + g.subjectText + ' ' + g.main + '”.');
          }
          if (['am', 'is', 'are'].includes(main) && subj) {
            add('The verb “be” matches the subject: I am, he/she/it is, you/we/they are. Here: “' + g.subjectText + ' ' + g.main + '”.');
          }
          break;
        case 'auxiliary-present':
        case 'auxiliary-past': {
          const helper = low(g.helper || parts[0]);
          add('After “' + helper.replace("n't", '') + (helper.endsWith("n't") ? "n't" : '') + '”, the main verb stays in its base form: “' +
            g.infinitive + '”' + (g.form === 'auxiliary-past' ? ', not the past form. “Did” already shows the past.' : '.'));
          break;
        }
        case 'simple-past':
          if (!/ed$/.test(main) && g.infinitive && low(g.infinitive) !== main) {
            add('“' + g.main + '” is the past form of the irregular verb “' + g.infinitive + '” (' + g.infinitive + ' → ' + g.main + ').');
          } else if (/ed$/.test(main)) {
            add('“' + g.main + '” is a regular past form: base verb + -ed.');
          }
          break;
        case 'present-progressive':
        case 'past-progressive':
          add('Continuous form: ' + (g.form === 'past-progressive' ? 'was / were' : 'am / is / are') + ' + verb-ing (“' + g.text + '”).');
          break;
        case 'present-perfect':
          add('Present perfect: have / has + past participle (“' + g.text + '”).' +
            (THIRD_PERSON.includes(subj) ? ' He / she / it takes “has”.' : ''));
          break;
        case 'present-perfect-progressive':
          add('Present perfect continuous: have / has + been + verb-ing (“' + g.text + '”).');
          break;
        case 'past-perfect':
          add('Past perfect: had + past participle (“' + g.text + '”). It shows which past action happened first.');
          break;
        case 'past-perfect-progressive':
          add('Past perfect continuous: had been + verb-ing (“' + g.text + '”).');
          break;
        case 'simple-future':
          add('Future with will: will + base verb (“' + g.text + '”). There is never “to” after will.');
          break;
        case 'auxiliary-future':
          add('Future with going to: am / is / are + going to + base verb (“' + g.text + '”).');
          break;
        case 'future-progressive':
          add('Future continuous: will be + verb-ing (“' + g.text + '”).');
          break;
        case 'future-perfect':
          add('Future perfect: will have + past participle (“' + g.text + '”).');
          break;
        case 'future-perfect-progressive':
          add('Future perfect continuous: will have been + verb-ing (“' + g.text + '”).');
          break;
        case 'modal-infinitive':
          add('After a modal verb (' + MODALS.slice(0, 6).join(', ') + '…), use the base verb with no “to”: “' + g.text + '”.');
          break;
        case 'passive-present':
        case 'passive-past':
        case 'passive-future':
          add('Passive voice: a form of “be” + past participle (“' + g.text + '”). It focuses on what happens, not who does it.');
          break;
        case 'want-infinitive':
          add('Some verbs (want, need, plan, hope, decide…) are followed by to + base verb: “' + g.text + '”.');
          break;
        case 'present-conditional':
          add('Would + base verb (“' + g.text + '”) is used for imagined situations and polite requests.');
          break;
      }
    });

    // Verb + to + verb: "want to learn".
    for (let i = 1; i < a.terms.length - 1; i++) {
      if (a.roles[i] === 'to' && a.roles[i + 1] === 'verb' && ['verb', 'be'].includes(a.roles[i - 1])) {
        add('“' + a.terms[i - 1].text + '” is followed by to + base verb: “' + a.terms[i - 1].text + ' to ' + a.terms[i + 1].text + '”.');
      }
    }

    // Plural after a number: "two apples".
    for (let i = 0; i < a.terms.length - 1; i++) {
      const t = a.terms[i];
      const n = a.terms[i + 1];
      if (has(t, 'Value') && !['one', '1'].includes(t.norm) && has(n, 'Plural')) {
        add('After a number bigger than one, the noun is plural: “' + t.text + ' ' + n.text + '”.');
        break;
      }
    }

    // Time words that match the tense.
    const forms = a.groups.map((g) => g.form);
    const clue = (list) => a.terms.find((t) => list.includes(t.norm));
    let c;
    if ((c = clue(CLUES.past)) && forms.some((f) => /simple-past|auxiliary-past/.test(f))) add('“' + c.text + '” is a clue word for the past simple.');
    if ((c = clue(CLUES.perfectSince)) && forms.some((f) => /perfect/.test(f))) add('“' + c.text + '” goes with perfect tenses to say how long, or from when.');
    if ((c = clue(CLUES.habit)) && forms.some((f) => /simple-present|auxiliary-present/.test(f))) add('“' + c.text + '” is a clue word for the present simple (habits and routines).');
    if ((c = clue(CLUES.now)) && forms.some((f) => /present-progressive/.test(f))) add('“' + c.text + '” shows it is happening now, which fits the present continuous.');
    if ((c = clue(CLUES.future)) && forms.some((f) => /future/.test(f))) add('“' + c.text + '” points to the future.');
    if ((c = clue(CLUES.future)) && forms.some((f) => f === 'present-progressive')) add('Present continuous + a future time (“' + c.text + '”) talks about a plan that is already arranged.');
    if ((c = clue(CLUES.by)) && forms.some((f) => /future-perfect/.test(f))) add('“By + a time” is the typical clue for the future perfect.');

    if (a.negative && a.type !== 'command') {
      add('It is negative: “not” / “n’t” goes after the helping verb (don’t, doesn’t, didn’t, isn’t, won’t, haven’t…).');
    }
    if (a.text && /^[a-z]/.test(a.text)) add('Tip: start a sentence with a capital letter.');
    return rules;
  }

  const TYPE_TEXT = {
    statement: ['Statement', 'It tells someone something.'],
    whq: ['Wh- question', 'It asks for information (what, where, why…).'],
    ynq: ['Yes/no question', 'The answer is yes or no.'],
    command: ['Command / request', 'It asks or tells someone to do something.'],
    exclamation: ['Exclamation', 'It shows a strong feeling.'],
  };

  // A more precise label than the role alone for a few small words.
  function wordLabel(a, i) {
    const role = a.roles[i];
    const w = a.terms[i].norm;
    if (role === 'to') return a.roles[i + 1] === 'verb' ? 'to + verb' : 'Preposition';
    if (role === 'article') {
      if (['a', 'an', 'the'].includes(w)) return 'Article';
      if (['this', 'that', 'these', 'those'].includes(w)) return 'Pointing word';
      return 'Amount word';
    }
    return ROLE_INFO[role][0];
  }

  function explain(nlp, text) {
    const sentences = nlp(text).sentences().out('array').map((s) => s.trim()).filter(Boolean);
    return sentences.slice(0, 10).map((s) => {
      const a = analyseSentence(nlp, s);
      if (!a) return null;
      const seen = new Set();
      const tenses = a.groups
        .map((g) => ({ g, info: FORMS[g.form] }))
        .filter((x) => x.info && !seen.has(x.info[0]) && seen.add(x.info[0]))
        .map((x) => ({ name: x.info[0], lesson: x.info[1] ? LESSON(x.info[1]) : null, use: x.info[2], verb: x.g.text }));
      return {
        text: a.text,
        type: a.negative && a.type === 'statement' ? ['Negative statement', 'It says that something is not true.'] : TYPE_TEXT[a.type],
        negative: a.negative,
        tenses,
        words: a.terms.map((t, i) => ({ text: t.text, role: a.roles[i], label: wordLabel(a, i), cls: ROLE_INFO[a.roles[i]][1] })),
        rules: rulesFor(a),
      };
    }).filter(Boolean);
  }

  // ---------- browser side ----------

  let nlpPromise = null;
  function loadNlp() {
    if (root.nlp) return Promise.resolve(root.nlp);
    if (!nlpPromise) {
      nlpPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'vendor/compromise.min.js';
        s.onload = () => (root.nlp ? resolve(root.nlp) : reject(new Error('nlp missing')));
        s.onerror = () => { nlpPromise = null; reject(new Error('load failed')); };
        document.head.appendChild(s);
      });
    }
    return nlpPromise;
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function render(results) {
    if (!results.length) return '<p class="note">There’s nothing to explain yet. Type a full sentence first.</p>';
    return results.map((r, n) => {
      const words = r.words.map((w) =>
        '<span class="word ' + w.cls + '"><span class="w">' + esc(w.text) + '</span>' +
        (w.label ? '<span class="l">' + esc(w.label) + '</span>' : '') + '</span>').join('');
      const tenses = r.tenses.length
        ? r.tenses.map((t) => '<li><strong>' + esc(t.name) + '</strong> (“' + esc(t.verb) + '”): used for ' + esc(t.use) + '.' +
            (t.lesson ? ' <a href="' + t.lesson + '">Open the lesson →</a>' : '') + '</li>').join('')
        : '<li>No verb found. A full sentence normally needs a verb.</li>';
      const rules = r.rules.length
        ? '<h3>Why it’s correct</h3><ul class="rules">' + r.rules.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>'
        : '';
      return '<article class="explain-sentence">' +
        (results.length > 1 ? '<p class="explain-num">Sentence ' + (n + 1) + '</p>' : '') +
        '<p class="explain-text">' + esc(r.text) + '</p>' +
        '<div class="chips"><span class="chip">' + esc(r.type[0]) + '</span>' +
        r.tenses.map((t) => '<span class="chip chip-tense">' + esc(t.name) + '</span>').join('') + '</div>' +
        '<p class="note">' + esc(r.type[1]) + '</p>' +
        '<h3>Each word’s job</h3><div class="words">' + words + '</div>' +
        '<h3>Tense</h3><ul class="rules">' + tenses + '</ul>' +
        rules +
        '</article>';
    }).join('') +
    '<p class="note">These explanations are worked out automatically, so a word’s label can occasionally be off in long or unusual sentences.</p>';
  }

  const api = { explain, analyseSentence, rulesFor, FORMS };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.EnglishExplain = Object.assign(api, {
      explainHtml: (text) => loadNlp().then((nlp) => render(explain(nlp, text))),
    });
  }
})(typeof window !== 'undefined' ? window : globalThis);
