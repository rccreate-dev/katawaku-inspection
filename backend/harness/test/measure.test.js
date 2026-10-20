'use strict';
/**
 * 元請PDFの実測の表示(SPEC 版1.11.0 §10.2d・§10.2b-A/B・§10.2c-3・§10.5.3〜10.5.5)。
 *   U-MEAS-01   measureView_ / measureCell_ の純関数(Report.gs を vm で単体評価)
 *   C-REP-07    HTML方式(/__mock/lastReportHtml 相当=h.state.lastHtml)
 *   C-REP-08    doc方式(harness-only。docShim の cellTexts / coloredTexts / boldTexts)
 *   C-DRAW-07   図面の凡例=項目ごとのグループ(HTML・doc)
 * 見た目(▲が□にならないか、折り返しの崩れ)は実GASでしか確認できない(SPEC §12.7 REAL-PDF-06)。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { fresh, rid, photoParams, nowPlus, fillAll } = require('./helpers');

const h = fresh();
const tanaka = h.as('u_tanaka'), sato = h.as('u_sato');
test.beforeEach(() => h.resetAll());

/* ================= U-MEAS-01 ================= */

const REPORT_GS = fs.readFileSync(path.join(__dirname, '..', '..', 'Report.gs'), 'utf8');
/** Report.gs だけを空の vm に読み込む(ほかの .gs・shim に依存しないことの確認を兼ねる)。結果は JSON 往復で realm 差を消す */
const unit = (() => {
  const ctx = vm.createContext({});
  vm.runInContext(REPORT_GS, ctx);
  return ctx;
})();
const J = (x) => JSON.parse(JSON.stringify(x === undefined ? null : x));
const mv = (row, side) => J(unit.measureView_(JSON.parse(JSON.stringify(row)), side || 'self'));
const rowOf = (selfValues, tol, extra) => Object.assign({ selfValues, qaValues: null, snapshot: { tol, unit: 'mm' } }, extra || {});

test('U-MEAS-01 measureView_: 書式・要約・許容超(境界は許容内)', () => {
  const chk = (row, valuesText, summaryText, overCount, n) => {
    const v = mv(row);
    assert.equal(v.valuesText, valuesText);
    assert.equal(v.summaryText, summaryText);
    assert.equal(v.overCount, overCount);
    assert.equal(v.n, n);
    assert.equal(v.values.filter((x) => x.over).length, v.overCount, '⑬ over と overCount が一致');
    return v;
  };
  // ① 境界の ±5 は許容内
  chk(rowOf([-5, -5, -2, -5, 3, -1, 5, -5], 5), '-5、-5、-2、-5、+3、-1、+5、-5', 'n=8 最小-5/最大+5/許容±5mm', 0, 8);
  // ②
  chk(rowOf([-6, 0, 5.5, 2], 5), '▲-6、0、▲+5.5、+2', 'n=4 最小-6/最大+5.5/許容±5mm ▲許容超2件', 2, 4);
  // ③
  chk(rowOf([-3, 1], 3), '-3、+1', 'n=2 最小-3/最大+1/許容±3mm', 0, 2);
  // ④ n=1 は最小/最大を出さない
  chk(rowOf([4], 3), '▲+4', 'n=1 許容±3mm ▲許容超1件', 1, 1);
  // ⑤ 許容なし
  const v5 = chk(rowOf([2, -1, 0], null), '+2、-1、0', 'n=3 最小-1/最大+2', 0, 3);
  assert.equal(v5.tol, null);
  assert.ok(!/▲|許容/.test(v5.valuesText + v5.summaryText));
  chk(rowOf([2], null), '+2', 'n=1', 0, 1);
  // ⑥ 許容が 0・''・-1・'abc'・欠落 は許容なし
  [0, '', -1, 'abc'].forEach((t) => chk(rowOf([2, -1, 0], t), '+2、-1、0', 'n=3 最小-1/最大+2', 0, 3));
  chk({ selfValues: [2, -1, 0], snapshot: {} }, '+2、-1、0', 'n=3 最小-1/最大+2', 0, 3);
  chk(rowOf([2, -1, 0], undefined), '+2、-1、0', 'n=3 最小-1/最大+2', 0, 3);
  chk(rowOf([2.5, 2.6], 2.5), '+2.5、▲+2.6', 'n=2 最小+2.5/最大+2.6/許容±2.5mm ▲許容超1件', 1, 2);
  // ⑦ 数字の文字列の許容
  chk(rowOf([5, 6], '5'), '+5、▲+6', 'n=2 最小+5/最大+6/許容±5mm ▲許容超1件', 1, 2);
  // ⑧ 有効値なし → null
  [[], null, undefined, [null, ''], [NaN]].forEach((vals) => {
    const row = { selfValues: vals, qaValues: vals, snapshot: { tol: 5, unit: 'mm' } };
    assert.equal(unit.measureView_(row, 'self'), null, JSON.stringify(vals));
    assert.equal(unit.measureView_(row, 'qa'), null);
  });
  assert.equal(unit.measureView_({ snapshot: {} }, 'self'), null, '値の欠落');
  // ⑨ 数字の文字列は数値に。無効な要素は数えない
  chk(rowOf(['3', '-2.5'], null), '+3、-2.5', 'n=2 最小-2.5/最大+3', 0, 2);
  chk(rowOf(['x', 2], null), '+2', 'n=1', 0, 1);
  // ⑩ -0
  chk(rowOf([-0, 0], null), '0、0', 'n=2 最小0/最大0', 0, 2);
  // ⑪ 単位
  chk({ selfValues: [1, 2], snapshot: { tol: 5, unit: '' } }, '+1、+2', 'n=2 最小+1/最大+2/許容±5mm', 0, 2);
  chk({ selfValues: [1, 2], snapshot: { tol: 5 } }, '+1、+2', 'n=2 最小+1/最大+2/許容±5mm', 0, 2);
  chk({ selfValues: [1, 2], snapshot: { tol: 5, unit: 'cm' } }, '+1、+2', 'n=2 最小+1/最大+2/許容±5cm', 0, 2);
  assert.equal(mv({ selfValues: [1], snapshot: { tol: 5, unit: 'cm' } }).unit, 'cm');
  // ⑫ side: 職長と管理者は別の系列
  const row = { selfValues: [1, 9], qaValues: [-2], snapshot: { tol: 5, unit: 'mm' } };
  const s = mv(row, 'self'), q = mv(row, 'qa');
  assert.equal(s.label, '職長'); assert.equal(s.side, 'self'); assert.equal(s.valuesText, '+1、▲+9');
  assert.equal(q.label, '管理者'); assert.equal(q.side, 'qa'); assert.equal(q.valuesText, '-2'); assert.equal(q.summaryText, 'n=1 許容±5mm');
  // ⑬ 入力順(並べ替えない)・戻り値の形
  const v = mv(rowOf([3, -1, 2], null));
  assert.deepEqual(v.values.map((x) => x.v), [3, -1, 2]);
  assert.deepEqual(v.values[0], { v: 3, text: '+3', over: false });
  assert.deepEqual(Object.keys(v).sort(), ['label', 'max', 'maxText', 'min', 'minText', 'n', 'overCount', 'side', 'summaryText', 'tol', 'unit', 'values', 'valuesText']);
  assert.equal(v.min, -1); assert.equal(v.max, 3); assert.equal(v.minText, '-1'); assert.equal(v.maxText, '+3');
  // ⑭ 副作用なし
  const frozen = Object.freeze({ selfValues: Object.freeze([6, -6, '3']), qaValues: Object.freeze([1]), snapshot: Object.freeze({ tol: 5, unit: 'mm' }) });
  const before = JSON.stringify(frozen);
  unit.measureView_(frozen, 'self'); unit.measureView_(frozen, 'qa');
  assert.equal(JSON.stringify(frozen), before);
});

