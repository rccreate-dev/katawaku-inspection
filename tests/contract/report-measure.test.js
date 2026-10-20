// C-REP-07 / C-REP-08 / C-DRAW-07 / C-REP-01②(版1.11.0。SPEC §12.3): 元請PDFの実測の表現
//   §10.2d(実測の表示規則)・§10.2b-A/B(項目表・写真ブロック)・§10.2c-3(図面の凡例)・§10.5.3〜10.5.5(doc 方式)
//   - 全対象(mock / harness / 実GAS): テストデータの準備(記録が qa_ok になり generateReport が成功する)
//   - harness 専用(mock・実GASではスキップ。mock は PDF を作らない=SPEC §11.3): HTML方式 = `/__mock/lastReportHtml`、doc 方式 = `/__mock/docShim` の lastDoc
// 実行: harness に対しては API_URL=http://127.0.0.1:8788/api node --test --test-concurrency=1 tests/contract/report-measure.test.js
'use strict';
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const m = require('../helpers/report-measure');
const { h } = m;

const mmPt = (x) => x * 72 / 25.4;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
const nl = (text) => m.linesOf(String(text == null ? '' : text).split('\n').map((x) => x.trim()).filter((x) => x !== '').join('\n'));
const star = (rec, id) => (rec.items.find((i) => i.itemId === id).def.key ? '★' : '');
const textJa = (rec, id) => rec.items.find((i) => i.itemId === id).def.textJa;

// ---------------------------------------------------------------------------
// 図面のデータ(C-DRAW-07)
//   SPEC は「markers を次の10個」と書くが、列挙は i4 の2個 + i6 の4個 + i8 の1個 = 7個(10 は凡例の「行」数)。列挙どおり7個で作る。
const markersA = (no) => m.markersOf(no, [['i4', 2], ['i6', 4], ['i8', 0]]);
const markersB = (no) => m.markersOf(no, [['i6', 2]]);

/** 記録を作って生成し、HTML(または lastDoc)を返す。同じ記録は1度だけ作る */
const memo = {};
const once = (k, fn) => (memo[k] = memo[k] || fn());
// 項目番号 N は新規記録の項目の並びで決まる(pre_pour: i4=4, i5=5, i6=6, i7=7, i8=8 / post_demold: i56=7, i57=8)。固定値から作る。
const NO_PRE = (id) => ({ i4: 4, i5: 5, i6: 6, i7: 7, i8: 8 })[id];
async function build(key, opts) {
  return once(key, async () => {
    const drawings = (opts.drawings || []).map((d) => ({ side: d.side, markers: d.markers(NO_PRE) }));
    const rec = await m.makeMeasureRecord({ lot: opts.lot, variant: opts.variant, drawings });
    // 実際の項目番号が固定値と一致することを確かめる(食い違ったらデータの作り方が SPEC と合わない)
    if (opts.variant !== 'post') for (const id of ['i4', 'i5', 'i6', 'i7', 'i8']) assert.equal(rec.no(id), NO_PRE(id), `項目番号 ${id}`);
    await m.setEngine(opts.engine);
    if (opts.engine === 'doc') await m.docShim({ reset: true });
    const r = await rec.qa.ok('generateReport', { recordId: rec.recordId });
    const out = { ...rec, report: r.report };
    if (opts.engine === 'html') out.html = await m.lastHtml();
    else out.doc = (await m.docShim({})).lastDoc;
    return out;
  });
}
const FULL = (engine) => ({ lot: 'RM-' + engine, variant: 'full', engine });
const withDrawA = (engine) => ({ lot: 'RDA-' + engine, variant: 'full', engine, drawings: [{ side: 'self', markers: markersA }] });
const withDrawB = (engine) => ({ lot: 'RDB-' + engine, variant: 'full', engine, drawings: [{ side: 'self', markers: () => [] }, { side: 'qa', markers: markersB }] });
const I8ONLY = (engine) => ({ lot: 'RI8-' + engine, variant: 'i8only', engine });
const POST = (engine) => ({ lot: 'RPD-' + engine, variant: 'post', engine });

