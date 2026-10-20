// U-MEAS-01(版1.11.0。SPEC §12.3・§10.2d-4): 実測の表示の純関数 measureView_ / measureCell_(backend/Report.gs)
// Report.gs を vm で評価して検査する(GAS のグローバルを与えない=Math/Number/String 以外に依存しないことの確認も兼ねる)。
// backend/ は読むだけ(編集しない)。
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.join(__dirname, '..', '..');
const plain = (x) => JSON.parse(JSON.stringify(x));

let ctx;
before(() => {
  ctx = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'backend', 'Report.gs'), 'utf8'), ctx, { filename: 'Report.gs' });
});

const row = (selfValues, tol, extra = {}) => ({ selfValues, qaValues: extra.qaValues, snapshot: { tol, ...(extra.unit !== undefined ? { unit: extra.unit } : {}) } });
const view = (r, side = 'self') => plain(ctx.measureView_(r, side));
/** 期待: valuesText / summaryText / overCount / n */
function expectView(r, exp, msg) {
  const v = view(r);
  assert.ok(v, msg + ': null でない');
  assert.equal(v.valuesText, exp.valuesText, msg + ' valuesText');
  assert.equal(v.summaryText, exp.summaryText, msg + ' summaryText');
  assert.equal(v.overCount, exp.overCount, msg + ' overCount');
  assert.equal(v.n, exp.n, msg + ' n');
  return v;
}

