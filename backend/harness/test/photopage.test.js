'use strict';
/**
 * 元請PDFの写真ページ(SPEC 版1.14.0 §10.2b-B・§10.5.5)。
 *   U-REP-PHOTO  reportPhotoOrder_ / reportPhotoFit_ / reportPhotoUseMain_ の純関数(Report.gs を vm で単体評価)
 *   C-REP-10     並び(項目の番号順)・60枚の選び方・本体の画像(読めなければサムネ)・枠の中で最大・3枚ごとの改ページ(HTML・doc)
 * 見た目(A4 で3枚が1ページに収まるか・白紙のページが無いか)は実GASでしか確認できない(SPEC §12.7 REAL-PDF-02)。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { fresh, rid, nowPlus, fillAll } = require('./helpers');

const h = fresh();
const tanaka = h.as('u_tanaka'), sato = h.as('u_sato');
test.beforeEach(() => h.resetAll());

/* ================= U-REP-PHOTO(純関数) ================= */

const unit = (() => {
  const ctx = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', 'Report.gs'), 'utf8'), ctx);
  return ctx;
})();
const J = (x) => JSON.parse(JSON.stringify(x === undefined ? null : x));

const rowsOf = (ids, ng) => ids.map((itemId) => ({ itemId, selfResult: (ng || []).includes(itemId) ? 'ng' : 'ok', qaResult: 'ok' }));
const P = (photoId, itemId, side, takenAt) => ({ photoId, itemId, side, takenAt });

test('U-REP-PHOTO① 並び: 項目の番号順 → self→qa → takenAt → photoId。項目なしは最後', () => {
  const rows = rowsOf(['a', 'b', 'c']);
  const photos = [
    P('p9', '', 'prime', '2026-11-13T09:00:00+09:00'),
    P('p1', 'c', 'self', '2026-11-13T08:00:00+09:00'),
    P('p2', 'a', 'qa', '2026-11-13T07:00:00+09:00'),
    P('p3', 'a', 'self', '2026-11-13T10:00:00+09:00'),
    P('p4', 'a', 'self', '2026-11-13T06:00:00+09:00'),
    P('p6', 'b', 'self', '2026-11-13T06:00:00+09:00'),
    P('p5', 'b', 'self', '2026-11-13T06:00:00+09:00'),
  ];
  const r = J(unit.reportPhotoOrder_(rows, photos, 60));
  assert.deepEqual(r.shown.map((p) => p.photoId), ['p4', 'p3', 'p2', 'p5', 'p6', 'p1', 'p9']);
  assert.equal(r.rest, 0);
  assert.deepEqual(r.seq, { a: 1, b: 2, c: 3 });
});

test('U-REP-PHOTO② NG の項目でも前に出さない(上限内)', () => {
  const rows = rowsOf(['a', 'b', 'c'], ['c']);
  const photos = [P('pc', 'c', 'self', '1'), P('pa', 'a', 'self', '1'), P('pb', 'b', 'self', '1')];
  assert.deepEqual(J(unit.reportPhotoOrder_(rows, photos, 60)).shown.map((p) => p.photoId), ['pa', 'pb', 'pc']);
});

test('U-REP-PHOTO③ 上限を超えるときは NG 項目の写真を先に選び、出すのは番号順', () => {
  const rows = rowsOf(['a', 'b', 'c', 'd'], ['d']);
  const photos = [];
  ['a', 'b', 'c'].forEach((it) => { for (let i = 0; i < 2; i++) photos.push(P('p' + it + i, it, 'self', String(i))); });
  photos.push(P('pd0', 'd', 'self', '0'), P('pd1', 'd', 'qa', '0'));
  const r = J(unit.reportPhotoOrder_(rows, photos, 5));
  assert.deepEqual(r.shown.map((p) => p.photoId), ['pa0', 'pa1', 'pb0', 'pd0', 'pd1']);
  assert.equal(r.rest, 3);
  // 既定の上限は 60
  assert.equal(unit.REPORT_PHOTOS_MAX, 60);
  assert.equal(unit.REPORT_PHOTOS_PER_PAGE, 3);
});

test('U-REP-PHOTO④ 枠の中で最大(縦横比を保つ)。幅・高さが無ければ 4:3', () => {
  const f = (w, hh, bw, bh) => { const r = J(unit.reportPhotoFit_(w, hh, bw, bh)); return [Number(r.w.toFixed(2)), Number(r.h.toFixed(2))]; };
  assert.deepEqual(f(1280, 720, 109, 83), [109, 61.31]);
  assert.deepEqual(f(1280, 960, 109, 83), [109, 81.75]);
  assert.deepEqual(f(720, 1280, 109, 83), [46.69, 83]);
  assert.deepEqual(f(960, 1280, 109, 83), [62.25, 83]);
  assert.deepEqual(f(720, 1280, 109, 79), [44.44, 79]);
  assert.deepEqual(f(0, 0, 109, 79), [105.33, 79]);
  assert.deepEqual(f('', null, 109, 83), [109, 81.75]);
  assert.deepEqual(f(16, 9, 109, 83), [109, 61.31], '小さい画像も枠いっぱいに');
});