describe('C-REP-07/08・C-DRAW-07 テストデータ(全対象)', () => {
  before(() => h.reset());

  it('実測つきの記録(打設前・出来形・図面つき・i8のみ)が qa_ok になり generateReport が成功する(職長の許容超は ng。管理者は許容超でも ok で判定できる)', async () => {
    await m.setEngine('html');
    const specs = [
      { lot: 'RT1', variant: 'full', drawings: [{ side: 'self', markers: markersA(NO_PRE) }] },
      { lot: 'RT2', variant: 'full', drawings: [{ side: 'self', markers: [] }, { side: 'qa', markers: markersB(NO_PRE) }] },
      { lot: 'RT3', variant: 'i8only' },
      { lot: 'RT4', variant: 'post' },
    ];
    for (const s of specs) {
      const rec = await m.makeMeasureRecord(s);
      assert.equal(rec.rec.status, 'qa_ok', s.lot);
      const i6 = rec.rec.items.find((i) => i.itemId === (s.variant === 'post' ? 'i56' : 'i6'));
      if (s.variant === 'full') {
        assert.deepEqual(i6.self.values, [1, -3, 2, -2.5]); assert.equal(i6.self.result, 'ng');
        assert.deepEqual(i6.qa.values, [2, 3]);
        const i5 = rec.rec.items.find((i) => i.itemId === 'i5');
        assert.deepEqual(i5.qa.values, [7]); assert.equal(i5.qa.result, m.QA_OVER_RESULT); assert.equal(i5.self.result, 'ok');
        assert.equal(rec.rec.drawings.length, s.drawings.length);
      }
      const g = await rec.qa.call('generateReport', { recordId: rec.recordId });
      assert.equal(g.ok, true, s.lot + ': ' + JSON.stringify(g.error));
      assert.equal(g.data.report.version, 1);
    }
    // 職長が許容超の ok を付けると提出できない(テストデータの前提)
    const t = await h.login('u_tanaka');
    const { recordId } = await h.createRecordFor(t, { lot: 'RT5' });
    await h.fillSelf(t, recordId, { i6: { values: [3] } });
    const sub = await t.call('submitRecord', { recordId, round: 1 }, { pin: t.pin });
    assert.equal(sub.ok, false);
    assert.ok((sub.error.data.violations || []).some((v) => v.rule === 'MEASURE_OVER_TOL_OK' && v.itemId === 'i6'));
  });
});

