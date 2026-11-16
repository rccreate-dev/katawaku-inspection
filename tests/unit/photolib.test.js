// U-PHOTO-05 ライブラリから選んだ写真の印(SPEC 版1.21.0 §7.1・§7.2)。対象: frontend/js/photo.js の stampText・stampLines
'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require(path.join(__dirname, '..', '..', 'frontend', 'js', 'time.js'));
const photo = require(path.join(__dirname, '..', '..', 'frontend', 'js', 'photo.js'));
const I18N = require(path.join(__dirname, '..', '..', 'frontend', 'i18n.js'));

const ms = Date.parse('2026-10-07T09:58:12+09:00');
const base = { siteName: 'A現場(仮)', floor: '2F', zone: '', inspector: '田中', ms };

describe('U-PHOTO-05 ライブラリの印', () => {
  it('印なし(カメラ): 従来どおり', () => {
    assert.equal(photo.stampText(base), 'A現場(仮) 2F ・ 田中 ・ 2026-10-07 09:58');
    assert.deepEqual(photo.stampLines(base), ['A現場(仮) 2F', '・ 田中 ・ 2026-10-07 09:58']);
  });
  it('印あり(ライブラリ): 末尾に「 ・ ライブラリ」。2行のときは2行目の末尾', () => {
    const o = { ...base, zone: '東', mark: 'ライブラリ' };
    assert.equal(photo.stampText(o), 'A現場(仮) 2F・東 ・ 田中 ・ 2026-10-07 09:58 ・ ライブラリ');
    assert.deepEqual(photo.stampLines(o), ['A現場(仮) 2F・東', '・ 田中 ・ 2026-10-07 09:58 ・ ライブラリ']);
  });
  it('辞書: 印は日本語「ライブラリ」。ボタン・案内は ja・id の両方にある', () => {
    assert.equal(I18N.ja['photo.library_mark'], 'ライブラリ');
    for (const k of ['photo.pick_library', 'photo.camera_fallback', 'err.photo_unreadable']) {
      assert.ok(I18N.ja[k] && I18N.id[k], k);
    }
  });
});
