'use strict';
/**
 * 元請PDFの Google ドキュメント方式(SPEC 版1.10.1 §10.5)。C-REP-02〜05 に相当(harness-only)。
 * DocumentApp は harness の代役(docshim.js)。検証できるのは値(用紙・余白・画像・改ページ・列幅・背景色)と
 * 処理の流れだけで、見た目(文字化け・4枚/ページの収まり)は実GASでしか確認できない(SPEC §12.7)。
 * C-REP-06(appsscript.json / setupSheets / spec-sync)は tests/unit の担当だが、①②は同じ事実をここでも確認する。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { fresh, rid, photoParams, nowPlus, fillAll } = require('./helpers');

const h = fresh();
const tanaka = h.as('u_tanaka'), sato = h.as('u_sato');
test.beforeEach(() => h.resetAll());

const MM = (mm) => mm * 72 / 25.4;
// 表の実効幅(版1.10.1 実機PDF対応。ReportDoc.gs REPORT_DOC_TABLE_W_MM): SPEC 名目の列幅(合計186)×184/186
const K = 184 / 186;
const MMK = (mm) => MM(mm * K);
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ''} ${a} ≈ ${b} (±${eps})`);
const docShim = () => h.control('docShim', {}).data;
const setEngine = (v) => {
  const { Repo } = h.ctx;
  Repo.resetCache(); Repo.fresh('Config');
  const row = Repo.get('Config', 'reportEngine');
  if (v === undefined) { // 行ごと消す(古い本番シートの再現)
    if (row) h.ctx.SpreadsheetApp.openById(h.ctx.PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID')).getSheetByName('Config').deleteRow(row._r);
  } else if (row) Repo.update('Config', row, { value: v });
  else Repo.append('Config', { key: 'reportEngine', value: v, type: 'str', description: '' });
  h.ctx.clearRefCache(); Repo.resetCache();
};
const configRows = () => h.control('state', { sheet: 'Config' }).data.rows;

/** 幅w・高さh と読める最小の JPEG(SOF だけ。harness の DocumentApp 代役が実寸を読む) */
function jpegSized(w, hh) {
  const b = Buffer.alloc(2 + 2 + 17 + 2);
  b.writeUInt16BE(0xffd8, 0); b.writeUInt16BE(0xffc0, 2); b.writeUInt16BE(17, 4);
  b[6] = 8; b.writeUInt16BE(hh, 7); b.writeUInt16BE(w, 9); b[11] = 3;
  [[1, 0x22, 0], [2, 0x11, 1], [3, 0x11, 1]].forEach((c, i) => { b[12 + i * 3] = c[0]; b[13 + i * 3] = c[1]; b[14 + i * 3] = c[2]; });
  b.writeUInt16BE(0xffd9, 21);
  return b;
}

/**
 * qa_ok の記録を作る。i8 は職長NG(職長コメントあり)、管理者は ok(管理者コメントあり)。
 * opts.photos: 検査写真(kind=photo)の枚数に直す(最後の1枚は side=prime・項目なし)。省略は作成時のまま。
 * opts.drawings: [{side,w,h,markers}] の図面。
 */
function makeQaOk(opts) {
  opts = opts || {};
  const id = rid('r');
  const r = tanaka('createRecord', { recordId: id, siteId: 's_a', floor: '1F', lot: 'D' + Math.floor(Math.random() * 1e9), stage: 'pre_pour', pourPlannedAt: nowPlus(h, 72 * 60) });
  assert.equal(r.ok, true, JSON.stringify(r));
  const ng = (i) => (i.itemId === 'i8' ? { result: 'ng', severity: 'minor', note: '職長の備考TEXT' } : {});
  fillAll(h, tanaka, id, 'self', { patch: ng, photoFor: (i) => i.itemId === 'i8' });
  (opts.drawings || []).filter((d) => d.side !== 'qa').forEach((d) => {
    const p = tanaka('uploadPhotoChunk', drawingParams(id, d));
    assert.equal(p.ok, true, JSON.stringify(p));
  });
  assert.equal(tanaka('submitRecord', { recordId: id, round: 1 }, { pin: '1111' }).ok, true);
  assert.equal(sato('claimReview', { recordId: id, round: 1 }).ok, true);
  fillAll(h, sato, id, 'qa', { patch: (i) => (i.itemId === 'i8' ? { result: 'ok', note: '管理者の備考TEXT' } : {}) });
  (opts.drawings || []).filter((d) => d.side === 'qa').forEach((d) => {
    const p = sato('uploadPhotoChunk', drawingParams(id, d));
    assert.equal(p.ok, true, JSON.stringify(p));
  });
  assert.equal(sato('submitVerdict', { recordId: id, round: 1, verdict: 'ok' }, { pin: '3333' }).ok, true);
  if (opts.photos !== undefined) setPhotoCount(id, opts.photos, opts.thumbs);
  return id;
}

