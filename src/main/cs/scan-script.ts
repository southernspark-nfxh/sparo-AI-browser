/**
 * Injected in page: detect chat-like UI, extract recent messages, stamp composer ref.
 */
export const CS_SCAN_SCRIPT = `(() => {
  const stamp = (el) => {
    if (!el) return null;
    let ref = el.getAttribute('data-spark-ref');
    if (!ref) {
      ref = 'cs' + Math.random().toString(36).slice(2, 9);
      el.setAttribute('data-spark-ref', ref);
    }
    return ref;
  };
  const visible = (el) => {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    const st = window.getComputedStyle(el);
    return r.width > 8 && r.height > 8 && st.visibility !== 'hidden' && st.display !== 'none';
  };
  const textOf = (el) => (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();

  let score = 0;
  const hints = [];

  // Composer candidates
  const composerCandidates = Array.from(document.querySelectorAll(
    'textarea, [contenteditable="true"], [contenteditable=""], input[type="text"], input:not([type])'
  )).filter(visible);

  const composerRe = /输入|回复|发送|说点什么|请输入|message|reply|type a message|写消息|和TA聊|留言|评论|写评论|发表评论|说点啥/i;
  let composer = null;
  for (const el of composerCandidates) {
    const ph = el.getAttribute('placeholder') || el.getAttribute('aria-label') || el.getAttribute('data-placeholder') || '';
    const cls = String(el.className || '');
    const id = String(el.id || '');
    let s = 0;
    if (composerRe.test(ph)) s += 40;
    if (composerRe.test(cls + ' ' + id)) s += 15;
    if (el.tagName === 'TEXTAREA') s += 10;
    if (el.isContentEditable) s += 8;
    if (s > (composer?.s || 0)) composer = { el, s, ph };
  }
  // Prefer bottom-most likely composer
  if (!composer && composerCandidates.length) {
    const bottom = [...composerCandidates].sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top)[0];
    composer = { el: bottom, s: 5, ph: bottom.getAttribute('placeholder') || '' };
  }
  if (composer) {
    score += Math.min(45, composer.s);
    hints.push('composer');
  }

  // Send button
  let sendLabel = null;
  const btns = Array.from(document.querySelectorAll('button, [role="button"], a')).filter(visible);
  for (const b of btns) {
    const t = textOf(b).slice(0, 20);
    if (/^(发送|Send|Reply|回复|发布|发表)$/i.test(t) || /^(发送|发布)/.test(t)) {
      sendLabel = t || '发送';
      score += 20;
      hints.push('send_btn');
      break;
    }
  }

  // Message-like nodes
  const msgSel = [
    '[class*="message"]', '[class*="msg"]', '[class*="bubble"]', '[class*="chat"]',
    '[class*="Message"]', '[class*="im-"]', '[data-role="message"]',
    '[class*="conversation"] li', '[role="log"] > *', '[role="listitem"]',
    '[class*="comment"]', '[class*="Comment"]', '[class*="reply"]', '[class*="Reply"]',
    '[class*="留言"]'
  ].join(',');
  let nodes = [];
  try { nodes = Array.from(document.querySelectorAll(msgSel)).filter(visible); } catch (_) {}
  if (nodes.length >= 2) {
    score += Math.min(25, nodes.length);
    hints.push('message_nodes:' + nodes.length);
  }

  const messages = [];
  const pushMsg = (role, text) => {
    const t = String(text || '').trim().slice(0, 500);
    if (!t || t.length < 1) return;
    if (messages.length && messages[messages.length - 1].text === t) return;
    messages.push({ role, text: t });
  };

  const agentRe = /客服|商家|我|店小二|assistant|agent|seller/i;
  const customerRe = /买家|客户|用户|visitor|customer|buyer/i;

  const take = nodes.slice(-40);
  for (const n of take) {
    const t = textOf(n);
    if (!t || t.length > 800) continue;
    // skip pure chrome
    if (/^(发送|表情|图片|视频|文件|更多)$/.test(t)) continue;
    const cls = String(n.className || '') + ' ' + (n.getAttribute('data-from') || '');
    let role = 'unknown';
    if (customerRe.test(cls) || /left|peer|other|in/.test(cls)) role = 'customer';
    else if (agentRe.test(cls) || /right|self|mine|out/.test(cls)) role = 'agent';
    pushMsg(role, t);
  }

  // Fallback: large text blocks near bottom half
  if (messages.length < 2) {
    const blocks = Array.from(document.querySelectorAll('p, li, div'))
      .filter(visible)
      .filter((el) => {
        const r = el.getBoundingClientRect();
        const t = textOf(el);
        return r.top > window.innerHeight * 0.15 && t.length >= 2 && t.length <= 300 && el.children.length <= 3;
      })
      .slice(-30);
    for (const el of blocks) pushMsg('unknown', textOf(el));
    if (blocks.length) hints.push('fallback_blocks');
  }

  // Cap & prefer last 20
  const trimmed = messages.slice(-20);
  let lastCustomerText = '';
  for (let i = trimmed.length - 1; i >= 0; i--) {
    if (trimmed[i].role === 'customer' || trimmed[i].role === 'unknown') {
      lastCustomerText = trimmed[i].text;
      break;
    }
  }
  if (!lastCustomerText && trimmed.length) lastCustomerText = trimmed[trimmed.length - 1].text;

  const looksLikeChat = score >= 25 || (Boolean(composer) && trimmed.length >= 1);

  let composerHit = null;
  if (composer?.el) {
    const ref = stamp(composer.el);
    composerHit = {
      ref,
      selector: '[data-spark-ref="' + ref + '"]',
      placeholder: composer.ph || '',
      tag: composer.el.tagName.toLowerCase(),
    };
  }

  return {
    ok: true,
    looksLikeChat,
    score,
    url: location.href,
    title: document.title || '',
    messages: trimmed,
    lastCustomerText: lastCustomerText || undefined,
    composer: composerHit,
    sendButtonLabel: sendLabel,
    hints,
  };
})()`;
