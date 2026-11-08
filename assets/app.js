'use strict';
const $ = s => document.querySelector(s);
const E = window.AnggaranEngine;
let files = []; // {file, role}
const isKK = n => /\.xls[xm]$/i.test(n);

if (typeof DecompressionStream === 'undefined' || typeof CompressionStream === 'undefined') $('#support').hidden = false;

async function classify(f) {
  if (isKK(f.name)) return 'kk';
  const head = new TextDecoder().decode(await f.slice(0, 400000).arrayBuffer());
  return E.isMonitoring(head) ? 'mon' : 'x';
}
async function add(list) {
  for (const f of list) {
    if (files.some(x => x.file.name === f.name && x.file.size === f.size)) continue;
    files.push({ file: f, role: await classify(f) });
  }
  draw();
}
function draw() {
  const c = $('#chips'); c.innerHTML = '';
  files.forEach((x, i) => {
    const d = document.createElement('div'); d.className = 'chip';
    const n = document.createElement('span'); n.className = 'n'; n.textContent = x.file.name;
    const t = document.createElement('span'); t.className = 'tag' + (x.role === 'x' ? ' x' : ''); t.textContent = { kk: 'Kertas kerja', mon: 'Monitoring', x: 'Tidak dikenali' }[x.role];
    const b = document.createElement('button'); b.textContent = '×'; b.onclick = () => { files.splice(i, 1); draw(); };
    d.append(n, t, b); c.appendChild(d);
  });
  $('#go').disabled = !files.some(x => x.role === 'kk');
  $('#clr').disabled = !files.length;
}
const dz = $('#drop'), inp = $('#inp');
dz.onclick = () => inp.click();
inp.onchange = () => { add([...inp.files]); inp.value = ''; };
dz.ondragover = e => { e.preventDefault(); dz.classList.add('on'); };
dz.ondragleave = () => dz.classList.remove('on');
dz.ondrop = e => { e.preventDefault(); dz.classList.remove('on'); add([...e.dataTransfer.files]); };
$('#clr').onclick = () => { files = []; $('#res').hidden = true; draw(); };

function dlBtn(label, name, blob, primary) {
  const b = document.createElement('button'); if (primary) b.className = 'p'; b.textContent = label;
  b.onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };
  return b;
}

$('#go').onclick = async () => {
  const go = $('#go'); go.disabled = true; go.textContent = 'Memproses…';
  try {
    const wbs = [], mons = [];
    for (const x of files) {
      if (x.role === 'kk') wbs.push([x.file.name, new Uint8Array(await x.file.arrayBuffer())]);
      else if (x.role === 'mon') mons.push([x.file.name, await x.file.text()]);
    }
    const { results, lines } = await E.run(wbs, mons);
    files.filter(x => x.role === 'x').forEach(x => lines.push({ level: 'warn', text: `${x.file.name}: format tidak dikenali, dilewati` }));
    $('#res').hidden = false;
    const log = $('#log'); log.innerHTML = '';
    lines.forEach(l => { const d = document.createElement('div'); d.className = l.level; d.textContent = ({ ok: '✓ ', warn: '! ', err: '✗ ' }[l.level] || '') + l.text; log.appendChild(d); });
    const S = { filled: 0, fixed: 0, warn: 0, errors_left: 0 };
    results.forEach(r => { for (const k in S) S[k] += r.stats[k] || 0; });
    $('#stats').innerHTML = [['Sel terisi', S.filled], ['Rumus diperbaiki', S.fixed], ['Selisih dilaporkan', S.warn], ['Sel error tersisa', S.errors_left]].map(([a, b]) => `<div class="st"><b>${b}</b><small>${a}</small></div>`).join('');
    const dl = $('#dl'); dl.innerHTML = '';
    results.forEach(r => dl.appendChild(dlBtn('Unduh ' + r.name, r.name, r.blob, true)));
    const all = results.flatMap(r => r.stats.fixes);
    const fx = $('#fx'); fx.innerHTML = '<tr><th>Sheet</th><th>Sel</th><th>Sebelum</th><th>Sesudah</th><th>Aturan</th></tr>';
    all.forEach(x => { const tr = document.createElement('tr'); [x.sheet, x.cell, x.before, x.after, x.rule].forEach(v => { const td = document.createElement('td'); td.textContent = v; tr.appendChild(td); }); fx.appendChild(tr); });
    const txt = lines.map(l => l.text).join('\n') + '\n\n' + all.map(x => [x.sheet, x.cell, x.before, x.after, x.rule].join(' | ')).join('\n');
    dl.appendChild(dlBtn('Unduh laporan (.txt)', 'laporan-proses.txt', new Blob([txt], { type: 'text/plain' }), false));
  } catch (e) { alert('Gagal: ' + e.message); }
  finally { go.textContent = 'Proses otomatis'; draw(); }
};
