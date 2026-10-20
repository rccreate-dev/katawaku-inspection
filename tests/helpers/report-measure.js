// 実測の表示(版1.11.0。SPEC §10.2d・§12.3 C-REP-07 / C-REP-08 / C-DRAW-07 / C-REP-01②)用の共通部品。
//   - harness 判定(`/__mock/lastReportHtml`・`/__mock/docShim` があるか)
//   - テストデータ(pre_pour / post_demold の qa_ok 記録。値・図面・写真つき)
//   - 生成した HTML(lastReportHtml)の簡易パーサ(表・行・セル。タグを除いた文字列。class="over" の span)
//   - 期待値(SPEC §12.3 の具体的な文字列)
'use strict';
const assert = require('node:assert/strict');
const h = require('./client');

// ---------------------------------------------------------------------------
// harness 判定(mock には `/__mock/lastReportHtml` と `/__mock/docShim` が無い=SPEC §11.4)
const setEngine = (value) => h.mock('patch', { sheet: 'Config', key: 'reportEngine', set: { value } });

async function docShim(body = {}) {
  try {
    const r = await fetch(h.BASE + '/__mock/docShim', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.status !== 200) return null;
    const j = await r.json();
    return j && j.ok === true ? j.data : null;
  } catch { return null; }
}
async function isHarness() {
  if (!(await h.hasMock())) return false;
  try {
    const r = await fetch(h.BASE + '/__mock/lastReportHtml', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (r.status !== 200) return false;
    return (await r.json()).ok === true;
  } catch { return false; }
}
const lastHtml = async () => (await h.mock('lastReportHtml', {})).html || '';

/** HTML方式の観測(`/__mock/lastReportHtml`)を使うテスト。mock・実GASではスキップ(PDFを作らない/観測できない)。 */
function harnessHtml(it, name, fn) {
  return it(name, async (t) => {
    if (!(await h.hasMock())) return t.skip('harness-only(実GAS)');
    if (!(await isHarness())) return t.skip('harness-only(mock は PDF を作らない=lastReportHtml が無い。SPEC §11.3)');
    return fn(t);
  });
}
/** doc 方式の観測(`/__mock/docShim`)を使うテスト。mock・実GASではスキップ。harness に docShim が無ければ「未完で失敗」。 */
function harnessDoc(it, name, fn) {
  return it(name, async (t) => {
    if (!(await h.hasMock())) return t.skip('harness-only(実GAS)');
    if ((await docShim({ reset: true })) === null) {
      if (await isHarness()) assert.fail('バックエンド未完のため失敗: harness に /__mock/docShim が未実装(SPEC §11.4)');
      return t.skip('harness-only(mock には /__mock/docShim が無い。SPEC §11.4)');
    }
    return fn(t);
  });
}

// ---------------------------------------------------------------------------
// テストデータ
const LONG_QA_NOTE = 'あいうえお'.repeat(40); // 管理者コメント200文字(全文が項目表に入ること。C-REP-01②・C-REP-08④)
// 版1.11.1(SPEC §5.3.1・§12.3 C-REP-07): 管理者は許容超の実測値にも ok を付けられる。ただし qaNote(trim後)が必須(QA_OVER_TOL_COMMENT_REQUIRED)。
//   管理者の値が許容超の i5 [7]・i6 [2,3] は結果 ok にして、qaNote に QA_OVER_NOTE を入れる(入れないと submitVerdict が拒否される)。
const QA_OVER_RESULT = 'ok';
const QA_OVER_NOTE = '図面で確認済み';
const QA_OVER_LABEL = { ok: '合', na: '該当なし' }[QA_OVER_RESULT];
const CIRCLED = ['⓪', '①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩', '⑪', '⑫', '⑬', '⑭', '⑮', '⑯', '⑰', '⑱', '⑲', '⑳'];

/**
 * 実測つきの qa_ok 記録を作る。
 *   variant 'full'  : pre_pour。i4 職長[-5,-5,-2,-5,3,-1,5,-5] / i6(許容2)職長[1,-3,2,-2.5](結果 ng・備考・minor・写真)・管理者[2,3](結果 ok・qaNote あり) /
 *                     i5 職長[1,2]・管理者[7](職長・管理者とも ok。管理者は qaNote 必須=版1.11.1) / i8(許容なし)職長[2,-1,0](写真) / i7 値なし(管理者コメント200文字)。管理者の結果は全 ok
 *   variant 'i8only': pre_pour。i8 職長[2,-1,0] だけ(許容ありの実測が1つも無い記録=注記が出ない)
 *   variant 'post'  : post_demold。i56(許容10)職長[-10,11,4](結果 ng・備考・minor・写真) / i57(許容3)職長[3,-3]
 *   drawings: [{ side:'self'|'qa', markers:[{ item:'i4', label:'④-1' }…] }…](self は提出前、qa は claim 後に登録。x,y は適当)
 * 職長の許容超の ok は提出で MEASURE_OVER_TOL_OK になる(職長側は不変)ため、職長の許容超は結果を ng にする。管理者の許容超 ok は qaNote つきで通る(版1.11.1)。
 */
async function makeMeasureRecord({ lot, variant = 'full', drawings = [] } = {}) {
  const t = await h.login('u_tanaka');
  const qa = await h.login('u_sato');
  const stage = variant === 'post' ? 'post_demold' : 'pre_pour';
  const { recordId, res } = await h.createRecordFor(t, { lot: lot || 'M' + h.rand(6).toUpperCase(), stage });
  assert.equal(res.ok, true, 'createRecord: ' + JSON.stringify(res.error));
  const itemIds = res.data.record.items.map((i) => i.itemId);
  const no = (id) => { const k = itemIds.indexOf(id); return k < 0 ? null : k + 1; };

  let selfOver; let qaOver; let ngPhotoItems;
  if (variant === 'full') {
    selfOver = {
      i4: { values: [-5, -5, -2, -5, 3, -1, 5, -5] },
      i5: { values: [1, 2] },
      i6: { result: 'ng', severity: 'minor', note: '開口の建入れ不良', values: [1, -3, 2, -2.5] },
      i8: { values: [2, -1, 0] },
    };
    qaOver = { i5: { result: QA_OVER_RESULT, values: [7], note: QA_OVER_NOTE }, i6: { result: QA_OVER_RESULT, values: [2, 3], note: QA_OVER_NOTE }, i7: { note: LONG_QA_NOTE } };
    ngPhotoItems = ['i6', 'i8'];
  } else if (variant === 'i8only') {
    selfOver = { i8: { values: [2, -1, 0] } };
    qaOver = { i7: { note: LONG_QA_NOTE } };
    ngPhotoItems = ['i8'];
  } else {
    selfOver = {
      i56: { result: 'ng', severity: 'minor', note: 'はらみ大', values: [-10, 11, 4] },
      i57: { values: [3, -3] },
    };
    qaOver = { i50: { note: LONG_QA_NOTE } };
    ngPhotoItems = ['i56'];
  }
  await h.fillSelf(t, recordId, selfOver);
  for (const itemId of ngPhotoItems) {
    const u = await h.uploadPhoto(t, { recordId, itemId, side: 'self' });
    assert.equal(u.ok, true, `写真 ${itemId}: ` + JSON.stringify(u.error));
  }
  const toMarkers = (ms) => ms.map((m, i) => ({ itemId: m.item, label: m.label, x: 0.1 + 0.05 * (i % 10), y: 0.2 + 0.03 * (i % 10) }));
  for (const d of drawings.filter((x) => x.side === 'self')) {
    const r = await h.uploadDrawing(t, { recordId, side: 'self', markers: toMarkers(d.markers) });
    assert.equal(r.ok, true, '職長の図面: ' + JSON.stringify(r.error));
  }
  const sub = await t.call('submitRecord', { recordId, round: 1 }, { pin: t.pin });
  assert.equal(sub.ok, true, 'submitRecord: ' + JSON.stringify(sub.error));
  const cl = await qa.call('claimReview', { recordId, round: 1 });
  assert.equal(cl.ok, true, 'claimReview: ' + JSON.stringify(cl.error));
  for (const d of drawings.filter((x) => x.side === 'qa')) {
    const r = await h.uploadDrawing(qa, { recordId, side: 'qa', markers: toMarkers(d.markers) });
    assert.equal(r.ok, true, '管理者の図面: ' + JSON.stringify(r.error));
  }
  await h.fillQa(qa, recordId, qaOver);
  const v = await qa.call('submitVerdict', { recordId, round: 1, verdict: 'ok' }, { pin: qa.pin });
  assert.equal(v.ok, true, 'submitVerdict: ' + JSON.stringify(v.error));
  const rec = await h.getRecord(qa, recordId);
  assert.equal(rec.status, 'qa_ok');
  return { recordId, t, qa, no, itemIds, rec };
}

/** 図面の印(C-DRAW-07 のデータ)。丸数字は項目番号 N から作る */
const markersOf = (no, spec) => spec.flatMap(([item, count]) => {
  const c = CIRCLED[no(item)];
  return count === 0 ? [{ item, label: c }] : Array.from({ length: count }, (_, k) => ({ item, label: `${c}-${k + 1}` }));
});

// ---------------------------------------------------------------------------
// 期待値(SPEC §12.3 C-REP-07 ①。項目表の実測セルの段落)
const CELL = {
  i4: ['職長: -5、-5、-2、-5、+3、-1、+5、-5', 'n=8 最小-5/最大+5/許容±5mm'],
  i6: ['職長: +1、▲-3、+2、▲-2.5', 'n=4 最小-3/最大+2/許容±2mm ▲許容超2件', '管理者: +2、▲+3', 'n=2 最小+2/最大+3/許容±2mm ▲許容超1件'],
  i5: ['職長: +1、+2', 'n=2 最小+1/最大+2/許容±5mm', '管理者: ▲+7', 'n=1 許容±5mm ▲許容超1件'],
  i8: ['職長: +2、-1、0', 'n=3 最小-1/最大+2'],
  i7: [],
};
const CELL_POST = {
  i56: ['職長: -10、▲+11、+4', 'n=3 最小-10/最大+11/許容±10mm ▲許容超1件'],
  i57: ['職長: +3、-3', 'n=2 最小-3/最大+3/許容±3mm'],
};
const NOTE_TEXT = '実測の ▲ は許容(±)を超えた値の目安です';
const OLD_NOTE_TEXT = '管理者コメントの全文は';
const RED = '#CC0000';

// ---------------------------------------------------------------------------
// HTML の簡易パーサ
const decodeEntities = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
/** タグを除いたテキスト。`</div>`・`</p>`・`<br>` は段落の区切り(\n)。各行は前後の空白を除き、空行は捨てる */
function textOf(html) {
  const s = String(html).replace(/<br\s*\/?>/gi, '\n').replace(/<\/(div|p|li|h[1-6])\s*>/gi, '\n').replace(/<[^>]*>/g, '');
  return decodeEntities(s).split('\n').map((x) => x.trim()).filter((x) => x !== '').join('\n');
}
const linesOf = (text) => (text === '' ? [] : text.split('\n'));

/** 全ての table(入れ子は想定しない)を { html, openTag, rows:[{ openTag, cells:[{ openTag, name, inner, text }] }] } にする */
function parseTables(html) {
  const out = [];
  const reT = /<table\b([^>]*)>([\s\S]*?)<\/table>/gi;
  let m;
  while ((m = reT.exec(html))) {
    const t = { html: m[0], openTag: '<table' + m[1] + '>', index: m.index, end: m.index + m[0].length, rows: [] };
    const reR = /<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi;
    let r;
    while ((r = reR.exec(m[2]))) {
      const row = { openTag: '<tr' + r[1] + '>', cells: [] };
      const reC = /<(td|th)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
      let c;
      while ((c = reC.exec(r[2]))) row.cells.push({ openTag: '<' + c[1] + c[2] + '>', name: c[1], inner: c[3], text: textOf(c[3]) });
      t.rows.push(row);
    }
    out.push(t);
  }
  return out;
}
const headerTexts = (t) => (t.rows[0] ? t.rows[0].cells.map((c) => c.text) : []);
const ITEM_HEAD = ['No.', '項目', '職長結果', '管理者結果', '実測(設計値との差)', '職長コメント', '管理者コメント'];
const LEGEND_HEAD = ['番号', '項目', '実測値', '許容超', '職長', '管理者'];
const itemsTable = (html) => parseTables(html).find((t) => /class="items"/.test(t.openTag));
const legendTables = (html) => parseTables(html).filter((t) => JSON.stringify(headerTexts(t)) === JSON.stringify(LEGEND_HEAD));
/** 項目表の行(No. が n の行) */
const itemRow = (tb, n) => tb.rows.find((r) => r.cells.length && r.cells[0].text === String(n));

/** `class="over"` の span: 内側のテキストの配列と、各 span のタグが太字・#cc0000 を持つか */
function overSpans(html) {
  const out = [];
  const re = /<span\b([^>]*)>([\s\S]*?)<\/span>/gi;
  let m;
  while ((m = re.exec(html))) {
    if (!/class\s*=\s*["'][^"']*\bover\b/.test(m[1])) continue;
    const style = (/style\s*=\s*"([^"]*)"/i.exec(m[1]) || [, ''])[1].replace(/\s+/g, '').toLowerCase();
    out.push({ text: textOf(m[2]), styled: style.includes('font-weight:bold') && style.includes('color:#cc0000') });
  }
  return out;
}
/** 写真ブロック(class="pb")ごとのテキスト */
const photoBlocks = (html) => parseTables(html).filter((t) => /class="pb"/.test(t.openTag)).map((t) => ({ ...t, text: textOf(t.html) }));
/** `<style>` 内で、セレクタに `items` を含む規則 */
function itemsCssRules(html) {
  const css = (html.match(/<style[^>]*>([\s\S]*?)<\/style>/gi) || []).join('\n');
  const rules = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) if (/\bitems\b/.test(m[1])) rules.push(m[1].trim() + '{' + m[2] + '}');
  return rules;
}
/** 見出し行の背景が #EEE か(行または全セルのタグ。大文字小文字・省略形を許す) */
const hasGrayBg = (row) => {
  const gray = (s) => /background(?:-color)?\s*:\s*#e{3}(?:e{3})?\b/i.test(s);
  return gray(row.openTag) || (row.cells.length > 0 && row.cells.every((c) => gray(c.openTag)));
};
/** 行の背景が NG の赤(#fde8e8)か(行または全セル) */
const hasNgBg = (row) => /#fde8e8/i.test(row.openTag) || (row.cells.length > 0 && row.cells.every((c) => /#fde8e8/i.test(c.openTag)));
/** 列幅(mm)。`<col style="width:Nmm">` を優先し、無ければ見出しセルの `width:Nmm` */
function colWidthsMm(tb) {
  const cols = [...tb.html.matchAll(/<col\b[^>]*width\s*:\s*([\d.]+)mm/gi)].map((m) => Number(m[1]));
  if (cols.length) return cols;
  return (tb.rows[0] ? tb.rows[0].cells : []).map((c) => { const m = /width\s*:\s*([\d.]+)mm/i.exec(c.openTag); return m ? Number(m[1]) : null; });
}

module.exports = {
  h, setEngine, docShim, isHarness, lastHtml, harnessHtml, harnessDoc,
  LONG_QA_NOTE, QA_OVER_RESULT, QA_OVER_NOTE, QA_OVER_LABEL, CIRCLED, makeMeasureRecord, markersOf,
  CELL, CELL_POST, NOTE_TEXT, OLD_NOTE_TEXT, RED,
  textOf, linesOf, parseTables, headerTexts, ITEM_HEAD, LEGEND_HEAD, itemsTable, legendTables, itemRow, overSpans, photoBlocks, itemsCssRules, hasGrayBg, hasNgBg, colWidthsMm,
};