function drawingParams(id, d) {
  const jpeg = jpegSized(d.w, d.h);
  return photoParams(id, null, d.side || 'self', {
    kind: 'drawing', markers: d.markers || [{ itemId: 'i9', label: '④-1', x: 0.2, y: 0.4 }, { itemId: 'i9', label: '④-2', x: 0.5, y: 0.5 }],
    takenAt: nowPlus(h, -1), width: d.w, height: d.h, data: jpeg.toString('base64'), thumb: jpeg.toString('base64'), bytes: jpeg.length,
    sha256: require('crypto').createHash('sha256').update(jpeg).digest('hex'),
  });
}

/** 検査写真(図面を除く)を n 枚に作り直す(Photos 行を直接操作)。thumbs: 各写真のサムネ実寸 [[w,h],…](循環) */
function setPhotoCount(recordId, n, thumbs) {
  const { Repo, Util, DriveApp, Utilities } = h.ctx;
  Repo.resetCache();
  const rows = Repo.where('Photos', 'recordId', recordId).filter((p) => !p.deleted && p.kind !== 'drawing');
  const withItem = rows.filter((p) => p.itemId);
  rows.forEach((p) => Repo.update('Photos', p, { deleted: true, deletedBy: 'system', deletedAt: Util.nowIso() }));
  const root = DriveApp.getFolderById(Repo.get('Config', 'driveRootFolderId').value);
  for (let i = 0; i < n; i++) {
    const src = withItem[i % withItem.length];
    const copy = {};
    Object.keys(src).forEach((k) => { copy[k] = src[k]; });
    copy.photoId = Util.newId('p'); copy.deleted = false; copy.deletedBy = ''; copy.deletedAt = '';
    if (i === n - 1 && n > 1) { copy.itemId = ''; copy.side = 'prime'; copy.stampText = '元請サイン証跡STAMP'; }
    const dim = thumbs && thumbs[i % thumbs.length];
    if (dim) {
      copy.thumbFileId = root.createFile(Utilities.newBlob(jpegSized(dim[0], dim[1]), 'image/jpeg', 't' + i + '.jpg')).getId();
      copy.width = dim[0] * 4; copy.height = dim[1] * 4;
    }
    Repo.append('Photos', copy);
  }
  h.ctx.clearRefCache(); Repo.resetCache();
}

const gen = (id) => {
  const g = sato('generateReport', { recordId: id });
  assert.equal(g.ok, true, JSON.stringify(g));
  return g.data.report;
};
const reportEvents = (id) => h.control('state', { sheet: 'Events' }).data.rows.filter((e) => e.recordId === id && e.kind === 'report_generated');
const detailOf = (e) => (typeof e.detail === 'string' ? JSON.parse(e.detail) : e.detail);
const pdfName = (rep) => decodeURIComponent(rep.url.split('/files/reports/')[1]);
const pdfFile = (rep) => h.state.driveFindFile(pdfName(rep));

