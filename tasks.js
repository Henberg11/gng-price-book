// GnG Price Book — Tasks: things to do, general or against a client, with a due date.
// Stored one file per task in the data repo: tasks/<id>.json (page-written; the studio never touches them).
// Reminders: this is a static page with no server, so it cannot push a notification by itself. Two things
// carry the reminder instead — the Tasks button badges whatever is due or overdue every time the Price Book
// is opened, and each dated task hands a calendar entry (.ics, with an alarm) to the phone's own calendar,
// which is the thing that actually rings.
(function () {
  const S = () => window.PB;
  const $ = s => document.querySelector(s);
  const esc = s => S().esc(s);
  const toast = (t, err) => S().setStatus(t, err);

  let tasks = {}, clients = {}, loaded = false, editing = null, filter = 'all';

  const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  const pad = n => String(n).padStart(2, '0');
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const addDays = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); const t = new Date(y, m - 1, d + n); return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`; };
  const dayGap = iso => { const [y, m, d] = iso.split('-').map(Number); const a = new Date(y, m - 1, d); const n = new Date(); const b = new Date(n.getFullYear(), n.getMonth(), n.getDate()); return Math.round((a - b) / 86400000); };
  const newId = () => new Date().toISOString().replace(/[-:T]/g, '').slice(0, 13) + '-' + Math.random().toString(36).slice(2, 6);

  function dueLabel(t) {
    if (!t.due) return 'no date';
    const g = dayGap(t.due);
    const time = t.time ? ' · ' + t.time : '';
    if (g < -1) return `${-g} days overdue` + time;
    if (g === -1) return 'yesterday' + time;
    if (g === 0) return 'today' + time;
    if (g === 1) return 'tomorrow' + time;
    const [y, m, d] = t.due.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) + time;
  }

  // ---------- data ----------
  async function load(force) {
    if (loaded && !force) return;
    const gh = S().gh;
    const [tn, cn] = await Promise.all([gh.list('tasks'), gh.list('clients')]);
    tasks = {}; clients = {};
    await Promise.all(tn.filter(n => n.endsWith('.json')).map(async n => { const t = await gh.getJson('tasks/' + n); if (t && t.id) tasks[t.id] = t; }));
    await Promise.all(cn.filter(n => n.endsWith('.json')).map(async n => { const c = await gh.getJson('clients/' + n); if (c) clients[n.slice(0, -5)] = c; }));
    loaded = true;
    badge();
  }

  const save = async t => {
    t.updated = new Date().toISOString();
    await S().gh.putJson('tasks/' + t.id + '.json', t, `Task: ${t.title.slice(0, 60)}`);
    tasks[t.id] = t; badge();
  };
  const remove = async id => {
    await S().gh.del('tasks/' + id + '.json', `Task removed: ${(tasks[id] || {}).title || id}`);
    delete tasks[id]; badge();
  };

  // ---------- the badge: what is waiting, shown every time the Price Book is opened ----------
  function due() {
    const t0 = today();
    return Object.values(tasks).filter(t => !t.done && t.due && t.due <= t0);
  }
  function badge() {
    const n = due().length;
    if (S() && S().taskBadge) S().taskBadge(n ? `Tasks · ${n}` : null);
  }

  // ---------- the reminder: hand a calendar entry to the phone ----------
  function icsFor(t) {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    const [y, m, d] = t.due.split('-');
    const hhmm = (t.time || '09:00').replace(':', '');                 // no time given: 9 in the morning, which rings
    const start = `${y}${m}${d}T${hhmm}00`;                            // floating local time: correct on the phone it lands on
    const endH = pad(Math.min(23, Number(hhmm.slice(0, 2)) + 1));
    const end = `${y}${m}${d}T${endH}${hhmm.slice(2)}00`;
    const who = t.client_name ? `Client: ${t.client_name}` : 'General';
    const fold = s => String(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
    return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Gifts N Glam//Price Book//EN', 'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT', `UID:${t.id}@gng-price-book`, `DTSTAMP:${stamp}`, `DTSTART:${start}`, `DTEND:${end}`,
      `SUMMARY:${fold(t.title)}`, `DESCRIPTION:${fold(who + (t.notes ? '\n' + t.notes : ''))}`,
      'BEGIN:VALARM', 'TRIGGER:PT0S', 'ACTION:DISPLAY', `DESCRIPTION:${fold(t.title)}`, 'END:VALARM',
      'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  }

  async function remind(t) {
    if (!t.due) return toast('Give the task a date first, then it can go in your calendar', true);
    const blob = new Blob([icsFor(t)], { type: 'text/calendar' });
    const name = (slug(t.title) || 'task') + '.ics';
    const file = new File([blob], name, { type: 'text/calendar' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: t.title }); return toast('Sent to your calendar'); }
      catch (e) { if (e && e.name === 'AbortError') return; }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    toast('Calendar entry downloaded — open it to add the reminder');
  }

  // ---------- view ----------
  async function open() {
    const v = S().viewEl(); S().listEl().hidden = true; v.innerHTML = '<div class="empty">Loading tasks…</div>';
    try { await load(); } catch (e) { v.innerHTML = ''; return toast('Could not load tasks: ' + e.message, true); }
    render();
  }

  function clientOptions() {
    const seen = new Set();
    Object.values(clients).forEach(c => c.name && seen.add(c.name));
    Object.values(tasks).forEach(t => t.client_name && seen.add(t.client_name));
    return [...seen].sort().map(n => `<option value="${esc(n)}">`).join('');
  }

  function render() {
    const v = S().viewEl();
    S().listEl().hidden = true;          // the catalog list may have finished loading while the tasks were fetched
    // every client the filter can offer: those on file, plus any name typed straight onto a task
    const byId = {};
    Object.entries(clients).forEach(([id, c]) => { byId[id] = c.name || id; });
    Object.values(tasks).forEach(t => { if (t.client && !byId[t.client]) byId[t.client] = t.client_name || t.client; });
    const names = Object.entries(byId).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
    v.innerHTML = `<div class="item"><div class="body edit">
      <h3>Tasks</h3>
      <p class="desc">Anything to do, on its own or against a client. What is due today or overdue shows on the <b>Tasks</b> button every time you open the Price Book.</p>
      <div class="field"><label for="tkTitle">${editing ? 'Edit task' : 'New task'}</label>
        <input id="tkTitle" type="text" value="${esc(editing ? editing.title : '')}" placeholder="e.g. Send the Diwali proforma"></div>
      <div class="field two">
        <div><label for="tkClient">Client</label><input id="tkClient" type="text" list="tkClients" value="${esc(editing ? (editing.client_name || '') : '')}" placeholder="leave empty for a general task"><datalist id="tkClients">${clientOptions()}</datalist></div>
        <div><label for="tkDue">Due</label><input id="tkDue" type="date" value="${esc(editing ? (editing.due || '') : '')}"></div>
      </div>
      <div class="field two">
        <div><label for="tkTime">Time</label><input id="tkTime" type="time" value="${esc(editing ? (editing.time || '') : '')}"></div>
        <div><label for="tkNote">Note</label><input id="tkNote" type="text" value="${esc(editing ? (editing.notes || '') : '')}" placeholder="optional"></div>
      </div>
      <div class="actions">
        <button type="button" id="tkSave">${editing ? 'Save changes' : 'Add task'}</button>
        ${editing ? '<button type="button" class="ghost" id="tkCancel">Cancel</button>' : ''}
        <button type="button" class="ghost" id="tkBack">Back to list</button>
      </div>
      <div class="field"><label for="tkFilter">Show</label>
        <select id="tkFilter">
          <option value="all">Everything</option>
          <option value="general">General only</option>
          ${names.map(n => `<option value="c:${esc(n.id)}">${esc(n.name)}</option>`).join('')}
        </select></div>
      <div id="tkList"></div>
    </div></div>`;
    $('#tkFilter').value = filter;
    $('#tkSave').onclick = onSave;
    $('#tkBack').onclick = () => { editing = null; S().viewEl().innerHTML = ''; S().showList(); };
    if ($('#tkCancel')) $('#tkCancel').onclick = () => { editing = null; render(); };
    $('#tkFilter').onchange = () => { filter = $('#tkFilter').value; renderList(); };
    $('#tkTitle').addEventListener('keydown', e => { if (e.key === 'Enter') onSave(); });
    renderList();
    if (editing) $('#tkTitle').focus();
  }

  function visible() {
    let list = Object.values(tasks);
    if (filter === 'general') list = list.filter(t => !t.client);
    else if (filter.startsWith('c:')) list = list.filter(t => t.client === filter.slice(2));
    return list;
  }

  function renderList() {
    const box = $('#tkList'); if (!box) return;
    const list = visible();
    const t0 = today(), week = addDays(t0, 7);
    const open_ = list.filter(t => !t.done), done = list.filter(t => t.done)
      .sort((a, b) => String(b.done_at || '').localeCompare(String(a.done_at || ''))).slice(0, 20);
    const groups = [
      ['Overdue', open_.filter(t => t.due && t.due < t0)],
      ['Today', open_.filter(t => t.due === t0)],
      ['Next seven days', open_.filter(t => t.due && t.due > t0 && t.due <= week)],
      ['Later', open_.filter(t => t.due && t.due > week)],
      ['No date', open_.filter(t => !t.due)],
      ['Done', done],
    ];
    if (!list.length) { box.innerHTML = '<div class="empty">No tasks here yet.</div>'; return; }
    box.innerHTML = groups.filter(([, g]) => g.length).map(([name, g]) => `<h2 class="tkh">${name}${name === 'Overdue' ? ` · ${g.length}` : ''}</h2>` +
      g.sort((a, b) => String(a.due || '9999').localeCompare(String(b.due || '9999'))).map(row).join('')).join('');
    box.querySelectorAll('.task').forEach(el => {
      const t = tasks[el.dataset.id]; if (!t) return;
      el.querySelector('.tick').onclick = async () => {
        t.done = !t.done; t.done_at = t.done ? new Date().toISOString() : null;
        try { await save(t); renderList(); toast(t.done ? 'Done' : 'Back on the list'); } catch (e) { toast('Could not save: ' + e.message, true); }
      };
      el.querySelector('.t').onclick = () => { editing = { ...t }; render(); };
      const rem = el.querySelector('.rem'); if (rem) rem.onclick = () => remind(t);
      el.querySelector('.del').onclick = async function () {
        if (!this.dataset.armed) { this.dataset.armed = '1'; this.textContent = 'Delete?'; setTimeout(() => { if (this.isConnected) { delete this.dataset.armed; this.textContent = '\u2715'; } }, 4000); return; }
        try { await remove(t.id); renderList(); toast('Task removed'); } catch (e) { toast('Could not remove: ' + e.message, true); }
      };
    });
  }

  function row(t) {
    const late = !t.done && t.due && t.due < today();
    return `<div class="task${t.done ? ' off' : ''}" data-id="${esc(t.id)}">
      <button type="button" class="tick${t.done ? ' on' : ''}" aria-pressed="${t.done}" title="${t.done ? 'Not done after all' : 'Mark done'}">\u2713</button>
      <div class="tx"><div class="t">${esc(t.title)}</div>
        <div class="s"><span class="${late ? 'late' : ''}">${esc(dueLabel(t))}</span>${t.client_name ? ' · <span class="who">' + esc(t.client_name) + '</span>' : ''}${t.notes ? ' · ' + esc(t.notes) : ''}</div></div>
      ${t.due && !t.done ? '<button type="button" class="rem" title="Put this reminder in your calendar">Remind</button>' : ''}
      <button type="button" class="del" aria-label="Remove task">\u2715</button>
    </div>`;
  }

  async function onSave() {
    const title = $('#tkTitle').value.trim();
    if (!title) return toast('Give the task a title', true);
    const typed = $('#tkClient').value.trim();
    const match = Object.entries(clients).find(([, c]) => (c.name || '').toLowerCase() === typed.toLowerCase());
    const t = editing ? { ...editing } : { id: newId(), created: new Date().toISOString(), done: false, done_at: null };
    t.title = title;
    t.client = match ? match[0] : (typed ? slug(typed) : '');
    t.client_name = typed;
    t.due = $('#tkDue').value || '';
    t.time = $('#tkTime').value || '';
    t.notes = $('#tkNote').value.trim();
    $('#tkSave').disabled = true;
    try { await save(t); editing = null; render(); toast('Saved'); }
    catch (e) { toast('Could not save: ' + e.message, true); $('#tkSave').disabled = false; }
  }

  // open the Tasks view already filtered to one client (used from a client's documents)
  function forClient(id, name) {
    filter = id ? 'c:' + id : 'all';
    if (name && id && !clients[id]) clients[id] = { name };
    return open();
  }

  window.Tasks = { open, badge, load, forClient, dueCount: () => due().length };
})();