// ===========================================================================
describe('C-REP-01②(改訂)・C-REP-07: HTML方式の実測(harness: /__mock/lastReportHtml)', () => {
  before(() => h.reset());

  m.harnessHtml(it, 'C-REP-01②: 項目表に table-layout:fixed。nowrap/overflow:hidden が無く(全列折り返し可)、列幅 8/40/14/18/46/30/30mm(合計186)、行の高さ最小 6mm。管理者コメント200文字が全文。旧注記なし', async () => {
    const { html, rec } = await build('html:full', FULL('html'));
    const tb = m.itemsTable(html);
    assert.ok(tb, '項目表(class="items")');
    assert.deepEqual(m.headerTexts(tb), m.ITEM_HEAD);
    assert.match(html, /table-layout\s*:\s*fixed/);
    assert.match(tb.html + m.itemsCssRules(html).join('\n'), /table-layout\s*:\s*fixed/, '項目表が固定レイアウト');
    const scope = tb.html + '\n' + m.itemsCssRules(html).join('\n'); // 表の範囲(要素 + class="items" を対象にした CSS)
    assert.ok(!/white-space\s*:\s*nowrap/i.test(scope), '項目表の範囲に white-space:nowrap がない');
    assert.ok(!/overflow\s*:\s*hidden/i.test(scope), '項目表の範囲に overflow:hidden がない');
    const w = m.colWidthsMm(tb);
    assert.deepEqual(w, [8, 40, 14, 18, 46, 30, 30]);
    assert.equal(w.reduce((a, b) => a + b, 0), 186);
    assert.match(scope, /height\s*:\s*6mm/, '行の高さは height:6mm(最小値)');
    // 管理者コメント(200文字)が項目表のセルに全文(… で切らない)
    const cell = m.itemRow(tb, 7).cells[6];
    assert.equal(cell.text, m.LONG_QA_NOTE, '管理者コメント全文');
    assert.equal(m.LONG_QA_NOTE.length, 200);
    assert.ok(!cell.text.includes('…'));
    assert.ok(!html.includes(m.OLD_NOTE_TEXT), '旧注記「管理者コメントの全文は…」がない');
    // ⑤ NG は赤(行の背景)
    assert.ok(m.hasNgBg(m.itemRow(tb, 6)), 'NG 行の背景');
    assert.ok(!m.hasNgBg(m.itemRow(tb, 4)), 'NG でない行は赤くしない');
    void rec;
  });

  m.harnessHtml(it, 'C-REP-07①③: 項目表の実測セルの文字列(職長の2段落→管理者の2段落。境界±5は許容内。許容なしは ▲・許容なし。値なしは空)。旧形式がない', async () => {
    const { html, no } = await build('html:full', FULL('html'));
    const tb = m.itemsTable(html);
    for (const id of ['i4', 'i6', 'i5', 'i8']) {
      const row = m.itemRow(tb, no(id));
      assert.ok(row, id + ' の行');
      assert.deepEqual(m.linesOf(row.cells[4].text), m.CELL[id], id);
    }
    assert.equal(m.itemRow(tb, no('i7')).cells[4].text, '', 'i7(値なし)は空欄');
    // 値のある5項目以外は全て空欄(「-」や「未入力」を出さない)
    const withValues = new Set(['i4', 'i5', 'i6', 'i8'].map(no));
    for (const r of tb.rows.slice(1)) if (!withValues.has(Number(r.cells[0].text))) assert.equal(r.cells[4].text, '', `No.${r.cells[0].text} は空欄`);
    // i4: 境界 ±5 は許容内=▲ なし。i8: 許容なし=許容・▲ を含まない
    assert.ok(!m.itemRow(tb, no('i4')).cells[4].text.includes('▲'));
    assert.ok(!/許容|▲/.test(m.itemRow(tb, no('i8')).cells[4].text));
    // 旧形式(③)
    assert.ok(!html.includes(' / 許容±'), '旧形式「値 / 許容±N」がない');
    assert.ok(!tb.html.includes(' | '), '項目表に値の ` | ` 連結がない');
    for (const b of m.photoBlocks(html)) assert.ok(!b.html.includes(' | '), '写真ブロックに ` | ` 連結がない');
  });

  m.harnessHtml(it, 'C-REP-07②: 許容超の値と ▲許容超{k}件 は class="over" かつ font-weight:bold;color:#cc0000 の span。許容内の値は over の外。「、」も外', async () => {
    const { html, no } = await build('html:full', FULL('html'));
    const tb = m.itemsTable(html);
    const spans = (id) => m.overSpans(m.itemRow(tb, no(id)).cells[4].inner);
    assert.deepEqual(spans('i6').map((s) => s.text), ['▲-3', '▲-2.5', '▲許容超2件', '▲+3', '▲許容超1件']);
    assert.deepEqual(spans('i5').map((s) => s.text), ['▲+7', '▲許容超1件']);
    assert.deepEqual(spans('i4'), [], 'i4 は over を含まない');
    assert.deepEqual(spans('i8'), [], 'i8 は over を含まない');
    for (const id of ['i6', 'i5']) for (const s of spans(id)) {
      assert.ok(s.styled, `${id}: ${s.text} は class と同じ内容のインライン style(太字・#cc0000)を持つ`);
      assert.ok(!s.text.includes('、'), '「、」は over の外');
    }
    // 許容内の値は over の外にある(+1, +2)
    const inner6 = m.itemRow(tb, no('i6')).cells[4].inner;
    const outside = m.textOf(inner6.replace(/<span\b[^>]*class\s*=\s*["'][^"']*\bover\b[^>]*>[\s\S]*?<\/span>/gi, ''));
    assert.ok(outside.includes('+1') && outside.includes('+2'), 'i6 の +1, +2 は over の外');
    assert.ok(!outside.includes('▲'), 'over の外に ▲ がない');
    const inner5 = m.itemRow(tb, no('i5')).cells[4].inner;
    const outside5 = m.textOf(inner5.replace(/<span\b[^>]*class\s*=\s*["'][^"']*\bover\b[^>]*>[\s\S]*?<\/span>/gi, ''));
    assert.ok(outside5.includes('+1') && outside5.includes('+2'), 'i5 の職長の +1, +2 は over の外');
  });

  m.harnessHtml(it, 'C-REP-07④: 注記が項目表の直後に1つ。許容ありの実測が1つも無い記録(i8だけ値あり)では出ない', async () => {
    const full = await build('html:full', FULL('html'));
    const html = full.html;
    assert.equal(html.split(m.NOTE_TEXT).length - 1, 1, '注記は1つ');
    assert.ok(html.includes('合否は職長・管理者が判定した結果(合/NG)で、▲ だけでは決まりません。許容ちょうどは許容内として扱います。'), '注記の全文');
    assert.match(html, /<p\b[^>]*>[^<]*実測の ▲ は許容\(±\)を超えた値の目安です/, '段落(p)');
    const tb = m.itemsTable(html);
    const at = html.indexOf(m.NOTE_TEXT);
    assert.ok(at > tb.end, '項目表より後');
    const between = html.slice(tb.end, at);
    assert.ok(!/<table|<h2/i.test(between), '項目表の直後(間に別の表・見出しがない)');
    assert.ok(!html.includes(m.OLD_NOTE_TEXT));
    // 注記が出ない記録
    const only = await build('html:i8only', I8ONLY('html'));
    assert.ok(!only.html.includes(m.NOTE_TEXT), '許容ありの実測が無い記録では注記を出さない');
    assert.ok(!only.html.includes(m.OLD_NOTE_TEXT));
    const row = m.itemRow(m.itemsTable(only.html), only.no('i8'));
    assert.deepEqual(m.linesOf(row.cells[4].text), m.CELL.i8, 'i8 の実測は出る');
  });

  m.harnessHtml(it, 'C-REP-07⑤: 判定に影響しない(許容超の ▲+7 でも職長・管理者とも ok の i5 行は赤背景にならない。i6 は職長 ng なので赤。サマリ件数は実測と無関係。不合格・不適合の語がない)', async () => {
    const { html, no, rec } = await build('html:full', FULL('html'));
    const tb = m.itemsTable(html);
    assert.ok(!m.hasNgBg(m.itemRow(tb, no('i5'))), 'i5 の行に #fde8e8 が付かない');
    assert.ok(m.hasNgBg(m.itemRow(tb, no('i6'))), 'i6 は職長 ng なので赤');
    // NG 行は i6 だけ
    const ngRows = tb.rows.slice(1).filter((r) => m.hasNgBg(r)).map((r) => Number(r.cells[0].text));
    assert.deepEqual(ngRows, [no('i6')]);
    // 結果サマリ(職長: 合/NG/該当なし、管理者)
    const sum = m.parseTables(html).find((t) => JSON.stringify(m.headerTexts(t)) === JSON.stringify(['', '合', 'NG', '該当なし']));
    assert.ok(sum, '結果サマリの表');
    const nSelf = rec.items.filter((i) => i.def.audience !== 'qa').length;
    const nQa = rec.items.filter((i) => i.def.audience !== 'foreman').length;
    assert.deepEqual(sum.rows[1].cells.map((c) => c.text), ['職長', String(nSelf - 1), '1', '0']);
    const nQaOver = 2; // i5・i6 の管理者の結果(QA_OVER_RESULT)
    const qaCount = m.QA_OVER_RESULT === 'ok' ? [nQa, 0, 0] : [nQa - nQaOver, 0, nQaOver];
    assert.deepEqual(sum.rows[2].cells.map((c) => c.text), ['管理者', ...qaCount.map(String)]);
    // 実測セル・注記に「不合格」「不適合」がない
    for (const r of tb.rows.slice(1)) assert.ok(!/不合格|不適合/.test(r.cells[4].text), `No.${r.cells[0].text} の実測セル`);
    const note = html.slice(html.indexOf(m.NOTE_TEXT), html.indexOf(m.NOTE_TEXT) + 120);
    assert.ok(!/不合格|不適合/.test(note));
    for (const b of m.photoBlocks(html)) for (const line of nl(b.text).filter((x) => /^実測|^n=/.test(x))) assert.ok(!/不合格|不適合/.test(line));
  });

  m.harnessHtml(it, 'C-REP-07⑥: 写真ブロックの実測欄(i6 は職長→管理者の2段落ずつ。i8 は職長のみ。旧形式「実測: 」と値のない項目の実測欄がない)', async () => {
    const { html, no } = await build('html:full', FULL('html'));
    const blocks = m.photoBlocks(html);
    assert.ok(blocks.length >= 3, '写真ブロック');
    const of = (id) => blocks.filter((b) => b.text.includes(`No.${no(id)} `));
    const b6 = of('i6'); assert.equal(b6.length, 1, 'i6 の写真は1枚');
    const l6 = nl(b6[0].text);
    const at = l6.indexOf('実測(職長): +1、▲-3、+2、▲-2.5');
    assert.ok(at >= 0, 'i6 職長の実測行: ' + JSON.stringify(l6));
    assert.equal(l6[at + 1], 'n=4 最小-3/最大+2/許容±2mm ▲許容超2件', '職長の要約が実測行の次');
    assert.equal(l6[at + 2], '実測(管理者): +2、▲+3');
    assert.equal(l6[at + 3], 'n=2 最小+2/最大+3/許容±2mm ▲許容超1件');
    assert.deepEqual(m.overSpans(b6[0].html).map((s) => s.text), ['▲-3', '▲-2.5', '▲許容超2件', '▲+3', '▲許容超1件'], '許容超の装飾');
    assert.ok(m.overSpans(b6[0].html).every((s) => s.styled));
    const b8 = of('i8'); assert.equal(b8.length, 1);
    const l8 = nl(b8[0].text);
    const at8 = l8.indexOf('実測(職長): +2、-1、0');
    assert.ok(at8 >= 0, 'i8: ' + JSON.stringify(l8));
    assert.equal(l8[at8 + 1], 'n=3 最小-1/最大+2');
    assert.ok(!l8.some((x) => x.startsWith('実測(管理者)')), 'i8 は管理者の値なし');
    assert.ok(!/許容|▲/.test(l8[at8] + l8[at8 + 1]));
    // 旧形式・値のない項目
    for (const b of blocks) {
      for (const line of nl(b.text)) assert.ok(!line.startsWith('実測: '), '旧形式「実測: 」の行がない: ' + line);
    }
    for (const b of blocks.filter((x) => !x.text.includes(`No.${no('i6')} `) && !x.text.includes(`No.${no('i8')} `))) {
      assert.ok(!b.text.includes('実測'), '値のない項目の写真に「実測」が出ない: ' + b.text.slice(0, 40));
    }
  });

  m.harnessHtml(it, 'C-REP-07⑦: 出来形(post_demold)にも同じ規則(i56 許容10 [-10,11,4]、i57 許容3 [3,-3])', async () => {
    const { html, no } = await build('html:post', POST('html'));
    const tb = m.itemsTable(html);
    assert.equal(no('i56'), 7); assert.equal(no('i57'), 8);
    for (const id of ['i56', 'i57']) assert.deepEqual(m.linesOf(m.itemRow(tb, no(id)).cells[4].text), m.CELL_POST[id], id);
    assert.deepEqual(m.overSpans(m.itemRow(tb, no('i56')).cells[4].inner).map((s) => s.text), ['▲+11', '▲許容超1件']);
    assert.deepEqual(m.overSpans(m.itemRow(tb, no('i57')).cells[4].inner), [], '境界 ±3 は許容内');
    assert.ok(html.includes(m.NOTE_TEXT), '許容ありの実測があるので注記が出る');
  });

  m.harnessHtml(it, 'C-REP-07⑧: レイアウト制約(display:flex / display:grid / calc( を含まない)', async () => {
    for (const k of ['html:full', 'html:post', 'html:i8only']) {
      const spec = { 'html:full': FULL('html'), 'html:post': POST('html'), 'html:i8only': I8ONLY('html') }[k];
      const { html } = await build(k, spec);
      assert.ok(!/display\s*:\s*(flex|grid)|calc\(/i.test(html), k);
    }
  });
});

// ===========================================================================
describe('C-DRAW-07: 図面の凡例(HTML方式。harness: /__mock/lastReportHtml)', () => {
  before(() => h.reset());

  /** 凡例(職長の図面・7個の印)の行 → セルの文字列。HTML・doc 共通の検査 */
  function checkLegendA(rows, rec, where) {
    assert.equal(rows.length, 10, where + ': 行数(見出し1 + i4 グループ3 + i6 グループ5 + i8 の1行)');
    assert.deepEqual(rows[0], m.LEGEND_HEAD);
    const T = (id) => star(rec, id) + textJa(rec, id);
    const res = (r) => r.map((x) => x);
    void res;
    // i4 グループ
    assert.deepEqual(rows[1].slice(0, 4), ['No.4', T('i4') + '\n' + 'n=8 最小-5/最大+5/許容±5mm', '', ''], where + ' i4 見出し');
    assert.deepEqual(rows[1].slice(4), ['合', '合']);
    assert.deepEqual(rows[2], ['④-1', '', '-5mm', '', '', ''], where);
    assert.deepEqual(rows[3], ['④-2', '', '-5mm', '', '', ''], where);
    // i6 グループ(図面を書いた側=職長の系列。管理者の [2,3] は出ない)
    assert.deepEqual(rows[4].slice(0, 4), ['No.6', T('i6') + '\n' + 'n=4 最小-3/最大+2/許容±2mm ▲許容超2件', '', ''], where + ' i6 見出し');
    assert.match(rows[4][4], /^NG/, where + ' i6 職長の結果');
    assert.equal(rows[4][5], m.QA_OVER_LABEL);
    assert.deepEqual(rows[5], ['⑥-1', '', '+1mm', '', '', ''], where);
    assert.deepEqual(rows[6], ['⑥-2', '', '-3mm', '▲', '', ''], where);
    assert.deepEqual(rows[7], ['⑥-3', '', '+2mm', '', '', ''], where);
    assert.deepEqual(rows[8], ['⑥-4', '', '-2.5mm', '▲', '', ''], where);
    // i8: 見出し行なしの1行
    assert.deepEqual(rows[9], ['⑧', 'No.8 ' + star(rec, 'i8') + textJa(rec, 'i8'), '', '', '合', '合'], where + ' i8');
  }

  m.harnessHtml(it, 'C-DRAW-07①②③④: 6列・項目ごとのグループ(見出し行+番号行)・許容超の装飾・見出し行の背景', async () => {
    const { html, rec } = await build('html:drawA', withDrawA('html'));
    const legends = m.legendTables(html);
    assert.equal(legends.length, 1, '凡例は1つ');
    const tb = legends[0];
    assert.deepEqual(m.headerTexts(tb), m.LEGEND_HEAD, '①列');
    assert.deepEqual(m.colWidthsMm(tb), [24, 76, 28, 24, 17, 17], '①列幅(名目mm。合計186)');
    const rows = tb.rows.map((r) => r.cells.map((c) => nl(c.text).join('\n')));
    checkLegendA(rows, rec, 'HTML');
    // ③ 許容超の装飾: -3mm・-2.5mm・許容超列の ▲ が over(太字・#cc0000)。許容内の行・i4 の行は装飾なし
    const R = tb.rows;
    for (const i of [6, 8]) {
      const v = m.overSpans(R[i].cells[2].inner), a = m.overSpans(R[i].cells[3].inner);
      assert.equal(v.length, 1, `行${i} 実測値の over`); assert.equal(v[0].text, rows[i][2]); assert.ok(v[0].styled);
      assert.equal(a.length, 1, `行${i} 許容超の over`); assert.equal(a[0].text, '▲'); assert.ok(a[0].styled);
    }
    for (const i of [2, 3, 5, 7, 9]) for (const c of [2, 3]) assert.deepEqual(m.overSpans(R[i].cells[c].inner), [], `行${i} 列${c} は装飾なし`);
    // ④ 見出し行(列名の行・グループの見出し行)の背景。番号行は背景なし
    for (const i of [0, 1, 4]) assert.ok(m.hasGrayBg(R[i]), `行${i} は #EEEEEE`);
    for (const i of [2, 3, 5, 6, 7, 8, 9]) assert.ok(!m.hasGrayBg(R[i]), `行${i} は背景なし`);
  });

  m.harnessHtml(it, 'C-DRAW-07⑤⑥⑦: 管理者の図面は系列が管理者 [2,3]。印0個の図面は「印の書き込みなし」。図面ごとの改ページ・順序', async () => {
    const { html, rec } = await build('html:drawB', withDrawB('html'));
    const legends = m.legendTables(html);
    assert.equal(legends.length, 1, '印のある凡例は管理者の図面だけ');
    const rows = legends[0].rows.map((r) => r.cells.map((c) => nl(c.text).join('\n')));
    assert.equal(rows.length, 4);
    assert.deepEqual(rows[1].slice(0, 4), ['No.6', star(rec, 'i6') + textJa(rec, 'i6') + '\n' + 'n=2 最小+2/最大+3/許容±2mm ▲許容超1件', '', '']);
    assert.deepEqual(rows[2], ['⑥-1', '', '+2mm', '', '', '']);
    assert.deepEqual(rows[3], ['⑥-2', '', '+3mm', '▲', '', '']);
    const R = legends[0].rows;
    assert.deepEqual(m.overSpans(R[2].cells[2].inner), []); assert.deepEqual(m.overSpans(R[2].cells[3].inner), []);
    assert.deepEqual(m.overSpans(R[3].cells[2].inner).map((s) => s.text), ['+3mm']);
    assert.deepEqual(m.overSpans(R[3].cells[3].inner).map((s) => s.text), ['▲']);
    // ⑥ 印が0個
    assert.equal(html.split('印の書き込みなし').length - 1, 1, '印0個の図面は「印の書き込みなし」');
    // ⑦ 図面ごとの改ページ・見出し・順序(C-DRAW-05 と同じ観点)
    const iItems = html.indexOf('<h2>項目表</h2>'), iDraw = html.indexOf('確認箇所(図面)'), iNg = html.indexOf('<h2>NG・是正の経過</h2>');
    assert.ok(iItems >= 0 && iItems < iDraw && iDraw < iNg, '項目表 → 確認箇所 → NG・是正の経過');
    const seg = html.slice(iDraw - 200, iNg);
    assert.equal(seg.split('確認箇所(図面)').length - 1, 2, '図面2枚=見出し2つ');
    assert.equal(seg.split('page-break-before:always').length - 1, 2, '図面ごとに page-break-before:always');
    assert.ok(!/display\s*:\s*(flex|grid)|calc\(/i.test(html));
  });
});

// ===========================================================================
// doc 方式(harness-only: /__mock/docShim の lastDoc)
describe('C-REP-08・C-DRAW-07: doc 方式の実測・図面の凡例(harness: /__mock/docShim)', () => {
  before(() => h.reset());

  const rowsOf = (tb) => tb.cellTexts.map((r) => r.map((x) => nl(x).join('\n')));
  const itemTableOf = (d) => { const tb = d.tables.find((x) => x.cols === 7); assert.ok(tb, '項目表は7列'); assert.ok(tb.cellTexts, 'tables[i].cellTexts(SPEC §11.4)'); return tb; };
  const rowByNo = (tb, n) => { const i = tb.cellTexts.findIndex((r) => String(r[0]).trim() === String(n)); assert.ok(i >= 0, `No.${n} の行`); return i; };
  const colored = (d, color) => { assert.ok(d.coloredTexts, 'lastDoc.coloredTexts(SPEC §11.4)'); const k = Object.keys(d.coloredTexts).find((x) => x.toUpperCase() === color); return k ? d.coloredTexts[k] : []; };

  m.harnessDoc(it, 'C-REP-08①: 項目表(7列)の実測列の文字列が HTML方式(C-REP-07①)と同じ。段落は \\n 区切り。値なしは ""', async () => {
    const { doc: d, no } = await build('doc:full', FULL('doc'));
    const tb = itemTableOf(d);
    for (const id of ['i4', 'i6', 'i5', 'i8']) assert.deepEqual(nl(tb.cellTexts[rowByNo(tb, no(id))][4]), m.CELL[id], id);
    assert.equal(tb.cellTexts[rowByNo(tb, no('i7'))][4], '', 'i7 は ""');
    const withValues = new Set(['i4', 'i5', 'i6', 'i8'].map(no));
    tb.cellTexts.slice(1).forEach((r) => { if (!withValues.has(Number(String(r[0]).trim()))) assert.equal(r[4], '', `No.${r[0]} は空欄`); });
    assert.ok(!d.text.includes(' / 許容±'), '旧形式がない');
  });

  m.harnessDoc(it, 'C-REP-08②: 許容超の部分だけ #CC0000・太字(coloredTexts / boldTexts)。許容内の値は含まれない', async () => {
    const { doc: d } = await build('doc:full', FULL('doc'));
    const red = colored(d, m.RED);
    for (const s of ['▲-3', '▲-2.5', '▲+3', '▲+7', '▲許容超2件', '▲許容超1件']) {
      assert.ok(red.includes(s), `coloredTexts[#CC0000] に ${s}: ` + JSON.stringify(red));
      assert.ok((d.boldTexts || []).includes(s), `boldTexts に ${s}: ` + JSON.stringify(d.boldTexts));
    }
    for (const s of ['+1', '+2', '-5', '+3', '-1', '+5', '0', '-2']) {
      assert.ok(!red.includes(s), `許容内の ${s} は赤にしない`);
      assert.ok(!(d.boldTexts || []).includes(s), `許容内の ${s} は太字にしない`);
    }
  });

  m.harnessDoc(it, 'C-REP-08③④: 注記(あるときだけ)・旧注記なし・管理者コメント200文字が項目表に全文', async () => {
    const { doc: d } = await build('doc:full', FULL('doc'));
    assert.ok(d.paragraphs.some((p) => p.text.includes(m.NOTE_TEXT)), '注記の段落(本文)');
    assert.ok(d.paragraphs.some((p) => p.text.includes('合否は職長・管理者が判定した結果(合/NG)で、▲ だけでは決まりません。許容ちょうどは許容内として扱います。')), '注記の全文');
    assert.equal(d.paragraphs.filter((p) => p.text.includes(m.NOTE_TEXT)).length, 1, '注記は1つ');
    assert.ok(!d.text.includes(m.OLD_NOTE_TEXT), '旧注記なし');
    const tb = itemTableOf(d);
    assert.ok(tb.cellTexts.some((r) => r[6] === m.LONG_QA_NOTE), '管理者コメント200文字が全文(cellTexts)');
    // 注記が出ない記録
    const only = await build('doc:i8only', I8ONLY('doc'));
    assert.ok(!only.doc.paragraphs.some((p) => p.text.includes(m.NOTE_TEXT)), '許容ありの実測が無い記録では注記を出さない');
    assert.ok(!only.doc.text.includes(m.OLD_NOTE_TEXT));
    const t2 = itemTableOf(only.doc);
    assert.deepEqual(nl(t2.cellTexts[rowByNo(t2, only.no('i8'))][4]), m.CELL.i8);
  });

  m.harnessDoc(it, 'C-REP-08⑤: i6 の写真ブロックの右セルに 実測(職長)/要約/実測(管理者)/要約。i8 は職長のみ。値のない項目に「実測」なし', async () => {
    const { doc: d, no } = await build('doc:full', FULL('doc'));
    const pt = d.tables.filter((tb) => tb.cols === 2 && Math.abs(tb.colWidths[0] - mmPt(83 * 184 / 186)) <= 0.5);
    assert.ok(pt.length >= 3, '写真ブロックの表');
    const text = (tb) => tb.cellTexts.map((r) => r.join('\n')).join('\n');
    const b6 = pt.filter((tb) => text(tb).includes(`No.${no('i6')} `)); assert.equal(b6.length, 1);
    const l6 = nl(text(b6[0]));
    const at = l6.indexOf('実測(職長): +1、▲-3、+2、▲-2.5');
    assert.ok(at >= 0, JSON.stringify(l6));
    assert.equal(l6[at + 1], 'n=4 最小-3/最大+2/許容±2mm ▲許容超2件');
    assert.equal(l6[at + 2], '実測(管理者): +2、▲+3');
    assert.equal(l6[at + 3], 'n=2 最小+2/最大+3/許容±2mm ▲許容超1件');
    const b8 = pt.filter((tb) => text(tb).includes(`No.${no('i8')} `)); assert.equal(b8.length, 1);
    const l8 = nl(text(b8[0])); const at8 = l8.indexOf('実測(職長): +2、-1、0');
    assert.ok(at8 >= 0, JSON.stringify(l8)); assert.equal(l8[at8 + 1], 'n=3 最小-1/最大+2');
    assert.ok(!l8.some((x) => x.startsWith('実測(管理者)')));
    for (const tb of pt) for (const line of nl(text(tb))) assert.ok(!line.startsWith('実測: '), '旧形式がない');
    for (const tb of pt.filter((x) => x !== b6[0] && x !== b8[0])) assert.ok(!text(tb).includes('実測'), '値のない項目の写真に「実測」が出ない');
  });

  m.harnessDoc(it, 'C-REP-08⑥: 出来形(post_demold)にも同じ文字列(i56 / i57)。許容超は赤・太字', async () => {
    const { doc: d, no } = await build('doc:post', POST('doc'));
    const tb = itemTableOf(d);
    for (const id of ['i56', 'i57']) assert.deepEqual(nl(tb.cellTexts[rowByNo(tb, no(id))][4]), m.CELL_POST[id], id);
    const red = colored(d, m.RED);
    assert.ok(red.includes('▲+11') && red.includes('▲許容超1件'));
    assert.ok(!red.includes('+4') && !red.includes('-10') && !red.includes('+3') && !red.includes('-3'));
  });

  m.harnessDoc(it, 'C-REP-08⑦: NG 行以外の背景が変わらない(i5 の行は ▲+7 でも背景 null。i6 の全セルは #FDE8E8)', async () => {
    const { doc: d, no } = await build('doc:full', FULL('doc'));
    const tb = itemTableOf(d);
    assert.ok(tb.cellBackgrounds, 'cellBackgrounds');
    const bg = (n) => tb.cellBackgrounds[rowByNo(tb, n)];
    assert.ok(bg(no('i5')).every((x) => x === null || x === undefined), 'i5 の行は背景 null: ' + JSON.stringify(bg(no('i5'))));
    assert.ok(bg(no('i4')).every((x) => x === null || x === undefined), 'i4 の行は背景 null');
    assert.ok(bg(no('i6')).length === 7 && bg(no('i6')).every((x) => String(x).toUpperCase() === '#FDE8E8'), 'i6 は全セル #FDE8E8');
  });

  /** doc の凡例(6列)の行 → セルの文字列(HTML と同じ形) */
  const legendsOf = (d) => d.tables.filter((tb) => tb.cols === 6);

  m.harnessDoc(it, 'C-DRAW-07(doc)①②③④: 6列(24/76/28/24/17/17mm ×184/186。合計521.57pt)・10行・許容超の装飾・見出し行の背景', async () => {
    const { doc: d, rec } = await build('doc:drawA', withDrawA('doc'));
    const legends = legendsOf(d);
    assert.equal(legends.length, 1, '凡例は1つ');
    const tb = legends[0];
    [24, 76, 28, 24, 17, 17].forEach((w, i) => near(tb.colWidths[i], mmPt(w * 184 / 186), 0.5, '凡例の列幅[' + i + ']'));
    near(tb.colWidths.reduce((a, b) => a + b, 0), 521.57, 0.5, '凡例の列幅の合計');
    const rows = rowsOf(tb);
    // 各 cellTexts は行×列。HTML と同じ期待を使う
    const T = (id) => star(rec, id) + textJa(rec, id);
    assert.equal(rows.length, 10);
    assert.deepEqual(rows[0], m.LEGEND_HEAD);
    assert.deepEqual(rows[1].slice(0, 4), ['No.4', T('i4') + '\n' + 'n=8 最小-5/最大+5/許容±5mm', '', '']);
    assert.deepEqual(rows[1].slice(4), ['合', '合']);
    assert.deepEqual(rows[2], ['④-1', '', '-5mm', '', '', '']);
    assert.deepEqual(rows[3], ['④-2', '', '-5mm', '', '', '']);
    assert.deepEqual(rows[4].slice(0, 4), ['No.6', T('i6') + '\n' + 'n=4 最小-3/最大+2/許容±2mm ▲許容超2件', '', '']);
    assert.match(rows[4][4], /^NG/); assert.equal(rows[4][5], m.QA_OVER_LABEL);
    assert.deepEqual(rows[5], ['⑥-1', '', '+1mm', '', '', '']);
    assert.deepEqual(rows[6], ['⑥-2', '', '-3mm', '▲', '', '']);
    assert.deepEqual(rows[7], ['⑥-3', '', '+2mm', '', '', '']);
    assert.deepEqual(rows[8], ['⑥-4', '', '-2.5mm', '▲', '', '']);
    assert.deepEqual(rows[9], ['⑧', 'No.8 ' + T('i8'), '', '', '合', '合']);
    // ③ 装飾
    const red = colored(d, m.RED);
    for (const s of ['-3mm', '-2.5mm', '▲']) {
      assert.ok(red.includes(s), `coloredTexts に ${s}: ` + JSON.stringify(red));
      assert.ok((d.boldTexts || []).includes(s), `boldTexts に ${s}`);
    }
    for (const s of ['-5mm', '+1mm', '+2mm']) { assert.ok(!red.includes(s), s + ' は赤にしない'); assert.ok(!(d.boldTexts || []).includes(s), s + ' は太字にしない'); }
    // ④ 見出し行(列名の行・グループの見出し行)の背景 #EEEEEE。番号行は null
    const gray = (r) => tb.cellBackgrounds[r].every((x) => String(x).toUpperCase() === '#EEEEEE');
    const none = (r) => tb.cellBackgrounds[r].every((x) => x === null || x === undefined);
    for (const i of [0, 1, 4]) assert.ok(gray(i), `行${i} の背景は #EEEEEE: ` + JSON.stringify(tb.cellBackgrounds[i]));
    for (const i of [2, 3, 5, 6, 7, 8, 9]) assert.ok(none(i), `行${i} は背景なし`);
  });

  m.harnessDoc(it, 'C-DRAW-07(doc)⑤⑥: 管理者の図面は系列が管理者 [2,3]。印0個の図面は「印の書き込みなし」', async () => {
    const { doc: d, rec } = await build('doc:drawB', withDrawB('doc'));
    const legends = legendsOf(d);
    assert.equal(legends.length, 1, '印のある凡例は管理者の図面だけ');
    const rows = rowsOf(legends[0]);
    assert.equal(rows.length, 4);
    assert.deepEqual(rows[1].slice(0, 4), ['No.6', star(rec, 'i6') + textJa(rec, 'i6') + '\n' + 'n=2 最小+2/最大+3/許容±2mm ▲許容超1件', '', '']);
    assert.deepEqual(rows[2], ['⑥-1', '', '+2mm', '', '', '']);
    assert.deepEqual(rows[3], ['⑥-2', '', '+3mm', '▲', '', '']);
    const red = colored(d, m.RED);
    assert.ok(red.includes('+3mm') && red.includes('▲'));
    assert.ok(!red.includes('+2mm'));
    assert.equal(d.text.split('印の書き込みなし').length - 1, 1, '印0個の図面は「印の書き込みなし」');
  });
});