test('C-REP-02 方式の切替: html 側(行なし/空/html/HTML/xyz/docs)と doc 側(doc/" Doc "/DOC)', () => {
  const id = makeQaOk();
  const reps = {};
  const htmlCases = [undefined, '', 'html', 'HTML', 'xyz', 'docs'];
  const docCases = ['doc', ' Doc ', 'DOC'];
  [].concat(htmlCases, docCases).forEach((v) => {
    setEngine(v);
    h.state.lastHtml = null; h.control('docShim', { reset: true });
    const rep = gen(id);
    reps[String(v)] = rep;
    const isDoc = docCases.includes(v);
    const obs = docShim();
    if (isDoc) {
      assert.equal(obs.counts.created, 1, `${JSON.stringify(v)} は doc 方式`);
      assert.equal(h.state.lastHtml, null, 'doc 方式では HtmlService を使わない');
    } else {
      assert.equal(obs.counts.created, 0, `${JSON.stringify(v)} は html 方式`);
      assert.ok(h.state.lastHtml && h.state.lastHtml.length > 500);
    }
    // ③ どちらでも同じ形: url・PDF・名前・Reports の列と値の形
    assert.match(rep.url, /^https?:\/\//);
    assert.match(rep.sha256, /^[0-9a-f]{64}$/);
    assert.match(pdfName(rep), /^.+ 1F D\d+_打設前_v\d+_\d{8}-\d{4}\.pdf$/);
    assert.equal(pdfFile(rep).blob._buf.subarray(0, 5).toString('latin1'), '%PDF-');
  });
  const rows = h.control('state', { sheet: 'Reports' }).data.rows.filter((r) => r.recordId === id);
  assert.equal(rows.length, htmlCases.length + docCases.length);
  assert.deepEqual(rows.map((r) => r.version), rows.map((_, i) => i + 1), '版は連番');
  rows.forEach((r) => {
    assert.deepEqual(Object.keys(r).sort(), Object.keys(rows[0]).sort(), 'Reports の列は同じ');
    assert.match(r.driveFileId, /^fi/);
    assert.equal(h.ctx.DriveApp.getFileById(r.driveFileId).getName().endsWith('.pdf'), true, 'driveFileId は PDF 本体(メール添付はこのファイル)');
  });
  // ④ bootstrap.config に reportEngine がない。Config シートには行がある
  const boot = h.call('getBootstrap', {}, { token: h.tok('u_tanaka') });
  assert.equal(boot.ok, true);
  assert.equal(Object.prototype.hasOwnProperty.call(boot.data.config, 'reportEngine'), false);
  assert.ok(configRows().some((r) => r.key === 'reportEngine'));
});

test('C-REP-02⑤ 既定は html: 初期 Config の reportEngine は html / str。HTML方式は従来どおり(A4 を HTML で指定しない前提のまま変更なし)', () => {
  const row = configRows().find((r) => r.key === 'reportEngine');
  assert.equal(row.value, 'html');
  assert.equal(row.type, 'str');
  assert.ok(row.description.length > 10);
  const id = makeQaOk();
  const rep = gen(id);
  assert.equal(docShim().counts.created, 0);
  assert.match(h.state.lastHtml, /<table class="items">/);
  const d = detailOf(reportEvents(id)[0]);
  assert.deepEqual(d, { reportId: rep.reportId, version: 1, engine: 'html' });
  assert.equal(pdfFile(rep).description, 'engine=html');
});

test('C-REP-03 doc方式の中身: 用紙・フォント・画像・改ページ・表・内容・フッタ・後始末', () => {
  const id = makeQaOk({
    photos: 6, thumbs: [[400, 300], [200, 400], [300, 300], [800, 200], [100, 100], [160, 90]],
    drawings: [{ side: 'self', w: 1600, h: 900 }, { side: 'qa', w: 900, h: 1600, markers: [{ itemId: 'i9', label: '④-1', x: 0.1, y: 0.1 }] }].slice(0, 1),
  });
  setEngine('doc');
  const rep = gen(id);
  const { counts, lastDoc: d } = docShim();
  const model = h.state.docShim.last;

  // ① 用紙
  near(d.pageWidth, 595.28, 0.01, '幅'); near(d.pageHeight, 841.89, 0.01, '高さ');
  ['top', 'bottom', 'left', 'right'].forEach((k) => near(d.margins[k], 34.02, 0.05, '余白' + k));
  // ②
  assert.equal(d.fontFamily, 'Noto Sans JP');
  // ③ 画像の数と大きさ(写真6 + 図面1)
  assert.equal(d.images.length, 7);
  const inBlock = d.images.filter((im) => im.inTableIndex >= 0 && d.tables[im.inTableIndex].cols === 2);
  assert.equal(inBlock.length, 6);
  inBlock.forEach((im) => { assert.ok(im.w <= MMK(80) + 0.5 && im.h <= MMK(58) + 0.5, `写真は枠内: ${im.w}x${im.h}`); });
  // 縦横比(サムネ実寸と±1%)。順序は写真の並び(NG項目優先)で変わるので比率の集合で確認
  const want = [[400, 300], [200, 400], [300, 300], [800, 200], [100, 100], [160, 90]].map(([w, hh]) => w / hh).sort();
  const got = inBlock.map((im) => im.w / im.h).sort();
  got.forEach((r, i) => assert.ok(Math.abs(r - want[i]) / want[i] <= 0.01, `縦横比 ${r} vs ${want[i]}`));
  const dr = d.images.filter((im) => im.inTableIndex >= 0 && d.tables[im.inTableIndex].cols === 1);
  assert.equal(dr.length, 1);
  assert.ok(dr[0].w <= MMK(186) + 0.5 && dr[0].h <= MMK(170) + 0.5);
  near(dr[0].w / dr[0].h, 1600 / 900, 0.02, '図面の比率');
  assert.ok(Math.abs(dr[0].w - MMK(186)) < 0.5 || Math.abs(dr[0].h - MMK(170)) < 0.5, '枠いっぱいに収める');
  // ④ 改ページ: 図面1 + 「写真」見出し前1 + floor((6-1)/4)=1
  assert.equal(d.pageBreaks, 3);
  // ⑤ 表
  const blocks = d.tables.filter((t) => t.cols === 2);
  assert.equal(blocks.length, 6);
  blocks.forEach((t) => {
    assert.equal(t.rows, 1);
    near(t.colWidths[0], MMK(83), 0.5); near(t.colWidths[1], MMK(103), 0.5);
    near(t.minRowHeights[0], 175.75, 0.5);
    assert.equal(t.borderWidth, 0.75);
  });
  const items = d.tables.find((t) => t.cols === 7);
  [8, 40, 14, 18, 46, 30, 30].forEach((mm, i) => near(items.colWidths[i], MMK(mm), 0.5, '項目表の列' + i)); // 版1.11.0(旧 8/62/14/18/24/30/30)
  near(items.colWidths.reduce((a, b) => a + b, 0), MM(184), 0.5);
  // 全ての表の列幅合計が実効幅(184mm)で揃う(右端が本文右余白からはみ出さない)
  d.tables.forEach((t, i) => near(t.colWidths.reduce((a, b) => a + b, 0), MM(184), 0.5, '表' + i + 'の列幅合計'));
  // 版1.11.2: 実GASの Paragraph に setKeepWithNext は無い。keepWithNext は使わず、観測にも出さない
  assert.equal(d.keepWithNextTexts, undefined);
  assert.ok(Array.isArray(d.paragraphs) && d.paragraphs.every((p) => typeof p.text === 'string' && !('keepWithNext' in p)));
  ['サイン欄(3者)', '結果サマリ', '項目表', 'NG・是正の経過', '写真', '確認箇所(図面)'].forEach((hd) => {
    assert.equal(d.paragraphs.filter((p) => p.text === hd).length, 1, 'h2は1つ: ' + hd);
  });
  assert.equal(d.paragraphs.filter((p) => p.text.startsWith('管理者コメントの全文は')).length, 0, '旧注記は廃止(版1.11.0)');
  assert.equal(d.paragraphs.length, model.body.children.filter((c) => c.kind === 'p').length, '表のセル内の段落は含めない');
  assert.ok(!d.paragraphs.some((p) => p.text.indexOf('撮影') === 0), '写真ブロックのセル内の段落は含めない');
  items.minRowHeights.slice(1).forEach((v) => near(v, 17.0, 0.1));
  const info = d.tables[0];
  assert.equal(info.cols, 4);
  [30, 63, 30, 63].forEach((mm, i) => near(info.colWidths[i], MMK(mm), 0.5));
  const sign = d.tables.find((t) => t.cols === 3 && t.rows === 2);
  assert.ok(sign); near(sign.minRowHeights[1], 36, 0.01);
  const legend = d.tables.find((t) => t.cols === 6);
  assert.ok(legend, '図面の凡例表(版1.11.0: 6列)');
  [24, 76, 28, 24, 17, 17].forEach((mm, i) => near(legend.colWidths[i], MMK(mm), 0.5));
  const sum = d.tables.find((t) => t.cols === 4 && t.rows === 3);
  assert.ok(sum); [30, 52, 52, 52].forEach((mm, i) => near(sum.colWidths[i], MMK(mm), 0.5));
  // ⑥ 内容
  const subject = pdfName(rep).split('_')[0];
  assert.ok(d.text.includes(subject) && d.text.includes('打設前'));
  assert.ok(d.text.includes('職長の備考TEXT') && d.text.includes('管理者の備考TEXT'));
  assert.ok(d.text.includes('元請サイン証跡STAMP'));
  const itemsIdx = d.tables.indexOf(items);
  const cells = model.cellTexts(itemsIdx);
  const ngRow = cells.findIndex((r) => r[5] === '職長の備考TEXT');
  assert.ok(ngRow > 0 && cells[ngRow][6] === '管理者の備考TEXT', '職長コメントと管理者コメントは別の列');
  assert.equal(cells[0].join('|'), 'No.|項目|職長結果|管理者結果|実測(設計値との差)|職長コメント|管理者コメント');
  items.cellBackgrounds.forEach((row, r) => {
    row.forEach((bg) => assert.equal(bg, r === ngRow ? '#FDE8E8' : (r === 0 ? '#EEEEEE' : null), `行${r}の背景`));
  });
  // 項目に紐づかない写真のブロック: 項目No.・コメントのラベルなし
  const primeBlock = blocks.map((t, i) => model.cellTexts(d.tables.indexOf(t))[0][1]).find((tx) => tx.includes('元請サイン証跡STAMP'));
  assert.ok(primeBlock && !/No\.|コメント|職長:|管理者:/.test(primeBlock), '元請サイン証跡のブロック: ' + primeBlock);
  assert.ok(primeBlock.includes('撮影: 元請サイン証跡'));
  // 項目つきブロックには両方のコメント欄(別段落)
  const itemBlock = blocks.map((t) => model.cellTexts(d.tables.indexOf(t))[0][1]).find((tx) => tx.includes('職長コメント:'));
  assert.ok(itemBlock.includes('管理者コメント:'));
  assert.ok(itemBlock.split('\n').findIndex((l) => l.startsWith('職長コメント:')) < itemBlock.split('\n').findIndex((l) => l.startsWith('管理者コメント:')));
  // NG の文字は赤
  assert.ok(model.coloredTexts('#CC0000').some((t) => t.startsWith('NG')), 'NG の文字が赤');
  // ⑦ フッタ
  const hash = /SHA-256\): ([0-9a-f]{64})/.exec(d.footerText);
  assert.ok(hash && d.footerText.includes('記録ID: ' + id), 'フッタ');
  assert.ok(!/ページ|Page|\d+\s*\/\s*\d+$/.test(d.footerText), 'ページ番号なし');
  assert.equal(d.text.split(hash[1]).length - 1, 0, '本文末尾に同じハッシュの段落がない');
  // ハッシュは reportSnapshotHash_ と同じ値
  const rec = h.ctx.loadRecord_(id);
  const same = h.ctx.reportSnapshotHash_(rec, h.ctx.itemsOf_(id), h.ctx.Repo.where('Events', 'recordId', id).filter((e) => /^verdict_/.test(e.kind)));
  assert.equal(hash[1], same);
  // ⑧ 後始末
  assert.equal(d.trashed, true);
  assert.equal(counts.created, 1); assert.equal(counts.trashed, counts.created);
  assert.ok(!h.control('drive', {}).data.paths.some((p) => p.startsWith('_tmp_report_')), '一時文書が残らない');
  const log = h.control('driveLog', {}).data.log.filter((l) => l.path.startsWith('_tmp_report_'));
  assert.deepEqual(log.map((l) => l.op), ['create', 'trash']);
  assert.ok(d.title.startsWith('_tmp_report_' + id + '_'));
  // ⑨ Events
  assert.deepEqual(detailOf(reportEvents(id)[0]), { reportId: rep.reportId, version: 1, engine: 'doc' });
  assert.equal(pdfFile(rep).description, 'engine=doc');
  // フォールバックしていない / 共有設定・保存先は通常どおり
  assert.deepEqual(pdfFile(rep).sharing, { access: 'ANYONE_WITH_LINK', perm: 'VIEW' });
  assert.ok(h.control('drive', {}).data.paths.some((p) => p.startsWith('reports/') && p.endsWith('.pdf')));
});