test('U-REP-PHOTO⑤ 本体の合計の上限(20,000,000 バイト)。超える分はサムネ', () => {
  assert.equal(unit.REPORT_PHOTO_MAIN_MAX_BYTES, 20000000);
  assert.equal(unit.reportPhotoUseMain_(0, 300000), true);
  assert.equal(unit.reportPhotoUseMain_(19700000, 300000), true, 'ちょうど上限は本体');
  assert.equal(unit.reportPhotoUseMain_(19700001, 300000), false);
  assert.equal(unit.reportPhotoUseMain_(0, 600, 1000), true);
  assert.equal(unit.reportPhotoUseMain_(600, 600, 1000), false);
});

/* ================= C-REP-10(harness) ================= */

/** 幅w・高さh と読める最小の JPEG(harness の DocumentApp 代役が実寸を読む)。tag で中身を区別する */
function jpegSized(w, hh, tag) {
  const b = Buffer.alloc(2 + 2 + 17 + 2 + 4);
  b.writeUInt16BE(0xffd8, 0); b.writeUInt16BE(0xffc0, 2); b.writeUInt16BE(17, 4);
  b[6] = 8; b.writeUInt16BE(hh, 7); b.writeUInt16BE(w, 9); b[11] = 3;
  [[1, 0x22, 0], [2, 0x11, 1], [3, 0x11, 1]].forEach((c, i) => { b[12 + i * 3] = c[0]; b[13 + i * 3] = c[1]; b[14 + i * 3] = c[2]; });
  b.writeUInt16BE(0xffd9, 21);
  b.writeUInt32BE(tag || 0, 23);
  return b;
}

/** qa_ok の記録(ngItem だけ職長NG)。項目番号 N(1始まり)→itemId の対応も返す */
function makeQaOk(ngN) {
  const id = rid('r');
  assert.equal(tanaka('createRecord', { recordId: id, siteId: 's_a', floor: '1F', lot: 'P' + Math.floor(Math.random() * 1e9), stage: 'pre_pour', pourPlannedAt: nowPlus(h, 72 * 60) }).ok, true);
  const items = tanaka('getRecord', { recordId: id }).data.record.items;
  const itemOf = (n) => items[n - 1].itemId;
  const ngId = ngN ? itemOf(ngN) : null;
  fillAll(h, tanaka, id, 'self', {
    patch: (i) => (i.itemId === ngId ? { result: 'ng', severity: 'minor', note: 'NGの備考' } : {}),
    photoFor: (i) => i.itemId === ngId,
  });
  assert.equal(tanaka('submitRecord', { recordId: id, round: 1 }, { pin: '1111' }).ok, true);
  assert.equal(sato('claimReview', { recordId: id, round: 1 }).ok, true);
  fillAll(h, sato, id, 'qa');
  assert.equal(sato('submitVerdict', { recordId: id, round: 1, verdict: 'ok' }, { pin: '3333' }).ok, true);
  return { id, itemOf };
}

/**
 * 検査写真を specs で作り直す(Photos 行を直接操作)。spec: { n:項目番号|null(prime), side, at:分, tag, w, h, main:[w,h], thumb:[w,h], noMain }
 * stampText は 'S{tag}'(並びの確認に使う)。本体とサムネは tag で中身が違う JPEG。
 */
function setPhotos(rec, specs) {
  const { Repo, Util, DriveApp, Utilities } = h.ctx;
  Repo.resetCache();
  const rows = Repo.where('Photos', 'recordId', rec.id).filter((p) => !p.deleted && p.kind !== 'drawing');
  const src = rows.find((p) => p.itemId);
  rows.forEach((p) => Repo.update('Photos', p, { deleted: true, deletedBy: 'system', deletedAt: Util.nowIso() }));
  const root = DriveApp.getFolderById(Repo.get('Config', 'driveRootFolderId').value);
  const files = {};
  specs.forEach((s) => {
    const copy = {};
    Object.keys(src).forEach((k) => { copy[k] = src[k]; });
    copy.photoId = Util.newId('p'); copy.deleted = false; copy.deletedBy = ''; copy.deletedAt = '';
    copy.itemId = s.n ? rec.itemOf(s.n) : '';
    copy.side = s.n ? s.side : 'prime';
    copy.takenAt = nowPlus(h, s.at || 0);
    copy.stampText = 'S' + s.tag;
    const main = s.main || [1600, 1200], thumb = s.thumb || [160, 90];
    const mainBuf = jpegSized(main[0], main[1], s.tag * 2 + 1), thumbBuf = jpegSized(thumb[0], thumb[1], s.tag * 2 + 2);
    copy.driveFileId = s.noMain ? 'f_missing_' + s.tag : root.createFile(Utilities.newBlob(mainBuf, 'image/jpeg', 'm' + s.tag + '.jpg')).getId();
    copy.thumbFileId = root.createFile(Utilities.newBlob(thumbBuf, 'image/jpeg', 't' + s.tag + '.jpg')).getId();
    copy.width = s.w === undefined ? main[0] : s.w; copy.height = s.h === undefined ? main[1] : s.h;
    files[s.tag] = { main: mainBuf.toString('base64'), thumb: thumbBuf.toString('base64') };
    Repo.append('Photos', copy);
  });
  h.ctx.clearRefCache(); Repo.resetCache();
  return files;
}

