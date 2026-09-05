/**
 * Injected page scripts for snapshot / click / fill / select / execute.
 * All return values must be JSON-serializable (Electron structured clone).
 */

/** Resolve ref/selector in main doc or same-origin iframes; include iframe viewport offset. */
export const RESOLVE_HELPER = `
function sparkResolve(ref, selector) {
  function findInDoc(doc, r) {
    if (!r || !doc) return null;
    try {
      return doc.querySelector('[data-spark-ref="' + CSS.escape(r) + '"]');
    } catch (_) {
      return null;
    }
  }
  if (ref) {
    let el = findInDoc(document, ref);
    if (el) return { el: el, offsetX: 0, offsetY: 0, frame: null };
    var iframes = Array.from(document.querySelectorAll('iframe'));
    if (ref.indexOf('.') !== -1 && ref.charAt(0) === 'f') {
      var fp = ref.split('.')[0];
      var idx = parseInt(fp.slice(1), 10);
      var iframe = iframes[idx];
      if (iframe) {
        try {
          var idoc = iframe.contentDocument;
          el = findInDoc(idoc, ref);
          if (el) {
            var fr = iframe.getBoundingClientRect();
            return { el: el, offsetX: fr.x, offsetY: fr.y, frame: iframe };
          }
        } catch (_) {}
      }
    }
    for (var i = 0; i < iframes.length; i++) {
      try {
        var ifr = iframes[i];
        el = findInDoc(ifr.contentDocument, ref);
        if (el) {
          var box = ifr.getBoundingClientRect();
          return { el: el, offsetX: box.x, offsetY: box.y, frame: ifr };
        }
      } catch (_) {}
    }
  }
  if (selector) {
    try {
      var selEl = document.querySelector(selector);
      if (selEl) return { el: selEl, offsetX: 0, offsetY: 0, frame: null };
    } catch (_) {}
  }
  return null;
}
`;

export const SNAPSHOT_SCRIPT = `(() => {
  const INTERACTIVE = [
    'a[href]',
    'a.cke_button',
    'a.img-options-action-btn',
    'a.ant-dropdown-trigger',
    '.cke_button',
    '.ant-dropdown-menu-item',
    '.ant-dropdown-menu-submenu-title',
    '.ant-select-item-option',
    '.el-dropdown-menu__item',
    '.el-select-dropdown__item',
    'button',
    'input',
    'textarea',
    'select',
    'option',
    '[role="button"]',
    '[role="link"]',
    '[role="textbox"]',
    '[role="searchbox"]',
    '[role="combobox"]',
    '[role="listbox"]',
    '[role="option"]',
    '[role="menuitem"]',
    '[role="dialog"]',
    '[role="grid"]',
    '[role="gridcell"]',
    '[role="spinbutton"]',
    '[role="columnheader"]',
    '[aria-haspopup]',
    '[aria-label*="calendar" i]',
    '[aria-label*="Next month" i]',
    '[aria-label*="Previous month" i]',
    '[contenteditable="true"]',
    '[contenteditable=""]',
  ].join(', ');

  const PORTAL_ROOTS = [
    '#d-overlay-root',
    '[id$="overlay-root"]',
    '[id*="overlay-root"]',
    '.ant-dropdown',
    '.ant-select-dropdown',
    '.ant-cascader-dropdown',
    '.ant-picker-dropdown',
    '.ant-tooltip',
    '.ant-popover',
    '.el-popper',
    '.el-select-dropdown',
    '.el-dropdown-menu',
    '[class*="Dropdown"]',
    '[data-portal]',
    '[class*="popover"]',
    '[class*="Popper"]',
    '[class*="suggest"]',
    '[class*="DatePicker"]',
    '[class*="datepicker"]',
    '[class*="Datepicker"]',
    '[class*="calendar"]',
    '[class*="Calendar"]',
    '[role="dialog"]',
    '[role="grid"]',
  ].join(', ');

  function isVisible(el, doc) {
    const win = (doc && doc.defaultView) || window;
    const style = win.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function cssPath(el) {
    if (el.id) return '#' + CSS.escape(el.id);
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && parts.length < 6) {
      let part = cur.tagName.toLowerCase();
      if (cur.id) {
        parts.unshift('#' + CSS.escape(cur.id));
        break;
      }
      const parent = cur.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((c) => c.tagName === cur.tagName);
        if (siblings.length > 1) {
          const n = siblings.indexOf(cur) + 1;
          part += ':nth-of-type(' + n + ')';
        }
      }
      parts.unshift(part);
      cur = parent;
    }
    return parts.join(' > ');
  }

  function roleOf(el) {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit;
    if (el.classList && (el.classList.contains('cke_button') || el.classList.contains('cke_button_on') || el.classList.contains('cke_button_off'))) {
      return 'button';
    }
    const tag = el.tagName.toLowerCase();
    if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') return 'textbox';
    if (tag === 'a') return 'link';
    if (tag === 'button') return 'button';
    if (tag === 'select') return 'combobox';
    if (tag === 'option') return 'option';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'input') {
      const t = (el.getAttribute('type') || 'text').toLowerCase();
      if (t === 'submit' || t === 'button' || t === 'image') return 'button';
      if (t === 'file') return 'upload';
      if (t === 'search') return 'searchbox';
      if (t === 'checkbox') return 'checkbox';
      if (t === 'radio') return 'radio';
      return 'textbox';
    }
    return tag;
  }

  function nameOf(el) {
    return (
      el.getAttribute('aria-label') ||
      el.getAttribute('title') ||
      el.getAttribute('placeholder') ||
      el.getAttribute('name') ||
      el.getAttribute('alt') ||
      el.getAttribute('data-name') ||
      (el.innerText || '').trim().slice(0, 80) ||
      el.getAttribute('value') ||
      ''
    );
  }

  function readValue(el) {
    if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') {
      return (el.innerText || el.textContent || '').trim();
    }
    if (typeof el.value === 'string') return el.value;
    return '';
  }

  function inPortalOf(el) {
    if (!el || !el.closest) return false;
    return !!(
      el.closest('#d-overlay-root') ||
      el.closest('[id$="overlay-root"]') ||
      el.closest('.ant-dropdown') ||
      el.closest('.ant-select-dropdown') ||
      el.closest('.ant-cascader-dropdown') ||
      el.closest('.ant-picker-dropdown') ||
      el.closest('.el-popper') ||
      el.closest('.el-select-dropdown') ||
      el.closest('[data-portal]') ||
      el.closest('[class*="suggest"]') ||
      el.closest('[class*="popover"]') ||
      el.closest('[class*="Popper"]') ||
      el.closest('[class*="DatePicker"]') ||
      el.closest('[class*="datepicker"]') ||
      el.closest('[class*="calendar"]') ||
      el.closest('[class*="Calendar"]') ||
      el.closest('[role="grid"]')
    );
  }

  function pushEl(out, el, framePrefix, localIdx, frameSelector, offsetX, offsetY, forceHidden) {
    const ref = framePrefix + 'e' + localIdx;
    try { el.setAttribute('data-spark-ref', ref); } catch (_) {}
    const rect = el.getBoundingClientRect();
    const val = readValue(el);
    const disabled =
      el.disabled === true ||
      el.getAttribute('aria-disabled') === 'true' ||
      el.getAttribute('disabled') !== null;
    const inDialog = !!(
      el.closest &&
      (el.closest('[role="dialog"]') ||
        el.closest('.ant-modal') ||
        el.closest('.el-dialog') ||
        el.closest('.modal') ||
        el.closest('[class*="Modal"]'))
    );
    const inPortal = inPortalOf(el);
    out.push({
      ref: ref,
      role: roleOf(el),
      name: nameOf(el),
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute('type') || undefined,
      value: val ? String(val).slice(0, 120) : undefined,
      placeholder: el.getAttribute('placeholder') || undefined,
      href: el.getAttribute('href') || undefined,
      selector: cssPath(el),
      frame: frameSelector || undefined,
      inDialog: inDialog || undefined,
      inPortal: inPortal || undefined,
      disabled: disabled || undefined,
      hidden: forceHidden || undefined,
      bounds: {
        x: Math.round(rect.x + (offsetX || 0)),
        y: Math.round(rect.y + (offsetY || 0)),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
    });
  }

  function collectFromDocument(doc, framePrefix, frameSelector, offsetX, offsetY) {
    const out = [];
    let localIdx = 0;
    const seen = new Set();
    const nodes = Array.from(doc.querySelectorAll(INTERACTIVE));
    for (const el of nodes) {
      if (seen.has(el)) continue;
      // Skip icon/label fragments inside CKEditor buttons — keep the outer .cke_button
      if (el.classList && el.classList.contains('cke_button_icon')) continue;
      if (el.classList && el.classList.contains('cke_button_label')) continue;
      if (!isVisible(el, doc)) continue;
      seen.add(el);
      localIdx += 1;
      pushEl(out, el, framePrefix, localIdx, frameSelector, offsetX, offsetY, false);
    }
    // Always include file inputs even when CSS-hidden (common upload UX)
    for (const el of Array.from(doc.querySelectorAll('input[type="file"]'))) {
      if (seen.has(el)) continue;
      seen.add(el);
      localIdx += 1;
      pushEl(out, el, framePrefix, localIdx, frameSelector, offsetX, offsetY, true);
    }
    return out;
  }

  const elements = collectFromDocument(document, '', null, 0, 0);
  const seenNodes = new Set();
  for (const item of elements) {
    try {
      const n = document.querySelector('[data-spark-ref="' + CSS.escape(item.ref) + '"]');
      if (n) seenNodes.add(n);
    } catch (_) {}
  }

  // Explicit portal pass: Ant Design / Element UI menus via createPortal on body
  const portalRoots = Array.from(document.querySelectorAll(PORTAL_ROOTS)).filter((root) => {
    const st = window.getComputedStyle(root);
    const r = root.getBoundingClientRect();
    if (st.display === 'none' || st.visibility === 'hidden') return false;
    if (root.classList.contains('ant-dropdown-hidden') || root.classList.contains('ant-select-dropdown-hidden')) return false;
    return r.width > 0 && r.height > 0;
  });
  let portalLocal = 0;
  for (const root of portalRoots) {
    const nodes = Array.from(root.querySelectorAll(
      'li, button, a, [role="menuitem"], [role="option"], [role="listbox"] *, [role="gridcell"], [role="spinbutton"], [role="columnheader"], .ant-dropdown-menu-item, .ant-select-item-option, .el-dropdown-menu__item, [class*="item"], [class*="Item"], span.name',
    ));
    for (const el of nodes) {
      if (seenNodes.has(el)) continue;
      if (!isVisible(el, document)) continue;
      seenNodes.add(el);
      portalLocal += 1;
      pushEl(elements, el, 'p.', portalLocal, 'portal', 0, 0, false);
      const last = elements[elements.length - 1];
      last.inPortal = true;
    }
  }

  const iframes = Array.from(document.querySelectorAll('iframe'));
  const iframeMeta = [];
  iframes.forEach((iframe, i) => {
    const box = iframe.getBoundingClientRect();
    let sameOrigin = false;
    try {
      sameOrigin = !!(iframe.contentDocument && iframe.contentDocument.documentElement);
    } catch (_) {
      sameOrigin = false;
    }
    iframeMeta.push({
      index: i,
      src: iframe.src || iframe.getAttribute('src') || '',
      sameOrigin: sameOrigin,
      x: box.x,
      y: box.y,
      w: box.width,
      h: box.height,
    });
    try {
      const idoc = iframe.contentDocument;
      if (!idoc) return;
      const frameSel = iframe.id
        ? ('iframe#' + CSS.escape(iframe.id))
        : ('iframe:nth-of-type(' + (i + 1) + ')');
      const framed = collectFromDocument(idoc, 'f' + i + '.', frameSel, box.x, box.y);
      for (const item of framed) elements.push(item);
    } catch (_) {
      // cross-origin — host CDP merge adds x*.e* refs
    }
  });

  const portalItems = elements
    .filter((e) => e.inPortal)
    .map((e) => ({ ref: e.ref, name: e.name }))
    .slice(0, 40);

  return JSON.parse(JSON.stringify({
    url: location.href,
    title: document.title,
    elements: elements,
    iframeCount: iframes.length,
    iframeMeta: iframeMeta,
    portalCount: portalRoots.length,
    portalItems: portalItems,
    capturedAt: new Date().toISOString(),
  }));
})()`;

export const PAGE_PROBE_SCRIPT = `(() => {
  const root = document.getElementById('app') || document.body || document.documentElement;
  let text = '';
  try { text = root ? String(root.innerText || root.textContent || '') : ''; } catch (_) { text = ''; }
  return JSON.parse(JSON.stringify({
    url: location.href,
    title: document.title,
    bodyLen: text.length,
  }));
})()`;

