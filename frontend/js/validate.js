/*
 * validate.js: 提出検査・判定検査の事前検証(SPEC §5.3.1 と同じ rule 名)。純関数。
 *
 * 入力の形(RecordDetail.items[] と同形。写真は枚数 photoCount か photos 配列):
 *   item = { itemId, def:{audience,key,tol,measure,minMeasures}, self:{result,severity,values,note,photoCount|photos}, qa:{...同形} }
 * 戻り値: [{ rule, itemId? }]  (全て列挙。最初の1件で止めない)
 */
(function (root) {
  'use strict';

  function arr(v) { return Array.isArray(v) ? v : []; }
  function photoCount(e) {
    if (e.photoCount != null) return e.photoCount;
    return arr(e.photos).length;
  }
  function maxAbs(values) {
    var m = 0;
    arr(values).forEach(function (v) { if (Math.abs(v) > m) m = Math.abs(v); });
    return m;
  }

  /* side: 'self' | 'qa'。audience が対象外の項目はスキップ */
  function itemViolations(items, side) {
    var out = [];
    arr(items).forEach(function (it) {
      var def = it.def || {};
      var aud = def.audience || 'both';
      if (aud !== 'both' && aud !== (side === 'self' ? 'foreman' : 'qa')) return;
      var e = it[side] || {};
      var id = it.itemId;
      var result = e.result || null;
      if (!result) { out.push({ rule: 'ANSWER_MISSING', itemId: id }); return; }
      var pc = photoCount(e);
      var values = arr(e.values);
      if (result === 'ng') {
        // 写真必須は職長側のみ。管理者(qa)側は任意(SPEC 1.5.1)
        if (side !== 'qa' && pc < 1) out.push({ rule: 'PHOTO_REQUIRED', itemId: id });
        if (!String(e.note || '').trim()) out.push({ rule: 'NOTE_REQUIRED', itemId: id });
        if (side === 'qa' && !e.severity) out.push({ rule: 'SEVERITY_REQUIRED', itemId: id });
      } else if (result === 'ok' && def.key && side !== 'qa' && pc < 1) {
        out.push({ rule: 'PHOTO_REQUIRED', itemId: id });
      }
      if (def.measure === 'required' && result !== 'na' && values.length < (def.minMeasures || 0)) {
        out.push({ rule: 'MEASURE_REQUIRED', itemId: id });
      }
      if (def.tol != null && values.length && maxAbs(values) > def.tol && result === 'ok') {
        out.push({ rule: 'MEASURE_OVER_TOL_OK', itemId: id });
      }
    });
    return out;
  }

  /* 職長の提出検査。rec = { stage, pourPlannedAt, items } */
  function validateSubmit(rec) {
    var out = itemViolations(rec.items, 'self');
    if ((rec.stage || 'pre_pour') === 'pre_pour' && !rec.pourPlannedAt) out.push({ rule: 'POUR_PLAN_REQUIRED' });
    return out;
  }

  /* QA入力の提案(画面の補助表示のみ。自動確定しない) */
  function suggestVerdict(items) {
    var ng = 0, major = 0;
    arr(items).forEach(function (it) {
      var def = it.def || {};
      if (def.audience === 'foreman') return;
      var e = it.qa || {};
      if (e.result === 'ng') { ng++; if (e.severity === 'major') major++; }
    });
    if (major > 0) return 'major';
    if (ng > 0) return 'minor';
    return 'ok';
  }

  /* QA判定検査。verdict: ok|minor|major, comment: 総合コメント */
  function validateVerdict(rec, verdict, comment) {
    var out = itemViolations(rec.items, 'qa');
    var ng = 0, major = 0;
    arr(rec.items).forEach(function (it) {
      var def = it.def || {};
      if (def.audience === 'foreman') return;
      var e = it.qa || {};
      if (e.result === 'ng') { ng++; if (e.severity === 'major') major++; }
    });
    var c = String(comment || '').trim();
    if (verdict === 'ok') {
      if (ng > 0) out.push({ rule: 'VERDICT_OK_WITH_NG' });
    } else if (verdict === 'minor') {
      if (ng < 1) out.push({ rule: 'VERDICT_NEEDS_NG' });
      if (major > 0) out.push({ rule: 'VERDICT_MINOR_HAS_MAJOR_ITEM' });
      if (!c) out.push({ rule: 'COMMENT_REQUIRED' });
    } else if (verdict === 'major') {
      if (ng < 1) out.push({ rule: 'VERDICT_NEEDS_NG' });
      if (major < 1) out.push({ rule: 'VERDICT_MAJOR_NEEDS_MAJOR_ITEM' });
      if (!c) out.push({ rule: 'COMMENT_REQUIRED' });
    }
    if (c.length > 2000) out.push({ rule: 'FIELD_INVALID', path: 'comment' });
    return out;
  }

  /* 項目単位に違反ruleをまとめる: { itemId: [rule,...] } */
  function groupByItem(violations) {
    var m = {};
    arr(violations).forEach(function (v) { if (v.itemId) (m[v.itemId] = m[v.itemId] || []).push(v.rule); });
    return m;
  }

  var api = { itemViolations: itemViolations, validateSubmit: validateSubmit, validateVerdict: validateVerdict, suggestVerdict: suggestVerdict, groupByItem: groupByItem, maxAbs: maxAbs };
  root.KW = root.KW || {};
  root.KW.validate = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
