'use strict';
const test = require('node:test');
const assert = require('node:assert');
const E = require('../assets/engine.js');

const NS = '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:C3"/><sheetData>%</sheetData></worksheet>';
const sheet = rows => NS.replace('%', rows.map(([r, c]) => `<row r="${r}">${c}</row>`).join(''));
function repair(rows) { const sx = new E.SheetXml(sheet(rows), []), fixes = [], n = E.repairSheet(sx, 'S', fixes); return { n, fixes, out: new E.SheetXml(sx.render(), []) }; }

test('translate: relatif, absolut, sheet, string, fungsi', () => {
  assert.equal(E.translate('A1+$B$2+C$3', 2, 1), 'B3+$B$2+D$3');
  assert.equal(E.translate("'RINCIAN EP'!J127+\"A1\"", 1, 0), "'RINCIAN EP'!J128+\"A1\"");
  assert.equal(E.translate('LOG10(A1)', 1, 0), 'LOG10(A2)');
});
test('splitPlus menghormati tanda kutip dan kurung', () => {
  assert.deepEqual(E.splitPlus("'A B'!C1+SUM(A1+A2)+D4"), ["'A B'!C1", 'SUM(A1+A2)', 'D4']);
});
test('SUM(#REF!) dipulihkan dari kolom sebelahnya', () => {
  const { n, out } = repair([[5, '<c r="A5"><f>SUM(A6:A9)</f><v>3</v></c><c r="B5" t="e"><f>SUM(#REF!)</f><v>#REF!</v></c><c r="C5"><f>SUM(C6:C9)</f><v>2</v></c>']]);
  assert.equal(n, 1); assert.equal(out.formula(out.get('B', 5)), 'SUM(B6:B9)');
});
test('suku #REF! dibuang; semua rusak menjadi 0', () => {
  const { out } = repair([[1, "<c r=\"A1\" t=\"e\"><f>'X'!J1+'X'!#REF!</f><v>#REF!</v></c><c r=\"A2\" t=\"e\"><f>'X'!#REF!+'X'!#REF!</f><v>#REF!</v></c>"]]);
  assert.equal(out.formula(out.get('A', 1)), "'X'!J1"); assert.equal(out.formula(out.get('A', 2)), '0');
});
test('#DIV/0! dibungkus IFERROR dan rumus bersama dibuka', () => {
  const { n, out } = repair([
    [1, '<c r="B1" t="e"><f t="shared" ref="B1:B3" si="0">A1/C1</f><v>#DIV/0!</v></c>'],
    [2, '<c r="B2"><f t="shared" si="0"/><v>5</v></c>'],
    [3, '<c r="B3" t="e"><f t="shared" si="0"/><v>#DIV/0!</v></c>']]);
  assert.equal(n, 2);
  assert.equal(out.formula(out.get('B', 1)), 'IFERROR(A1/C1,0)');
  assert.equal(out.formula(out.get('B', 2)), 'A2/C2');
  assert.equal(out.formula(out.get('B', 3)), 'IFERROR(A3/C3,0)');
  assert.ok(![...out.cells.values()].some(c => c.isError));
});
test('nilai error tanpa rumus dikosongkan; sheet bersih tidak disentuh', () => {
  assert.ok(repair([[1, '<c r="A1" t="e"><v>#N/A</v></c>']]).out.get('A', 1).blank);
  const sx = new E.SheetXml(sheet([[1, '<c r="A1"><v>1</v></c>']]), []);
  assert.equal(E.repairSheet(sx, 'S', []), 0);
});
test('setValue hanya di baris yang sudah ada (ukuran tabel tetap)', () => {
  const sx = new E.SheetXml(sheet([[1, '<c r="A1"><v>1</v></c>']]), []);
  assert.equal(sx.setValue('C', 1, 'x'), true); assert.equal(sx.setValue('C', 9, 'x'), false);
  const out = sx.render(); assert.equal((out.match(/<row /g) || []).length, 1); assert.ok(out.indexOf('r="A1"') < out.indexOf('r="C1"'));
});
test('parseMonitoring membaca tabel bersarang', () => {
  const cells = a => a.map(t => `<td>${t}</td>`).join('');
  const rec = ['ACTUAL', 'PO RECEIPT', '1517260106', '1,000', '1517004201', '0017.PJ', '', '900', "'140101", '10-APR-2026', '', '', '', '', 'deskripsi', '', '', 'PT X', '900', '', '', '', '', ''];
  const html = `<table><tr>${cells(["'01", 'n', 'd', '', 'o', '', '', '', '', '', '2026', '', '5,000'])}<td><table><tr>${cells(rec)}</tr></table></td></tr></table>`;
  const t = E.parseMonitoring(html);
  assert.equal(t.length, 1); assert.equal(t[0].no, '01'); assert.equal(t[0].budget, 5000);
  assert.equal(t[0].recs[0].raw, 900); assert.equal(t[0].recs[0].pr, '1517260106'); assert.equal(t[0].recs[0].rid, '140101');
});
test('ZIP: tulis ulang menjaga isi dan CRC; end-to-end memperbaiki error', async () => {
  const wbXml = '<workbook xmlns:r="x"><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets><calcPr calcId="1"/></workbook>';
  const zip = await E.createZip({
    '[Content_Types].xml': '<Types/>', 'xl/workbook.xml': wbXml,
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': sheet([[1, '<c r="A1" t="e"><f>1/0</f><v>#DIV/0!</v></c>']])
  });
  const log = [], { blob, stats } = await E.processWorkbook('t.xlsx', zip, [], (l, t) => log.push(t));
  assert.equal(stats.fixed, 1); assert.equal(stats.errors_left, 0); assert.ok(stats.size_ok);
  const z2 = E.readZip(new Uint8Array(await blob.arrayBuffer()));
  assert.match(await E.textOf(z2, 'xl/worksheets/sheet1.xml'), /IFERROR\(1\/0,0\)/);
  assert.match(await E.textOf(z2, 'xl/workbook.xml'), /fullCalcOnLoad="1"/);
  assert.equal(await E.textOf(z2, '[Content_Types].xml'), '<Types/>');
});