test('C-REP-03④ 改ページ数: 写真0/4/5/8/9枚。最後の写真ブロックの後に改ページを入れない', () => {
  setEngine('doc');
  const cases = [[0, 1], [1, 1], [4, 1], [5, 2], [8, 2], [9, 3], [12, 3]]; // [写真枚数, 図面なしの pageBreaks = 1(写真見出し前) + floor((n-1)/4)]
  cases.forEach(([n, breaks]) => {
    const id = makeQaOk({ photos: n });
    h.control('docShim', { reset: true });
    gen(id);
    const d = docShim().lastDoc;
    assert.equal(d.pageBreaks, breaks, `写真${n}枚`);
    assert.equal(d.tables.filter((t) => t.cols === 2).length, n, `写真${n}枚の表の数`);
    if (n > 0 && n % 4 === 0) assert.equal(d.pageBreaks, 1 + (n / 4 - 1), '4の倍数でも最後の後に改ページなし');
  });
  // 図面あり: 図面の数 + 1 + floor((写真-1)/4)
  const id = makeQaOk({ photos: 5, drawings: [{ side: 'self', w: 800, h: 600 }] });
  h.control('docShim', { reset: true });
  gen(id);
  assert.equal(docShim().lastDoc.pageBreaks, 1 + 1 + 1);
});

