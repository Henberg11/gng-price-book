// GnG Price Book — proforma invoices and invoices.
// Data (private repo): settings/business.json, clients/<id>.json, invoices/<number>.json. Every save is a commit.
// Loaded before the main script; the main script exposes window.PB and calls into window.Invoices.
(function () {
  const S = () => window.PB;              // bridge to the main page (gh, items, prices, helpers)
  const FY = d => { const y = d.getFullYear(), m = d.getMonth() + 1; const a = m >= 4 ? y : y - 1; return `${a}-${String(a + 1).slice(2)}`; };
  const today = () => new Date().toISOString().slice(0, 10);
  const fmtDate = s => { if (!s) return '—'; const [y, m, d] = s.split('-'); return `${d}/${m}/${y}`; };
  const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'client';
  const r2 = v => Math.round((v + Number.EPSILON) * 100) / 100;
  const INR = v => (v < 0 ? '−' : '') + '₹' + Math.abs(Number(v || 0)).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const NL = String.fromCharCode(10);
  const STATES = ['Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Delhi','Goa','Gujarat','Haryana','Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh','Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Punjab','Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh','Uttarakhand','West Bengal','Chandigarh','Jammu and Kashmir','Ladakh','Puducherry','Andaman and Nicobar Islands','Dadra and Nagar Haveli and Daman and Diu','Lakshadweep'];

  const DEFAULT_BUSINESS = { name: "Gifts N' Glam", tagline: 'Curated by Priyal Parekh', address: 'Ahmedabad, Gujarat', state: 'Gujarat', phone: '', email: '', gstin: '',
    bank: { name: '', account: '', ifsc: '', upi: '' }, terms: 'Payment within 7 days of the invoice date. Goods once sold are not returnable. Delivery pan-India; charges as quoted.', proforma_note: 'This proforma is a quotation. Please confirm the order and make the advance payment to the account below; the tax invoice follows on dispatch.' };

  let business = null, clients = {}, invoices = {}, loaded = false, editing = null, picking = false;
  const DRAFT_KEY = 'gng-working-draft';
  try { const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); if (d && d.number) editing = d; } catch (e) {}   // restore an unsaved draft on load

  // ---------- amount in words (Indian system) ----------
  const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = n => n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '');
  const three = n => (n >= 100 ? ONES[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' : '') : '') + (n % 100 ? two(n % 100) : '');
  function words(n) {
    n = Math.round(n); if (!n) return 'Zero';
    const parts = []; const cr = Math.floor(n / 1e7); n %= 1e7; const lk = Math.floor(n / 1e5); n %= 1e5; const th = Math.floor(n / 1000); n %= 1000;
    if (cr) parts.push(three(cr) + ' Crore'); if (lk) parts.push(two(lk) + ' Lakh'); if (th) parts.push(two(th) + ' Thousand'); if (n) parts.push(three(n));
    return parts.join(' ');
  }
  const inWords = v => `Rupees ${words(Math.floor(v))}${Math.round((v % 1) * 100) ? ' and ' + two(Math.round((v % 1) * 100)) + ' Paise' : ''} only`;

  // ---------- maths ----------
  function calc(inv) {
    const lines = (inv.lines || []).map(l => ({ ...l, qty: +l.qty || 0, unit: +l.unit || 0, total: r2((+l.qty || 0) * (+l.unit || 0)) }));
    const subtotal = r2(lines.reduce((a, l) => a + l.total, 0));
    const d = inv.discount || {}; const discount = r2(d.type === 'pct' ? subtotal * (+d.value || 0) / 100 : (+d.value || 0));
    const after = r2(subtotal - discount);
    const rate = +(inv.gst && inv.gst.rate) || 0; const inclusive = inv.gst && inv.gst.mode === 'inclusive';
    let taxable, tax, gross;
    if (!rate) { taxable = after; tax = 0; gross = after; }
    else if (inclusive) { gross = after; taxable = r2(after / (1 + rate / 100)); tax = r2(gross - taxable); }
    else { taxable = after; tax = r2(after * rate / 100); gross = r2(after + tax); }
    const inter = rate && business && inv.client && inv.client.state && business.state && inv.client.state.trim().toLowerCase() !== business.state.trim().toLowerCase();
    const total = Math.round(gross); const roundoff = r2(total - gross);
    return { lines, subtotal, discount, after, rate, inclusive, taxable, tax, inter, half: r2(tax / 2), gross, roundoff, total };
  }

  // ---------- data ----------
  async function load(force) {
    if (loaded && !force) return;
    const gh = S().gh;
    business = (await gh.getJson('settings/business.json')) || { ...DEFAULT_BUSINESS };
    const [cn, inn] = await Promise.all([gh.list('clients'), gh.list('invoices')]);
    clients = {}; invoices = {};
    await Promise.all(cn.filter(n => n.endsWith('.json')).map(async n => { const c = await gh.getJson('clients/' + n); if (c) clients[n.slice(0, -5)] = c; }));
    await Promise.all(inn.filter(n => n.endsWith('.json')).map(async n => { const i = await gh.getJson('invoices/' + n); if (i) invoices[i.number] = i; }));
    loaded = true;
    badge();
  }
  function nextNumber(type) {
    const fy = FY(new Date()); const prefix = (type === 'invoice' ? 'INV' : 'PI') + '-' + fy + '-';
    const n = Object.keys(invoices).filter(k => k.startsWith(prefix)).map(k => +k.slice(prefix.length)).filter(x => !isNaN(x));
    return prefix + String((n.length ? Math.max(...n) : 0) + 1).padStart(3, '0');
  }
  const saveInvoice = async inv => { inv.updated = new Date().toISOString(); await S().gh.putJson('invoices/' + inv.number + '.json', inv, `${inv.type === 'invoice' ? 'Invoice' : 'Proforma'} ${inv.number}`); invoices[inv.number] = inv; };
  const saveClient = async c => { const id = c.id || slug(c.name); c.id = id; await S().gh.putJson('clients/' + id + '.json', c, `Client: ${c.name}`); clients[id] = c; return id; };

  // ---------- working draft (survives navigation and reloads; cleared on Save / Discard) ----------
  function stash() {
    if (document.querySelector('#iLines')) read();            // editor is on screen: pull the fields into `editing`
    try { if (editing) localStorage.setItem(DRAFT_KEY, JSON.stringify(editing)); else localStorage.removeItem(DRAFT_KEY); } catch (e) {}
    badge();
  }
  function clearDraft() { editing = null; try { localStorage.removeItem(DRAFT_KEY); } catch (e) {} badge(); }
  function badge() { if (S() && S().badge) S().badge(editing ? `${editing.number} · ${(editing.lines || []).filter(l => l.name).length} line${(editing.lines || []).filter(l => l.name).length === 1 ? '' : 's'}` : null); }
  const current = () => editing;

  // ---------- views ----------
  const $ = s => document.querySelector(s); const esc = s => S().esc(s);
  function host() { stash(); const v = S().viewEl(); v.innerHTML = ''; S().listEl().hidden = true; picking = false; S().picker(null); return v; }
  const toast = t => S().setStatus(t);

  async function open() {
    const v = host(); v.innerHTML = '<div class="empty">Loading invoices…</div>';
    try { await load(true); } catch (e) { v.innerHTML = `<div class="empty">Could not load: ${esc(e.message)}</div>`; return; }
    renderList();
  }

  function renderList() {
    const v = host();
    const list = Object.values(invoices).sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.number.localeCompare(a.number));
    const rows = list.map(i => { const c = calc(i); return `<div class="row inv-row" data-n="${esc(i.number)}"><div class="inv-ico ${i.type}">${i.type === 'invoice' ? 'INV' : 'PI'}</div><div><div class="t">${esc(i.client && i.client.name || '—')}</div><div class="s">${esc(i.number)} · ${fmtDate(i.date)} · <span class="st st-${esc(i.status || 'draft')}">${esc(i.status || 'draft')}</span></div></div><div class="ref">${INR(c.total)}</div></div>`; }).join('');
    v.innerHTML = `<div class="item"><div class="body">
      <h3>Invoices</h3>
      ${editing ? `<div class="actions"><button type="button" id="invResume">Continue ${esc(editing.number)}${editing.client && editing.client.name ? ' · ' + esc(editing.client.name) : ''}</button><button type="button" class="ghost" id="invDrop">Discard draft</button></div>` : ''}
      <div class="actions"><button type="button" id="invNewPI" class="${editing ? 'ghost' : ''}">New proforma</button><button type="button" id="invNewINV" class="${editing ? 'ghost' : ''}">New invoice</button><button type="button" class="ghost" id="invBiz">Business details</button></div>
      ${business.gstin ? '' : '<div class="foot">No GSTIN on file, so documents are made without GST. Add it under Business details once registered.</div>'}
      <div class="list" style="margin-top:14px">${rows || '<div class="empty">No documents yet.</div>'}</div>
    </div></div>`;
    if (editing) { $('#invResume').onclick = () => renderEditor(editing); $('#invDrop').onclick = () => { clearDraft(); renderList(); }; }
    $('#invNewPI').onclick = () => renderEditor(newDoc('proforma'));
    $('#invNewINV').onclick = () => renderEditor(newDoc('invoice'));
    $('#invBiz').onclick = renderBusiness;
    v.querySelectorAll('.inv-row').forEach(r => r.onclick = () => renderEditor(JSON.parse(JSON.stringify(invoices[r.dataset.n]))));
  }

  function newDoc(type) {
    return { number: nextNumber(type), type, date: today(), status: 'draft', client: { name: '', address: '', gstin: '', state: business.state || '', phone: '', email: '' },
      lines: [], discount: { type: 'amt', value: 0 },
      gst: { mode: 'exclusive', rate: 0 }, notes: '', terms: business.terms, created: new Date().toISOString() };
  }

  // add a Price Book item to a document (qty merges into an existing line with the same ref)
  function addItem(doc, item, qty) {
    qty = +qty || 1;
    const price = S().prices()[item.ref]; const unit = price && price.sale != null ? price.sale : '';
    const ex = (doc.lines || []).find(l => l.ref && l.ref === item.ref);
    let msg;
    if (ex) { ex.qty = (+ex.qty || 0) + qty; msg = `${item.title}: quantity now ${ex.qty} on ${doc.number}`; }
    else { doc.lines = doc.lines || []; doc.lines.push({ ref: item.ref, name: item.title, hsn: '', qty, unit, note: '' }); msg = `Added ${item.title} to ${doc.number}`; }
    if (unit === '') msg += ' — no sale price yet, fill in the unit price';
    if (item.status === 'draft') msg += ' — catalog page not approved yet';
    return msg;
  }

  // ---------- "Add to document" sheet, opened from an item page ----------
  async function addFromItem(item) {
    if (!loaded) { toast('Loading…'); try { await load(); } catch (e) { toast('Could not load invoices: ' + e.message); return; } toast(''); }
    const drafts = Object.values(invoices).filter(i => i.status === 'draft' && !(editing && i.number === editing.number)).sort((a, b) => b.number.localeCompare(a.number)).slice(0, 5);
    const sheet = document.createElement('div'); sheet.className = 'sheet-bg';
    sheet.innerHTML = `<div class="sheet"><h3>Add to document</h3><p class="desc">${esc(item.title)} · Ref. ${esc(item.ref)}</p>
      <div class="field"><label for="shQty">Quantity</label><input id="shQty" type="text" inputmode="numeric" value="1"></div>
      <div class="sheet-btns">
        ${editing ? `<button type="button" data-t="current">Add to ${esc(editing.number)}${editing.client && editing.client.name ? ' · ' + esc(editing.client.name) : ''}</button>` : ''}
        ${drafts.map(d => `<button type="button" class="ghost" data-t="${esc(d.number)}">Add to ${esc(d.number)}${d.client && d.client.name ? ' · ' + esc(d.client.name) : ''}</button>`).join('')}
        <button type="button" class="${editing ? 'ghost' : ''}" data-t="new-proforma">New proforma</button>
        <button type="button" class="${editing ? 'ghost' : ''}" data-t="new-invoice">New invoice</button>
        <button type="button" class="ghost" data-t="cancel">Cancel</button>
      </div></div>`;
    document.body.appendChild(sheet);
    sheet.addEventListener('click', e => { if (e.target === sheet) sheet.remove(); });
    sheet.querySelectorAll('button').forEach(b => b.onclick = () => {
      const t = b.dataset.t; const qty = S().num(sheet.querySelector('#shQty').value) || 1; sheet.remove();
      if (t === 'cancel') return;
      if (t === 'new-proforma') editing = newDoc('proforma');
      else if (t === 'new-invoice') editing = newDoc('invoice');
      else if (t !== 'current') { if (editing) stash(); editing = JSON.parse(JSON.stringify(invoices[t])); }
      const msg = addItem(editing, item, qty); stash(); toast(msg);
    });
  }

  // ---------- picker mode: browse the Price Book from the editor ----------
  function pick() {
    if (!editing) return;
    stash(); S().viewEl().innerHTML = ''; picking = true;      // editor DOM gone: later stash() cannot re-read stale rows
    S().picker({ text: `Adding to ${editing.number}: tap an item, or type a ref and Find`, done: () => { picking = false; S().picker(null); renderEditor(editing); } });
    S().showList();
  }
  function onPick(item) { if (!picking || !editing) return false; toast(addItem(editing, item, 1)); try { localStorage.setItem(DRAFT_KEY, JSON.stringify(editing)); } catch (e) {} badge(); return true; }

  function lineRow(l) {
    return `<tr class="ln"><td><input type="text" class="l-ref" value="${esc(l.ref || '')}" placeholder="Ref" inputmode="numeric" style="width:64px"></td>
      <td><input type="text" class="l-name" value="${esc(l.name || '')}" placeholder="Description"></td>
      <td><input type="text" class="l-hsn" value="${esc(l.hsn || '')}" placeholder="HSN" style="width:70px"></td>
      <td><input type="text" class="n l-qty" inputmode="decimal" value="${l.qty ?? 1}" style="width:56px"></td>
      <td><input type="text" class="n l-unit" inputmode="decimal" value="${l.unit ?? ''}" style="width:90px"></td>
      <td class="n l-total" style="white-space:nowrap">—</td>
      <td><button type="button" class="del" aria-label="Remove">✕</button></td></tr>
      <tr class="ln-note"><td colspan="7"><input type="text" class="l-note" value="${esc(l.note || '')}" placeholder="Customisation for this line (optional) — e.g. client logo on the box lid, printed in gold"></td></tr>`;
  }

  function renderEditor(inv) {
    editing = inv; stash(); const v = host(); const isInv = inv.type === 'invoice';
    const clientOpts = Object.values(clients).sort((a, b) => a.name.localeCompare(b.name)).map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
    const stateOpts = STATES.map(s => `<option value="${s}" ${s === (inv.client.state || '') ? 'selected' : ''}>${s}</option>`).join('');
    const lines = inv.lines && inv.lines.length ? inv.lines : [{ ref: '', name: '', hsn: '', qty: 1, unit: '', note: '' }];
    v.innerHTML = `<div class="item edit"><div class="body">
      <h3>${isInv ? 'Invoice' : 'Proforma invoice'} <span class="sub" style="font-family:Montserrat,sans-serif;font-size:13px;color:var(--muted)">· ${esc(inv.number)}</span></h3>
      ${inv.proforma_ref ? `<p class="desc">Converted from ${esc(inv.proforma_ref)}</p>` : ''}
      <div class="field two"><div><label for="iDate">Date</label><input id="iDate" type="date" value="${esc(inv.date)}"></div><div><label for="iStatus">Status</label><select id="iStatus">${['draft', 'sent', 'accepted', 'paid', 'cancelled'].map(s => `<option ${s === inv.status ? 'selected' : ''}>${s}</option>`).join('')}</select></div></div>

      <h4 class="sec">Client</h4>
      <div class="field"><label for="cPick">Saved clients</label><select id="cPick"><option value="">— new client —</option>${clientOpts}</select></div>
      <div class="field two"><div><label for="cName">Name</label><input id="cName" type="text" value="${esc(inv.client.name)}"></div><div><label for="cGstin">Client GSTIN</label><input id="cGstin" type="text" value="${esc(inv.client.gstin || '')}"></div></div>
      <div class="field"><label for="cAddr">Address</label><textarea id="cAddr" rows="2">${esc(inv.client.address || '')}</textarea></div>
      <div class="field two"><div><label for="cState">State (place of supply)</label><select id="cState"><option value="">—</option>${stateOpts}</select></div><div><label for="cPhone">Phone / email</label><input id="cPhone" type="text" value="${esc(inv.client.phone || '')}"></div></div>

      <h4 class="sec">Items</h4>
      <div class="tbl"><table id="iLines"><thead><tr><th>Ref</th><th>Description</th><th>HSN</th><th class="n">Qty</th><th class="n">Unit ₹</th><th class="n">Total</th><th></th></tr></thead>
      <tbody>${lines.map(lineRow).join('')}</tbody></table></div>
      <div class="actions"><button type="button" class="ghost small" id="iAdd">+ Add line</button><button type="button" class="ghost small" id="iBrowse">Browse Price Book</button></div>
      <div class="foot">Type a catalog reference in Ref and the name and sale price fill in, or browse the Price Book and tap items. Leave Ref empty for delivery, customisation or any free line. The customisation note prints under the description.</div>

      <h4 class="sec">Totals</h4>
      <div class="field two"><div><label for="dType">Discount</label><select id="dType"><option value="amt" ${inv.discount.type !== 'pct' ? 'selected' : ''}>Amount ₹</option><option value="pct" ${inv.discount.type === 'pct' ? 'selected' : ''}>Percent %</option></select></div><div><label for="dVal">Discount value</label><input id="dVal" type="text" inputmode="decimal" value="${inv.discount.value || ''}"></div></div>
      <div class="field two"><div><label for="gRate">GST</label><select id="gRate" ${business.gstin ? '' : 'disabled title="Add your GSTIN under Business details first"'}>${[0, 5, 12, 18, 28].map(r => `<option value="${r}" ${r === +(inv.gst.rate || 0) ? 'selected' : ''}>${r ? r + '%' : 'No GST'}</option>`).join('')}</select></div><div><label for="gMode">Prices are</label><select id="gMode"><option value="exclusive" ${inv.gst.mode !== 'inclusive' ? 'selected' : ''}>Exclusive of GST</option><option value="inclusive" ${inv.gst.mode === 'inclusive' ? 'selected' : ''}>Inclusive of GST</option></select></div></div>
      <div class="totals" id="iTotals"></div>

      <div class="field"><label for="iNotes">Note to client (optional)</label><textarea id="iNotes" rows="2">${esc(inv.notes || '')}</textarea></div>
      <div class="field"><label for="iTerms">Terms</label><textarea id="iTerms" rows="3">${esc(inv.terms || '')}</textarea></div>

      <div class="actions">
        <button type="button" id="iSave">Save</button>
        <button type="button" class="ghost" id="iPrint">Print / PDF</button>
        ${!isInv ? '<button type="button" class="ghost" id="iConvert">Convert to invoice</button>' : ''}
        <button type="button" class="ghost" id="iBack">Back</button>
      </div>
      <div class="status" id="iStatusMsg"></div>
    </div></div>`;

    const wire = () => {
      v.querySelectorAll('#iLines .del').forEach(b => b.onclick = () => { const tr = b.closest('tr'); const nt = tr.nextElementSibling; tr.remove(); if (nt && nt.classList.contains('ln-note')) nt.remove(); totals(); });
      v.querySelectorAll('#iLines input').forEach(i => i.addEventListener('input', totals));
      v.querySelectorAll('#iLines .l-ref').forEach(i => i.addEventListener('change', () => lookup(i)));
    };
    const lookup = inp => {
      const ref = inp.value.trim().replace(/^0+/, ''); if (!ref) return;
      const it = S().items().find(x => x.ref.replace(/^0+/, '') === ref); if (!it) return;
      const tr = inp.closest('tr'); const pr = S().prices()[it.ref];
      inp.value = it.ref; tr.querySelector('.l-name').value = it.title; if (pr && pr.sale != null) tr.querySelector('.l-unit').value = pr.sale; totals();
    };
    const totals = () => {
      const inv = read(); const c = calc(inv);
      const trs = [...v.querySelectorAll('#iLines tbody tr.ln')]; let k = 0;
      trs.forEach(tr => { const named = tr.querySelector('.l-name').value.trim(); tr.querySelector('.l-total').textContent = named && c.lines[k] ? INR(c.lines[k++].total) : '—'; });
      $('#iTotals').innerHTML = totalsHtml(c, true);
    };
    $('#iAdd').onclick = () => { $('#iLines tbody').insertAdjacentHTML('beforeend', lineRow({ qty: 1 })); wire(); const rows = $('#iLines tbody').querySelectorAll('tr.ln'); rows[rows.length - 1].querySelector('input').focus(); };
    $('#iBrowse').onclick = pick;
    $('#cPick').onchange = e => { const c = clients[e.target.value]; if (!c) return; $('#cName').value = c.name; $('#cGstin').value = c.gstin || ''; $('#cAddr').value = c.address || ''; $('#cState').value = c.state || ''; $('#cPhone').value = c.phone || ''; totals(); };
    ['#dType', '#dVal', '#gRate', '#gMode', '#cState'].forEach(id => $(id).addEventListener('input', totals));
    $('#iBack').onclick = () => { stash(); renderList(); };
    $('#iSave').onclick = async () => { const inv = read(); const was = inv.number; $('#iSave').disabled = true; try { await persist(inv); if (inv.number !== was) { renderEditor(inv); } msg('Saved as ' + inv.number); } catch (e) { msg('Could not save: ' + e.message, true); } if ($('#iSave')) $('#iSave').disabled = false; };
    $('#iPrint').onclick = async () => { const inv = read(); try { await persist(inv); } catch (e) { msg('Saved locally only: ' + e.message, true); } printDoc(inv); };
    if (!isInv) $('#iConvert').onclick = async () => {
      const pi = read(); try { await persist(pi); } catch (e) { return msg('Save the proforma first: ' + e.message, true); }
      const inv = JSON.parse(JSON.stringify(pi)); inv.type = 'invoice'; inv.number = nextNumber('invoice'); inv.date = today(); inv.status = 'draft'; inv.proforma_ref = pi.number; inv.created = new Date().toISOString(); delete inv.updated;
      pi.status = pi.status === 'draft' || pi.status === 'sent' ? 'accepted' : pi.status; try { await saveInvoice(pi); } catch (e) {}
      renderEditor(inv); msg('Invoice ' + inv.number + ' created from ' + pi.number + '. Save when ready.');
    };
    const msg = (t, err) => { const m = $('#iStatusMsg'); m.textContent = t; m.classList.toggle('err', !!err); };
    wire(); totals();
  }

  function read() {
    const inv = editing;
    if (!document.querySelector('#iLines')) return inv;
    inv.date = $('#iDate').value; inv.status = $('#iStatus').value;
    inv.client = { name: $('#cName').value.trim(), gstin: $('#cGstin').value.trim(), address: $('#cAddr').value.trim(), state: $('#cState').value, phone: $('#cPhone').value.trim() };
    inv.lines = [...document.querySelectorAll('#iLines tbody tr.ln')].map(tr => { const nt = tr.nextElementSibling; return { ref: tr.querySelector('.l-ref').value.trim(), name: tr.querySelector('.l-name').value.trim(), hsn: tr.querySelector('.l-hsn').value.trim(), qty: S().num(tr.querySelector('.l-qty').value) ?? 1, unit: S().num(tr.querySelector('.l-unit').value) ?? 0, note: nt && nt.classList.contains('ln-note') ? nt.querySelector('.l-note').value.trim() : '' }; }).filter(l => l.name);
    inv.discount = { type: $('#dType').value, value: S().num($('#dVal').value) || 0 };
    inv.gst = { mode: $('#gMode').value, rate: business.gstin ? +$('#gRate').value : 0 };
    inv.notes = $('#iNotes').value.trim(); inv.terms = $('#iTerms').value.trim();
    return inv;
  }
  async function persist(inv) {
    if (!inv.client.name) throw new Error('client name is required');
    if (!inv.lines.length) throw new Error('add at least one line');
    // number clash: another device may have used this number since the list was loaded — check the live file, not the cached list
    for (let guard = 0; guard < 20; guard++) {
      const remote = await S().gh.getJson('invoices/' + inv.number + '.json');
      if (!remote || !remote.created || remote.created === inv.created) break;
      invoices[remote.number] = remote;
      const old = inv.number; inv.number = nextNumber(inv.type); toast(`${old} was already used on another device; this document is now ${inv.number}`);
    }
    const existing = Object.values(clients).find(c => c.name.toLowerCase() === inv.client.name.toLowerCase());
    const c = { ...(existing || {}), ...inv.client }; await saveClient(c);
    await saveInvoice(inv);
    clearDraft(); editing = inv; badge();      // saved: no longer an unsaved draft, but keep it as the open document
  }

  function totalsHtml(c, compact) {
    const rows = [['Subtotal', c.subtotal]];
    if (c.discount) rows.push(['Discount', -c.discount]);
    if (c.rate) {
      if (c.inclusive) rows.push([`Taxable value (GST ${c.rate}% included)`, c.taxable]);
      if (c.inter) rows.push([`IGST ${c.rate}%`, c.tax]); else { rows.push([`CGST ${c.rate / 2}%`, c.half]); rows.push([`SGST ${c.rate / 2}%`, c.half]); }
    }
    if (c.roundoff) rows.push(['Round off', c.roundoff]);
    return `<table class="tot"><tbody>${rows.map(([k, v]) => `<tr><td>${k}</td><td class="n">${INR(v)}</td></tr>`).join('')}<tr class="grand"><td>Total</td><td class="n">${INR(c.total)}</td></tr></tbody></table>${compact ? '' : `<div class="words">${esc(inWords(c.total))}</div>`}`;
  }

  // ---------- business details ----------
  function renderBusiness() {
    const v = host(); const b = business; const bank = b.bank || {};
    v.innerHTML = `<div class="item edit"><div class="body"><h3>Business details</h3><p class="desc">Printed on every document. Update the name and GSTIN once the company is registered.</p>
      <div class="field two"><div><label for="bName">Business name</label><input id="bName" type="text" value="${esc(b.name)}"></div><div><label for="bGstin">GSTIN (blank until registered)</label><input id="bGstin" type="text" value="${esc(b.gstin || '')}"></div></div>
      <div class="field"><label for="bTag">Line under the name</label><input id="bTag" type="text" value="${esc(b.tagline || '')}"></div>
      <div class="field"><label for="bAddr">Address</label><textarea id="bAddr" rows="2">${esc(b.address || '')}</textarea></div>
      <div class="field two"><div><label for="bState">State</label><select id="bState">${STATES.map(s => `<option ${s === b.state ? 'selected' : ''}>${s}</option>`).join('')}</select></div><div><label for="bPhone">Phone</label><input id="bPhone" type="text" value="${esc(b.phone || '')}"></div></div>
      <div class="field"><label for="bEmail">Email</label><input id="bEmail" type="text" value="${esc(b.email || '')}"></div>
      <h4 class="sec">Bank (shown on proformas)</h4>
      <div class="field two"><div><label for="kName">Bank and branch</label><input id="kName" type="text" value="${esc(bank.name || '')}"></div><div><label for="kAcc">Account number</label><input id="kAcc" type="text" value="${esc(bank.account || '')}"></div></div>
      <div class="field two"><div><label for="kIfsc">IFSC</label><input id="kIfsc" type="text" value="${esc(bank.ifsc || '')}"></div><div><label for="kUpi">UPI ID</label><input id="kUpi" type="text" value="${esc(bank.upi || '')}"></div></div>
      <div class="field"><label for="bTerms">Default terms</label><textarea id="bTerms" rows="3">${esc(b.terms || '')}</textarea></div>
      <div class="field"><label for="bPI">Proforma note</label><textarea id="bPI" rows="2">${esc(b.proforma_note || '')}</textarea></div>
      <div class="actions"><button type="button" id="bSave">Save</button><button type="button" class="ghost" id="bBack">Back</button></div><div class="status" id="bMsg"></div></div></div>`;
    $('#bBack').onclick = renderList;
    $('#bSave').onclick = async () => {
      business = { name: $('#bName').value.trim() || "Gifts N' Glam", tagline: $('#bTag').value.trim(), gstin: $('#bGstin').value.trim().toUpperCase(), address: $('#bAddr').value.trim(), state: $('#bState').value, phone: $('#bPhone').value.trim(), email: $('#bEmail').value.trim(),
        bank: { name: $('#kName').value.trim(), account: $('#kAcc').value.trim(), ifsc: $('#kIfsc').value.trim().toUpperCase(), upi: $('#kUpi').value.trim() }, terms: $('#bTerms').value.trim(), proforma_note: $('#bPI').value.trim() };
      $('#bSave').disabled = true;
      try { await S().gh.putJson('settings/business.json', business, 'Business details'); $('#bMsg').textContent = 'Saved'; } catch (e) { $('#bMsg').textContent = 'Could not save: ' + e.message; }
      $('#bSave').disabled = false;
    };
  }

  // ---------- the printed document (brand kit §10 "Document": bone ground, logo top, gold hairline, Bodoni + Montserrat, no bars, no boxes) ----------
  const br = s => esc(s).split(NL).join('<br>');
  function docHtml(inv) {
    const c = calc(inv); const b = business; const isInv = inv.type === 'invoice';
    const lines = c.lines.map((l, i) => `<tr><td class="n">${i + 1}</td><td>${esc(l.name)}${l.ref ? ` <span class="ref">Ref. ${esc(l.ref)}</span>` : ''}${l.note ? `<div class="d-lnote">${esc(l.note)}</div>` : ''}</td><td>${esc(l.hsn || '')}</td><td class="n">${l.qty % 1 ? l.qty : l.qty | 0}</td><td class="n">${INR(l.unit)}</td><td class="n">${INR(l.total)}</td></tr>`).join('');
    const bank = b.bank || {}; const hasBank = bank.account || bank.upi;
    return `
      <div class="d-head">
        <img src="${logoUrl}" alt="" class="d-logo">
        <div class="d-brand">${esc(b.name)}</div>
        ${b.tagline ? `<div class="d-tag">${esc(b.tagline)}</div>` : ''}
        <hr class="d-rule">
      </div>
      <div class="d-title">${isInv ? 'Tax invoice' : 'Proforma invoice'}</div>
      <div class="d-meta">
        <div><span>Number</span>${esc(inv.number)}</div><div><span>Date</span>${fmtDate(inv.date)}</div>
        ${inv.proforma_ref ? `<div><span>Against proforma</span>${esc(inv.proforma_ref)}</div>` : ''}
        ${b.gstin ? `<div><span>GSTIN</span>${esc(b.gstin)}</div>` : ''}
      </div>
      <div class="d-parties">
        <div><div class="d-lab">From</div><div class="d-name">${esc(b.name)}</div><div>${br(b.address || '')}</div>${b.phone ? `<div>${esc(b.phone)}</div>` : ''}${b.email ? `<div>${esc(b.email)}</div>` : ''}</div>
        <div><div class="d-lab">${isInv ? 'Billed to' : 'Prepared for'}</div><div class="d-name">${esc(inv.client.name)}</div><div>${br(inv.client.address || '')}</div>${inv.client.state ? `<div>${esc(inv.client.state)}</div>` : ''}${inv.client.gstin ? `<div>GSTIN ${esc(inv.client.gstin)}</div>` : ''}${inv.client.phone ? `<div>${esc(inv.client.phone)}</div>` : ''}</div>
      </div>
      <table class="d-lines"><thead><tr><th class="n">#</th><th>Description</th><th>HSN</th><th class="n">Qty</th><th class="n">Unit</th><th class="n">Amount</th></tr></thead><tbody>${lines}</tbody></table>
      <div class="d-totals">${totalsHtml(c, false)}</div>
      ${c.rate ? `<div class="d-note">Prices ${c.inclusive ? 'inclusive' : 'exclusive'} of GST. Place of supply: ${esc(inv.client.state || '—')}.</div>` : ''}
      ${inv.notes ? `<div class="d-note">${esc(inv.notes)}</div>` : ''}
      ${!isInv && b.proforma_note ? `<div class="d-note">${esc(b.proforma_note)}</div>` : ''}
      ${hasBank ? `<div class="d-block"><div class="d-lab">Payment</div>${bank.name ? `<div>${esc(bank.name)}</div>` : ''}${bank.account ? `<div>Account ${esc(bank.account)}${bank.ifsc ? ' · IFSC ' + esc(bank.ifsc) : ''}</div>` : ''}${bank.upi ? `<div>UPI ${esc(bank.upi)}</div>` : ''}</div>` : ''}
      <div class="d-foot">
        <div>${inv.terms ? `<div class="d-lab">Terms</div><div>${br(inv.terms)}</div>` : ''}</div>
        <div class="d-sign"><div class="space"></div><hr class="d-rule"><div>For ${esc(b.name)}</div><div class="d-lab">Authorised signatory</div></div>
      </div>`;
  }
  let logoUrl = '';
  async function printDoc(inv) {
    const doc = document.getElementById('doc');
    if (!logoUrl) { try { logoUrl = (await S().gh.photo('assets/logo.png')) || ''; } catch (e) {} }
    doc.innerHTML = docHtml(inv); doc.hidden = false; document.body.classList.add('printing');
    const done = () => { document.body.classList.remove('printing'); doc.hidden = true; window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    setTimeout(() => window.print(), 250);
  }

  window.Invoices = { open, calc, inWords, addFromItem, onPick, current, stash, resume: () => { if (editing) { if (!loaded) return open().then(() => renderEditor(editing)); renderEditor(editing); } else open(); }, _render: (inv, b, logo) => { business = b; logoUrl = logo; return docHtml(inv); } };
})();
