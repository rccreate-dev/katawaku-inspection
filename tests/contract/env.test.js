// C-ENV-01〜03: 封筒・共通
'use strict';
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers/client');

const KNOWN_CODES = ['BAD_REQUEST', 'CLIENT_OUTDATED', 'UNAUTHENTICATED', 'DEVICE_REVOKED', 'USER_LOCKED', 'USER_DISABLED', 'PIN_REQUIRED', 'PIN_INVALID', 'INVITE_REQUIRED', 'INVITE_INVALID', 'INVITE_EXPIRED', 'FORBIDDEN_ROLE', 'FORBIDDEN_SITE', 'FORBIDDEN_TEAM', 'NOT_FOUND', 'VALIDATION_FAILED', 'STATE_CONFLICT', 'RECORD_LOCKED', 'ALREADY_EXISTS', 'ALREADY_CLAIMED', 'NOT_CLAIMER', 'NOT_CLAIMED', 'TAKEOVER_NOT_ALLOWED', 'STAGE_NOT_ENABLED', 'SITE_CLOSED', 'PHOTO_INVALID', 'PHOTO_LIMIT', 'PHOTO_TOO_LARGE', 'CHUNK_MISSING', 'JOIN_KEY_INVALID', 'ALREADY_MEMBER', 'JOIN_PENDING', 'REPORT_NOT_ALLOWED', 'IDEMPOTENCY_CONFLICT', 'LOCK_TIMEOUT', 'DRIVE_ERROR', 'INTERNAL'];

describe('C-ENV 封筒・共通', () => {
  beforeEach(() => h.reset());

  it('C-ENV-01: 未知action・v不一致・不正JSON・未知のparamsキー・clientId欠落 → BAD_REQUEST', async () => {
    const t = await h.login('u_tanaka');
    let r = await h.call('noSuchAction', {}, { token: t.token });
    assert.equal(r.error.code, 'BAD_REQUEST');
    r = await h.post({ v: 2, action: 'ping', appVersion: '1.0.0', params: {} });
    assert.equal(r.json.error.code, 'BAD_REQUEST');
    r = await h.post('{not json', { rawBody: true });
    assert.equal(r.json.error.code, 'BAD_REQUEST');
    r = await h.call('listRecords', { role: 'lead' }, { token: t.token });
    assert.equal(r.error.code, 'BAD_REQUEST', 'params の未知キー(role)は拒否');
    r = await h.call('me', { userId: 'u_lead' }, { token: t.token });
    assert.equal(r.error.code, 'BAD_REQUEST', 'userId を送って偽装できない');
    r = await h.call('createRecord', { recordId: h.newRecordId(), siteId: 's_a', floor: '1F', lot: 'X1', stage: 'pre_pour' }, { token: t.token, noClientId: true });
    assert.equal(r.error.code, 'BAD_REQUEST', '★で clientId 欠落');
  });

  it('C-ENV-02: 全応答に ok/meta、失敗は既知コード、常にHTTP 200', async () => {
    const t = await h.login('u_tanaka');
    const rs = [
      await h.call('listLoginUsers'),
      await h.call('me', {}, { token: t.token }),
      await h.call('getBootstrap', {}, { token: t.token }),
      await h.call('getRecord', { recordId: 'r_seedc10000000000' }, { token: t.token }),
      await h.call('me', {}, { token: 'bad.token' }),
      await h.call('claimReview', { recordId: 'r_seeda20000000000', round: 1 }, { token: t.token }),
    ];
    for (const r of rs) {
      assert.equal(typeof r.ok, 'boolean');
      assert.equal(r._http, 200);
      assert.equal(typeof r.meta.serverTime, 'string');
      assert.match(r.meta.serverTime, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/);
      assert.equal(r.meta.apiVersion, 1);
      assert.equal(typeof r.meta.replayed, 'boolean');
      if (!r.ok) assert.ok(KNOWN_CODES.includes(r.error.code), `未知のコード ${r.error.code}`);
      else assert.ok('data' in r);
    }
  });

  h.mockOnly(it, 'C-ENV-02(mock-only): OPTIONS は 405 でCORSヘッダなし', async () => {
    const r = await fetch(h.API_URL, { method: 'OPTIONS', headers: { Origin: 'http://localhost:8080', 'Access-Control-Request-Method': 'POST' } });
    assert.equal(r.status, 405);
    assert.equal(r.headers.get('access-control-allow-origin'), null);
    const p = await h.post({ v: 1, action: 'ping', appVersion: '1.0.0', params: {} });
    assert.equal(p.headers.get('access-control-allow-origin'), '*');
    assert.match(p.headers.get('content-type'), /application\/json/);
  });

  it('C-ENV-03: ping は GET/POST 両方で成功。古い appVersion は CLIENT_OUTDATED(ping/me を除く)', async () => {
    const g = await (await fetch(h.API_URL + '?action=ping', { redirect: 'follow' })).json();
    assert.equal(g.ok, true);
    assert.equal(g.data.apiVersion, 1);
    assert.equal(typeof g.data.schemaVersion, 'string');
    const p = await h.call('ping');
    assert.equal(p.ok, true);
    assert.equal(p.data.apiVersion, 1);
    const g2 = await (await fetch(h.API_URL + '?action=listLoginUsers', { redirect: 'follow' })).json();
    assert.equal(g2.error.code, 'BAD_REQUEST', 'ping以外のGETは BAD_REQUEST');

    const t = await h.login('u_tanaka');
    const old = await h.call('listLoginUsers', {}, { appVersion: '0.0.1' });
    assert.equal(old.error.code, 'CLIENT_OUTDATED');
    assert.equal(typeof old.error.data.minClientVersion, 'string');
    const o2 = await h.call('getBootstrap', {}, { token: t.token, appVersion: '0.0.1' });
    assert.equal(o2.error.code, 'CLIENT_OUTDATED');
    assert.equal((await h.call('ping', {}, { appVersion: '0.0.1' })).ok, true);
    assert.equal((await h.call('me', {}, { token: t.token, appVersion: '0.0.1' })).ok, true);
  });
});
