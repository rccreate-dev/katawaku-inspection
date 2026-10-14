// U-SEED-01: SEED_ITEMS の完全一致(SPEC §2.6.1・§2.6.1a。i1〜i69の69行)
//   tests/fixtures/seed-items.json(基準) = backend/Seed.gs の SEED_ITEMS = mock/seed.js の SEED_ITEMS = SPEC.md の表
// backend/・SPEC.md は読むだけ(編集しない)。
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.join(__dirname, '..', '..');
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'seed-items.json'), 'utf8'));
const plain = (x) => JSON.parse(JSON.stringify(x));

describe('U-SEED-01 項目マスタの初期値', () => {
  it('fixture は69行(i1〜i69)・有効36(打設前28+出来形8)', () => {
    assert.equal(fixture.length, 69);
    assert.deepEqual(fixture.map((i) => i.itemId), Array.from({ length: 69 }, (_, i) => `i${i + 1}`));
    assert.equal(fixture.filter((i) => i.active).length, 36);
    assert.equal(fixture.filter((i) => i.active && i.stage === 'pre_pour').length, 28);
    assert.equal(fixture.filter((i) => i.active && i.stage === 'post_demold').length, 8);
    const cols = ['itemId', 'seq', 'stage', 'audience', 'groupKey', 'groupJa', 'groupId', 'textJa', 'textId', 'key', 'tol', 'measure', 'minMeasures', 'unit', 'active', 'note'];
    for (const i of fixture) assert.deepEqual(Object.keys(i), cols, i.itemId);
  });

  it('mock/seed.js の SEED_ITEMS が fixture と完全一致', () => {
    const { SEED_ITEMS } = require(path.join(ROOT, 'mock', 'seed.js'));
    assert.equal(SEED_ITEMS.length, 69);
    assert.deepEqual(plain(SEED_ITEMS), fixture);
  });

  it('backend/Seed.gs の SEED_ITEMS が fixture と完全一致', () => {
    const ctx = vm.createContext({});
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'backend', 'Seed.gs'), 'utf8'), ctx, { filename: 'Seed.gs' });
    assert.equal(ctx.SEED_ITEMS.length, 69);
    assert.deepEqual(plain(ctx.SEED_ITEMS), fixture);
  });

  it('docs/new-items.json(追加案B+版1.9の追加分)の各行が fixture と一致', () => {
    const f = path.join(ROOT, 'docs', 'new-items.json');
    if (!fs.existsSync(f)) return;
    const rows = JSON.parse(fs.readFileSync(f, 'utf8'));
    const ids = rows.map((r) => r.itemId);
    for (let n = 32; n <= 69; n++) assert.ok(ids.includes(`i${n}`), `docs/new-items.json に i${n} がある`);
    for (const r of rows) assert.deepEqual(r, fixture.find((x) => x.itemId === r.itemId), r.itemId);
  });

  describe('SPEC.md の表(§2.6.1・§2.6.1a)と fixture が一致', () => {
    const lines = fs.readFileSync(path.join(ROOT, 'SPEC.md'), 'utf8').split('\n');
    const cells = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

    // グループ名: §2.6.1 の「グループ名: `prep`=準備・墨 / Persiapan…、…」と §2.6.1a のグループ表
    const groups = {};
    const gl = lines.find((l) => l.startsWith('共通: `stage=pre_pour`'));
    for (const m of gl.matchAll(/`(\w+)`=([^/`、。]+?) \/ ([^、。`]+?)(?=、|。)/g)) groups[m[1]] = { ja: m[2].trim(), id: m[3].trim() };
    for (const l of lines) {
      const c = cells(l);
      if (l.startsWith('|') && c.length === 4 && (c[0] === 'demold_check' || c[0].startsWith('ctl_'))) groups[c[0]] = { ja: c[1], id: c[2] };
    }

    // 表を行に: ヘッダ行(| itemId | seq | …)ごとに、続く | iNN | … 行を読む
    const rows = [];
    let header = null;
    for (const l of lines) {
      if (/^\| itemId \| seq \|/.test(l)) { header = cells(l); continue; }
      if (header && /^\| i\d+ \|/.test(l)) {
        const c = cells(l); const o = {};
        header.forEach((k, i) => { o[k] = c[i] === undefined ? '' : c[i]; });
        rows.push({ ...o, _noActiveCol: !header.includes('active'), _hasStage: header.includes('stage') });
      } else if (header && !l.startsWith('|')) header = null;
    }
    const notes = (() => {
      const m = lines.join('\n').match(/i50〜i55 = `([^`]+)`、i56 = `([^`]+)`、i57 = `([^`]+)`/);
      return Object.fromEntries([...Array.from({ length: 6 }, (_, i) => [`i${50 + i}`, m[1]]), ['i56', m[2]], ['i57', m[3]]]);
    })();

    it('表から69行を読み取れる(i1〜i16 / i17〜i31 / i32〜i49 / i50〜i57 / i58〜i69)', () => {
      assert.deepEqual(rows.map((r) => r.itemId), Array.from({ length: 69 }, (_, i) => `i${i + 1}`));
      assert.deepEqual(Object.keys(groups).sort(), ['ctl_base', 'ctl_clean', 'ctl_embed', 'ctl_open', 'ctl_support', 'demold_check', 'dim', 'embed', 'prep', 'safe', 'tie']);
    });

    it('各行(itemId・seq・stage・groupKey・グループ名・key・tol・measure・minMeasures・textJa・textId・active・audience・unit)が fixture と一致', () => {
      for (const r of rows) {
        const f = fixture.find((x) => x.itemId === r.itemId);
        const tol = r.tol === '' ? null : Number(r.tol);
        const exp = {
          itemId: r.itemId, seq: Number(r.seq), stage: r._hasStage ? r.stage : 'pre_pour', audience: 'both',
          groupKey: r.groupKey, groupJa: groups[r.groupKey].ja, groupId: groups[r.groupKey].id,
          textJa: r.textJa, textId: r.textId, key: r.key === 'TRUE', tol,
          measure: r.measure !== undefined ? r.measure : (tol !== null ? 'optional' : 'none'),
          minMeasures: r.minMeasures !== undefined ? Number(r.minMeasures) : (tol !== null ? 2 : 0),
          unit: 'mm', active: r._noActiveCol ? false : r.active === 'TRUE',
        };
        const got = Object.fromEntries(Object.keys(exp).map((k) => [k, f[k]]));
        assert.deepEqual(got, exp, r.itemId);
      }
    });

    it('note: i50〜i57 は §2.6.1a の note 列の記述、i58〜i69 は表の note 列と一致', () => {
      for (const r of rows.filter((x) => x.note !== undefined)) assert.equal(fixture.find((x) => x.itemId === r.itemId).note, r.note, r.itemId);
      for (const [id, note] of Object.entries(notes)) assert.equal(fixture.find((x) => x.itemId === id).note, note, id);
    });

    it('i1〜i49 は版1.8.2 と同一(git の HEAD にある fixture と、i1〜i49 の行が一致)', (t) => {
      let old;
      try {
        old = JSON.parse(require('node:child_process').execFileSync('git', ['show', 'HEAD:tests/fixtures/seed-items.json'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
      } catch { return t.skip('git の履歴が読めない'); }
      assert.deepEqual(fixture.slice(0, old.length), old, '既存の行(i1〜i49)は変更しない');
    });
  });
});
