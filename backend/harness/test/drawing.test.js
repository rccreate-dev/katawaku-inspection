'use strict';
/**
 * 図面(確認箇所の書き込み)のハーネス単体テスト(SPEC 版1.6)。
 *   C-DRAW-05 PDFの中身(§10.2c)/ C-DRAW-06 旧形式シートへの列追加(§2.9a)。
 * C-DRAW-01〜04 の契約テストは tests/contract/drawing.test.js(別担当)。ここでは最低限の動作確認だけ併せて行う。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { fresh, rid, photoParams, nowPlus, fillAll } = require('./helpers');

const h = fresh();
const tanaka = h.as('u_tanaka'), sato = h.as('u_sato');
test.beforeEach(() => h.resetAll());

function newRecord() {
  const recordId = rid('r');
  const r = tanaka('createRecord', { recordId, siteId: 's_a', floor: '1F', lot: 'D' + Math.floor(Math.random() * 1e9), stage: 'pre_pour', pourPlannedAt: nowPlus(h, 72 * 60) });
  assert.equal(r.ok, true, JSON.stringify(r));
  return recordId;
}
const drawing = (recordId, side, extra) => photoParams(recordId, null, side, Object.assign({
  kind: 'drawing', markers: [{ itemId: 'i9', label: '④-1', x: 0.2, y: 0.4 }, { itemId: 'i9', label: '④-2', x: 0.5, y: 0.5 }],
  takenAt: nowPlus(h, -1), width: 1600, height: 900,
}, extra || {}));

test('C-DRAW-05 PDF: 図面ページ(1枚1ページ・凡例・固定レイアウト)。写真ページに図面を含めない。0枚なら出さない', () => {
  // 図面0枚のPDF
  const id0 = newRecord();
  fillAll(h, tanaka, id0, 'self');
  assert.equal(tanaka('submitRecord', { recordId: id0, round: 1 }, { pin: '1111' }).ok, true);
  assert.equal(sato('claimReview', { recordId: id0, round: 1 }).ok, true);
  fillAll(h, sato, id0, 'qa');
  assert.equal(sato('submitVerdict', { recordId: id0, round: 1, verdict: 'ok' }, { pin: '3333' }).ok, true);
  assert.equal(sato('generateReport', { recordId: id0 }).ok, true);
  const html0 = h.state.lastHtml;
  assert.ok(!html0.includes('確認箇所(図面)'), '図面0枚では見出しも出さない');
  const photoBlocks0 = (html0.match(/<table class="pb"/g) || []).length;

  // 図面2枚(職長1: 横長 / 管理者1: 縦長)
  const id = newRecord();
  fillAll(h, tanaka, id, 'self', { patch: (i) => (i.itemId === 'i9' ? { values: [2, -1] } : null) });
  const d1 = tanaka('uploadPhotoChunk', drawing(id, 'self'));
  assert.equal(d1.ok, true, JSON.stringify(d1));
  assert.equal(tanaka('submitRecord', { recordId: id, round: 1 }, { pin: '1111' }).ok, true);
  assert.equal(sato('claimReview', { recordId: id, round: 1 }).ok, true);
  fillAll(h, sato, id, 'qa');
  const d2 = sato('uploadPhotoChunk', drawing(id, 'qa', { width: 900, height: 1600, markers: [{ itemId: 'i9', label: '④-1', x: 0.1, y: 0.1 }] }));
  assert.equal(d2.ok, true, JSON.stringify(d2));
  assert.equal(sato('submitVerdict', { recordId: id, round: 1, verdict: 'ok' }, { pin: '3333' }).ok, true);
  const g = sato('generateReport', { recordId: id });
  assert.equal(g.ok, true, JSON.stringify(g));
  const html = h.state.lastHtml;

  assert.equal((html.match(/<div style="page-break-before:always"><h2>確認箇所\(図面\)<\/h2>/g) || []).length, 2, '図面ごとに改ページ+見出し');
  assert.ok(html.includes('>実測値</th>'), '凡例に実測値列(1.6.4)');
  assert.ok(html.includes('>④-1</td>') && html.includes('>④-2</td>'), '凡例は label ごとに1行(1.6.4)');
  assert.ok(html.includes('>+2mm</td>') && html.includes('>-1mm</td>'), '凡例に実測値(符号付き・単位つき)(1.6.4)');
  assert.match(html, /No\.\d+ /, '凡例に No. と項目文');
  assert.ok(html.includes('width:186mm;') || html.includes('<img style="width:186mm"'), '横長は width:186mm');
  assert.ok(html.includes('<img style="width:186mm"'), '横長画像');
  assert.ok(html.includes('<img style="height:170mm"'), '縦長は height:170mm');
  assert.ok(html.includes('職長: ') && html.includes('管理者: '), '登録者区分');
  assert.ok(!/display:\s*(flex|grid)|calc\(/.test(html), 'flex/grid/calc を使わない');
  // 順序: 項目表 → 確認箇所 → NG・是正の経過
  const iItems = html.indexOf('<h2>項目表</h2>'), iDraw = html.indexOf('確認箇所(図面)'), iNg = html.indexOf('<h2>NG・是正の経過</h2>');
  assert.ok(iItems >= 0 && iItems < iDraw && iDraw < iNg, '項目表の後・NG・是正の経過の前');
  // 写真ページに図面を含めない(枚数は図面なしの記録と同じ)
  assert.equal((html.match(/<table class="pb"/g) || []).length, photoBlocks0, '写真ブロック数は図面に影響されない');
  // 図面だけ(項目なし)は写真の枚数・提出検査に数えない
  const rec = tanaka('getRecord', { recordId: id });
  assert.equal(rec.ok, true);
  assert.equal(rec.data.record.drawings.length, 2);
});

test('C-DRAW-06 旧形式シート(kind,markers なし)へ setupSheets が列を補い、kind 空の既存行は photo 扱い', () => {
  const ss = h.ctx.Repo.ss();
  const sh = ss.getSheetByName('Photos');
  const cols = Array.from(h.ctx.SCHEMA_COLUMNS.Photos);
  assert.deepEqual(cols.slice(-2), ['kind', 'markers']);
  const n = cols.length;
  // 旧形式に戻す: 末尾2列のヘッダとデータを空にする
  const lastRow = sh.getLastRow();
  sh.getRange(1, n - 1, lastRow, 2).setValues(Array.from({ length: lastRow }, () => ['', '']));
  assert.equal(sh.getLastColumn(), n - 2, '旧形式=列数が2少ない');
  const before = h.control('state', { sheet: 'Photos' }).data.rows.length;
  assert.ok(before > 0);
  assert.doesNotThrow(() => h.ctx.setupSheets());
  assert.deepEqual(Array.from(sh.getRange(1, 1, 1, n).getValues()[0]), cols, '不足列ヘッダが末尾に補われる');
  const rows = h.control('state', { sheet: 'Photos' }).data.rows;
  assert.equal(rows.length, before, 'データ行は触らない');
  assert.ok(rows.every((r) => !r.kind), '既存行の kind は空のまま');
  // 既存行は photo 扱い(項目の写真として出て、drawings には出ない)
  const seeded = rows.find((r) => r.itemId && r.side === 'self');
  const g = h.as('u_lead')('getRecord', { recordId: seeded.recordId });
  assert.equal(g.ok, true, JSON.stringify(g));
  const d = g.data.record;
  assert.deepEqual(Array.from(d.drawings), []);
  const it = d.items.find((x) => x.itemId === seeded.itemId);
  const meta = it.self.photos.find((p) => p.photoId === seeded.photoId);
  assert.ok(meta, '旧行は項目の写真に出る');
  assert.equal(meta.kind, 'photo');
  assert.equal(meta.markers, null);
  // 再実行しても何も変わらない(冪等)
  assert.doesNotThrow(() => h.ctx.setupSheets());

  // 順序違い・余分な列は従来どおりエラー
  sh.getRange(1, 1, 1, 2).setValues([['recordId', 'photoId']]);
  assert.throws(() => h.ctx.setupSheets(), /一致しません/);
  sh.getRange(1, 1, 1, 2).setValues([['photoId', 'recordId']]);
  sh.getRange(1, n + 1).setValue('extra');
  assert.throws(() => h.ctx.setupSheets(), /一致しません/);
});
