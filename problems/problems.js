(function () {
  'use strict';

  const config = window.PROBLEMS_CONFIG || {};
  const endpoint = String(config.endpoint || '').trim();

  const els = {
    search: document.getElementById('problem-search'),
    count: document.getElementById('result-count'),
    toggle: document.getElementById('add-toggle'),
    panel: document.getElementById('add-panel'),
    form: document.getElementById('problem-form'),
    submit: document.getElementById('problem-submit'),
    cancel: document.getElementById('problem-cancel'),
    formStatus: document.getElementById('form-status'),
    anonOption: document.getElementById('anonymous-option'),
    authorFields: document.getElementById('author-fields'),
    notice: document.getElementById('list-notice'),
    list: document.getElementById('problem-list'),
    listStatus: document.getElementById('list-status'),
  };
  const fields = els.form.elements;

  const AUTHOR_KEY = 'open-problems-author';
  const REQUEST_TIMEOUT_MS = 25000;
  const MATH_OPTIONS = {
    delimiters: [
      { left: '$$', right: '$$', display: true },
      { left: '\\[', right: '\\]', display: true },
      { left: '\\(', right: '\\)', display: false },
      { left: '$', right: '$', display: false },
    ],
    ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code', 'option', 'a'],
    throwOnError: false,
  };
  const LINK_PATTERN = /\bhttps?:\/\/[^\s<>"]+|\barXiv:\s?(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[a-z]{2})?\/\d{7})(?:v\d+)?/gi;
  const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  // The Apps Script reports its version; anonymous posting needs version 2.
  const ANONYMOUS_SINCE_VERSION = 2;

  let entries = [];
  let loaded = false;

  // ---------- Helpers ----------

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function fold(text) {
    return String(text).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }

  function normaliseUrl(value) {
    if (!value) return '';
    return /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : 'https://' + value;
  }

  function safeHttpUrl(value) {
    try {
      const url = new URL(normaliseUrl(value));
      if ((url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.includes('.')) return url;
    } catch (err) {
      // fall through
    }
    return null;
  }

  function isEmail(value) {
    return /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/.test(value);
  }

  function profileLabel(url) {
    const host = url.hostname.replace(/^www\./, '');
    if (host === 'inspirehep.net' || host.endsWith('.inspirehep.net')) return 'INSPIRE';
    if (/^scholar\.google\./.test(host)) return 'Google Scholar';
    if (host === 'orcid.org') return 'ORCID';
    if (host === 'arxiv.org') return 'arXiv';
    return host;
  }

  function renderMath(node) {
    if (typeof window.renderMathInElement !== 'function') return;
    window.renderMathInElement(node, MATH_OPTIONS);
    // Display math is already a block, so drop the line breaks typed around it.
    node.querySelectorAll('.katex-display').forEach((display) => {
      const wrapper = display.parentNode;
      const before = wrapper.previousSibling;
      const after = wrapper.nextSibling;
      if (before && before.nodeType === Node.TEXT_NODE) before.textContent = before.textContent.replace(/\n[ \t]*$/, '');
      if (after && after.nodeType === Node.TEXT_NODE) after.textContent = after.textContent.replace(/^[ \t]*\n/, '');
    });
  }

  function appendLinkified(parent, text) {
    let last = 0;
    for (const match of text.matchAll(LINK_PATTERN)) {
      let raw = match[0];
      let href;
      if (/^arxiv/i.test(raw)) {
        href = 'https://arxiv.org/abs/' + raw.replace(/^arxiv:\s?/i, '');
      } else {
        raw = raw.replace(/[.,;:!?'"]+$/, '');
        if (raw.endsWith(')') && !raw.includes('(')) raw = raw.replace(/\)+$/, '');
        href = raw;
      }
      if (match.index > last) parent.append(text.slice(last, match.index));
      const link = el('a', '', raw);
      link.href = href;
      link.rel = 'nofollow ugc noopener';
      parent.append(link);
      last = match.index + raw.length;
    }
    if (last < text.length) parent.append(text.slice(last));
  }

  // ---------- Problems ----------

  function normaliseProblem(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    const text = (value) => (value === null || value === undefined ? '' : String(value)).trim();
    const problem = {
      id: text(raw.id),
      timestamp: text(raw.timestamp),
      title: text(raw.title),
      description: text(raw.description),
      name: text(raw.name),
      email: text(raw.email),
      profile: text(raw.profile),
    };
    if (!problem.title) return null;
    if (!/^[A-Za-z][\w-]{0,63}$/.test(problem.id)) problem.id = 'problem-' + index;
    return problem;
  }

  function timeOf(problem) {
    const time = Date.parse(problem.timestamp);
    return Number.isNaN(time) ? 0 : time;
  }

  function buildEntry(problem) {
    const item = el('li', 'problem');
    item.id = problem.id;

    const title = el('h2', 'problem-title', problem.title);

    const meta = el('p', 'problem-meta');
    meta.append(problem.name
      ? el('span', 'problem-author', problem.name)
      : el('span', 'problem-author is-anonymous', 'Anonymous'));
    if (isEmail(problem.email)) {
      const mail = el('a', '', problem.email);
      mail.href = 'mailto:' + problem.email + '?subject=' + encodeURIComponent('Open problems list: ' + problem.title);
      meta.append(mail);
    } else if (problem.email) {
      meta.append(el('span', '', problem.email));
    }
    const profile = problem.profile && safeHttpUrl(problem.profile);
    if (profile) {
      const link = el('a', '', profileLabel(profile));
      link.href = profile.href;
      link.rel = 'nofollow ugc noopener';
      meta.append(link);
    }
    const time = timeOf(problem);
    if (time) {
      const date = el('a', 'problem-date');
      date.href = '#' + problem.id;
      date.title = 'Link to this problem';
      const stamp = el('time', '', dateFormat.format(new Date(time)));
      stamp.dateTime = new Date(time).toISOString();
      date.append(stamp);
      meta.append(date);
    }

    const body = el('div', 'problem-body');
    problem.description.split(/\n{2,}/).forEach((paragraph) => {
      const p = el('p');
      appendLinkified(p, paragraph);
      body.append(p);
    });

    item.append(title, meta, body);
    return {
      problem: problem,
      element: item,
      haystack: fold([problem.title, problem.description, problem.name || 'Anonymous', problem.email].join(' ')),
    };
  }

  function highlight(node, scrollTarget) {
    node.classList.remove('is-highlighted');
    void node.offsetWidth;
    node.classList.add('is-highlighted');
    (scrollTarget || node).scrollIntoView({ block: 'start' });
    window.setTimeout(() => node.classList.remove('is-highlighted'), 3500);
  }

  function setListStatus(message) {
    els.listStatus.textContent = message;
    els.listStatus.hidden = !message;
  }

  function applyFilter() {
    if (!loaded) return;
    const query = els.search.value;
    const terms = fold(query).split(/\s+/).filter(Boolean);
    let shown = 0;
    for (const entry of entries) {
      const match = terms.every((term) => entry.haystack.includes(term));
      entry.element.hidden = !match;
      if (match) shown += 1;
    }

    const total = entries.length;
    const noun = (n) => (n === 1 ? 'problem' : 'problems');
    if (total === 0) {
      els.count.textContent = '';
      setListStatus('No problems have been posted yet. Be the first to add one.');
    } else if (terms.length) {
      els.count.textContent = shown + ' of ' + total + ' ' + noun(total) + ' match';
      setListStatus(shown ? '' : 'No problems match your search.');
    } else {
      els.count.textContent = total + ' ' + noun(total);
      setListStatus('');
    }

    try {
      const url = new URL(window.location.href);
      if (query.trim()) url.searchParams.set('q', query.trim());
      else url.searchParams.delete('q');
      window.history.replaceState(null, '', url);
    } catch (err) {
      // Not essential.
    }
  }

  function showProblems(problems) {
    entries = problems
      .map(normaliseProblem)
      .filter(Boolean)
      .sort((a, b) => timeOf(b) - timeOf(a))
      .map(buildEntry);
    els.list.replaceChildren(...entries.map((entry) => entry.element));
    renderMath(els.list);
    loaded = true;
    applyFilter();

    const target = decodeURIComponent(window.location.hash.slice(1));
    const match = target && entries.find((entry) => entry.problem.id === target);
    if (match) {
      els.search.value = '';
      applyFilter();
      highlight(match.element);
    }
  }

  function addProblem(raw) {
    const problem = normaliseProblem(raw, entries.length);
    if (!problem) return;
    let entry = entries.find((existing) => existing.problem.id === problem.id);
    if (!entry) {
      entry = buildEntry(problem);
      entries.unshift(entry);
      els.list.prepend(entry.element);
      renderMath(entry.element);
    }
    els.search.value = '';
    applyFilter();
    highlight(entry.element, els.notice.hidden ? null : els.notice);
  }

  // ---------- Network ----------

  async function request(options) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(endpoint, Object.assign({ signal: controller.signal, redirect: 'follow' }, options));
      if (!response.ok) throw new Error('The server replied with an error (' + response.status + ').');
      return await response.json();
    } catch (err) {
      if (err.name === 'AbortError') throw new Error('The server took too long to respond.');
      if (err instanceof TypeError) throw new Error('Could not reach the server. Please check your connection.');
      throw err;
    } finally {
      window.clearTimeout(timer);
    }
  }

  async function loadProblems() {
    if (!endpoint) {
      setListStatus('The list of problems is not connected yet. Please check back soon.');
      return;
    }
    setListStatus('Loading problems…');
    els.list.setAttribute('aria-busy', 'true');
    try {
      const data = await request({ method: 'GET', cache: 'no-store' });
      if (!data || !data.ok || !Array.isArray(data.problems)) {
        throw new Error((data && data.error) || 'Unexpected reply from the server.');
      }
      els.anonOption.hidden = !(Number(data.version) >= ANONYMOUS_SINCE_VERSION);
      syncAnonymous();
      showProblems(data.problems);
    } catch (err) {
      els.list.replaceChildren();
      setListStatus('');
      const retry = el('button', 'text-button', 'Try again');
      retry.type = 'button';
      retry.addEventListener('click', loadProblems);
      els.listStatus.append('Sorry, the problems could not be loaded. ' + err.message + ' ', retry);
      els.listStatus.hidden = false;
    } finally {
      els.list.removeAttribute('aria-busy');
    }
  }

  // ---------- Form ----------

  function setFormStatus(message, kind) {
    els.formStatus.textContent = message;
    els.formStatus.className = 'form-status' + (kind ? ' is-' + kind : '');
  }

  function rememberAuthor() {
    try {
      window.localStorage.setItem(AUTHOR_KEY, JSON.stringify({
        name: fields.name.value.trim(),
        email: fields.email.value.trim(),
        profile: fields.profile.value.trim(),
      }));
    } catch (err) {
      // Storage may be unavailable; not essential.
    }
  }

  function restoreAuthor() {
    try {
      const saved = JSON.parse(window.localStorage.getItem(AUTHOR_KEY) || 'null');
      if (!saved) return;
      ['name', 'email', 'profile'].forEach((key) => {
        if (typeof saved[key] === 'string' && !fields[key].value) fields[key].value = saved[key];
      });
    } catch (err) {
      // Storage may be unavailable; not essential.
    }
  }

  function openForm() {
    els.panel.hidden = false;
    els.toggle.setAttribute('aria-expanded', 'true');
    els.notice.hidden = true;
    restoreAuthor();
    fields.title.focus();
  }

  function closeForm() {
    els.panel.hidden = true;
    els.toggle.setAttribute('aria-expanded', 'false');
    setFormStatus('');
  }

  function isAnonymous() {
    return !els.anonOption.hidden && fields.anonymous.checked;
  }

  // Posting anonymously hides the personal fields; disabling them also skips their validation.
  function syncAnonymous() {
    const anonymous = isAnonymous();
    els.authorFields.disabled = anonymous;
    els.authorFields.hidden = anonymous;
  }

  // Let the description box grow with its text (CSS caps it at 70% of the window height).
  function fitDescription() {
    const box = fields.description;
    box.style.height = 'auto';
    box.style.height = box.scrollHeight + 2 + 'px';
  }

  function checkProfile() {
    const value = fields.profile.value.trim();
    fields.profile.setCustomValidity(
      value && !safeHttpUrl(value) ? 'Please enter a web address, e.g. https://inspirehep.net/authors/…' : ''
    );
  }

  async function submitProblem(event) {
    event.preventDefault();
    checkProfile();
    if (!els.form.reportValidity()) return;
    if (!endpoint) {
      setFormStatus('Submissions are not open yet. Please check back soon.', 'error');
      return;
    }

    const anonymous = isAnonymous();
    const payload = {
      title: fields.title.value,
      description: fields.description.value,
      anonymous: anonymous,
      name: anonymous ? '' : fields.name.value,
      email: anonymous ? '' : fields.email.value.trim(),
      profile: anonymous ? '' : normaliseUrl(fields.profile.value.trim()),
      consent: !anonymous && fields.consent.checked,
      website: fields.hp.value,
    };

    els.submit.disabled = true;
    setFormStatus('Posting your problem…');
    try {
      const data = await request({
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
      });
      if (!data || !data.ok) throw new Error((data && data.error) || 'Unexpected reply from the server.');
      if (!anonymous) rememberAuthor();
      els.form.reset();
      closeForm();
      if (window.location.hash === '#add') {
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
      }
      els.notice.hidden = false;
      els.notice.textContent = 'Thank you. Your problem has been posted.';
      if (data.problem) addProblem(data.problem);
      else loadProblems();
    } catch (err) {
      setFormStatus('Your problem was not posted. ' + err.message, 'error');
    } finally {
      els.submit.disabled = false;
    }
  }

  // ---------- Wire up ----------

  els.toggle.addEventListener('click', () => (els.panel.hidden ? openForm() : closeForm()));
  els.cancel.addEventListener('click', () => {
    closeForm();
    els.toggle.focus();
  });
  els.form.addEventListener('submit', submitProblem);
  fields.profile.addEventListener('input', () => fields.profile.setCustomValidity(''));
  fields.description.addEventListener('input', fitDescription);
  els.form.addEventListener('reset', () => {
    fields.description.style.height = '';
    window.setTimeout(syncAnonymous); // the reset event fires before the checkbox is cleared
  });
  fields.anonymous.addEventListener('change', syncAnonymous);
  els.search.addEventListener('input', applyFilter);

  window.addEventListener('hashchange', () => {
    if (window.location.hash === '#add') {
      if (els.panel.hidden) openForm();
      return;
    }
    const target = decodeURIComponent(window.location.hash.slice(1));
    const match = target && entries.find((entry) => entry.problem.id === target);
    if (match) {
      els.search.value = '';
      applyFilter();
      highlight(match.element);
    }
  });

  const initialQuery = new URLSearchParams(window.location.search).get('q');
  if (initialQuery) els.search.value = initialQuery;
  if (window.location.hash === '#add') openForm();

  loadProblems();
})();
