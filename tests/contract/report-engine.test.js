// C-REP-02〜05(版1.10.1。SPEC §12.3): 元請PDFの生成方式 Config `reportEngine`。HTTP(契約)で確かめられる部分。
//   - 全対象(mock / harness / 実GAS): bootstrap.config に reportEngine が出ない、checkReportEngine は action でない(BAD_REQUEST)
//   - mock / harness: Config 初期値 reportEngine=html(str)、/__mock/patch で書ける、方式に関わらず generateReport の応答の形が同じ
//   - harness 専用(`/__mock/docShim` が ok:true を返すときだけ実行。mock 相手ではスキップ=SPEC §11.4): 方式の切替・doc の中身・フォールバック
// 注: Drive ファイルの説明(engine=...)は HTTP の制御パスに出ない(`/__mock/drive` は paths のみ)ため backend/harness/test 側(C-REP-04③)。
//     checkReportEngine() の直接呼び出し(C-REP-05②)・setupSheets の追記・appsscript.json のスコープ(C-REP-06①②)は
//     HTTP から見えないので backend/harness/test 側(バックエンド担当)と tests/unit 側で扱う。
'use strict';
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers/client');

const ENGINE_KEY = 'reportEngine';
const setEngine = (value) => h.mock('patch', { sheet: 'Config', key: ENGINE_KEY, set: { value } });