test('C-REP-03 図面の枠と凡例: 横長は幅186mm、縦長は高さ170mm。図面0枚なら見出しも出さない。印なしは文言', () => {
  setEngine('doc');
  const none = makeQaOk({ photos: 2 });
  gen(none);
  let d = docShim().lastDoc;
  assert.ok(!d.text.includes('確認箇所(図面)'));
  assert.equal(d.tables.filter((t) => t.cols === 6).length, 0);

  const id = makeQaOk({ photos: 2, drawings: [{ side: 'self', w: 600, h: 900 }, { side: 'self', w: 800, h: 100, markers: [] }] });
  h.control('docShim', { reset: true });
  gen(id);
  d = docShim().lastDoc;
  const dr = d.images.filter((im) => im.inTableIndex >= 0 && d.tables[im.inTableIndex].cols === 1);
  assert.equal(dr.length, 2);
  const tall = dr.find((im) => im.h > im.w), wide = dr.find((im) => im.w > im.h);
  near(tall.h, MMK(170), 0.5); assert.ok(tall.w <= MMK(186));
  near(wide.w, MMK(186), 0.5); assert.ok(wide.h <= MMK(170));
  assert.ok(d.text.includes('印の書き込みなし'));
  assert.equal(d.tables.filter((t) => t.cols === 6).length, 1, '印のある図面だけ凡例表');
  assert.equal((d.text.match(/確認箇所\(図面\)/g) || []).length, 2);
});

