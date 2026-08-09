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
    '[aria-haspopup]',
    '[contenteditable="true"]',
    '[contenteditable=""]',
  ].join(', ');

  const PORTAL_ROOTS = [
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
      el.closest('.ant-dropdown') ||
      el.closest('.ant-select-dropdown') ||
      el.closest('.ant-cascader-dropdown') ||
      el.closest('.el-popper') ||
      el.closest('.el-select-dropdown') ||
      el.closest('[data-portal]')
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
      'li, button, a, [role="menuitem"], [role="option"], .ant-dropdown-menu-item, .ant-select-item-option, .el-dropdown-menu__item',
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
  iframes.forEach((iframe, i) => {
    try {
      const idoc = iframe.contentDocument;
      if (!idoc) return;
      const frameSel = iframe.id
        ? ('iframe#' + CSS.escape(iframe.id))
        : ('iframe:nth-of-type(' + (i + 1) + ')');
      const box = iframe.getBoundingClientRect();
      const framed = collectFromDocument(idoc, 'f' + i + '.', frameSel, box.x, box.y);
      for (const item of framed) elements.push(item);
    } catch (_) {
      // cross-origin — skip
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
  const root = document.getElementById('app') || document.body || document.documentElement;
  let text = '';
  try { text = root ? String(root.innerText || root.textContent || '') : ''; } catch (_) { text = ''; }
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
  const hit = sparkResolve(ref, selector);
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
  const hit = sparkResolve(ref, selector);
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
  const want = String(text || '').trim();
  if (!want) return { ok: false, message: 'empty text' };
  const roots = withinPortal
    ? Array.from(document.querySelectorAll('.ant-dropdown, .ant-select-dropdown, .el-popper, [data-portal]'))
        .filter((r) => {
          const st = getComputedStyle(r);
          const box = r.getBoundingClientRect();
          return st.display !== 'none' && !r.classList.contains('ant-dropdown-hidden') && box.width > 0;
        })
    : [document];
  let best = null;
  let bestEl = null;
  for (const root of roots) {
    const scope = root === document ? document : root;
    const candidates = Array.from(scope.querySelectorAll('a,button,span,div,li,label,[role=menuitem],[role=button],[role=option],.ant-dropdown-menu-item,.ant-select-item-option,.img-options-action-btn'));
    for (const el of candidates) {
      const t = (el.innerText || el.textContent || '').trim().replace(/\\s+/g, ' ');
      if (!t || t.length > want.length + 40) continue;
      const match = exact ? t === want : (t === want || t.includes(want));
      if (!match) continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      const st = getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) continue;
      const inView = r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
      // Prefer in-viewport; heavily penalize off-screen (Electron click is viewport-local)
      const score =
        Math.abs(r.width * r.height - 1800) +
        (t === want || t.endsWith(want) ? 0 : 80) +
        t.length +
        (inView ? 0 : 100000);
      if (!best || score < best.score) {
        best = {
          score,
          tag: el.tagName,
          text: t.slice(0, 60),
          x: r.x + r.width / 2,
          y: r.y + r.height / 2,
          w: r.width,
          h: r.height,
          inView: inView,
          inPortal: !!(el.closest && (el.closest('.ant-dropdown') || el.closest('.ant-select-dropdown') || el.closest('.el-popper'))),
        };
        bestEl = el;
      }
    }
  }
  if (!best || !bestEl) return { ok: false, message: 'text not found: ' + want };
  try {
    bestEl.scrollIntoView({ block: 'center', inline: 'nearest' });
  } catch (_) {}
  const r2 = bestEl.getBoundingClientRect();
  best.x = r2.x + r2.width / 2;
  best.y = r2.y + r2.height / 2;
  best.w = r2.width;
  best.h = r2.height;
  best.inView = r2.bottom > 0 && r2.top < window.innerHeight;
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
  const roots = Array.from(document.querySelectorAll('.ant-dropdown, .ant-select-dropdown, .el-popper, .el-select-dropdown, [data-portal]'));
  const out = [];
  for (const root of roots) {
    const st = getComputedStyle(root);
    const r = root.getBoundingClientRect();
    if (st.display === 'none' || st.visibility === 'hidden') continue;
    if (root.classList.contains('ant-dropdown-hidden') || root.classList.contains('ant-select-dropdown-hidden')) continue;
    if (r.width <= 0 || r.height <= 0) continue;
    const items = Array.from(root.querySelectorAll('li, .ant-dropdown-menu-item, .ant-select-item-option, [role=menuitem], [role=option]'))
      .map((el) => {
        const box = el.getBoundingClientRect();
        if (box.width <= 0 || box.height <= 0) return null;
        return (el.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 60);
      })
      .filter(Boolean);
    out.push({
      cls: String(root.className).slice(0, 80),
      x: Math.round(r.x),
      y: Math.round(r.y),
      w: Math.round(r.width),
      h: Math.round(r.height),
      items: items.slice(0, 30),
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
  const push = (action, target, extra) => {
    if (!window.__sparkRecording) return;
    const el = target;
    let selector = '';
    try {
      if (el && el.id) selector = '#' + CSS.escape(el.id);
      else if (el && el.getAttribute && el.getAttribute('data-spark-ref')) selector = '[data-spark-ref="' + el.getAttribute('data-spark-ref') + '"]';
      else if (el && el.tagName) selector = el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).trim().split(/\\s+/).slice(0,2).join('.') : '');
    } catch (_) {}
    const r = el && el.getBoundingClientRect ? el.getBoundingClientRect() : null;
    window.__sparkTrace.push({
      i: window.__sparkTrace.length + 1,
      action: action,
      selector: selector,
      text: el && (el.innerText || el.value || '').toString().trim().slice(0, 80) || undefined,
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