test('U-MEAS-01⑮ measureCell_', () => {
  const c = (raw, tol) => J(unit.measureCell_(raw, tol));
  assert.deepEqual(c(-3, 2), { v: -3, text: '-3', over: true });
  assert.deepEqual(c(2, 2), { v: 2, text: '+2', over: false }, '境界は許容内');
  assert.deepEqual(c(-2, 2), { v: -2, text: '-2', over: false });
  assert.equal(c('', 2), null); assert.equal(c(null, 2), null); assert.equal(c('x', 2), null);
  assert.equal(c(undefined, 2), null); assert.equal(c(NaN, 2), null); assert.equal(c('  ', 2), null);
  assert.equal(c(4, null).over, false, '許容なしは over にならない');
  assert.deepEqual(c('3', '2'), { v: 3, text: '+3', over: true });
  assert.deepEqual(c(0, 2), { v: 0, text: '0', over: false });
  assert.equal(c(0.5, 2).text, '+0.5');
});

test('U-MEAS-01 純関数: Math/Number/String 以外のグローバルに依存しない(ソースを静的に確認)・Report.gs は単独で評価できる', () => {
  ['measureFmt_', 'measureTol_', 'measureCell_', 'measureView_'].forEach((name) => {
    const m = new RegExp('function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n\\}\\n').exec(REPORT_GS);
    assert.ok(m, name);
    // メソッド呼び出し(.xxx)と宣言・プロパティ名を除いた識別子で、使ってよいグローバルは Math / Number / String のみ
    const body = m[0].replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/'[^']*'/g, "''");
    const globals = (body.match(/(?<![.\w$])[A-Z][A-Za-z0-9_]*(?=[.(\s])/g) || []).filter((x) => !['Math', 'Number', 'String'].includes(x));
    assert.deepEqual(globals, [], name + ' が使うグローバル');
    assert.ok(!/(?<![.\w$])(isNaN|isFinite|parseFloat|parseInt|Util|Logger|JSON|Array|Object)\b/.test(body), name + ' が組込みの関数を直接呼ぶ');
  });
  assert.equal(typeof unit.measureText_, 'undefined', '旧 measureText_ は廃止');
  ['Report.gs', 'ReportDoc.gs'].forEach((f) => assert.ok(!/measureText_\(/.test(fs.readFileSync(path.join(__dirname, '..', '..', f), 'utf8')), f + ' に measureText_ の呼び出しが残っていない'));
});

/* ================= 記録の用意(C-REP-07 / 08 / C-DRAW-07 共通のデータ) ================= */

const CIRC = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
const LONG = Array.from({ length: 200 }, (_, i) => 'あいうえおかきくけこ'[i % 10]).join('');

function jpegSized(w, hh) {
  const b = Buffer.alloc(2 + 2 + 17 + 2);
  b.writeUInt16BE(0xffd8, 0); b.writeUInt16BE(0xffc0, 2); b.writeUInt16BE(17, 4);
  b[6] = 8; b.writeUInt16BE(hh, 7); b.writeUInt16BE(w, 9); b[11] = 3;
  [[1, 0x22, 0], [2, 0x11, 1], [3, 0x11, 1]].forEach((c, i) => { b[12 + i * 3] = c[0]; b[13 + i * 3] = c[1]; b[14 + i * 3] = c[2]; });
  b.writeUInt16BE(0xffd9, 21);
  return b;
}
function drawingParams(id, d) {
  const jpeg = jpegSized(1600, 900);
  return photoParams(id, null, d.side, {
    kind: 'drawing', markers: d.markers, takenAt: nowPlus(h, d.min === undefined ? -2 : d.min), width: 1600, height: 900,
    data: jpeg.toString('base64'), thumb: jpeg.toString('base64'), bytes: jpeg.length,
    sha256: require('crypto').createHash('sha256').update(jpeg).digest('hex'),
  });
}

/**
 * 打設前の qa_ok 記録(C-REP-07 のデータ)。i4 職長 [-5,-5,-2,-5,3,-1,5,-5] / i6 職長 ng [1,-3,2,-2.5]・管理者 [2,3] /
 * i5 職長 [1,2]・管理者 [7](ともに ok) / i8 職長 [2,-1,0] / i7 は値なし。管理者の結果は全項目 ok。i6・i8 に写真。
 * o.onlyI8: i8 だけ値あり(許容ありの実測が無い記録=注記が出ない)。o.long: 管理者コメント200文字(i2)。
 * o.drawings: (N)=>[{side, markers}]  (N: itemId → 項目番号)
 */
function buildPrePour(o) {
  o = o || {};
  const id = rid('r');
  assert.equal(tanaka('createRecord', { recordId: id, siteId: 's_a', floor: '1F', lot: 'M' + Math.floor(Math.random() * 1e9), stage: 'pre_pour', pourPlannedAt: nowPlus(h, 72 * 60) }).ok, true);
  const items = tanaka('getRecord', { recordId: id }).data.record.items;
  const N = {};
  items.forEach((it, i) => { N[it.itemId] = i + 1; });
  const selfSpec = o.onlyI8 ? { i8: { values: [2, -1, 0] } } : {
    i4: { values: [-5, -5, -2, -5, 3, -1, 5, -5] },
    i6: { result: 'ng', severity: 'minor', note: '開口の職長NG', values: [1, -3, 2, -2.5] },
    i5: { values: [1, 2] },
    i8: { values: [2, -1, 0] },
  };
  fillAll(h, tanaka, id, 'self', { patch: (i) => selfSpec[i.itemId] || null, photoFor: (i) => i.itemId === 'i6' || i.itemId === 'i8' });
  const defs = (o.drawings ? o.drawings(N) : []);
  defs.filter((d) => d.side === 'self').forEach((d) => assert.equal(tanaka('uploadPhotoChunk', drawingParams(id, d)).ok, true));
  const sub = tanaka('submitRecord', { recordId: id, round: 1 }, { pin: '1111' });
  assert.equal(sub.ok, true, JSON.stringify(sub));
  assert.equal(sato('claimReview', { recordId: id, round: 1 }).ok, true);
  const qaSpec = {};
  if (o.long) qaSpec.i2 = { note: LONG };
  fillAll(h, sato, id, 'qa', { patch: (i) => qaSpec[i.itemId] || null });
  defs.filter((d) => d.side === 'qa').forEach((d) => assert.equal(sato('uploadPhotoChunk', drawingParams(id, d)).ok, true));
  const v = sato('submitVerdict', { recordId: id, round: 1, verdict: 'ok' }, { pin: '3333' });
  assert.equal(v.ok, true, JSON.stringify(v));
  assert.equal(h.ctx.loadRecord_(id).status, 'qa_ok');
  // 管理者の実測(許容超の ok を含む)。SPEC §12.3 C-REP-07 のデータは「管理者が許容超の値に ok を付けた」状態だが、
  // 現在の submitVerdict は管理者側にも MEASURE_OVER_TOL_OK を適用して拒否する(SPEC §5.3.1・§10.2d-9 の記述と食い違う。報告済み)。
  // PDF の表示だけを検証したいので、判定のあとで RecordItems の qaValues をシートに直接書く。
  if (!o.onlyI8) {
    const { Repo } = h.ctx;
    Repo.resetCache();
    [['i6', [2, 3]], ['i5', [7]]].forEach(([itemId, vals]) => {
      const row = Repo.where('RecordItems', 'recordId', id).find((r) => r.itemId === itemId);
      Repo.update('RecordItems', row, { qaValues: vals });
    });
    Repo.resetCache();
  }
  return { id, N };
}

/** 出来形の qa_ok 記録: i56 職長 ng [-10,11,4](許容超の ok は提出できないので ng)・i57 職長 ok [3,-3] */
function buildPostDemold() {
  const id = rid('r');
  assert.equal(tanaka('createRecord', { recordId: id, siteId: 's_a', floor: '2F', lot: 'P' + Math.floor(Math.random() * 1e9), stage: 'post_demold' }).ok, true);
  const items = tanaka('getRecord', { recordId: id }).data.record.items;
  const N = {};
  items.forEach((it, i) => { N[it.itemId] = i + 1; });
  const fill = (as, side, spec) => {
    const save = side === 'self' ? 'saveDraft' : 'saveQaDraft';
    const r = as(save, { recordId: id, items: items.map((i) => Object.assign({ itemId: i.itemId, result: 'ok' }, spec[i.itemId] || {})) });
    assert.equal(r.ok, true, JSON.stringify(r));
    items.filter((i) => i.def.key || (side === 'self' && spec[i.itemId] && spec[i.itemId].result === 'ng')).forEach((i) => {
      assert.equal(as('uploadPhotoChunk', photoParams(id, i.itemId, side, { takenAt: nowPlus(h, -1) })).ok, true);
    });
  };
  fill(tanaka, 'self', { i56: { result: 'ng', severity: 'minor', note: 'はらみNG', values: [-10, 11, 4] }, i57: { values: [3, -3] } });
  assert.equal(tanaka('submitRecord', { recordId: id, round: 1 }, { pin: '1111' }).ok, true);
  assert.equal(sato('claimReview', { recordId: id, round: 1 }).ok, true);
  fill(sato, 'qa', {});
  assert.equal(sato('submitVerdict', { recordId: id, round: 1, verdict: 'ok' }, { pin: '3333' }).ok, true);
  return { id, N };
}

const setEngine = (v) => {
  const { Repo } = h.ctx;
  Repo.resetCache(); Repo.fresh('Config');
  const row = Repo.get('Config', 'reportEngine');
  if (row) Repo.update('Config', row, { value: v });
  else Repo.append('Config', { key: 'reportEngine', value: v, type: 'str', description: '' });
  h.ctx.clearRefCache(); Repo.resetCache();
};
const gen = (id) => { const g = sato('generateReport', { recordId: id }); assert.equal(g.ok, true, JSON.stringify(g)); return g.data.report; };
const docShim = () => h.control('docShim', {}).data;

/** HTML の取得と、項目表・写真ブロック・凡例の分解 */
const strip = (x) => x.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
function htmlItemRows(html) {
  const tbl = /<table class="items">[\s\S]*?<\/table>/.exec(html)[0];
  const out = {};
  (tbl.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || []).slice(1).forEach((tr) => {
    const cells = (tr.match(/<td[^>]*>[\s\S]*?<\/td>/g) || []);
    out[strip(cells[0])] = { tr, cells, meas: cells[4], text: strip(cells[4]) };
  });
  return out;
}
function htmlBlocks(html) { return (html.match(/<table class="pb"[\s\S]*?<\/table>/g) || []); }
function htmlLegends(html) {
  return html.split('<div style="page-break-before:always"><h2>確認箇所(図面)</h2>').slice(1).map((pg) => {
    const m = /<table style="table-layout:fixed;width:186mm;margin-top:3mm">[\s\S]*?<\/table>/.exec(pg);
    if (!m) return { page: pg, rows: null };
    const rows = (m[0].match(/<tr>[\s\S]*?<\/tr>/g) || []).map((tr) => (tr.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/g) || []));
    return { page: pg, table: m[0], rows };
  });
}
const OVER = (t) => '<span class="over" style="font-weight:bold;color:#cc0000">' + t + '</span>';

