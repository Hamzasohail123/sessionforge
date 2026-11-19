// Isolated-world page scripts and the Zod schemas their results must match (design §10.0–10.6). Pure.
// Scripts are strings; arguments are embedded with JSON.stringify, which yields a JS literal that
// cannot break out. The renderer is untrusted, so main parses every result with its schema.
import { z } from 'zod'

const Coord = z.number().finite().min(-100_000).max(100_000)

export const SCRIPT_FAIL_CODES = [
  'stale_ref',
  'not_found',
  'disabled',
  'not_visible_element',
  'obscured',
  'not_editable',
  'not_a_select',
  'option_not_found',
  'invalid_arguments'
] as const
export type ScriptFailCode = (typeof SCRIPT_FAIL_CODES)[number]

export const ScriptFail = z.object({
  ok: z.literal(false),
  code: z.enum(SCRIPT_FAIL_CODES),
  pageText: z.string().max(2000).optional()
})

export const PrepareResult = z.union([
  z.object({ ok: z.literal(true), x: Coord, y: Coord, isPassword: z.boolean(), editable: z.boolean() }),
  ScriptFail
])
export const SnapshotResult = z.object({
  title: z.string().max(400),
  url: z.string().max(8192),
  lines: z.array(z.string().max(400)).max(1500),
  next: z.number().int().min(0).max(1e9),
  truncated: z.number().int().min(0),
  visited: z.number().int().min(0)
})
export const SelectResult = z.union([
  z.object({ ok: z.literal(true), selected: z.array(z.string().max(500)).max(50) }),
  ScriptFail
])
export const FocusResult = z.union([z.object({ ok: z.literal(true) }), ScriptFail])
export const ProbeResult = z.boolean()
export const ValueResult = z.object({ value: z.string().max(10_000), isPassword: z.boolean() })

export type Target = { ref: string } | { selector: string }

/** Helpers shared by every script: state, deep query, ref resolution, accessible names. */
const COMMON = String.raw`
const st = window.__sfAgent;
const clean = (s, n) => { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s };
const frameDoc = (el) => { try { return el.contentDocument } catch (e) { return null } };
const isFrame = (el) => el.localName === 'iframe' || el.localName === 'frame';
const deepQuery = (root, sel) => {
  const direct = root.querySelector(sel); if (direct) return direct;
  for (const el of root.querySelectorAll('*')) {
    if (el.shadowRoot) { const f = deepQuery(el.shadowRoot, sel); if (f) return f }
    if (isFrame(el)) { const d = frameDoc(el); if (d) { const f = deepQuery(d, sel); if (f) return f } }
  }
  return null;
};
const resolveTarget = (T) => {
  if (T.ref) {
    const w = st && st.refs.get(T.ref); const el = w && w.deref();
    if (!el || !el.isConnected) return { fail: 'stale_ref' };
    return { el };
  }
  let found = null;
  try { found = deepQuery(document, T.selector) } catch (e) { return { fail: 'invalid_arguments' } }
  return found ? { el: found } : { fail: 'not_found' };
};
const TEXT_TYPES = ['text', 'email', 'url', 'tel', 'search', 'password', 'number', ''];
const inputType = (el) => (el.getAttribute('type') || 'text').toLowerCase();
const isEditable = (el) => {
  if (el.localName === 'textarea') return !el.readOnly;
  if (el.localName === 'input') return TEXT_TYPES.includes(inputType(el)) && !el.readOnly;
  if (el.isContentEditable) return true;
  return (el.getAttribute('role') || '') === 'textbox';
};
const isPassword = (el) => el.localName === 'input' && inputType(el) === 'password';
const nameOf = (el) => {
  const doc = el.ownerDocument; let n = '';
  const lb = el.getAttribute('aria-labelledby');
  if (lb) n = lb.split(/\s+/).map((id) => { const t = doc.getElementById(id); return t ? t.textContent : '' }).join(' ');
  if (!n.trim()) n = el.getAttribute('aria-label') || '';
  if (!n.trim() && el.labels && el.labels.length) n = Array.from(el.labels).map((l) => l.textContent).join(' ');
  if (!n.trim()) n = el.getAttribute('alt') || '';
  if (!n.trim()) n = el.getAttribute('title') || '';
  if (!n.trim()) n = el.getAttribute('placeholder') || '';
  const tag = el.localName;
  if (!n.trim() && tag !== 'input' && tag !== 'select' && tag !== 'textarea') n = el.innerText || el.textContent || '';
  if (!n.trim() && tag === 'input' && ['submit', 'button', 'reset'].includes(inputType(el))) n = el.value || '';
  return clean(n, 80);
};
`

