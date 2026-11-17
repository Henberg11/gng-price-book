// GnG Price Book - the proforma and the tax invoice as a real PDF, drawn with pdf-lib and handed to
// the phone's share sheet, the same route a selection takes (selection.js). Drawn rather than
// screenshotted, so the file a client opens carries selectable text, searchable numbers and a sharp
// logo at any zoom - which matters when the other side's accounts team reads it.
//
// The layout mirrors the print stylesheet in index.html (@media print, .doc). Two deliberate
// departures, both for documents that run past one page: the line-table head repeats on each page,
// and a page number is printed at the foot. Fonts and the logo come from the data repo's assets/,
// written there by ghsync.py.
(function () {
  'use strict';
  const S = () => window.PB;
  const PDFLIB = 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js';
  const FONTKIT = 'https://cdn.jsdelivr.net/npm/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js';

  const MM = 72 / 25.4;
  const PAGE = [210 * MM, 297 * MM];
  const SIDE = 18 * MM, PAD = 14 * MM;                 // td.d-body padding, .d-pad spacers
  const W = PAGE[0], H = PAGE[1], CW = W - 2 * SIDE;   // content width: 174mm

  const INK = [0.078, 0.078, 0.078];                   // #141414
  const GOLD = [0.788, 0.627, 0.353];                  // #C9A05A
  const GREY = [0.431, 0.416, 0.388];                  // #6E6A63
  const SOFT = [0.227, 0.220, 0.212];                  // #3A3836
  const HAIR = [0.890, 0.863, 0.804];                  // #E3DCCD

  const loadScript = src => new Promise((res, rej) => {
    if ([...document.scripts].some(s => s.src === src)) return res();
    const s = document.createElement('script'); s.src = src; s.onload = res;
    s.onerror = () => rej(new Error('could not load ' + src)); document.head.appendChild(s);
  });
  async function libs() {
    await loadScript(PDFLIB); await loadScript(FONTKIT);
    if (!window.PDFLib || !window.fontkit) throw new Error('PDF library did not load (offline?)');
  }

  // ---------- type ----------
  const lines = (font, text, size, maxW) => {
    const out = [];
    for (const para of String(text == null ? '' : text).split(/\r?\n/)) {
      let cur = '';
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const t = cur ? cur + ' ' + word : word;
        if (font.widthOfTextAtSize(t, size) > maxW && cur) { out.push(cur); cur = word; } else cur = t;
      }
      out.push(cur);
    }
    return out;
  };
  const trackedW = (font, text, size, track) =>
    [...text].reduce((w, ch) => w + font.widthOfTextAtSize(ch, size), 0) + Math.max(0, text.length - 1) * track * size;

  // pdf-lib has no letter-spacing, so the brand's uppercase labels are drawn glyph by glyph.
  function tracked(page, font, text, size, track, x, y, color, align) {
    const w = trackedW(font, text, size, track);
    let cx = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    for (const ch of text) { page.drawText(ch, { x: cx, y, size, font, color: rgb(color) }); cx += font.widthOfTextAtSize(ch, size) + track * size; }
    return w;
  }
  const rgb = c => PDFLib.rgb(c[0], c[1], c[2]);
  function put(page, text, font, size, x, y, color, align) {
    const w = font.widthOfTextAtSize(text, size);
    page.drawText(text, { x: align === 'right' ? x - w : align === 'center' ? x - w / 2 : x, y, size, font, color: rgb(color || INK) });
    return w;
  }
  const hair = (page, x1, x2, y, color, thickness) =>
    page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness: thickness || 0.25, color: rgb(color) });

  // ---------- page flow ----------
  function newPage(ctx) {
    ctx.page = ctx.pdf.addPage(PAGE);
    ctx.page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: PDFLib.rgb(1, 1, 1) });
    ctx.y = H - PAD; ctx.pages.push(ctx.page);
    return ctx.page;
  }
  const need = (ctx, h) => { if (ctx.y - h < PAD) newPage(ctx); return ctx.page; };

  // paragraph; returns the height used
  function para(ctx, text, font, size, color, maxW, x, leading) {
    const lh = (leading || 1.45) * size;
    for (const ln of lines(font, text, size, maxW == null ? CW : maxW)) {
      need(ctx, lh); ctx.y -= lh;
      if (ln) put(ctx.page, ln, font, size, x == null ? SIDE : x, ctx.y + size * 0.26, color);
    }
  }

  // ---------- the document ----------
  async function draw(ctx, inv, b, D) {
    const f = ctx.fonts, isInv = inv.type === 'invoice';
    const c = window.Invoices.calc(inv);
    const firm = D.legalName(b);

    // masthead
    if (ctx.logo) {
      const lh = 13 * MM, lw = lh * ctx.logo.width / ctx.logo.height;
      ctx.y -= lh; ctx.page.drawImage(ctx.logo, { x: (W - lw) / 2, y: ctx.y, width: lw, height: lh });
    }
    ctx.y -= 3 * MM + 14;
    tracked(ctx.page, f.bodoni, (b.name || '').toUpperCase(), 14, 0.29, W / 2, ctx.y, INK, 'center');
    if (b.tagline) { ctx.y -= 1 * MM + 7; tracked(ctx.page, f.light, b.tagline.toUpperCase(), 7, 0.40, W / 2, ctx.y, SOFT, 'center'); }
    ctx.y -= 3.5 * MM; hair(ctx.page, (W - 34 * MM) / 2, (W + 34 * MM) / 2, ctx.y, GOLD); ctx.y -= 3.5 * MM;

    ctx.y -= 1 * MM + 17;
    put(ctx.page, isInv ? 'Tax invoice' : 'Proforma invoice', f.bodoni, 17, W / 2, ctx.y, INK, 'center');
    ctx.y -= 4 * MM;

    // number / date / against proforma, centred as a row of labelled columns
    const meta = [['Number', inv.number], ['Date', D.fmtDate(inv.date)]];
    if (inv.proforma_ref) meta.push(['Against proforma', inv.proforma_ref]);
    const mw = meta.map(([k, v]) => Math.max(trackedW(f.light, k.toUpperCase(), 7, 0.3), f.light.widthOfTextAtSize(v, 9.5)));
    let mx = (W - (mw.reduce((a, x) => a + x, 0) + (meta.length - 1) * 10 * MM)) / 2;
    ctx.y -= 7;
    meta.forEach(([k, v], i) => {
      tracked(ctx.page, f.light, k.toUpperCase(), 7, 0.3, mx, ctx.y, GREY);
      put(ctx.page, v, f.light, 9.5, mx, ctx.y - 9.5 * 1.25, INK);
      mx += mw[i] + 10 * MM;
    });
    ctx.y -= 9.5 * 1.25 + 6 * MM;

    // the two parties, side by side
    const colW = (CW - 12 * MM) / 2, top = ctx.y;
    const party = (x, label, name, sub, rest) => {
      let y = top;
      tracked(ctx.page, f.light, label.toUpperCase(), 7, 0.3, x, y, GREY); y -= 1.5 * MM;
      for (const ln of lines(f.bodoni, name || '—', 12.5, colW)) { y -= 12.5 * 1.2; put(ctx.page, ln, f.bodoni, 12.5, x, y, INK); }
      if (sub) { y -= 8.5 * 1.3; put(ctx.page, sub, f.light, 8.5, x, y, GREY); }
      for (const t of rest.filter(Boolean)) for (const ln of lines(f.regular, t, 10, colW)) { y -= 10 * 1.45; put(ctx.page, ln, f.regular, 10, x, y, INK); }
      return y;
    };
    const left = party(SIDE, 'From', firm, firm !== b.name ? 'trading as ' + b.name : '',
      [b.address, b.gstin ? 'GSTIN ' + b.gstin : '', b.phone, b.email]);
    const right = party(SIDE + colW + 12 * MM, isInv ? 'Billed to' : 'Prepared for', inv.client.name, '',
      [inv.client.address, inv.client.state, inv.client.gstin ? 'GSTIN ' + inv.client.gstin : '', inv.client.phone]);
    ctx.y = Math.min(left, right) - 6 * MM;

    // lines
    const COLS = [8, 86, 16, 14, 22, 28].map(x => x * MM);      // #, description, HSN, qty, unit, amount
    const X = []; COLS.reduce((a, w, i) => { X[i] = SIDE + a; return a + w; }, 0);
    const pad = 1.5 * MM;
    const head = () => {
      need(ctx, 10 * MM);
      ctx.y -= 2 * MM + 7;
      const h = ['#', 'Description', 'HSN', 'Qty', 'Unit', 'Amount'];
      h.forEach((t, i) => {
        const right = i === 0 || i >= 3;
        tracked(ctx.page, f.light, t.toUpperCase(), 7, 0.2, right ? X[i] + COLS[i] - pad : X[i] + pad, ctx.y, GREY, right ? 'right' : 'left');
      });
      ctx.y -= 2 * MM; hair(ctx.page, SIDE, SIDE + CW, ctx.y, GOLD); ctx.doneHead = true;
    };
    head();
    c.lines.forEach((l, i) => {
      const nameLines = lines(f.regular, l.name, 10, COLS[1] - 2 * pad);
      const notes = D.noteList(l).filter(n => !n.h);
      const noteLines = notes.map(n => lines(f.regular, n.t, 8.5, COLS[1] - 2 * pad));
      const refW = l.ref ? f.light.widthOfTextAtSize('Ref. ' + l.ref, 8) : 0;
      const lastW = f.regular.widthOfTextAtSize(nameLines[nameLines.length - 1] || '', 10);
      const refInline = l.ref && lastW + 2 * MM + refW < COLS[1] - 2 * pad;
      const h = 2.2 * MM * 2 + nameLines.length * 10 * 1.45 + (l.ref && !refInline ? 8 * 1.45 : 0)
        + noteLines.reduce((a, ls) => a + 1 * MM + ls.length * 8.5 * 1.45, 0);
      if (ctx.y - h < PAD) { newPage(ctx); head(); }
      let y = ctx.y - 2.2 * MM;
      const row0 = y;
      nameLines.forEach((ln, k) => { y -= 10 * 1.45; put(ctx.page, ln, f.regular, 10, X[1] + pad, y + 10 * 0.26, INK);
        if (k === nameLines.length - 1 && refInline) put(ctx.page, 'Ref. ' + l.ref, f.light, 8, X[1] + pad + lastW + 2 * MM, y + 10 * 0.26, GREY); });
      if (l.ref && !refInline) { y -= 8 * 1.45; put(ctx.page, 'Ref. ' + l.ref, f.light, 8, X[1] + pad, y + 8 * 0.26, GREY); }
      noteLines.forEach(ls => { y -= 1 * MM; ls.forEach(ln => { y -= 8.5 * 1.45; put(ctx.page, ln, f.regular, 8.5, X[1] + pad, y + 8.5 * 0.26, SOFT); }); });
      const first = row0 - 10 * 1.45 + 10 * 0.26;
      put(ctx.page, String(i + 1), f.regular, 10, X[0] + COLS[0] - pad, first, INK, 'right');
      if (l.hsn) put(ctx.page, l.hsn, f.regular, 10, X[2] + pad, first, INK);
      put(ctx.page, String(l.qty % 1 ? l.qty : l.qty | 0), f.regular, 10, X[3] + COLS[3] - pad, first, INK, 'right');
      put(ctx.page, D.INR(l.unit), f.regular, 10, X[4] + COLS[4] - pad, first, INK, 'right');
      put(ctx.page, D.INR(l.total), f.regular, 10, X[5] + COLS[5] - pad, first, INK, 'right');
      ctx.y = y - 2.2 * MM; hair(ctx.page, SIDE, SIDE + CW, ctx.y, HAIR);
    });

    // totals, right-aligned in a 70mm block
    const rows = [['Subtotal', c.subtotal]];
    if (c.discount) rows.push(['Discount', -c.discount]);
    if (c.rate) {
      rows.push([`Taxable value (GST ${c.rate}%${c.inclusive ? ' included' : ''})`, c.taxable]);
      if (c.inter) rows.push([`IGST ${c.rate}%`, c.tax]);
      else { rows.push([`CGST ${c.rate / 2}%`, c.half]); rows.push([`SGST ${c.rate / 2}%`, c.half]); }
    }
    if (c.roundoff) rows.push(['Rounding', c.roundoff]);
    const tx = SIDE + CW, tw = 70 * MM;
    need(ctx, rows.length * 6 * MM + 16 * MM);
    ctx.y -= 4 * MM;
    for (const [k, v] of rows) {
      const kl = lines(f.regular, k, 10.5, tw - 30 * MM);
      kl.forEach((ln, j) => { ctx.y -= 10.5 * 1.45; put(ctx.page, ln, f.regular, 10.5, tx - tw + 1.5 * MM, ctx.y, INK);
        if (j === 0) put(ctx.page, D.INR(v), f.regular, 10.5, tx - 1.5 * MM, ctx.y, INK, 'right'); });
      ctx.y -= 1.4 * MM;
    }
    ctx.y -= 2.5 * MM; hair(ctx.page, tx - tw, tx, ctx.y, GOLD); ctx.y -= 2.5 * MM + 12;
    put(ctx.page, 'Total', f.regular, 12, tx - tw + 1.5 * MM, ctx.y, INK);
    put(ctx.page, D.INR(c.total), f.regular, 12, tx - 1.5 * MM, ctx.y, INK, 'right');
    if (c.estimated) { ctx.y -= 9 * 1.6; put(ctx.page, 'GST shown is an estimate', f.light, 9, tx - 1.5 * MM, ctx.y, SOFT, 'right'); }
    ctx.y -= 9 * 1.6;
    put(ctx.page, window.Invoices.inWords(c.total), f.light, 9, tx - 1.5 * MM, ctx.y, SOFT, 'right');

    // notes under the figures
    const notes = [];
    if (c.rate) notes.push(`Prices ${c.inclusive ? 'inclusive' : 'exclusive'} of GST. Place of supply: ${inv.client.state || '—'}.`
      + (c.estimated ? ` ${firm} is not registered under GST at present; the GST shown is an estimate and is not charged on this quotation. It will be levied on the tax invoice once registration is in place.` : ''));
    if (inv.notes) notes.push(inv.notes);
    if (!isInv && b.proforma_note) notes.push(b.proforma_note);
    for (const t of notes) { ctx.y -= 5 * MM; para(ctx, t, f.regular, 9.5, SOFT, CW, SIDE); }

    // payment
    const bank = b.bank || {};
    if (bank.account || bank.upi) {
      need(ctx, 20 * MM);
      ctx.y -= 4 * MM + 7; tracked(ctx.page, f.light, 'PAYMENT', 7, 0.3, SIDE, ctx.y, GREY);
      const L = [bank.holder, bank.name].filter(Boolean);
      const R = [bank.account ? `Account ${bank.account}${bank.type ? ' (' + bank.type + ')' : ''}` : '', bank.ifsc ? 'IFSC ' + bank.ifsc : '', bank.upi ? 'UPI ' + bank.upi : ''].filter(Boolean);
      const colX = SIDE + Math.max(...L.map(t => f.regular.widthOfTextAtSize(t, 9.5)), 0) + 8 * MM;
      let y = ctx.y - 1.5 * MM;
      for (let i = 0; i < Math.max(L.length, R.length); i++) {
        y -= 9.5 * 1.45;
        if (L[i]) put(ctx.page, L[i], f.regular, 9.5, SIDE, y, INK);
        if (R[i]) put(ctx.page, R[i], f.regular, 9.5, colX, y, INK);
      }
      ctx.y = y;
    }

    // conditions of sale: small, two columns, kept whole
    const items = isInv ? D.CONDITIONS : [D.QUOTE_VALIDITY, ...D.CONDITIONS];
    const ccW = (CW - 8 * MM) / 2, numW = f.light.widthOfTextAtSize('10. ', 6.8);
    const blocks = items.map((t, i) => ({ n: (i + 1) + '.', ls: lines(f.regular, t, 6.8, ccW - numW) }));
    const totalL = blocks.reduce((a, x) => a + x.ls.length, 0);
    let acc = 0, cut = blocks.length;
    for (let i = 0; i < blocks.length; i++) { acc += blocks[i].ls.length; if (acc >= Math.ceil(totalL / 2)) { cut = i + 1; break; } }
    const colHeight = arr => arr.reduce((a, x) => a + x.ls.length * 6.8 * 1.5 + 1.2 * MM, 0);
    const condH = 7 + 1.5 * MM + Math.max(colHeight(blocks.slice(0, cut)), colHeight(blocks.slice(cut)));

    // the foot: terms on the left, signature on the right - measured so it never splits
    const termLines = inv.terms ? lines(f.regular, inv.terms, 9.5, (CW - 10 * MM) / 2) : [];
    const footH = 6 * MM + Math.max(termLines.length * 9.5 * 1.45 + 7 + 1.5 * MM, 12 * MM + 2 * MM + 9.5 * 1.45 + 1 * MM + 7);
    need(ctx, 6 * MM + condH + footH);

    ctx.y -= 6 * MM + 7; tracked(ctx.page, f.light, 'CONDITIONS OF SALE', 7, 0.3, SIDE, ctx.y, GREY);
    ctx.y -= 1.5 * MM;
    const condTop = ctx.y;
    [blocks.slice(0, cut), blocks.slice(cut)].forEach((col, ci) => {
      let y = condTop, x = SIDE + ci * (ccW + 8 * MM);
      for (const bl of col) {
        put(ctx.page, bl.n, f.regular, 6.8, x + numW - f.regular.widthOfTextAtSize(bl.n + ' ', 6.8), y - 6.8 * 1.5 + 6.8 * 0.26, SOFT);
        for (const ln of bl.ls) { y -= 6.8 * 1.5; put(ctx.page, ln, f.regular, 6.8, x + numW, y + 6.8 * 0.26, SOFT); }
        y -= 1.2 * MM;
      }
    });
    ctx.y = condTop - Math.max(colHeight(blocks.slice(0, cut)), colHeight(blocks.slice(cut)));

    ctx.y -= 6 * MM;
    const footTop = ctx.y;
    if (termLines.length) {
      let y = footTop; tracked(ctx.page, f.light, 'TERMS', 7, 0.3, SIDE, y, GREY); y -= 1.5 * MM;
      for (const ln of termLines) { y -= 9.5 * 1.45; put(ctx.page, ln, f.regular, 9.5, SIDE, y + 9.5 * 0.26, INK); }
    }
    {
      const x = SIDE + CW;
      let y = footTop - 12 * MM;
      hair(ctx.page, x - 34 * MM, x, y, GOLD); y -= 2 * MM + 9.5;
      put(ctx.page, 'For ' + firm, f.regular, 9.5, x, y, INK, 'right');
      y -= 1 * MM + 7; tracked(ctx.page, f.light, 'AUTHORISED SIGNATORY', 7, 0.3, x, y, GREY, 'right');
      ctx.y = Math.min(ctx.y, y);
    }
  }

  // ---------- build and share ----------
  let ASSETS = null;                     // fonts and logo, fetched once per session
  async function build(inv, b, msg) {
    msg && msg('Loading PDF tools…');
    await libs();
    const D = window.Invoices._doc;
    const gh = S().gh;
    if (!ASSETS) {
      msg && msg('Fetching the brand assets…');
      ASSETS = await Promise.all([
        gh.bytes('assets/fonts/BodoniModa-Regular.ttf'),
        gh.bytes('assets/fonts/Montserrat-Regular.ttf'),
        gh.bytes('assets/fonts/Montserrat-Light.ttf'),
        gh.bytes('assets/logo.png'),
      ]);
    }
    const [bo, re, li, logo] = ASSETS;
    if (!bo || !re || !li) throw new Error('the brand fonts are not in the data repo yet — run a sync from the studio');
    const pdf = await PDFLib.PDFDocument.create(); pdf.registerFontkit(window.fontkit);
    const ctx = {
      pdf, pages: [], fonts: {
        bodoni: await pdf.embedFont(bo, { subset: true }),
        regular: await pdf.embedFont(re, { subset: true }),
        light: await pdf.embedFont(li, { subset: true }),
      },
      logo: logo ? await pdf.embedPng(logo) : null,
    };
    msg && msg('Drawing the document…');
    newPage(ctx);
    await draw(ctx, inv, b, D);
    if (ctx.pages.length > 1) ctx.pages.forEach((p, i) =>
      put(p, `Page ${i + 1} of ${ctx.pages.length}`, ctx.fonts.light, 7, W / 2, PAD - 5 * MM, GREY, 'center'));
    const isInv = inv.type === 'invoice';
    pdf.setTitle(`${isInv ? 'Tax invoice' : 'Proforma invoice'} ${inv.number}`);
    pdf.setAuthor(D.legalName(b)); pdf.setSubject(`${b.name} — ${inv.client.name || ''}`.trim());
    pdf.setCreationDate(new Date());
    return pdf.save();
  }

  const clean = s => String(s || '').replace(/[\\\/:*?"<>|']+/g, '').replace(/\s+/g, ' ').trim();

  // Drawing the PDF takes a second or two, and by the time it finishes the browser no longer counts
  // the tap that started it as a live gesture - navigator.share() then refuses and the file quietly
  // downloads instead of the share sheet opening. So preparing and sending are separate: prepare()
  // does the slow part, send() is called from a tap of its own and opens the sheet straight away.
  async function prepare(inv, b, msg) {
    const bytes = await build(inv, b, msg);
    const isInv = inv.type === 'invoice';
    const name = `${isInv ? 'Tax invoice' : 'Proforma'} ${clean(inv.number)}${inv.client.name ? ' - ' + clean(inv.client.name) : ''}.pdf`;
    // The share sheet is the only route a web page has to hand a file to WhatsApp; the contact is
    // chosen inside whichever app is picked. wa.me opens a named chat but carries text only.
    const text = `${b.name} — ${isInv ? 'tax invoice' : 'proforma'} ${inv.number}${inv.client.name ? ' for ' + inv.client.name : ''}`;
    return { file: new File([bytes], name, { type: 'application/pdf' }), name, text, kb: Math.round(bytes.length / 1024) };
  }

  // A programmatic click on a blob link opens a blank tab in some Android browsers instead of
  // saving, which looks like nothing happened. So the fallback offers a link to tap, never a click
  // the page makes by itself.
  function offer(p, msg, why) {
    const url = URL.createObjectURL(p.file);
    setTimeout(() => URL.revokeObjectURL(url), 300000);
    msg && msg(`${why} the PDF is ready, ${p.kb} KB:`, false, { url, name: p.name });
    return 'offered';
  }

  // canShare() is advisory and some browsers answer false for a PDF they will in fact share, so the
  // sheet is always attempted. Only a refusal from share() itself is taken as an answer, and the
  // reason is put on screen rather than swallowed.
  function explain(e, hinted) {
    if (!window.isSecureContext) return 'This page is not on a secure connection, so the share sheet is blocked —';
    if (e && (e.name === 'TypeError' || e.name === 'NotSupportedError') || !hinted)
      return 'This browser will not hand a PDF to the share sheet. Open the Price Book in Chrome to send straight to WhatsApp, or save it here and attach it yourself —';
    return `The share sheet would not open (${e ? e.name + ': ' + (e.message || 'no reason given') : 'unknown'}) —`;
  }

  // Returns 'shared', 'cancelled', 'needs-tap' (the tap had expired - ask for one more) or 'offered'.
  // Call it straight from a click handler, with nothing slow awaited before it.
  async function send(p, msg, second) {
    if (!navigator.share) return offer(p, msg, 'This browser has no share sheet. Open the Price Book in Chrome to send straight to WhatsApp, or save it here and attach it yourself —');
    const hinted = !navigator.canShare || navigator.canShare({ files: [p.file] });
    try {
      await navigator.share({ files: [p.file], title: p.name, text: p.text });
      msg && msg(`Shared ${p.name} (${p.kb} KB)`); return 'shared';
    } catch (e) {
      if (e.name === 'AbortError') { msg && msg('Share cancelled — the PDF is still ready, tap Send PDF to try again'); return 'cancelled'; }
      if (e.name === 'NotAllowedError' && !second) return 'needs-tap';     // the tap had gone stale: one more will do it
      return offer(p, msg, explain(e, hinted));
    }
  }

  window.DocPDF = { build, prepare, send };
})();