/* ================= C-REP-07 HTML方式 ================= */

test('C-REP-07 ①②③ 項目表の実測セル(文字列・マークアップ・旧形式の廃止)', () => {
  const { id, N } = buildPrePour();
  gen(id);
  const html = h.state.lastHtml;
  const r = htmlItemRows(html);
  const lines = (n) => r[String(n)].text.split('\n');
  assert.deepEqual(lines(N.i4), ['職長: -5、-5、-2、-5、+3、-1、+5、-5', 'n=8 最小-5/最大+5/許容±5mm'], '境界の ±5 は許容内(▲なし)');
  assert.deepEqual(lines(N.i6), ['職長: +1、▲-3、+2、▲-2.5', 'n=4 最小-3/最大+2/許容±2mm ▲許容超2件', '管理者: +2、▲+3', 'n=2 最小+2/最大+3/許容±2mm ▲許容超1件'], '職長の2行→管理者の2行。混ぜた要約がない');
  assert.deepEqual(lines(N.i5), ['職長: +1、+2', 'n=2 最小+1/最大+2/許容±5mm', '管理者: ▲+7', 'n=1 許容±5mm ▲許容超1件']);
  assert.deepEqual(lines(N.i8), ['職長: +2、-1、0', 'n=3 最小-1/最大+2'], '許容なし');
  assert.ok(!/許容|▲/.test(r[String(N.i8)].text));
  assert.equal(r[String(N.i7)].text, '', '値なしは空欄');
  assert.equal(r[String(N.i7)].meas.replace(/<[^>]+>/g, ''), '');
  // ② マークアップ
  const i6 = r[String(N.i6)].meas, i5 = r[String(N.i5)].meas, i4 = r[String(N.i4)].meas;
  ['▲-3', '▲-2.5', '▲+3'].forEach((t) => assert.ok(i6.includes(OVER(t)), t));
  assert.ok(i6.includes(OVER('▲許容超2件')) && i6.includes(OVER('▲許容超1件')));
  assert.ok(i5.includes(OVER('▲+7')) && i5.includes(OVER('▲許容超1件')));
  assert.equal((i6.match(/class="over"/g) || []).length, 5, 'i6: 許容超の値3つ+要約2つだけ');
  assert.equal((i5.match(/class="over"/g) || []).length, 2);
  assert.ok(!/class="over"/.test(i4), '許容内(境界を含む)の値は over の外');
  assert.ok(i6.includes('+1、<span') && i6.includes('</span>、+2、'), '区切りの「、」は over の外');
  assert.ok(i5.includes('職長: </span>+1、+2'), '許容内の +1・+2 は over の外');
  assert.ok(i6.includes('color:#555555') && i6.includes('color:#444444'), 'ラベル #555555・要約 #444444 のインライン style');
  // ③ 旧形式の廃止
  assert.ok(!html.includes(' / 許容±') && !strip(r[String(N.i4)].meas).includes(' | '), '旧: 値, 値 / 許容±N と | 連結が出ない');
  assert.ok(!/<p>.*管理者コメントの全文は/.test(html));
});

