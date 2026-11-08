/* Mesin pengisi & perbaikan kertas kerja anggaran. Berjalan sepenuhnya di browser (tanpa server, tanpa library). */
'use strict';
(function (root) {
  const enc = new TextEncoder(), dec = new TextDecoder('utf-8');

  /* ================= ZIP (API bawaan browser) ================= */
  const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC_T[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  async function pipe(u8, stream) { return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(stream)).arrayBuffer()); }
  const inflateRaw = u8 => pipe(u8, new DecompressionStream('deflate-raw'));
  const deflateRaw = u8 => pipe(u8, new CompressionStream('deflate-raw'));

  function readZip(buf) {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let e = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65558); i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
    if (e < 0) throw new Error('Bukan file XLSX/ZIP yang valid');
    const n = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true); const list = [];
    for (let i = 0; i < n; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('Struktur ZIP rusak');
      const nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
      list.push({ name: dec.decode(buf.subarray(p + 46, p + 46 + nl)), method: dv.getUint16(p + 10, true), time: dv.getUint16(p + 12, true), date: dv.getUint16(p + 14, true), crc: dv.getUint32(p + 16, true), csize: dv.getUint32(p + 20, true), usize: dv.getUint32(p + 24, true), off: dv.getUint32(p + 42, true) });
      p += 46 + nl + el + cl;
    }
    return { buf, dv, list, map: new Map(list.map(x => [x.name, x])) };
  }
  function rawOf(z, en) { const o = en.off, nl = z.dv.getUint16(o + 26, true), el = z.dv.getUint16(o + 28, true), s = o + 30 + nl + el; return z.buf.subarray(s, s + en.csize); }
  async function textOf(z, name) {
    const en = z.map.get(name); if (!en) throw new Error('Entri tidak ada: ' + name);
    const r = rawOf(z, en); return dec.decode(en.method === 0 ? r : await inflateRaw(r));
  }
  async function writeZip(z, replaced) {
    const parts = [], cd = []; let off = 0; const push = u => { parts.push(u); off += u.length; };
    for (const en of z.list) {
      let method = en.method, crc = en.crc, usize = en.usize, data;
      if (replaced.has(en.name)) { const u = enc.encode(replaced.get(en.name)); crc = crc32(u); usize = u.length; data = await deflateRaw(u); method = 8; }
      else data = rawOf(z, en);
      const nb = enc.encode(en.name), h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x800, true); h.setUint16(8, method, true); h.setUint16(10, en.time, true); h.setUint16(12, en.date, true);
      h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, usize, true); h.setUint16(26, nb.length, true);
      const lo = off; push(new Uint8Array(h.buffer)); push(nb); push(data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x800, true); c.setUint16(10, method, true); c.setUint16(12, en.time, true); c.setUint16(14, en.date, true);
      c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, usize, true); c.setUint16(28, nb.length, true); c.setUint32(42, lo, true);
      cd.push(new Uint8Array(c.buffer), nb);
    }
    const cdStart = off; for (const u of cd) push(u);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, z.list.length, true); e.setUint16(10, z.list.length, true); e.setUint32(12, off - cdStart, true); e.setUint32(16, cdStart, true);
    push(new Uint8Array(e.buffer));
    return new Blob(parts, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  /* membuat ZIP dari {nama: teks}; dipakai untuk pengujian */
  async function createZip(files) {
    const entries = [], chunks = []; let off = 0;
    for (const [name, text] of Object.entries(files)) {
      const u = enc.encode(text), d = await deflateRaw(u), nb = enc.encode(name), h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x800, true); h.setUint16(8, 8, true); h.setUint32(14, crc32(u), true); h.setUint32(18, d.length, true); h.setUint32(22, u.length, true); h.setUint16(26, nb.length, true);
      entries.push({ name, crc: crc32(u), csize: d.length, usize: u.length, off }); chunks.push(new Uint8Array(h.buffer), nb, d); off += 30 + nb.length + d.length;
    }
    const cdS = off;
    for (const en of entries) {
      const nb = enc.encode(en.name), c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x800, true); c.setUint16(10, 8, true); c.setUint32(16, en.crc, true); c.setUint32(20, en.csize, true); c.setUint32(24, en.usize, true); c.setUint16(28, nb.length, true); c.setUint32(42, en.off, true);
      chunks.push(new Uint8Array(c.buffer), nb); off += 46 + nb.length;
    }
    const e = new DataView(new ArrayBuffer(22)); e.setUint32(0, 0x06054b50, true); e.setUint16(8, entries.length, true); e.setUint16(10, entries.length, true); e.setUint32(12, off - cdS, true); e.setUint32(16, cdS, true);
    chunks.push(new Uint8Array(e.buffer));
    return new Uint8Array(await new Blob(chunks).arrayBuffer());
  }

  /* ================= XML sheet ================= */
  const col2n = c => { let n = 0; for (const ch of c) n = n * 26 + ch.charCodeAt(0) - 64; return n; };
  const n2col = n => { let s = ''; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };
  const xunesc = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  const xesc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const CELL_RE = /<c r="([A-Z]+)(\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  const F_RE = /<f(?:\s([^>]*?))?(?:\/>|>([\s\S]*?)<\/f>)/;
  const REF_RE = /(?<![A-Za-z0-9_.])(\$?)([A-Z]{1,3})(\$?)(\d+)(?![A-Za-z0-9_(])/g;
  const PROTECT_RE = /("(?:[^"]|"")*"|'(?:[^']|'')*')/;

  function translate(f, dr, dc) {
    const parts = f.split(PROTECT_RE);
    for (let i = 0; i < parts.length; i += 2) {
      parts[i] = parts[i].replace(REF_RE, (m, ca, col, ra, row) => {
        const c = col2n(col) + (ca ? 0 : dc), r = +row + (ra ? 0 : dr);
        return (c < 1 || r < 1 || c > 16384) ? '#REF!' : `${ca}${n2col(c)}${ra}${r}`;
      });
    }
    return parts.join('');
  }

  class Cell {
    constructor(m, sst) {
      this.col = m[1]; this.row = +m[2]; this.attrs = m[3]; this.body = m[4] || '';
      const mt = this.attrs.match(/\bt="(\w+)"/), ms = this.attrs.match(/\ss="(\d+)"/);
      this.t = mt ? mt[1] : null; this.s = ms ? ms[1] : null;
      const f = this.body.match(F_RE);
      this.fAttrs = f ? (f[1] || '').trim() : null; this.fRaw = f ? (f[2] || '') : null;
      const vm = this.body.match(/<v>([\s\S]*?)<\/v>/); let v = vm ? vm[1] : null;
      if (this.t === 's' && v !== null) v = sst[+v];
      else if (this.t === 'inlineStr') v = xunesc([...this.body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join(''));
      else if ((this.t === 'str' || this.t === 'e') && v !== null) v = xunesc(v);
      else if (v !== null && this.t !== 'b' && v !== '') { const n = Number(v); if (!Number.isNaN(n)) v = n; }
      this.v = v;
    }
    get ref() { return this.col + this.row; }
    get isError() { return this.t === 'e'; }
    get isShared() { return this.fAttrs !== null && this.fAttrs.includes('t="shared"'); }
    get blank() { return this.v === null || this.v === undefined || this.v === ''; }
  }

  class SheetXml {
    constructor(xml, sst) {
      this.xml = xml; this.sst = sst; this.edits = new Map(); this.cells = new Map(); this.rows = new Map();
      for (const m of xml.matchAll(CELL_RE)) {
        const c = new Cell(m, sst); this.cells.set(c.ref, c);
        if (!this.rows.has(c.row)) this.rows.set(c.row, []); this.rows.get(c.row).push(c);
      }
      this.rowNums = new Set([...xml.matchAll(/<row r="(\d+)"/g)].map(m => +m[1]));
      this.masters = new Map();
      for (const c of this.cells.values()) if (c.isShared && c.fAttrs.includes('ref=') && c.fRaw) this.masters.set(SheetXml.siOf(c), c);
    }
    static siOf(c) { const m = (c.fAttrs || '').match(/si="(\d+)"/); return m ? m[1] : null; }
    get(col, row) { return this.cells.get(col + row); }
    rowCells(row) { return this.rows.get(row) || []; }
    formula(c) {
      if (c.fAttrs === null) return null;
      if (c.fRaw) return xunesc(c.fRaw);
      if (c.isShared) { const m = this.masters.get(SheetXml.siOf(c)); if (m) return translate(xunesc(m.fRaw), c.row - m.row, col2n(c.col) - col2n(m.col)); }
      return '';
    }
    groupMembers(si) { return [...this.cells.values()].filter(c => c.isShared && SheetXml.siOf(c) === si); }
    static build(ref, style, value, formula, fAttrs, cached) {
      const s = style ? ` s="${style}"` : '';
      if (formula !== undefined && formula !== null) {
        const fa = fAttrs ? ` ${fAttrs}` : '', v = (cached !== undefined && cached !== null) ? `<v>${cached}</v>` : '';
        return `<c r="${ref}"${s}><f${fa}>${xesc(formula)}</f>${v}</c>`;
      }
      if (value === undefined || value === null || value === '') return `<c r="${ref}"${s}/>`;
      if (typeof value === 'number') return `<c r="${ref}"${s}><v>${value}</v></c>`;
      return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xesc(String(value))}</t></is></c>`;
    }
    setValue(col, row, value) {
      if (!this.rowNums.has(row)) return false;
      const old = this.get(col, row);
      this.edits.set(col + row, SheetXml.build(col + row, old ? old.s : null, value));
      return true;
    }
    setFormula(col, row, formula, cached, fAttrs) {
      const old = this.get(col, row);
      this.edits.set(col + row, SheetXml.build(col + row, old ? old.s : null, null, formula, fAttrs || '', cached));
    }
    clearCache(c) { const f = c.body.match(F_RE)[0]; this.edits.set(c.ref, `<c r="${c.ref}"${c.s ? ` s="${c.s}"` : ''}>${f}</c>`); }
    clearValue(c) { this.edits.set(c.ref, SheetXml.build(c.ref, c.s, null)); }
    render() {
      const edits = new Map(this.edits);
      let xml = this.xml.replace(CELL_RE, (m, col, row) => { const k = col + row; if (edits.has(k)) { const x = edits.get(k); edits.delete(k); return x; } return m; });
      const byRow = new Map();
      for (const [k, x] of edits) { const m = k.match(/^([A-Z]+)(\d+)$/); const r = +m[2]; if (!byRow.has(r)) byRow.set(r, []); byRow.get(r).push([col2n(m[1]), x]); }
      for (const [row, items] of byRow) {
        const m = new RegExp(`<row r="${row}"([^>]*?)(/>|>([\\s\\S]*?)</row>)`).exec(xml);
        if (!m) continue;
        let inner = m[3] || '';
        for (const [n, x] of items.sort((a, b) => a[0] - b[0])) {
          let pos = inner.length;
          for (const cm of inner.matchAll(/<c r="([A-Z]+)\d+"/g)) if (col2n(cm[1]) > n) { pos = cm.index; break; }
          inner = inner.slice(0, pos) + x + inner.slice(pos);
        }
        xml = xml.slice(0, m.index) + `<row r="${row}"${m[1].replace(/\/$/, '')}>${inner}</row>` + xml.slice(m.index + m[0].length);
      }
      return xml;
    }
  }

  /* ================= Monitoring (tanpa DOM) ================= */
  const ENT = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  const decodeEnt = s => s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isNaN(n) ? m : String.fromCodePoint(n); }
    return ENT[e.toLowerCase()] !== undefined ? ENT[e.toLowerCase()] : m;
  });
  const norm = s => decodeEnt(s).replace(/[\s\u00a0]+/g, ' ').trim();
  const numOf = s => { const n = parseFloat(String(s === null || s === undefined ? '' : s).replace(/,/g, '').trim()); return Number.isNaN(n) ? null : n; };
  const isMonitoring = text => /REALIZATION TYPE|Oracle BI/i.test(text.slice(0, 400000));

  function parseMonitoring(html) {
    const tok = /<(\/?)(table|tr|td|th)\b[^>]*>/gi, tables = [], ordered = []; let curCell = null, last = 0, m;
    const addText = s => { if (curCell) curCell.text += s.replace(/<[^>]*>/g, ''); };
    while ((m = tok.exec(html))) {
      addText(html.slice(last, m.index)); last = tok.lastIndex;
      const close = m[1] === '/', tag = m[2].toLowerCase();
      if (tag === 'table') {
        if (!close) { if (curCell) { curCell.nested = true; curCell.row.nested = true; } tables.push({ parentCell: curCell, row: null }); curCell = null; }
        else { const t = tables.pop(); if (t) curCell = t.parentCell; }
      } else if (tag === 'tr') {
        const t = tables[tables.length - 1]; if (!t) continue;
        if (!close) { t.row = { cells: [], nested: false }; ordered.push(t.row); }
        else t.row = null;
        curCell = null;
      } else {
        const t = tables[tables.length - 1]; if (!t || !t.row) continue;
        if (!close) { const c = { text: '', nested: false, row: t.row }; t.row.cells.push(c); curCell = c; } else curCell = null;
      }
    }
    const tasks = []; let cur = null;
    for (const r of ordered) {
      const cells = r.cells; if (!cells.length) continue;
      if (r.nested) {
        const v = cells.map(c => c.nested ? null : norm(c.text));
        if (cells.length >= 13 && v[0] && v[0][0] === "'") { cur = { no: v[0].slice(1), year: v[10], budget: numOf(v[12]), recs: [] }; tasks.push(cur); }
        continue;
      }
      if (cells.length === 24 && cur) {
        const x = cells.map(c => norm(c.text));
        if (x[0] === 'ACTUAL' || x[0] === 'ENCUMBRANCE') cur.recs.push({ type: x[0], pr: x[2], npr: numOf(x[3]), po: x[4], ct: x[5], npo: numOf(x[7]), rid: x[8].replace(/^'+/, ''), date: x[9], desc: x[14], sup: x[17], raw: numOf(x[18]) });
      }
    }
    return tasks;
  }

  /* ================= Pengisian sheet INVESTASI ================= */
  const LABELS = { task: 'task number', bud: 'budget', ct: 'no. kontrak', sup: 'nama vendor', met: 'metode kontrak', desc: 'task description', pr: 'no pr', npr: 'nilai pr', po: 'no po', npo: 'nilai po', raw: 'acct raw cost', rid: 'no rid', drid: 'tgl rid', nrid: 'nilai rid' };
  const MONTHS = ['JANUARI', 'FEBRUARI', 'MARET', 'APRIL', 'MEI', 'JUNI', 'JULI', 'AGUSTUS', 'SEPTEMBER', 'OKTOBER', 'NOVEMBER', 'DESEMBER'];
  const EN = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
  const DIGITS = /^\d{6,}$/, SUM_RE = /^SUM\(([A-Z]+)(\d+):([A-Z]+)(\d+)\)$/, SUB_RE = /^SUBTOTAL\(9,([A-Z]+)(\d+):([A-Z]+)(\d+)\)$/;
  const idn = v => (typeof v === 'number' ? v.toLocaleString('id-ID', { maximumFractionDigits: 0 }) : String(v));

  function findHeader(sx) {
    for (const r of [...sx.rowNums].sort((a, b) => a - b).slice(0, 12)) {
      const m = {};
      for (const c of sx.rowCells(r)) { const t = String(c.v === null ? '' : c.v).replace(/\s+/g, ' ').trim().toLowerCase(); for (const [k, lab] of Object.entries(LABELS)) if (t === lab) m[k] = c.col; }
      if (m.task && m.pr && m.npr && m.rid) return [r, m];
    }
    return null;
  }

  function fillSheet(sx, name, tasks, stats, log) {
    const hdr = findHeader(sx); if (!hdr) return false;
    const [hr, col] = hdr, rows = [...sx.rowNums].filter(r => r > hr).sort((a, b) => a - b);
    const cell = (r, k) => col[k] ? sx.get(col[k], r) : undefined, val = (r, k) => { const c = cell(r, k); return c ? c.v : null; };
    const has = r => ['sup', 'desc', 'pr', 'npr', 'po', 'npo', 'raw', 'rid', 'nrid'].some(k => { const c = cell(r, k); return c && !c.blank; });
    const blocks = [];
    for (const r of rows) {
      let t = val(r, 'task'); if (t === null || t === '') continue; t = String(t);
      const b = blocks[blocks.length - 1]; if (b && b[0] === t) b[1].push(r); else blocks.push([t, [r]]);
    }
    let lastAll = hr;
    for (const [t, rs] of blocks) {
      const header = rs.find(r => typeof val(r, 'bud') === 'number');
      if (header === undefined) { log('warn', `${name}: blok task ${t} tanpa baris budget, dilewati`); continue; }
      const bud = val(header, 'bud'), det = rs.filter(r => r !== header && has(r)), last = Math.max(header, ...det);
      lastAll = Math.max(lastAll, last);
      const tk = tasks.find(x => x.no === t && x.budget !== null && Math.abs(x.budget - bud) < 1);
      if (!tk) { log('warn', `${name}: task ${t} (budget ${idn(bud)}) tidak ada pasangan di monitoring, dilewati`); continue; }
      log('ok', `${name}: task ${t} dipasangkan dengan monitoring (budget sama), ${det.length} baris diperiksa`);
      const used = new Set();
      for (const r of det) {
        let rid = String(val(r, 'rid') === null ? '' : val(r, 'rid')).trim(), pr = String(val(r, 'pr') === null ? '' : val(r, 'pr')).trim();
        if (pr.endsWith('.0')) pr = pr.slice(0, -2); if (rid.endsWith('.0')) rid = rid.slice(0, -2);
        let rec = null;
        if (DIGITS.test(rid)) {
          const cs = tk.recs.filter(x => x.type === 'ACTUAL' && x.rid === rid && !used.has(x)), tv = val(r, 'nrid'), tot = cs.reduce((a, x) => a + (x.raw || 0), 0);
          if (cs.length > 1 && typeof tv === 'number' && Math.abs(tot - tv) < 1 && !cs.some(x => Math.abs((x.raw || 0) - tv) < 1)) rec = Object.assign({}, cs[0], { raw: tot, npr: null, npo: null, _agg: cs });
          else rec = cs.find(x => typeof tv === 'number' && Math.abs((x.raw || 0) - tv) < 1) || cs[0] || null;
        } else if (DIGITS.test(pr) && !rid) rec = tk.recs.find(x => x.pr === pr && x.po) || tk.recs.find(x => x.pr === pr) || null;
        if (!rec) continue;
        used.add(rec); (rec._agg || []).forEach(x => used.add(x));
        const mon = rec.date ? rec.date.slice(3, 6).toUpperCase() : '';
        const want = { ct: rec.ct || null, sup: rec.sup || null, desc: rec.desc || null, pr: DIGITS.test(rec.pr || '') ? Number(rec.pr) : null, npr: rec.npr, po: DIGITS.test(rec.po || '') ? Number(rec.po) : null, npo: rec.npo };
        if (DIGITS.test(rid)) { want.drid = mon in EN ? MONTHS[EN[mon]] : null; want.nrid = rec.raw; }
        for (const [k, v] of Object.entries(want)) {
          if (!col[k] || v === null || v === undefined || v === '') continue;
          const cur = cell(r, k);
          if (!cur || cur.blank) { if (sx.setValue(col[k], r, v)) stats.filled++; else log('warn', `${name}!${col[k]}${r}: baris tidak ada di file, tidak diisi`); }
          else if ((k === 'npr' || k === 'npo' || k === 'nrid') && typeof cur.v === 'number' && Math.abs(cur.v - v) > 0.5) { stats.warn++; log('warn', `${name}!${col[k]}${r}: berisi ${idn(cur.v)}, monitoring ${idn(v)} (tidak ditimpa)`); }
        }
      }
      for (const k of ['npr', 'npo', 'raw', 'nrid']) {
        const c = cell(header, k); if (!col[k] || !c || !c.fRaw || c.isShared) continue;
        const m = (sx.formula(c) || '').match(SUM_RE);
        if (m && (+m[2] !== header + 1 || +m[4] < last)) {
          const nf = `SUM(${col[k]}${header + 1}:${col[k]}${Math.max(+m[4], last)})`, before = sx.formula(c);
          sx.setFormula(col[k], header, nf); stats.fixed++;
          stats.fixes.push({ sheet: name, cell: col[k] + header, before, after: nf, rule: 'rentang subtotal blok disesuaikan dengan seluruh baris blok' });
          log('ok', `${name}!${col[k]}${header}: rumus ${before} diperbaiki menjadi ${nf}`);
        }
      }
    }
    for (const c of sx.rowCells(hr - 1)) {
      const m = c.fRaw && !c.isShared ? (sx.formula(c) || '').match(SUB_RE) : null;
      if (m && +m[4] < lastAll) {
        const before = sx.formula(c), nf = `SUBTOTAL(9,${m[1]}${m[2]}:${m[3]}${lastAll})`;
        sx.setFormula(c.col, c.row, nf); stats.fixed++;
        stats.fixes.push({ sheet: name, cell: c.ref, before, after: nf, rule: 'rentang subtotal diperluas ke baris terakhir data' });
        log('ok', `${name}!${c.ref}: rentang subtotal diperluas ke baris ${lastAll}`);
      }
    }
    return true;
  }

  /* ================= Perbaikan rumus ================= */
  const IFERR_RE = /^\s*(IFERROR|IFNA|ISERROR)\(/i, TERM_RE = /^(?:'[^']+'!|[A-Za-z0-9_.]+!)?(?:\$?[A-Z]{1,3}\$?\d+|#REF!)$/, SUM_COL_RE = /^SUM\(\$?([A-Z]{1,3})\$?(\d+):\$?\1\$?(\d+)\)$/;
  function splitPlus(f) {
    const parts = []; let depth = 0, quote = false, cur = '';
    for (const ch of f) {
      if (ch === "'") quote = !quote;
      if (!quote) { depth += (ch === '(') - (ch === ')'); if (ch === '+' && depth === 0) { parts.push(cur); cur = ''; continue; } }
      cur += ch;
    }
    parts.push(cur); return parts;
  }
  function siblingSumRange(sx, c) {
    const cnt = new Map();
    for (const o of sx.rowCells(c.row)) {
      if (o === c || o.fAttrs === null) continue;
      const m = (sx.formula(o) || '').trim().match(SUM_COL_RE);
      if (m) { const k = m[2] + ',' + m[3]; cnt.set(k, (cnt.get(k) || 0) + 1); }
    }
    let best = null, n = 0; for (const [k, v] of cnt) if (v > n) { best = k; n = v; }
    return best ? best.split(',').map(Number) : null;
  }
  function rewriteRef(f, c, sx) {
    const s = f.trim();
    if (s === 'SUM(#REF!)') {
      const rng = siblingSumRange(sx, c);
      if (rng) return [`SUM(${c.col}${rng[0]}:${c.col}${rng[1]})`, null, 'rentang SUM dipulihkan dari rumus kolom sebelahnya di baris yang sama'];
      return ['0', 0, 'rentang SUM hilang dan tidak ada acuan sebelahnya; diganti 0'];
    }
    const terms = splitPlus(s);
    if (terms.length && terms.every(t => TERM_RE.test(t.trim()))) {
      const keep = terms.filter(t => !t.includes('#REF!'));
      if (keep.length) return [keep.join('+'), null, 'suku yang referensinya terhapus (#REF!) dibuang, suku valid dipertahankan'];
      return ['0', 0, 'semua suku referensinya terhapus (#REF!); diganti 0'];
    }
    return ['0', 0, 'rumus memuat #REF! dengan bentuk kompleks; diganti 0'];
  }
  function sameSheetRefs(f) {
    const out = new Set(), parts = f.split(PROTECT_RE);
    for (let i = 0; i < parts.length; i += 2) for (const m of parts[i].matchAll(REF_RE)) { if (parts[i].slice(Math.max(0, m.index - 1), m.index) !== '!') out.add(m[2] + m[4]); }
    return out;
  }
  function repairSheet(sx, name, fixes) {
    const rootL = [], other = [];
    const sorted = [...sx.cells.values()].sort((a, b) => a.row - b.row || (a.col < b.col ? -1 : a.col > b.col ? 1 : 0));
    for (const c of sorted) {
      const f = sx.formula(c), hasRef = f !== null && f.includes('#REF!');
      if (!(c.isError || hasRef)) continue;
      (hasRef || f === null ? rootL : other).push([c, f]);
    }
    if (!rootL.length && !other.length) return 0;
    const fixed = new Set(), plan = new Map();
    for (const [c, f] of rootL) {
      if (f === null) plan.set(c.ref, ['clear', null, null, 'nilai error (tanpa rumus) dikosongkan']);
      else { const [nf, cached, why] = rewriteRef(f, c, sx); plan.set(c.ref, ['formula', nf, cached, why]); }
      fixed.add(c.ref);
    }
    for (const [c, f] of other) {
      if (!f || IFERR_RE.test(f)) plan.set(c.ref, ['cache', null, null, 'cache error dibersihkan']);
      else if ([...sameSheetRefs(f)].some(r => fixed.has(r))) plan.set(c.ref, ['cache', null, null, 'bergantung pada sel yang sudah diperbaiki; error dihitung ulang']);
      else plan.set(c.ref, ['formula', `IFERROR(${f},0)`, 0, `dibungkus IFERROR (${c.v})`]);
    }
    const byRef = new Map([...rootL, ...other].map(([c]) => [c.ref, c]));
    const groups = new Set();
    for (const [c] of [...rootL, ...other]) if (c.isShared && plan.get(c.ref)[0] === 'formula') groups.add(SheetXml.siOf(c));
    for (const si of groups) for (const m of sx.groupMembers(si)) { if (!plan.has(m.ref)) plan.set(m.ref, ['formula', sx.formula(m), 'keep', 'rumus bersama dibuka menjadi rumus biasa']); if (!byRef.has(m.ref)) byRef.set(m.ref, m); }
    let n = 0;
    for (const [ref, [kind, nf, cached, why]] of plan) {
      const c = byRef.get(ref), before = c.fAttrs !== null ? sx.formula(c) : `(nilai ${c.v})`;
      if (kind === 'clear') sx.clearValue(c);
      else if (kind === 'cache') sx.clearCache(c);
      else {
        const fa = c.fAttrs && c.fAttrs.includes('t="array"') ? c.fAttrs : '';
        const keep = cached === 'keep';
        sx.setFormula(c.col, c.row, nf, keep ? (!c.isError && typeof c.v === 'number' ? c.v : null) : cached, fa);
        if (why.startsWith('rumus bersama')) continue;
      }
      n++; fixes.push({ sheet: name, cell: ref, before, after: kind === 'formula' ? nf : '', rule: why });
    }
    return n;
  }

  /* ================= Orkestrasi ================= */
  async function loadSst(z) {
    if (!z.map.has('xl/sharedStrings.xml')) return [];
    const x = await textOf(z, 'xl/sharedStrings.xml');
    return [...x.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => xunesc([...m[1].replace(/<rPh[\s\S]*?<\/rPh>/g, '').matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(a => a[1]).join('')));
  }
  async function sheetPaths(z) {
    const wb = await textOf(z, 'xl/workbook.xml'), rel = await textOf(z, 'xl/_rels/workbook.xml.rels'), tg = {};
    for (const m of rel.matchAll(/<Relationship\s[^>]*>/g)) { const i = m[0].match(/\bId="([^"]+)"/), t = m[0].match(/\bTarget="([^"]+)"/); if (i && t) tg[i[1]] = t[1]; }
    return [...wb.matchAll(/<sheet\s[^>]*>/g)].map(m => { const t = tg[m[0].match(/r:id="([^"]+)"/)[1]]; return [xunesc(m[0].match(/name="([^"]*)"/)[1]), t.startsWith('/') ? t.slice(1) : 'xl/' + t]; });
  }
  const countErrors = xml => (xml.match(/<c r="[A-Z]+\d+"[^>]*?\bt="e"/g) || []).length;
  const tick = () => new Promise(r => setTimeout(r, 0));

  async function processWorkbook(name, u8, tasks, log) {
    const z = readZip(u8), sst = await loadSst(z), stats = { filled: 0, warn: 0, fixed: 0, fixes: [] }, replaced = new Map();
    let rb = 0, ra = 0, dimsOk = true, errs = 0;
    for (const [sname, path] of await sheetPaths(z)) {
      if (!z.map.has(path)) continue;
      await tick();
      const xml = await textOf(z, path), sx = new SheetXml(xml, sst);
      if (tasks.length) fillSheet(sx, sname, tasks, stats, log);
      const n = repairSheet(sx, sname, stats.fixes);
      if (n) { stats.fixed += n; log('ok', `${sname}: ${n} sel dengan error diperbaiki otomatis`); }
      const out = sx.edits.size ? sx.render() : xml;
      const d0 = xml.match(/<dimension ref="([^"]+)"/), d1 = out.match(/<dimension ref="([^"]+)"/);
      rb += (xml.match(/<row /g) || []).length; ra += (out.match(/<row /g) || []).length;
      dimsOk = dimsOk && (d0 ? d0[1] : null) === (d1 ? d1[1] : null);
      errs += countErrors(out);
      if (out !== xml) replaced.set(path, out);
    }
    const wb = await textOf(z, 'xl/workbook.xml');
    replaced.set('xl/workbook.xml', wb.replace(/<calcPr([^>]*?)(\/?)>/, (m, a, s) => a.includes('fullCalcOnLoad') ? m : `<calcPr${a} fullCalcOnLoad="1"${s}>`));
    const blob = await writeZip(z, replaced);
    Object.assign(stats, { rows: ra, size_ok: rb === ra && dimsOk, errors_left: errs });
    return { blob, stats };
  }

  async function run(workbooks, monitorings) {
    const lines = [], log = (level, text) => lines.push({ level, text }), tasks = [];
    for (const [n, d] of monitorings) {
      const t = parseMonitoring(typeof d === 'string' ? d : dec.decode(d)); tasks.push(...t);
      log('ok', `Monitoring ${n}: ${t.length} blok task, ${t.reduce((a, x) => a + x.recs.length, 0)} transaksi`);
    }
    if (!monitorings.length) log('warn', 'Tidak ada file monitoring: hanya perbaikan rumus yang dijalankan.');
    const results = [];
    for (const [n, d] of workbooks) {
      try {
        const { blob, stats } = await processWorkbook(n, d, tasks, log);
        log(stats.size_ok ? 'ok' : 'err', `${n}: ukuran tabel ${stats.size_ok ? 'tidak berubah' : 'BERUBAH, mohon periksa'} (${stats.rows} baris di seluruh sheet); sel error tersisa: ${stats.errors_left}`);
        results.push({ name: n.replace(/\.xls[xm]$/i, '') + ' (terisi).xlsx', blob, stats });
      } catch (e) { log('err', `${n}: gagal diproses (${e.message})`); }
    }
    return { results, lines };
  }

  const api = { run, processWorkbook, parseMonitoring, isMonitoring, translate, SheetXml, repairSheet, splitPlus, readZip, writeZip, createZip, textOf, crc32 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.AnggaranEngine = api;
})(typeof self !== 'undefined' ? self : globalThis);