describe('U-MEAS-01 measureView_(§10.2d-4)', () => {
  it('関数が存在する(measureView_ / measureCell_)', () => {
    assert.equal(typeof ctx.measureView_, 'function');
    assert.equal(typeof ctx.measureCell_, 'function');
  });

  it('①許容5・[-5,-5,-2,-5,3,-1,5,-5] → 境界(±5)は許容内で ▲ なし', () => {
    expectView(row([-5, -5, -2, -5, 3, -1, 5, -5], 5),
      { valuesText: '-5、-5、-2、-5、+3、-1、+5、-5', summaryText: 'n=8 最小-5/最大+5/許容±5mm', overCount: 0, n: 8 }, '①');
  });

  it('②許容5・[-6,0,5.5,2] → 許容超2件', () => {
    expectView(row([-6, 0, 5.5, 2], 5),
      { valuesText: '▲-6、0、▲+5.5、+2', summaryText: 'n=4 最小-6/最大+5.5/許容±5mm ▲許容超2件', overCount: 2, n: 4 }, '②');
  });

  it('③許容3・[-3,1] → 許容内(境界)', () => {
    expectView(row([-3, 1], 3), { valuesText: '-3、+1', summaryText: 'n=2 最小-3/最大+1/許容±3mm', overCount: 0, n: 2 }, '③');
  });

  it('④許容3・[4] → n=1 は最小/最大を出さない', () => {
    const v = expectView(row([4], 3), { valuesText: '▲+4', summaryText: 'n=1 許容±3mm ▲許容超1件', overCount: 1, n: 1 }, '④');
    assert.ok(!v.summaryText.includes('最小') && !v.summaryText.includes('最大'));
  });

  it('⑤tol:null・[2,-1,0] → 許容なし(▲・許容を含まない)', () => {
    const v = expectView(row([2, -1, 0], null), { valuesText: '+2、-1、0', summaryText: 'n=3 最小-1/最大+2', overCount: 0, n: 3 }, '⑤');
    assert.ok(!/▲|許容/.test(v.valuesText + v.summaryText));
    assert.equal(v.tol, null);
  });

  it('⑥tol が 0・\'\'・-1・\'abc\'・欠落 → 許容なし(⑤と同じ)。tol:2.5・[2.5,2.6]', () => {
    for (const tol of [0, '', -1, 'abc', undefined, NaN, Infinity]) {
      const r = row([2, -1, 0], tol);
      const v = expectView(r, { valuesText: '+2、-1、0', summaryText: 'n=3 最小-1/最大+2', overCount: 0, n: 3 }, '⑥tol=' + String(tol));
      assert.equal(v.tol, null, 'tol=' + String(tol));
    }
    // tol キー自体が無い(snapshot:{})
    expectView({ selfValues: [2, -1, 0], snapshot: {} }, { valuesText: '+2、-1、0', summaryText: 'n=3 最小-1/最大+2', overCount: 0, n: 3 }, '⑥欠落');
    const v = expectView(row([2.5, 2.6], 2.5),
      { valuesText: '+2.5、▲+2.6', summaryText: 'n=2 最小+2.5/最大+2.6/許容±2.5mm ▲許容超1件', overCount: 1, n: 2 }, '⑥2.5');
    assert.equal(v.tol, 2.5);
  });

  it('⑦tol:\'5\'(数字の文字列)は許容5', () => {
    const v = expectView(row([-6, 5], '5'), { valuesText: '▲-6、+5', summaryText: 'n=2 最小-6/最大+5/許容±5mm ▲許容超1件', overCount: 1, n: 2 }, '⑦');
    assert.equal(v.tol, 5); assert.equal(typeof v.tol, 'number');
  });

  it('⑧有効値が0個の側は null(空配列・null・undefined・[null,\'\']・[NaN]・[Infinity])', () => {
    for (const vals of [[], null, undefined, [null, ''], [NaN], [Infinity], [-Infinity], ['x', null, '']]) {
      assert.equal(ctx.measureView_(row(vals, 5), 'self'), null, JSON.stringify(vals) + ' ' + String(vals));
    }
    // 管理者側の値だけ・職長側だけ
    assert.equal(ctx.measureView_({ selfValues: [], qaValues: [1], snapshot: { tol: 5 } }, 'self'), null);
    assert.equal(ctx.measureView_({ selfValues: [1], qaValues: [], snapshot: { tol: 5 } }, 'qa'), null);
  });

  it('⑨数字の文字列は数値にする。数にできない要素は数えない', () => {
    expectView(row(['3', '-2.5'], null), { valuesText: '+3、-2.5', summaryText: 'n=2 最小-2.5/最大+3', overCount: 0, n: 2 }, '⑨文字列');
    expectView(row(['x', 2], null), { valuesText: '+2', summaryText: 'n=1', overCount: 0, n: 1 }, '⑨無効要素');
    // 無効要素が混ざっても有効値は入力順のまま
    expectView(row([1, null, 'x', '', 2], null), { valuesText: '+1、+2', summaryText: 'n=2 最小+1/最大+2', overCount: 0, n: 2 }, '⑨混在');
  });

  it('⑩[-0,0] → 0 と表記(-0 を出さない)', () => {
    expectView(row([-0, 0], null), { valuesText: '0、0', summaryText: 'n=2 最小0/最大0', overCount: 0, n: 2 }, '⑩');
    const v = view(row([-0, 0], null));
    assert.ok(!v.valuesText.includes('-'));
  });

  it('⑪単位: unit 空/欠落は mm、unit:\'cm\' は 許容±5cm', () => {
    for (const unit of ['', undefined, null]) {
      const v = view(row([1], 5, { unit }));
      assert.equal(v.unit, 'mm', 'unit=' + String(unit));
      assert.equal(v.summaryText, 'n=1 許容±5mm');
    }
    const c = view(row([1, -2], 5, { unit: 'cm' }));
    assert.equal(c.unit, 'cm');
    assert.equal(c.summaryText, 'n=2 最小-2/最大+1/許容±5cm');
  });

  it('⑫side: self は selfValues・ラベル職長、qa は qaValues・ラベル管理者(互いに影響しない)', () => {
    const r = { selfValues: [1, -3], qaValues: [7], snapshot: { tol: 5 } };
    const s = plain(ctx.measureView_(r, 'self')), q = plain(ctx.measureView_(r, 'qa'));
    assert.equal(s.side, 'self'); assert.equal(s.label, '職長'); assert.equal(s.valuesText, '+1、-3'); assert.equal(s.summaryText, 'n=2 最小-3/最大+1/許容±5mm');
    assert.equal(q.side, 'qa'); assert.equal(q.label, '管理者'); assert.equal(q.valuesText, '▲+7'); assert.equal(q.summaryText, 'n=1 許容±5mm ▲許容超1件');
    // 混ぜた系列は作らない
    assert.equal(q.n, 1); assert.equal(s.n, 2);
  });

  it('⑬values[i].over と overCount が一致し、values は入力順(並べ替えない)。返却の形(§10.2d-4)', () => {
    const v = view(row([3, -6, 1, 5.5, -5], 5));
    assert.deepEqual(v.values.map((x) => x.v), [3, -6, 1, 5.5, -5]);
    assert.deepEqual(v.values.map((x) => x.over), [false, true, false, true, false]);
    assert.equal(v.overCount, v.values.filter((x) => x.over).length);
    assert.deepEqual(v.values.map((x) => x.text), ['+3', '-6', '+1', '+5.5', '-5']);
    assert.equal(v.min, -6); assert.equal(v.max, 5.5); assert.equal(v.minText, '-6'); assert.equal(v.maxText, '+5.5');
    for (const k of ['side', 'label', 'n', 'values', 'min', 'max', 'minText', 'maxText', 'tol', 'unit', 'overCount', 'valuesText', 'summaryText']) assert.ok(k in v, '返却に ' + k);
    // valuesText = (over?'▲':'')+text を「、」で連結
    assert.equal(v.valuesText, v.values.map((x) => (x.over ? '▲' : '') + x.text).join('、'));
  });

  it('⑭副作用がない(row を変更しない。凍結した row でも同じ結果)', () => {
    const mk = () => ({ selfValues: ['3', -6, null, 5.5], qaValues: [7, 'x'], snapshot: { tol: '5', unit: 'mm', textJa: 'x' } });
    const r = mk(); const before = JSON.stringify(r);
    ctx.measureView_(r, 'self'); ctx.measureView_(r, 'qa');
    assert.equal(JSON.stringify(r), before, '呼ぶ前後で row が同じ');
    const frozen = mk();
    (function deepFreeze(o) { Object.freeze(o); for (const k of Object.keys(o)) if (o[k] && typeof o[k] === 'object') deepFreeze(o[k]); })(frozen);
    assert.deepEqual(plain(ctx.measureView_(frozen, 'self')), plain(ctx.measureView_(mk(), 'self')));
    // 2回呼んでも同じ(状態を持たない)
    assert.deepEqual(plain(ctx.measureView_(r, 'self')), plain(ctx.measureView_(r, 'self')));
  });

  it('許容の境界: 小数は丸めず厳密比較(許容2・[2,2.0000001,-2.0000001])', () => {
    const v = view(row([2, 2.0000001, -2.0000001], 2));
    assert.deepEqual(v.values.map((x) => x.over), [false, true, true]);
    assert.equal(v.overCount, 2);
  });
});