/** Timeline / body text probe — always return JSON-serializable plain data. */
export const PAGE_TEXT_SCRIPT = `(() => {
  function stripSurrogates(s) {
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c >= 0xD800 && c <= 0xDBFF) {
        var n = s.charCodeAt(i + 1);
        if (n >= 0xDC00 && n <= 0xDFFF) { out += s.charAt(i) + s.charAt(i + 1); i++; }
      } else if (c >= 0xDC00 && c <= 0xDFFF) {
        // skip lone low surrogate
      } else {
        out += s.charAt(i);
      }
    }
    return out;
  }
  function visibleText(el) {
    if (!el) return '';
    try { return String(el.innerText || el.textContent || ''); } catch (_) { return ''; }
  }
  const app = document.getElementById('app');
  let text = visibleText(app);
  const body = visibleText(document.body || document.documentElement);
  if (body.length > text.length) text = body;
  if (text.length < 2200) {
    const extra = [];
    document.querySelectorAll('[class*="list"],[class*="result"],[class*="flight"],[class*="hotel"],[class*="price"]').forEach((el) => {
      const t = visibleText(el);
      if (t.length > 80) extra.push(t);
    });
    if (extra.length) text = [text].concat(extra).join('\\n');
  }
  text = stripSurrogates(text);
  const payload = { text: text.slice(0, 80000), length: text.length };
  return JSON.parse(JSON.stringify(payload));
})()`;

export const FOCUS_SCRIPT = `(ref, selector) => {
  ${RESOLVE_HELPER}
  const hit = sparkResolve(ref, selector);
  if (!hit) return { ok: false };
  let el = hit.el;
  const nested =
    el.querySelector('[contenteditable="true"]') ||
    el.querySelector('[contenteditable=""]') ||
    el.querySelector('textarea, input');
  if (nested) el = nested;
  el.scrollIntoView({ block: 'center', inline: 'center' });
  el.focus({ preventScroll: true });
  if (typeof el.click === 'function' && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.isContentEditable)) {
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  }
  return { ok: true };
}`;

export const CLICK_HITTEST_SCRIPT = `(ref, selector) => {
  ${RESOLVE_HELPER}
  const hit = sparkResolve(ref, selector);
  if (!hit) return { ok: false, message: 'Element not found for click', target: ref || selector };
  const el = hit.el;
  const disabled =
    el.disabled === true ||
    el.getAttribute('aria-disabled') === 'true' ||
    el.classList.contains('disabled') ||
    el.getAttribute('disabled') !== null;
  el.scrollIntoView({ block: 'center', inline: 'center' });
  const r = el.getBoundingClientRect();
  return {
    ok: true,
    target: ref || selector,
    disabled: disabled,
    x: r.x + r.width / 2 + hit.offsetX,
    y: r.y + r.height / 2 + hit.offsetY,
    width: r.width,
    height: r.height,
    inFrame: !!hit.frame,
    isDropdownTrigger: !!(
      el.classList.contains('ant-dropdown-trigger') ||
      el.classList.contains('ant-select-selector') ||
      el.getAttribute('aria-haspopup') ||
      (el.closest && el.closest('.ant-dropdown-trigger, .ant-select, [aria-haspopup]'))
    ),
  };
}`;

export const CLICK_SCRIPT = `(ref, selector) => {
  ${RESOLVE_HELPER}
  const hit = sparkResolve(ref, selector);
  if (!hit) return { ok: false, message: 'Element not found for click', target: ref || selector };
  const el = hit.el;

  const disabled =
    el.disabled === true ||
    el.getAttribute('aria-disabled') === 'true' ||
    el.classList.contains('disabled') ||
    el.getAttribute('disabled') !== null;
  if (disabled) {
    return {
      ok: false,
      message: 'Click target is disabled (React state likely empty — fill did not stick)',
      target: ref || selector,
      disabled: true,
    };
  }

  el.scrollIntoView({ block: 'center', inline: 'center' });
  el.focus({ preventScroll: true });
  const opts = { bubbles: true, cancelable: true, view: (el.ownerDocument && el.ownerDocument.defaultView) || window, buttons: 1 };
  el.dispatchEvent(new PointerEvent('pointerdown', opts));
  el.dispatchEvent(new MouseEvent('mousedown', opts));
  el.dispatchEvent(new PointerEvent('pointerup', opts));
  el.dispatchEvent(new MouseEvent('mouseup', opts));
  el.dispatchEvent(new MouseEvent('click', opts));
  if (typeof el.click === 'function') el.click();
  return { ok: true, message: 'Click dispatched on ' + (ref || selector), target: ref || selector, disabled: false };
}`;

/**
 * React-aware fill:
 * - Prefer nested contenteditable
 * - Use selectAll + insertText (fires beforeinput/input React listens to)
 * - Fallback: per-character insertText
 * - Never claim success on textContent-only DOM mutation when React owns the field
 */
export const FILL_SCRIPT = `(ref, selector, value) => {
  ${RESOLVE_HELPER}
  function sparkResolveVisible(r, sel) {
    const hit0 = sparkResolve(r, sel);
    if (hit0 && hit0.el) {
      const box = hit0.el.getBoundingClientRect();
      if (box.width > 0 && box.height > 0) return hit0;
    }
    if (sel) {
      try {
        const nodes = Array.from(document.querySelectorAll(sel));
        const vis = nodes.find((n) => {
          const b = n.getBoundingClientRect();
          return b.width > 0 && b.height > 0;
        });
        if (vis) return { el: vis, offsetX: 0, offsetY: 0, frame: null };
        if (nodes[0]) return { el: nodes[0], offsetX: 0, offsetY: 0, frame: null };
      } catch (_) {}
    }
    return hit0;
  }
  const hit = sparkResolveVisible(ref, selector);
  let el = hit ? hit.el : null;
  if (!el) {
    return {
      ok: false,
      message: 'Element not found for fill',
      expected: value,
      actual: '',
      matched: false,
      kind: 'unknown',
      target: ref || selector,
      method: 'none',
    };
  }

  // Drill into nested editor (Weibo / Draft.js pattern)
  const nested =
    el.querySelector('[contenteditable="true"]') ||
    el.querySelector('[contenteditable=""]') ||
    el.querySelector('[role="textbox"]');
  if (nested) el = nested;

  el.scrollIntoView({ block: 'center', inline: 'center' });
  el.focus({ preventScroll: true });

  const readActual = (node) => {
    if (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA') return String(node.value ?? '');
    return (node.innerText || node.textContent || '').replace(/\\u00a0/g, ' ').trim();
  };

  const isCe =
    el.isContentEditable ||
    el.getAttribute('contenteditable') === 'true' ||
    el.getAttribute('contenteditable') === '' ||
    (el.getAttribute('role') === 'textbox' && el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA');

  let kind = 'unknown';
  let method = 'none';

  const selectAll = (node) => {
    const sel = (node.ownerDocument || document).defaultView.getSelection();
    if (!sel) return;
    const range = (node.ownerDocument || document).createRange();
    range.selectNodeContents(node);
    sel.removeAllRanges();
    sel.addRange(range);
  };

  const insertText = (text) => {
    el.dispatchEvent(
      new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: text,
      }),
    );
    const ok = (el.ownerDocument || document).execCommand('insertText', false, text);
    el.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: text,
      }),
    );
    return ok;
  };

  if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
    kind = el.tagName === 'TEXTAREA' ? 'textarea' : 'input';
    const win = (el.ownerDocument || document).defaultView || window;
    const proto =
      kind === 'textarea' ? win.HTMLTextAreaElement.prototype : win.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    const last = el.value;
    const tracker = el._valueTracker;
    if (tracker) tracker.setValue(last == null ? '' : String(last));
    if (setter) setter.call(el, '');
    else el.value = '';
    if (tracker) tracker.setValue('');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    if (tracker) tracker.setValue('');
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(
      new InputEvent('input', { bubbles: true, cancelable: true, data: value, inputType: 'insertText' }),
    );
    el.dispatchEvent(new Event('change', { bubbles: true }));
    method = 'native-value-setter+valueTracker';
  } else if (isCe) {
    kind = 'contenteditable';
    selectAll(el);
    (el.ownerDocument || document).execCommand('delete', false, undefined);
    el.dispatchEvent(
      new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }),
    );

    let ok = insertText(value);
    method = 'execCommand-insertText';

    let actual = readActual(el);
    if (!ok || actual !== value) {
      selectAll(el);
      (el.ownerDocument || document).execCommand('delete', false, undefined);
      const chunk = 8;
      for (let i = 0; i < value.length; i += chunk) {
        insertText(value.slice(i, i + chunk));
      }
      method = 'chunked-insertText';
      actual = readActual(el);
    }

    if (actual !== value) {
      selectAll(el);
      (el.ownerDocument || document).execCommand('delete', false, undefined);
      try {
        const dt = new DataTransfer();
        dt.setData('text/plain', value);
        el.dispatchEvent(
          new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }),
        );
        el.dispatchEvent(
          new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            inputType: 'insertFromPaste',
            data: value,
          }),
        );
        (el.ownerDocument || document).execCommand('insertText', false, value);
        method = 'paste+insertText';
      } catch {
        /* ignore */
      }
    }
  } else {
    kind = 'unknown';
    el.setAttribute('contenteditable', 'true');
    el.focus();
    selectAll(el);
    (el.ownerDocument || document).execCommand('delete', false, undefined);
    insertText(value);
    method = 'forced-contenteditable-insertText';
  }

  const actual = readActual(el);
  const matched = actual === value;
  return {
    ok: matched,
    message: matched
      ? 'Filled and verified ' + (ref || selector) + ' via ' + method + ' (' + actual.length + ' chars)'
      : 'Fill NOT sticky (React likely ignored DOM). expected=' +
        value.length +
        ' actual=' +
        actual.length +
        ' method=' +
        method,
    expected: value,
    actual: actual,
    matched: matched,
    kind: kind,
    target: ref || selector,
    method: method,
  };
}`;

/** Read current value of a fill target (for post-keyboard verification). */
export const FILL_SCRIPT_READ = `(ref, selector) => {
  ${RESOLVE_HELPER}
  let hit = sparkResolve(ref, selector);
  if (selector) {
    try {
      const nodes = Array.from(document.querySelectorAll(selector));
      const vis = nodes.find((n) => {
        const b = n.getBoundingClientRect();
        return b.width > 0 && b.height > 0;
      });
      if (vis) hit = { el: vis, offsetX: 0, offsetY: 0, frame: null };
    } catch (_) {}
  }
  if (!hit) return '';
  let el = hit.el;
  const nested =
    el.querySelector('[contenteditable="true"]') ||
    el.querySelector('[contenteditable=""]') ||
    el.querySelector('[role="textbox"]');
  if (nested) el = nested;
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return String(el.value ?? '');
  return (el.innerText || el.textContent || '').replace(/\\u00a0/g, ' ').trim();
}`;

/**
 * Select: native <select> or combobox/listbox option by visible text / value.
 * Returns option hit coords when trusted click is needed.
 */
export const SELECT_SCRIPT = `(ref, selector, value) => {
  ${RESOLVE_HELPER}
  const hit = sparkResolve(ref, selector);
  if (!hit) return { ok: false, message: 'Element not found for select', matched: false };
  const el = hit.el;

  if (el.tagName === 'SELECT') {
    const options = Array.from(el.options || []);
    let opt = options.find((o) => o.value === value || o.text === value || o.label === value);
    if (!opt) opt = options.find((o) => (o.text || '').includes(value) || (o.value || '').includes(value));
    if (!opt) {
      return {
        ok: false,
        matched: false,
        message: 'Option not found: ' + value,
        options: options.map((o) => o.text).slice(0, 40),
      };
    }
    el.value = opt.value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return {
      ok: true,
      matched: el.value === opt.value,
      actual: el.value,
      label: opt.text,
      method: 'native-select',
      message: 'Selected ' + opt.text,
    };
  }

  // Open combobox / custom dropdown
  el.scrollIntoView({ block: 'center', inline: 'center' });
  el.click();
  const er = el.getBoundingClientRect();
  return {
    ok: true,
    matched: false,
    method: 'opened-combobox',
    needsOptionClick: true,
    openPoint: {
      x: er.x + er.width / 2 + hit.offsetX,
      y: er.y + er.height / 2 + hit.offsetY,
    },
    message: 'Opened combobox; caller should click option',
  };
}`;

