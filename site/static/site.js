/* XMUM SAIR 生存指南 — page-wide behaviour: the header blocks and their Courses menu, the light/dark toggle,
   and the upload helper (search is in search.js, ratings in ratings.js, the rating form in rate.js). */
(function () {
  'use strict';
  var root = document.documentElement;
  var base = document.body.dataset.base || '/';

  // 0. language. The pages are written in both languages; build.py (site/i18n.py) marks the halves and base.html's
  //    first script sets <html data-lang> (the stored choice, else the browser's language), so the stylesheet shows one.
  //    Here: the switch in the header, and the same rule for what markup cannot carry or scripts add later, namely
  //    attributes (placeholder, title, aria-label), <option> labels, the document title, and text set from script as
  //    '中文 | English'. Text under [data-nt] is left alone: scripts put visitors' own words there.
  var CJK = /[㐀-䶿一-鿿]/, LATIN = /[A-Za-z]/;
  var L_ATTRS = ['title', 'placeholder', 'aria-label', 'alt', 'label'];
  var NO_SPLIT = /^(SCRIPT|STYLE|TEXTAREA|CODE|PRE|TITLE|SELECT|DATALIST|OPTION)$/;
  function lang() { return root.getAttribute('data-lang') === 'en' ? 'en' : 'zh'; }
  function halves(s) {   // '🧭 机会 | Opportunities →' → {lead: '🧭 ', zh: '机会', en: 'Opportunities', tail: ' →'}; null if it is not a pair
    var parts = s.split(/\s*\|\s+|\s+\|\s*/);
    if (parts.length !== 2 || !CJK.test(parts[0]) || CJK.test(parts[1]) || !LATIN.test(parts[1])) return null;
    // as in site/i18n.py: a half that would take a number or an address with it when hidden is not a half
    var held = function (x) { return (x.match(/\d+|https?:\/\/\S+|[\w.+-]+@[\w-]+\.[\w.-]+/g) || []).sort().join(' '); };
    if (held(parts[0]) !== held(parts[1])) return null;
    var lead = /^[^A-Za-z0-9㐀-鿿「（(\[【《"'“‘]*/.exec(parts[0])[0];
    if (lead.length === parts[0].length) lead = '';
    var t = /\s*(?:\*|→|[：:])\s*$/.exec(parts[1]), tail = t && t.index > 0 ? t[0] : '';
    return { lead: lead, zh: parts[0].slice(lead.length), en: parts[1].slice(0, parts[1].length - tail.length), tail: tail };
  }
  function pieces(s) { return s.split(' · ').map(function (seg) { return halves(seg) || seg; }); }
  function paired(ps) { return ps.some(function (p) { return typeof p !== 'string'; }); }
  function pick(s, l) {   // the one-language reading of a string; a string that is not a pair comes back as it is
    l = l || lang();
    return pieces(String(s)).map(function (p) { return typeof p === 'string' ? p : p.lead + p[l] + p.tail; }).join(' · ');
  }
  function shielded(node) {
    for (var e = node.parentNode; e && e.nodeType === 1; e = e.parentNode) {
      if (NO_SPLIT.test(e.tagName) || e.hasAttribute('data-nt') || /(^|\s)l-(zh|en|sep)(\s|$)/.test(e.getAttribute('class') || '')) return true;
    }
    return false;
  }
  function splitText(node) {   // a text node '中文 | English' becomes the same three spans build.py writes
    var s = node.nodeValue;
    if (!s || s.indexOf('|') < 0 || !node.parentNode || shielded(node)) return;
    var ps = pieces(s);
    if (!paired(ps)) return;
    var frag = document.createDocumentFragment();
    var add = function (cls, text) {
      if (!text) return;
      if (!cls) { frag.appendChild(document.createTextNode(text)); return; }
      var sp = document.createElement('span'); sp.className = cls; sp.textContent = text; frag.appendChild(sp);
    };
    ps.forEach(function (p, i) {
      if (i) add('', ' · ');
      if (typeof p === 'string') { add('', p); return; }
      add('', p.lead); add('l-zh', p.zh); add('l-sep', ' | '); add('l-en', p.en); add('', p.tail);
    });
    node.parentNode.replaceChild(frag, node);
  }
  function fixAttrs(el) {   // the full string is kept in data-l-<name>, the attribute shows the current half
    L_ATTRS.concat(el.tagName === 'OPTION' ? ['#text'] : []).forEach(function (a) {
      var key = 'data-l-' + (a === '#text' ? 'text' : a);
      var v = a === '#text' ? el.textContent : el.getAttribute(a), full = el.getAttribute(key);
      if (v !== null && v.indexOf('|') >= 0 && paired(pieces(v))) { full = v; el.setAttribute(key, v); }
      else if (full !== null && v !== pick(full, 'zh') && v !== pick(full, 'en')) { el.removeAttribute(key); full = null; }   // a script wrote something new
      if (full === null) return;
      var want = pick(full);
      if (v === want) return;
      if (a === '#text') el.textContent = want; else el.setAttribute(a, want);
    });
  }
  var L_SEL = L_ATTRS.map(function (a) { return '[' + a + '],[data-l-' + a + ']'; }).join(',') + ',option';
  function localize(node) {
    if (node.nodeType === 3) { splitText(node); return; }
    if (node.nodeType !== 1) return;
    if (node.matches(L_SEL)) fixAttrs(node);
    node.querySelectorAll(L_SEL).forEach(fixAttrs);
    var walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, null), texts = [], t;
    while ((t = walker.nextNode())) if (t.nodeValue.indexOf('|') >= 0) texts.push(t);
    texts.forEach(splitText);
  }
  var fullTitle = document.title, shownTitle = null;
  function paintTitle() {
    var t = pick(fullTitle);
    if (lang() === 'en') t = t.replace('XMUM SAIR 生存指南', 'XMUM SAIR Survival Guide');
    shownTitle = t;
    if (document.title !== t) document.title = t;
  }
  function repaint() {
    root.lang = lang() === 'en' ? 'en' : 'zh-Hans';
    document.querySelectorAll(L_SEL).forEach(fixAttrs);
    paintTitle();
  }
  var langBtn = document.querySelector('.lang-toggle');
  if (root.getAttribute('data-lang')) {   // set by base.html's first script; without it the page stays bilingual
    localize(document.body);              // what scripts earlier in the page have already drawn
    repaint();
    if (window.MutationObserver) {
      new MutationObserver(function (list) {
        list.forEach(function (m) {
          if (m.type === 'attributes') fixAttrs(m.target);
          else if (m.type === 'characterData') splitText(m.target);
          else {
            m.addedNodes.forEach(localize);
            if (m.target.nodeType === 1 && m.target.tagName === 'OPTION') fixAttrs(m.target);
          }
        });
      }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: L_ATTRS });
      var titleEl = document.querySelector('title');
      if (titleEl) new MutationObserver(function () {
        if (document.title !== shownTitle) { fullTitle = document.title; paintTitle(); }
      }).observe(titleEl, { childList: true, characterData: true, subtree: true });
    }
    if (langBtn) langBtn.addEventListener('click', function () {
      var next = lang() === 'en' ? 'zh' : 'en';
      root.setAttribute('data-lang', next);
      try { localStorage.setItem('lang', next); } catch (e) { /* private mode: the choice lasts for this page only */ }
      repaint();
      document.dispatchEvent(new CustomEvent('site:lang', { detail: next }));
    });
  }
  // for the other scripts: the current language, and one half of a pair for confirm() and the like
  window.siteLang = { get: lang, pick: pick, say: function (zh, en) { return lang() === 'en' ? en : zh; } };

  // 0b. a visitor's post in the reader's language, on request. The page asks the Worker (POST /translate): the first
  //     reader of a post has it translated, everyone after gets the stored translation. The button shows only when the
  //     post is not in the language the page is in.
  //     o: { url (the Worker's /translate), src ('forum' | 'board'), id, device, title (element or null), body (element),
  //          text: { title, body }, draw(bodyElement, text), slot (where the button goes) }
  window.siteTranslate = function (o) {
    var foreign = function () {   // Chinese text on an English page, or text without Chinese on a Chinese page
      var s = (o.text.title || '') + ' ' + o.text.body, han = (s.match(/[\u3400-\u9fff]/g) || []).length, latin = (s.match(/[A-Za-z]/g) || []).length;
      return lang() === 'en' ? han >= 4 && han * 4 >= latin : han < 4 && latin >= 12;
    };
    var btn = document.createElement('button'); btn.type = 'button'; btn.className = 'linkish tr-btn';
    var note = document.createElement('small'); note.className = 'muted tr-note'; note.hidden = true;
    note.textContent = '机器翻译，仅供参考 | Machine translation: check the original for anything that matters';
    var done = {}, shown = null;   // translations fetched on this page, by language; the one on screen
    var show = function (t) {
      if (o.title && (t.title || !shown)) o.title.textContent = t.title || o.text.title;
      while (o.body.firstChild) o.body.removeChild(o.body.firstChild);
      o.draw(o.body, t.body);
    };
    var paint = function () {
      btn.hidden = !shown && !foreign();
      btn.textContent = shown ? '看原文 | Show original' : '翻译 | Translate';
      note.hidden = !shown;
    };
    btn.addEventListener('click', function () {
      if (shown) { shown = null; show(o.text); paint(); return; }
      var to = lang();
      var use = function (t) { done[to] = t; shown = to; show(t); paint(); };
      if (done[to]) { use(done[to]); return; }
      btn.disabled = true; btn.textContent = '翻译中… | Translating…';
      fetch(o.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ src: o.src, id: o.id, to: to, device: o.device }) })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.status === 200, d: d }; }); })
        .then(function (r) {
          btn.disabled = false;
          if (r.ok && r.d.body) { use({ title: r.d.title || '', body: r.d.body }); return; }
          paint(); note.hidden = false; note.textContent = r.d.message || '这次没翻成，稍后再试 | The translation did not work; try again later';
        })
        .catch(function () { btn.disabled = false; paint(); note.hidden = false; note.textContent = '连不上翻译服务，稍后再试 | Cannot reach the translation service; try again later'; });
    });
    document.addEventListener('site:lang', function () {   // the reader switched language: back to the original, then see whether it needs translating
      if (!btn.isConnected) return;
      if (shown) { shown = null; show(o.text); }
      note.textContent = '机器翻译，仅供参考 | Machine translation: check the original for anything that matters';
      paint();
    });
    paint();
    o.slot.appendChild(btn); o.slot.appendChild(note);
    return btn;
  };

  // 1. mark the header block that covers the current URL; a programme page also lights up the Courses block
  var here = location.pathname.replace(/\/index\.html$/, '/').replace(/\/blog\/$/, '/qa/');   // the blog sits under Discussion
  var best = null;
  document.querySelectorAll('.site-header a.nb[href]').forEach(function (a) {
    var p = a.getAttribute('href');
    if (p.indexOf('http') === 0 || p === base) return;
    if (here === p || here.indexOf(p) === 0) {
      if (!best || p.length > best.getAttribute('href').length) best = a;
    }
  });
  var menuBtn = document.querySelector('.nb[data-menu]');
  var menu = menuBtn && document.getElementById(menuBtn.dataset.menu);
  if (best) {
    best.setAttribute('aria-current', 'page');
    if (menu && menu.contains(best)) menuBtn.setAttribute('aria-current', 'true');
  }

  // 1b. the Courses block opens a row of programme blocks instead of leaving the page (no script: it is a plain link)
  if (menuBtn && menu) {
    var setOpen = function (open) { menu.hidden = !open; menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false'); };
    menuBtn.addEventListener('click', function (e) { e.preventDefault(); setOpen(menu.hidden); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !menu.hidden) { setOpen(false); menuBtn.focus(); }
    });
    document.addEventListener('click', function (e) {
      if (!menu.hidden && !menu.contains(e.target) && !menuBtn.contains(e.target)) setOpen(false);
    });
  }

  // 2. light / dark: follow the system unless the visitor chose; the choice is kept in localStorage
  function stored() { try { return localStorage.getItem('theme'); } catch (e) { return null; } }
  function effective() {
    var t = stored();
    if (t === 'light' || t === 'dark') return t;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  var btn = document.querySelector('.theme-toggle');
  function paint() {
    var t = effective();
    if (btn) {
      btn.textContent = t === 'dark' ? '☀️' : '🌙';
      btn.setAttribute('aria-label', t === 'dark' ? '切换到浅色 | Switch to light' : '切换到深色 | Switch to dark');
      btn.title = btn.getAttribute('aria-label');
    }
  }
  if (btn) {
    btn.addEventListener('click', function () {
      var next = effective() === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('theme', next); } catch (e) { /* private mode: the choice lasts for this page only */ }
      paint();
    });
  }
  paint();

  // 3. /upload/: suggest known courses and lecturers, take anything else as new, then open the GitHub form filled in
  var up = document.getElementById('up-form'), upData = document.getElementById('up-data');
  if (up && upData) {
    var D = JSON.parse(upData.textContent);
    var $ = function (id) { return document.getElementById(id); };
    var code = $('up-code'), name = $('up-name'), nameRow = $('up-name-row'), note = $('up-course-note'), lect = $('up-lect'),
        lectList = $('up-lects'), year = $('up-year'), term = $('up-term'), other = $('up-other'), type = $('up-type'),
        assess = $('up-assess'), assessRow = $('up-assess-row'), err = $('up-error');
    var CODE = /^[A-Z]{1,4}(?:\d{3,4}|\d\.\d)$/;
    var norm = function (s) { return s.trim().toUpperCase().replace(/\s+/g, ''); };
    var fillLecturers = function (first) {   // this course's lecturers on top, everyone else after them
      while (lectList.firstChild) lectList.removeChild(lectList.firstChild);
      var add = function (n, label) { var o = document.createElement('option'); o.value = n; if (label) o.label = label; lectList.appendChild(o); };
      first.forEach(function (n) { add(n, '教过这门课 | taught this course'); });
      D.lecturers.forEach(function (n) { if (first.indexOf(n) < 0) add(n); });
    };
    var onCode = function () {
      var c = norm(code.value), hit = D.courses[c];
      if (hit) {
        var known = c + ' ' + hit.name + ' (' + hit.prog + ')';
        note.textContent = '✓ 已有课程：' + known + ' | Existing course: ' + known;
        name.value = hit.name; name.dataset.auto = '1'; nameRow.hidden = true;
        fillLecturers(hit.lecturers);
        return;
      }
      if (name.dataset.auto) { name.value = ''; delete name.dataset.auto; }
      nameRow.hidden = false;
      fillLecturers([]);
      if (!c) note.textContent = '';
      else if (!CODE.test(c)) note.textContent = '代码的样子：COM107、EEE212、MPU1.1、G0191 | Codes look like COM107, EEE212, MPU1.1, G0191';
      else note.textContent = '新课程：会自动建好文件夹，请填课程名' + (/^(G|MPU)/.test(c) ? '；G/MPU 开头的放进公共课' : '')
        + ' | New course: a folder is made for it; please add its name' + (/^(G|MPU)/.test(c) ? ' (G/MPU courses go to University-wide)' : '');
    };
    code.addEventListener('input', onCode);
    code.addEventListener('change', onCode);
    term.addEventListener('change', function () { other.hidden = term.value !== 'other'; if (!other.hidden) other.focus(); });
    type.addEventListener('change', function () { assessRow.hidden = type.value !== 'Past-Papers'; });
    up.addEventListener('submit', function (e) {
      e.preventDefault();
      // every field here is a hint and the GitHub form asks for the programme itself, so nothing is required: an empty
      // hint is left out of the form, and one in an odd shape (2024/04, swe 404) goes through for the bot to tidy
      var c = norm(code.value);
      var session = term.value === 'other' ? other.value.trim() : (year.value && term.value ? year.value + '-' + term.value : '');
      err.textContent = '';
      var p = new URLSearchParams();
      p.set('template', 'upload.yml');
      p.set('title', ['[上传 | Upload]', c, session, type.value].filter(Boolean).join(' '));
      if (c) p.set('code', c);
      if (name.value.trim()) p.set('name', name.value.trim());
      if (session) p.set('session', session);
      if (type.value) p.set('type', type.value);
      if (lect.value.trim()) p.set('lecturer', lect.value.trim());
      if (type.value === 'Past-Papers' && assess.value.trim()) p.set('assessment', assess.value.trim());
      location.href = up.dataset.form.split('?')[0] + '?' + p.toString().replace(/\+/g, '%20');
    });
    onCode();
  }
})();