/** `/__mock/docShim` が実在するか(harness のみ)。存在しなければ null。 */
async function docShim(body = {}) {
  try {
    const r = await fetch(h.BASE + '/__mock/docShim', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.status !== 200) return null;
    const j = await r.json();
    return j && j.ok === true ? j.data : null;
  } catch { return null; }
}
/** harness か(mock には無い `/__mock/lastReportHtml` があるか)。docShim が無いのに harness なら「実装待ち」。 */
async function isHarness() {
  if (!(await h.hasMock())) return false;
  try {
    const r = await fetch(h.BASE + '/__mock/lastReportHtml', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (r.status !== 200) return false;
    return (await r.json()).ok === true;
  } catch { return false; }
}
/** harness 専用テスト。docShim が無ければ、mock ならスキップ、harness なら「バックエンド未完のため失敗」。 */
function harnessOnly(name, fn) {
  return it(name, async (t) => {
    if (!(await h.hasMock())) return t.skip('harness-only(実GAS)');
    if ((await docShim({ reset: true })) === null) {
      if (await isHarness()) assert.fail('バックエンド未完のため失敗: harness に /__mock/docShim が未実装(SPEC §11.4)');
      return t.skip('harness-only(mock には /__mock/docShim が無い。SPEC §11.4)');
    }
    return fn(t);
  });
}
const lastHtml = async () => (await h.mock('lastReportHtml', {})).html || '';

/** 図面1枚・写真つきの qa_ok 記録を作る(QA が図面を付ける)。 */
async function makeReportable(lot, { drawings = 0, extraPrime = 0 } = {}) {
  const t = await h.login('u_tanaka');
  const qa = await h.login('u_suzuki');
  const { recordId } = await h.makeSubmitted(t, { lot });
  await qa.ok('claimReview', { recordId, round: 1 });
  for (let i = 0; i < drawings; i++) await h.uploadDrawing(qa, { recordId, side: 'qa' });
  await h.fillQa(qa, recordId, {}, { comment: '管理者コメント全文テスト' });
  await qa.ok('submitVerdict', { recordId, round: 1, verdict: 'ok' }, { pin: qa.pin });
  for (let i = 0; i < extraPrime; i++) {
    const u = await h.uploadPhoto(qa, { recordId, side: 'prime' });
    assert.equal(u.ok, true, 'prime 写真: ' + JSON.stringify(u.error));
  }
  return { recordId, qa, t };
}
const REPORT_KEYS = ['reportId', 'recordId', 'version', 'url', 'sha256', 'generatedBy', 'generatedByName', 'generatedAt', 'recordStatus'];

describe('C-REP reportEngine(HTTPから見える部分)', () => {
  beforeEach(() => h.reset());

  it('C-REP-02④: getBootstrap.config に reportEngine を含めない(サーバー専用)', async () => {
    const lead = await h.login('u_lead');
    const t = await h.login('u_tanaka');
    for (const s of [t, lead]) {
      const b = await s.ok('getBootstrap', {});
      assert.ok(b.config && typeof b.config === 'object');
      assert.ok(!(ENGINE_KEY in b.config), 'bootstrap.config に reportEngine を含めない');
      assert.ok(!JSON.stringify(b).includes(ENGINE_KEY));
    }
  });

  it('C-REP-05①: checkReportEngine は action ではない(送ると BAD_REQUEST)。生成方式を切り替える action も無い', async () => {
    const t = await h.login('u_tanaka');
    for (const action of ['checkReportEngine', 'setReportEngine']) {
      const r = await t.call(action, {});
      assert.equal(r.ok, false); assert.equal(r.error.code, 'BAD_REQUEST', action);
      const p = await h.call(action, {});
      assert.equal(p.error.code, 'BAD_REQUEST', `${action}(未認証)`);
    }
  });

  h.mockOnly(it, 'C-REP-06③(契約側): Config 初期値に reportEngine=html(str)があり、meta.configKeys に含まれ、actions は43のまま', async () => {
    const meta = await h.mock('meta', {});
    assert.equal(meta.actions.length, 43);
    assert.ok(!meta.actions.includes('checkReportEngine'));
    assert.ok(meta.configKeys.includes(ENGINE_KEY), 'SPEC §2.14 のキー');
    const row = (await h.stateRows('Config')).find((r) => r.key === ENGINE_KEY);
    assert.ok(row, 'Config に reportEngine の行');
    assert.equal(String(row.value), 'html'); assert.equal(row.type, 'str');
  });

  h.mockOnly(it, 'C-REP-02③(契約側): reportEngine を html/doc/大文字/不正値にしても generateReport の応答の形・PDF が同じ(mock は方式を読まない)', async () => {
    const t = await h.login('u_tanaka');
    const qa = await h.login('u_sato');
    const { recordId } = await h.makeQaOk(t, qa, { lot: 'RE1' });
    const shapes = [];
    const values = ['html', 'doc', ' Doc ', 'DOC', 'HTML', 'xyz', ''];
    for (const v of values) {
      await setEngine(v);
      const row = (await h.stateRows('Config')).find((r) => r.key === ENGINE_KEY);
      assert.equal(String(row.value), v, 'patch で書ける: ' + JSON.stringify(v));
      const r = await qa.ok('generateReport', { recordId });
      shapes.push(Object.keys(r.report).sort().join(','));
      for (const k of REPORT_KEYS) assert.ok(k in r.report, `report.${k}`);
      assert.equal(Object.keys(r).join(','), 'report', 'data は { report } だけ');
      const buf = Buffer.from(await (await fetch(r.report.url)).arrayBuffer());
      assert.equal(buf.subarray(0, 5).toString('latin1'), '%PDF-');
      assert.equal(h.sha256(buf), r.report.sha256);
      assert.ok(buf.toString('latin1').includes(`MOCK REPORT ${recordId} v`), 'mock は常に最小PDF');
      const fname = decodeURIComponent(r.report.url.split('/').pop());
      assert.match(fname, /^A現場\(仮\) 1F RE1_打設前_v\d+_\d{8}-\d{4}\.pdf$/, 'PDF名(§10.2a)は方式で変わらない: ' + fname);
    }
    assert.equal(new Set(shapes).size, 1, '応答の形(キー集合)が方式で変わらない');
    const list = await qa.ok('listReports', { recordId });
    assert.deepEqual(list.reports.map((r) => r.version), values.map((_, i) => values.length - i), 'listReports は版降順');
    // 方式を変えても Events/Reports の形は同じ。bootstrap.config にも出ない
    assert.ok(!(ENGINE_KEY in (await qa.ok('getBootstrap', {})).config));
    // 非 qa_ok は方式に関わらず REPORT_NOT_ALLOWED(C-REP-04⑥の契約側)
    await setEngine('doc');
    const { recordId: sub } = await h.makeSubmitted(t, { lot: 'RE2' });
    const na = await qa.call('generateReport', { recordId: sub });
    assert.equal(na.error.code, 'REPORT_NOT_ALLOWED'); assert.equal(na.error.data.status, 'submitted');
  });
});

describe('C-REP harness-only(/__mock/docShim がある対象のみ。mock ではスキップ)', () => {
  beforeEach(() => h.reset());

  harnessOnly('C-REP-02①②③: 行が空/html/HTML/xyz/docs は HTML方式、doc/" Doc "/DOC は doc 方式。応答の形・PDF名は同じ', async () => {
    const { recordId, qa } = await makeReportable('RE3');
    const shapes = []; const names = [];
    const run = async (v, expectDoc) => {
      await setEngine(v);
      await docShim({ reset: true });
      const r = await qa.ok('generateReport', { recordId });
      const s = await docShim({});
      if (expectDoc) {
        assert.equal(s.counts.created, 1, `${JSON.stringify(v)}: doc 方式`);
        assert.equal(await lastHtml(), '', `${JSON.stringify(v)}: lastHtml は null のまま`);
      } else {
        assert.equal(s.counts.created, 0, `${JSON.stringify(v)}: HTML方式`);
        assert.notEqual(await lastHtml(), '', `${JSON.stringify(v)}: lastHtml が更新される`);
      }
      shapes.push(Object.keys(r.report).sort().join(','));
      assert.match(r.report.url, /^https?:\/\//);
      names.push(decodeURIComponent(r.report.url.split('/').pop()).replace(/_v\d+_\d{8}-\d{4}\.pdf$/, ''));
      const res = await fetch(r.report.url);
      assert.equal(Buffer.from(await res.arrayBuffer()).subarray(0, 5).toString('latin1'), '%PDF-');
      return r;
    };
    for (const v of ['', 'html', 'HTML', 'xyz', 'docs']) await run(v, false);
    for (const v of ['doc', ' Doc ', 'DOC']) await run(v, true);
    assert.equal(new Set(shapes).size, 1, '応答の形が同じ');
    assert.equal(new Set(names).size, 1, 'PDF名(§10.2a)が同じ');
    const reps = (await h.stateRows('Reports')).filter((r) => r.recordId === recordId);
    assert.equal(reps.length, 8);
    assert.equal(new Set(reps.map((r) => Object.keys(r).sort().join(','))).size, 1, 'Reports の列が同じ');
  });

  harnessOnly('C-REP-03: doc 方式の文書(用紙A4・余白12mm・Noto Sans JP・画像数・改ページ数・表・フッタ・後始末)', async () => {
    await setEngine('doc');
    const { recordId, qa } = await makeReportable('RE4', { drawings: 1, extraPrime: 1 });
    const photos = (await h.stateRows('Photos')).filter((p) => p.recordId === recordId && !p.deleted);
    const nPhoto = photos.filter((p) => p.kind !== 'drawing').length;
    const nDrawing = photos.filter((p) => p.kind === 'drawing').length;
    assert.equal(nDrawing, 1);
    assert.ok(nPhoto >= 5, '写真が複数ページになる数: ' + nPhoto);
    await docShim({ reset: true });
    const rep = await qa.ok('generateReport', { recordId });
    const s = await docShim({});
    const d = s.lastDoc;
    assert.ok(d, 'lastDoc');
    const near = (a, b, tol, m) => assert.ok(Math.abs(a - b) <= tol, `${m}: ${a} vs ${b}`);
    near(d.pageWidth, 595.28, 0.01, 'pageWidth'); near(d.pageHeight, 841.89, 0.01, 'pageHeight');
    for (const k of ['top', 'bottom', 'left', 'right']) near(d.margins[k], 34.02, 0.05, 'margin.' + k);
    assert.equal(d.fontFamily, 'Noto Sans JP');
    assert.equal(d.images.length, nPhoto + nDrawing, '画像の数');
    const expectBreaks = nDrawing + 1 + Math.floor((nPhoto - 1) / 4);
    assert.equal(d.pageBreaks, expectBreaks, '改ページ数');
    // 写真ブロックの表(2列・235.28/291.96pt・最低行高175.75pt)の数 = 写真の枚数
    const photoTables = d.tables.filter((tb) => tb.cols === 2 && tb.colWidths.length === 2 && Math.abs(tb.colWidths[0] - 235.28) <= 0.5);
    assert.equal(photoTables.length, nPhoto, '写真ブロックの表の数');
    for (const tb of photoTables) {
      near(tb.colWidths[1], 291.96, 0.5, 'colWidths[1]');
      assert.ok(tb.minRowHeights.some((x) => Math.abs(x - 175.75) <= 0.5), '最低行高175.75pt');
    }
    const itemTable = d.tables.find((tb) => tb.cols === 7);
    assert.ok(itemTable, '項目表は7列');
    const mm = (x) => x * 72 / 25.4;
    [8, 62, 14, 18, 24, 30, 30].forEach((w, i) => near(itemTable.colWidths[i], mm(w), 0.5, 'itemTable.colWidths[' + i + ']'));
    assert.ok(d.tables.some((tb) => tb.cols === 4), '基本情報表は4列');
    assert.ok(d.tables.some((tb) => tb.cols === 3), 'サイン表は3列');
    assert.ok(d.tables.some((tb) => tb.cols === 5), '図面の凡例表は5列');
    // 内容
    assert.ok(d.text.includes('管理者コメント全文テスト'), '管理者コメント全文');
    assert.ok(d.footerText.includes(recordId), 'フッタに記録ID');
    const hash = /[0-9a-f]{64}/.exec(d.footerText);
    assert.ok(hash, 'フッタに64桁のハッシュ');
    assert.ok(!d.text.includes(hash[0]), '本文末尾にハッシュの段落がない');
    assert.ok(!/ページ|Page|\/\s*\d+/.test(d.footerText), 'ページ番号がない');
    // 後始末
    assert.equal(d.trashed, true);
    assert.equal(s.counts.trashed, s.counts.created);
    const dl = await h.driveLog();
    const dls = JSON.stringify(dl);
    assert.ok(/create/.test(dls) && /trash/.test(dls), 'driveLog に create と trash が出る(一時文書)');
    const ev = (await h.eventsOf(recordId)).filter((e) => e.type === 'report_generated').pop();
    assert.ok(ev, 'report_generated');
    const detail = typeof ev.detail === 'string' ? JSON.parse(ev.detail) : ev.detail;
    assert.equal(detail.engine, 'doc'); assert.ok(!('fallbackFrom' in detail));
    assert.equal(rep.report.version, 1);
  });

  harnessOnly('C-REP-04: doc 方式の失敗(create/image/convert/slow)は自動で HTML方式に切り替わり、PDF は必ずできる。REPORT_NOT_ALLOWED はフォールバックしない', async () => {
    await setEngine('doc');
    const { recordId, qa, t } = await makeReportable('RE5', { drawings: 1 });
    let n = 0;
    for (const failMode of ['create', 'image', 'convert', 'slow']) {
      await docShim({ reset: true, failMode });
      const r = await qa.call('generateReport', { recordId });
      n += 1;
      assert.equal(r.ok, true, `${failMode}: ` + JSON.stringify(r.error));
      assert.equal(r.data.report.version, n);
      const buf = Buffer.from(await (await fetch(r.data.report.url)).arrayBuffer());
      assert.equal(buf.subarray(0, 5).toString('latin1'), '%PDF-');
      const s = await docShim({});
      assert.equal(s.counts.created, s.counts.trashed, `${failMode}: 作った一時文書は必ずゴミ箱`);
      const ev = (await h.eventsOf(recordId)).filter((e) => e.type === 'report_generated').pop();
      const detail = typeof ev.detail === 'string' ? JSON.parse(ev.detail) : ev.detail;
      assert.equal(detail.engine, 'html', failMode); assert.equal(detail.fallbackFrom, 'doc', failMode);
      assert.equal(typeof detail.fallbackReason, 'string'); assert.ok(detail.fallbackReason.length > 0 && detail.fallbackReason.length <= 200, failMode + ' fallbackReason');
    }
    assert.equal((await h.stateRows('Reports')).filter((r) => r.recordId === recordId).length, 4, 'Reports は1回ごとに1行');
    // REPORT_NOT_ALLOWED はフォールバックしない
    await docShim({ reset: true, failMode: 'none' });
    const { recordId: sub } = await h.makeSubmitted(t, { lot: 'RE6' });
    const na = await qa.call('generateReport', { recordId: sub });
    assert.equal(na.error.code, 'REPORT_NOT_ALLOWED');
    assert.equal((await docShim({})).counts.created, 0);
  });
});