test('C-REP-03 出来形・会社名: 出来形は打設予定日時の行を出さず、記録ID行の3・4列目は空。職長の会社名が空なら行ごと出さない', () => {
  setEngine('doc');
  const id = makeQaOk({ photos: 1 });
  gen(id);
  let m = h.state.docShim.last;
  let rowsOf = m.cellTexts(0).map((r) => r.join('|'));
  assert.ok(rowsOf.some((r) => r.startsWith('打設予定日時|')));
  assert.ok(!rowsOf.some((r) => r.startsWith('職長の会社名')), '会社名が空なら出さない');
  h.control('patch', { sheet: 'Users', key: 'u_tanaka', set: { company: '山田工業株式会社' } });
  const id2 = makeQaOk({ photos: 1 });
  gen(id2);
  m = h.state.docShim.last;
  rowsOf = m.cellTexts(0).map((r) => r.join('|'));
  assert.ok(rowsOf.some((r) => r.startsWith('職長の会社名|山田工業株式会社|職長|田中')), rowsOf.join(' / '));
  assert.ok(m.cellTexts(1).flat().some((t) => t.includes('山田工業株式会社')), 'サイン欄に会社名');
});

test('C-REP-04 フォールバック: create/image/convert/slow でも PDF(HTML方式)ができ、記録が残る。一時文書は必ずゴミ箱', () => {
  setEngine('doc');
  ['create', 'image', 'convert', 'slow'].forEach((mode) => {
    const id = makeQaOk({ photos: 3 });
    h.control('docShim', { failMode: mode, reset: true });
    h.state.lastHtml = null; h.state.loggerLines.length = 0;
    const before = h.control('state', { sheet: 'Reports' }).data.rows.length;
    const rep = gen(id);
    // ① PDF ができる(HTML方式)。Reports が1行増える。名前・保存先・共有は通常どおり
    assert.ok(h.state.lastHtml && h.state.lastHtml.length > 500, mode + ': HTML方式で作った');
    assert.equal(h.control('state', { sheet: 'Reports' }).data.rows.length, before + 1);
    assert.match(pdfName(rep), /_打設前_v1_\d{8}-\d{4}\.pdf$/);
    assert.equal(pdfFile(rep).blob._buf.subarray(0, 5).toString('latin1'), '%PDF-');
    assert.deepEqual(pdfFile(rep).sharing, { access: 'ANYONE_WITH_LINK', perm: 'VIEW' });
    // ② Events
    const d = detailOf(reportEvents(id)[0]);
    assert.equal(d.engine, 'html'); assert.equal(d.fallbackFrom, 'doc');
    assert.ok(typeof d.fallbackReason === 'string' && d.fallbackReason.length > 0 && d.fallbackReason.length <= 200, mode + ': ' + d.fallbackReason);
    // ③ Drive の説明
    assert.ok(pdfFile(rep).description.startsWith('engine=html (fallback from doc: '), pdfFile(rep).description);
    assert.ok(pdfFile(rep).description.length <= 'engine=html (fallback from doc: '.length + 100 + 1);
    // ④ 一時文書
    const c = docShim().counts;
    if (mode === 'create') assert.deepEqual(c, { created: 0, converted: 0, trashed: 0 });
    else assert.equal(c.created, c.trashed, mode + ': 作った一時文書は全てゴミ箱');
    // ⑤ Logger に理由
    assert.ok(h.state.loggerLines.some((l) => l.includes('reportEngine=doc に失敗したため html で生成します: ')), mode);
    if (mode === 'slow') assert.match(d.fallbackReason, /REPORT_DOC_TIMEOUT/);
    if (mode === 'convert') assert.equal(docShim().lastDoc, null, '変換に進めなかった文書は lastDoc にならない');
  });
  // 成功した doc 方式は engine=doc、直後の次の生成は通常どおり doc に戻る(failMode none)
  h.control('docShim', { failMode: 'none', reset: true });
  const id = makeQaOk({ photos: 3 });
  const rep = gen(id);
  assert.equal(pdfFile(rep).description, 'engine=doc');
});