/** After combobox open: find option by text and return viewport coords. */
export const FIND_OPTION_SCRIPT = `(value) => {
  const all = Array.from(
    document.querySelectorAll(
      '[role="option"], .ant-select-item-option, .el-select-dropdown__item, .ant-cascader-menu-item, li[role="option"], .rc-virtual-list-holder-inner > div',
    ),
  );
  const visible = all.filter((o) => {
    const style = window.getComputedStyle(o);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const r = o.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
  const opt =
    visible.find((o) => ((o.innerText || o.textContent || '').trim() === value)) ||
    visible.find((o) => ((o.innerText || o.textContent || '').trim()).includes(value));
  if (!opt) {
    return {
      ok: false,
      message: 'Option not found: ' + value,
      candidates: visible
        .slice(0, 30)
        .map((o) => (o.innerText || '').trim())
        .filter(Boolean),
    };
  }
  opt.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  const r = opt.getBoundingClientRect();
  return {
    ok: true,
    label: (opt.innerText || opt.textContent || '').trim().slice(0, 120),
    x: r.x + r.width / 2,
    y: r.y + r.height / 2,
  };
}`;

/** Locate file input for upload (ref/selector or nearest input[type=file]). */
export const FIND_FILE_INPUT_SCRIPT = `(ref, selector) => {
  ${RESOLVE_HELPER}
  let el = null;
  const hit = sparkResolve(ref, selector);
  if (hit) {
    el = hit.el;
    if (el.tagName !== 'INPUT' || (el.getAttribute('type') || '').toLowerCase() !== 'file') {
      el =
        el.querySelector('input[type="file"]') ||
        (el.closest && el.closest('label') && el.closest('label').querySelector('input[type="file"]')) ||
        null;
    }
  }
  if (!el) {
    const files = Array.from(document.querySelectorAll('input[type="file"]'));
    el = files.find((f) => {
      const r = f.getBoundingClientRect();
      // include hidden file inputs (common pattern)
      return true;
    }) || null;
    if (files.length === 1) el = files[0];
  }
  if (!el) return { ok: false, message: 'No file input found' };
  // Ensure an id for CDP query if missing
  if (!el.id) {
    el.id = 'spark-upload-' + Date.now();
  }
  return {
    ok: true,
    id: el.id,
    selector: el.id ? ('#' + CSS.escape(el.id)) : 'input[type="file"]',
    multiple: !!el.multiple,
    accept: el.getAttribute('accept') || undefined,
  };
}`;

/** Find visible element by text (exact or includes), prefer smaller hit targets. */
export const FIND_TEXT_SCRIPT = `(text, exact, withinPortal) => {
  function norm(s) {
    s = String(s || '');
    try { s = s.normalize('NFKC'); } catch (_) {}
    return s.trim().replace(/\\s+/g, ' ');
  }
  const want = norm(text);
  if (!want) return { ok: false, message: 'empty text' };
  const isDayNum = /^(0?[1-9]|[12][0-9]|3[01])$/.test(want);
  const dayWant = isDayNum ? parseInt(want, 10) : 0;
  const portalRoots = Array.from(document.querySelectorAll('.ant-dropdown, .ant-select-dropdown, .ant-picker-dropdown, .el-popper, [data-portal], #d-overlay-root, [id$="overlay-root"], [class*="popover"], [class*="Popper"], [class*="DatePicker"], [class*="datepicker"], [class*="calendar"], [class*="Calendar"], [role="dialog"], [role="grid"]'))
    .filter((r) => {
      const st = getComputedStyle(r);
      const box = r.getBoundingClientRect();
      const childOk = Array.from(r.querySelectorAll('*')).some((c) => {
        const b = c.getBoundingClientRect();
        return b.width > 0 && b.height > 0;
      });
      return st.display !== 'none' && !r.classList.contains('ant-dropdown-hidden') && (box.width > 0 || childOk);
    });
  for (const el of Array.from(document.body ? document.body.children : [])) {
    if (!el || el.nodeType !== 1) continue;
    const st = getComputedStyle(el);
    if (st.position !== 'fixed' && st.position !== 'absolute') continue;
    const t = (el.innerText || '').replace(/\\s+/g, ' ');
    if (/Time \\(in 24h\\)/i.test(t) || (el.querySelector && el.querySelector('[role="grid"], [role="gridcell"]'))) {
      if (!portalRoots.includes(el)) portalRoots.push(el);
    }
  }
  const roots = withinPortal ? portalRoots : [document];
  if (withinPortal && !portalRoots.length) {
    return { ok: false, message: 'no portal overlay open' };
  }
  // Also search same-origin iframes when not portal-only
  if (!withinPortal) {
    const iframes = Array.from(document.querySelectorAll('iframe'));
    for (const iframe of iframes) {
      try {
        if (iframe.contentDocument) roots.push(iframe);
      } catch (_) {}
    }
  }
  function monthFromName(s) {
    const n = String(s || '').toLowerCase().slice(0, 3);
    const all = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
    const i = all.indexOf(n);
    return i >= 0 ? i + 1 : 0;
  }
  function ymdFromAria(s) {
    const raw = String(s || '');
    const en = raw.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/i);
    if (en) return { year: Number(en[3]), month: monthFromName(en[1]), day: Number(en[2]) };
    const iso = raw.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
    if (iso) return { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) };
    return null;
  }
  function headerOf(scope) {
    const t = String(scope.innerText || '').replace(/\\s+/g, ' ').slice(0, 500);
    const en = t.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})\b/i);
    if (en) return { year: Number(en[2]), month: monthFromName(en[1]) };
    return null;
  }
  let best = null;
  let bestEl = null;
  let bestOffset = { x: 0, y: 0 };
  const dayHits = [];
  for (const root of roots) {
    let scope = root;
    let offsetX = 0;
    let offsetY = 0;
    let searchRoot = root;
    if (root && root.tagName === 'IFRAME') {
      try {
        const idoc = root.contentDocument;
        if (!idoc) continue;
        const box = root.getBoundingClientRect();
        offsetX = box.x;
        offsetY = box.y;
        searchRoot = idoc;
        scope = idoc;
      } catch (_) {
        continue;
      }
    }
    const header = isDayNum ? headerOf(scope) : null;
    const candidates = Array.from(scope.querySelectorAll(
      isDayNum
        ? '[role="gridcell"], [role="grid"] [role="button"], [role="grid"] td, [role="grid"] [role="gridcell"]'
        : 'a,button,span,div,li,label,p,[role=menuitem],[role=button],[role=option],[role=tab],[role=gridcell],[role=spinbutton],.ant-dropdown-menu-item,.ant-select-item-option,.img-options-action-btn'
    ));
    for (const el of candidates) {
      const aria = el.getAttribute('aria-label') || '';
      const inner = norm(el.innerText || el.textContent || '');
      const raw = inner + ' ' + aria + ' ' + (el.getAttribute('title') || '');
      const t = norm(raw);
      if (!t) continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      const win = (searchRoot.defaultView) || window;
      const st = win.getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) continue;
      const absX = r.x + offsetX;
      const absY = r.y + offsetY;
      const inView =
        absY + r.height > 0 &&
        absY < window.innerHeight &&
        absX + r.width > 0 &&
        absX < window.innerWidth;
      const inPortal = !!(el.closest && (
        el.closest('.ant-dropdown') ||
        el.closest('.ant-select-dropdown') ||
        el.closest('.el-popper') ||
        el.closest('[class*="popover"]') ||
        el.closest('[class*="DatePicker"]') ||
        el.closest('[class*="calendar"]') ||
        el.closest('[role="grid"]')
      ));
      if (isDayNum) {
        const disabled =
          el.getAttribute('aria-disabled') === 'true' ||
          el.getAttribute('aria-hidden') === 'true' ||
          el.hasAttribute('disabled');
        const cls = String(el.className || '');
        let outside = /outside|other-month|muted|not-current/i.test(cls) || Number(st.opacity) < 0.45;
        const named = ymdFromAria(aria);
        if (named && header && (named.month !== header.month || named.year !== header.year)) outside = true;
        const day = named ? named.day : Number(String(inner).replace(/^0+/, '') || '0');
        if (day !== dayWant) continue;
        if (disabled || outside) continue;
        dayHits.push({
          el, offsetX, offsetY, inView, inPortal, t: (aria || inner).slice(0, 80),
          w: r.width, h: r.height,
          x: absX + r.width / 2,
          y: absY + r.height / 2,
        });
        continue;
      }
      if (t.length > want.length + 200) continue;
      const match = exact ? t === want : (t === want || t.includes(want));
      if (!match) continue;
      const score =
        Math.abs(r.width * r.height - 1800) +
        (t === want || t.endsWith(want) ? 0 : 80) +
        (aria && norm(aria) === want ? -40 : 0) +
        Math.min(t.length, 200) +
        (inView ? 0 : 100000);
      if (!best || score < best.score) {
        best = {
          score,
          tag: el.tagName,
          text: (aria || t).slice(0, 80),
          x: absX + r.width / 2,
          y: absY + r.height / 2,
          w: r.width,
          h: r.height,
          inView: inView,
          inPortal: inPortal,
          frameOffset: !!(offsetX || offsetY),
        };
        bestEl = el;
        bestOffset = { x: offsetX, y: offsetY };
      }
    }
  }
  if (isDayNum) {
    if (dayHits.length !== 1) {
      return {
        ok: false,
        message: dayHits.length
          ? 'ambiguous day ' + want + ' in calendar (' + dayHits.length + ' cells) — use pick_calendar / accessible name'
          : 'text not found: ' + want,
        count: dayHits.length,
      };
    }
    bestEl = dayHits[0].el;
    bestOffset = { x: dayHits[0].offsetX, y: dayHits[0].offsetY };
    best = {
      score: 0,
      tag: bestEl.tagName,
      text: dayHits[0].t,
      x: dayHits[0].x,
      y: dayHits[0].y,
      w: dayHits[0].w,
      h: dayHits[0].h,
      inView: dayHits[0].inView,
      inPortal: true,
    };
  }
  if (!best || !bestEl) return { ok: false, message: 'text not found: ' + want };
  try {
    bestEl.scrollIntoView({ block: 'center', inline: 'nearest' });
  } catch (_) {}
  const r2 = bestEl.getBoundingClientRect();
  best.x = r2.x + bestOffset.x + r2.width / 2;
  best.y = r2.y + bestOffset.y + r2.height / 2;
  best.w = r2.width;
  best.h = r2.height;
  best.inView = best.y > 0 && best.y < window.innerHeight;
  try {
    bestEl.setAttribute('data-spark-ref', 'spark-text');
    best.ref = 'spark-text';
  } catch (_) {}
  if (!best.inView) {
    return { ok: false, message: 'text found but still off-screen after scroll: ' + want, ...best };
  }
  return { ok: true, ...best };
}`;

/** List currently visible portal menus/items. */
export const LIST_PORTALS_SCRIPT = `(() => {
  const roots = Array.from(document.querySelectorAll(
    '#d-overlay-root, [id$="overlay-root"], .ant-dropdown, .ant-select-dropdown, .ant-picker-dropdown, .el-popper, .el-select-dropdown, [data-portal], [class*="suggest"], [class*="Popper"], [class*="popover"], [class*="DatePicker"], [class*="datepicker"], [class*="calendar"], [class*="Calendar"], [role="dialog"], [role="grid"]'
  ));
  for (const el of Array.from(document.body ? document.body.children : [])) {
    if (!el || el.nodeType !== 1) continue;
    const st = getComputedStyle(el);
    if (st.position !== 'fixed' && st.position !== 'absolute' && st.position !== 'sticky') continue;
    const t = (el.innerText || '').replace(/\\s+/g, ' ');
    if (/Time \\(in 24h\\)/i.test(t) || (el.querySelector && el.querySelector('[role="grid"], [role="gridcell"]'))) {
      if (!roots.includes(el)) roots.push(el);
    }
  }
  const out = [];
  for (const root of roots) {
    const st = getComputedStyle(root);
    const r = root.getBoundingClientRect();
    if (st.display === 'none' || st.visibility === 'hidden') continue;
    if (root.classList.contains('ant-dropdown-hidden') || root.classList.contains('ant-select-dropdown-hidden')) continue;
    const childVisible = Array.from(root.querySelectorAll('*')).some((el) => {
      const b = el.getBoundingClientRect();
      return b.width > 2 && b.height > 2;
    });
    if (r.width <= 0 && r.height <= 0 && !childVisible) continue;
    const items = Array.from(root.querySelectorAll(
      'li, button, a, .ant-dropdown-menu-item, .ant-select-item-option, [role=menuitem], [role=option], [role=gridcell], [role=spinbutton], [role=columnheader], [class*="item"], span.name'
    ))
      .map((el) => {
        const box = el.getBoundingClientRect();
        if (box.width <= 0 || box.height <= 0) return null;
        const role = (el.getAttribute('role') || '').toLowerCase();
        const aria = (el.getAttribute('aria-label') || '').trim();
        const t = (aria || el.innerText || el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 120);
        if (!t) return null;
        if (t.length > 80 && role !== 'gridcell' && role !== 'spinbutton') return null;
        return {
          text: t,
          name: aria || t,
          role: role || undefined,
          x: Math.round(box.x),
          y: Math.round(box.y),
          w: Math.round(box.width),
          h: Math.round(box.height),
        };
      })
      .filter(Boolean);
    if (!items.length && !(r.width > 0 && r.height > 0)) continue;
    const body = (root.innerText || '').replace(/\\s+/g, ' ').slice(0, 200);
    out.push({
      id: root.id || undefined,
      cls: String(root.className || '').slice(0, 80),
      kind: /Time \\(in 24h\\)|\\bSu\\b.*\\bMo\\b|[role="grid"]/i.test(body) || root.querySelector('[role="grid"], [role="gridcell"]') ? 'calendar' : 'menu',
      x: Math.round(r.x),
      y: Math.round(r.y),
      w: Math.round(r.width),
      h: Math.round(r.height),
      items: items.slice(0, 80),
    });
  }
  return JSON.parse(JSON.stringify({ count: out.length, portals: out }));
})()`;

