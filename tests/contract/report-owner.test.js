// C-REP-09: 1次検査者が管理者・責任者の記録の PDF の欄名(SPEC §10.2e。版1.12.0)
//   HTML方式は `/__mock/lastReportHtml`、doc 方式は `/__mock/docShim` の lastDoc を見る(harness-only。mock・実GASではスキップ)
'use strict';
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const m = require('../helpers/report-measure');
const h = m.h;

const NEW_LABELS = ['1次検査結果', '承認結果', '1次検査コメント', '承認者コメント', '1次検査(管理者)', '承認(責任者)'];
const OLD_LABELS = ['職長結果', '管理者結果', '職長コメント', '管理者コメント', '品質管理者'];

/** 佐藤(管理者)が1次検査 → 責任者が承認(qa_ok)の記録 */
async function qaOwnedQaOk() {
  const sato = await h.login('u_sato');
  const lead = await h.login('u_lead');
  const c = await h.createRecordFor(sato, { siteId: 's_a', floor: '1F', lot: 'OWN' + h.rand(4).toUpperCase() });
  assert.equal(c.res.ok, true, JSON.stringify(c.res.error));
  await h.fillSelf(sato, c.recordId);
  await sato.ok('submitRecord', { recordId: c.recordId, round: 1 }, { pin: sato.pin });
  await lead.ok('claimReview', { recordId: c.recordId, round: 1 });
  await h.fillQa(lead, c.recordId);
  await lead.ok('submitVerdict', { recordId: c.recordId, round: 1, verdict: 'ok' }, { pin: lead.pin });
  return { recordId: c.recordId, lead };
}
const docText = (d) => [
  ...(d.paragraphs || []).map((p) => p.text),
  ...(d.tables || []).flatMap((t) => (t.rows || t.cells || []).flat(2).map((x) => (typeof x === 'string' ? x : (x && x.text) || ''))),
].join('\n');

describe('C-REP-09 PDF の欄名(1次検査者が管理者・責任者の記録。版1.12.0)', () => {
  before(() => h.reset());

  m.harnessHtml(it, 'HTML方式: 管理者の1次検査の記録は「1次検査/承認」の欄名。職長の記録は従来の欄名のまま', async () => {
    await m.setEngine('html');
    const { recordId, lead } = await qaOwnedQaOk();
    await lead.ok('generateReport', { recordId });
    const html = await m.lastHtml();
    for (const w of NEW_LABELS) assert.ok(html.includes(w), `出る: ${w}`);
    for (const w of OLD_LABELS) assert.ok(!html.includes('>' + w + '<'), `見出しに出ない: ${w}`);
    assert.ok(html.includes('1次検査者の会社名') || !html.includes('職長の会社名'), '基本情報の会社名の欄');
    // 職長の記録は従来どおり
    const t = await h.login('u_tanaka');
    const sato = await h.login('u_sato');
    const { recordId: fr } = await h.makeQaOk(t, sato);
    await sato.ok('generateReport', { recordId: fr });
    const html2 = await m.lastHtml();
    for (const w of ['職長結果', '管理者結果', '職長コメント', '管理者コメント', '品質管理者']) assert.ok(html2.includes(w), `職長の記録には従来の ${w}`);
    for (const w of NEW_LABELS) assert.ok(!html2.includes(w), `職長の記録に出ない: ${w}`);
  });

  m.harnessDoc(it, 'doc 方式: 同じ欄名になる', async () => {
    await m.setEngine('doc');
    const { recordId, lead } = await qaOwnedQaOk();
    await m.docShim({ reset: true });
    await lead.ok('generateReport', { recordId });
    const d = (await m.docShim({})).lastDoc;
    assert.ok(d, 'lastDoc');
    const all = JSON.stringify(d);
    for (const w of NEW_LABELS) assert.ok(all.includes(w), `出る: ${w}`);
    for (const w of ['職長結果', '管理者結果', '品質管理者']) assert.ok(!all.includes(w), `出ない: ${w}`);
    await m.setEngine('html');
  });
});