test('C-REP-07 ④ 注記: 許容ありの実測があるときだけ、項目表の直後に1段落', () => {
  const NOTE = '実測の ▲ は許容(±)を超えた値の目安です';
  const a = buildPrePour();
  gen(a.id);
  const html = h.state.lastHtml;
  assert.equal(html.split(NOTE).length - 1, 1, '注記は1つ');
  const end = html.indexOf('</table>', html.indexOf('<table class="items">')) + '</table>'.length;
  assert.ok(html.slice(end).startsWith('\n<p style="font-size:8px;color:#444444">' + NOTE), '項目表の直後の段落');
  assert.ok(html.includes('合否は職長・管理者が判定した結果(合/NG)で、▲ だけでは決まりません。許容ちょうどは許容内として扱います。'));
  const b = buildPrePour({ onlyI8: true });
  gen(b.id);
  assert.ok(!h.state.lastHtml.includes(NOTE), '許容ありの実測が無ければ注記を出さない');
  assert.ok(!h.state.lastHtml.includes('管理者コメントの全文は'));
});

test('C-REP-07 ⑤ 判定への非影響: ▲があっても ok の行は赤背景にならない。件数は実測の有無で変わらない。「不合格」「不適合」と書かない', () => {
  const { id, N } = buildPrePour();
  gen(id);
  const html = h.state.lastHtml;
  const r = htmlItemRows(html);
  assert.ok(!/fde8e8/i.test(r[String(N.i5)].tr), 'i5 は ▲+7 があっても背景なし');
  assert.ok(!/class="ng"/.test(r[String(N.i5)].tr));
  assert.ok(/fde8e8/i.test(r[String(N.i6)].tr), 'i6 は職長NGなので赤');
  Object.keys(r).forEach((n) => assert.ok(!/不合格|不適合/.test(r[n].text), n));
  assert.equal(Object.keys(r).filter((n) => /fde8e8/i.test(r[n].tr)).length, 1, '赤は NG の i6 だけ');
  // 結果サマリの件数は実測(▲)の有無で変わらない: 職長 ng=1(i6)、管理者 ng=0。ok は全項目数から引いた値
  const rows = h.ctx.itemsOf_(id);
  const total = rows.filter((x) => x.snapshot.audience !== 'qa').length, totalQa = rows.filter((x) => x.snapshot.audience !== 'foreman').length;
  const sum = /<h2>結果サマリ<\/h2>[\s\S]*?<\/table>/.exec(html)[0];
  const cells = (label) => (new RegExp('<tr><th>' + label + '</th>([\\s\\S]*?)</tr>').exec(sum)[1].match(/<td>(\d+)<\/td>/g) || []).map((c) => Number(/\d+/.exec(c)[0]));
  assert.deepEqual(cells('職長'), [total - 1, 1, 0]);
  assert.deepEqual(cells('管理者'), [totalQa, 0, 0]);
});