test('C-REP-04⑥⑦ 権限・状態のエラーはフォールバックしない。HTML方式も失敗したら DRIVE_ERROR', () => {
  setEngine('doc');
  // submitted の記録は REPORT_NOT_ALLOWED のまま。doc の一時文書は作られない
  const sub = rid('r');
  assert.equal(tanaka('createRecord', { recordId: sub, siteId: 's_a', floor: '2F', lot: 'S1', stage: 'pre_pour', pourPlannedAt: nowPlus(h, 72 * 60) }).ok, true);
  fillAll(h, tanaka, sub, 'self');
  assert.equal(tanaka('submitRecord', { recordId: sub, round: 1 }, { pin: '1111' }).ok, true);
  h.control('docShim', { reset: true });
  const r = sato('generateReport', { recordId: sub });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'REPORT_NOT_ALLOWED');
  assert.equal(docShim().counts.created, 0);
  // 職長は FORBIDDEN_ROLE(権限エラー)
  const id = makeQaOk({ photos: 2 });
  assert.equal(tanaka('generateReport', { recordId: id }).error.code, 'FORBIDDEN_ROLE');
  assert.equal(docShim().counts.created, 0);
  // doc が失敗 → html も Drive 保存で失敗 → DRIVE_ERROR(従来どおり)
  h.control('docShim', { failMode: 'convert' });
  h.state.driveFail = { createFile: 1 };
  const e = sato('generateReport', { recordId: id });
  assert.equal(e.ok, false);
  assert.equal(e.error.code, 'DRIVE_ERROR');
  h.state.driveFail = null;
});

test('C-REP-04 doc 方式の間は reportEngine を読み直す: doc → html に戻すと次の生成は html(元に戻せる)', () => {
  const id = makeQaOk({ photos: 2 });
  setEngine('doc'); gen(id);
  assert.equal(detailOf(reportEvents(id)[0]).engine, 'doc');
  setEngine('html'); gen(id);
  assert.equal(detailOf(reportEvents(id)[1]).engine, 'html');
  assert.equal(detailOf(reportEvents(id)[1]).fallbackFrom, undefined);
});

test('C-REP-05 ACTIONS は43のまま。checkReportEngine は action ではなく、HTTP で送ると BAD_REQUEST', () => {
  assert.equal(Object.keys(h.ctx.ACTIONS).length, 43);
  assert.equal(Object.prototype.hasOwnProperty.call(h.ctx.ACTIONS, 'checkReportEngine'), false);
  const r = h.call('checkReportEngine', {});
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'BAD_REQUEST');
  assert.equal(typeof h.ctx.checkReportEngine, 'function');
});

test('C-REP-05 checkReportEngine(): OK 文字列・A4・一時文書はゴミ箱・何も書かない。convert 失敗は例外', () => {
  const snap = () => JSON.stringify({
    sheets: Object.keys(h.ctx.SCHEMA).map((n) => [n, h.control('state', { sheet: n }).data.rows]),
    props: h.ctx.PropertiesService.getScriptProperties().getProperties(),
  });
  const before = snap();
  const msg = h.ctx.checkReportEngine();
  assert.equal(msg, 'OK: doc 方式の変換に成功しました(A4 595.28×841.89pt)');
  const { counts, lastDoc: d } = docShim();
  near(d.pageWidth, 595.28, 0.01); near(d.pageHeight, 841.89, 0.01);
  ['top', 'bottom', 'left', 'right'].forEach((k) => near(d.margins[k], 34.02, 0.05));
  assert.equal(d.trashed, true);
  assert.deepEqual(counts, { created: 1, converted: 1, trashed: 1 });
  assert.ok(d.title.startsWith('_tmp_checkReportEngine_'));
  assert.equal(d.pageBreaks, 0);
  assert.equal(d.tables.length, 1); assert.deepEqual([d.tables[0].rows, d.tables[0].cols], [2, 2]);
  assert.ok(/[ぁ-ん]/.test(d.text), '日本語の文');
  assert.ok(h.state.loggerLines.includes(msg), '実行ログに出る');
  assert.equal(snap(), before, 'シート・Events・Reports・ScriptProperties は変わらない');
  assert.ok(!h.control('drive', {}).data.paths.some((p) => p.startsWith('_tmp_')));
  // 失敗は握りつぶさない(例外)。一時文書は片付く
  h.control('docShim', { failMode: 'convert', reset: true });
  assert.throws(() => h.ctx.checkReportEngine(), /PDF 変換の失敗/);
  assert.deepEqual(docShim().counts, { created: 1, converted: 0, trashed: 1 });
  h.control('docShim', { failMode: 'create' });
  assert.throws(() => h.ctx.checkReportEngine(), /作成の失敗/);
});