export function snapshotScript(opts: { base: number; interactiveOnly: boolean; maxChars: number }): string {
  return String.raw`(() => {
const BASE = ${JSON.stringify(opts.base)}; const ONLY = ${JSON.stringify(opts.interactiveOnly)};
const MAX_CHARS = ${JSON.stringify(opts.maxChars)}; const MAX_LINES = 1500; const MAX_VISIT = 20000;
if (!window.__sfAgent) window.__sfAgent = { ids: new WeakMap(), refs: new Map(), next: BASE };
${COMMON}
const refOf = (el) => { let r = st.ids.get(el); if (!r) { r = 'e' + st.next++; st.ids.set(el, r); st.refs.set(r, new WeakRef(el)) } return r };
const q = (s) => JSON.stringify(s);
const SKIP = new Set(['script', 'style', 'noscript', 'template', 'head', 'meta', 'link', 'title']);
const INTERACTIVE = new Set(['link', 'button', 'textbox', 'searchbox', 'spinbutton', 'checkbox', 'radio', 'slider', 'combobox', 'listbox', 'switch', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option']);
const LANDMARK = new Set(['navigation', 'main', 'banner', 'contentinfo', 'complementary', 'form', 'dialog', 'alertdialog', 'alert', 'status', 'region', 'search']);
const IMPLICIT = { nav: 'navigation', main: 'main', header: 'banner', footer: 'contentinfo', aside: 'complementary', form: 'form', dialog: 'dialog', button: 'button', summary: 'button', textarea: 'textbox' };
const roleOf = (el) => {
  const explicit = (el.getAttribute('role') || '').trim().split(/\s+/)[0];
  if (explicit) return explicit.toLowerCase();
  const tag = el.localName;
  if (tag === 'a') return el.hasAttribute('href') ? 'link' : null;
  if (tag === 'input') {
    const t = inputType(el);
    if (t === 'hidden') return 'hidden';
    if (t === 'checkbox' || t === 'radio') return t;
    if (t === 'range') return 'slider';
    if (['submit', 'button', 'reset', 'image'].includes(t)) return 'button';
    if (t === 'number') return 'spinbutton';
    if (t === 'search') return 'searchbox';
    return 'textbox';
  }
  if (tag === 'select') return el.multiple || el.size > 1 ? 'listbox' : 'combobox';
  if (/^h[1-6]$/.test(tag)) return 'heading';
  if (tag === 'img') return el.getAttribute('alt') !== null ? 'img' : null;
  if (IMPLICIT[tag]) return IMPLICIT[tag];
  if (el.isContentEditable && el.hasAttribute('contenteditable')) return 'textbox';
  return null;
};
const hrefOf = (el) => {
  try { const u = new URL(el.getAttribute('href'), el.baseURI); return clean(u.origin === location.origin ? u.pathname + u.search + u.hash : u.href, 120) } catch (e) { return '' }
};
const stateOf = (el, role) => {
  const out = [];
  const tag = el.localName;
  if ((tag === 'input' && isEditable(el)) || tag === 'textarea') {
    if (isPassword(el)) out.push(el.value ? 'value=•••' : 'value=""');
    else out.push('value=' + q(clean(el.value, 80)));
  }
  if ((role === 'checkbox' || role === 'radio' || role === 'switch') && (el.checked || el.getAttribute('aria-checked') === 'true')) out.push('checked');
  if (el.disabled || el.getAttribute('aria-disabled') === 'true') out.push('disabled');
  const exp = el.getAttribute('aria-expanded'); if (exp === 'true' || exp === 'false') out.push('expanded=' + exp);
  if (tag === 'select') { const o = el.selectedOptions && el.selectedOptions[0]; out.push('selected=' + q(o ? clean(o.label || o.textContent, 80) : '')) }
  if (role === 'link' && el.hasAttribute('href')) out.push('-> ' + hrefOf(el));
  if (el.required) out.push('required');
  let invalid = el.getAttribute('aria-invalid') === 'true';
  try { invalid = invalid || el.matches(':user-invalid') } catch (e) {}
  if (invalid) out.push('invalid');
  return out.length ? ' ' + out.join(' ') : '';
};
const lines = []; let chars = 0; let visited = 0; let truncated = 0; let stopped = false; let over = false;
const emit = (depth, s) => {
  if (stopped) { truncated++; return }
  const line = ('  '.repeat(Math.min(depth, 20)) + s).slice(0, 400);
  if (lines.length >= MAX_LINES || chars + line.length + 1 > MAX_CHARS) { stopped = true; truncated++; return }
  lines.push(line); chars += line.length + 1;
};
const kids = (el) => {
  if (el.shadowRoot) return Array.from(el.shadowRoot.children);
  if (el.localName === 'slot') { const a = el.assignedElements({ flatten: true }); return a.length ? a : Array.from(el.children) }
  return Array.from(el.children);
};
const ownText = (el) => { let s = ''; for (const n of el.childNodes) if (n.nodeType === 3) s += n.textContent; return clean(s, 120) };
const visit = (el, depth, quiet) => {
  if (over) return;
  if (++visited > MAX_VISIT) { over = true; truncated++; return }
  const tag = el.localName;
  if (SKIP.has(tag)) return;
  if (el.getAttribute('aria-hidden') === 'true') return;
  if (typeof el.checkVisibility === 'function' && tag !== 'html' && tag !== 'body' && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return;
  if (tag === 'svg') {
    const t = el.querySelector('title'); const n = clean(el.getAttribute('aria-label') || (t ? t.textContent : ''), 80);
    if (n && !ONLY) emit(depth, '- img ' + q(n));
    return;
  }
  if (isFrame(el)) {
    const d = frameDoc(el);
    if (d && d.documentElement) {
      emit(depth, '- iframe ' + q(clean(el.getAttribute('title') || el.getAttribute('name') || '', 80)) + ' [ref=' + refOf(el) + ']');
      visit(d.documentElement, depth + 1, false);
    } else {
      let origin = ''; try { origin = new URL(el.src, location.href).origin } catch (e) {}
      emit(depth, '- iframe (cross-origin, not inspected) ' + origin);
    }
    return;
  }
  const role = roleOf(el);
  if (role === 'hidden') return;
  let next = depth; let q2 = quiet;
  if (role && INTERACTIVE.has(role)) {
    emit(depth, '- ' + role + ' ' + q(nameOf(el)) + ' [ref=' + refOf(el) + ']' + stateOf(el, role));
    q2 = true;
  } else if (role === 'heading') {
    const level = /^h([1-6])$/.exec(tag); const lv = level ? level[1] : (el.getAttribute('aria-level') || '2');
    emit(depth, '- heading ' + q(nameOf(el)) + ' [level=' + lv + ']');
    q2 = true;
  } else if (role && LANDMARK.has(role)) {
    const n = role === 'alert' || role === 'status' ? clean(el.innerText || '', 120) : clean(el.getAttribute('aria-label') || '', 80);
    emit(depth, '- ' + role + (n ? ' ' + q(n) : ''));
    next = depth + 1;
    if (role === 'alert' || role === 'status') q2 = true;
  } else if (role === 'img') {
    if (!ONLY) emit(depth, '- img ' + q(nameOf(el)));
  } else if (!quiet && !ONLY) {
    const t = ownText(el); if (t) emit(depth, '- text ' + q(t));
  }
  for (const c of kids(el)) visit(c, next, q2);
};
visit(document.documentElement, 0, false);
return { title: String(document.title || '').slice(0, 400), url: location.href.slice(0, 8192), lines, next: st.next, truncated, visited };
})()`
}