test('C-REP-07 ⑥ 写真ブロック: 実測(職長)/(管理者) を同じ書式で。旧形式なし。値のない項目には出さない', () => {
  const { id, N } = buildPrePour();
  gen(id);
  const html = h.state.lastHtml;
  const blocks = htmlBlocks(html);
  const of = (n) => blocks.filter((b) => strip(b).includes('No.' + n + ' '));
  const b6 = of(N.i6);
  assert.ok(b6.length >= 1);
  const t6 = strip(b6[0]).split('\n');
  const i = t6.indexOf('実測(職長): +1、▲-3、+2、▲-2.5');
  assert.ok(i >= 0, t6.join(' / '));
  assert.equal(t6[i + 1], 'n=4 最小-3/最大+2/許容±2mm ▲許容超2件');
  assert.equal(t6[i + 2], '実測(管理者): +2、▲+3');
  assert.equal(t6[i + 3], 'n=2 最小+2/最大+3/許容±2mm ▲許容超1件');
  assert.ok(b6[0].includes(OVER('▲-3')) && b6[0].includes(OVER('▲許容超2件')));
  const t8 = strip(of(N.i8)[0]).split('\n');
  const j = t8.indexOf('実測(職長): +2、-1、0');
  assert.ok(j >= 0 && t8[j + 1] === 'n=3 最小-1/最大+2', t8.join(' / '));
  assert.ok(!t8.some((l) => l.startsWith('実測(管理者)')), '管理者の値がない側は出さない');
  blocks.forEach((b) => assert.ok(!/(^|\n)実測: /.test(strip(b)), '旧形式 実測: で始まる行がない'));
  // 値のない項目の写真には「実測」を出さない(i7 は値なし。重点項目の写真で確認)
  const keyBlocks = blocks.filter((b) => !/No\.(\d+) /.test(strip(b)) || ![N.i4, N.i5, N.i6, N.i8].includes(Number(/No\.(\d+) /.exec(strip(b))[1])));
  assert.ok(keyBlocks.length > 0);
  keyBlocks.forEach((b) => assert.ok(!strip(b).includes('実測'), '値のない項目の写真に実測が出ない'));
});

test('C-REP-07 ⑦ 出来形(post_demold)にも同じ規則(i56 許容10・i57 許容3)', () => {
  const { id, N } = buildPostDemold();
  gen(id);
  const r = htmlItemRows(h.state.lastHtml);
  assert.deepEqual(r[String(N.i56)].text.split('\n'), ['職長: -10、▲+11、+4', 'n=3 最小-10/最大+11/許容±10mm ▲許容超1件']);
  assert.deepEqual(r[String(N.i57)].text.split('\n'), ['職長: +3、-3', 'n=2 最小-3/最大+3/許容±3mm']);
  assert.ok(h.state.lastHtml.includes('実測の ▲ は許容(±)を超えた値の目安です'));
});