test('C-REP-06①② appsscript.json に documents スコープ(既存4つも残る)。setupSheets は reportEngine の不足行だけ1行追記', () => {
  const man = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'appsscript.json'), 'utf8'));
  ['spreadsheets', 'drive', 'script.scriptapp', 'script.send_mail', 'documents'].forEach((s) => {
    assert.ok(man.oauthScopes.includes('https://www.googleapis.com/auth/' + s), s);
  });
  assert.equal(man.oauthScopes.length, 5, '余計なスコープを足さない');
  // 既存 Config(reportEngine なし)に setupSheets
  setEngine(undefined);
  const before = configRows().filter((r) => r.key !== 'reportEngine');
  assert.equal(configRows().some((r) => r.key === 'reportEngine'), false);
  h.control('patch', { sheet: 'Config', key: 'pdfShareMode', set: { value: 'private' } });
  h.ctx.setupSheets();
  h.ctx.clearRefCache();
  const after = configRows();
  const added = after.filter((r) => r.key === 'reportEngine');
  assert.equal(added.length, 1);
  assert.equal(added[0].value, 'html'); assert.equal(added[0].type, 'str');
  assert.equal(after.length, before.length + 1, '追記は1行だけ');
  assert.equal(after.find((r) => r.key === 'pdfShareMode').value, 'private', '既存の値は変わらない');
  h.ctx.setupSheets();
  assert.equal(configRows().filter((r) => r.key === 'reportEngine').length, 1, '再実行しても増えない');
});

test('C-REP-03 出来形・approved: 打設予定日時の行なし・記録ID行は3・4列目が空・ステータス「出来形確認済」・元請サイン欄に担当者名と方法', () => {
  setEngine('doc');
  const recordId = rid('r');
  assert.equal(tanaka('createRecord', { recordId, siteId: 's_a', floor: '2F', lot: 'PD' + Math.floor(Math.random() * 1e9), stage: 'post_demold' }).ok, true);
  const fill = (as, side) => {
    const detail = as('getRecord', { recordId }).data.record;
    assert.equal(as(side === 'self' ? 'saveDraft' : 'saveQaDraft', { recordId, items: detail.items.map((i) => ({ itemId: i.itemId, result: 'ok' })) }).ok, true);
    detail.items.filter((i) => i.def.key).forEach((i) => assert.equal(as('uploadPhotoChunk', photoParams(recordId, i.itemId, side, { takenAt: nowPlus(h, -1) })).ok, true));
  };
  fill(tanaka, 'self');
  assert.equal(tanaka('submitRecord', { recordId, round: 1 }, { pin: '1111' }).ok, true);
  assert.equal(sato('claimReview', { recordId, round: 1 }).ok, true);
  fill(sato, 'qa');
  assert.equal(sato('submitVerdict', { recordId, round: 1, verdict: 'ok' }, { pin: '3333' }).ok, true);
  assert.equal(sato('recordPrimeSign', { recordId, signerName: '山田太郎', method: 'paper' }, { pin: '3333' }).ok, true);
  const rep = gen(recordId);
  const m = h.state.docShim.last;
  const info = m.cellTexts(0).map((r) => r.join('|'));
  assert.ok(info.some((r) => r.startsWith('記録ID|' + recordId + '||')), info.join(' / '));
  assert.ok(!info.some((r) => r.startsWith('打設予定日時')));
  assert.ok(info.some((r) => r.startsWith('ステータス|出来形確認済|')));
  assert.ok(m.fullText().includes('型枠工事 出来形検査記録'));
  const sign = m.cellTexts(1)[1];
  assert.ok(sign[2].includes('山田太郎') && sign[2].includes('紙に署名') && sign[2].includes('記録者: 佐藤'), sign[2]);
  assert.ok(sign[0].includes('PIN認証による電子サイン') && sign[1].includes('判定: 合格'));
  assert.match(pdfName(rep), /_出来形_v1_/);
});

test('C-REP-03 未署名(qa_ok)の元請欄は空欄の線と「署名・押印」', () => {
  setEngine('doc');
  const id = makeQaOk({ photos: 1 });
  gen(id);
  const sign = h.state.docShim.last.cellTexts(1)[1];
  assert.ok(sign[2].includes('氏名 ______________ 日付 ______________') && sign[2].includes('署名・押印'));
});