/** Resolve, check, scroll, wait for a stable box, hit-test; returns the centre in top-level CSS px. */
export function prepareActionScript(target: Target, opts: { force: boolean; needEditable: boolean }): string {
  return String.raw`(async () => {
const T = ${JSON.stringify(target)}; const FORCE = ${JSON.stringify(opts.force)}; const NEED_EDITABLE = ${JSON.stringify(opts.needEditable)};
${COMMON}
const r0 = resolveTarget(T); if (r0.fail) return { ok: false, code: r0.fail };
const el = r0.el;
if (el.disabled || el.getAttribute('aria-disabled') === 'true') return { ok: false, code: 'disabled' };
const editable = isEditable(el);
if (NEED_EDITABLE && !editable) return { ok: false, code: 'not_editable' };
el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
const frame = () => Promise.race([new Promise((r) => requestAnimationFrame(() => r(null))), new Promise((r) => setTimeout(r, 50))]);
const t0 = Date.now(); let prev = null; let box = el.getBoundingClientRect();
for (let i = 0; i < 10 && Date.now() - t0 < 300; i++) {
  await frame(); box = el.getBoundingClientRect();
  if (prev && prev.x === box.x && prev.y === box.y && prev.width === box.width && prev.height === box.height) break;
  prev = box;
}
if (box.width < 1 || box.height < 1) return { ok: false, code: 'not_visible_element' };
let x = box.left + box.width / 2; let y = box.top + box.height / 2;
let win = el.ownerDocument.defaultView;
while (win && win !== window && win.frameElement) {
  const fe = win.frameElement; const fr = fe.getBoundingClientRect(); const cs = getComputedStyle(fe);
  x += fr.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft);
  y += fr.top + parseFloat(cs.borderTopWidth) + parseFloat(cs.paddingTop);
  win = win.parent;
}
const deepHit = (px, py) => {
  let hit = document.elementFromPoint(px, py); let ox = 0; let oy = 0;
  for (let g = 0; hit && g < 20; g++) {
    if (hit.shadowRoot) { const inner = hit.shadowRoot.elementFromPoint(px - ox, py - oy); if (inner && inner !== hit) { hit = inner; continue } }
    if (isFrame(hit)) {
      const d = frameDoc(hit);
      if (d) {
        const fr = hit.getBoundingClientRect(); const cs = getComputedStyle(hit);
        ox += fr.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft);
        oy += fr.top + parseFloat(cs.borderTopWidth) + parseFloat(cs.paddingTop);
        const inner = d.elementFromPoint(px - ox, py - oy); if (inner) { hit = inner; continue }
      }
    }
    break;
  }
  return hit;
};
if (!FORCE) {
  const hit = deepHit(x, y);
  let ok = false;
  for (let n = hit; n; n = n.parentNode || n.host) { if (n === el) { ok = true; break } }
  if (!ok && hit) { const lab = hit.closest && hit.closest('label'); if (lab && lab.control === el) ok = true }
  if (!ok) return { ok: false, code: 'obscured', pageText: hit ? (hit.localName + ' ' + JSON.stringify(nameOf(hit))).slice(0, 300) : 'nothing' };
}
return { ok: true, x, y, isPassword: isPassword(el), editable };
})()`
}