test('C-REP-07 ⑧ レイアウト制約: flex/grid/calc を使わない。注記の要素・項目表の構造', () => {
  const { id } = buildPrePour({ drawings: (N) => [{ side: 'self', markers: [{ itemId: 'i4', label: CIRC[N.i4 - 1] + '-1', x: 0.1, y: 0.1 }] }] });
  gen(id);
  assert.ok(!/display:\s*(flex|grid)|calc\(/.test(h.state.lastHtml));
});

/* ================= C-REP-08 doc方式 ================= */

test('C-REP-08 ①〜⑦ doc方式の実測: 項目表の文字列・色/太字・注記・全文・写真ブロック・出来形・背景', () => {
  const { id, N } = buildPrePour({ long: true });
  gen(id);
  const html = h.state.lastHtml;
  const htmlRows = htmlItemRows(html);
  setEngine('doc');
  h.control('docShim', { reset: true });
  gen(id);
  assert.equal(docShim().counts.created, 1);
  const { lastDoc: d } = docShim();
  const items = d.tables.find((t) => t.cols === 7);
  const cell = (n) => items.cellTexts[Number(n)][4];   // 行 n = 項目番号 n(見出し行が 0)
  // ① html と同じ文字列(段落の区切りは \n)。i7 は ""
  Object.keys(htmlRows).forEach((n) => assert.equal(cell(n), htmlRows[n].text, '項目' + n + ' の実測'));
  assert.equal(cell(N.i7), '');
  assert.equal(cell(N.i4), '職長: -5、-5、-2、-5、+3、-1、+5、-5\nn=8 最小-5/最大+5/許容±5mm');
  // ② 色・太字
  const red = d.coloredTexts['#CC0000'];
  ['▲-3', '▲-2.5', '▲+3', '▲+7', '▲許容超2件', '▲許容超1件'].forEach((t) => assert.ok(red.includes(t), '赤: ' + t + ' / ' + JSON.stringify(red)));
  ['+1', '+2', '-5', '+5', '0', '-1'].forEach((t) => assert.ok(!red.includes(t), '許容内は赤にしない: ' + t));
  ['▲-3', '▲-2.5', '▲+3', '▲+7', '▲許容超2件', '▲許容超1件'].forEach((t) => assert.ok(d.boldTexts.includes(t), '太字: ' + t));
  ['+1', '+2', '-5', '+5'].forEach((t) => assert.ok(!d.boldTexts.includes(t), '許容内は太字にしない: ' + t));
  assert.ok(d.coloredTexts['#555555'].includes('職長: ') && d.coloredTexts['#444444'].includes('n=8 最小-5/最大+5/許容±5mm'), 'ラベル・要約の色');
  // ③ 注記: 項目表の直後の本文段落。旧注記なし
  const NOTE = '実測の ▲ は許容(±)を超えた値の目安です。合否は職長・管理者が判定した結果(合/NG)で、▲ だけでは決まりません。許容ちょうどは許容内として扱います。';
  const ps = d.paragraphs.map((p) => p.text);
  assert.equal(ps.filter((t) => t === NOTE).length, 1);
  assert.equal(ps.indexOf(NOTE), ps.indexOf('項目表') + 1, '項目表の直後');
  assert.ok(!d.text.includes('管理者コメントの全文は'));
  assert.ok(d.coloredTexts['#444444'].includes(NOTE));
  // ④ 管理者コメント 200 文字が全文
  assert.ok(items.cellTexts.some((row) => row[6] === LONG), '管理者コメントが項目表に全文');
  // ⑤ 写真ブロック右セル
  const blocks = d.tables.filter((t) => t.cols === 2).map((t) => t.cellTexts[0][1]);
  const b6 = blocks.find((b) => b.includes('No.' + N.i6 + ' '));
  assert.ok(b6.includes('実測(職長): +1、▲-3、+2、▲-2.5\nn=4 最小-3/最大+2/許容±2mm ▲許容超2件\n実測(管理者): +2、▲+3\nn=2 最小+2/最大+3/許容±2mm ▲許容超1件'), b6);
  const b8 = blocks.find((b) => b.includes('No.' + N.i8 + ' '));
  assert.ok(b8.includes('実測(職長): +2、-1、0\nn=3 最小-1/最大+2') && !b8.includes('実測(管理者)'), b8);
  blocks.filter((b) => b.includes('実測')).forEach((b) => assert.ok(!/(^|\n)実測: /.test(b)));
  // ⑦ 背景: i5 の行(▲+7・ok)は null、i6(職長NG)は赤、見出し行は #EEEEEE
  const bg = (n) => items.cellBackgrounds[Number(n)];
  assert.ok(bg(N.i5).every((c) => c === null), 'i5 は背景なし');
  assert.ok(bg(N.i6).every((c) => c === '#FDE8E8'));
  assert.ok(bg(0).every((c) => c === '#EEEEEE'));
  // 列幅の合計は実効幅(C-REP-03 の列幅は reportdoc.test.js 側で新しい幅を確認)
  d.tables.forEach((t) => assert.ok(Math.abs(t.colWidths.reduce((a, b) => a + b, 0) - 184 * 72 / 25.4) <= 0.5));
});

test('C-REP-08 ③ 許容ありの実測が無い記録では注記が出ない(doc)', () => {
  const { id } = buildPrePour({ onlyI8: true });
  setEngine('doc');
  gen(id);
  const d = docShim().lastDoc;
  assert.ok(!d.text.includes('実測の ▲ は許容'));
  assert.ok(d.text.includes('n=3 最小-1/最大+2'));
});

test('C-REP-08 ⑥ 出来形(doc)でも同じ文字列', () => {
  const { id, N } = buildPostDemold();
  setEngine('doc');
  gen(id);
  const d = docShim().lastDoc;
  const items = d.tables.find((t) => t.cols === 7);
  assert.equal(items.cellTexts[N.i56][4], '職長: -10、▲+11、+4\nn=3 最小-10/最大+11/許容±10mm ▲許容超1件');
  assert.equal(items.cellTexts[N.i57][4], '職長: +3、-3\nn=2 最小-3/最大+3/許容±3mm');
  assert.ok(d.coloredTexts['#CC0000'].includes('▲+11'));
});

test('docShim 観測(SPEC §11.4): tables[i].cellTexts / coloredTexts / boldTexts。後から付けた書式が先の書式を上書きする', () => {
  const { id } = buildPrePour();
  setEngine('doc');
  gen(id);
  const d = docShim().lastDoc;
  d.tables.forEach((t) => {
    assert.equal(t.cellTexts.length, t.rows);
    t.cellTexts.forEach((r) => { assert.equal(r.length, t.cols); r.forEach((c) => assert.equal(typeof c, 'string')); });
  });
  assert.equal(typeof d.coloredTexts, 'object');
  assert.ok(Array.isArray(d.boldTexts) && d.boldTexts.length > 0);
  // 表全体を一度 setBold(false) にしてから範囲を太字にしても、太字の範囲だけが boldTexts に出る(見出し行は行全体が太字)
  assert.ok(d.boldTexts.includes('実測(設計値との差)'), '見出し行の太字');
  assert.ok(!d.boldTexts.some((t) => t.includes('職長: ')), '実測のラベルは太字にしない');
});

/* ================= C-DRAW-07 図面の凡例 ================= */

const MARKS = (N) => [
  { itemId: 'i4', label: CIRC[N.i4 - 1] + '-1', x: 0.1, y: 0.1 }, { itemId: 'i4', label: CIRC[N.i4 - 1] + '-2', x: 0.2, y: 0.1 },
  { itemId: 'i6', label: CIRC[N.i6 - 1] + '-1', x: 0.1, y: 0.2 }, { itemId: 'i6', label: CIRC[N.i6 - 1] + '-2', x: 0.2, y: 0.2 },
  { itemId: 'i6', label: CIRC[N.i6 - 1] + '-3', x: 0.3, y: 0.2 }, { itemId: 'i6', label: CIRC[N.i6 - 1] + '-4', x: 0.4, y: 0.2 },
  { itemId: 'i8', label: CIRC[N.i8 - 1], x: 0.5, y: 0.3 },
];
const drawingsA = (N) => [{ side: 'self', markers: MARKS(N) }];
const HEAD = ['番号', '項目', '実測値', '許容超', '職長', '管理者'];

test('C-DRAW-07 ①②③④ 図面の凡例(HTML): 6列・項目ごとのグループ・番号行・1行形式・許容超の装飾', () => {
  const { id, N } = buildPrePour({ drawings: drawingsA });
  gen(id);
  const lg = htmlLegends(h.state.lastHtml);
  assert.equal(lg.length, 1);
  assert.deepEqual((lg[0].table.match(/<col style="width:(\d+)mm">/g) || []).map((c) => Number(/(\d+)mm/.exec(c)[1])), [24, 76, 28, 24, 17, 17]);
  assert.ok(!/white-space:nowrap|overflow:hidden/.test(lg[0].table), '折り返しあり');
  const rows = lg[0].rows;
  assert.equal(rows.length, 10, '見出し1 + i4 グループ3 + i6 グループ5 + i8 の1行');
  const T = rows.map((r) => r.map(strip));
  assert.deepEqual(T[0], HEAD);
  const n4 = N.i4, n6 = N.i6, n8 = N.i8;
  // i4: 見出し行・番号行
  assert.equal(T[1][0], 'No.' + n4);
  assert.deepEqual(T[1][1].split('\n').slice(1), ['n=8 最小-5/最大+5/許容±5mm']);
  assert.deepEqual([T[1][2], T[1][3], T[1][4], T[1][5]], ['', '', '合', '合']);
  assert.deepEqual(T[2], [CIRC[n4 - 1] + '-1', '', '-5mm', '', '', '']);
  assert.deepEqual(T[3], [CIRC[n4 - 1] + '-2', '', '-5mm', '', '', '']);
  // i6: 職長の系列(管理者の [2,3] は出ない)
  assert.equal(T[4][0], 'No.' + n6);
  assert.deepEqual(T[4][1].split('\n').slice(1), ['n=4 最小-3/最大+2/許容±2mm ▲許容超2件']);
  assert.deepEqual([T[4][4], T[4][5]], ['NG(軽微)', '合']);
  assert.deepEqual(T.slice(5, 9), [
    [CIRC[n6 - 1] + '-1', '', '+1mm', '', '', ''], [CIRC[n6 - 1] + '-2', '', '-3mm', '▲', '', ''],
    [CIRC[n6 - 1] + '-3', '', '+2mm', '', '', ''], [CIRC[n6 - 1] + '-4', '', '-2.5mm', '▲', '', ''],
  ]);
  // i8: 見出し行なしの1行形式
  assert.equal(T[9][0], CIRC[n8 - 1]);
  assert.ok(T[9][1].startsWith('No.' + n8 + ' '), T[9][1]);
  assert.deepEqual([T[9][2], T[9][3], T[9][4], T[9][5]], ['', '', '合', '合']);
  // ③ 許容超の装飾(class="over")。許容内・i4 の行は装飾なし
  assert.ok(rows[6][2].includes(OVER('-3mm')) && rows[6][3].includes(OVER('▲')));
  assert.ok(rows[8][2].includes(OVER('-2.5mm')) && rows[8][3].includes(OVER('▲')));
  [2, 3, 5, 7, 9].forEach((i) => assert.ok(!/class="over"/.test(rows[i].join('')), '行' + i + ' は装飾なし'));
  // ④ 見出し行の背景 #EEEEEE(全セル)
  [0, 1, 4].forEach((i) => rows[i].forEach((c) => assert.ok(/background:#eee/i.test(c), '行' + i)));
  [2, 3, 5, 9].forEach((i) => rows[i].forEach((c) => assert.ok(!/background:#eee/i.test(c))));
  assert.ok(!/display:\s*(flex|grid)|calc\(/.test(h.state.lastHtml));
});

test('C-DRAW-07 ①②③④ 図面の凡例(doc): 6列・cellTexts・太字/赤・背景', () => {
  const { id, N } = buildPrePour({ drawings: drawingsA });
  setEngine('doc');
  gen(id);
  const d = docShim().lastDoc;
  const lgs = d.tables.filter((t) => t.cols === 6);
  assert.equal(lgs.length, 1);
  const t = lgs[0];
  [24, 76, 28, 24, 17, 17].forEach((mm, i) => assert.ok(Math.abs(t.colWidths[i] - mm * (184 / 186) * 72 / 25.4) <= 0.5));
  assert.ok(Math.abs(t.colWidths.reduce((a, b) => a + b, 0) - 184 * 72 / 25.4) <= 0.5);
  assert.equal(t.rows, 10);
  const T = t.cellTexts;
  assert.deepEqual(T[0], HEAD);
  assert.equal(T[1][0], 'No.' + N.i4);
  assert.deepEqual(T[1][1].split('\n').slice(1), ['n=8 最小-5/最大+5/許容±5mm']);
  assert.deepEqual([T[1][4], T[1][5]], ['合', '合']);
  assert.deepEqual(T[2], [CIRC[N.i4 - 1] + '-1', '', '-5mm', '', '', '']);
  assert.deepEqual(T[4][1].split('\n').slice(1), ['n=4 最小-3/最大+2/許容±2mm ▲許容超2件']);
  assert.deepEqual(T.slice(5, 9).map((r) => [r[2], r[3]]), [['+1mm', ''], ['-3mm', '▲'], ['+2mm', ''], ['-2.5mm', '▲']]);
  assert.equal(T[9][0], CIRC[N.i8 - 1]);
  assert.ok(T[9][1].startsWith('No.' + N.i8 + ' ') && !T[9][1].includes('\n'));
  // ③ 装飾
  const red = d.coloredTexts['#CC0000'];
  ['-3mm', '-2.5mm', '▲'].forEach((x) => { assert.ok(red.includes(x), '赤 ' + x); assert.ok(d.boldTexts.includes(x), '太字 ' + x); });
  ['-5mm', '+1mm', '+2mm'].forEach((x) => { assert.ok(!red.includes(x), '許容内は赤にしない ' + x); assert.ok(!d.boldTexts.includes(x)); });
  // ④ 背景: 見出し行(列見出し・項目の見出し行)は全セル #EEEEEE。番号行・1行形式は null
  const bg = t.cellBackgrounds;
  [0, 1, 4].forEach((i) => assert.ok(bg[i].every((c) => c === '#EEEEEE'), '行' + i));
  [2, 3, 5, 6, 7, 8, 9].forEach((i) => assert.ok(bg[i].every((c) => c === null), '行' + i));
  t.minRowHeights.forEach((v) => assert.ok(Math.abs(v - 17.0) <= 0.1));
  // 見出し行の項目文は太字、番号・要約は太字にしない
  assert.ok(d.boldTexts.some((b) => b.includes('開口の建入れ')));
  assert.ok(!d.boldTexts.includes('n=4 最小-3/最大+2/許容±2mm ▲許容超2件'));
});

test('C-DRAW-07 ⑤⑥ 管理者の図面は系列Sが管理者の値。印が0個の図面は「印の書き込みなし」(HTML・doc)', () => {
  const defs = (N) => [
    { side: 'qa', min: -3, markers: [{ itemId: 'i6', label: CIRC[N.i6 - 1] + '-1', x: 0.1, y: 0.1 }, { itemId: 'i6', label: CIRC[N.i6 - 1] + '-2', x: 0.2, y: 0.1 }] },
    { side: 'self', min: -1, markers: [] },
  ];
  const { id, N } = buildPrePour({ drawings: defs });
  gen(id);
  const lg = htmlLegends(h.state.lastHtml);
  assert.equal(lg.length, 2);
  const T = lg[0].rows.map((r) => r.map(strip));
  assert.equal(T.length, 4);
  assert.deepEqual(T[1][1].split('\n').slice(1), ['n=2 最小+2/最大+3/許容±2mm ▲許容超1件'], '管理者の系列');
  assert.deepEqual(T[2].slice(2, 4), ['+2mm', '']); assert.deepEqual(T[3].slice(2, 4), ['+3mm', '▲']);
  assert.ok(lg[0].rows[3][2].includes(OVER('+3mm')));
  assert.equal(lg[1].rows, null);
  assert.ok(lg[1].page.includes('印の書き込みなし'));
  // doc
  setEngine('doc');
  gen(id);
  const d = docShim().lastDoc;
  const lgs = d.tables.filter((t) => t.cols === 6);
  assert.equal(lgs.length, 1, '印のある図面だけ凡例表');
  assert.deepEqual(lgs[0].cellTexts[1][1].split('\n').slice(1), ['n=2 最小+2/最大+3/許容±2mm ▲許容超1件']);
  assert.deepEqual(lgs[0].cellTexts.slice(2).map((r) => [r[2], r[3]]), [['+2mm', ''], ['+3mm', '▲']]);
  assert.ok(d.text.includes('印の書き込みなし'));
});

test('C-DRAW-07 系列S: 図面を書いた側に有効値がなければもう一方。要素ごとの補完はしない。N と N-k が両方あると N は値が空の番号行', () => {
  // i5: 職長 [1,2]・管理者 [7]。職長の図面で i5-3(k=3)の値は職長の系列に無い → 空(管理者の値で補わない)
  const defs = (N) => [{ side: 'self', markers: [
    { itemId: 'i5', label: CIRC[N.i5 - 1], x: 0.1, y: 0.1 }, { itemId: 'i5', label: CIRC[N.i5 - 1] + '-1', x: 0.2, y: 0.1 }, { itemId: 'i5', label: CIRC[N.i5 - 1] + '-3', x: 0.3, y: 0.1 },
    { itemId: 'i7', label: CIRC[N.i7 - 1] + '-1', x: 0.4, y: 0.1 },
  ] }];
  const { id, N } = buildPrePour({ drawings: defs });
  gen(id);
  const T = htmlLegends(h.state.lastHtml)[0].rows.map((r) => r.map(strip));
  // 見出し(列) / i5 見出し / i5 N / i5 N-1 / i5 N-3 / i7 見出し / i7 N-1
  assert.equal(T.length, 7);
  assert.deepEqual(T[1][1].split('\n').slice(1), ['n=2 最小+1/最大+2/許容±5mm'], '職長の系列');
  assert.deepEqual(T[2].slice(0, 4), [CIRC[N.i5 - 1], '', '', ''], 'N の行は値が空');
  assert.deepEqual(T[3].slice(2, 4), ['+1mm', '']);
  assert.deepEqual(T[4].slice(2, 4), ['', ''], '職長の k=3 は無効値 → 空(管理者の値で補わない)');
  // i7 は両側とも値なし → 見出し行に要約なし・値は空
  assert.equal(T[5][1].split('\n').length, 1);
  assert.deepEqual(T[6].slice(2, 4), ['', '']);
});