export const DISMISS_OVERLAYS_SCRIPT = `(() => {
  const closed = [];
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  // Close tip / confirm modals
  for (const w of Array.from(document.querySelectorAll('.ant-modal-wrap'))) {
    if (getComputedStyle(w).display === 'none') continue;
    const title = (w.querySelector('.ant-modal-title')?.innerText || '').trim();
    if (/提示|确认|成功|完成|处理中/.test(title) || title === '') {
      const btn = Array.from(w.querySelectorAll('button')).find((b) => /确定|知道了|关闭|OK|完成/.test(b.innerText || ''));
      if (btn) { btn.click(); closed.push(title || 'modal-btn'); continue; }
      const x = w.querySelector('.ant-modal-close');
      if (x) { x.click(); closed.push(title || 'modal-x'); }
    }
  }
  // Force-hide leftover dropdowns that block clicks
  for (const d of Array.from(document.querySelectorAll('.ant-dropdown'))) {
    const r = d.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      d.classList.add('ant-dropdown-hidden');
      d.style.display = 'none';
      closed.push('dropdown');
    }
  }
  return { ok: true, closed };
})()`;

export const RECORD_START_SCRIPT = `(meta) => {
  if (window.__sparkRecording) return { ok: true, already: true, steps: (window.__sparkTrace || []).length };
  window.__sparkTrace = [];
  window.__sparkRecording = true;
  window.__sparkRecordMeta = meta || {};
  const cssPath = (el) => {
    if (!el || !el.tagName) return '';
    try {
      if (el.id) return '#' + CSS.escape(el.id);
      const parts = [];
      let cur = el;
      for (let i = 0; i < 5 && cur && cur.nodeType === 1; i++) {
        let part = cur.tagName.toLowerCase();
        if (cur.id) { parts.unshift('#' + CSS.escape(cur.id)); break; }
        const cls = String(cur.className || '').trim().split(/\\s+/).filter(Boolean).slice(0, 2);
        if (cls.length) part += '.' + cls.map((c) => CSS.escape(c)).join('.');
        const parent = cur.parentElement;
        if (parent) {
          const sibs = Array.from(parent.children).filter((c) => c.tagName === cur.tagName);
          if (sibs.length > 1) part += ':nth-of-type(' + (sibs.indexOf(cur) + 1) + ')';
        }
        parts.unshift(part);
        cur = parent;
      }
      return parts.join(' > ');
    } catch (_) { return el.tagName.toLowerCase(); }
  };
  const push = (action, target, extra) => {
    if (!window.__sparkRecording) return;
    const el = target;
    let selector = '';
    try {
      if (el && el.id) selector = '#' + CSS.escape(el.id);
      else if (el && el.getAttribute && el.getAttribute('data-spark-ref')) selector = '[data-spark-ref="' + el.getAttribute('data-spark-ref') + '"]';
      else if (el && el.tagName) selector = cssPath(el);
    } catch (_) {}
    const r = el && el.getBoundingClientRect ? el.getBoundingClientRect() : null;
    const text = el && (el.innerText || el.value || '').toString().trim().slice(0, 80) || undefined;
    window.__sparkTrace.push({
      i: window.__sparkTrace.length + 1,
      action: action,
      selector: selector,
      cssPath: el ? cssPath(el) : undefined,
      text: text,
      innerText: text,
      ariaLabel: el && el.getAttribute ? (el.getAttribute('aria-label') || undefined) : undefined,
      placeholder: el && el.getAttribute ? (el.getAttribute('placeholder') || undefined) : undefined,
      value: extra && extra.value,
      bounds: r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : undefined,
      url: location.href,
      elapsed_ms: Date.now() - (window.__sparkRecordStarted || Date.now()),
      ts: new Date().toISOString(),
    });
  };
  window.__sparkRecordStarted = Date.now();
  const onClick = (e) => push('click', e.target);
  const onInput = (e) => push('fill', e.target, { value: e.target && e.target.value });
  const onChange = (e) => push('change', e.target, { value: e.target && (e.target.value || e.target.checked) });
  document.addEventListener('click', onClick, true);
  document.addEventListener('input', onInput, true);
  document.addEventListener('change', onChange, true);
  window.__sparkRecordHandlers = { onClick, onInput, onChange };
  return { ok: true, already: false };
}`;

export const RECORD_STOP_SCRIPT = `(() => {
  if (!window.__sparkRecording) return { ok: false, message: 'not recording', steps: [] };
  window.__sparkRecording = false;
  const h = window.__sparkRecordHandlers || {};
  if (h.onClick) document.removeEventListener('click', h.onClick, true);
  if (h.onInput) document.removeEventListener('input', h.onInput, true);
  if (h.onChange) document.removeEventListener('change', h.onChange, true);
  const steps = window.__sparkTrace || [];
  const meta = window.__sparkRecordMeta || {};
  window.__sparkRecordHandlers = null;
  return JSON.parse(JSON.stringify({
    ok: true,
    platform: meta.platform || undefined,
    task: meta.task || undefined,
    url: location.href,
    steps: steps,
  }));
})()`;

/** Scroll editor / page so bottom actions (下一步) enter the viewport. */
export const XHS_SCROLL_BOTTOM_SCRIPT = `(() => {
  const editor = document.querySelector('.tiptap.ProseMirror')
    || document.querySelector('[class*="editor"]')
    || document.documentElement;
  let node = editor;
  while (node && node !== document.body) {
    const st = getComputedStyle(node);
    if (/(auto|scroll)/.test(st.overflowY) || /(auto|scroll)/.test(st.overflow)) {
      node.scrollTop = node.scrollHeight;
    }
    node = node.parentElement;
  }
  const se = document.scrollingElement || document.documentElement;
  se.scrollTop = se.scrollHeight;
  window.scrollTo(0, Math.max(document.body.scrollHeight, document.documentElement.scrollHeight));
  const next = Array.from(document.querySelectorAll('button,span,a,[role=button]')).find((el) => {
    const t = (el.innerText || '').trim();
    const r = el.getBoundingClientRect();
    return t === '下一步' && r.width > 0 && r.height > 0;
  });
  if (next) next.scrollIntoView({ block: 'center', inline: 'nearest' });
  return { ok: true, nextVisible: !!(next && next.getBoundingClientRect().height > 0) };
})()`;

/**
 * Add Xiaohongshu topics via custom topic button + insertText + #d-overlay-root suggestions.
 * Async IIFE — Electron executeJavaScript awaits the Promise.
 */
export const XHS_ADD_TOPICS_SCRIPT = `(async (topics) => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (s) => String(s || '').replace(/^#/, '').trim();
  const results = [];
  const list = Array.isArray(topics) ? topics : [];

  async function clickTopicButton() {
    const btn = Array.from(document.querySelectorAll('button,span,[role=button]')).find((b) => {
      const t = (b.innerText || b.textContent || '').trim();
      const r = b.getBoundingClientRect();
      return (t === '话题' || t === '#话题' || t === '添加话题') && r.width > 0 && r.height > 0;
    });
    if (btn) {
      btn.click();
      await sleep(500);
      return true;
    }
    return false;
  }

  function findTopicInput() {
    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA') && active.offsetWidth > 5) {
      const ph = (active.getAttribute('placeholder') || '');
      if (!/标题/.test(ph)) return active;
    }
    const inputs = Array.from(document.querySelectorAll('input[type="text"],input:not([type]),textarea'));
    return inputs.find((i) => {
      const r = i.getBoundingClientRect();
      const ph = (i.getAttribute('placeholder') || '');
      return r.width > 5 && r.height > 5 && !/标题/.test(ph) && !i.classList.contains('d-text');
    }) || null;
  }

  function pickSuggestion(needle) {
    const want = norm(needle);
    // NEVER search whole document — huge divs with # in text match and hang/click wrong nodes.
    const roots = [];
    const add = (el) => {
      if (!el || roots.includes(el)) return;
      const r = el.getBoundingClientRect();
      if (r.width < 20 || r.height < 16) return;
      if (r.height > 640) return;
      roots.push(el);
    };
    add(document.querySelector('#d-overlay-root'));
    document.querySelectorAll('[id$="overlay-root"]').forEach(add);
    document
      .querySelectorAll(
        '[class*="dropdown"],[class*="popover"],[class*="suggest"],[class*="mention"],[class*="popup"],[class*="overlay"] [class*="list"],[class*="option-list"]',
      )
      .forEach(add);
    if (!roots.length) return null;
    for (const root of roots) {
      const nodes = root.querySelectorAll(
        'li,[class*="item"],span.name,button,a,[role="option"],[class*="option"]',
      );
      for (const el of nodes) {
        if (el.children && el.children.length > 8) continue;
        const t = (el.innerText || el.textContent || '').trim().replace(/\\s+/g, ' ');
        if (!t || t.length > 48) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 4 || r.height < 4 || r.height > 72) continue;
        if (t.includes(want) || t.includes('#' + want) || ('#' + t).includes('#' + want)) {
          el.click();
          return t.slice(0, 40);
        }
      }
    }
    return null;
  }

  for (const raw of list) {
    const topic = String(raw || '').trim();
    if (!topic) continue;
    const typed = norm(topic);
    await clickTopicButton();
    await sleep(200);
    let input = findTopicInput();
    if (!input) {
      await clickTopicButton();
      await sleep(300);
      input = findTopicInput();
    }
    if (!input) {
      results.push({ topic, ok: false, reason: 'no_topic_input' });
      continue;
    }
    input.focus();
    try {
      document.execCommand('selectAll', false, null);
      document.execCommand('delete', false, null);
    } catch (_) {}
    const inserted = document.execCommand('insertText', false, typed);
    if (!inserted) {
      input.value = typed;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    await sleep(550);
    let picked = pickSuggestion(typed);
    if (!picked) {
      await sleep(350);
      picked = pickSuggestion(typed);
    }
    if (!picked) {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
      results.push({ topic, ok: false, reason: 'no_suggestion_enter_fallback' });
    } else {
      results.push({ topic, ok: true, picked });
    }
    await sleep(250);
  }
  return { ok: results.some((r) => r.ok) || results.length === 0, results };
})`;

