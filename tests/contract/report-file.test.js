// C-REPF-01(版1.20.0。SPEC §6.12): 元請提出用PDFの中身を getReportFile で受け取る(ドライブのURLを開かない)
//   mock / harness の両方で実行する。
'use strict';
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const h = require('../helpers/client');

const C1 = 'r_seedc10000000000'; // s_c(鈴木が主担当)。approved(旧 qa_ok)

describe('C-REPF getReportFile(§6.12)', () => {
  beforeEach(() => h.reset());

  it('C-REPF-01: 中身・バイト数・sha256 が一致し、過去の版も取れる。権限は listReports と同じ。無い id は NOT_FOUND、形の違う id は VALIDATION_FAILED', async () => {
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
    assert.match(f2.fileName, /^A現場\(仮\) 1F RF1_打設前_v2_\d{8}-\d{4}\.pdf$/, f2.fileName);

    // ② 作り直したあとも過去の版(v1)を取れる。責任者も取れる
    const f1 = await lead.ok('getReportFile', { reportId: v1.reportId });
    assert.equal(f1.version, 1);
    assert.equal(f1.sha256, v1.sha256);
    assert.match(f1.fileName, /_v1_/);

    // ③ 権限: 職長は FORBIDDEN_ROLE、担当外の管理者は FORBIDDEN_SITE
    assert.equal((await t.call('getReportFile', { reportId: v2.reportId })).error.code, 'FORBIDDEN_ROLE');
    const c1 = (await suzuki.ok('generateReport', { recordId: C1 })).report;
    assert.equal((await sato.call('getReportFile', { reportId: c1.reportId })).error.code, 'FORBIDDEN_SITE');
    assert.equal((await suzuki.ok('getReportFile', { reportId: c1.reportId })).version, 1);

    // ④ 無い id は NOT_FOUND、形の違う id は VALIDATION_FAILED
    assert.equal((await sato.call('getReportFile', { reportId: 'f_nosuchreport0' })).error.code, 'NOT_FOUND');
    assert.equal((await sato.call('getReportFile', { reportId: 'r_seeda10000000000' })).error.code, 'VALIDATION_FAILED');
    assert.equal((await sato.call('getReportFile', {})).error.code, 'VALIDATION_FAILED');
  });
});