describe('U-MEAS-01 measureCell_(§10.2d-4)', () => {
  it('⑮有効値は {v,text,over}。無効は null。境界は許容内。許容なしは over:false', () => {
    assert.deepEqual(plain(ctx.measureCell_(-3, 2)), { v: -3, text: '-3', over: true });
    assert.equal(ctx.measureCell_(2, 2).over, false, '境界は許容内');
    assert.equal(ctx.measureCell_(-2, 2).over, false);
    assert.equal(ctx.measureCell_('', 2), null);
    assert.equal(ctx.measureCell_(null, 2), null);
    assert.equal(ctx.measureCell_(undefined, 2), null);
    assert.equal(ctx.measureCell_('x', 2), null);
    assert.equal(ctx.measureCell_(NaN, 2), null);
    assert.equal(ctx.measureCell_(Infinity, 2), null);
    const c = plain(ctx.measureCell_(4, null));
    assert.equal(c.over, false); assert.equal(c.v, 4); assert.equal(c.text, '+4');
    assert.equal(plain(ctx.measureCell_('3', 5)).text, '+3');
    assert.equal(plain(ctx.measureCell_(0, 5)).text, '0');
    assert.equal(plain(ctx.measureCell_(-0, 5)).text, '0');
    // text に ▲ は付けない(▲ は表示側で付ける)
    assert.ok(!ctx.measureCell_(9, 2).text.includes('▲'));
  });
});

describe('U-MEAS-01(静的): 旧 measureText_ の廃止と共通関数の利用(§10.2d-4)', () => {
  const gs = (f) => fs.readFileSync(path.join(ROOT, 'backend', f), 'utf8');
  it('backend/*.gs に measureText_( の呼び出し・定義が残っていない(コメントの言及は可)', () => {
    const left = fs.readdirSync(path.join(ROOT, 'backend')).filter((f) => f.endsWith('.gs'))
      .filter((f) => /\bmeasureText_\s*\(/.test(gs(f)));
    assert.deepEqual(left, [], 'measureText_ が残っているファイル');
  });
  it('Report.gs・ReportDoc.gs の両方が measureView_ を呼ぶ(表記を二重定義しない)', () => {
    assert.match(gs('Report.gs'), /measureView_\(/);
    assert.match(gs('ReportDoc.gs'), /measureView_\(/, 'doc 方式も同じ関数を呼ぶ');
    assert.ok(!/function\s+measureView_/.test(gs('ReportDoc.gs')), 'ReportDoc.gs で measureView_ を再定義しない');
  });
});