const setEngine = (v) => { h.control('patch', { sheet: 'Config', key: 'reportEngine', set: { value: v } }); h.ctx.clearRefCache(); };
const gen = (id) => { const g = sato('generateReport', { recordId: id }); assert.equal(g.ok, true, JSON.stringify(g)); return g; };
const htmlBlocks = (html) => html.match(/<table class="pb"[\s\S]*?<\/table>/g) || [];
const tagOf = (blockText) => Number(/S(\d+)/.exec(blockText.replace(/<[^>]+>/g, ''))[1]);

test('C-REP-10①③④⑤⑥ HTML方式: 番号順・本体の画像(読めなければサムネ)・枠 109×79mm に最大・3枚ごとの改ページ・実測の行なし', () => {
  const rec = makeQaOk(2);
  const files = setPhotos(rec, [
    { n: 5, side: 'self', at: -1, tag: 1 },            // 新しい方を先に登録
    { n: 5, side: 'self', at: -9, tag: 2 },
    { n: null, at: -20, tag: 3 },
    { n: 2, side: 'qa', at: -30, tag: 4, main: [720, 1280] },   // 縦長 9:16
    { n: 2, side: 'self', at: -5, tag: 5, main: [1280, 720] },  // 横長 16:9
    { n: 9, side: 'self', at: -50, tag: 6, noMain: true },      // 本体が読めない → サムネ
    { n: 9, side: 'self', at: -40, tag: 7, w: 0, h: 0 },        // 幅・高さ無し → 4:3 扱い
  ]);
  setEngine('html');
  gen(rec.id);
  const html = h.state.lastHtml;
  const blocks = htmlBlocks(html);
  // ① 並び: N=2 職長(5)→ N=2 管理者(4)→ N=5 職長(2→1)→ N=9 職長(6→7)→ prime(3)
  assert.deepEqual(blocks.map(tagOf), [5, 4, 2, 1, 6, 7, 3]);
  // ③ 本体の画像。読めないものだけサムネ
  const imgOf = (b) => (/src="data:image\/jpeg;base64,([^"]+)"/.exec(b) || [])[1];
  blocks.forEach((b) => {
    const t = tagOf(b);
    assert.equal(imgOf(b), t === 6 ? files[t].thumb : files[t].main, '写真' + t + 'の画像');
  });
  // ④ 枠 109×79mm に最大。width と height の両方を mm で
  const sizeOf = (b) => /<img style="width:([\d.]+)mm;height:([\d.]+)mm"/.exec(b).slice(1).join('x');
  const byTag = {}; blocks.forEach((b) => { byTag[tagOf(b)] = sizeOf(b); });
  assert.equal(byTag[5], '109.00x61.31');
  assert.equal(byTag[4], '44.44x79.00');
  assert.equal(byTag[1], '105.33x79.00', '4:3 横長');
  assert.equal(byTag[7], '105.33x79.00', '幅・高さ無しは 4:3');
  assert.ok(!/object-fit/.test(html));
  // ⑤ 3枚ごとに page-break-after(最後のブロックには無い)
  const brk = blocks.map((b) => /^<table class="pb" style="page-break-after:always"/.test(b));
  assert.deepEqual(brk, [false, false, true, false, false, true, false]);
  // ⑥ 情報欄: 実測の行なし。prime は 撮影: とスタンプだけ
  blocks.forEach((b) => assert.ok(!b.includes('実測(')));
  const prime = blocks.find((b) => tagOf(b) === 3).replace(/<[^>]+>/g, '');
  assert.ok(prime.includes('撮影: 元請サイン証跡') && !prime.includes('No.') && !prime.includes('コメント'), prime);
  // 図面は写真ブロックに入らない(この記録は図面なし)・「他N枚」は出ない
  assert.ok(!html.includes('枚は電子記録で閲覧可'));
});