export const XHS_PICK_COVER_SCRIPT = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const suggest = Array.from(document.querySelectorAll('button,span,a,[role=button]')).find((b) => {
    const t = (b.innerText || '').trim();
    const r = b.getBoundingClientRect();
    return /获取封面|封面建议|智能封面/.test(t) && r.width > 0;
  });
  if (suggest) {
    suggest.click();
    await sleep(2000);
  }
  const cards = Array.from(document.querySelectorAll(
    '[class*="cover"] img, [class*="Cover"] img, [class*="cover"] [class*="card"], [class*="cover-item"], [class*="coverItem"]'
  )).filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 40 && r.height > 40;
  });
  if (cards.length) {
    cards[0].click();
    return { ok: true, count: cards.length };
  }
  return { ok: false, message: 'no cover cards', count: 0 };
})()`;

/** Click content-area 发布 (exact), avoid sidebar 发布笔记 (x typically small). */
export const XHS_CLICK_PUBLISH_SCRIPT = `(() => {
  const btns = Array.from(document.querySelectorAll('button, [role=button], span, a'));
  let best = null;
  for (const b of btns) {
    const t = (b.innerText || b.textContent || '').trim().replace(/\\s+/g, ' ');
    if (t !== '发布') continue;
    const r = b.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) continue;
    if (r.x < 360) continue; // skip left nav
    if (/发布笔记/.test((b.parentElement && b.parentElement.innerText) || '')) continue;
    if (!best || r.x > best.r.x) best = { el: b, r };
  }
  if (!best) {
    // fallback: class hint
    const byClass = Array.from(document.querySelectorAll('button')).find((b) => {
      const t = (b.innerText || '').trim();
      const cls = String(b.className || '');
      const r = b.getBoundingClientRect();
      return t === '发布' && /publish/i.test(cls) && r.width > 0;
    });
    if (byClass) best = { el: byClass, r: byClass.getBoundingClientRect() };
  }
  if (!best) return { ok: false, message: 'publish button not found (content area)' };
  best.el.scrollIntoView({ block: 'center' });
  best.el.click();
  return { ok: true, x: Math.round(best.r.x), y: Math.round(best.r.y) };
})()`;

/** Open XHS long-form editor: 写长文 → 新的创作 → 空白创作 (if modal). */
export const XHS_ENSURE_EDITOR_SCRIPT = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const visible = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const clickText = (want, exact) => {
    const nodes = Array.from(document.querySelectorAll('button,span,a,div,[role=button],[role=tab]'));
    let best = null;
    for (const el of nodes) {
      const t = (el.innerText || el.textContent || '').trim().replace(/\\s+/g, ' ');
      if (!t || t.length > 40) continue;
      const ok = exact ? t === want : (t === want || t.includes(want));
      if (!ok || !visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (!best || r.width * r.height < best.area) best = { el, area: r.width * r.height, t };
    }
    if (!best) return false;
    best.el.click();
    return true;
  };
  const editorReady = () => {
    const title = Array.from(document.querySelectorAll('textarea.d-text, input.d-text')).find((el) => {
      if (!visible(el)) return false;
      if (el.classList && el.classList.contains('d-textarea-shadow')) return false;
      return true;
    });
    const body = Array.from(document.querySelectorAll('.tiptap.ProseMirror,[contenteditable=true]')).find(visible);
    return !!(title && body);
  };
  const log = [];
  if (editorReady()) return { ok: true, already: true, log };

  if (clickText('写长文', false)) {
    log.push('clicked:写长文');
    await sleep(1200);
  } else log.push('miss:写长文');

  if (editorReady()) return { ok: true, log };

  if (clickText('新的创作', false)) {
    log.push('clicked:新的创作');
    await sleep(1500);
  } else log.push('miss:新的创作');

  // Template modal: 空白创作 / 从空白开始 / 不使用模板
  for (const label of ['空白创作', '从空白开始', '从零开始', '不使用模板', '空白']) {
    if (editorReady()) break;
    if (clickText(label, false)) {
      log.push('clicked:' + label);
      await sleep(1500);
      break;
    }
  }

  for (let i = 0; i < 20; i++) {
    if (editorReady()) {
      return { ok: true, log, waitedMs: i * 500 };
    }
    // keep trying blank create if overlay still up
    if (i === 4 || i === 10) {
      clickText('空白创作', false) || clickText('新的创作', false);
    }
    await sleep(500);
  }
  const sample = (document.body && document.body.innerText || '').slice(0, 200).replace(/\\s+/g, ' ');
  return { ok: false, log, url: location.href, sample };
})()`;

/** Detect Xiaohongshu creator stage for AI routing (no content typing). */
export const XHS_PAGE_STAGE_SCRIPT = `(() => {
  const visible = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const text = (document.body && document.body.innerText || '').slice(0, 1200);
  const onPublishPage = !!(
    document.querySelector('.publish-page, .publish-page-container, .publish-vue-container .publish-page-content')
  );
  const hasTemplatePanel = /选择模板/.test(text) && /简约|优雅|文艺|理性|杂志/.test(text);
  const title = Array.from(document.querySelectorAll('textarea.d-text, input.d-text')).find((el) => {
    if (!visible(el)) return false;
    if (el.classList && el.classList.contains('d-textarea-shadow')) return false;
    return true;
  });
  const body = Array.from(document.querySelectorAll('.tiptap.ProseMirror, .rich-editor-container .ProseMirror')).find(visible);
  const hasChooser = /上传视频|上传图文|写长文/.test(text) && !title && !onPublishPage && !hasTemplatePanel;
  const hasTopicBtn = Array.from(document.querySelectorAll('button,span')).some((b) => {
    const t = (b.innerText || '').trim();
    return (t === '话题' || t === '添加话题') && visible(b);
  });
  const hasNext = Array.from(document.querySelectorAll('button')).some((b) => (b.innerText || '').trim() === '下一步' && visible(b));
  const hasLayoutBtn = Array.from(document.querySelectorAll('button')).some((b) => (b.innerText || '').trim() === '一键排版' && visible(b));
  const hasPublish = Array.from(document.querySelectorAll('button,span,[role=button]')).some((b) => {
    const t = (b.innerText || '').trim();
    const r = b.getBoundingClientRect();
    return (t === '发布' || t === '立即发布') && r.x > 360 && visible(b);
  });
  let stage = 'unknown';
  // Order matters: publish/layout pages also contain inputs / TipTap.
  if (onPublishPage || (hasTopicBtn && !hasLayoutBtn && !hasTemplatePanel)) stage = 'publish';
  else if (hasTemplatePanel || (hasNext && !hasLayoutBtn)) stage = 'layout';
  else if (title && body) stage = 'compose';
  else if (hasChooser) stage = 'chooser';
  else if (hasNext) stage = 'layout';
  else if (hasPublish) stage = 'publish';
  const titleEmpty = title ? !String(title.value || '').trim() : null;
  const bodyEmpty = body ? !(body.innerText || '').trim() : null;
  return {
    ok: true,
    stage,
    titleEmpty,
    bodyEmpty,
    hasNext,
    hasPublish,
    hasTopic: hasTopicBtn,
    hasLayoutBtn,
    hasTemplatePanel,
    onPublishPage,
    url: location.href,
  };
})()`;

/**
 * Atomic compose inject: clear once + write title/body once. AI must NOT loop fill.
 * Call as (async (payload) => ...)({ title, body, force? })
 */
export const XHS_INJECT_COMPOSE_SCRIPT = `(async (payload) => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const titleText = String((payload && payload.title) || '');
  const bodyText = String((payload && payload.body) || '');
  const force = !(payload && payload.force === false);
  const visible = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const setInput = (el, value) => {
    el.focus();
    const win = el.ownerDocument.defaultView || window;
    const proto = el.tagName === 'TEXTAREA' ? win.HTMLTextAreaElement.prototype : win.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    const tracker = el._valueTracker;
    if (tracker) tracker.setValue(el.value == null ? '' : String(el.value));
    if (setter) setter.call(el, '');
    else el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return String(el.value || '');
  };
  const setCe = (el, value) => {
    el.focus();
    try {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
      document.execCommand('delete', false, undefined);
    } catch (_) {}
    el.innerHTML = '';
    const ok = document.execCommand('insertText', false, value);
    if (!ok) {
      el.textContent = value;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }));
    }
    return String(el.innerText || el.textContent || '').trim();
  };

  const titleEl = Array.from(document.querySelectorAll('textarea.d-text, input.d-text')).find((el) => {
      if (!visible(el)) return false;
      if (el.classList && el.classList.contains('d-textarea-shadow')) return false;
      const ph = el.getAttribute('placeholder') || '';
      return /标题/.test(ph) || el.tagName === 'TEXTAREA' || el.tagName === 'INPUT';
    })
    || Array.from(document.querySelectorAll('textarea[placeholder*="标题"], input[placeholder*="标题"]')).find(visible);
  const bodyEl = Array.from(document.querySelectorAll('.tiptap.ProseMirror')).find(visible)
    || Array.from(document.querySelectorAll('[contenteditable=true]')).find(visible);

  if (!titleEl || !bodyEl) {
    return {
      ok: false,
      message: 'compose fields not ready',
      stage: 'missing_fields',
      hasTitle: !!titleEl,
      hasBody: !!bodyEl,
    };
  }

  // Publish page also has title + TipTap caption — do not treat as compose inject target.
  if (document.querySelector('.publish-page, .publish-page-container')) {
    return {
      ok: true,
      skipped: true,
      message: 'on publish page — skip inject_compose (use xhs_inject_publish)',
      stage: 'publish',
    };
  }

  const prevTitle = String(titleEl.value || '').trim();
  const prevBody = String(bodyEl.innerText || '').trim();
  if (!force && prevTitle && prevBody) {
    return {
      ok: true,
      skipped: true,
      message: 'already filled — skipped (force=false)',
      titleLen: prevTitle.length,
      bodyLen: prevBody.length,
    };
  }

  const titleActual = titleText ? setInput(titleEl, titleText) : prevTitle;
  await sleep(120);
  const bodyActual = bodyText ? setCe(bodyEl, bodyText) : prevBody;
  await sleep(80);

  const titleOk = !titleText || titleActual.length > 0;
  const bodyOk = !bodyText || bodyActual.length > 0;
  return {
    ok: titleOk && bodyOk,
    message: 'inject_compose done',
    titleLen: titleActual.length,
    bodyLen: bodyActual.length,
    titleNeedle: titleText.slice(0, 12),
    bodyNeedle: bodyText.slice(0, 12),
    cleared: force,
  };
})`;

/**
 * Atomic publish-page inject: summary (caption TipTap) + topics.
 * Call (async (p) => ...)({ summary, topics })
 */
export const XHS_INJECT_PUBLISH_SCRIPT = `(async (payload) => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const summary = String((payload && payload.summary) || '');
  const topics = Array.isArray(payload && payload.topics) ? payload.topics.map(String) : [];
  const maxTopics = Math.min(topics.length, 5);
  const visible = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const inView = (el) => {
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < (window.innerHeight || 800) && r.width > 0 && r.height > 0;
  };
  const out = { summary: null, topics: [] };

  if (summary) {
    // Prefer TipTap caption on publish page (near 话题 / inside publish-page).
    const scope =
      document.querySelector('.publish-page, .publish-page-content, .publish-page-content-base') ||
      document;
    let box =
      Array.from(scope.querySelectorAll('.tiptap.ProseMirror, [contenteditable=true]')).find((el) => {
        if (!visible(el)) return false;
        const r = el.getBoundingClientRect();
        return r.height >= 40 && r.height <= 280;
      }) ||
      Array.from(document.querySelectorAll('textarea')).find((el) => {
        if (!visible(el)) return false;
        const ph = (el.getAttribute('placeholder') || '') + (el.getAttribute('aria-label') || '');
        return /简介|描述|摘要|推荐|补充|说明|概要|标题会有|说点什么/.test(ph);
      });
    if (box) {
      try { box.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (_) {}
      await sleep(120);
      box.focus();
      if (box.tagName === 'TEXTAREA' || box.tagName === 'INPUT') {
        const win = window;
        const proto = box.tagName === 'TEXTAREA' ? win.HTMLTextAreaElement.prototype : win.HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (setter) setter.call(box, summary); else box.value = summary;
        box.dispatchEvent(new Event('input', { bubbles: true }));
        out.summary = { ok: true, len: String(box.value || '').length };
      } else {
        try {
          const sel = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(box);
          sel.removeAllRanges();
          sel.addRange(range);
          document.execCommand('delete', false, undefined);
        } catch (_) {}
        const ok = document.execCommand('insertText', false, summary);
        if (!ok) {
          box.textContent = summary;
          box.dispatchEvent(new InputEvent('input', { bubbles: true, data: summary, inputType: 'insertText' }));
        }
        out.summary = { ok: true, len: String(box.innerText || '').trim().length };
      }
    } else {
      out.summary = { ok: false, message: 'summary field not found' };
    }
  }

  const norm = (s) => String(s || '').replace(/^#/, '').trim();
  async function clickTopicButton() {
    const btn = Array.from(document.querySelectorAll('button.topic-btn, button,span,[role=button]')).find((b) => {
      const t = (b.innerText || b.textContent || '').trim();
      return (t === '话题' || t === '#话题' || t === '添加话题') && visible(b);
    });
    if (btn) {
      try { btn.scrollIntoView({ block: 'center' }); } catch (_) {}
      btn.click();
      await sleep(400);
      return true;
    }
    return false;
  }
  function findTopicInput() {
    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
      const ph = active.getAttribute('placeholder') || '';
      if (!/标题/.test(ph)) return active;
    }
    return Array.from(document.querySelectorAll('input[type="text"],input:not([type]),textarea')).find((i) => {
      const r = i.getBoundingClientRect();
      const ph = i.getAttribute('placeholder') || '';
      if (/标题/.test(ph)) return false;
      // topic chips often start tiny until focused; allow small width if focused area
      return r.height > 5 && (r.width > 3 || inView(i));
    }) || null;
  }
  function pickSuggestion(needle) {
    const want = norm(needle);
    // NEVER fall back to document — [class*=topic] / all divs on publish page is huge and hangs.
    const roots = [];
    const add = (el) => {
      if (!el || roots.includes(el)) return;
      const r = el.getBoundingClientRect();
      if (r.width < 20 || r.height < 16 || r.height > 640) return;
      roots.push(el);
    };
    add(document.querySelector('#d-overlay-root'));
    document.querySelectorAll('[id$="overlay-root"]').forEach(add);
    document
      .querySelectorAll(
        '[class*="dropdown"],[class*="popover"],[class*="suggest"],[class*="mention"],[class*="popup"],[class*="overlay"] [class*="list"],[class*="option-list"]',
      )
      .forEach(add);
    if (!roots.length) return null;
    for (const root of roots) {
      const nodes = root.querySelectorAll(
        'li,[class*="item"],span.name,button,a,[role="option"],[class*="option"]',
      );
      for (const el of nodes) {
        if (el.children && el.children.length > 8) continue;
        const t = (el.innerText || '').trim().replace(/\\s+/g, ' ');
        if (!t || t.length > 48) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 4 || r.height < 4 || r.height > 72) continue;
        if (t.includes(want) || t.includes('#' + want) || ('#' + t).includes('#' + want)) {
          el.click();
          return t.slice(0, 40);
        }
      }
    }
    return null;
  }

  for (let i = 0; i < maxTopics; i++) {
    const topic = String(topics[i] || '').trim();
    if (!topic) continue;
    const typed = norm(topic);
    try {
      await clickTopicButton();
      let input = findTopicInput();
      if (!input) {
        await clickTopicButton();
        await sleep(250);
        input = findTopicInput();
      }
      if (!input) {
        out.topics.push({ topic, ok: false, reason: 'no_input' });
        continue;
      }
      input.focus();
      try { document.execCommand('selectAll'); document.execCommand('delete'); } catch (_) {}
      document.execCommand('insertText', false, typed);
      await sleep(500);
      let picked = pickSuggestion(typed);
      if (!picked) {
        await sleep(300);
        picked = pickSuggestion(typed);
      }
      if (!picked) {
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
        out.topics.push({ topic, ok: false, reason: 'no_suggestion' });
      } else {
        out.topics.push({ topic, ok: true, picked });
      }
      await sleep(200);
    } catch (e) {
      out.topics.push({ topic, ok: false, reason: String(e && e.message ? e.message : e).slice(0, 80) });
    }
  }

  const topicOk = !maxTopics || out.topics.some((t) => t.ok) || out.topics.every((t) => t.reason === 'no_suggestion');
  // no_suggestion still typed — treat soft-ok if summary ok or topics attempted
  const softTopicOk = !maxTopics || out.topics.length > 0;
  const summaryOk = !summary || (out.summary && out.summary.ok);
  return {
    ok: Boolean(summaryOk && softTopicOk),
    message: 'inject_publish done',
    ...out,
    topicOk,
  };
})`;

