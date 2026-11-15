// C-REPF-01(版1.20.0。SPEC §6.12): 元請提出用PDFの中身を getReportFile で受け取る(ドライブのURLを開かない)
//   mock / harness の両方で実行する。
'use strict';
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const h = require('../helpers/client');

const C1 = 'r_seedc10000000000'; // s_c(鈴木が主担当)。approved(旧 qa_ok)

/** 版1.20.5: PDFの最後の trailer の /Info が指す辞書の Title(UTF-16BE の16進)を読む */
function pdfTitle(buf) {
  const s = buf.toString('latin1');
  const info = /\/Info\s+(\d+)\s+0\s+R/.exec(s.slice(s.lastIndexOf('trailer')));
  if (!info) return null;
  const m = new RegExp('(?:^|\\s)' + info[1] + ' 0 obj\\s*<<\\s*/Title <FEFF([0-9A-F]*)>').exec(s);
  if (!m) return null;
  let t = '';
  for (let i = 0; i < m[1].length; i += 4) t += String.fromCharCode(parseInt(m[1].slice(i, i + 4), 16));
  return t;
}

describe('C-REPF getReportFile(§6.12)', () => {
  beforeEach(() => h.reset());

  it('C-REPF-01: 中身・バイト数・sha256 が一致し、過去の版も取れる。名前は {件名} {ステータス} {日付}[(n)](版1.20.1)。権限は listReports と同じ。無い id は NOT_FOUND、形の違う id は VALIDATION_FAILED', async () => {
    const t = await h.login('u_tanaka');
    const sato = await h.login('u_sato');
    const suzuki = await h.login('u_suzuki');
    const lead = await h.login('u_lead');
    const { recordId } = await h.makeQaOk(t, sato, { lot: 'RF1' });
    const v1 = (await sato.ok('generateReport', { recordId })).report;
    const v2 = (await sato.ok('generateReport', { recordId })).report;
    assert.equal(v2.version, 2);

    // ① 最新の版
    const f2 = await sato.ok('getReportFile', { reportId: v2.reportId });
    assert.deepEqual(Object.keys(f2).sort(), ['base64', 'bytes', 'fileName', 'mime', 'recordId', 'reportId', 'sha256', 'version']);
    const buf2 = Buffer.from(f2.base64, 'base64');
    assert.equal(buf2.subarray(0, 5).toString('latin1'), '%PDF-');
    assert.equal(f2.bytes, buf2.length);
    assert.equal(f2.sha256, crypto.createHash('sha256').update(buf2).digest('hex'));
    assert.equal(f2.sha256, v2.sha256, 'Reports の sha256 と同じ');
    assert.equal(f2.mime, 'application/pdf');
    assert.equal(f2.reportId, v2.reportId); assert.equal(f2.recordId, recordId); assert.equal(f2.version, 2);
    // ⑤(版1.20.1。§6.12-8)名前は {件名} {ステータス} {YYYY-MM-DD}[(n)].pdf。同じ日の2つ目は (2)
    const day = String(v2.generatedAt).slice(0, 10);
    assert.match(day, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(f2.fileName, `A現場(仮) 1F RF1 打設可 ${day}(2).pdf`);
    // ⑥(版1.20.5。§6.12-14)PDFの中の Title は fileName(.pdf なし)。ドライブのファイル名も fileName
    assert.equal(pdfTitle(buf2), f2.fileName.replace(/\.pdf$/, ''), 'PDFの Title');
    assert.equal(decodeURIComponent((await h.reportUrl(v2.reportId)).split('/').pop()), f2.fileName, 'ドライブの名前');

    // ② 作り直したあとも過去の版(v1)を取れる。責任者も取れる
    const f1 = await lead.ok('getReportFile', { reportId: v1.reportId });
    assert.equal(f1.version, 1);
    assert.equal(f1.sha256, v1.sha256);
    assert.equal(f1.fileName, `A現場(仮) 1F RF1 打設可 ${String(v1.generatedAt).slice(0, 10)}.pdf`, 'その日の1つ目は (n) なし');

    // ③ 権限: 職長は FORBIDDEN_ROLE、担当外の管理者は FORBIDDEN_SITE
    assert.equal((await t.call('getReportFile', { reportId: v2.reportId })).error.code, 'FORBIDDEN_ROLE');
    const c1 = (await suzuki.ok('generateReport', { recordId: C1 })).report;
    assert.equal((await sato.call('getReportFile', { reportId: c1.reportId })).error.code, 'FORBIDDEN_SITE');
    const fc = await suzuki.ok('getReportFile', { reportId: c1.reportId });
    assert.equal(fc.version, 1);
    assert.equal(fc.fileName, `C現場(仮) 1F 東 L1 打設可 ${String(c1.generatedAt).slice(0, 10)}.pdf`, '工区あり・旧 qa_ok は打設可');

    // 出来形は「出来形確認済」
    const post = await h.createRecordFor(t, { siteId: 's_a', floor: '2F', lot: 'RF2', stage: 'post_demold' });
    await h.advanceToQaOk(t, sato, post.recordId);
    const pr = (await sato.ok('generateReport', { recordId: post.recordId })).report;
    assert.equal((await sato.ok('getReportFile', { reportId: pr.reportId })).fileName, `A現場(仮) 2F RF2 出来形確認済 ${String(pr.generatedAt).slice(0, 10)}.pdf`);

    // ④ 無い id は NOT_FOUND、形の違う id は VALIDATION_FAILED
    assert.equal((await sato.call('getReportFile', { reportId: 'f_nosuchreport0' })).error.code, 'NOT_FOUND');
    assert.equal((await sato.call('getReportFile', { reportId: 'r_seeda10000000000' })).error.code, 'VALIDATION_FAILED');
    assert.equal((await sato.call('getReportFile', {})).error.code, 'VALIDATION_FAILED');
  });
});