test('C-REP-10① NG を前に出さない: N=9 が NG でも N=2 → N=5 → N=9 → prime', () => {
  const rec = makeQaOk(9);
  setPhotos(rec, [{ n: 9, side: 'self', tag: 1 }, { n: null, tag: 2 }, { n: 5, side: 'self', tag: 3 }, { n: 2, side: 'self', tag: 4 }]);
  setEngine('html');
  gen(rec.id);
  assert.deepEqual(htmlBlocks(h.state.lastHtml).map(tagOf), [4, 3, 1, 2]);
});

test('C-REP-10② 61枚: NG の項目の写真が全て入り、番号順のまま最後に出る。他1枚の注記', () => {
  const rec = makeQaOk(20);
  const specs = [];
  let tag = 1;
  for (let n = 1; n <= 13; n++) for (let k = 0; k < (n <= 6 ? 5 : 4); k++) specs.push({ n, side: k % 2 ? 'qa' : 'self', at: -k, tag: tag++ });
  specs.length = 58;
  for (let k = 0; k < 3; k++) specs.push({ n: 20, side: 'self', at: -k, tag: 100 + k });
  setPhotos(rec, specs);
  setEngine('html');
  gen(rec.id);
  const html = h.state.lastHtml;
  const tags = htmlBlocks(html).map(tagOf);
  assert.equal(tags.length, 60);
  assert.deepEqual(tags.slice(-3), [102, 101, 100], 'N=20 の3枚が最後(takenAt の古い順)');
  assert.ok(html.includes('<p>他1枚は電子記録で閲覧可</p>'));
});

test('C-REP-10 doc方式: 番号順・本体の画像・枠の中で最大・3枚ごとの改ページ・実測の行なし', () => {
  const rec = makeQaOk(2);
  setPhotos(rec, [
    { n: 5, side: 'self', at: -1, tag: 1, w: 0, h: 0, main: [1600, 1200], thumb: [160, 90] },
    { n: 2, side: 'qa', at: -30, tag: 2, w: 0, h: 0, main: [720, 1280], thumb: [160, 90] },
    { n: 9, side: 'self', at: -50, tag: 3, w: 0, h: 0, noMain: true, main: [1600, 1200], thumb: [160, 90] },
    { n: null, at: -20, tag: 4, w: 0, h: 0, main: [1280, 720], thumb: [90, 160] },
  ]);
  setEngine('doc');
  gen(rec.id);
  const d = h.control('docShim', {}).data.lastDoc;
  const blocks = d.tables.filter((t) => t.cols === 2);
  assert.deepEqual(blocks.map((t) => Number(/S(\d+)/.exec(t.cellTexts[0][1])[1])), [2, 1, 3, 4], '番号順');
  // Photos.width/height が 0 なので比率は挿入した画像の実寸=本体なら本体の比率、読めなければサムネの比率
  const imgs = d.images.filter((im) => im.inTableIndex >= 0 && d.tables[im.inTableIndex].cols === 2);
  const want = [720 / 1280, 1600 / 1200, 160 / 90, 1280 / 720];   // 本体(9:16・4:3)/ サムネ(16:9)/ 本体(16:9)
  imgs.forEach((im, i) => assert.ok(Math.abs(im.w / im.h - want[i]) / want[i] <= 0.01, `比率 ${i}: ${im.w / im.h} vs ${want[i]}`));
  const BW = 305.62, BH = 235.28;
  imgs.forEach((im) => {
    assert.ok(im.w <= BW + 0.5 && im.h <= BH + 0.5, `枠内 ${im.w}x${im.h}`);
    assert.ok(Math.abs(im.w - BW) <= 0.5 || Math.abs(im.h - BH) <= 0.5, `枠の中で最大 ${im.w}x${im.h}`);
  });
  assert.equal(d.pageBreaks, 1 + 1, '写真見出し前1 + 3枚目の後1(最後の後は無し)');
  blocks.forEach((t) => assert.ok(!t.cellTexts[0][1].includes('実測(')));
});

test('C-REP-10⑦ 管理者・責任者の記録は結果の行が 1次検査 / 承認', () => {
  const rec = makeQaOk(2);
  setPhotos(rec, [{ n: 2, side: 'self', tag: 1 }]);
  const { Repo } = h.ctx;
  Repo.resetCache();
  Repo.update('Records', Repo.get('Records', rec.id), { ownerRole: 'qa' });
  h.ctx.clearRefCache(); Repo.resetCache();
  setEngine('html');
  const g = h.as('u_lead')('generateReport', { recordId: rec.id });   // 管理者の記録の PDF は責任者が作る(§6.9)
  assert.equal(g.ok, true, JSON.stringify(g));
  const t = htmlBlocks(h.state.lastHtml)[0].replace(/<[^>]+>/g, '');
  assert.ok(/1次検査: NG\(軽微\) \/ 承認: 合/.test(t), t);
});
