/**
 * Notify.gs — メール通知・escalationTick・dailyMaintenance(SPEC §6.4, §6.6, §6.7)。
 * メールは Users.email があり Config.mailEnabled=TRUE のときのみ。失敗しても本処理を失敗させない。
 * 本文はリンクと最小限の文言のみ(個人情報・PIN等を含めない)。
 */
var Notify = {
  link_: function (path) {
    var base = String(Cfg.get('appBaseUrl') || '').replace(/\/+$/, '');
    return base + '/#/' + path;
  },

  /** userIds へ個別送信。1通でも送れたら true */
  send_: function (userIds, subject, body) {
    if (!Cfg.get('mailEnabled')) return false;
    var sent = false;
    Util.uniq(userIds).forEach(function (id) {
      var u = Repo.get('Users', id);
      if (!u || u.status !== 'active' || !u.email) return;
      try {
        MailApp.sendEmail({ to: u.email, subject: subject, body: body });
        sent = true;
      } catch (e) { /* 送信失敗は無視(mailed:false として記録される) */ }
    });
    return sent;
  },

  subject_: function (kind, site, rec) {
    return '[型枠検査] ' + kind + ' ' + (site ? site.name : '') + (rec && rec.floor ? ' ' + rec.floor : '');
  },

  body_: function (kind, site, rec, linkType) {
    var lines = [kind + 'があります。', '現場: ' + (site ? site.name : '')];
    if (rec) lines.push('階: ' + rec.floor + ' / 打設箇所: ' + rec.lot);
    lines.push(linkType === 'joins' ? this.link_('joins') : this.link_('record/' + (rec ? rec.recordId : '')));
    return lines.join('\n');
  },

  /** 主担当QA(不在なら有効な代行者)へ */
  toActingQa: function (site, rec, kind, linkType) {
    var q = effectiveQaMain(site.siteId);
    if (!q.acting) return false;
    return this.send_([q.acting], this.subject_(kind, site, rec), this.body_(kind, site, rec, linkType === 'joins' ? 'joins' : 'record'));
  },

  leadIds_: function () {
    return Repo.all('Users').filter(function (u) { return u.role === 'lead' && u.status === 'active'; }).map(function (u) { return u.userId; });
  },

  /** 責任者全員+その現場の担当QA(実行者除く) */
  leadsAndSiteQaIds_: function (site, exceptUserId) {
    var ids = this.leadIds_();
    effectiveAssignments_().forEach(function (a) {
      if (a.siteId === site.siteId && (a.assignRole === 'qa_main' || a.assignRole === 'qa_sub')) ids.push(a.userId);
    });
    return Util.uniq(ids).filter(function (id) { return id !== exceptUserId; });
  },

  toLeadsAndSiteQa: function (site, rec, kind, exceptUserId) {
    return this.send_(this.leadsAndSiteQaIds_(site, exceptUserId), this.subject_(kind, site, rec), this.body_(kind, site, rec, 'record'));
  }
};

/** 時間トリガー(5分ごと): 提出から無応答の記録へ30分/60分の通知 */
function escalationTick() {
  return withLock_(function () {
    var now = Util.now();
    var done = 0;
    Repo.all('Records').filter(function (r) { return r.status === 'submitted' && !r.claimedBy; }).forEach(function (rec) {
      var lvl = escLevel(rec, now);
      if (lvl <= (rec.escNotified || 0)) return;
      var site = Repo.get('Sites', rec.siteId);
      if (!site) return;
      for (var stage = (rec.escNotified || 0) + 1; stage <= lvl; stage++) {
        var to;
        if (stage === 1) {
          var today = Util.today();
          to = effectiveAssignmentsFor_(site.siteId, 'qa_sub').map(function (a) { return a.userId; })
            .filter(function (id) { return !isAbsent(id, today); });
          if (!to.length) to = Notify.leadIds_();
        } else {
          to = Notify.leadIds_();
        }
        var kind = stage === 1 ? '30分経過' : '60分経過';
        var mailed = Notify.send_(to, Notify.subject_(kind, site, rec), Notify.body_(kind, site, rec, 'record'));
        Ev.add({ actor: null, device: null, clientId: '' }, stage === 1 ? 'escalate_30' : 'escalate_60', {
          siteId: rec.siteId, recordId: rec.recordId, round: rec.round, actorUserId: 'system', actorRole: 'system',
          detail: { to: Util.uniq(to), mailed: mailed }
        });
      }
      Repo.update('Records', rec, { escNotified: lvl });
      done++;
    });
    return done;
  });
}

/** 毎日3時: Idem(30日超)削除、期限切れ招待コードに usedAt=expired */
function dailyMaintenance() {
  return withLock_(function () {
    var purged = Repo.purgeIdem(30 * 86400000);
    var nowMs = Util.nowMs();
    Repo.all('Invites').forEach(function (inv) {
      var exp = Util.dtToDate(inv.expiresAt);
      if (inv.usedAt === '' && exp && exp.getTime() < nowMs) Repo.update('Invites', inv, { usedAt: 'expired' });
    });
    return purged;
  });
}
