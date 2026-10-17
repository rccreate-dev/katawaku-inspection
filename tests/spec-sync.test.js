// SPEC同期(SPEC §12.1)の版1.10 の部分: SPEC.md の記述から値を拾い、実装(mock・backend・frontend/i18n.js)と一致することを検査する。
//   U-CLASS-01 : §8.11.2 の操作の分類が §5.5 の43 action を1回ずつ含み、A(先出し)が6つだけ
//   §2.14      : Config キー(keepWarmMinutes を含む)が mock と backend の既定値と一致。keepWarmMinutes は公開Configに出ない
//   §2.14(1.10.1): reportEngine(既定 html・str・サーバー専用)が SPEC / mock / backend で一致。C-REP-06① appsscript.json に documents スコープ
//   §9.4       : 版1.10 の新 i18n キーが ja/id の両方にあり、プレースホルダが SPEC の表と一致
// SPEC.md・backend/・frontend/・mock/ は読むだけ(編集しない)。実行: node --test spec-sync.test.js
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.join(__dirname, '..');
const spec = fs.readFileSync(path.join(ROOT, 'SPEC.md'), 'utf8').split('\n');

/** 見出し行(startRe)の次の行から、endRe に一致する行の手前まで */
function section(startRe, endRe) {
  const a = spec.findIndex((l) => startRe.test(l));
  assert.ok(a >= 0, `SPEC に節が無い: ${startRe}`);
  let b = spec.length;
  for (let i = a + 1; i < spec.length; i++) if (endRe.test(spec[i])) { b = i; break; }
  return spec.slice(a + 1, b);
}
const cells = (line) => line.replace(/^\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
const ticks = (s) => [...s.matchAll(/`([^`]+)`/g)].map((m) => m[1]);

// §5.5 の action 名(43個)
const ACTIONS_55 = (() => {
  const lines = section(/^### 5\.5 /, /^\*\*★/).filter((l) => /^(公開|セッション|記録|写真|PDF|参加|名簿|管理):/.test(l));
  return lines.flatMap(ticks);
})();

/** backend/*.gs を1つの vm コンテキストで評価する(GAS のグローバルは関数の中でしか使われない前提) */
function loadBackend() {
  const dir = path.join(ROOT, 'backend');
  const ctx = vm.createContext({ console });
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.gs')).sort()) vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f });
  return ctx;
}

describe('U-CLASS-01 操作の分類(SPEC §8.11.2)', () => {
  const block = section(/^#### 8\.11\.2 /, /^#### /);
  const rows = block.filter((l) => /^\|\s*[ABC]\s/.test(l)).map((l) => { const c = cells(l); return { cls: c[0][0], name: c[0], actions: ticks(c[1]) }; });

  it('§5.5 は43 action(重複なし)', () => {
    assert.equal(ACTIONS_55.length, 43);
    assert.equal(new Set(ACTIONS_55).size, 43);
  });
  it('分類表の action 名の集合が §5.5 の43 action と完全に一致し、同じ名前が2回出ない', () => {
    assert.ok(rows.length >= 6, '分類表の行を読み取れた: ' + rows.length);
    const all = rows.flatMap((r) => r.actions);
    const dup = all.filter((a, i) => all.indexOf(a) !== i);
    assert.deepEqual(dup, [], '2回出る action: ' + dup.join(','));
    assert.deepEqual([...all].sort(), [...ACTIONS_55].sort());
    assert.equal(all.length, 43);
  });
  it('A(先出し)は saveDraft saveQaDraft addNote uploadPhotoChunk deletePhoto setLang の6つだけ', () => {
    const a = rows.filter((r) => r.cls === 'A').flatMap((r) => r.actions);
    assert.deepEqual([...a].sort(), ['addNote', 'deletePhoto', 'saveDraft', 'saveQaDraft', 'setLang', 'uploadPhotoChunk']);
    assert.equal(a.length, 6);
  });
  it('分類は A/B/C のいずれか。PIN必須 action(§5.5)・先着/状態の action は A に入らない', () => {
    assert.ok(rows.every((r) => ['A', 'B', 'C'].includes(r.cls)));
    const a = new Set(rows.filter((r) => r.cls === 'A').flatMap((r) => r.actions));
    for (const x of ['submitRecord', 'submitVerdict', 'recordPrimeSign', 'changePin', 'claimReview', 'releaseClaim', 'takeoverReview', 'stopPour', 'createRecord', 'lookupInvite', 'registerDevice', 'requestJoin', 'decideJoin', 'revokeMembership']) assert.ok(!a.has(x), `${x} は先出しにしない`);
  });
  it('C(参照)は書き込みでない12個', () => {
    const c = rows.filter((r) => r.cls === 'C').flatMap((r) => r.actions);
    assert.equal(c.length, 12);
  });
  it('backend の ACTIONS が §5.5 の43 action と一致する(keepWarm 系を含まない)', () => {
    const ctx = loadBackend();
    const keys = Object.keys(ctx.ACTIONS);
    assert.deepEqual([...keys].sort(), [...ACTIONS_55].sort());
    for (const n of ['installKeepWarmTrigger', 'removeKeepWarmTrigger', 'keepWarm']) assert.ok(!keys.includes(n), n);
  });
});

describe('§2.14 Config と keepWarmMinutes', () => {
  const specKeys = (() => {
    const lines = section(/^### 2\.14 /, /^### 2\.15 /).filter((l) => /^\|\s*[A-Za-z][A-Za-z0-9]*\s*\|/.test(l));
    return lines.map((l) => cells(l)).filter((c) => c[0] !== 'key').map((c) => ({ key: c[0], def: (ticks(c[1])[0] || c[1]) }));
  })();
  const mockSeed = require(path.join(ROOT, 'mock', 'seed.js'));

  it('SPEC §2.14 に keepWarmMinutes(既定5)がある', () => {
    const k = specKeys.find((x) => x.key === 'keepWarmMinutes');
    assert.ok(k, 'keepWarmMinutes');
    assert.equal(k.def, '5');
    assert.ok(specKeys.length >= 28, 'Config キーを読み取れた: ' + specKeys.length);
  });
  it('mock の Config 初期値が SPEC §2.14 のキーと一致し、keepWarmMinutes=5(int)・公開Configに含めない', () => {
    assert.deepEqual(mockSeed.CONFIG_ROWS.map((r) => r.key).sort(), specKeys.map((x) => x.key).sort());
    const row = mockSeed.CONFIG_ROWS.find((r) => r.key === 'keepWarmMinutes');
    assert.ok(row); assert.equal(row.value, '5'); assert.equal(row.type, 'int');
    assert.ok(!mockSeed.PUBLIC_CONFIG_KEYS.includes('keepWarmMinutes'));
    // 公開Configに出るキーは Config 行に実在する
    for (const k of mockSeed.PUBLIC_CONFIG_KEYS) assert.ok(mockSeed.CONFIG_ROWS.some((r) => r.key === k), k);
  });
  it('backend の DEFAULT_CONFIG が SPEC §2.14 のキーと一致し、keepWarmMinutes=5(int)', () => {
    const ctx = loadBackend();
    const keys = ctx.DEFAULT_CONFIG.map((c) => c.key);
    assert.deepEqual([...keys].sort(), specKeys.map((x) => x.key).sort());
    const row = ctx.DEFAULT_CONFIG.find((c) => c.key === 'keepWarmMinutes');
    assert.ok(row); assert.equal(String(row.value), '5'); assert.equal(row.type, 'int');
  });
});

describe('§2.14 Config reportEngine(版1.10.1。C-REP-06③)', () => {
  const row = (() => {
    const l = section(/^### 2\.14 /, /^### 2\.15 /).find((x) => /^\|\s*reportEngine\s*\|/.test(x));
    return l ? cells(l) : null;
  })();
  const mockSeed = require(path.join(ROOT, 'mock', 'seed.js'));

  it('SPEC §2.14 に reportEngine(既定 html・str・サーバー専用)がある', () => {
    assert.ok(row, 'reportEngine の行');
    assert.equal(ticks(row[1])[0], 'html');
    assert.match(row[2], /`str`/);
    assert.match(row[2], /bootstrap\.config.*含めない/);
    assert.match(row[2], /`doc`/);
  });
  it('mock の Config 初期値が reportEngine=html(str)で、公開Config(bootstrap.config)に含めない', () => {
    const r = mockSeed.CONFIG_ROWS.find((x) => x.key === 'reportEngine');
    assert.ok(r, 'mock/seed.js CONFIG_ROWS に reportEngine');
    assert.equal(r.value, 'html'); assert.equal(r.type, 'str');
    assert.ok(!mockSeed.PUBLIC_CONFIG_KEYS.includes('reportEngine'));
  });
  it('backend の DEFAULT_CONFIG が reportEngine=html(str)(バックエンド未完なら「バックエンド未完のため失敗」)', () => {
    const ctx = loadBackend();
    const r = ctx.DEFAULT_CONFIG.find((c) => c.key === 'reportEngine');
    assert.ok(r, 'バックエンド未完のため失敗: backend の DEFAULT_CONFIG に reportEngine が無い');
    assert.equal(String(r.value), 'html'); assert.equal(r.type, 'str');
  });
  it('backend の公開Config(bootstrap.config)のキーに reportEngine が入らない(ソース検査)', () => {
    const src = fs.readdirSync(path.join(ROOT, 'backend')).filter((f) => f.endsWith('.gs')).map((f) => fs.readFileSync(path.join(ROOT, 'backend', f), 'utf8')).join('\n');
    const m = /PUBLIC_CONFIG_KEYS\s*=\s*\[([^\]]*)\]/.exec(src);
    if (m) assert.ok(!/reportEngine/.test(m[1]), 'PUBLIC_CONFIG_KEYS に reportEngine を入れない');
  });
});

describe('C-REP-06① appsscript.json の oauthScopes', () => {
  it('documents スコープがあり、既存の4つ(spreadsheets / drive / script.scriptapp / script.send_mail)も残っている', () => {
    const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'backend', 'appsscript.json'), 'utf8'));
    const sc = j.oauthScopes || [];
    const has = (x) => sc.includes('https://www.googleapis.com/auth/' + x);
    assert.ok(has('documents'), 'バックエンド未完のため失敗: documents スコープが無い: ' + sc.join(' '));
    for (const x of ['spreadsheets', 'drive', 'script.scriptapp', 'script.send_mail']) assert.ok(has(x), x);
  });
});

describe('§9.4 版1.10 の新 i18n キー', () => {
  const dict = require(path.join(ROOT, 'frontend', 'i18n.js'));
  const newKeys = (() => {
    const a = spec.findIndex((l) => l.includes('版1.10 で足すキー'));
    assert.ok(a >= 0, 'SPEC §9.4 に「版1.10 で足すキー」が無い');
    const out = [];
    for (let i = a + 1; i < spec.length; i++) {
      if (/^\|\s*`/.test(spec[i])) { const c = cells(spec[i]); out.push({ key: ticks(c[0])[0], ja: c[1], id: c[2] }); } else if (out.length && !/^\|/.test(spec[i])) break;
    }
    return out;
  })();
  const ph = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

  it('SPEC の表から新キーを読み取れる(30個)', () => {
    assert.equal(newKeys.length, 30, newKeys.map((k) => k.key).join(','));
    assert.equal(new Set(newKeys.map((k) => k.key)).size, newKeys.length);
    assert.ok(newKeys.every((k) => !k.key.includes('@')));
  });
  it('全ての新キーが ja/id の両方にあり、空でなく、プレースホルダが SPEC の表と一致する', () => {
    for (const { key, ja, id } of newKeys) {
      for (const lang of ['ja', 'id']) {
        assert.ok(typeof dict[lang][key] === 'string' && dict[lang][key].trim() !== '', `${lang}:${key} が無い/空`);
      }
      assert.deepEqual(ph(dict.ja[key]), ph(ja), `ja:${key} のプレースホルダ`);
      assert.deepEqual(ph(dict.id[key]), ph(id), `id:${key} のプレースホルダ`);
      assert.deepEqual(ph(dict.id[key]), ph(dict.ja[key]), `${key}: ja と id でプレースホルダが同じ`);
    }
  });
  it('ja の文言が SPEC の表と一致する(日本語は確定文言)', () => {
    for (const { key, ja } of newKeys) assert.equal(dict.ja[key], ja, `ja:${key}`);
  });
  it('ja/id のキー集合は完全一致のまま', () => {
    assert.deepEqual(Object.keys(dict.ja).sort(), Object.keys(dict.id).sort());
  });
});
