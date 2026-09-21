// GnG Price Book — Selections: shortlist approved catalog pages for a client and share one PDF from the phone.
// Pages come from the data repo (pages/<ref>.pdf, synced by the studio); the cover is drawn here with the brand fonts
// (assets/fonts/*, assets/logo-full.png); pages/closing.pdf is the brand's closing page. Merged with pdf-lib in the browser.
// Working basket: localStorage 'gng-selection'. Saved selections: selections/<id>.json in the data repo (page-written; the studio never touches them).
(function () {
  const S = () => window.PB;
  const KEY = 'gng-selection';
  const PDFLIB = 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js';
  const FONTKIT = 'https://cdn.jsdelivr.net/npm/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js';
  const MM = 72 / 25.4;
  const NAVY = [16 / 255, 40 / 255, 80 / 255], GOLD = [201 / 255, 160 / 255, 90 / 255], BONE = [246 / 255, 242 / 255, 233 / 255], CREAM = [232 / 255, 217 / 255, 188 / 255];

  let sel = { client: '', items: [], cover: true, closing: true };
  try { const d = JSON.parse(localStorage.getItem(KEY) || 'null'); if (d && Array.isArray(d.items)) sel = { cover: true, closing: true, ...d }; } catch (e) {}
  let picking = false, saved = null;     // saved: selections/*.json loaded on demand

  const $ = s => document.querySelector(s); const esc = s => S().esc(s); const toast = t => S().setStatus(t);
  const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'selection';
  const monthYear = () => new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const findItem = ref => S().items().find(i => i.ref === ref);

  function stash() { try { localStorage.setItem(KEY, JSON.stringify(sel)); } catch (e) {} badge(); }
  function badge() { if (S() && S().selBadge) S().selBadge(sel.items.length ? `Selection · ${sel.items.length}` : null); }

  // ---------- adding ----------
  function add(item) {
    if (item.status !== 'final') return `${item.title} is still a draft — approve it in the studio before sharing`;
    if (!item.page) return `${item.title} has no shareable page yet — run /studio run and push`;
    if (sel.items.includes(item.ref)) return `${item.title} is already in the selection`;
    sel.items.push(item.ref); stash();
    return `Added ${item.title} to the selection (${sel.items.length} page${sel.items.length === 1 ? '' : 's'})`;
  }
  function addFromItem(item) { toast(add(item)); }
  function pick() {
    S().viewEl().innerHTML = ''; picking = true;
    S().picker({ text: `Selection for ${sel.client || 'client'}: tap pages to add, or type a ref and Find`, done: () => { picking = false; S().picker(null); open(); } });
    S().showList();
  }
  function onPick(item) { if (!picking) return false; toast(add(item)); return true; }

  // ---------- the selection view ----------
  async function open() {
    picking = false; S().picker(null);
    const v = S().viewEl(); S().listEl().hidden = true;
    const rows = sel.items.map((ref, i) => {
      const it = findItem(ref);
      const gone = !it || it.status !== 'final' || !it.page;
      return `<div class="row sel-row" data-i="${i}">${it && it.photo ? `<img data-photo="${esc(it.photo)}" alt="">` : '<div class="noimg"></div>'}<div><div class="t">${esc(it ? it.title : 'Ref. ' + ref)}</div><div class="s">${esc(it ? it.project_name || it.project : '')}${gone ? ' · <span style="color:var(--warn)">no longer shareable — remove</span>' : ''}</div></div><div class="sel-btns"><button type="button" class="ghost small" data-a="up" ${i === 0 ? 'disabled' : ''} aria-label="Move up">▲</button><button type="button" class="ghost small" data-a="down" ${i === sel.items.length - 1 ? 'disabled' : ''} aria-label="Move down">▼</button><button type="button" class="ghost small" data-a="rm" aria-label="Remove">✕</button></div></div>`;
    }).join('');
    v.innerHTML = `<div class="item edit"><div class="body">
      <h3>Selection</h3><p class="desc">A shortlist of catalog pages for one client: cover, the pages in order, closing page. Shared as one PDF.</p>
      <div class="field"><label for="selClient">Client / enquiry (cover: "Prepared for ...")</label><input id="selClient" type="text" value="${esc(sel.client)}" placeholder="e.g. Acme Ltd"></div>
      <div class="list" style="margin-top:6px">${rows || '<div class="empty">No pages yet. Browse the Price Book and tap pages, or use Add to selection on any item.</div>'}</div>
      <div class="actions"><button type="button" class="ghost small" id="selBrowse">Browse Price Book</button></div>
      <div class="toggle"><label><input type="checkbox" id="selCover" ${sel.cover ? 'checked' : ''}> Cover page</label><label style="margin-left:14px"><input type="checkbox" id="selClosing" ${sel.closing ? 'checked' : ''}> Closing page</label></div>
      <div class="actions">
        <button type="button" id="selShare" ${sel.items.length ? '' : 'disabled'}>Share PDF</button>
        <button type="button" class="ghost" id="selSave" ${sel.items.length ? '' : 'disabled'}>Save</button>
        <button type="button" class="ghost" id="selClear" ${sel.items.length || sel.client ? '' : 'disabled'}>Clear</button>
        <button type="button" class="ghost" id="selBack">Back to list</button>
      </div>
      <div class="status" id="selMsg"></div>
      <h4 class="sec">Saved selections</h4>
      <div id="selSaved" class="list" style="margin-top:0"><div class="empty">Loading…</div></div>
    </div></div>`;
    S().gh.hydratePhotos(v);
    const msg = (t, err) => { const m = $('#selMsg'); m.textContent = t; m.classList.toggle('err', !!err); };
    $('#selClient').addEventListener('input', e => { sel.client = e.target.value.trim(); stash(); });
    $('#selCover').onchange = e => { sel.cover = e.target.checked; stash(); };
    $('#selClosing').onchange = e => { sel.closing = e.target.checked; stash(); };
    v.querySelectorAll('.sel-row button').forEach(b => b.onclick = ev => {
      ev.stopPropagation(); const i = +b.closest('.sel-row').dataset.i; const a = b.dataset.a;
      if (a === 'rm') sel.items.splice(i, 1);
      if (a === 'up' && i > 0) [sel.items[i - 1], sel.items[i]] = [sel.items[i], sel.items[i - 1]];
      if (a === 'down' && i < sel.items.length - 1) [sel.items[i + 1], sel.items[i]] = [sel.items[i], sel.items[i + 1]];
      stash(); open();
    });
    $('#selBrowse').onclick = pick;
    $('#selBack').onclick = () => { v.innerHTML = ''; S().showList(); };
    $('#selClear').onclick = () => { if ($('#selClear').dataset.armed) { sel = { client: '', items: [], cover: true, closing: true }; stash(); open(); return; } $('#selClear').dataset.armed = '1'; $('#selClear').textContent = 'Confirm clear'; setTimeout(() => { const b = $('#selClear'); if (b) { delete b.dataset.armed; b.textContent = 'Clear'; } }, 4000); };
    $('#selShare').onclick = async () => {
      $('#selShare').disabled = true;
      try { await share(msg); } catch (e) { msg('Could not build the PDF: ' + e.message, true); }
      if ($('#selShare')) $('#selShare').disabled = false;
    };
    $('#selSave').onclick = async () => {
      $('#selSave').disabled = true;
      try { const id = await save(); msg('Saved as ' + id); saved = null; renderSaved(); } catch (e) { msg('Could not save: ' + e.message, true); }
      if ($('#selSave')) $('#selSave').disabled = false;
    };
    renderSaved();
  }

  async function renderSaved() {
    const host = $('#selSaved'); if (!host) return;
    try {
      if (!saved) {
        const names = (await S().gh.list('selections')).filter(n => n.endsWith('.json'));
        saved = (await Promise.all(names.map(n => S().gh.getJson('selections/' + n)))).filter(Boolean).sort((a, b) => (b.updated || '').localeCompare(a.updated || ''));
      }
    } catch (e) { host.innerHTML = `<div class="empty">Could not load: ${esc(e.message)}</div>`; return; }
    if (!$('#selSaved')) return;
    host.innerHTML = saved.length ? saved.map(s => `<div class="row sel-saved" data-id="${esc(s.id)}"><div class="inv-ico">PDF</div><div><div class="t">${esc(s.client || s.id)}</div><div class="s">${s.items.length} page${s.items.length === 1 ? '' : 's'} · ${esc((s.updated || '').slice(0, 10))}</div></div><div class="ref">open</div></div>`).join('') : '<div class="empty">None saved yet.</div>';
    host.querySelectorAll('.sel-saved').forEach(r => r.onclick = () => { const s = saved.find(x => x.id === r.dataset.id); if (!s) return; sel = { client: s.client || '', items: s.items.slice(), cover: s.cover !== false, closing: s.closing !== false, id: s.id }; stash(); open(); toast('Loaded ' + (s.client || s.id)); });
  }

  async function save() {
    if (!sel.items.length) throw new Error('add at least one page');
    const id = sel.id || slug(sel.client || 'selection') + '-' + new Date().toISOString().slice(0, 10);
    const doc = { id, client: sel.client, items: sel.items.slice(), cover: sel.cover, closing: sel.closing, updated: new Date().toISOString() };
    await S().gh.putJson('selections/' + id + '.json', doc, `Selection: ${sel.client || id}`);
    sel.id = id; stash();
    return id;
  }

  // ---------- PDF ----------
  const loadScript = src => new Promise((res, rej) => { if ([...document.scripts].some(s => s.src === src)) return res(); const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('could not load ' + src)); document.head.appendChild(s); });
  async function libs() { await loadScript(PDFLIB); await loadScript(FONTKIT); if (!window.PDFLib || !window.fontkit) throw new Error('PDF library did not load (offline?)'); }

  // brand type: uppercase labels are letter-spaced; pdf-lib has no tracking, so draw glyph by glyph
  function trackedWidth(font, text, size, track) { return [...text].reduce((w, ch) => w + font.widthOfTextAtSize(ch, size), 0) + Math.max(0, text.length - 1) * track * size; }
  function drawTracked(page, font, text, size, track, y, color) {
    const w = trackedWidth(font, text, size, track); let x = (page.getWidth() - w) / 2;
    for (const ch of text) { page.drawText(ch, { x, y, size, font, color }); x += font.widthOfTextAtSize(ch, size) + track * size; }
  }
  function wrap(font, text, size, maxW) {
    const words = text.split(/\s+/), lines = []; let cur = '';
    for (const w of words) { const t = cur ? cur + ' ' + w : w; if (font.widthOfTextAtSize(t, size) > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }
    if (cur) lines.push(cur); return lines;
  }

  async function coverPage(pdf, fonts, logoBytes) {
    const { rgb } = PDFLib;
    const page = pdf.addPage([210 * MM, 297 * MM]); const W = page.getWidth(), H = page.getHeight();
    page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: rgb(...NAVY) });
    const client = (sel.client || '').trim();
    const label = (client ? 'Prepared for' : 'A selection').toUpperCase(), date = monthYear().toUpperCase();
    const logoW = 72 * MM; const logo = await pdf.embedPng(logoBytes); const logoH = logoW * logo.height / logo.width;
    const nameLines = client ? wrap(fonts.bodoni, client, 24, 140 * MM) : [];
    // stack, top to bottom (mm): logo, 14, hairline, 8, label(7.5pt), [4, name lines], 6, date(7pt) — centred on the page like the studio template
    const nameH = nameLines.length ? 4 * MM + nameLines.length * 24 * 1.25 : 0;
    const total = logoH + 14 * MM + 8 * MM + 7.5 + nameH + 6 * MM + 7;
    let y = (H + total) / 2;                                   // top edge of the stack
    page.drawImage(logo, { x: (W - logoW) / 2, y: y - logoH, width: logoW, height: logoH }); y -= logoH + 14 * MM;
    page.drawLine({ start: { x: (W - 34 * MM) / 2, y }, end: { x: (W + 34 * MM) / 2, y }, thickness: 0.25, color: rgb(...GOLD) }); y -= 8 * MM + 7.5;
    drawTracked(page, fonts.light, label, 7.5, 0.40, y, rgb(...BONE));
    if (nameLines.length) { y -= 4 * MM; for (const ln of nameLines) { y -= 24 * 1.25; const w = fonts.bodoni.widthOfTextAtSize(ln, 24); page.drawText(ln, { x: (W - w) / 2, y: y + 24 * 0.25, size: 24, font: fonts.bodoni, color: rgb(...BONE) }); } }
    y -= 6 * MM + 7;
    drawTracked(page, fonts.light, date, 7, 0.20, y, rgb(...CREAM));
  }

  async function build(msg) {
    const gh = S().gh;
    const items = sel.items.map(ref => ({ ref, it: findItem(ref) }));
    const bad = items.filter(x => !x.it || x.it.status !== 'final' || !x.it.page);
    if (bad.length) throw new Error('remove the pages marked "no longer shareable" first (' + bad.map(x => x.ref).join(', ') + ')');
    msg('Loading PDF tools…'); await libs();
    const { PDFDocument } = PDFLib;
    const out = await PDFDocument.create(); out.registerFontkit(fontkit);
    if (sel.cover) {
      msg('Drawing the cover…');
      const [b1, b2, logo] = await Promise.all([gh.bytes('assets/fonts/BodoniModa-Regular.ttf'), gh.bytes('assets/fonts/Montserrat-Light.ttf'), gh.bytes('assets/logo-full.png')]);
      if (!b1 || !b2 || !logo) throw new Error('cover assets are missing from the data repo — run /studio run and push');
      const fonts = { bodoni: await out.embedFont(b1, { subset: true }), light: await out.embedFont(b2, { subset: true }) };
      await coverPage(out, fonts, logo);
    }
    let n = 0;
    for (const { ref, it } of items) {
      msg(`Adding page ${++n} of ${items.length}…`);
      const bytes = await gh.bytes(it.page); if (!bytes) throw new Error(`page for ${it.title} (Ref. ${ref}) is not in the data repo yet — push the sync from the studio`);
      const src = await PDFDocument.load(bytes); const pages = await out.copyPages(src, src.getPageIndices()); pages.forEach(p => out.addPage(p));
    }
    if (sel.closing) {
      const bytes = await gh.bytes('pages/closing.pdf');
      if (bytes) { const src = await PDFDocument.load(bytes); const pages = await out.copyPages(src, src.getPageIndices()); pages.forEach(p => out.addPage(p)); }
      else msg('No closing page in the data repo yet — skipped');
    }
    out.setTitle(`Gifts N' Glam — ${sel.client || 'a selection'}`); out.setAuthor("Gifts N' Glam");
    return out.save();
  }

  async function share(msg) {
    const bytes = await build(msg);
    const name = `Gifts N Glam - ${(sel.client || 'Selection').replace(/[\\/:*?"<>|']+/g, '')} - ${new Date().toISOString().slice(0, 10)}.pdf`;
    const file = new File([bytes], name, { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); msg(`Shared ${name} (${(bytes.length / 1048576).toFixed(1)} MB)`); return; }
      catch (e) { if (e.name === 'AbortError') { msg('Share cancelled'); return; } }
    }
    const url = URL.createObjectURL(file); const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    msg(`Downloaded ${name} — share it from your files (${(bytes.length / 1048576).toFixed(1)} MB)`);
  }

  window.Selections = { open, addFromItem, onPick, stash, badge, current: () => sel, _build: build };
})();