/**
 * Compose → layout template → publish page.
 * Clicks 一键排版 (button), waits for template panel (up to ~30s),
 * picks template (default 简约基础), clicks 下一步, waits for publish stage.
 */
export const XHS_LAYOUT_NEXT_SCRIPT = `(async (payload) => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const templatePrefer = String((payload && payload.template) || '简约基础');
  const timeoutMs = Number((payload && payload.timeoutMs) || 32000);
  const log = [];
  const visible = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const bodyText = () => (document.body && document.body.innerText) || '';
  const onPublish = () =>
    !!(document.querySelector('.publish-page, .publish-page-container')) ||
    Array.from(document.querySelectorAll('button')).some((b) => (b.innerText || '').trim() === '话题' && visible(b));
  const hasNext = () =>
    Array.from(document.querySelectorAll('button')).some((b) => (b.innerText || '').trim() === '下一步' && visible(b));
  const hasTemplates = () => /选择模板/.test(bodyText()) && /简约|优雅|文艺|理性/.test(bodyText());

  if (onPublish()) {
    return { ok: true, skipped: true, message: 'already on publish page', stage: 'publish', log };
  }

  // If already in layout panel, skip 一键排版
  if (!hasNext() && !hasTemplates()) {
    const layoutBtn = Array.from(document.querySelectorAll('button')).find((b) => {
      const t = (b.innerText || '').trim();
      return t === '一键排版' && visible(b);
    });
    if (!layoutBtn) {
      return { ok: false, message: '一键排版 button not found', stage: 'compose', log };
    }
    try { layoutBtn.scrollIntoView({ block: 'center' }); } catch (_) {}
    layoutBtn.click();
    log.push('clicked:一键排版');
  }

  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (hasNext() || hasTemplates()) break;
    if (onPublish()) break;
    await sleep(800);
  }
  if (!hasNext() && !hasTemplates() && !onPublish()) {
    return {
      ok: false,
      message: 'layout panel did not appear (waited for 下一步/模板)',
      waitedMs: Date.now() - t0,
      log,
    };
  }
  log.push('layout-ready:' + (Date.now() - t0) + 'ms');

  if (onPublish()) {
    return { ok: true, message: 'reached publish', stage: 'publish', log };
  }

  // Pick template if list visible
  if (hasTemplates()) {
    const names = [templatePrefer, '简约基础', '清晰明朗', '文艺清新', '优雅几何'];
    let picked = null;
    for (const name of names) {
      const el = Array.from(document.querySelectorAll('div,span,li,button')).find((n) => {
        const t = (n.innerText || '').trim();
        if (t !== name) return false;
        const r = n.getBoundingClientRect();
        return r.width > 20 && r.height > 10;
      });
      if (el) {
        try { el.scrollIntoView({ block: 'nearest' }); } catch (_) {}
        el.click();
        picked = name;
        log.push('template:' + name);
        await sleep(900);
        break;
      }
    }
    if (!picked) log.push('template:none');
  }

  // Click 下一步 (may need twice if still on layout)
  for (let i = 0; i < 3; i++) {
    if (onPublish()) break;
    const next = Array.from(document.querySelectorAll('button')).find((b) => {
      return (b.innerText || '').trim() === '下一步' && visible(b);
    });
    if (!next) break;
    try { next.scrollIntoView({ block: 'center' }); } catch (_) {}
    next.click();
    log.push('clicked:下一步#' + (i + 1));
    await sleep(2200);
  }

  const t1 = Date.now();
  while (Date.now() - t1 < 12000) {
    if (onPublish()) {
      return { ok: true, message: 'layout → publish ok', stage: 'publish', log };
    }
    await sleep(500);
  }
  return {
    ok: hasNext() ? false : onPublish(),
    message: onPublish() ? 'layout → publish ok' : 'still not on publish page',
    stage: onPublish() ? 'publish' : hasNext() ? 'layout' : 'unknown',
    log,
  };
})`;

/**
 * Universal page analyzer — stamp data-spark-ref + classify primitives + required markers.
 * Returns AnalyzedPage-compatible JSON.
 */
export const ANALYZE_PAGE_SCRIPT = `(() => {
  const visible = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const st = window.getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) return false;
    return true;
  };
  const isFile = (el) => el.tagName === 'INPUT' && String(el.type || '').toLowerCase() === 'file';
  const textOf = (el) => String(el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
  const nearLabel = (el) => {
    const id = el.getAttribute('id');
    if (id) {
      try {
        const lab = document.querySelector('label[for="' + CSS.escape(id) + '"]');
        if (lab) return textOf(lab).slice(0, 80);
      } catch (_) {}
    }
    const wrap = el.closest('label, .form-item, .ant-form-item, .el-form-item, [class*="form-item"], [class*="field"]');
    if (wrap) {
      const t = textOf(wrap).slice(0, 80);
      if (t && t.length < 60) return t;
      const lab = wrap.querySelector('label, .label, [class*="label"]');
      if (lab) return textOf(lab).slice(0, 80);
    }
    const prev = el.previousElementSibling;
    if (prev) {
      const t = textOf(prev).slice(0, 40);
      if (t && t.length < 30) return t;
    }
    return (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('name') || '').slice(0, 80);
  };
  const colorLooksRed = (c) => {
    const s = String(c || '').toLowerCase();
    if (!s || s === 'transparent' || s.indexOf('rgba(0') === 0) return false;
    const m = s.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/);
    if (m) {
      const r = Number(m[1]), g = Number(m[2]), b = Number(m[3]);
      return r > 150 && g < 120 && b < 120;
    }
    return /red|#f00|#ff0000|#e74|#c00|#ff4d|#f522|#fa4|#d32/.test(s);
  };
  const detectRequired = (el) => {
    if (el.required || el.getAttribute('aria-required') === 'true') {
      return { required: true, marker: el.required ? 'html_required' : 'aria-required' };
    }
    const scope = el.closest('label, .form-item, .ant-form-item, .el-form-item, [class*="form-item"], [class*="field"]') || el.parentElement;
    if (!scope) return { required: false, marker: null };
    const starNodes = Array.from(scope.querySelectorAll('*')).filter((n) => {
      const t = (n.childNodes.length <= 2 ? (n.textContent || '') : '').trim();
      return t === '*' || t === '＊' || t === '必填';
    }).slice(0, 6);
    for (const n of starNodes) {
      const c = window.getComputedStyle(n).color;
      if (colorLooksRed(c)) return { required: true, marker: 'asterisk_red' };
      return { required: true, marker: 'asterisk' };
    }
    // pseudo-elements
    try {
      for (const n of [scope, ...Array.from(scope.querySelectorAll('label, span, i, em')).slice(0, 20)]) {
        for (const pseudo of ['::before', '::after']) {
          const cs = window.getComputedStyle(n, pseudo);
          const content = String(cs.content || '').replace(/["']/g, '');
          if (content === '*' || content === '＊') {
            if (colorLooksRed(cs.color)) return { required: true, marker: 'pseudo_asterisk_red' };
            return { required: true, marker: 'pseudo_asterisk' };
          }
        }
      }
    } catch (_) {}
    const cls = String(scope.className || '') + ' ' + String(el.className || '');
    if (/required|必填|is-required/.test(cls)) return { required: true, marker: 'class_required' };
    return { required: false, marker: null };
  };
  const classify = (el) => {
    const tag = el.tagName.toLowerCase();
    const type = String(el.getAttribute('type') || el.type || '').toLowerCase();
    const role = (el.getAttribute('role') || '').toLowerCase();
    const ph = (el.getAttribute('placeholder') || '') + ' ' + nearLabel(el);
    if (tag === 'input') {
      if (type === 'password') return 'password';
      if (type === 'number') return 'number_input';
      if (type === 'search') return 'search';
      if (type === 'date' || type === 'datetime-local') return 'date_input';
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'file') return 'file_upload';
      if (type === 'hidden') return null;
      if (/话题|标签|tag|topic|#/.test(ph) || /topic-btn|tag-input/.test(String(el.className || ''))) return 'tag_input';
      return 'text_input';
    }
    if (tag === 'textarea') {
      if (/话题|标签|tag|topic/.test(ph)) return 'tag_input';
      return 'text_input';
    }
    if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') return 'rich_text';
    if (tag === 'select' || role === 'listbox' || role === 'combobox') return 'select';
    if (role === 'switch' || /switch|toggle/.test(String(el.className || ''))) return 'toggle';
    if (role === 'spinbutton') return 'spinbutton';
    const blob = (ph + ' ' + textOf(el) + ' ' + (el.getAttribute('aria-label') || '') + ' ' + String(el.className || ''));
    const isTrigger = tag === 'button' || role === 'button' || el.getAttribute('aria-haspopup');
    if (isTrigger && /end\\s*time|start\\s*time|run indefinitely|date picker|datepicker|选择日期|结束时间|开始时间|截止日期|投放结束|结束日期/i.test(blob)) {
      return 'date_picker_button';
    }
    if (isTrigger && /date|time|日期|时间|日历/i.test(ph) && (/indefinitely/i.test(textOf(el)) || /20\\d{2}/.test(textOf(el))) && !/budget|bid|amount|usd|\\$/i.test(blob)) {
      return 'date_picker_button';
    }
    if (tag === 'button' || role === 'button' || (tag === 'a' && role === 'button')) return 'button';
    if (tag === 'a') return 'link';
    return 'unknown';
  };
  const currentValue = (el, prim) => {
    if (prim === 'rich_text' || prim === 'date_picker_button' || prim === 'button') return String(el.innerText || '').trim().slice(0, 200);
    if (prim === 'checkbox' || prim === 'radio' || prim === 'toggle') return el.checked ? 'true' : 'false';
    if (prim === 'file_upload') return el.files && el.files.length ? String(el.files.length) : '';
    return String(el.value || el.getAttribute('aria-valuenow') || el.innerText || '').slice(0, 200);
  };
  const buttonAction = (label) => {
    const t = label.replace(/\\s+/g, '');
    if (/发布|提交|确认发布|Post|Tweet|Publish|Submit/i.test(t) && !/发布笔记|定时发布/.test(t)) return 'submit';
    if (/暂存|存草稿|草稿|Save draft|Draft/i.test(t)) return 'save_draft';
    if (/下一步|继续|Next|Continue/i.test(t)) return 'next';
    if (/取消|关闭|返回|Cancel|Close|Back/i.test(t)) return 'cancel';
    return 'other';
  };
  const pageType = () => {
    const t = (document.body && document.body.innerText || '').slice(0, 1500);
    const u = location.href;
    if (/upload.*video|上传图文|写长文|上传视频/.test(t) && /publish|creator/.test(u)) return 'chooser';
    if (/发布|Publish|Tweet|发帖|一键排版|话题/.test(t) || /publish|compose|editor/.test(u)) return 'publish';
    if (document.querySelectorAll('input,textarea,[contenteditable=true]').length >= 3) return 'form';
    if (document.querySelectorAll('table, [class*=list], [class*=feed]').length >= 2) return 'list';
    return 'custom';
  };

  // Clear old refs then stamp
  document.querySelectorAll('[data-spark-ref]').forEach((el) => el.removeAttribute('data-spark-ref'));
  const candidates = Array.from(document.querySelectorAll(
    'a,button,input,textarea,select,[role="button"],[role="link"],[role="checkbox"],[role="radio"],[role="textbox"],[role="combobox"],[role="switch"],[role="spinbutton"],[aria-haspopup],[contenteditable="true"],.tiptap.ProseMirror'
  ));
  const fields = [];
  const buttons = [];
  let idx = 0;
  for (const el of candidates) {
    const prim = classify(el);
    if (!prim) continue;
    const allowHiddenFile = prim === 'file_upload';
    if (!allowHiddenFile && !visible(el)) continue;
    if (prim === 'unknown' && el.tagName !== 'A') continue;
    idx += 1;
    const ref = 'e' + idx;
    el.setAttribute('data-spark-ref', ref);
    const label = nearLabel(el) || textOf(el).slice(0, 40) || prim;
    const req = detectRequired(el);
    const ph = el.getAttribute('placeholder') || '';
    const maxLen = el.getAttribute('maxlength') ? Number(el.getAttribute('maxlength')) : null;
    if (prim === 'date_picker_button') {
      fields.push({
        ref,
        primitive: prim,
        label: (label || textOf(el) || 'date').slice(0, 80),
        required: req.required,
        required_marker: req.marker,
        placeholder: ph.slice(0, 80),
        max_length: maxLen,
        current_value: currentValue(el, prim),
        tag: el.tagName.toLowerCase(),
        type: String(el.type || ''),
        name: String(el.getAttribute('name') || el.getAttribute('id') || '').slice(0, 60),
        selector: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : ''),
        disabled: Boolean(el.disabled),
      });
      continue;
    }
    if (prim === 'button' || prim === 'link') {
      const lab = textOf(el).slice(0, 40) || label;
      if (!lab) continue;
      buttons.push({
        ref,
        label: lab,
        action: buttonAction(lab),
        disabled: Boolean(el.disabled),
      });
      continue;
    }
    const field = {
      ref,
      primitive: prim,
      label: label.slice(0, 80),
      required: req.required,
      required_marker: req.marker,
      placeholder: ph.slice(0, 80),
      max_length: maxLen,
      current_value: currentValue(el, prim),
      tag: el.tagName.toLowerCase(),
      type: String(el.type || ''),
      name: String(el.getAttribute('name') || el.getAttribute('id') || '').slice(0, 60),
      selector: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : ''),
      disabled: Boolean(el.disabled),
    };
    // Better labels for anonymous rich text / title heuristics
    if (prim === 'rich_text' && (!field.label || field.label === 'rich_text')) {
      field.label = '正文';
    }
    if (prim === 'text_input' && /标题|title/i.test(field.placeholder) && (!field.label || field.label.length < 2)) {
      field.label = '标题';
    }
    // Heuristic: title/正文 on publish pages often required even without star
    if (!field.required && /标题|title|正文|内容|content|描述|简介/i.test(field.label + field.placeholder)) {
      field.required = true;
      field.required_marker = field.required_marker || 'label_heuristic';
    }
    fields.push(field);
  }

  // Suggested tags on page
  const tagHints = [];
  const bodyText = (document.body && document.body.innerText) || '';
  const tagMatches = bodyText.match(/#[\\w\\u4e00-\\u9fff]{2,20}/g) || [];
  for (const t of tagMatches.slice(0, 12)) {
    if (!tagHints.includes(t)) tagHints.push(t);
  }
  for (const f of fields) {
    if (f.primitive === 'tag_input' && tagHints.length) f.suggested_tags = tagHints.slice(0, 8);
  }

  const alerts = [];
  document.querySelectorAll('[class*=toast],[class*=message],[class*=alert],[role=alert]').forEach((el) => {
    if (!visible(el)) return;
    const m = textOf(el).slice(0, 120);
    if (m) alerts.push({ type: /错误|失败|error/i.test(m) ? 'error' : 'toast', message: m });
  });

  const required_fields = fields.filter((f) => f.required);
  const optional_fields = fields.filter((f) => !f.required);
  let host = '';
  try { host = location.hostname; } catch (_) {}
  return {
    ok: true,
    url: location.href,
    title: document.title || '',
    host,
    page_type: pageType(),
    required_fields,
    optional_fields,
    buttons: buttons.slice(0, 40),
    alerts: alerts.slice(0, 10),
    field_count: fields.length,
    capturedAt: new Date().toISOString(),
  };
})()`;