/** Select the existing content of an editable element so inserted text replaces it. */
export function selectContentScript(target: Target): string {
  return String.raw`(() => {
const T = ${JSON.stringify(target)};
${COMMON}
const r0 = resolveTarget(T); if (r0.fail) return { ok: false, code: r0.fail };
const el = r0.el;
if (el.localName === 'input' || el.localName === 'textarea') { el.focus(); el.select(); return { ok: true } }
const doc = el.ownerDocument; const range = doc.createRange(); range.selectNodeContents(el);
const sel = doc.defaultView.getSelection(); sel.removeAllRanges(); sel.addRange(range);
return { ok: true };
})()`
}

export function focusScript(target: Target): string {
  return String.raw`(() => {
const T = ${JSON.stringify(target)};
${COMMON}
const r0 = resolveTarget(T); if (r0.fail) return { ok: false, code: r0.fail };
r0.el.focus(); return { ok: true };
})()`
}

export function valueScript(target: Target): string {
  return String.raw`(() => {
const T = ${JSON.stringify(target)};
${COMMON}
const r0 = resolveTarget(T); if (r0.fail) return { value: '', isPassword: false };
const el = r0.el;
const v = el.localName === 'input' || el.localName === 'textarea' ? el.value : (el.innerText || '');
return { value: String(v).slice(0, 10000), isPassword: isPassword(el) };
})()`
}

export function selectScript(target: Target, values: string[]): string {
  return String.raw`(() => {
const T = ${JSON.stringify(target)}; const VALUES = ${JSON.stringify(values)};
${COMMON}
const r0 = resolveTarget(T); if (r0.fail) return { ok: false, code: r0.fail };
const el = r0.el;
if (el.localName !== 'select') return { ok: false, code: 'not_a_select' };
if (!el.multiple && VALUES.length > 1) return { ok: false, code: 'invalid_arguments' };
const opts = Array.from(el.options); const picked = [];
for (const v of VALUES) {
  const o = opts.find((x) => x.value === v) || opts.find((x) => clean(x.label || x.textContent, 500).toLowerCase() === v.trim().toLowerCase());
  if (!o) return { ok: false, code: 'option_not_found', pageText: opts.slice(0, 20).map((x) => clean(x.label || x.textContent, 80)).join(', ').slice(0, 2000) };
  picked.push(o);
}
for (const o of opts) o.selected = picked.includes(o);
el.dispatchEvent(new Event('input', { bubbles: true }));
el.dispatchEvent(new Event('change', { bubbles: true }));
return { ok: true, selected: picked.map((o) => String(o.value).slice(0, 500)) };
})()`
}

/** wait_for probe: visible text (shadow roots and same-origin iframes) or a visible deep selector. */
export function probeScript(probe: { text: string } | { selector: string }): string {
  return String.raw`(() => {
const P = ${JSON.stringify(probe)};
${COMMON}
if (P.selector !== undefined) {
  let el = null; try { el = deepQuery(document, P.selector) } catch (e) { return false }
  return !!el && (typeof el.checkVisibility !== 'function' || el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }));
}
const has = (root) => {
  const body = root.body || root;
  const own = body.innerText !== undefined ? body.innerText : Array.from(body.children || []).map((c) => c.innerText || '').join('\n');
  if (own && own.includes(P.text)) return true;
  for (const el of root.querySelectorAll('*')) {
    if (el.shadowRoot && has(el.shadowRoot)) return true;
    if (isFrame(el)) { const d = frameDoc(el); if (d && d.body && has(d)) return true }
  }
  return false;
};
return has(document);
})()`
}
