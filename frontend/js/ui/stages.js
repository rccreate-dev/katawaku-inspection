/* ui/stages.js: 検査段階(打設前 pre_pour / 出来形 post_demold)の共通部品(SPEC §0.2・§6.8・§9.2・§9.4) */
(function (root) {
  'use strict';
  var KW = root.KW;
  var h = KW.h, t = KW.t, ts = KW.ts, C = KW.ui;

  /* 表示順(一覧・ボード・件数行・選択肢で共通) */
  C.STAGE_ORDER = ['pre_pour', 'post_demold', 'during_pour', 'demold', 'cleanup'];
  C.stageOf = function (r) { return (r && r.stage) || 'pre_pour'; };

  function byOrder(a, b) {
    var i = C.STAGE_ORDER.indexOf(a), j = C.STAGE_ORDER.indexOf(b);
    return (i < 0 ? 99 : i) - (j < 0 ? 99 : j);
  }

  /* config.enabledStages(カンマ区切り文字列。配列も許容)。無い・空なら、bootstrap.items にある段階 → それも無ければ打設前のみ */
  C.enabledStages = function () {
    var b = KW.state.bootstrap || {};
    var cfg = b.config && b.config.enabledStages;
    var list = (Array.isArray(cfg) ? cfg : String(cfg == null ? '' : cfg).split(',')).map(function (s) { return String(s).trim(); }).filter(Boolean);
    if (!list.length) (b.items || []).forEach(function (it) { if (it.stage && list.indexOf(it.stage) < 0) list.push(it.stage); });
    if (!list.length) list = ['pre_pour'];
    return list.sort(byOrder);
  };

  /* 画面に段階の行・チップを出す対象: 有効な段階 + 記録がある段階(無効にした後も既存の記録は見える) */
  C.stagesFor = function (recs) {
    var list = C.enabledStages().slice();
    (recs || []).forEach(function (r) { var s = C.stageOf(r); if (list.indexOf(s) < 0) list.push(s); });
    return list.sort(byOrder);
  };

  /* S05 で選べる段階: 有効な段階で、getBootstrap.items にその段階の項目が1件以上あるもの(SPEC §9.2 S05)。
   * 項目がまだ届いていない(初回の取得前など)ときは打設前だけを返す(従来の挙動) */
  C.creatableStages = function () {
    var items = (KW.state.bootstrap && KW.state.bootstrap.items) || [];
    var list = C.enabledStages().filter(function (s) { return items.some(function (it) { return it.stage === s; }); });
    return list.length ? list : ['pre_pour'];
  };

  /* 記録の stage で bootstrap.items を絞る(SPEC §2.6・§5.4.2)。seq 昇順 */
  C.itemsOfStage = function (stage) {
    return ((KW.state.bootstrap && KW.state.bootstrap.items) || []).filter(function (it) { return it.stage === stage; })
      .sort(function (a, b) { return a.seq - b.seq; });
  };

  /* ある階・段階の代表ステータス(従来の階ごとの規則を、その段階の記録だけに適用。記録の無い段階は none) */
  C.stageFloorStatus = function (recs, stage) {
    return C.floorStatus(recs.filter(function (r) { return C.stageOf(r) === stage; }));
  };

  /* 段階名のチップ */
  C.stageChip = function (stage) { return h('span', { class: 'chip na' }, t('stage.' + (stage || 'pre_pour'))); };

  /* 「段階名 ステータス」のチップ(S09 のグリッド用。狭いセルで折り返せるよう wrapok) */
  C.stageStatusChip = function (stage, st) {
    return h('span', { class: 'chip wrapok st-' + st }, t('stage.' + stage) + ' ' + ts('st.' + st, stage));
  };
})(window);