/** Read field value by data-spark-ref for mini-QA */
export const FIELD_VALUE_SCRIPT = `(function(ref){
  const el = document.querySelector('[data-spark-ref="' + ref + '"]');
  if (!el) return { ok: false, message: 'ref not found' };
  const ce = el.isContentEditable || el.getAttribute('contenteditable') === 'true';
  if (ce) return { ok: true, kind: 'contenteditable', value: String(el.innerText || '').trim() };
  if (el.getAttribute && el.getAttribute('role') === 'button') {
    return { ok: true, kind: 'button', value: String(el.innerText || '').trim() };
  }
  if (el.tagName === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio')) {
    return { ok: true, kind: el.type, value: el.checked ? 'true' : 'false' };
  }
  if (el.tagName === 'BUTTON' || (el.getAttribute && el.getAttribute('role') === 'button')) {
    return { ok: true, kind: 'button', value: String(el.innerText || '').trim() };
  }
  if (el.tagName === 'INPUT' && el.type === 'file') {
    return { ok: true, kind: 'file', value: String(el.files ? el.files.length : 0) };
  }
  return { ok: true, kind: (el.tagName || '').toLowerCase(), value: String(el.value || el.innerText || '') };
})`;

/**
 * Inspect an open calendar/time popover and return trusted-click targets.
 * Never identifies month nav by "<" / ">" glyphs — uses aria-label Next/Previous month.
 */
export const CALENDAR_INSPECT_SCRIPT = `(function(opts){
  opts = opts || {};
  const wantY = Number(opts.year);
  const wantM = Number(opts.month);
  const wantD = Number(opts.day);
  function visible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const st = getComputedStyle(el);
    return st.display !== 'none' && st.visibility !== 'hidden' && Number(st.opacity) !== 0;
  }
  function pt(el) {
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height };
  }
  function monthFromName(s) {
    const n = String(s || '').toLowerCase().replace(/sept/, 'sep').slice(0, 3);
    const all = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
    const i = all.indexOf(n);
    return i >= 0 ? i + 1 : 0;
  }
  function ymdFromAria(s) {
    const raw = String(s || '');
    const en = raw.match(/\\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b/i);
    if (en) return { year: Number(en[3]), month: monthFromName(en[1]), day: Number(en[2]) };
    const iso = raw.match(/\\b(20\\d{2})-(\\d{1,2})-(\\d{1,2})\\b/);
    if (iso) return { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) };
    return null;
  }
  const portalSel = '#d-overlay-root, [id$="overlay-root"], .ant-picker-dropdown, [class*="popover"], [class*="Popper"], [class*="DatePicker"], [class*="datepicker"], [class*="calendar"], [class*="Calendar"], [role="dialog"], [role="grid"]';
  let roots = Array.from(document.querySelectorAll(portalSel));
  for (const el of Array.from(document.body ? document.body.children : [])) {
    if (!el || el.nodeType !== 1) continue;
    const st = getComputedStyle(el);
    if (st.position !== 'fixed' && st.position !== 'absolute') continue;
    const t = (el.innerText || '');
    if (/Time \\(in 24h\\)/i.test(t) || el.querySelector('[role="grid"], [role="gridcell"]')) roots.push(el);
  }
  roots = roots.filter((root) => {
    if (!visible(root) && !root.querySelector('[role="gridcell"]')) return false;
    const t = (root.innerText || '');
    return /Time \\(in 24h\\)/i.test(t) || !!root.querySelector('[role="grid"], [role="gridcell"]') || /\\bSu\\b[\\s\\S]{0,40}\\bMo\\b/.test(t);
  });
  if (!roots.length) return { ok: false, open: false, message: 'calendar popover not open' };
  const root = roots.sort((a, b) => {
    const ta = (a.innerText || '').length;
    const tb = (b.innerText || '').length;
    return tb - ta;
  })[0];
  const body = String(root.innerText || '').replace(/\\s+/g, ' ');
  const headerMatch = body.match(/\\b(january|february|march|april|may|june|july|august|september|october|november|december)\\s+(\\d{4})\\b/i)
    || body.match(/(20\\d{2})\\s*年\\s*(\\d{1,2})\\s*月/);
  let headerYear = 0;
  let headerMonth = 0;
  let header = '';
  if (headerMatch) {
    if (/年/.test(headerMatch[0])) {
      headerYear = Number(headerMatch[1]);
      headerMonth = Number(headerMatch[2]);
    } else {
      headerMonth = monthFromName(headerMatch[1]);
      headerYear = Number(headerMatch[2]);
    }
    header = headerMatch[0];
  }
  const steps = (wantY && wantM && headerYear && headerMonth)
    ? (wantY - headerYear) * 12 + (wantM - headerMonth)
    : 0;
  const buttons = Array.from(root.querySelectorAll('button, [role="button"]')).filter(visible);
  const nextBtn = buttons.find((b) => /next month|下个月|后一个月/i.test(b.getAttribute('aria-label') || ''));
  const prevBtn = buttons.find((b) => /previous month|last month|上个月|前一个月/i.test(b.getAttribute('aria-label') || ''));
  const cells = Array.from(root.querySelectorAll('[role="gridcell"]')).filter(visible);
  let dayEl = null;
  const dayCandidates = [];
  for (const el of cells) {
    const aria = el.getAttribute('aria-label') || '';
    const inner = String(el.innerText || '').trim();
    const named = ymdFromAria(aria);
    const disabled = el.getAttribute('aria-disabled') === 'true' || el.hasAttribute('disabled');
    const cls = String(el.className || '');
    let outside = /outside|other-month|muted|not-current/i.test(cls);
    const st = getComputedStyle(el);
    if (Number(st.opacity) < 0.45) outside = true;
    if (named && headerMonth && (named.month !== headerMonth || named.year !== headerYear)) outside = true;
    const day = named ? named.day : Number(inner.replace(/^0+/, '') || '0');
    if (day !== wantD) continue;
    if (disabled || outside) continue;
    dayCandidates.push(el);
  }
  if (dayCandidates.length === 1) dayEl = dayCandidates[0];
  const spins = Array.from(root.querySelectorAll('[role="spinbutton"], input[type="number"], input[inputmode="numeric"]'))
    .filter(visible)
    .sort((a, b) => a.getBoundingClientRect().x - b.getBoundingClientRect().x);
  if (spins.length < 2) {
    const tiny = Array.from(root.querySelectorAll('input')).filter((el) => {
      if (!visible(el) || spins.includes(el)) return false;
      const b = el.getBoundingClientRect();
      return b.width > 8 && b.width < 90 && b.height < 48;
    }).sort((a, b) => a.getBoundingClientRect().x - b.getBoundingClientRect().x);
    for (const el of tiny) {
      if (!spins.includes(el)) spins.push(el);
    }
  }
  const hourEl = spins[0] || null;
  const minuteEl = spins[1] || spins[0] || null;
  function stamp(el, ref) {
    if (!el) return null;
    try { el.setAttribute('data-spark-ref', ref); } catch (_) {}
    return { ref, ...pt(el), tag: el.tagName, role: el.getAttribute('role') || '', aria: el.getAttribute('aria-label') || '' };
  }
  const rr = root.getBoundingClientRect();
  const outside = { x: Math.max(8, rr.x - 12), y: Math.max(8, rr.y - 12) };
  let triggerText = '';
  if (opts.triggerRef) {
    try {
      const t = document.querySelector('[data-spark-ref="' + CSS.escape(String(opts.triggerRef)) + '"]');
      if (t) triggerText = String(t.innerText || '').trim();
    } catch (_) {}
  }
  return JSON.parse(JSON.stringify({
    ok: true,
    open: true,
    header,
    headerYear,
    headerMonth,
    steps,
    next: nextBtn ? { ...pt(nextBtn), label: nextBtn.getAttribute('aria-label') || 'Next month' } : null,
    prev: prevBtn ? { ...pt(prevBtn), label: prevBtn.getAttribute('aria-label') || 'Previous month' } : null,
    day: dayEl ? { ...pt(dayEl), name: dayEl.getAttribute('aria-label') || dayEl.innerText } : null,
    dayCount: dayCandidates.length,
    hours: stamp(hourEl, 'spark-cal-hour'),
    minutes: stamp(minuteEl, 'spark-cal-minute'),
    outside,
    triggerText,
    hasTime: /Time \\(in 24h\\)/i.test(body),
  }));
})`;

/** 目的地 / 城市输入框（携程、高德一类联想控件）。 */
export const FIND_DEST_INPUT_SCRIPT = `() => {
  const re = /目的地|城市|位置|酒店名称|destination|city|where to/i;
  const els = Array.from(document.querySelectorAll('input, textarea, [role="combobox"], [contenteditable="true"]'));
  for (const el of els) {
    const st = getComputedStyle(el);
    const b = el.getBoundingClientRect();
    if (b.width < 8 || b.height < 8 || st.display === 'none' || st.visibility === 'hidden') continue;
    const blob = [
      el.getAttribute('placeholder') || '',
      el.getAttribute('aria-label') || '',
      el.getAttribute('name') || '',
      el.getAttribute('id') || '',
      el.className || '',
    ].join(' ');
    if (!re.test(blob)) continue;
    try { el.setAttribute('data-spark-ref', 'dest-input'); } catch (_) {}
    return { ok: true, ref: 'dest-input', placeholder: el.getAttribute('placeholder') || '' };
  }
  return { ok: false, message: 'no destination input' };
}`;

/** 点开联想列表里包含 query 的一项。 */
export const PICK_SUGGEST_SCRIPT = `(query) => {
  const q = String(query || '').trim();
  if (!q) return { ok: false, message: 'empty suggest query' };
  const nodes = Array.from(document.querySelectorAll(
    '[role="option"], li, [class*="suggest"] a, [class*="suggest"] li, [class*="auto"] li, [class*="AutoComplete"] li, [class*="city"] li'
  ));
  const vis = nodes.filter((el) => {
    const st = getComputedStyle(el);
    const b = el.getBoundingClientRect();
    return b.width > 12 && b.height > 12 && st.display !== 'none' && st.visibility !== 'hidden' && Number(st.opacity) !== 0;
  });
  const textOf = (el) => String(el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
  const hit =
    vis.find((el) => textOf(el).includes(q)) ||
    vis.find((el) => q.includes(textOf(el).slice(0, 4)) && textOf(el).length >= 2);
  if (!hit) return { ok: false, message: 'no suggestion for ' + q, count: vis.length };
  try { hit.setAttribute('data-spark-ref', 'suggest-hit'); } catch (_) {}
  return { ok: true, ref: 'suggest-hit', text: textOf(hit).slice(0, 80) };
}`;

export const SET_SPIN_SCRIPT = `(function(ref, value){
  const el = document.querySelector('[data-spark-ref="' + String(ref || '') + '"]');
  if (!el) return { ok: false, message: 'spin not found' };
  const v = String(value);
  try { el.focus(); } catch (_) {}
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value') && Object.getOwnPropertyDescriptor(proto, 'value').set;
    if (setter) setter.call(el, v); else el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true, value: String(el.value || '') };
  }
  el.textContent = v;
  try {
    el.setAttribute('aria-valuenow', v);
  } catch (_) {}
  el.dispatchEvent(new InputEvent('input', { bubbles: true, data: v }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return { ok: true, value: v };
})`;

/** 住宿列表里抽出可点开的酒店详情链接。 */
export const EXTRACT_HOTEL_LINKS_SCRIPT = `() => {
  function abs(href) {
    try { return new URL(href, location.href).href; } catch (_) { return ''; }
  }
  function fromCtripNext() {
    try {
      const list = window.__NEXT_DATA__
        && window.__NEXT_DATA__.props
        && window.__NEXT_DATA__.props.pageProps
        && window.__NEXT_DATA__.props.pageProps.initListData
        && window.__NEXT_DATA__.props.pageProps.initListData.hotelList;
      if (!Array.isArray(list) || !list.length) return [];
      const page = new URL(location.href);
      const checkin = page.searchParams.get('checkin') || page.searchParams.get('checkIn') || '';
      const checkout = page.searchParams.get('checkout') || page.searchParams.get('checkOut') || '';
      const out = [];
      for (const row of list) {
        const info = (row && row.hotelInfo) || {};
        const id = String((info.summary && info.summary.hotelId) || '');
        const name = String((info.nameInfo && info.nameInfo.name) || '').replace(/\\s+/g, ' ').trim();
        if (!id || !name || name.length > 80) continue;
        const q = new URLSearchParams();
        if (checkin) q.set('checkIn', checkin);
        if (checkout) q.set('checkOut', checkout);
        const room = (row.roomInfo && row.roomInfo[0]) || {};
        const price = String((room.priceInfo && (room.priceInfo.displayPrice || room.priceInfo.price)) || '');
        const score = String((info.commentInfo && info.commentInfo.commentScore) || '');
        const area = String((info.positionInfo && (info.positionInfo.positionDesc || ((info.positionInfo.zoneNames || [])[0] || ''))) || '');
        out.push({
          name,
          url: 'https://hotels.ctrip.com/hotels/' + id + '.html' + (q.toString() ? '?' + q.toString() : ''),
          price: price.replace(/\\s+/g, ''),
          score,
          area: area.replace(/\\s+/g, ' ').trim(),
        });
        if (out.length >= 12) break;
      }
      return out;
    } catch (_) {
      return [];
    }
  }
  const nextHotels = fromCtripNext();
  if (nextHotels.length) return { ok: true, hotels: nextHotels };
  function isDetail(href) {
    const h = abs(href);
    if (!h || /javascript:|mailto:|#/.test(h)) return false;
    let u;
    try { u = new URL(h); } catch (_) { return false; }
    const p = u.pathname.toLowerCase();
    if (/\\/(login|signup|signin)/.test(p)) return false;
    if (/hotels?\\/list|searchresults|\\/hotellist|\\/hotels\\/all-cities|\\/s\\/[^/]+\\/homes?$/.test(p)) return false;
    if (/\\/hotels\\/?$/.test(p)) return false;
    if (/\\/flights?\\//.test(p)) return false;
    return /(?:hotels?\\/\\d|\\/hotel\\/\\d|hotelid=|hotel-detail|\\/rooms\\/\\d)/i.test(u.href);
  }
  function clean(s) {
    return String(s || '').replace(/\\s+/g, ' ').trim();
  }
  function nameOf(a) {
    const card = a.closest('[class*="hotel" i], [class*="property" i], [class*="Hotel"], article, li, [data-hotel], [data-id]');
    if (card) {
      const h = card.querySelector('h2, h3, h4, [class*="name" i], [class*="title" i]');
      const t = clean(h && (h.innerText || h.textContent));
      if (t.length >= 2 && t.length <= 80) return t;
    }
    const t = clean(a.getAttribute('aria-label') || a.innerText || a.textContent);
    return t.length >= 2 && t.length <= 80 ? t : '';
  }
  const seen = new Set();
  const out = [];
  const anchors = Array.from(document.querySelectorAll('a[href]'));
  for (const a of anchors) {
    const href = a.getAttribute('href') || '';
    if (!isDetail(href)) continue;
    const url = abs(href);
    const key = url.split('?')[0];
    if (seen.has(key)) continue;
    const r = a.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    const name = nameOf(a);
    if (!name || /登录|注册|地图|筛选|更多|查看全部|全部酒店|List|Map|Filter|Homes|All hotels/i.test(name)) continue;
    seen.add(key);
    out.push({ name, url });
    if (out.length >= 8) break;
  }
  return { ok: true, hotels: out };
}`;

/** 飞书网页：登录 / 消息 / 汇报。 */
export const FEISHU_STAGE_SCRIPT = `(() => {
  const url = String(location.href || "");
  const text = String((document.body && document.body.innerText) || "").slice(0, 5000);
  const login =
    /accounts\\.feishu|passport\\.feishu|\\/login|accounts\\.larksuite/i.test(url) ||
    /扫码登录|短信登录|账号登录|登录飞书/.test(text);
  const journal = /\\/report|汇报|写日志|写日报|写周报/.test(url + text);
  const doc = /\\/docx|\\/docs|\\/wiki|\\/drive/.test(url);
  const messenger = /\\/next\\/messenger|\\/messenger|larksuite\\.com\\/messenger/i.test(url);
  const boxes = Array.from(
    document.querySelectorAll('[contenteditable="true"], textarea, [role="textbox"]'),
  ).filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 40 && r.height > 16;
  });
  let stage = "other";
  if (login) stage = "login";
  else if (journal) stage = "journal";
  else if (doc) stage = "doc";
  else if (messenger || boxes.length) stage = "messenger";
  return {
    ok: true,
    stage,
    url,
    composer: boxes.length > 0,
    login,
  };
})()`;

export const FEISHU_OPEN_CHAT_SCRIPT = `(async (payload) => {
  const name = String((payload && payload.to) || "").trim();
  if (!name) return { ok: false, message: "缺少联系人" };
  function visible(el) {
    const r = el.getBoundingClientRect();
    const st = window.getComputedStyle(el);
    return r.width > 8 && r.height > 8 && st.visibility !== "hidden" && st.display !== "none";
  }
  function setVal(el, text) {
    el.focus();
    if (el.isContentEditable) {
      document.execCommand("selectAll", false, null);
      document.execCommand("insertText", false, text);
      el.dispatchEvent(new InputEvent("input", { bubbles: true, data: text, inputType: "insertText" }));
      return;
    }
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && desc.set) desc.set.call(el, text);
    else el.value = text;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const nodes = Array.from(document.querySelectorAll("input, textarea, [contenteditable='true']"));
  const search = nodes.find((el) => {
    if (!visible(el)) return false;
    const hint = (
      el.getAttribute("placeholder") ||
      el.getAttribute("aria-label") ||
      el.getAttribute("title") ||
      ""
    );
    return /搜索|search|联系人|聊天|找人/i.test(hint);
  }) || nodes.find((el) => visible(el) && el.tagName === "INPUT");
  if (!search) return { ok: false, message: "找不到飞书搜索框，请先点左侧搜索" };
  setVal(search, name);
  await sleep(700);
  const hits = Array.from(document.querySelectorAll("span, div, a, [role='option'], [role='listitem']"))
    .filter((el) => {
      if (!visible(el)) return false;
      const t = String(el.textContent || "").replace(/\\s+/g, " ").trim();
      return t === name || (t.includes(name) && t.length <= name.length + 24);
    });
  const hit = hits.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0];
  if (!hit) return { ok: false, message: "没找到联系人「" + name + "」，请你在左侧点开会话" };
  hit.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
  return { ok: true, message: "已点开 " + name };
})`;

export const FEISHU_INJECT_TEXT_SCRIPT = `(async (payload) => {
  const text = String((payload && payload.body) || "");
  const title = String((payload && payload.title) || "");
  if (!text && !title) return { ok: false, message: "没有可写入的正文" };
  function visible(el) {
    const r = el.getBoundingClientRect();
    const st = window.getComputedStyle(el);
    return r.width > 40 && r.height > 18 && st.visibility !== "hidden" && st.display !== "none";
  }
  function write(el, value) {
    el.focus();
    if (el.isContentEditable) {
      document.execCommand("selectAll", false, null);
      document.execCommand("insertText", false, value);
      if (!(el.innerText || "").includes(String(value).slice(0, Math.min(8, value.length)))) {
        el.textContent = value;
      }
      el.dispatchEvent(new InputEvent("input", { bubbles: true, data: value, inputType: "insertText" }));
      return (el.innerText || "").length;
    }
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return String(el.value || "").length;
  }
  const boxes = Array.from(
    document.querySelectorAll('[contenteditable="true"], textarea, [role="textbox"]'),
  ).filter(visible);
  if (!boxes.length) return { ok: false, message: "找不到输入框。请先点开会话或日志编辑区。" };
  boxes.sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom);
  let titleLen = 0;
  if (title && boxes.length >= 2) {
    const top = [...boxes].sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0];
    titleLen = write(top, title);
  }
  const composer = boxes[0];
  const bodyLen = write(composer, text || title);
  return {
    ok: true,
    message: "已写入草稿，未点发送",
    titleLen,
    bodyLen,
  };
})`;


