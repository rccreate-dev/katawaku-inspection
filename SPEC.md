# SPEC.md — 型枠検査記録アプリ(RCCREATE)仕様書

- 版: 1.11.1 / 作成日: 2026-10-07(最終改訂 2026-10-20) / 作成: 設計担当
- 正本の位置づけ: 本書は **API契約・シート定義・画面一覧・権限表** の正本(CLAUDE.md §1)。実装と食い違ったら実装より先に本書を直し、末尾「変更履歴」に1行書く。
- 読者: バックエンド担当(`backend/`)、フロント担当(`frontend/`)、モック担当(`mock/`)、テスト担当(`tests/`)。**本書だけを見て並行実装して食い違わない**ことを目標に、値・列名・コードは全て確定値で書く。
- 決められなかった点は「§14 仮置き事項」に `P-xx` で列挙し、本文中でも `(仮置き P-xx)` と明記する。ユーザー確認が必要なものは §14.2 にまとめた。
- 本書の「必ず」「してはならない」は規範。「推奨」は実装者裁量。

---

## 0. 共通規約(全担当が従う)

### 0.1 確定している変更不可の決定(CLAUDE.md §2 の再掲。ここから逸脱しない)
参加はQR→主担当QA承認 / 個人スマホ・氏名+4桁PIN・端末登録 / PIN再入力は QA「合格」「打設可」(出来形では「出来形確認済」)と職長「提出」のみ / 保存先はSheets+Drive / 元請はアカウントなしPDFのみ / ja・id切替 / 兼任なし / 職長コメントと管理者コメントは別フィールド・上書き禁止 / 提出後は職長編集不可(差し戻し時のみ可) / 重大不適合=打設不可・3者サインが揃うまで打設可にならない(段階が出来形の記録では、最終状態の表示が「出来形確認済」になり、打設を止める操作は無い。§6.8) / 役割はサーバー名簿で決まる / 合否は人が決める。

### 0.2 列挙値(これ以外を作らない)

| 名前 | 値 |
|---|---|
| `role`(ユーザー役割。1ユーザー1役割) | `foreman`(職長) / `qa`(品質管理者) / `lead`(管理部門責任者) |
| `userStatus` | `invited`(PIN未設定) / `active` / `locked` / `disabled`(退職・停止) |
| `assignRole`(担当表の役) | `qa_main` / `qa_sub` / `foreman` / `subforeman` |
| `membershipStatus` | `pending` / `approved` / `rejected` / `revoked` |
| `deviceStatus` | `active` / `revoked` |
| `stage`(検査段階) | `pre_pour`(打設前) / `during_pour`(打設中巡回) / `demold`(脱型承認) / `post_demold`(脱型後出来形=**出来形検査**) / `cleanup`(解体後片付け)。**版1.9: 使う段階は `pre_pour` と `post_demold` の2つだけ**(`Config.enabledStages` の既定)。他の3値は列挙値として残すが使わない(`during_pour`=打設中・管理項目表⑯は保留)。段階による違いは §6.8 |
| `status`(記録ステータス。CLAUDE.md §3 の値のみ) | `none` / `draft` / `submitted` / `fix` / `qa_ok` / `approved`。**`none` は「記録行が未作成」の仮想値で、Records.status には保存しない** |
| `result`(項目の結果) | `ok` / `ng` / `na` |
| `severity`(NG項目の重さ) | `minor` / `major` |
| `verdict`(品質管理者の判定) | `ok` / `minor` / `major` |
| `side`(写真・入力の主体) | `self`(職長) / `qa`(品質管理者) / `prime`(元請サイン証跡) |
| `photoKind`(`Photos.kind`。版1.6) | `photo`(検査写真。空欄も `photo` 扱い) / `drawing`(図面。確認箇所の書き込み付き。§7.7) |
| `noteKind` | `foreman` / `manager` |
| `primeMethod`(元請サイン方法) | `paper`(紙に署名) / `pdf`(PDFへ署名・押印) / `onsite`(現地で対面確認) |
| `lang` | `ja` / `id` |
| `audience`(項目の対象) | `both` / `foreman` / `qa` |
| `measure`(実測入力) | `none` / `optional` / `required` |

### 0.3 ID形式(不変の文字列。表示名で結合しない)
`^[a-z]_[a-z0-9]{3,32}$` を満たすこと。接頭辞: ユーザー`u_` / 現場`s_` / 担当`a_` / 参加`m_` / 端末`d_` / 記録`r_` / 写真`p_` / 招待`i_` / 不在`b_` / 帳票`f_` / ノート`n_` / イベント`e_` / 項目`i`+連番(例 `i1`。項目のみ例外で `^i[0-9]{1,4}$`)。

- **クライアントが生成するID**: 記録`recordId`(`r_`+16桁 `[a-z0-9]`)と写真`photoId`(`p_`+16桁)。オフライン作成のため。サーバーは形式と重複を検査する。
- それ以外のIDはサーバーが `接頭辞 + 12桁[a-z0-9]`(`Utilities.getUuid()` 由来)で採番。シード/テスト用は可読ID可(例 `u_tanaka`, `s_a`)。
- `clientId`(冪等キー): `^c_[A-Za-z0-9]{16,48}$`。操作1回につき1つ生成(UUIDから `-` を除く等)。

### 0.4 型・日時
- シートの型表記: `str` / `int` / `num` / `bool`(`TRUE`/`FALSE`) / `dt`(ISO8601、必ず `+09:00` 付き、例 `2026-10-07T14:05:30+09:00`) / `date`(`YYYY-MM-DD`、JST) / `json`(JSON文字列) / `enum(...)`。
- **全てのセルは書式「書式なしテキスト(`@`)」**。`setupSheets()` が全列に設定する。バックエンドはスキーマ(§2)に従い読み書きで型変換する(`bool` は `"TRUE"`/`"FALSE"` 文字列、`int`/`num` は文字列↔数値)。これによりSheetsの日付自動変換・数式解釈を防ぐ。
- 日時はサーバーでは常に `Asia/Tokyo` で `yyyy-MM-dd'T'HH:mm:ssXXX` に整形して保存・返却。クライアントが送る日時はオフセット付きISO8601を必須とし、サーバーが `+09:00` に正規化する。表示のみ整形する。
- 日付・時刻の表示と写真スタンプは **端末のタイムゾーンに依存させず JST 固定**(UTCミリ秒+9時間で整形)。
- 「今日」=JSTの日付。`validFrom`〜`validTo` は両端含む。

### 0.5 ログ・秘匿
PIN平文・招待コード平文・deviceToken平文は、**シート・Events.detail・ログ(`console.log`/`Logger`)・Idem.responseJson・Gitに残さない**。`pin` フィールドは Events/Idem 保存前に必ず除去する(§5.2)。
- **唯一の例外**: GASエディタ専用関数 `setupFirstLead`(§3.6.1)は、最初の責任者の招待コード平文を **実行ログ(`Logger`)にだけ** 表示する(エディタを開けるスクリプト所有者本人だけが見られる。Events・シート・Idem・`console` には残さない)。

---

## 1. 全体構成

### 1.1 構成図

```
[職長/QA/責任者のスマホ]  Chrome/Safari(ホーム画面追加のPWA)
   frontend/ 静的ファイル(HTML/JS/CSS/manifest/sw.js)  ←  静的ホスティング(HTTPS)
        │  fetch POST (Content-Type: text/plain;charset=utf-8, JSON文字列)
        ▼
[Google Apps Script Webアプリ(backend/)]  doPost(action方式) / doGet(ping)
        │  SpreadsheetApp / DriveApp / LockService / CacheService / MailApp / HtmlService
        ▼
[Googleスプレッドシート(記録・名簿・設定)] + [Googleドライブ(写真・サムネ・PDF)]

[元請] アカウントなし。QAが生成したPDFの共有リンク/ファイルを受け取るだけ
```

- テスト時は `backend/` の代わりに `mock/`(Nodeサーバー)が同一契約を提供する(§11)。フロントは `frontend/config.js` の `API_URL` だけで接続先を切り替える。

### 1.2 ホスティング(仮置き P-01)
- 推奨: **Cloudflare Pages**(無料・HTTPS・ビルド不要・フォルダごとアップロード可)。代替: GitHub Pages(非公開リポジトリは有料)、Firebase Hosting。
- GAS の HtmlService でPWAを配信する案は **採用しない**(iframe内配信でService Worker/manifestが使えない)。
- ホスティング先固有の設定は `frontend/config.js` の2値のみ: `API_URL`(GASデプロイURL)、`APP_BASE_URL`(PWA公開URL。QR・メール内リンク用)。
- 必須HTTPヘッダ/メタ(ホスティング側で設定できなくても `index.html` の `<meta http-equiv="Content-Security-Policy">` で担保): `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; media-src blob:; connect-src 'self' https://script.google.com https://script.googleusercontent.com; frame-ancestors 'none'`(`APP_BASE_URL` と mock 使用時は `connect-src` に `http://localhost:*` を許可するのは **開発用ビルドの config のみ**)。インラインスクリプト/インラインstyle禁止。
- **外部CDN・Webフォント禁止**(CLAUDE.md §6。reference/prototype.html は Google Fonts を読み込んでいるが、新アプリはシステムフォントスタックのみ: `"Hiragino Kaku Gothic ProN","Noto Sans JP","Yu Gothic",system-ui,sans-serif`)。

### 1.3 GAS Webアプリのデプロイ設定
`backend/appsscript.json`:
```
timeZone: "Asia/Tokyo"
runtimeVersion: "V8"
webapp: { executeAs: "USER_DEPLOYING", access: "ANYONE_ANONYMOUS" }
oauthScopes: spreadsheets, drive, script.scriptapp, script.send_mail, **documents**(版1.10.1。§10.5。`https://www.googleapis.com/auth/documents`。Googleドキュメント方式のPDF生成に必要。追記後はユーザーの再承認が要る=§10.5.9), script.external_request(不要なら除外)
```
- 「自分として実行」「全員(匿名)アクセス可」。**GAS側のGoogleログインには依存しない**。本人確認は `deviceToken` のみ(§3)。
- `Session.getActiveUser()` は使用しない。
- スクリプトプロパティ(コードやシートに置かない): `PIN_PEPPER`(PINハッシュ用の秘密。`setupSecrets()` が未設定ならランダム生成)、`SPREADSHEET_ID`、`DRIVE_ROOT_FOLDER_ID`(Config.driveRootFolderId にも写す)。

### 1.4 GASの制約と対処(必須)

| 制約 | 対処 |
|---|---|
| CORSプリフライトを処理できない(`doOptions` なし) | **POSTは必ず `Content-Type: text/plain;charset=utf-8`** で本文にJSON文字列を送る(単純リクエスト化)。カスタムヘッダ(`Authorization`等)を付けない。`credentials:'omit'`。トークンも本文に入れる。 |
| `doPost` は302でリダイレクトされる | `fetch(url,{method:'POST',redirect:'follow',...})`。ブラウザが `script.googleusercontent.com` のGETにフォローする。応答は `ContentService.createTextOutput(JSON.stringify(res)).setMimeType(ContentService.MimeType.JSON)`。 |
| HTTPステータスを返せない | 常に200。成否は本文の `ok`。 |
| 同時実行で書き込みが競合 | **更新系は `LockService.getScriptLock().waitLock(20000)` 内で実行**(例外は `uploadPhotoChunk` のみ。下記)。取れなければ `LOCK_TIMEOUT`(再試行可)。参照系はロックしない。ロックは「冪等キー確認→権限再確認→PIN検証→更新→Events→冪等キー保存」の全体を覆う。**`uploadPhotoChunk` の例外(版1.4)**: 重い処理(端末認証・パラメータ検証・base64デコード・JPEG/SHA-256検査・Driveへの本体とサムネの保存)は **ロックの外**で行い、ロック内は「再認証・記録の存在/状態確認・項目あたり上限確認・`Photos` 行の追記・記録の `touch`」だけに絞る(§1.6 の7、§5.4.4、§7.3)。他のactionのロック方式は変えない。 |
| 1リクエストの実行時間・ペイロード | 1リクエストは通常30秒以内に完了させる。写真は原則 **1枚1リクエスト(単発モード。base64全体を1回で送る。上限 `photoSingleMaxChars`)**。それを超えるときだけ従来どおり **9万文字ごとに分割**(§7.3)。PDF生成のみ最大120秒を許容。 |
| CacheServiceは1値100KB・TTL最長6時間 | 写真チャンクの一時保存に使用(**分割モードのみ**。1チャンク≤90,000文字)。単発モードはCacheServiceを使わない。参照シートのキャッシュ(§2.15)は1値100KB未満のときだけ使い、超えるときは使わず通常読み込みにフォールバックする。 |
| 起動が遅い(コールドスタート) | クライアントのタイムアウトは通常30秒・写真チャンク60秒・PDF生成120秒。タイムアウトは再試行扱い。 |
| 参照が遅い(行ごとのAPI呼び出し) | バックエンドは **1リクエスト内でシートを `getValues()` 一括読み**する。参照シート **`Config` / `Items` / `Sites` のみ** `CacheService`(スクリプトキャッシュ)で最大60秒キャッシュしてよい(§2.15。書込み時に破棄)。**権限判定に使うシート(`Users` / `Devices` / `Assignments` / `Memberships` / `Absences`)は絶対にキャッシュしない**(認可は常に最新のシートで判定する)。 |
| 固定処理(認証・シート読込)が1リクエストの大半を占める(版1.5) | 本番実測: 1往復≒1.3〜2.8秒、写真1枚の1リクエスト≒6秒のうち大半はサーバー側の固定処理(端末認証・シート読込)。本文サイズは主因ではない。対処は ①写真は単発1回(§7.3) ②同時送信(§8.4) ③**1リクエスト内で同じシートを再読込しない・必要な行/列だけ読む(§2.16)** ④`Config`/`Items`/`Sites` のみ最大60秒の読み取りキャッシュ(§2.15)。性能の目標値は §12.6(手動確認)。 |
| 認証されないGET/POSTが誰でも打てる | トークン検査をdispatcher冒頭で行う。公開actionは `ping`/`lookupInvite`/`registerDevice` のみ。 |
| `.gs` の構文チェック | `node --check` は拡張子 `.gs` でも動くか確認し、動かない場合 `tests/check-syntax.js` が一時コピーを `.js` にして検査する(テスト担当)。 |

### 1.5 リクエスト/レスポンス封筒(全action共通)

**リクエスト**: `POST {API_URL}` / `Content-Type: text/plain;charset=utf-8` / 本文は次のJSON文字列。

```json
{
  "v": 1,
  "action": "saveDraft",
  "clientId": "c_5f0a9d3c1e7b4a2f8c",
  "deviceToken": "d_k3j2h1g0a9b8.4f7c0a1b2c3d4e5f60718293a4b5c6d7e8f901234567890",
  "pin": "1234",
  "appVersion": "1.0.0",
  "sentAt": "2026-10-07T10:15:00+09:00",
  "params": { }
}
```

| フィールド | 必須 | 内容 |
|---|---|---|
| `v` | ○ | APIバージョン。固定 `1`。違うと `BAD_REQUEST`。 |
| `action` | ○ | §5 のaction名。未知は `BAD_REQUEST`。 |
| `clientId` | ★付きactionで○ | 冪等キー(§5.2)。 |
| `deviceToken` | 公開action以外で○ | 端末トークン(§3.2)。 |
| `pin` | PIN必須actionで○ | 4桁文字列 `^\d{4}$`。**PIN必須action以外に付けても無視**(保存しない)。 |
| `appVersion` | ○ | 例 `1.0.0`。`Config.minClientVersion` 未満は `CLIENT_OUTDATED`(`ping`/`me` は除く)。 |
| `sentAt` | 任意 | 端末時刻。時計ずれ診断用(判定には使わない)。 |
| `params` | ○ | action別(§5.4)。省略時は `{}`。 |

**成功レスポンス**: `{ "ok": true, "data": { ... }, "meta": { "serverTime": "2026-10-07T10:15:01+09:00", "replayed": false, "apiVersion": 1 } }`
**失敗レスポンス**: `{ "ok": false, "error": { "code": "STATE_CONFLICT", "message": "日本語の説明(開発者向け。UIはcodeで多言語表示)", "data": { } }, "meta": { "serverTime": "...", "replayed": false, "apiVersion": 1 } }`

- `error.data` は任意(コードごとに§5.3で定義)。それ以外のトップレベルキーを足さない。
- `meta.replayed` は冪等キーによる再生応答のとき `true`。
- `meta.timing`(版1.8.1。診断用・常に付く)は §1.9。クライアントは無くても動く(旧サーバー・モックの値は0)。

**GET**: `GET {API_URL}?action=ping` のみ。`{ "ok": true, "data": { "apiVersion": 1, "schemaVersion": "1", "serverTime": "..." }, "meta": {...} }`。それ以外のGETは `BAD_REQUEST`。

### 1.6 リクエスト処理順(dispatcher。バックエンドとモックで同一)

1. JSON解析・封筒検査(`v`/`action`/型)。失敗 → `BAD_REQUEST`。
2. `CLIENT_OUTDATED` 検査(`ping`/`me`以外)。
3. 公開actionなら §3 の処理へ(端末認証なし)。
4. 端末認証: `deviceToken` から `deviceId` を取り出し、`Devices` 行を引き `tokenHash` と定数時間比較。無い/不一致 → `UNAUTHENTICATED`。`status=revoked` → `DEVICE_REVOKED`。
5. ユーザー状態: `disabled` → `USER_DISABLED`、`locked` で `me`/`logoutDevice` 以外 → `USER_LOCKED`。
6. **参照系**: `params` の契約外キー検査(§5.4。表に無いキー → `BAD_REQUEST`)→ `authorize()`(§4.2)→実行→応答(ロックなし)。
7. **更新系**: `params` の契約外キー検査(`BAD_REQUEST`。ロック取得前)→ スクリプトロック取得 → (a) 冪等キー検索(あれば保存済み応答を `replayed:true` で返す) → (b) `authorize()` 再評価(ロック内で最新状態)+入力検証 → (c) PIN必須なら検証(§3.4。権限・状態・入力検証に通った後) → (d) 本処理 → (e) Events追記 → (f) 冪等キー保存 → ロック解放。
   - **応答の `record`(版1.10)**: 更新系の応答に最新の記録を載せる action は §5.1a。dispatcher の順は変えない(`record` は本処理のあと、応答の組立時に作る。サムネ・写真本体は載せない)。
   - **例外 `uploadPhotoChunk`(版1.4。冪等キー対象外のため上の(a)(f)は無い。処理全体をロックで覆わない)**: ①契約外キー検査(`BAD_REQUEST`) → ②【ロック外】手順4・5と `authorize()`(一次判定。早期失敗のため。確定判定は⑤) → ③【ロック外】入力検証・(分割モードの中間チャンクはここでCache保存して応答し終了)・組立・デコード・JPEG/SHA-256検査・Drive保存 → ④スクリプトロック取得(取れなければ `LOCK_TIMEOUT`) → ⑤【ロック内】手順4・5 と `authorize()` を **最新のシートで再評価**(失敗ならそのエラー)→ 既存 `Photos` 行の確認 → 項目あたり上限確認 → `Photos` 追記・記録の `touch` → ロック解放 → ⑥③で作ったDriveファイルは、⑤で `Photos` 行にならなかった全経路(エラー・例外・`LOCK_TIMEOUT`・既存行ありの冪等成功)でゴミ箱へ。詳細は §5.4.4。
8. 例外は `INTERNAL`(再試行可)。スタックトレース・内部パスを応答に含めない。

---


### 1.9 計測と通信診断(版1.8.1。遅さの原因を数字で見るため)

- **サーバー**: 全応答の `meta.timing` に、そのリクエストの処理時間の内訳を載せる(整数のミリ秒/回数。秘密情報・本文を含めない)。
  `{ totalMs, authMs, pinMs, lockWaitMs, driveMs, reads, readMs, writes, writeMs }`
  - `totalMs`=サーバー内の合計(受信から応答作成まで)/ `authMs`=端末認証(ロック内の再認証を含む)/ `pinMs`=PIN検証 / `lockWaitMs`=スクリプトロックの待ち / `driveMs`=写真のDrive保存 / `reads`・`readMs`=シートの読み込みの回数と時間 / `writes`・`writeMs`=シートの書き込みの回数と時間。
  - 往復の時間(端末で測る)から `totalMs` を引いた残りが「端末とGoogleの間の通信+GASの起動」。
  - モックは常に0(形だけ同じ)。契約テスト C-ENV-02 が全キーの存在と整数・0以上を検査する。
- **クライアント**(`js/perf.js`): `api.call` ごとに `{ at, action, rtMs, ok, code, net, srv }` を端末に直近100件だけ残す(IndexedDB `kv.perfLog`。3秒まとめて保存)。氏名・PIN・写真の中身は残さない。
- **画面 S21 通信診断**(`#/settings` から全員が開ける。§9.2): 操作ごとの集計(往復の中央値・最大・サーバー内の中央値・通信などの中央値。遅い順)、直近20件の内訳、「診断結果をコピー」(貼り付け用の文字列。ビルド番号つき・氏名なし)、「記録を消す」。
- 遅いと報告があったとき、責任者は職長に「診断結果をコピー」を送ってもらい、`rt`(往復)と `srv`(サーバー内)と `lock`・`rd`・`wr`・`drive` を見て原因を切り分ける。

## 2. スプレッドシート定義

- スプレッドシートは1ファイル。シート名は下記(英語・大文字始まり)。1行目=列名(下表の順序・綴り厳守)、2行目以降=データ。**列の追加・並べ替えをしない**(バックエンドは列名でマッピングするが、順序もスキーマ定数 `SCHEMA` と一致させる)。
- 列表記: 「必」=必須。「PK」=主キー(重複不可)。`json` 列は `JSON.stringify` した文字列。
- `setupSheets()`(Setup相当の関数。GASエディタから手動実行): シート作成・ヘッダ書込・全列を `@` 書式に設定・Config初期値投入・Items初期値投入(§2.6)・先頭行固定・ヘッダ保護。既存シートは破壊しない(不足列のみ追加でなく、**列不一致ならエラー終了**)。
- 追記専用シート(**更新・削除しない**): `Events` / `Notes` / `Reports` / `Idem`(Idemのみ保守で古い行の削除可)。`Photos` は論理削除のみ(`deleted`)。
- 直接編集してよいシート(名簿の暫定運用=A案): `Users`(行追加・`name`/`role`/`status`/`lang`/`email`/`qaQualified`/`note`のみ)、`Sites`、`Assignments`、`Items`、`Config`、`Absences`。**`pinSalt`/`pinHash`/`failedCount`/`lockedAt` と他シート(Records系・Devices・Memberships等)は手編集禁止**(権限・ロック解除はアプリ経由)。
- **直接編集の反映遅延(版1.4)**: `Config` / `Items` / `Sites` を直接編集した内容は、アプリ(API)へ **最大60秒遅れて**反映されてよい(参照シートの読み取りキャッシュ。§2.15)。`Users` / `Assignments` / `Absences`(と `Devices` / `Memberships`)の直接編集は遅れず、次のリクエストから反映される。

### 2.1 Users(ユーザー名簿)  PK=`userId`

| 列 | 型 | 必 | 説明 |
|---|---|---|---|
| userId | id(`u_`) | 必PK | 不変ID |
| name | str | 必 | 表示氏名(例 `田中`、`スギアント`)。重複可(IDで区別)だがログイン画面では紛れないよう運用で避ける |
| nameKana | str | | 任意(ログイン画面の並び順用) |
| role | enum(foreman,qa,lead) | 必 | **1ユーザー1役割**(兼任なしの構造的担保) |
| status | enum(invited,active,locked,disabled) | 必 | 新規は `invited`。初回端末登録で `active` |
| lang | enum(ja,id) | 必 | 既定言語。既定 `ja` |
| email | str | | 通知メール用(任意) |
| qaQualified | bool | 必 | 代行者になれる資格者か。`qa_main`/`qa_sub` に就く `qa`/`lead` は `TRUE` 必須 |
| pinSalt | str(32hex) | | PINソルト。invited中は空 |
| pinHash | str(64hex) | | §3.3 |
| failedCount | int | 必 | PIN連続誤り回数。既定0 |
| lockedAt | dt | | ロック時刻 |
| lastLoginAt | dt | | 最終の端末登録/PIN成功 |
| note | str | | 備考 |
| createdAt / updatedAt | dt | 必 | |
| company | str | | **会社名**(版1.7。例 `株式会社RCCREATE`、`○○工業`)。最大40文字。他社の職長を招待するための項目。元請向けPDFに表示(§10.2)。**列は末尾に追加**(§2.9a の方式で既存シートに不足列として追記) |

### 2.2 Sites(現場)  PK=`siteId`

| 列 | 型 | 必 | 説明 |
|---|---|---|---|
| siteId | id(`s_`) | 必PK | |
| name | str | 必 | 現場名(表示) |
| status | enum(active,closed) | 必 | `closed` は新規記録作成不可・参加申請不可・閲覧のみ |
| floors | str | 必 | 階の選択肢。**カンマ区切り・表示順**(例 `1F,2F,3F`)。各要素は `[^,]{1,10}` |
| zones | str | | 工区の選択肢(カンマ区切り。空なら自由入力不可・工区なし)。例 `東,西` |
| primeContractor | str | | 元請会社名(PDF表示) |
| address | str | | 任意 |
| joinKey | str(16) | 必 | 参加QR用の合言葉。`adminRotateJoinKey` で更新 |
| driveFolderId | str | | 現場の写真フォルダID(自動作成・自動記入) |
| startDate / endDate | date | | 任意 |
| createdAt / updatedAt | dt | 必 | |

### 2.3 Assignments(担当表)  PK=`assignId`

担当表の唯一の正本。**権限判定はこのシートの有効行のみで行う**(§4)。

| 列 | 型 | 必 | 説明 |
|---|---|---|---|
| assignId | id(`a_`) | 必PK | |
| siteId | id | 必 | |
| userId | id | 必 | |
| assignRole | enum(qa_main,qa_sub,foreman,subforeman) | 必 | |
| team | str | | 班名(職長/副職長のみ。同一現場で同じ `team` 文字列=同班)。空=個人扱い(本人の記録のみ) |
| validFrom | date | 必 | |
| validTo | date | | 空=無期限 |
| active | bool | 必 | `FALSE` で無効(削除の代わり) |
| createdBy | id | 必 | `system` 可(参加承認時) |
| createdAt / updatedAt | dt | 必 | |

**有効行** = `active=TRUE` かつ `validFrom<=今日<=validTo(空なら無限)` かつ **役割整合**(下表)。整合しない行は権限判定で**無視**(兼任なしの強制)。

| assignRole | 必要な Users.role | 追加条件 |
|---|---|---|
| qa_main | `qa` | `qaQualified=TRUE` |
| qa_sub | `qa` または `lead` | `qaQualified=TRUE` |
| foreman / subforeman | `foreman` | |

名簿制約(`adminValidateRoster` が検査。実行時は強制しない): 現場ごとに有効な `qa_main` がちょうど1人・`qa_sub` が1人以上・`qa_main` と `qa_sub` は別人・同一(siteId,userId,assignRole)の重複なし。同一QAが有効な `qa_main` を持つ現場が `Config.qaMaxSitesPerDay`(既定3)を超えたら警告のみ(P-19)。

### 2.4 Memberships(参加申請)  PK=`membershipId`

| 列 | 型 | 必 | 説明 |
|---|---|---|---|
| membershipId | id(`m_`) | 必PK | |
| siteId / userId | id | 必 | |
| status | enum(pending,approved,rejected,revoked) | 必 | |
| requestedAt | dt | 必 | |
| requestClientId | str | 必 | 申請の冪等キー |
| decidedBy | id | | 承認/却下/取消した人 |
| decidedAt | dt | | |
| assignRole | enum(foreman,subforeman) | | 承認時に決めた役 |
| team | str | | 承認時に決めた班 |
| note | str | | 却下/取消理由 |

制約: 同一(siteId,userId)で `pending` は1件まで。`approved` がある間は新規申請不可(`ALREADY_MEMBER`)。承認時に Assignments へ有効行を **自動追加**(`createdBy=承認者`)。`revoked` にしたら該当 Assignments 行を `active=FALSE`。

### 2.5 Devices(端末)  PK=`deviceId`

| 列 | 型 | 必 | 説明 |
|---|---|---|---|
| deviceId | id(`d_`) | 必PK | |
| userId | id | 必 | |
| tokenHash | str(64hex) | 必 | `SHA-256(secret)`(§3.2)。**平文トークンは保存しない** |
| label | str | | 端末名(登録時にUA等から自動、またはユーザー入力。≤40文字) |
| platform | str | | `android`/`ios`/`other` |
| appVersion | str | | |
| status | enum(active,revoked) | 必 | |
| registeredAt | dt | 必 | |
| lastSeenAt | dt | | 更新は前回から10分以上経過時のみ(書き込み節約) |
| revokedAt / revokedBy / revokeReason | dt/id/str | | |

1ユーザーの `active` 端末は最大 `Config.maxDevicesPerUser`(既定3)。超える登録時は `lastSeenAt` が最も古い端末を自動 `revoked`(理由 `auto_prune`)する(P-34)。

### 2.6 Items(項目マスタ)  PK=`itemId`

コードに項目を直書きしない。**初期値のみ seed**(`backend/Seed.gs` の `SEED_ITEMS` と `mock/` のシード、いずれも下の表と完全一致させる。`tests` が一致を検査する)。

| 列 | 型 | 必 | 説明 |
|---|---|---|---|
| itemId | str(`i`+数字) | 必PK | 不変。意味を変える変更は新ID+旧IDを `active=FALSE` |
| seq | int | 必 | 表示順(昇順)。同じ段階の項目の間で重複させない(§2.6.1a) |
| stage | enum(stage) | 必 | この項目を使う段階 |
| audience | enum(both,foreman,qa) | 必 | `both`=職長・QA両方が入力、`foreman`=職長のみ、`qa`=QAのみ |
| groupKey | str | 必 | グループ識別子(例 `prep`)。画面は `seq` 昇順に並べ、`groupKey` が変わるたびに見出しを出す。そのため **同じ `groupKey` は `seq` 上で連続**させる(§2.6.1a) |
| groupJa / groupId | str | 必 | グループ名(ja / id)。同一 `groupKey` の行は同じ値を入れる |
| textJa / textId | str | 必 | 項目文(ja / id)。idは暫定訳(P-22) |
| key | bool | 必 | 重点項目(`ok` でも写真必須) |
| tol | num | | 許容(±mm)。空=許容なし |
| measure | enum(none,optional,required) | 必 | 実測値入力。`tol` がある項目は `optional` 以上 |
| minMeasures | int | 必 | `measure=required` のとき必要な最少測定点数(寸法は2。要件§5「各面2箇所以上」) |
| unit | str | | 既定 `mm` |
| active | bool | 必 | `FALSE` は新規記録に使わない(既存記録は影響なし) |
| note | str | | 運用メモ |

**記録作成時にスナップショット**: `createRecord` 時点の `active=TRUE` かつ `stage` 一致の項目を、`audience` に関わらず全て `RecordItems` に行として固定し(`snapshot` JSON)、以後マスタが変わっても既存記録の項目は変わらない。**段階ごとに項目が違う(版1.9)**: 同じ現場・階・工区・ロットでも、`pre_pour` の記録は `stage=pre_pour` の項目だけ、`post_demold` の記録は `stage=post_demold` の項目だけを持つ(互いの項目は混ざらない)。`getBootstrap.items` は複数の段階の項目をまとめて返すので、クライアントは **記録の `stage` で項目を絞る**(オフラインで作る仮の項目リストも同じ。§9.2 S05)。作成できる段階は、その段階の有効項目が1件以上あるものに限る(§5.4.3)。

#### 2.6.1 初期値(`SEED_ITEMS`。**i1〜i69の69行 = `active=TRUE` が36項目(打設前28: i1〜i16 の16項目+i58〜i69 の12項目 / 出来形8: i50〜i57)+ 追加案33項目 `active=FALSE`(i17〜i49)**。版1.9で i50〜i69 を追加。i1〜i49 は版1.8.2 から変更なし)

共通: `stage=pre_pour` / `audience=both` / `unit=mm` / `minMeasures`: `tol`のある項目は `2`、他は `0` / `measure`: `tol`のある項目は `optional`、他は `none`(プロトタイプと同じ挙動。必須化は運用でシート編集)。**例外: i48・i49・i50〜i57 は `stage=post_demold`**(下記・§2.6.1a)。i50〜i69(版1.9)は §2.6.1a の表に `measure`/`minMeasures` を明記してあり、**この共通規則より表の値を優先**する。i1〜i16 は変更しない。グループ名: `prep`=準備・墨 / Persiapan dan marking、`dim`=寸法・精度 / Dimensi dan akurasi、`tie`=締付け・支保工 / Pengencangan dan penyangga、`embed`=埋込み・設備 / Benda tertanam dan MEP、`safe`=安全・清掃 / Keselamatan dan kebersihan。版1.9 の新グループ(`demold_check`・`ctl_*`)は §2.6.1a。

| itemId | seq | groupKey | key | tol | textJa | textId | active |
|---|---|---|---|---|---|---|---|
| i1 | 1 | prep | FALSE | | 施工図が最新版である | Gambar kerja adalah versi terbaru | TRUE |
| i2 | 2 | prep | TRUE | | 墨・通り芯が元請確認済みの位置と一致 | Marking dan as sesuai posisi yang sudah dikonfirmasi kontraktor utama | TRUE |
| i3 | 3 | prep | TRUE | | 配筋検査に合格してから型枠を閉じた | Bekisting ditutup setelah inspeksi pembesian lulus | TRUE |
| i4 | 4 | dim | FALSE | 5 | 柱・壁の建入れ(垂直4m/5mm以内) | Ketegakan kolom/dinding (vertikal 4 m / maks 5 mm) | TRUE |
| i5 | 5 | dim | FALSE | 5 | 外部型枠の通り(水平3m/5mm以内) | Kelurusan bekisting luar (horizontal 3 m / maks 5 mm) | TRUE |
| i6 | 6 | dim | FALSE | 2 | 開口の建入れ・高さ(±2mm以内) | Ketegakan dan tinggi bukaan (±2 mm) | TRUE |
| i7 | 7 | dim | FALSE | 5 | 梁幅・梁せい・スラブ厚(設計値±5mm) | Lebar balok, tinggi balok, tebal pelat (±5 mm dari desain) | TRUE |
| i8 | 8 | dim | FALSE | | 継ぎ目・隙間(ノロ漏れ防止) | Sambungan dan celah (cegah kebocoran adukan) | TRUE |
| i9 | 9 | tie | TRUE | | セパレーター・フォームタイの本数と締付け | Jumlah dan pengencangan sparator / form tie | TRUE |
| i10 | 10 | tie | FALSE | | 端太材・鋼管の緊結 | Ikatan balok pengaku dan pipa baja | TRUE |
| i11 | 11 | tie | TRUE | | サポートの根元(ベース・敷板)と水平つなぎ | Kaki penyangga (base, alas) dan pengaku horizontal | TRUE |
| i12 | 12 | tie | TRUE | | 倒れ止め(控え・ブレース) | Penahan roboh (penopang, bracing) | TRUE |
| i13 | 13 | embed | TRUE | | スリーブ(壁・スラブ・梁)の位置と径 | Posisi dan diameter sleeve (dinding, pelat, balok) | TRUE |
| i14 | 14 | embed | FALSE | | 設備・電気の埋設物と打込み金物 | Benda tertanam MEP dan besi tanam | TRUE |
| i15 | 15 | safe | TRUE | | 墜落防止(手摺・開口養生)と積載荷重 | Pencegahan jatuh (pagar, penutup bukaan) dan beban muatan | TRUE |
| i16 | 16 | safe | FALSE | | 型枠内の清掃・剥離剤・片付け | Pembersihan dalam bekisting, pelumas bekisting, perapian | TRUE |

追加案A(i17〜i31。`active=FALSE`。責任者が有効化。プロトタイプ由来の追加案15項目):

| itemId | seq | groupKey | key | tol | textJa | textId |
|---|---|---|---|---|---|---|
| i17 | 17 | prep | TRUE | | かぶり厚さの確保(スペーサーの種類・数量・配置) | Ketebalan selimut beton terjamin (jenis, jumlah, penempatan spacer) |
| i18 | 18 | dim | FALSE | 5 | 柱型枠の断面寸法・対角寸法 | Dimensi penampang dan diagonal bekisting kolom |
| i19 | 19 | dim | FALSE | 5 | 壁厚(型枠の内法寸法) | Tebal dinding (ukuran dalam bekisting) |
| i20 | 20 | dim | FALSE | 5 | 階高・スラブ天端レベル | Tinggi lantai dan level permukaan atas pelat |
| i21 | 21 | dim | FALSE | | 入隅・出隅の納まり | Kerapian sudut dalam dan sudut luar |
| i22 | 22 | prep | FALSE | | 打継ぎ面の処理(清掃・目荒らし) | Penanganan bidang sambungan cor (pembersihan, pengkasaran) |
| i23 | 23 | safe | FALSE | | 型枠面の剥離剤塗布と汚れ | Pelumas permukaan bekisting dan kotoran |
| i24 | 24 | tie | TRUE | | パイプサポートの本数・継ぎ足し・ピン止め | Jumlah, penyambungan, dan pin penyangga pipa |
| i25 | 25 | tie | FALSE | | 大引・根太の間隔と受け | Jarak dan tumpuan balok induk dan balok anak |
| i26 | 26 | embed | FALSE | | 設備貫通部の補強と位置 | Penguatan dan posisi lubang tembus MEP |
| i27 | 27 | embed | FALSE | | 止水板・水膨張ゴムの設置 | Pemasangan waterstop dan karet pengembang |
| i28 | 28 | safe | FALSE | | 清掃口の位置と清掃状態 | Posisi dan kondisi lubang pembersihan |
| i29 | 29 | safe | TRUE | | 足元の安全通路と昇降設備 | Jalur aman di bawah kaki dan alat naik-turun |
| i30 | 30 | safe | FALSE | | 型枠材の劣化(破損・反り・転用回数) | Kerusakan material bekisting (retak, melengkung, jumlah pemakaian ulang) |
| i31 | 31 | safe | TRUE | | 打設用足場・ポンプ配管の通路と固定 | Perancah pengecoran dan jalur serta fiksasi pipa pompa |

追加案B(i32〜i49。`active=FALSE`。**元資料xlsxとの突合(docs/item-reconciliation.md (c))で「元Excelにあるが落ちていた」18項目**。決定: A案=activeのi1〜i16は変えず、本18項目は無効のまま置き、責任者が必要に応じて有効化する。突合済 P-26):

共通は上記と同じ(`audience=both`・`unit=mm`・`tol` のある項目は `measure=optional`/`minMeasures=2`、他は `none`/`0`)。**元Excelの職長用/管理者用の別は付けない(全項目 `both`)**。全数/抽出の列は作らない(寸法の代表実測は `measure`/`minMeasures` と運用で表す)。`textId` は暫定訳(P-22。ネイティブ確認)。`note` は i48・i49 のみ(下記)で、i32〜i47 は空(i50〜i69 の `note` は §2.6.1a)。

| itemId | seq | stage | groupKey | key | tol | textJa | textId | active |
|---|---|---|---|---|---|---|---|---|
| i32 | 32 | pre_pour | dim | FALSE | 5 | 躯体寸法の差異(設計値±5mm以内) | Selisih dimensi struktur (maks ±5 mm dari desain) | FALSE |
| i33 | 33 | pre_pour | safe | FALSE |  | ベニヤ表面の汚れ・損傷・変形 | Permukaan triplek: kotor, rusak, berubah bentuk | FALSE |
| i34 | 34 | pre_pour | prep | TRUE |  | 柱筋のかぶり厚さ | Ketebalan selimut beton tulangan kolom | FALSE |
| i35 | 35 | pre_pour | prep | TRUE |  | 壁筋のかぶり厚さ | Ketebalan selimut beton tulangan dinding | FALSE |
| i36 | 36 | pre_pour | prep | TRUE |  | 梁筋のかぶり厚さ | Ketebalan selimut beton tulangan balok | FALSE |
| i37 | 37 | pre_pour | embed | FALSE |  | 垂直・水平スリットの向きと位置 | Arah dan posisi slit vertikal dan horizontal | FALSE |
| i38 | 38 | pre_pour | embed | FALSE |  | 目地棒の種類・向き・位置 | Jenis, arah, dan posisi strip nat (batang sambungan) | FALSE |
| i39 | 39 | pre_pour | embed | FALSE |  | サッシアンカーの位置・ピッチ | Posisi dan jarak (pitch) angkur kusen (sash) | FALSE |
| i40 | 40 | pre_pour | embed | FALSE |  | ドレイン・竪樋・オーバーフローの種類・位置・個数 | Jenis, posisi, dan jumlah drainase, pipa tegak air hujan, dan overflow | FALSE |
| i41 | 41 | pre_pour | embed | FALSE |  | ダメ穴・避難ハッチの向き・個数 | Arah dan jumlah lubang cadangan (dame-ana) dan hatch evakuasi | FALSE |
| i42 | 42 | pre_pour | tie | TRUE |  | 支保工ピッチ(計画図確認) | Jarak (pitch) penyangga (cek dengan gambar rencana) | FALSE |
| i43 | 43 | pre_pour | safe | FALSE |  | 足場上・施工階の資材片付け | Perapian material di atas perancah dan lantai kerja | FALSE |
| i44 | 44 | pre_pour | dim | FALSE | 5 | コーナー型枠の建入精度(直下段差5mm以内) | Ketegakan bekisting sudut (selisih tinggi di bawah maks 5 mm) | FALSE |
| i45 | 45 | pre_pour | tie | FALSE |  | 型枠の締付け状況(固め) | Kondisi pengencangan bekisting | FALSE |
| i46 | 46 | pre_pour | safe | FALSE |  | 休憩所の片付け | Kerapian ruang istirahat | FALSE |
| i47 | 47 | pre_pour | safe | FALSE |  | KY用紙の記入状況 | Pengisian lembar KY (kiken yochi / prediksi bahaya) | FALSE |
| i48 | 48 | post_demold | dim | FALSE |  | 出来形(コンクリートはらみ・段差) | Hasil pekerjaan: beton menggembung dan perbedaan tinggi | FALSE |
| i49 | 49 | post_demold | embed | FALSE |  | 出来形(開口部の位置・大きさ) | Hasil pekerjaan: posisi dan ukuran bukaan | FALSE |

- 正確な全列値(JSON)は `docs/new-items.json`(16列: itemId〜note)。`tests/fixtures/seed-items.json`・`Seed.gs`・`mock/seed.js` は i1〜i31 の後ろに i32〜i49、その後ろに i50〜i69(§2.6.1a)をこの値で追加する(計69行)。**版1.9: `docs/new-items.json` にも i50〜i69 の20行を追記する**(バックエンド担当が `Seed.gs` と同時に更新する)。
- **i45**: 元Excel管理者用⑧「固め状況」は「型枠の締付け」の意味(ユーザー決定)。打設時の締固め(バイブレータ)ではない。`group=tie`。
- **i48・i49(出来形・旧案)**: 版1.9 でも **行は変更せず `active=FALSE` のまま残す**。`stage=post_demold` なので、責任者が `active=TRUE` にすると(`Config.enabledStages` に `post_demold` がある間は)以後に作る出来形の記録に加わる。i48(はらみ・段差)は i56・i57 と意味が重なるため、有効化は非推奨。i49(開口部の位置・大きさ)に相当する項目は i50〜i57 に無いので、必要なら有効化してよい(`seq=49` なので出来形の記録では先頭側に出る)。`note` 列の旧文言(「v1は…createRecord 不可」)は版1.9 では実態と合わないが、**行を変えない決定のため直さない**(運用メモ。本文の記述が正)。
- 統合の粒度は変えない(i6=開口の建入れ・高さ、i16=清掃、i17=かぶり厚さは原紙の複数行を1項目にまとめたまま。i4・i7 の文言も変更しない)。

#### 2.6.1a 版1.9 の追加項目 i50〜i69(ユーザー決定 2026-10-14。全て `active=TRUE`)

出来形検査(`stage=post_demold`)を打設前検査と並べて使うため、**20項目を追加**する(出来形8+打設前12)。共通: `audience=both` / `unit=mm` / **`key=FALSE`(写真必須の指定は責任者が後で決める。§2.6.2)**。既存の i1〜i49 の行は **一切変更しない**(`seq`・`active`・`note` を含む)。`Config.enabledStages` の既定は `pre_pour,post_demold`(§2.14)。`measure`/`minMeasures` は表に明記し、§2.6.1 の共通規則より **表の値を優先**する。

**追加案C: 出来形の項目(i50〜i57。`stage=post_demold`。管理項目表⑰〜㉓由来)**

| itemId | seq | stage | groupKey | key | tol | measure | minMeasures | textJa | textId | active |
|---|---|---|---|---|---|---|---|---|---|---|
| i50 | 50 | post_demold | demold_check | FALSE | | none | 0 | 解体時のコンクリート破損(脱型時のコンクリート面の欠け・ジャンカ確認)/基準:欠け・ジャンカなし、目視確認 | Kerusakan beton saat pembongkaran (cek gompal dan keropos/honeycomb pada permukaan beton setelah bekisting dilepas)/Standar: tidak ada gompal dan keropos, cek visual | TRUE |
| i51 | 51 | post_demold | demold_check | FALSE | | none | 0 | 解体後の片付け・清掃(スラブ下)(スラブ下の型枠材・釘の撤去、廃材の分別・処理)/基準:釘・廃材なし | Pembersihan dan perapian setelah pembongkaran (bawah pelat) (lepas sisa bekisting dan paku di bawah pelat, pilah dan buang sisa material)/Standar: tidak ada paku dan sisa material | TRUE |
| i52 | 52 | post_demold | demold_check | FALSE | | none | 0 | 解体後の片付け・清掃(スラブ上)(スラブ上の型枠材・端太材の撤去)/基準:材料なし | Pembersihan dan perapian setelah pembongkaran (atas pelat) (lepas sisa bekisting dan balok pengaku di atas pelat)/Standar: tidak ada material tersisa | TRUE |
| i53 | 53 | post_demold | demold_check | FALSE | | none | 0 | 梁ロックセパ折り(梁部のセパレーター折り込み、折り込み後の補修状態)/基準:全箇所折り込み完了 | Pelipatan sparator lock pada balok (sparator balok dilipat, kondisi perbaikan setelah dilipat)/Standar: semua titik sudah dilipat | TRUE |
| i54 | 54 | post_demold | demold_check | FALSE | | none | 0 | 各所Pコン処理(Pコン取外し後のモルタル補修状態、補修色・仕上げ)/基準:補修完了・仕上げ良好 | Penanganan P-con di setiap bagian (kondisi perbaikan mortar setelah P-con dilepas, warna dan hasil akhir perbaikan)/Standar: perbaikan selesai, hasil akhir baik | TRUE |
| i55 | 55 | post_demold | demold_check | FALSE | | none | 0 | 梁下・スラブ解体後の清掃・釘取り(釘・番線・廃材の完全撤去、分別・処理)/基準:残材なし | Pembersihan bawah balok dan pelat setelah pembongkaran, cabut paku (paku, kawat bendrat, sisa material dilepas total, dipilah dan dibuang)/Standar: tidak ada sisa material | TRUE |
| i56 | 56 | post_demold | dim | FALSE | 10 | optional | 0 | 出来形 はらみ(コンクリートはらみの計測。脱型後)/基準:±10mm以内、スケール・目視 | Hasil pekerjaan: beton menggembung (ukur penggembungan beton setelah bekisting dilepas)/Standar: ±10 mm, penggaris dan visual | TRUE |
| i57 | 57 | post_demold | dim | FALSE | 3 | optional | 0 | 出来形 段差(段差・不陸の計測。脱型後)/基準:3mm以下、スケール・目視 | Hasil pekerjaan: perbedaan tinggi (ukur perbedaan tinggi dan ketidakrataan setelah bekisting dilepas)/Standar: maks 3 mm, penggaris dan visual | TRUE |

- `note` 列: i50〜i55 = `管理項目表⑰〜㉓(出来形)由来`、i56 = `管理項目表㉓(はらみ)。㉓を「はらみ」「段差」の2項目に分けた`、i57 = `管理項目表㉓(段差)。㉓を「はらみ」「段差」の2項目に分けた`。
- `textJa`/`textId` の組み立て(i50〜i57): `{項目名}({確認内容})/基準:{基準}`。ユーザー指定の項目名・確認内容・基準を1つの文にした(基準を画面に出すため文中に入れる。P-42)。`textId` は暫定訳(P-22)。
- i56・i57 は `tol` があるのに `minMeasures=0`(ユーザー指定。§2.6.1 の共通規則「`tol` のある項目は 2」の例外)。`measure=optional` なので動作に影響しない。
- 元請提出PDFの項目表は項目列が約62mmで1行固定のため、長い項目文は途中で切れる(§10.2b-A。全文はアプリと写真ページで読める)。

**追加案D: 打設前の項目(i58〜i69。`stage=pre_pour`。管理項目表①〜⑮由来)**

管理項目表の⑥建入精度=i4、⑦外部通り=i5、⑨締付け金物=i9 は既存で足りるため追加しない(ユーザー指定)。番号は管理項目表①〜⑮の順(⑥⑦⑨は欠ける)。

| itemId | seq | stage | groupKey | key | tol | measure | minMeasures | textJa | textId | active | note |
|---|---|---|---|---|---|---|---|---|---|---|---|
| i58 | 58 | pre_pour | ctl_base | FALSE | 3 | optional | 2 | 親墨・子墨位置(±3mm) | Posisi marking induk dan marking anak (±3 mm) | TRUE | 管理項目表① |
| i59 | 59 | pre_pour | ctl_base | FALSE | | none | 0 | 鉄筋かぶり(設計かぶり厚以上) | Selimut beton tulangan (minimal sesuai tebal selimut desain) | TRUE | 管理項目表②。下限だけの基準で `tol`(±)に表せないため実測欄なし |
| i60 | 60 | pre_pour | ctl_base | FALSE | | none | 0 | ベニヤ表面の汚れ・損傷・変形 | Permukaan triplek: kotor, rusak, berubah bentuk | TRUE | 管理項目表③ |
| i61 | 61 | pre_pour | ctl_open | FALSE | 5 | optional | 2 | スリット位置・寸法(±5mm) | Posisi dan ukuran slit (±5 mm) | TRUE | 管理項目表④ |
| i62 | 62 | pre_pour | ctl_open | FALSE | 5 | optional | 2 | 開口部位置・大きさ(±5mm) | Posisi dan ukuran bukaan (±5 mm) | TRUE | 管理項目表⑤ |
| i63 | 63 | pre_pour | ctl_support | FALSE | 5 | optional | 2 | コーナー型枠建入精度(直下段差5mm以内) | Ketegakan bekisting sudut (selisih tinggi di bawah maks 5 mm) | TRUE | 管理項目表⑧ |
| i64 | 64 | pre_pour | ctl_support | FALSE | 50 | optional | 2 | 支保工ピッチ(計画値±50mm) | Jarak (pitch) penyangga (±50 mm dari rencana) | TRUE | 管理項目表⑩ |
| i65 | 65 | pre_pour | ctl_support | FALSE | | none | 0 | 押し引きピッチ・位置(計画通り) | Jarak (pitch) dan posisi push-pull (sesuai rencana) | TRUE | 管理項目表⑪ |
| i66 | 66 | pre_pour | ctl_embed | FALSE | 5 | optional | 2 | 面木・目地棒打込み位置(±5mm) | Posisi pemasangan chamfer dan strip nat (±5 mm) | TRUE | 管理項目表⑫ |
| i67 | 67 | pre_pour | ctl_embed | FALSE | 5 | optional | 2 | 各種打込金物の位置・個数(±5mm、個数確認) | Posisi dan jumlah besi tanam (±5 mm, cek jumlah) | TRUE | 管理項目表⑬。位置は実測、個数は目視確認 |
| i68 | 68 | pre_pour | ctl_clean | FALSE | | none | 0 | 型枠内の清掃(木片・ゴミ) | Pembersihan dalam bekisting (serpihan kayu, sampah) | TRUE | 管理項目表⑭ |
| i69 | 69 | pre_pour | ctl_clean | FALSE | | none | 0 | 打設前の片付け・清掃 | Perapian dan pembersihan sebelum pengecoran | TRUE | 管理項目表⑮ |

- `tol`/`measure` の決め方(管理項目表の「管理基準値」から): `±N mm` と数値で決まるものは `tol=N`・`measure=optional`・`minMeasures=2`(i4〜i7 と同じ流儀)。「設計かぶり厚以上」(i59)・「計画通り」(i65)・目視確認だけの項目は `tol` なし・`measure=none`。i59 は下限だけの基準で、符号付きの差を `±tol` で判定する仕組みに乗らないため実測欄を付けない(P-42)。i63「直下段差5mm以内」は i44 と同じ `tol=5`。i67 は位置を `±5mm` で実測し、個数は目視で確認する(文中に明記)。
- 既存の i17〜i47(無効)と意味が重なるもの(i34〜i36・i17=かぶり ↔ i59、i33 ↔ i60、i37 ↔ i61、i44 ↔ i63、i42 ↔ i64、i38 ↔ i66、i43 ↔ i69)は、**無効のまま残して新しい itemId で足す**(§2.6.2 の規則2「意味を変える→新ID」。ユーザー指定)。**有効な既存項目と実質重なりうる組**は i58 ↔ i2(墨)、i62 ↔ i6(開口。許容が ±5mm と ±2mm で違う)、i67 ↔ i14(打込み金物)、i68 ↔ i16(型枠内の清掃)の4組。ユーザー指示どおり別項目で追加するが、現場で重複して聞かれるため要確認(§14.2 の13)。
- `textId` は全て暫定訳(P-22)。

**グループ**(同一 `groupKey` の行は `groupJa`/`groupId` を同一にする。`dim` は既存):

| groupKey | groupJa | groupId | 使う項目 |
|---|---|---|---|
| demold_check | 脱型後・解体後 | Setelah bongkar bekisting dan pembongkaran | i50〜i55(出来形) |
| dim | 寸法・精度 | Dimensi dan akurasi | i56・i57(出来形。既存グループ) |
| ctl_base | 墨・配筋・型枠面 | Marking, pembesian, dan permukaan bekisting | i58〜i60(打設前) |
| ctl_open | スリット・開口 | Slit dan bukaan | i61・i62(打設前) |
| ctl_support | 建入れ・支保工 | Ketegakan dan penyangga | i63〜i65(打設前) |
| ctl_embed | 面木・目地・打込金物 | Chamfer, strip nat, dan besi tanam | i66・i67(打設前) |
| ctl_clean | 清掃・片付け | Pembersihan dan perapian | i68・i69(打設前) |

**表示順の方針(`seq`・`groupKey`)**:
1. `seq` は itemId の数字と同じ(i50→50)。同じ段階の項目の間で重複させない。新しい項目は常に末尾(その時点の最大 `seq`+1 以降)に足し、**既存項目の `seq` は変えない**(既存の画面番号を動かさないため。i1〜i16 の `seq` もそのまま)。
2. 画面・PDFは `seq` 昇順に並べ、`groupKey` が変わるたびにグループ見出しを出す(現行実装の動き。§9.2 S06)。そのため **同じ `groupKey` は `seq` 上で連続**させる。i58〜i69 を既存5グループ(`prep` など)へ入れず `ctl_*` の新グループにしたのは、既存グループへ入れると i16 の後ろで同じ見出しが二重に出るため。管理項目表の番号順(①②③…⑮)に並べると、そのままグループ単位で連続する。出来形は `demold_check`(i50〜i55)の後に `dim`(i56・i57)が続く。
3. 画面の項目番号(No.)は、その記録の項目だけを `seq` 昇順に数えた添字(§7.7)。打設前の新規記録は No.1〜16 = i1〜i16(従来どおり)、No.17〜28 = i58〜i69。出来形の新規記録は No.1〜8 = i50〜i57。段階が違う記録の番号は無関係。
4. 無効項目 i17〜i49 は `seq` がグループ単位で連続していない(版1.2 までの追加案)。責任者が有効化する場合は、見出しが二重に出るのを許容するか、新しい itemId+`seq` で足し直す(§2.6.2)。
5. 版1.9 の有効項目の数: 打設前28(i1〜i16、i58〜i69)、出来形8(i50〜i57)、合計36。

#### 2.6.1b 既存のスプレッドシートへの反映(版1.9。バックエンド担当・運用向け)

- `setupSheets()` は **Items が空のときだけ** 初期値を入れ、Config は **不足キーだけ** 追記する(既存の挙動。既存の値は上書きしない)。したがって **本番の既存スプレッドシートには、i50〜i69 も `enabledStages` の新しい既定も自動では入らない**。
- GASエディタ専用関数 **`addMissingSeedItems()`**(`backend/Schema.gs`。§3.6.1 の `setupFirstLead` と同じく Webアプリの action ではない=action数は43のまま)を新設する: `SEED_ITEMS` のうち、Items シートに `itemId` が無い行だけを末尾に追加する。**既存の行は変更・削除しない**(値が違っていても触らない)。スクリプトロック内で行い、追加した `itemId` の一覧を `Logger` に出す。書込み後に参照キャッシュを破棄する(§2.15-4)。何度実行しても結果は同じ(2回目以降は0件追加)。
- `Config.enabledStages` は、責任者の依頼で Claude が Config シートの値を `pre_pour,post_demold` に書き換える(REQUIREMENTS §14 の運用)。
- 反映の推奨順: ①バックエンド配布 ②フロント配布(`SW_VERSION` を上げる) ③`addMissingSeedItems()` を実行(これで i58〜i69 が **以後に作る打設前の記録** に入り、i50〜i57 が入る。既存の記録は変わらない) ④古い端末が出来形を「打設可」と表示しないよう、必要なら `minClientVersion` を新版へ上げる ⑤`enabledStages` を `pre_pour,post_demold` にする。**⑤を③より先にしない**(出来形の項目が無いまま作成できてしまうのを防ぐため、サーバーは項目0件の段階の `createRecord` を `STAGE_NOT_ENABLED` にする。§5.4.3)。
- 手順と確認方法は `docs/OPERATIONS.md` に書く(バックエンド担当)。

#### 2.6.2 項目マスタ編集ルール(運用。P-26・P-36)

Items の変更は **責任者だけ** がスプレッドシートで行う(§2 の「直接編集してよいシート」の運用ルール)。

1. **編集権限**: スプレッドシートの共有設定で責任者のみ(編集者)とする。**QA・職長にはスプレッドシート自体を共有しない**(アプリ経由のみ。サーバー側の権限判定とは別の運用上の防御)。
2. **IDの意味は変えない**: 既存 `itemId` の `textJa/textId/tol/key/measure/stage/audience` の意味が変わる変更はせず、**新しい `itemId`(末尾の次番号)で行を追加し、旧IDを `active=FALSE` にする**(§2.6 の `itemId` 説明どおり)。誤字訂正など意味が変わらない修正のみ同じ行を直してよい。`active` の切替・`seq` の変更は可。
3. **反映範囲**: 変更は **以後に新規作成される記録から** 反映される。既存記録は作成時のスナップショット(§2.6)で不変(`active` を下げても既存記録は影響なし)。
4. **編集後の検証**: 名簿の `adminValidateRoster`(§5.4.7)と同様に責任者が管理者操作で行える Items 検証が望ましい。**現行SPECには Items の整合チェックが無い**ため、v1 は編集後に責任者が目視確認する(`itemId` の重複なし・`seq` の重複なし・`tol` があれば `measure` が `optional` 以上・`stage` が §0.2 の値・`groupKey` ごとに `groupJa/groupId` 同一・`audience`/`measure` が §0.2 の値・**同じ段階の有効項目で同じ `groupKey` が `seq` 順に連続していること(版1.9。§2.6.1a)**・`pre_pour` と `post_demold` の有効項目が各1件以上)。自動化は **SPEC変更要望として §14.2 の10に記載**(P-36)。
5. **インドネシア語**: 追加・変更した `textId` は暫定訳のまま使い、ネイティブ確認を行う(P-22)。
6. **反映の遅れ(版1.4)**: アプリが `Items` をキャッシュする(§2.15)ため、編集がアプリへ届くまで最大60秒かかる(「以後に新規作成される記録から反映」の規則は変わらない)。編集後に動作を確認するときは約1分待つ。

### 2.7 Records(記録ヘッダ)  PK=`recordId`

記録単位 = 現場×階×工区×打設ロット×段階。段階・再検査ごとに別レコード。

| 列 | 型 | 必 | 説明 |
|---|---|---|---|
| recordId | id(`r_`) | 必PK | クライアント生成可 |
| siteId | id | 必 | |
| floor | str | 必 | `Sites.floors` のいずれか |
| zone | str | | 空可。`Sites.zones` が空でない現場では、そのいずれか(空も可) |
| lot | str | 必 | 打設ロット名(自由入力 ≤40文字。例 `L1`) |
| stage | enum(stage) | 必 | `Config.enabledStages` にある段階のみ作成可。**版1.9 の既定は `pre_pour`(打設前)と `post_demold`(出来形)**(P-10、§6.8) |
| status | enum(draft,submitted,fix,qa_ok,approved) | 必 | `none`は保存しない |
| round | int | 必 | 提出ラウンド。作成時1、`fix→submitted` の再提出で+1 |
| reinspectOf | id | | 再検査の元記録(`approved`だった記録)。通常は空 |
| ownerUserId | id | 必 | 作成した職長 |
| team | str | | 作成時の作成者の班(Assignments.team)。空可 |
| pourPlannedAt | dt | | 打設予定日時(提出時必須。P-06)。**`stage=pre_pour` のみ**。`post_demold` では使わず常に空(§6.8) |
| firstSubmittedAt | dt | | 最初の提出時刻(期限遅れ判定用) |
| submittedBy | id | | 直近の提出者 |
| submittedAt | dt | | 直近の提出時刻(エスカレーションの起点) |
| claimedBy | id | | 「確認中」にしたQA/責任者(先着) |
| claimedAt | dt | | |
| qaDraftAt | dt | | claimer が最後に `saveQaDraft` した時刻(引き継ぎ判定) |
| qaVerdict | enum(ok,minor,major) | | 直近の判定 |
| qaVerdictBy / qaVerdictAt | id/dt | | |
| qaComment | str | | 直近の判定コメント(職長コメントとは別列) |
| major | bool | 必 | 直近判定が `major` か(既定FALSE) |
| primeSignedBy | id | | 元請サインを記録した人(QA/責任者) |
| primeSignedAt | dt | | |
| primeSignerName | str | | 元請担当者名(自由入力≤40文字) |
| primeSignMethod | enum(paper,pdf,onsite) | | |
| stopped | bool | 必 | 打設停止中か(既定FALSE。§6.3)。`pre_pour` のみTRUEになりうる(`post_demold` では常にFALSE。§6.8) |
| stoppedBy / stoppedAt / stopReason | id/dt/str | | |
| escNotified | int | 必 | 通知済みエスカレーション段階 0/1/2(提出ごとに0へ戻す) |
| createdAt / updatedAt | dt | 必 | |
| version | int | 必 | 更新ごとに+1(UIの更新検知用。楽観ロックには使わない) |
| ownerCompany | str | | **作成時の作成者の会社名の写し**(版1.8。`createRecord` 時に `Users.company` を写す。後で名簿が変わっても過去の記録は変わらない。**列は末尾に追加**(§2.9a)。この列が空の既存記録は、表示・PDFとも作成者の現在の `Users.company` で代用する) |

一意制約: 同一 `(siteId,floor,zone,lot,stage)` に対し `reinspectOf` が空の記録は1件まで。2件目の作成は `ALREADY_EXISTS`。`approved` 済みスロットを再検査するときだけ `reinspectOf=その記録` で追加作成でき、その記録は元記録が `approved` であること(P-31)。**一意性は段階を含む**ので、同じ現場・階・工区・ロットでも `pre_pour` と `post_demold` は別の記録として1件ずつ作れる(版1.9。既存の実装のまま)。`reinspectOf` の元記録は同じ現場・階・工区・ロット・**段階**であること(違えば `VALIDATION_FAILED`(`FIELD_INVALID`、path=`reinspectOf`))。

### 2.8 RecordItems(項目別入力)  PK=`recordItemId`(=`{recordId}:{itemId}`)

職長側入力列(`self*`/`foremanNote`)と管理者側入力列(`qa*`)は **別列**。書込権限もactionで分離(§4)。

| 列 | 型 | 必 | 説明 |
|---|---|---|---|
| recordItemId | str | 必PK | `{recordId}:{itemId}` |
| recordId / itemId | id | 必 | |
| snapshot | json | 必 | 作成時点の項目定義 `{seq,stage,audience,groupKey,groupJa,groupId,textJa,textId,key,tol,measure,minMeasures,unit}` |
| selfResult | enum(ok,ng,na) | | 空=未入力 |
| selfSeverity | enum(minor,major) | | 職長NGの任意の目安。空可 |
| selfValues | json | | 数値配列(最大10)。**設計値との差(mm、符号付き)**。許容判定は `max(abs)` |
| foremanNote | str | | 職長の項目コメント(≤1000文字)。**職長のみ書込**。NGは必須 |
| selfUpdatedAt | dt | | |
| qaResult | enum(ok,ng,na) | | |
| qaSeverity | enum(minor,major) | | `qaResult=ng` のとき必須 |
| qaValues | json | | 数値配列(QAの代表実測) |
| qaNote | str | | 管理者の項目コメント(≤1000文字)。**QA/責任者のみ書込** |
| qaUpdatedAt | dt | | |

再提出(`fix→submitted`)時、`qa*` 列を空にする(前ラウンド分は Events.detail の判定イベントと Notes に残るので失われない。§6.2)。`self*`/`foremanNote` は残す。

### 2.9 Photos(写真)  PK=`photoId`

| 列 | 型 | 必 | 説明 |
|---|---|---|---|
| photoId | id(`p_`) | 必PK | クライアント生成 |
| recordId | id | 必 | |
| itemId | str | | `side=prime` では空、それ以外は必須 |
| side | enum(self,qa,prime) | 必 | |
| round | int | 必 | 撮影時の Records.round |
| takenBy | id | 必 | 撮影者(=アップロードした人) |
| takenAt | dt | 必 | 端末の撮影時刻(§7.5で検証) |
| receivedAt | dt | 必 | サーバー受信時刻 |
| mime | str | 必 | `image/jpeg` 固定 |
| bytes | int | 必 | 本体のバイト数 |
| width / height | int | 必 | 本体の画素数 |
| sha256 | str | 必 | 本体のSHA-256(hex) |
| stampText | str | 必 | 焼き込んだスタンプ文字列(§7.2) |
| driveFileId | str | 必 | 本体 |
| thumbFileId | str | 必 | サムネ |
| clockSuspect | bool | 必 | 端末時刻が不正と判定したとき `TRUE` |
| deleted | bool | 必 | 論理削除(既定FALSE) |
| deletedBy / deletedAt | id/dt | | |
| kind | enum(photo,drawing) | | 版1.6。空=`photo`(旧行)。`drawing` は図面(§7.7)。**列は末尾に追加**(既存シートは `setupSheets()` が不足列を末尾に補う。§2.9a) |
| markers | json | | 版1.6。`kind=drawing` のみ。確認箇所の印の配列(§7.7)。`photo` では空 |

**図面の行(`kind=drawing`)の値**: `itemId` は空、`side` は `self` または `qa`(`prime` 不可)、`mime` は `image/jpeg`、本体=書き込み(印)を焼き込み済みのJPEG、`stampText`=§7.2 と同じ書式の文字列(ただし画素には焼き込まない)、`takenAt`=登録操作の時刻。

### 2.9a 既存シートへの列追加(版1.6)
`setupSheets()` は、既存シートの **ヘッダが SPEC の先頭部分と一致し、列数がSPECより少ない** 場合(列の末尾追加だけの差)は、エラーにせず不足列のヘッダを末尾に書き足す(データ行は触らない)。それ以外の不一致(順序違い・余分な列・名前違い)は従来どおりエラー。版1.6 の対象は `Photos` の `kind`,`markers` のみ。

### 2.10 Notes(コメント追記ログ)  PK=`noteId`  **追記専用**

職長コメントと管理者コメントは `kind` で別管理し、**行の更新・削除は禁止**(上書き不可の担保)。

| 列 | 型 | 必 | 説明 |
|---|---|---|---|
| noteId | id(`n_`) | 必PK | |
| recordId | id | 必 | |
| itemId | str | | 空=記録全体へのコメント |
| kind | enum(foreman,manager) | 必 | |
| authorUserId | id | 必 | |
| authorRole | enum(role) | 必 | |
| round | int | 必 | |
| text | str | 必 | ≤2000文字 |
| source | enum(submit,verdict,addNote) | 必 | `submit`=提出時に項目コメントを確定記録、`verdict`=判定時に管理者の項目コメント・総合コメントを確定記録、`addNote`=個別追記 |
| clientId | str | | 冪等キー |
| createdAt | dt | 必 | |

### 2.11 Events(履歴ログ)  PK=`eventId`  **追記専用**

| 列 | 型 | 必 | 説明 |
|---|---|---|---|
| eventId | id(`e_`) | 必PK | |
| at | dt | 必 | |
| kind | enum(下記) | 必 | |
| siteId | id | | |
| recordId | id | | 管理系イベントは空 |
| actorUserId | id | | システムは `system` |
| actorRole | str | | |
| deviceId | id | | |
| fromStatus / toStatus | enum(status) | | 状態遷移のみ |
| round | int | | |
| clientId | str | | |
| detail | json | | 種別ごとの補足(**PIN・トークン・招待コード平文を含めない**。長さ≤40,000文字、超過は注記を切り詰める) |

`kind` の値(これ以外を作らない): `record_created` / `submitted` / `resubmitted` / `claimed` / `claim_released` / `claim_taken_over` / `verdict_ok` / `verdict_minor` / `verdict_major` / `prime_signed` / `stopped` / `note_added` / `report_generated` / `escalate_30` / `escalate_60` / `join_requested` / `join_approved` / `join_rejected` / `join_revoked` / `device_registered` / `device_revoked` / `pin_failed` / `pin_locked` / `pin_changed` / `user_unlocked` / `user_status_changed` / `invite_issued` / `absence_set` / `absence_cancelled` / `joinkey_rotated`。
(下書き保存・写真追加は高頻度のためEventsに残さない。写真は Photos、下書きは `updatedAt` で追える。)

`detail` の主な内容: `submitted`/`resubmitted` = `{items:[{itemId,result,severity,values,note}],late:bool,pourPlannedAt}`、`verdict_*` = `{verdict,comment,items:[{itemId,result,severity,values,note}],warnings:[...]}`、`prime_signed` = `{signerName,method,evidencePhotoId}`、`stopped` = `{reason,previousStatus}`、`claim_taken_over` = `{from}`、`escalate_*` = `{to:[userId...],mailed:bool}`、`pin_failed` = `{action,remaining}`。

### 2.12 Absences(不在登録)  PK=`absenceId`

| 列 | 型 | 必 | 説明 |
|---|---|---|---|
| absenceId | id(`b_`) | 必PK | |
| userId | id | 必 | |
| dateFrom / dateTo | date | 必 | 両端含む |
| reason | str | | ≤100文字 |
| registeredBy | id | 必 | 責任者 |
| createdAt | dt | 必 | |
| cancelledAt | dt | | 取消時刻。入っている行は無効 |

### 2.13 補助シート

**Invites(招待コード)** PK=`inviteId`: `inviteId`(id `i_`)/`userId`/`purpose`(enum first,pinReset)/`codeHash`(§3.3)/`expiresAt`(dt)/`usedAt`(dt)/`createdBy`(id)/`createdAt`(dt)。

**Reports(元請向けPDF)** PK=`reportId`  追記専用: `reportId`(id `f_`)/`recordId`/`version`(int、記録ごと1から)/`recordStatus`(生成時のstatus)/`driveFileId`/`url`/`sha256`(PDF本体)/`generatedBy`(id)/`generatedAt`(dt)。

**Idem(冪等キー)** PK=`clientId`: `clientId`/`userId`/`action`/`paramsHash`(§5.2)/`responseJson`(成功応答のJSON。≤45,000文字。`RecordDetail` を返す `createRecord`/`claimReview`/`takeoverReview` は空文字で保存し、再生規則は §5.2)/`createdAt`。30日経過行は日次保守で削除。

### 2.14 Config(設定)  PK=`key`  列: `key`(str)/`value`(str)/`type`(enum str,int,num,bool)/`description`(str)

| key | 既定値 | 説明 |
|---|---|---|
| schemaVersion | `1` | |
| minClientVersion | `1.0.0` | これ未満の端末は `CLIENT_OUTDATED` |
| timezone | `Asia/Tokyo` | 変更不可(固定) |
| escalationMin1 | `30` | 提出から無応答でこの分数→代行者へ |
| escalationMin2 | `60` | 〃→責任者へ |
| majorReportMin | `30` | 重大不適合の報告期限(分)。判定時に責任者へ即時通知する運用で満たす(P-25) |
| claimTakeoverMin | `30` | claimer が無操作でこの分数経過したら担当QAが引き継ぎ可 |
| selfDeadlineHour | `15` | 職長自主検査の期限(打設前日の時) |
| qaOpenHour | `16` | QA検査開始(打設前日の時) |
| qaLeadMinutes | `120` | QA検査の遅くとも打設の何分前まで |
| qaMaxSitesPerDay | `3` | QA1人の主担当現場数の目安(警告のみ) |
| pinMaxFail | `5` | |
| maxDevicesPerUser | `3` | |
| inviteTtlHours | `72` | |
| inviteFailMax | `10` | 招待コードの失敗の許容回数(サーバー全体・窓あたり。版1.7) |
| inviteFailWindowMin | `10` | 上の窓(分) |
| photoMaxEdge | `1280` | 本体の長辺px上限 |
| photoJpegQuality | `0.72` | |
| photoThumbEdge | `320` | サムネ長辺px |
| photoThumbMaxChars | `100000` | サムネ `thumb`(base64)の最大文字数。超えると `PHOTO_INVALID`(§5.4.4)。**サーバー専用で公開Config(`getBootstrap.config`)には入れない**。サムネ目安(≤30KB、§7.3)の約3倍の余裕 |
| photoMaxPerItem | `5` | 項目×side あたりの写真上限 |
| photoChunkChars | `90000` | **分割モード(`total>1`)** の1チャンクあたりbase64文字数上限(4の倍数)。単発モードには適用しない。**版1.5で決定: 既定を 700000 等へ上げない(90000のまま)**。分割モードは途中チャンクを CacheService に保存し、CacheService は1値100KB(=102,400バイト)までのため(§1.4)、90000を超えるとCache保存が失敗して分割モードが壊れる。「実質常に1回で送る」は `photoSingleMaxChars` で実現する(下の行。`photoMaxBytes` のbase64長 800,000 文字 ≤ 1,200,000 なので初期設定は常に単発になり、分割は `photoMaxBytes` を大きく上げた場合と旧クライアント・旧サーバー互換の経路だけで使う)。責任者が値を変更する場合は 100KB 未満(推奨は90000以下)に保つこと |
| photoMaxBytes | `600000` | 本体の最大バイト数 |
| photoSingleMaxChars | `1200000` | **単発モード(`total=1`)** の `data`(base64全体)の最大文字数(4の倍数)。`photoMaxBytes`(600000)のbase64(800000文字)を十分に含む値。責任者が `photoMaxBytes` を上げるときは `ceil(photoMaxBytes/3)*4` 以上に合わせる(下回っても動作する。クライアントが分割にフォールバックするだけ)。**版1.5で整合を確認**: 既定の `photoMaxBytes=600000` → base64長は `ceil(600000/3)*4=800000` 文字 ≤ `photoSingleMaxChars=1200000`(余裕150%)。リクエスト本文は `data`+`thumb`(≤`photoThumbMaxChars` 100,000)+メタで約0.9MB以下。本文サイズは遅さの原因ではない(実測: 400KB本文でも約1.6秒)ので上限は変えない |
| photoParallel | `3` | 1端末から同時に送ってよい写真アップロード(`uploadPhotoChunk` の行)の最大数。サーバーは `Config` の `int` 変換(`parseInt`)で整数として返す(空・非数のセルは既定値3が返る)。クライアントはその値を §8.4-0 の規則で1〜6に収める。§8.4 |
| enabledStages | `pre_pour,post_demold` | カンマ区切り。作成可能な段階。**版1.9 の既定は `pre_pour,post_demold`**。`during_pour` などは入れない(項目が無く、サーバーも有効項目0件の段階は作成させない)。既存の本番シートの値は自動では変わらない(§2.6.1b) |
| pollIntervalSec | `60` | クライアントのポーリング間隔 |
| driveRootFolderId | (setupで作成) | |
| pdfShareMode | `anyone_with_link` | または `private`(P-32) |
| mailEnabled | `TRUE` | |
| appBaseUrl | (要設定) | メール内リンク用 |
| retentionYears | `10` | 保管年数(表示・運用用。自動削除はしない P-18) |
| keepWarmMinutes | `5` | 版1.10。GAS起動待ち対策のトリガー間隔(分)。`int`。許容値 5/10/15/30(それ以外・1・非数は5として扱う。§6.7a)。**サーバー専用で、`bootstrap.config` には含めない**。`setupSheets()` が不足キーとして追記する(既存の値は変えない) |
| reportEngine | `html` | 版1.10.1。元請PDFの生成方式。`html`(従来のHTML→PDF。用紙がレターになる=§10.5)または `doc`(Googleドキュメントで用紙A4を明示して組み立てる=§10.5)。`str`。`trim` と小文字化のうえ `doc` のときだけ doc 方式、**それ以外(空・欠落・不正値)は `html`**。doc 方式が失敗したときは自動で `html` に切り替えて PDF を必ず作る(§10.5.8)。**サーバー専用で、`bootstrap.config` には含めない**。`setupSheets()` が不足キーとして追記する(既存の値は変えない)。既定を `doc` に変えるのはユーザーの実機確認後(§10.6。別の版) |

### 2.15 参照シートの読み取りキャッシュ(版1.4)

読み取りを速くするための契約。**認可の正しさを優先**し、キャッシュしてよいシートを限定する。

1. **対象(これだけ)**: `Config` / `Items` / `Sites`。`CacheService.getScriptCache()` に、キー `ref:Config` / `ref:Items` / `ref:Sites`、TTL **最大60秒** で保存してよい(キャッシュしない実装も契約適合)。`itemsHash`(§5.4.2)はキャッシュ済みの `Items` から計算してよい。
2. **絶対にキャッシュしない**: `Users` / `Devices` / `Assignments` / `Memberships` / `Absences`(権限判定・端末認証・ユーザー状態・担当・不在の入力)。`Records` / `RecordItems` / `Photos` / `Notes` / `Events` / `Idem` / `Invites` / `Reports` も対象外。端末認証(§1.6 の4・5)と `authorize()`(§4.2)は常に最新のシートを読む。ロック内の再確認(§5.4.4)も同じ。
3. **`joinKey` はキャッシュ経由で照合・返却しない**: `requestJoin` / `adminGetJoinInfo` / `adminRotateJoinKey` は `Sites` を常にシートから直接読む(合言葉の失効が60秒遅れないように)。
4. **破棄**: アプリ(API・セットアップ関数)が `Config` / `Items` / `Sites` に書き込んだら、書込み直後(ロックを解放する前)に該当キーを `remove` する。現状の該当は `adminRotateJoinKey`(`Sites.joinKey`)・`uploadPhotoChunk`(`Sites.driveFolderId` の初回記入)・`setupSheets()`/`Seed`。**実装は `Repo.gs` の書込み関数が対象シートなら自動で破棄する形にして漏れを防ぐ**。
5. **直接編集の遅れ**: 責任者がスプレッドシートで直接編集した `Config` / `Items` / `Sites` の反映は **最大60秒遅れてよい**(運用上の周知は §2.6.2・§2 の注記)。それ以外のシートの直接編集は遅れない。
6. **100KB超**: CacheService の1値上限(100KB=102,400バイト。UTF-8のバイト数で判定)を超える、または `put` が例外になるときは、**黙って(エラーにせず・値をログに出さず)キャッシュを使わず** 通常のシート読み込みの結果を返す。`get` の失敗・JSON解釈の失敗も同じく通常読み込みにフォールバックする。値を分割して保存することはしない。
7. **競合の許容**: 参照シートを読んだ後、キャッシュへ書く前に別リクエストが書込み・破棄をすると、書込み前に読んだ古い値がキャッシュに残りうる。この古い値は最大60秒(TTL)で自然に消えるため **許容する**(追加の排他や世代管理は不要)。
8. キャッシュの有無でAPIの契約(応答の形・エラーコード)は変わらない。変わりうるのは、直接編集された `Config`/`Items`/`Sites` が最大60秒古いこと(例: 直後の `getBootstrap` が古い `items`/`config` を返す、`createRecord` の項目スナップショットが古い `Items` で作られる、`Sites.status` を閉鎖(`closed`)に直接編集した直後の最大60秒間は `createRecord` が `SITE_CLOSED` にならず通りうる)だけ。これらは **許容する**。
9. モックは常に最新を返す(キャッシュ非実装)。harness は実装してよく、実装するときは §11.4 の `keepCache`/`cacheStats` と C-CACHE を満たすこと。
10. **TTLの上限は60秒で固定**(版1.5で確認)。5分などへ延ばすと、責任者が直接編集した `Config`/`Items`/`Sites` の反映遅れ(上記5・8)がその分だけ延びるため、延ばす場合は先に本書(2・5・8 と §2 の注記、§2.6.2、P-38)を直す。**書込み系の可変データ(`Users`/`Devices`/`Records`/`RecordItems`/`Photos`/`Assignments`/`Memberships`/`Absences`/`Notes`/`Events`/`Idem`/`Invites`/`Reports`)をリクエストをまたいでキャッシュすることは、理由を問わず禁止**(上記2の再掲)。

### 2.16 1リクエスト内の読み込み最小化(版1.5。バックエンド担当向け。APIの契約・結果は変えない)

固定処理時間(§1.4)を縮めるための実装規則。**応答・権限判定・エラーコード・書込み結果は、全シートを毎回全件読む素朴な実装と完全に同じ**でなければならない(契約テストは変更しない)。

1. **リクエスト内メモ**: `Repo.gs` は1回の `doPost`/`doGet` の間だけ有効な「シート別の読み込み結果メモ」を持つ。同じシート(同じ範囲)を2回以上 `getValues()` してはならない(端末認証→ユーザー状態→`authorize()`→本処理で `Users`/`Assignments` 等を何度も読まない)。メモはリクエスト開始時に空にし、**リクエストをまたいで持ち越さない**(グローバル変数に残さない)。
2. **書込みとの整合**: 同じリクエスト内でそのシートに書いたら、メモを更新するか破棄する(書込み後の読み込みは書込みを反映する)。
3. **ロック取得後は必ず読み直す**: 更新系でスクリプトロックを取得した直後にメモを全破棄し、ロック内の冪等キー検索・`authorize()` 再評価(§1.6 の7(b))・ロック内の再認証(§5.4.4)は最新のシートから読む。ロック前に読んだ値でロック内の判定をしてはならない。
4. **読む範囲を絞ってよい**(挙動が変わらない範囲で): 端末認証は `Devices` を全列・全行読まず、`deviceId` 列だけ読んで該当行を特定し、その1行だけ読む(`Users` も同様に `userId` で1行)。`Idem` は `clientId`(と保持期間内の行)だけを探し、`Events`・`Records`・`Photos`・`Notes` は対象の `recordId` の行だけを必要な列だけ読む。**全件走査が必要な処理(担当表の有効行判定、不在判定、一覧系、`adminValidateRoster`)は全件読んでよい**。行の探索に `TextFinder`・列だけの `getRange().getValues()` を使ってよい。
5. 上記1〜4は **可変データのリクエストをまたぐキャッシュ(Script/Document/UserCache、PropertiesService への保存を含む)にはあたらない**。リクエストをまたぐキャッシュは §2.15 の `Config`/`Items`/`Sites` だけ。
6. 効果の確認は §12.6(実GASで手動)。実行ログ(Apps Script の実行数・実行時間)で `ping` 以外の1リクエストあたりの固定処理が短くなっていることを見る。

---

## 3. 認証

### 3.1 全体方針
- 本人確認は「氏名(=userId)選択 + 4桁PIN」で **端末登録**し、以後は端末に保存した `deviceToken` のみで認証する(PIN不要)。PINは「職長の提出」「QA/責任者の合格(`verdict=ok`)」「元請サイン記録(打設可。出来形では出来形確認済)」でのみ再入力する(§3.4)。
- **役割はサーバーの `Users.role` と `Assignments` だけで決まる**。リクエストに役割・ユーザーIDを載せても信用しない(そもそも契約に含めない。ユーザーは `deviceToken`→`Devices.userId` で決まる)。
- セッション有効期限は設けない(トークンは失効操作まで有効)。紛失は責任者が端末登録解除(§3.7)。

### 3.2 deviceToken
- 形式: `{deviceId}.{secret}`。`secret` は48桁の16進(`Utilities.getUuid()` 2個から `-` を除き先頭48文字、あるいは同等の乱数)。
- サーバーは `tokenHash = hex(SHA-256(secret))` のみ保存。平文は `registerDevice` の応答で1度だけ返す。
- クライアントは IndexedDB の `kv` ストア(キー `deviceToken`)に保存(§8.2)。ログ・URL・画面に出さない。
- 検証: `deviceId` で行を引き、`tokenHash` と定数時間比較。

### 3.3 PIN・招待コードのハッシュ
- `pinSalt` = ランダム16バイトの16進(32桁)。ユーザーごと。PIN変更ごとに再生成。
- `pinHash = hex(HMAC_SHA256(key=PIN_PEPPER, message = pinSalt + ":" + userId + ":" + pin))`(スクリプトプロパティの秘密 `PIN_PEPPER` を鍵にする。4桁は総当たり可能なため、**ペッパーをシートと別の場所に置く**ことと **5回ロック**で守る。P-02)。
- 招待コード: 6桁の数字。`codeHash = hex(HMAC_SHA256(key=PIN_PEPPER, message = "invite:" + userId + ":" + code))`。
- 比較は定数時間。モックは同一アルゴリズム(Node `crypto.createHmac`、ペッパー固定値 `mock-pepper`)で実装し、テストが `pinHash` の再計算で検証できるようにする。

### 3.4 PIN必須action(stepUp)
次の3 actionのみ、リクエスト封筒の `pin`(4桁)を必須とする。**これ以外のactionでPINを要求しない**(`changePin` を除く。下記)。

| action | 条件 |
|---|---|
| `submitRecord` | 常に必須(初回提出・再提出とも) |
| `submitVerdict` | `verdict=ok` のときのみ必須(`minor`/`major` は不要) |
| `recordPrimeSign` | 常に必須(=打設可の確定。出来形の記録では出来形確認済の確定) |

例外: `changePin` は現在のPINの確認が必須(封筒 `pin` に現在PIN、`params.newPin` に新PIN)。`registerDevice` はPINをparamsに持つ。

処理順(§1.6 の (b)〜(d)): **権限・状態・入力検証に通った後**にPINを検証する(権限のない操作や入力不備でPINの誤り回数を消費させない)。

PIN検証:
1. `pin` なし/形式不正 → `PIN_REQUIRED`(誤り回数は増やさない)。
2. `Users.status` が `locked` → `USER_LOCKED`。
3. ハッシュ不一致 → `failedCount += 1`、Events `pin_failed`。`failedCount >= Config.pinMaxFail(5)` になったら `status=locked`・`lockedAt=now`・Events `pin_locked` を書き **`USER_LOCKED`** を返す。5回未満なら `PIN_INVALID`(`error.data.remaining = 5 - failedCount`)。
4. 一致 → `failedCount=0`。

誤りカウンタは **ユーザー単位(全端末で共通)**。`registerDevice`(既存PIN検証・招待コード検証)も同じカウンタを使う。

### 3.5 ロック
- ロック中(`status=locked`)は **全action拒否(`USER_LOCKED`)**。例外は `ping` / `me` / `logoutDevice` のみ(`me` は `user.status="locked"` を返し、UIはロック画面S02を出す)。
- 端末登録は維持される(解除後すぐ使える)。クライアントは `me` を `Config.pollIntervalSec` ごとに呼び、`active` に戻ったら通常画面へ復帰する。
- **解除は責任者のみ**: `adminUnlockUser`(§5.4)。`status=locked` のユーザーにだけ有効。`failedCount=0`、`lockedAt` 空、`status=active`、Events `user_unlocked`。

### 3.6 端末登録フロー(`lookupInvite` → `registerDevice`)(版1.7で変更。ユーザー決定)
**氏名一覧は未認証で返さない**(他社の職長も招待するため。`listLoginUsers` は廃止)。**招待コードを先に入力**し、コードから本人を特定する。

UI: S01。①招待コード(6桁)を入力 →「次へ」(`lookupInvite`)→ ②サーバーが返した **本人の氏名・会社名**(「○○さんですね」)を確認 → ③**会社名**(責任者が名簿に入れた値があれば初期表示。本人が書き換えてよい。最大40文字)とPIN4桁(新規)を入力 →「登録する」(`registerDevice`)。**会社名は初回登録(`purpose=first`)では必須**(名簿に会社名があれば省略可)。再設定(`pinReset`)では任意。入力された会社名は前後の空白を除き連続空白を1つにして `Users.company` に保存する。氏名を選ぶ操作はない。

| ケース | コードの `purpose` | サーバー処理 |
|---|---|---|
| A 初回(`invited`) | `first` | `registerDevice`: コード検証 → `pinSalt/pinHash` 設定 → `status=active` → 端末登録 |
| C PIN再設定・追加端末・機種変更(`active`) | `pinReset` | `registerDevice`: コード検証 → PIN差し替え → 端末登録。他端末は有効のまま |

- **追加端末(旧ケースB。氏名+既存PINだけで登録)は廃止**。新しい端末は必ず責任者が発行した招待コード(`first` または `pinReset`)が要る(責任者が `adminIssueInvite`)。ロック中(`locked`)のユーザーは先に責任者が解除。
- **`lookupInvite`**(公開action): params `{ "inviteCode" }`。有効な(未使用・未失効・最新の)コードに一致する1件を探し、`{ "name", "company", "purpose" }` だけを返す(userId・役割・status は返さない)。一致なし → `INVITE_INVALID`、期限切れ → `INVITE_EXPIRED`。`USER_DISABLED`/`USER_LOCKED` のユーザーのコードは `INVITE_INVALID` として扱う(存在を示さない)。**コードは使用済みにしない**(`registerDevice` で使用済みにする)。
- **`registerDevice`**: params `{ "inviteCode", "pin", "deviceLabel"?, "platform"?, "appVersion"? }`(`userId` は受け取らない。コードから特定)。
- **コードの特定**: 未使用・未失効の Invites 全行について `hashInvite(userId, code)` を計算して一致を探す(件数は少ない)。**発行時に、他の有効なコードと同じ値にならないよう再抽選**する(`adminIssueInvite`・`setupFirstLead`)ため、一致は高々1件。
- **総当たり対策**(`lookupInvite` と `registerDevice` 共通): コードが一致しない失敗を、サーバー全体で `Config.inviteFailWindowMin`(10分)あたり `Config.inviteFailMax`(10回)まで。超えたら `RATE_LIMITED`(メッセージ「しばらく待ってからやり直してください」)で、以後の試行を窓が過ぎるまで拒否(正しいコードでも拒否)。カウンタは Script Cache(`CacheService`)に保存(再起動で消えてよい)。Events `invite_failed`(detail に件数のみ。コード平文は入れない)。ユーザー単位の PIN 誤りロック(§3.5)は従来どおり。コード検証は PIN の誤りカウント(`failedCount`)に加算しない。
- 招待コード: 責任者が `adminIssueInvite` で発行(§5.4)。有効期限 `Config.inviteTtlHours`(72時間)。ユーザーごとに未使用の最新1件のみ有効(新規発行で旧コードは即失効)。期限切れ → `INVITE_EXPIRED`。使用後 `usedAt` を記録。
- 端末登録時 `Users.lastLoginAt` 更新、Events `device_registered`。`maxDevicesPerUser` 超過時は §2.5 の自動整理。
- `registerDevice` は冪等キーを使わない(応答にトークン平文が入るためIdemに保存しない)。応答喪失時はコードが使用済みになっているため、責任者が再発行する。
- ユーザーの新規追加は **Usersシートに行を追加**(`userId,name,role,status=invited,lang,qaQualified,failedCount=0,createdAt,updatedAt` と、**他社の職長は `company`(会社名)**)→ 責任者がアプリで招待コードを発行 → 本人へ口頭/対面/メッセージで伝える(P-03)。
- PIN変更: `changePin`(§5.4)。

#### 3.6.1 最初の責任者の作成(`setupFirstLead`。GASエディタ専用)
最初の責任者は、招待コードを発行できる「ログイン済みの責任者」が存在しないため `adminIssueInvite` では作れない。そこで GAS エディタから実行する関数 `setupFirstLead(name, loginId?)`(`backend/Schema.gs`)で作る。**Webアプリの action ではない**(`ACTIONS` に登録しない。action 数は 43 のまま。契約・mock の変更なし)。

- 前提: `setupSheets` 実行済み。
- 引数: `name`(必須。前後空白除去後 1〜40文字)、`loginId`(任意。Users.userId。`u_` 接頭辞の §0.3 形式。省略時は `Util.newId('u')` で採番)。
- 作成する行: `role=lead` / `status=invited` / `lang=ja` / `qaQualified=TRUE` / `failedCount=0` / `createdAt`・`updatedAt`=now。**`lead` 以外の役割は作れない**(引数にroleを持たない)。
- **二重作成の禁止**: `status` が `disabled` でない `role=lead` のユーザーが1人でもいれば、何も作らずに中止し、理由を `Logger` に出す。`loginId` が既存の userId と重複する場合も中止する。
- 招待コード: 6桁・`purpose=first`・有効 `Config.inviteTtlHours`(72時間)・ハッシュは §3.3。`adminIssueInvite` と同じ Invites 行を作る(`createdBy=system`)。Events に `invite_issued`(`actorUserId=system`。detail に平文を含めない)。
- 処理は `LockService.getScriptLock()` 内で行う。コード平文の表示先は §0.5 の例外のとおり `Logger` のみ。
- この初回登録(§3.6 ケースA)の後は、責任者がアプリの `adminIssueInvite` で他のユーザーの招待コードを発行する。
- **責任者自身の追加端末・PIN再設定**: 発行できる責任者がいなくなる場合に備え、GASエディタ専用の関数 `issueLeadCode(userId)`(`backend/Schema.gs`。Webアプリのactionではない)で `purpose=pinReset` の招待コードを発行できる(対象は `role=lead` の `active` ユーザーのみ。コード平文は `Logger` のみ)。他に有効な責任者がいればその人が `adminIssueInvite` で発行してもよい。

### 3.7 端末登録解除・退職
- 紛失端末: 責任者が `adminRevokeDevice`(`status=revoked`)。以後その端末は `DEVICE_REVOKED`。クライアントは `deviceToken` を消去し S01 へ(未送信のoutboxは保持し、同一ユーザーで再登録すれば再開。別ユーザーなら確認の上で破棄 §8.4)。
- 退職者: Usersシートの `status=disabled`(または `adminSetUserStatus`)。以後全actionが `USER_DISABLED`(端末は残るが無効)。再有効化は `adminSetUserStatus(active)`(`pinHash`があれば `active`、無ければ `invited`)。
- 自端末のログアウト: `logoutDevice`(自分の端末を `revoked`・理由 `logout`)。

### 3.8 クライアントでの扱い
- PIN・招待コードは **メモリ上のみ**。入力欄は `type="password" inputmode="numeric" autocomplete="off" maxlength="4"`(招待は6)。送信後に欄をクリアし変数も破棄。IndexedDB/localStorage/ログに残さない。
- stepUpの再試行: 通信失敗時、同じ `clientId`・同じPINで最大3回(間隔2秒・4秒)自動再送。それでも失敗なら PIN入力モーダルを閉じて「通信できません」を出し、次回は同じ `clientId` を再利用して再入力(§5.2。成功/確定エラーで破棄)。
- stepUpが必要な3操作は **オンライン限定**(圏外ではボタン無効+理由表示。P-05)。PIN平文をoutboxに入れないため。

---

## 4. 権限

### 4.1 権限表(役割 × action)

凡例: ○=許可(条件付き)、×=不可、公=公開(端末認証なし)。**「条件」は全て `authorize()` が評価する**(§4.2)。

| action | 職長 | QA | 責任者 | 条件(要点) |
|---|---|---|---|---|
| ping | 公 | 公 | 公 | |
| lookupInvite | 公 | 公 | 公 | 招待コードに一致する1件の `name,company,purpose` のみ(userId・役割・statusは返さない。氏名一覧は返さない。総当たり対策 §3.6) |
| registerDevice | 公 | 公 | 公 | §3.6 |
| me / setLang / changePin / logoutDevice | ○ | ○ | ○ | 本人のみ。`changePin` は現PIN必須 |
| getBootstrap | ○ | ○ | ○ | 自分に見える現場・項目のみ |
| listRecords / getRecord | ○ | ○ | ○ | 職長=有効な担当(foreman/subforeman)がある現場のみ、詳細は **自班(同team)または自分の記録のみ**。他班は `masked`(要約のみ)。QA=有効な `qa_main`/`qa_sub` の現場のみ。責任者=全現場 |
| createRecord | ○ | × | × | 職長の担当現場。`Sites.status=active` |
| saveDraft | ○ | × | × | 自班/自分の記録。status∈{draft,fix}。`qa*` 列は書けない |
| submitRecord | ○ | × | × | 同上。**PIN必須** |
| claimReview | × | ○ | ○ | 担当QA(有効な qa_main/qa_sub)または責任者(最終代行)。status=submitted かつ未claim |
| releaseClaim | × | ○ | ○ | claim者本人、または責任者 |
| takeoverReview | × | ○ | ○ | 責任者はいつでも。担当QAは claim 者の無操作が `claimTakeoverMin` 以上、または claim 者が不在登録中 |
| saveQaDraft | × | ○ | ○ | claim者本人のみ。status=submitted |
| submitVerdict | × | ○ | ○ | claim者本人のみ。status=submitted。`ok` は **PIN必須** |
| recordPrimeSign | × | ○ | ○ | 担当QAまたは責任者。status=qa_ok。**PIN必須** |
| stopPour | ○ | ○ | ○ | **その現場に有効な担当(職長は班を問わず)** または責任者。status∈{submitted,qa_ok,approved}。異常時は誰でも止められる。**他班(`masked`)の記録からも実行できる**(理由必須。内容は引き続きマスクのまま。応答・`actions` も masked 形)。**`stage=pre_pour` の記録のみ**(版1.9。`post_demold` の記録では `STATE_CONFLICT`、`actions` にも入らない。§6.8) |
| addNote | ○ | ○ | ○ | 職長=編集可能な自班記録(status∈{draft,fix})に `kind=foreman`。QA/責任者=担当現場の記録に `kind=manager`(status不問) |
| uploadPhotoChunk | ○ | ○ | ○ | `side=self`: 編集可能な職長。`side=qa`: claim者(status=submitted)。`side=prime`: 担当QA/責任者(status=qa_ok) |
| deletePhoto | ○ | ○ | ○ | 撮影者本人、かつ同一ラウンド、かつその side が編集可能な状態。削除済みの写真は `NOT_FOUND` |
| getPhotoThumbs / getPhoto | ○ | ○ | ○ | その写真の記録を `getRecord`(詳細)できる人 |
| generateReport / listReports | × | ○ | ○ | 担当QA/責任者。status∈{qa_ok,approved} |
| requestJoin | ○ | × | × | `joinKey` 一致、`Sites.status=active` |
| listJoinRequests | ○ | ○ | ○ | 職長=自分の申請のみ。QA=自分が担当の現場。責任者=全て |
| decideJoin | × | ○ | ○ | `qa_main`。`qa_sub` は主担当が不在登録中のみ。責任者は常に可 |
| revokeMembership | × | ○ | ○ | `qa_main` または責任者 |
| listAssignments | × | ○ | ○ | QA=自分の担当現場のみ。責任者=全て |
| listAbsences | × | ○ | ○ | |
| adminListUsers / adminIssueInvite / adminUnlockUser / adminSetUserStatus / adminRevokeDevice / adminSetAbsence / adminCancelAbsence / adminGetJoinInfo / adminRotateJoinKey / adminValidateRoster | × | × | ○ | 責任者のみ |

重要な不変条件(テスト対象 §12):
- 職長は **他現場**の記録を一覧・詳細・写真・PDFで見られない。他班の記録は `masked`(詳細・写真・コメントは見えない)。**唯一の例外として、同じ現場に有効な担当がある職長は、`masked` の打設前(`pre_pour`)の記録に対して `stopPour` だけ実行できる**(`actions` に `stopPour` が入る。それ以外の action は不可。出来形の `masked` 記録の `actions` は常に空)。
- QAは **担当外現場**の記録を claim/判定/元請サイン記録/PDF生成できない。
- 職長は提出後(status∈{submitted,qa_ok,approved})に編集・写真追加・コメント追加ができない。`fix` のときだけ可。
- `foremanNote`/`selfResult` 等の職長列は QA/責任者のいかなる action でも書き換えられない。QAのコメントは `qaNote`/`qaComment`/Notes(kind=manager)にのみ書かれる。Notes の行は更新・削除されない。
- 職長とQAは兼任不可(1ユーザー1役割 + Assignments の役割整合 §2.3)。

### 4.2 権限判定関数(backendの1関数に集約)

```
authorize(actor, action, ctx) -> { ok: true } | { ok: false, code, reason }
  actor = { userId, role, status }                  // Devices→Users から導出。リクエストの申告値は使わない
  ctx   = { siteId?, record?, photo?, membership?, targetUserId?, params }
```
- 戻り値の `code` は §5.3 のエラーコード。`reason` は開発者向け文字列(応答には出さない)。
- バックエンド実装は **この関数ただ1つ**に全ての権限・状態条件を置く(`Authz.gs`)。各actionハンドラは冒頭で必ず `authorize` を呼ぶ。参照系の `listRecords`/`getRecord` の可視範囲フィルタも同関数群(`visibleSiteIds(actor)`, `canViewDetail(actor, record)`)を使う。
- フロントは **権限判定を実装しない**。画面の表示制御は、レコードに付く `actions`(後述)だけを参照する。

評価順(最初に満たした失敗で返す。**全体の順序は 認証 → `BAD_REQUEST`(契約外キー) → 役割(`FORBIDDEN_ROLE`) → 範囲(現場 → 班) → 状態 → 個別条件**。後段の検査は前段に通った後にのみ行い、前段の失敗を後段のエラーで置き換えない。例: 契約外キーを含む職長の `claimReview` は `FORBIDDEN_ROLE` ではなく `BAD_REQUEST`、他現場の記録への `claimReview` は状態に関わらず `FORBIDDEN_SITE`。入力検証 `VALIDATION_FAILED` は `authorize` 通過後・PIN検証より前(§3.4)):
1. 認証・ユーザー状態: dispatcher(§1.6 の4・5)の `UNAUTHENTICATED`/`DEVICE_REVOKED`、および `actor.status`: `disabled`→`USER_DISABLED` / `locked` かつ action∉{me,logoutDevice}→`USER_LOCKED`。
2. 契約外キー: `params` に §5.4 の表に無いキーがある → `BAD_REQUEST`(§1.6 の6・7。役割・状態の判定より前)。
3. 役割: §4.1 の表で actor.role が不可 → `FORBIDDEN_ROLE`。
4. 現場スコープ(`siteId` を持つactionのみ): `siteAccess(actor, siteId)` が無い → `FORBIDDEN_SITE`。
   - `lead` → 常に有り。`qa` → 有効Assignment(`qa_main`/`qa_sub`)がある。`foreman` → 有効Assignment(`foreman`/`subforeman`)がある。
   - 有効Assignment = §2.3 の定義(active・期間内・役割整合)。
5. 班スコープ(職長×記録。4と合わせて「範囲」): `record.ownerUserId == actor.userId` または(`actor` の当該現場の `team` が空でなく `record.team` と一致)でなければ `FORBIDDEN_TEAM`。ただし `stopPour`・`requestJoin` は班スコープを適用しない。
6. 状態条件: §6 の遷移表の「from」に合わない → 編集系は `RECORD_LOCKED`、遷移系は `STATE_CONFLICT`(`error.data={status,round}`)。`stopPour` の段階条件(`stage=pre_pour` のみ。版1.9)もここで評価し、満たさなければ `STATE_CONFLICT`。`params.round` を取るactionは現在の `round` と不一致でも `STATE_CONFLICT`。
7. 個別条件: claim済み→`ALREADY_CLAIMED` / claim者でない→`NOT_CLAIMER`(未claimなら `NOT_CLAIMED`)/ 引き継ぎ不可→`TAKEOVER_NOT_ALLOWED` / `decideJoin` の不在条件 / `deletePhoto` の条件(他人の写真→`FORBIDDEN_TEAM`、別ラウンド・編集不可の状態→`RECORD_LOCKED`)。

補助関数(同ファイルに置き、モックも同名で実装):
- `isAbsent(userId, date)`: 有効な(`cancelledAt`空)Absencesに `dateFrom<=date<=dateTo` がある。
- `effectiveQaMain(siteId)`: `qa_main` が不在なら有効な `qa_sub`(不在でない者)を「代行中」として扱う(表示と `decideJoin` の許可に使う)。
- `canEditRecord(actor, record)`: 職長で `FORBIDDEN_TEAM` でなく status∈{draft,fix}。
- `allowedActions(actor, record) -> string[]`: 記録に対して `authorize` が ok になる action 名の配列。対象は `saveDraft, submitRecord, claimReview, releaseClaim, takeoverReview, saveQaDraft, submitVerdict, recordPrimeSign, stopPour, addNote, uploadPhotoChunk, generateReport`。**`RecordSummary.actions` と `RecordDetail.actions` にそのまま返す**。PIN・入力検証など入力に依存する条件は含めない(権限と状態だけ)。`stopPour` は `stage=pre_pour` の記録でだけ含める(版1.9。`post_demold` では、誰に対しても・どの status でも含めない)。`masked` の記録の `actions` は `stopPour` だけ(§5.1)。
- `escLevel(record, now)`(§6.4)、`computeTiming(record)`(§6.5)。

---

## 5. API契約

### 5.1 共通オブジェクト(レスポンスの型。フィールド追加・名前変更は SPEC を先に直す)

`null` は「値なし」。配列は空でも必ずキーを返す。日時は `dt`、日付は `date`(§0.4)。

**UserBrief** `{ "userId": "u_sato", "name": "佐藤" }`

**Me** `{ "userId", "name", "company":"str"(版1.8。未設定は空文字), "role": "foreman|qa|lead", "status": "active|locked", "lang": "ja|id", "email": "str|null" }`

**Site**(`getBootstrap.sites[]`)
```json
{ "siteId":"s_a", "name":"A現場(仮)", "status":"active", "floors":["1F","2F","3F"], "zones":[],
  "primeContractor":"○○建設(仮)",
  "qa": { "main": {"userId":"u_sato","name":"佐藤"}, "mainAbsent": false, "subs":[{"userId":"u_suzuki","name":"鈴木"}] },
  "myAssignRole": "foreman|subforeman|qa_main|qa_sub|null", "myTeam": "田中班" }
```
(責任者は全現場。`myAssignRole`/`myTeam` は該当なしなら `null`。`qa.main` は有効な `qa_main` が無ければ `null`。)

**Item**(`getBootstrap.items[]`。`active=TRUE` かつ `Config.enabledStages` の段階のみ。**複数の段階の項目が混ざって返る**(版1.9 の既定は打設前28+出来形8)ので、クライアントは **記録の `stage` で絞る**。§2.6)
`{ "itemId","seq","stage","audience","groupKey","groupJa","groupId","textJa","textId","key":false,"tol":5|null,"measure":"none|optional|required","minMeasures":0,"unit":"mm" }`

**RecordSummary**
```json
{ "recordId":"r_8k2m4n6p8q0s2u4w", "siteId":"s_a", "floor":"2F", "zone":"", "lot":"L1", "stage":"pre_pour",
  "status":"submitted", "round":1, "reinspectOf":null,
  "ownerUserId":"u_tanaka", "ownerName":"田中", "ownerCompany":"山田工業株式会社", "team":"田中班",
  "pourPlannedAt":"2026-10-08T09:00:00+09:00",
  "submittedAt":"2026-10-07T10:00:00+09:00",
  "claimedBy":null, "claimedByName":null, "claimedAt":null,
  "qaVerdict":null, "major":false, "stopped":false, "escLevel":1,
  "counts":   { "total":16, "filled":16, "ok":15, "ng":1, "na":0 },
  "qaCounts": { "filled":0, "ok":0, "ng":0, "na":0 },
  "hasReport":false, "updatedAt":"2026-10-07T10:00:00+09:00", "version":7,
  "masked":false, "actions":["claimReview","stopPour","addNote"] }
```
- `counts` は職長入力(`audience` が both/foreman の項目)、`qaCounts` はQA入力(both/qa)。`total` は対象項目数。
- **masked 形**(職長が他班の記録を一覧したとき): `{recordId,siteId,floor,zone,lot,stage,status,team,updatedAt,version,"masked":true,"actions":[]}` のみ。それ以外のキーは含めない。**`actions` は `stopPour` が許される(同現場の有効な担当、かつ `stage=pre_pour`、かつ `status∈{submitted,qa_ok,approved}`)ときだけ `["stopPour"]`、それ以外は `[]`**(出来形の記録は常に `[]`)(他のaction名は入れない)。`stopPour` の応答の `record` も、呼出者が他班の職長ならこの masked 形で返す。

**ItemEntry**(`RecordDetail.items[]`)
```json
{ "itemId":"i9",
  "def": { "seq":9,"stage":"pre_pour","audience":"both","groupKey":"tie","groupJa":"締付け・支保工","groupId":"Pengencangan dan penyangga","textJa":"…","textId":"…","key":true,"tol":null,"measure":"none","minMeasures":0,"unit":"mm" },
  "self": { "result":"ng", "severity":null, "values":[], "note":"控えが1箇所不足", "updatedAt":"…", "photos":[ <PhotoMeta> ] },
  "qa":   { "result":null, "severity":null, "values":[], "note":"", "updatedAt":null, "photos":[] } }
```
`result`/`severity` 未入力は `null`、`note` 未入力は `""`、`values` 未入力は `[]`。**職長に対しては、status が `draft`/`submitted` のとき `qa` を `null` で返す**(QAの下書きを見せない)。`fix`/`qa_ok`/`approved` では `qa` を返す(是正指示の確認用)。

**PhotoMeta** `{ "photoId","itemId":"i9|null","side":"self|qa|prime","round":1,"takenBy":"u_tanaka","takenByName":"田中","takenAt":"…","width":1280,"height":960,"bytes":214532,"stampText":"A現場(仮) 2F ・ 田中 ・ 2026-10-07 09:58","kind":"photo|drawing","markers":null }`(削除済みは含めない。**版1.6**: `kind` は常に返す(旧行は `photo`)。`markers` は `kind=drawing` のとき `[{ "itemId":"i9","label":"④-1","x":0.231,"y":0.412 }]`、`photo` では `null`。`x`,`y` は画像の左上を(0,0)・右下を(1,1)とした割合)

**Note** `{ "noteId","itemId":"str|null","kind":"foreman|manager","authorUserId","authorName","authorRole","round","text","source":"submit|verdict|addNote","createdAt" }`

**EventView** `{ "eventId","at","kind","actorUserId","actorName","fromStatus":"str|null","toStatus":"str|null","round":1,"detail":{} }`(`detail` は Events.detail から **`items` キーを除いたもの**)

**RecordDetail** = RecordSummary(masked=false)のキー全て +
```json
{ "items":[ <ItemEntry> ], "primePhotos":[ <PhotoMeta> ], "drawings":[ <PhotoMeta> ], "notes":[ <Note> ], "events":[ <EventView> ],
  "qaComment":"", "stopInfo": { "by":"u_tanaka","byName":"田中","at":"…","reason":"…" },
  "signatures": {
    "foreman": { "userId","name","at" },
    "qa":      { "userId","name","at","verdict":"ok" },
    "prime":   { "recordedBy","recordedByName","signerName","method","at" } },
  "timing": { "selfDeadlineAt":"…|null","qaOpenAt":"…|null","qaDeadlineAt":"…|null","selfLate":false,"qaLate":false } }
```
- **`drawings`(版1.6)**: `kind=drawing` の未削除の行(`takenAt` 昇順、両side)。`items[].self.photos`・`items[].qa.photos`・`primePhotos` には **含めない**(`kind=photo` のみ)。**職長に対しては status が `draft`/`submitted` のとき `side=qa` の図面を含めない**(`qa` の下書き非表示と同じ)。無ければ `[]`。
- `notes` と `events` は時刻昇順。`events` は直近100件。`stopInfo`/`signatures.*` は無ければ `null`。`signatures.foreman`=直近の提出、`signatures.qa`=`qaVerdict=ok` のときのみ、`signatures.prime`=元請サイン記録済みのときのみ。`qaComment` は職長にも `fix`/`qa_ok`/`approved` では返す(`draft`/`submitted` では `""`)。
- 項目は `def.seq` 昇順。`audience=qa` の項目は職長には返さない(`self` 入力不要)。

**Membership** `{ "membershipId","siteId","siteName","userId","userName","userCompany":"str","status","requestedAt","decidedBy":"str|null","decidedByName":"str|null","decidedAt":"dt|null","assignRole":"str|null","team":"str|null","note":"str|null","canDecide":false }`

**Assignment** `{ "assignId","siteId","siteName","userId","userName","assignRole","team","validFrom","validTo":"date|null","active":true,"effective":true,"absentToday":false }`

**Absence** `{ "absenceId","userId","userName","dateFrom","dateTo","reason","registeredBy","registeredByName","createdAt" }`

**Report** `{ "reportId","recordId","version":1,"recordStatus":"qa_ok|approved","url":"https://drive.google.com/file/d/…/view","sha256":"…","generatedBy","generatedByName","generatedAt" }`

**ItemPatch**(`saveDraft`/`saveQaDraft` の `items[]`): `{ "itemId":"i4", "result":"ok|ng|na|null", "severity":"minor|major|null", "values":[2,-1], "note":"…" }`。`itemId` 以外は任意で、**指定したキーだけ更新**(`null` で消去、`values:[]` で消去)。未知のキー・未知の `itemId`・範囲外(`values` は有限数・最大10件、`note` ≤1000文字)は `VALIDATION_FAILED`(`FIELD_INVALID`)。職長は `audience=qa` の項目、QAは `audience=foreman` の項目を書けない。

### 5.1a 書き込み応答の更新後の記録 `data.record` とバージョン規則(版1.10。ユーザー決定 2026-10-17)

目的: 書き込みのあとに画面が `getRecord` を呼び直す往復(1回 1.3〜2.8 秒。休止後の最初はさらに遅い)をなくす。**契約は追加のみ**(既存の列名・action名・エラーコード・action数43・既存キーは変更しない。`record` の中身が RecordSummary から RecordDetail に広がるだけで、RecordDetail は RecordSummary のキーを全て含む(§5.1)ので、古いクライアントは影響を受けない)。

**1. どの応答に何を返すか**(これが正本。表に無い action の応答は変えない)

| action | 応答の `record` | 版1.10 の変更 |
|---|---|---|
| `createRecord` `claimReview` `takeoverReview` | RecordDetail | 変更なし(既に Detail) |
| `submitRecord` `submitVerdict` `recordPrimeSign` | RecordSummary → **RecordDetail** | 型を広げる(`warnings` など他のキーは従来どおり) |
| `stopPour` | RecordSummary / masked 形 → **RecordDetail**(呼出者が他班の職長のときは従来どおり masked 形) | 型を広げる |
| `addNote` | (なし。`note` のみ)→ `note` を残し **`record`: RecordDetail を追加** | キー追加 |
| `uploadPhotoChunk` | (なし)→ **`complete:true` の応答(単発・分割の最終チャンク・既存行の冪等成功)に `record`: RecordDetail を追加**。途中チャンク(`complete:false`)には付けない | キー追加 |
| `saveDraft` `saveQaDraft` `releaseClaim` | RecordSummary | **変更しない**(理由: 画面は応答を待たない/書き込み後に `getRecord` も呼ばない。Detail にすると保存のたびにサーバーの読み込みが増え、次の送信を遅らせる) |
| `deletePhoto` `generateReport` ほか全て | — | 変更しない |

**2. `record` の中身と重さ**
- RecordDetail は `getRecord` と **同じ関数・同じ規則**で作る(可視性・マスク・職長に `qa` を出さない規則など §5.1 と同一。応答用に別の形を作らない)。
- **サムネ・写真本体は含めない**(`PhotoMeta` のみ。`dataUrl`・`thumb`・base64 を含めない)。`events` は直近100件(従来どおり)。
- 作る時点: 通常の更新系は、本処理・Events 追記・冪等キー保存のあと、**ロックを持ったまま**最新の状態から作る(§1.6 の7)。`uploadPhotoChunk` だけは、ロックを短くする決まり(§1.4・§1.6 の7の例外)を守るため、**ロックを解放した後**に読み取りだけで作る(その間に他のリクエストが書き込んでいれば、より新しい版が入ってよい)。
- **`record` を作れなかったとき**(例外・読み込み失敗・呼出者が `canViewDetail` でない場合を含む)は、書き込みの成否を変えない。`submitRecord` `submitVerdict` `recordPrimeSign` `stopPour` は従来の形(RecordSummary / masked 形)で返し、`addNote` `uploadPhotoChunk` は `record` を省く。クライアントは省かれたら従来どおり `getRecord` で取り直す(§8.11.8)。

**3. バージョン規則**
- サーバー: 記録の内容を変える書き込み(項目・写真・図面・コメント・状態・履歴)は、**必ず `Records.version` を+1する**(`touchRecord_`。現行どおり。`addNote`・`uploadPhotoChunk`・`deletePhoto` も含む)。`record.version` は、その応答が表す状態の版。同じ記録の `version` は単調に増える。
- クライアント: 応答の `record` は **`record.version >= キャッシュ中の同じ記録の version` のときだけ**キャッシュ(`records`)に反映する。小さいときは捨てる(遅れて届いた古い応答が、新しい状態を巻き戻さない。並行送信・再送・ポーリングとの競合対策。§8.3-6 と同じ規則)。**捨てても、その操作自体は成功として扱う**(outbox行を削除する、など)。`masked` 形は既存の詳細を上書きしない。端末内の未送信の変更(`drafts`・`outbox`・`photoBlobs`)は別のストアなので `record` の反映で消えない(画面は『サーバーの値+端末の未送信』を重ねて描く。§8.8)。編集中の入力欄は作り直さない。
- `meta.replayed=true`(冪等再生)の応答も同じ規則で扱う。

**4. 冪等キー(`Idem`)との関係**(§5.2 の補足)
- `Idem.responseJson` は従来どおり45,000文字以内。**`record`(RecordDetail)は保存しない**: `submitRecord` `submitVerdict` `recordPrimeSign` `stopPour` は従来の形(RecordSummary / masked 形)で保存し、`addNote` は `{note}` だけを保存する。
- 再生(`replayed:true`)のとき、サーバーは保存済みの応答の `record` を、**再生時点の最新の RecordDetail に差し替えて**返す(`addNote` は `record` を足す。呼出者が `canViewDetail` でなければ保存済みのまま)。したがって **再生の `data` は `record` を除いて初回と同一、`record.version` は初回以上**(C-IDEM-01 の読み替え)。

**5. 互換性**
- 先にサーバー(GAS)を更新しても、先にフロントを更新しても動く(順序の指定なし)。`Config.minClientVersion` は上げない。新しいフロントは、応答に `record` が無い/`items` が無い(古いサーバー・省略)ときだけ従来どおり `getRecord` を呼ぶ。

### 5.2 冪等キー(clientId)の扱い

- **★** 付きaction(§5.4)は `clientId` 必須(無い→`BAD_REQUEST`)。クライアントは「ユーザーの1操作」につき1つ生成し、**同じ操作の再送は必ず同じ `clientId`**。内容を変えて送り直すときは新しい `clientId`。
- サーバー(ロック内): `Idem` に `clientId` があれば:
  - `userId` と `action` と `paramsHash` が一致 → 保存済み `responseJson` を **`meta.replayed=true`** で返す(本処理・Eventsを再実行しない)。
  - 一致しない → `IDEMPOTENCY_CONFLICT`。
  - `paramsHash = hex(SHA-256(canonicalJSON({action, params})))`。canonicalJSON=キーを再帰的に辞書順に並べた最小JSON。`pin`・`clientId` は含めない。
- **成功応答のみ保存**。失敗(エラー)は保存しない(修正後に同じ `clientId` で再送できるようにするため。ただし同じ `clientId` を内容違いで使えない=上記)。
- `RecordDetail` を返す `createRecord` / `claimReview` / `takeoverReview` は `responseJson` を空で保存し、再生時は現在状態から再構築する: `createRecord`=記録が存在し `ownerUserId` が同一なら成功(現在の詳細)/ `claimReview`・`takeoverReview`=現在 `claimedBy` が同一ユーザーかつ `round` 一致なら成功、そうでなければ `ALREADY_CLAIMED` か `STATE_CONFLICT`。
  **版1.10**: `submitRecord` `submitVerdict` `recordPrimeSign` `stopPour` `addNote` の `record` は、`Idem.responseJson` には従来の形(RecordSummary / `{note}`)で保存し、再生時は `record` だけ最新の RecordDetail に差し替えて返す(§5.1a。保存サイズ上限45,000文字を超えさせないため)。
- 冪等キー対象外: `registerDevice`・`adminIssueInvite`(応答に秘密が入る)・写真チャンク(下記)・参照系・本質的に冪等な更新(`setLang`,`logoutDevice`,`adminUnlockUser`,`adminSetUserStatus`,`adminRevokeDevice`,`adminCancelAbsence`)。
- `uploadPhotoChunk` の冪等性は **`photoId` 単位**: ①`Photos` に同じ `photoId` の行が既にあれば(`deleted` の値に関わらず)新しい行・新しいDriveファイルを残さず成功(`complete:true`、既存の `photo`)を返す。同時に届いた同一 `photoId` の再送も、ロック内の再確認で1行だけになる(§5.4.4)。②分割モードの途中チャンクは `(photoId, index)` で上書き。
- `Idem` は30日で削除。オフラインで30日を超えて滞留した outbox 行は送信も再送もせず、利用者が内容を確認して「破棄」のみできる(§8.5)。

### 5.3 エラーコード一覧(統一形式 `{ok:false,error:{code,message,data?}}`)

| code | 意味 | 再試行 | `error.data` |
|---|---|---|---|
| BAD_REQUEST | 封筒・型・未知action・★で`clientId`欠落 | × | |
| CLIENT_OUTDATED | `appVersion` < `minClientVersion` | × | `{minClientVersion}` |
| UNAUTHENTICATED | トークンなし/不正 | × | |
| DEVICE_REVOKED | 端末登録解除済み | × | |
| USER_LOCKED | PIN5回誤りでロック中 | × | |
| USER_DISABLED | アカウント停止 | × | |
| PIN_REQUIRED | PIN必須actionで `pin` なし/形式不正 | × | |
| PIN_INVALID | PIN誤り(4回目まで) | × | `{remaining}` |
| INVITE_REQUIRED | 未設定ユーザーに招待コードなし | × | |
| INVITE_INVALID | 招待コード誤り/該当なし/使用済み | × | |
| INVITE_EXPIRED | 招待コード期限切れ | × | |
| RATE_LIMITED | 招待コードの失敗が多すぎる(版1.7。サーバー全体の窓) | ○(待てば解消) | `{retryAfterSec}` |
| FORBIDDEN_ROLE | 役割が許されない | × | |
| FORBIDDEN_SITE | その現場に担当がない | × | |
| FORBIDDEN_TEAM | 他班の記録/他人の写真 | × | |
| NOT_FOUND | 対象IDなし(権限がなく存在を隠す場合も含む) | × | |
| VALIDATION_FAILED | 入力不備 | × | `{violations:[{rule,itemId?,path?}]}`(§5.3.1) |
| STATE_CONFLICT | 遷移できない状態/`round`不一致/打設を止められない段階の記録(出来形への `stopPour`。版1.9) | × | `{status,round}` |
| RECORD_LOCKED | 編集不可の状態(提出後等) | × | `{status}` |
| ALREADY_EXISTS | 同一スロットの記録が既にある | × | `{recordId,mine}` |
| ALREADY_CLAIMED | 先に確認中にされた | × | `{claimedBy,claimedByName,claimedAt}` |
| NOT_CLAIMER | claim者ではない | × | `{claimedBy,claimedByName}` |
| NOT_CLAIMED | 未claimで操作しようとした | × | |
| TAKEOVER_NOT_ALLOWED | 引き継ぎ条件未達 | × | `{availableAt}` |
| STAGE_NOT_ENABLED | 未有効の段階(`Config.enabledStages` に無い値・列挙外の値・その段階の有効項目が0件のときを含む。版1.9) | × | |
| SITE_CLOSED | 閉鎖現場 | × | |
| PHOTO_INVALID | 画像形式・ハッシュ・サムネ不備、`data` 文字数が上限超過(単発=`photoSingleMaxChars`、分割=`photoChunkChars`)、base64不正、デコード後バイト数と `bytes` の不一致、既存の同一 `photoId` と内容(`recordId`/`itemId`/`side`/`sha256`)または撮影者(`takenBy`)が食い違う | × | |
| PHOTO_LIMIT | 項目あたり上限超過(ロック内で確定判定する) | × | `{max}` |
| PHOTO_TOO_LARGE | バイト数超過 | × | `{max}` |
| CHUNK_MISSING | **分割モードの**最終チャンク時に欠けがある/キャッシュ失効(単発モードでは発生しない) | **写真を0から再送** | `{missing:[index]}` |
| JOIN_KEY_INVALID | QAの合言葉が違う | × | |
| ALREADY_MEMBER | 既に参加済み | × | |
| JOIN_PENDING | 申請中 | × | `{membershipId}` |
| REPORT_NOT_ALLOWED | PDF生成不可の状態 | × | `{status}` |
| IDEMPOTENCY_CONFLICT | 同一clientIdで内容違い | × | |
| LOCK_TIMEOUT | ロック待ちタイムアウト | ○(バックオフ) | |
| DRIVE_ERROR | Drive書込失敗 | ○ | |
| INTERNAL | 想定外 | ○ | |

#### 5.3.1 VALIDATION_FAILED の `violations[].rule` 一覧
| rule | 意味 | 付随 |
|---|---|---|
| FIELD_INVALID | 型・範囲・列挙値・未知キー | `path` |
| ANSWER_MISSING | 結果が未入力 | `itemId` |
| PHOTO_REQUIRED | 写真が必要(**職長提出 `submitRecord` のみ**。`selfResult=ng`、または `key` 項目の `selfResult=ok`)。**`submitVerdict`(QA側)では出さない**(版1.5.1) | `itemId` |
| NOTE_REQUIRED | NGにコメントがない(職長=`foremanNote`、QA=`qaNote`) | `itemId` |
| SEVERITY_REQUIRED | QAのNGに重さがない(`submitVerdict`) | `itemId` |
| MEASURE_REQUIRED | `measure=required` で測定点数が `minMeasures` 未満(`na`は除く) | `itemId` |
| MEASURE_OVER_TOL_OK | `|値|の最大 > tol` なのに `ok`(**職長提出 `submitRecord` のみ**。`submitVerdict`(管理者側)では出さない=版1.11.1。管理者は許容超に `ok` を付けられる) | `itemId` |
| QA_OVER_TOL_COMMENT_REQUIRED | 管理者の `qaResult=ok` の項目で、`qaValues` に許容超の値があるのに `qaNote` が空(trim後)(**`submitVerdict` のみ**。版1.11.1。ユーザー決定 2026-10-20。条件は下の「検査ルール(QA判定)」) | `itemId` |
| POUR_PLAN_REQUIRED | 提出時に打設予定日時がない(`stage=pre_pour`) | |
| VERDICT_OK_WITH_NG | `ok` 判定なのにQA入力にNGがある | |
| VERDICT_NEEDS_NG | `minor`/`major` 判定なのにQA入力にNGがない | |
| VERDICT_MAJOR_NEEDS_MAJOR_ITEM | `major` 判定なのに `severity=major` のNG項目がない | |
| VERDICT_MINOR_HAS_MAJOR_ITEM | `minor` 判定なのに `severity=major` のNG項目がある | |
| COMMENT_REQUIRED | `minor`/`major` 判定に総合コメントがない(`comment` 未指定なら保存済み `qaComment` を使い、両方空のとき。≤2000文字) | |
| PRIME_SIGNER_REQUIRED | 元請担当者名が空 | |
| REASON_REQUIRED | 停止理由・取消理由が空 | |

サーバーは違反を **全て列挙して返す**(最初の1件で止めない)。クライアントも同じrule名で事前検証し、同じ辞書キー `rule.<RULE>` で表示する(§9)。

検査ルールの定義(職長提出 `submitRecord`):
- 対象=`audience∈{both,foreman}` の全項目。各項目に `selfResult` が必要(`ANSWER_MISSING`)。
- `selfResult=ng` → 写真(side=self・未削除)≥1(`PHOTO_REQUIRED`)かつ `foremanNote` が空白のみでない(`NOTE_REQUIRED`)。
- `selfResult=ok` かつ `def.key=TRUE` → 写真≥1(`PHOTO_REQUIRED`)。`na` は写真不要。
- `measure=required` かつ `selfResult≠na` → `selfValues` の件数 ≥ `minMeasures`(`MEASURE_REQUIRED`)。
- `tol` があり `selfValues` に値があり `max(abs)>tol` で `selfResult=ok` → `MEASURE_OVER_TOL_OK`(`ng` にするか値を直す)。**職長側は版1.11.1 でも変更なし**(職長は許容超に `ok` を付けて提出できない。ユーザーが変えたのは管理者側だけ)。
- `stage=pre_pour` は `pourPlannedAt` 必須(`POUR_PLAN_REQUIRED`。P-06)。

検査ルール(QA判定 `submitVerdict`):
- 対象=`audience∈{both,qa}` の全項目に `qaResult` が必要(`ANSWER_MISSING`)。**QA欄の事前入力はしない**(P-12)。
- `qaResult=ng` → `qaNote`非空(`NOTE_REQUIRED`)・`qaSeverity` 必須(`SEVERITY_REQUIRED`)。**QA側は写真を必須にしない**(版1.5.1。ユーザー決定: 管理者の確認では写真は任意。`PHOTO_REQUIRED` を出さない。`qaResult=ng` でも `key` 項目の `qaResult=ok` でも、side=qa の写真が0枚で通る)。QA側でも写真の撮影・添付・削除(`uploadPhotoChunk` の `side=qa`、`deletePhoto`)は従来どおり可能(任意)。測定点数(`MEASURE_REQUIRED`)は職長側と同じルール(`qaValues` で判定)。
- **許容超の `ok`(版1.11.1。ユーザー決定 2026-10-20)**: 管理者は許容を超えた実測値の項目にも `qaResult=ok` を付けられる(**管理者側では `MEASURE_OVER_TOL_OK` を出さない**)。ただし次の4つを**すべて**満たす項目は、`qaNote`(管理者の項目コメント)が **trim後に空でないこと**が必須。空なら `VALIDATION_FAILED` の `violations` に `{rule:"QA_OVER_TOL_COMMENT_REQUIRED", itemId}` を入れる(他の違反と一緒に全て列挙する。**新しいエラーコードは作らない**。`VALIDATION_FAILED` + `violations[].rule` で足りる)。
  1. `audience∈{both,qa}`(QA側の検査対象)
  2. `qaResult=ok`
  3. `snapshot.tol` が有限の数で **0 より大きい**(許容なし・0・負は対象外。§10.2d-1)
  4. `qaValues` の有効値(§10.2d-1。数値にできるもの)に **`|値| > tol`**(厳密に大きい)が1つ以上ある。`|値|=tol` は許容内=対象外。小数は丸めずに比較する
  - **見るのは管理者側だけ**: 判定は `qaValues` と `qaNote` による。**職長の `selfValues`・`foremanNote` は見ない・書き換えない**(職長コメントと管理者コメントは別フィールドのまま。CLAUDE.md §3)。`qaValues` が空で職長の値だけが許容超でも、この規則の対象ではない。
  - **コメントの出どころ**: `submitVerdict` は項目コメントを `params` で受けない。判定には、直前までに `saveQaDraft` で保存済みの `qaNote` を使う。「空」の定義は `NOTE_REQUIRED` と同じ(空白のみ=全角空白を含む=空。`String.prototype.trim()` 相当)。内容の良し悪しは検査しない。上限は従来どおり1000文字。
  - **`ng`・`na` は従来どおり**: `qaResult=ng` は `NOTE_REQUIRED`(許容超でも新ruleは重ねて出さない)、`qaResult=na` は何も要求しない。
  - **総合判定に依らない**: `verdict` が `ok`/`minor`/`major` のどれでも、`ok` を付けた許容超の項目があれば検査する(軽微・重大で差し戻すときでも、`ok` のまま残る許容超の項目にはコメントが要る)。総合コメント(`comment`/`qaComment`)で代用はできない。
  - **`saveQaDraft` では検査しない**(下書きは空のコメントでも `ok` でも保存できる)。検査は `submitVerdict` だけ。
  - 通ったあとの扱いは従来どおり: 空でない `qaNote` は Notes に `kind=manager, source=verdict` で追記される。Events `verdict_*` の `detail`・応答の形は変えない。元請PDFの表示は §10.2d-9(許容超でも `ok` の行は赤背景にしない。▲は出る。管理者コメント列に理由が出る)。
- 写真必須は職長の自己点検(`submitRecord`)のみ。
- 判定の整合: `ok` ⇒ QA入力に `ng` なし(`VERDICT_OK_WITH_NG`)/ `minor` ⇒ `ng` ≥1 かつ `severity=major` なし / `major` ⇒ `severity=major` の `ng` ≥1 / `minor`・`major` ⇒ 総合コメント必須(`comment` があればそれ、未指定なら `saveQaDraft` 保存済みの `qaComment`。両方空なら `COMMENT_REQUIRED`)。
- 合否は人が決める: サーバーは上記の **整合性検査のみ**行い、判定を自動決定しない。UIの「提案」表示は画面側の補助(§9)。

### 5.4 action 一覧(リクエストの `params` とレスポンスの `data`)

**契約外のキー禁止**: `params` に表に無いキーがあれば `BAD_REQUEST`(役割・ユーザーIDなどを偽装して送る余地を作らない)。`params` の必須キー欠落・型違反は `VALIDATION_FAILED`(`FIELD_INVALID`、`path` にキー名)。

表の記号: **★**=`clientId`必須 / **PIN**=封筒`pin`必須 / **Q**=オフラインキュー対象(§8)。エラーは「共通エラー」(UNAUTHENTICATED, DEVICE_REVOKED, USER_LOCKED, USER_DISABLED, FORBIDDEN_ROLE, BAD_REQUEST, CLIENT_OUTDATED, LOCK_TIMEOUT, INTERNAL)に加えて個別に列挙したもの。

#### 5.4.1 公開

**ping**(GET/POST) params `{}` → `{ "apiVersion":1, "schemaVersion":"1", "serverTime":"…" }`

**lookupInvite**(公開) params `{ "inviteCode":"6桁" }` → `{ "name", "company":"", "purpose":"first|pinReset" }`
エラー: `VALIDATION_FAILED`(6桁でない)/ `INVITE_INVALID` / `INVITE_EXPIRED` / `RATE_LIMITED`。コードは使用済みにしない。

**registerDevice**(公開) params `{ "inviteCode", "pin", "company"?(≤40文字), "deviceLabel"?, "platform"?, "appVersion"? }`。`purpose=first` で `company` が空かつ名簿の `company` も空なら `VALIDATION_FAILED`(`violations:[{rule:"FIELD_INVALID",path:"company"}]`。コードは消費しない)。40文字超も同じ。`company` があれば `Users.company` を更新する → `{ "deviceId", "deviceToken", "user": <Me> }`
エラー: `VALIDATION_FAILED`(inviteCode・pin形式)/ `INVITE_INVALID`(停止・ロック中のユーザーのコードも同じ)/ `INVITE_EXPIRED` / `RATE_LIMITED`。
例:
```json
// request
{"v":1,"action":"registerDevice","appVersion":"1.0.0","params":{"inviteCode":"482913","pin":"1111","deviceLabel":"Pixel 7","platform":"android"}}
// response
{"ok":true,"data":{"deviceId":"d_a1b2c3d4e5f6","deviceToken":"d_a1b2c3d4e5f6.0f1e2d3c4b5a69788796a5b4c3d2e1f00112233445566778","user":{"userId":"u_tanaka","name":"田中","role":"foreman","status":"active","lang":"ja","email":null}},"meta":{"serverTime":"2026-10-07T08:00:00+09:00","replayed":false,"apiVersion":1}}
```

#### 5.4.2 セッション・マスタ

**me** `{}` → `{ "user":<Me>, "device":{"deviceId","label"}, "serverTime" }`(ロック中でも応答する)

**setLang** `{ "lang":"ja|id" }` → `{ "lang" }`

**changePin** ★ PIN(現在のPIN) `{ "newPin":"4桁" }` → `{ "changed":true }`。誤りは §3.4 のカウンタ対象。`pinSalt` 再生成。Events `pin_changed`。

**logoutDevice** `{}` → `{ "loggedOut":true }`

**getBootstrap** `{}` → `{ "user":<Me>, "sites":[<Site>], "items":[<Item>], "itemsHash":"<Itemsのactive行のSHA-256 hex>", "config":{ …公開設定 }, "serverTime" }`
公開設定 `config` のキー(値は §2.14 の型。`photoParallel` のクライアント側の解釈は §8.4-0): `escalationMin1, escalationMin2, claimTakeoverMin, selfDeadlineHour, qaOpenHour, qaLeadMinutes, photoMaxEdge, photoJpegQuality, photoThumbEdge, photoMaxPerItem, photoChunkChars, photoSingleMaxChars, photoParallel, photoMaxBytes, enabledStages, pollIntervalSec, pinMaxFail, minClientVersion`。
`sites` は見える現場のみ(職長/QA=有効担当あり、責任者=全て。`closed` も含む)。
`items` は `active=TRUE` かつ `enabledStages` に含まれる段階の項目(**版1.9 の既定では36項目=打設前28+出来形8**。`seq` 昇順で段階が混ざる)。`itemsHash` もその全体から計算する。クライアントは記録(または作ろうとしている記録)の `stage` で絞る。

#### 5.4.3 記録

**listRecords** `{ "siteId"?, "statuses"?:["submitted","fix"], "since"?:"dt", "limit"?:100, "cursor"?:"str" }` → `{ "records":[<RecordSummary|masked>], "nextCursor":"str|null", "serverTime" }`
- 並び: `updatedAt` 降順、同値は `recordId` 昇順。`limit` 1〜200(既定100)。`cursor` は不透明文字列(実装は件数オフセット可)。`since`=`updatedAt > since`(厳密に大きい)。クライアントは前回応答の `serverTime` の5秒前を `since` に使い、重複はIDで排除する。
- `siteId` を指定して見えない現場なら `FORBIDDEN_SITE`。未指定は見える現場全部。
- エラー: `FORBIDDEN_SITE` / `VALIDATION_FAILED`。

**getRecord** `{ "recordId" }` → `{ "record":<RecordDetail> }`。エラー: `NOT_FOUND` / `FORBIDDEN_SITE` / `FORBIDDEN_TEAM`(masked対象の詳細要求)。

**createRecord** ★ Q `{ "recordId", "siteId", "floor", "zone"?:"", "lot", "stage":"pre_pour|post_demold", "pourPlannedAt"?:"dt", "reinspectOf"?:"r_…" }` → `{ "record":<RecordDetail> }`(status=draft, round=1, `ownerUserId`=自分, `team`=自分の当該現場の班。項目行を作成時点の `active` かつ `stage` 一致の項目で生成)
エラー: `FORBIDDEN_SITE` / `SITE_CLOSED` / `STAGE_NOT_ENABLED` / `VALIDATION_FAILED`(`FIELD_INVALID`:floor/zone/lot/recordId形式) / `ALREADY_EXISTS`(`{recordId,mine}`。同一 `recordId` を同一ユーザーが再送した場合は冪等成功として扱う)/ **`STATE_CONFLICT`(`reinspectOf` を指定したが元記録の `status` が `approved` でない。`error.data={status,round}` は元記録の値。P-31)**。Events `record_created`。
- **`stage`(版1.9)**: §0.2 の値。`Config.enabledStages` に無い値(`during_pour` 等・列挙外を含む)、またはその段階の `active` 項目が0件のときは `STAGE_NOT_ENABLED`(項目0件の記録を作らせない)。`pre_pour` と `post_demold` は、同じ現場・階・工区・ロットでも別の記録として1件ずつ作れる(§2.7。`ALREADY_EXISTS` は同じ段階の2件目だけ)。
- **`pourPlannedAt`**: `stage=pre_pour` のときだけ保存する。`post_demold` で指定されても **エラーにせず保存しない**(空のまま。オフライン再送の古い内容を落とさないため)。`saveDraft` の `header.pourPlannedAt` も同じ。
例:
```json
{"v":1,"action":"createRecord","clientId":"c_0a1b2c3d4e5f6a7b8c9d","deviceToken":"…","appVersion":"1.0.0",
 "params":{"recordId":"r_8k2m4n6p8q0s2u4w","siteId":"s_a","floor":"2F","zone":"","lot":"L1","stage":"pre_pour","pourPlannedAt":"2026-10-08T09:00:00+09:00"}}
```
出来形の例(`pourPlannedAt` は送らない):
```json
{"v":1,"action":"createRecord","clientId":"c_0a1b2c3d4e5f6a7b8c9e","deviceToken":"…","appVersion":"1.0.0",
 "params":{"recordId":"r_9k3m5n7p9q1s3u5w","siteId":"s_a","floor":"2F","zone":"","lot":"L1","stage":"post_demold"}}
```

**saveDraft** ★ Q `{ "recordId", "header"?:{ "lot"?, "zone"?, "pourPlannedAt"?:"dt|null" }, "items"?:[<ItemPatch>] }` → `{ "record":<RecordSummary> }`
- status∈{draft,fix}・編集権限(§4.1)。**部分更新**(指定した項目・キーのみ)。`siteId/floor/stage/recordId` は変更不可(指定→`BAD_REQUEST`)。`header.pourPlannedAt` は `stage=pre_pour` の記録だけ保存し、出来形では指定されても保存しない(エラーにしない。§6.8)。完全性は検査しない(形式のみ)。
- 同一項目への書込は後勝ち(項目×列単位)。`selfUpdatedAt` を更新、`Records.updatedAt`/`version` を+1。Eventsには記録しない。
- エラー: `NOT_FOUND` / `FORBIDDEN_SITE` / `FORBIDDEN_TEAM` / `RECORD_LOCKED`(`{status}`)/ `VALIDATION_FAILED`。
例(items は変更分だけ):
```json
"params":{"recordId":"r_8k2m4n6p8q0s2u4w","items":[
  {"itemId":"i4","result":"ok","values":[2,-1]},
  {"itemId":"i9","result":"ng","note":"控えが1箇所不足"}]}
```

**submitRecord** ★ PIN `{ "recordId", "round" }` → `{ "record":<RecordDetail>, "warnings":["SELF_LATE"?] }`
- status∈{draft,fix} かつ `round` 一致 → §5.3.1 の提出検査を **全て満たす**こと。成功: draft→submitted(初回)/ fix→submitted(再提出。`round+1`、`qa*` 列とQA判定列(`qaVerdict,qaVerdictBy,qaVerdictAt,qaComment,major`)・`claim*`・`stopped*`・`prime*` を空にし `escNotified=0`)。`submittedBy/At`=自分/今。初回は `firstSubmittedAt`。
- 職長の項目コメント(空でないもの)を Notes に `kind=foreman, source=submit` で追記(提出ごと)。Events `submitted`/`resubmitted`(detail に項目結果。`late`)。
- `warnings`: `SELF_LATE`(§6.5 の職長期限超過。提出は拒否しない。`stage=pre_pour` のみ。出来形では出ない)。
- エラー: `NOT_FOUND`/`FORBIDDEN_SITE`/`FORBIDDEN_TEAM`/`STATE_CONFLICT`/`VALIDATION_FAILED`(violations全列挙)/`PIN_REQUIRED`/`PIN_INVALID`/`USER_LOCKED`。
- クライアントは提出前に、その記録のoutboxが空(全て送信済み)であることを確認する(§8.6)。

**claimReview** ★ `{ "recordId", "round" }` → `{ "record":<RecordDetail> }`(「確認中」にする。status は `submitted` のまま。`claimedBy/At`=自分/今、`qaDraftAt`=今。先着のみ成功)
- エラー: `FORBIDDEN_SITE` / `STATE_CONFLICT`(submittedでない・round不一致)/ **`ALREADY_CLAIMED`**(`{claimedBy,claimedByName,claimedAt}`)。Events `claimed`。

**releaseClaim** ★ `{ "recordId" }` → `{ "record":<RecordSummary> }`(claim解除。QA下書きは残る)。claim者本人か責任者。エラー: `NOT_CLAIMED` / `NOT_CLAIMER` / `STATE_CONFLICT`。Events `claim_released`。

**takeoverReview** ★ `{ "recordId", "round" }` → `{ "record":<RecordDetail> }`(claimを自分に移す。QA下書きは残る)。条件は §4.1。エラー: `NOT_CLAIMED` / `TAKEOVER_NOT_ALLOWED`(`{availableAt}`)/ `STATE_CONFLICT`。Events `claim_taken_over`(detail `{from}`)。

**saveQaDraft** ★ Q `{ "recordId", "items"?:[<ItemPatch>], "comment"?:"str" }` → `{ "record":<RecordSummary> }`(status=submitted かつ claim者本人。`qa*` 列と `Records.qaComment` を更新。`qaDraftAt`=今。版1.11.1: 許容超の `ok` でコメントが空でも保存できる=`QA_OVER_TOL_COMMENT_REQUIRED` は `submitVerdict` だけで検査する)。エラー: `NOT_CLAIMER` / `NOT_CLAIMED` / `RECORD_LOCKED`(submittedでない)/ `VALIDATION_FAILED`。

**submitVerdict** ★ PIN(`verdict=ok`のみ) `{ "recordId", "round", "verdict":"ok|minor|major", "comment"?:"str" }`(総合コメントの決め方: **`comment` が未指定(キー無し/`null`)なら `saveQaDraft` で保存済みの `Records.qaComment` を使う**。指定されていればその値を使う。採用した値(空白のみは空とみなす)が空で `verdict` が `minor`/`major` なら `COMMENT_REQUIRED`。≤2000文字) → `{ "record":<RecordDetail>, "warnings":["QA_BEFORE_OPEN"?, "QA_LATE"?] }`
- claim者本人・status=submitted・`round`一致。§5.3.1 の判定検査を全て満たす(版1.11.1: 項目検査に `QA_OVER_TOL_COMMENT_REQUIRED` を含む)。成功:
  - `ok` → status=`qa_ok`、`qaVerdict=ok`、`major=FALSE`。
  - `minor` → status=`fix`、`qaVerdict=minor`、`major=FALSE`。
  - `major` → status=`fix`、`qaVerdict=major`、`major=TRUE`(**重大不適合=打設不可**。出来形の記録では「承認に進めない(差し戻し)」の意味で、状態の動きは同じ。§6.8)。責任者へ即時通知(§6.6)。
  - 共通: `qaVerdictBy/At`=自分/今、`qaComment`=採用した総合コメント(上記。`comment` 指定があればその値、なければ保存済みの値)、`claimedBy/At` は `ok` では残し(判定者の記録)、`minor`/`major` では空にする。QAの項目コメント(空でないもの)と総合コメント(採用した値)を Notes に `kind=manager, source=verdict` で追記。Events `verdict_*`(detail に項目結果)。
- `warnings`: `QA_BEFORE_OPEN`(§6.5の検査開始前)/ `QA_LATE`(§6.5のQA期限超過)。いずれも拒否しない。`stage=pre_pour` のみで、出来形では出ない。
- エラー: `NOT_CLAIMER`/`NOT_CLAIMED`/`STATE_CONFLICT`/`VALIDATION_FAILED`/`PIN_REQUIRED`/`PIN_INVALID`/`USER_LOCKED`。

**recordPrimeSign** ★ PIN `{ "recordId", "signerName", "method":"paper|pdf|onsite", "evidencePhotoId"?:"p_…" }` → `{ "record":<RecordDetail> }`
- status=`qa_ok` のみ。**3者サイン検査**: 職長提出(`submittedAt`あり)・`qaVerdict=ok`・`signerName` 非空(≤40文字。`PRIME_SIGNER_REQUIRED`)が揃っていること。成功: status=`approved`(**打設可**。出来形の記録では **出来形確認済**。状態の値はどちらも `approved`。§6.8)、`primeSignedBy/At/SignerName/Method` を記録。`evidencePhotoId` を渡す場合は同記録の `side=prime` の写真であること。Events `prime_signed`。
- エラー: `STATE_CONFLICT` / `VALIDATION_FAILED` / `PIN_*` / `FORBIDDEN_SITE`。

**stopPour** ★ Q(高優先) `{ "recordId", "reason":"≤200文字" }` → `{ "record":<RecordDetail> }`
- **対象の段階(版1.9)**: `stage=pre_pour` の記録のみ。`post_demold`(出来形)の記録に送ると `STATE_CONFLICT`(`error.data={status,round}`。状態・Events・通知は何も変えない)。出来形は打設の後の検査で、打設を止める意味がないため。
- **異常時は誰でも止められる**: その現場の有効な担当者(職長は班を問わず)または責任者。status∈{submitted,qa_ok,approved} のとき → status=`fix`、`stopped=TRUE`、`stoppedBy/At/Reason`。**3者サインを無効化**(`prime*`・判定列・`claim*` を空に。履歴は Events/Notes に残る)。`draft`/`fix` の記録には不要(`STATE_CONFLICT`)。
- **他班(`masked`)の記録でも実行できる**(班スコープを適用しない §4.2)。ただし呼出者が他班の職長のとき、応答の `record` は masked 形(§5.1)で、停止理由・項目・コメント等は返さない。`getRecord` は従来どおり `FORBIDDEN_TEAM`。
- Events `stopped`(detail `{reason,previousStatus}`)。責任者・担当QAへ通知(§6.6)。再開は職長が是正→再提出→再度QA/元請の手順(§6.2 T8)。
- エラー: `STATE_CONFLICT` / `VALIDATION_FAILED`(`REASON_REQUIRED`)/ `FORBIDDEN_SITE`。

**addNote** ★ Q `{ "recordId", "itemId"?:"i9", "text":"1〜2000文字" }` → `{ "note":<Note>, "record":<RecordDetail> }`(職長なら `kind=foreman`、QA/責任者なら `kind=manager` をサーバーが役割から決める。**クライアントは kind を送れない**)。Notes に追記(更新・削除不可)、Events `note_added`。職長は status∈{draft,fix} の自班記録のみ(`RECORD_LOCKED`)。エラー: `NOT_FOUND` / `FORBIDDEN_*` / `RECORD_LOCKED` / `VALIDATION_FAILED`。

#### 5.4.4 写真(詳細は §7)

**uploadPhotoChunk** Q(`clientId`なし。冪等性は `photoId` 単位。§5.2)
params:
```json
{ "photoId":"p_1a2b3c4d5e6f7a8b", "recordId":"r_…", "itemId":"i9", "side":"self",
  "index":0, "total":1, "mime":"image/jpeg", "data":"<base64。単発=本体全体(≤photoSingleMaxChars)/分割=一部(≤photoChunkChars)>",
  "thumb":"<base64。index=0のときのみ必須>",
  "takenAt":"2026-10-07T09:58:12+09:00", "width":1280, "height":960,
  "bytes":214532, "sha256":"<本体全体のSHA-256 hex>", "stampText":"A現場(仮) 2F ・ 田中 ・ 2026-10-07 09:58",
  "kind":"photo", "markers":null }
```
- **`kind` / `markers`(版1.6。省略可。省略は `kind="photo"`・`markers=null`)**: `kind="drawing"`(図面。§7.7)のとき、`itemId` は **空または省略**(値があれば `FIELD_INVALID`、path=`itemId`)、`side` は `self`/`qa` のみ(`prime` は `FIELD_INVALID`、path=`side`)、`markers` は **配列(0〜60件)**。各要素は `{ "itemId","label","x","y" }`: `itemId` はその記録の項目で `audience` が `side` に合うもの、`label` は1〜8文字の文字列、`x`・`y` は 0 以上 1 以下の数。1つでも不正なら `VALIDATION_FAILED`(`FIELD_INVALID`、path=`markers`)。`kind="drawing"` で `markers` が配列でない(null・省略を含む)ときも同じ。**評価順**: 他のactionと同じく §4.2 の `authorize`(役割・状態)が入力検証より先に効く(例: 職長が `side=prime` を送ると `FORBIDDEN_ROLE`。`FIELD_INVALID`(path=`side`)になるのは `qa_ok` の記録に対する担当QAのときだけ)。`kind="photo"` で `markers` が null/省略以外なら `FIELD_INVALID`(path=`markers`)、`kind` が `photo`/`drawing` 以外も同じ(path=`kind`)。`markers` は `Photos.markers`(json)にそのまま保存する(`itemId`/`label`/`x`/`y` 以外のキーは捨てる)。
- **図面の上限(版1.6)**: 記録×side あたり未削除の図面は **5枚まで**(固定値。Config にしない)。超えるとき `PHOTO_LIMIT`(`{max:5}`)。図面は `photoMaxPerItem` の数に **含めない**(項目の写真枚数にも数えない)。逆に、検査写真は図面の数に含めない。
- 図面も **本体 `bytes` ≤ `photoMaxBytes`**・JPEG・SHA-256・サムネ(§7.3 の検査)は検査写真と同じ。冪等性は `photoId` 単位(既存行の一致条件に `kind` も加える。不一致は `PHOTO_INVALID`)。Driveのファイル名は `{recordId}_drawing_{side}_{photoId}.jpg`。
- **モード**(版1.4): **単発モード** = `total=1` かつ `index=0`。1リクエストで検証・組立・Drive保存・`Photos` 追記まで完了し `complete:true` を返す(CacheServiceを使わない)。`thumb` は同じリクエストに含める(`index===0` のとき必須、という従来の規則のまま)。**分割モード** = `total` 2〜12(後方互換。従来どおり)。`total=1` で `index≠0`、`index>=total`、`total` が1〜12の整数でない → `VALIDATION_FAILED`(`FIELD_INVALID`、`path`=`index`/`total`)。
- クライアントの選び方は §7.3(base64長 ≤ `photoSingleMaxChars` なら必ず単発。超える場合と旧サーバーのときだけ分割)。サーバーはどちらのモードも受理する(クライアントが選ぶ)。
- メタ(`takenAt`〜`stampText`)は **全リクエスト(全チャンク)に付ける**(サーバーはステートレスに検査できる)。分割モードのチャンクは **index昇順に1つずつ**送る。
- **応答**: 単発 → `{ "photoId", "received":[0], "complete":true, "photo":<PhotoMeta> }`。分割の途中チャンク → `{ "photoId", "received":[0,1], "complete":false }`(`received` はCacheに存在するindex昇順)。分割の最終チャンク(`index=total-1`)で全チャンクが揃っていれば組み立て → 以降は単発と同じ → `{ "photoId", "received":[0,1,2], "complete":true, "photo":<PhotoMeta> }`。
  **版1.10**: `complete:true` の応答には §5.1a の `record`(RecordDetail)を加える(`complete:false` の途中チャンクには付けない)。
- **入力検証と順序**(すべて **ロックの外**。§4.2 の評価順どおり、`authorize` を通ってから行う。最初に失敗したもので返す):
  1. `data` の文字数 > 上限(単発=`photoSingleMaxChars`、分割=`photoChunkChars`)、文字数が4の倍数でない、base64でない文字を含む → `PHOTO_INVALID`。
  2. 申告 `bytes` > `photoMaxBytes` → `PHOTO_TOO_LARGE`(`{max}`。デコード前に判定してよい)。
  3. (単発、または分割の最終組立後)デコード後バイト数 ≠ `bytes` → `PHOTO_INVALID`。デコード後バイト数 > `photoMaxBytes` → `PHOTO_TOO_LARGE`。
  4. 先頭が JPEG マジック `FF D8` でない → `PHOTO_INVALID`。
  5. SHA-256 が `sha256` と不一致 → `PHOTO_INVALID`。
  6. `thumb` の欠落・base64不正・先頭が `FF D8` でない・文字数が `Config.photoThumbMaxChars`(既定100000)を超える → `PHOTO_INVALID`。
  7. `takenAt` の補正(§7.5)。
  上限超過・不正のとき **Driveには何も書かない**(検証はDrive保存より前)。
- **ロック内の処理**(Drive保存の後。`waitLock(20000)`、取れなければ `LOCK_TIMEOUT` で、作ったDriveファイルは削除する):
  1. **再認証**: 端末(`Devices`)・ユーザー状態・`authorize()`(記録の存在・班・`status`/`claim` の状態を含む)を、ロック外の読み取り結果を使い回さず **最新のシート**で再評価する。失敗ならそのエラー(`RECORD_LOCKED`/`NOT_CLAIMER`/`STATE_CONFLICT`/`NOT_FOUND`/`FORBIDDEN_*`/`USER_*`/`DEVICE_REVOKED`)。
  2. **既存行の確認**: `Photos` に同じ `photoId` があれば、`recordId`/`itemId`/`side`/`sha256` の4項目が一致し、かつ既存行の `takenBy` が認証済みユーザーと同一の場合だけ **新しい行を作らず** 既存行の `PhotoMeta` で成功(`complete:true`)。1つでも一致しなければ `PHOTO_INVALID`(他ユーザーの `photoId` を指定しても成功応答は得られず、存在も示さない)。**既存行が参照するDriveファイルは絶対に削除しない**。
  3. **上限確認**: 項目×sideの未削除写真数 ≥ `photoMaxPerItem`(`side=prime` は記録×primeあたり)→ `PHOTO_LIMIT`(`{max}`)。ロック外で事前に数えて早期に `PHOTO_LIMIT` にしてもよいが、確定判定はここ。
  4. **`Photos` 行の追記**: `round` = ここで読んだ `Records.round`、`receivedAt` = ここでの現在時刻、`takenBy` = 認証済みユーザー。
  5. **touch**: `Records.updatedAt` = 現在時刻、`Records.version` + 1(`saveDraft` と同じ扱い。Eventsには残さない。一覧のポーリング `since` に出すため)。
  6. `Sites.driveFolderId` が空で、ロック外で現場フォルダを特定・作成してあれば、ここで書く(書いたら参照キャッシュの `Sites` を破棄。§2.15)。
- **Driveファイルの後始末(孤児を作らない)**: ロック外で作った本体とサムネは、ロック内の1〜3で成功しなかった全経路(エラー応答・例外・`LOCK_TIMEOUT`・手順2の冪等成功)で、応答を返す前に `setTrashed(true)`(ゴミ箱)にする。削除の失敗は握りつぶしてよい(主処理の結果を優先。ログにファイルIDのみ)。本体の保存に成功しサムネの保存に失敗したときは `DRIVE_ERROR` とし、保存済みの本体も削除する。
- **同一 `photoId` の並行・再送**: 同時に複数届いても `Photos` 行は1行だけ。後着は手順2で成功し、自分のDriveファイルを削除する(先着の行のファイルは残る)。完成済みの再送は、手順1(再認証)に通れば成功を返す。
- **分割モード**: 途中チャンク(`index<total-1`)は、一次 `authorize` と文字数検査(1)のあと `CacheService`(キー `pc:{photoId}:{index}`、TTL 21600秒。サムネは `pt:{photoId}`)に保存するだけで、**ロックを取らず、シートに書かない**。最終チャンクで全index(0〜total-1)がCacheに揃っていれば連結して上の検証(1〜7)→Drive保存→ロック内の処理(1〜6)→成功後にCacheを消す(失敗時は消さなくてよい)。欠け・失効は検証の前に `CHUNK_MISSING`(`{missing}`)。クライアントは当該写真を **index 0 から再送**。
- 権限: §4.1(`side`別。**図面も同じ権限・同じ状態条件**)。`itemId` は `side=prime` と `kind=drawing` で空、それ以外は必須(記録の項目に存在し `audience` が合うこと)。
- エラー: `NOT_FOUND`/`FORBIDDEN_*`/`RECORD_LOCKED`/`NOT_CLAIMER`/`STATE_CONFLICT`(side=primeでqa_okでない)/`VALIDATION_FAILED`(`FIELD_INVALID`)/`PHOTO_*`/`CHUNK_MISSING`(分割のみ)/`LOCK_TIMEOUT`/`DRIVE_ERROR`。

**deletePhoto** ★ Q `{ "photoId" }` → `{ "photoId", "deleted":true }`(論理削除。撮影者本人・`photo.round == record.round`・そのsideが編集可能な間のみ。他ラウンドの写真は消せない)。**削除済みの写真は `NOT_FOUND`**(存在しない `photoId` と同じ扱い。権限判定より先に評価し、削除済みかどうかを他人に知らせない)。エラー: `NOT_FOUND` / `FORBIDDEN_TEAM` / `RECORD_LOCKED`。

**getPhotoThumbs** `{ "photoIds":[最大20] }` → `{ "photos":[ {"photoId","dataUrl":"data:image/jpeg;base64,…"} ], "missing":["p_…"] }`(権限のない/存在しないIDは `missing`)

**getPhoto** `{ "photoId" }` → `{ "photoId", "dataUrl":"data:image/jpeg;base64,…", "width", "height" }`(本体。1枚ずつ。タイムアウト60秒)。エラー: `NOT_FOUND`。

#### 5.4.5 元請向けPDF(詳細は §10)

**generateReport** ★ `{ "recordId" }` → `{ "report":<Report> }`(最大120秒。status∈{qa_ok,approved}。エラー: `REPORT_NOT_ALLOWED`(`{status}`)/ `DRIVE_ERROR` / `FORBIDDEN_SITE`)。Events `report_generated`(`detail` は `{reportId,version,engine}`。doc 方式から html に切り替えたときは `fallbackFrom`・`fallbackReason` も入る=§10.5.8。**請求・応答の形は変更なし**。生成方式は Config `reportEngine`=§10.5)。
**listReports** `{ "recordId" }` → `{ "reports":[<Report>] }`(`version` 降順)

#### 5.4.6 参加(QR)

**requestJoin** ★ `{ "siteId", "joinKey" }` → `{ "membership":<Membership> }`(status=pending)。エラー: `NOT_FOUND`(siteなし)/ `JOIN_KEY_INVALID` / `SITE_CLOSED` / `ALREADY_MEMBER` / `JOIN_PENDING`。Events `join_requested`。(`FORBIDDEN_SITE` は適用しない。申請時点では担当がないため。)
**listJoinRequests** `{ "siteId"?, "statuses"?:["pending"] }` → `{ "requests":[<Membership>] }`(`requestedAt` 昇順。`canDecide` は呼出者が承認できるか=`decideJoin` の権限判定結果)
**decideJoin** ★ `{ "membershipId", "decision":"approve|reject", "assignRole"?:"foreman|subforeman", "team"?:"≤20文字", "note"?:"str" }` → `{ "membership":<Membership>, "assignment":<Assignment|null> }`
- `approve` は `team` 必須(`FIELD_INVALID`)。`assignRole` 既定 `foreman`。pending でなければ `STATE_CONFLICT`。承認で Assignments に有効行を追加(`validFrom`=今日、`validTo`空、`createdBy`=承認者)、Events `join_approved`。`reject` は `note` 任意、Events `join_rejected`。
- エラー: `NOT_FOUND` / `FORBIDDEN_SITE`(担当外)/ `FORBIDDEN_ROLE`(`qa_sub` が主担当在席中に承認しようとした場合を含む)/ `STATE_CONFLICT` / `VALIDATION_FAILED`。
**revokeMembership** ★ `{ "membershipId", "reason" }` → `{ "membership":<Membership> }`(approved→revoked、Assignments行を `active=FALSE`、Events `join_revoked`。`REASON_REQUIRED`)

#### 5.4.7 名簿・不在・管理(責任者)

**listAssignments** `{ "siteId"? }` → `{ "assignments":[<Assignment>] }`(`siteId`→`assignRole`順。`active=FALSE` も返す)
**listAbsences** `{}` → `{ "absences":[<Absence>] }`(未取消かつ `dateTo >= 今日-7日`)
**adminListUsers** `{}` → `{ "users":[ { "userId","name","role","status","lang","email","qaQualified","company","failedCount","lockedAt","lastLoginAt","devices":[{"deviceId","label","platform","status","registeredAt","lastSeenAt"}] } ] }`(`disabled` も含む。`pinHash/pinSalt` は絶対に返さない)
**adminIssueInvite** `{ "userId", "purpose":"first|pinReset" }` → `{ "inviteId", "code":"6桁", "expiresAt" }`(平文コードはこの応答のみ。`first` は `invited` のユーザー、`pinReset` は `active` のユーザーにのみ。`locked`→`USER_LOCKED`、`disabled`→`USER_DISABLED`、不整合→`STATE_CONFLICT`。Events `invite_issued`(コードは含めない))
**adminUnlockUser** `{ "userId" }` → `{ "userId", "status":"active" }`(`locked` のみ。他は `STATE_CONFLICT`。Events `user_unlocked`)
**adminSetUserStatus** `{ "userId", "status":"active|disabled" }` → `{ "userId", "status" }`(自分自身は変更不可=`FIELD_INVALID`。Events `user_status_changed`)
**adminRevokeDevice** `{ "deviceId", "reason"?:"str" }` → `{ "deviceId", "status":"revoked" }`(Events `device_revoked`)
**adminSetAbsence** ★ `{ "userId", "dateFrom", "dateTo", "reason"? }` → `{ "absence":<Absence> }`(`dateFrom<=dateTo`。Events `absence_set`)
**adminCancelAbsence** `{ "absenceId" }` → `{ "absence":<Absence> }`(Events `absence_cancelled`)
**adminGetJoinInfo** `{ "siteId" }` → `{ "siteId", "joinKey", "joinUrl":"{appBaseUrl}/#/join?site={siteId}&k={joinKey}&n={encodeURIComponent(現場名)}" }`(`n` は参加画面の表示専用。権限判定に使わない)
**adminRotateJoinKey** ★ `{ "siteId" }` → `{ "joinKey", "joinUrl" }`(`joinUrl` は adminGetJoinInfo と同形式)(新しい16桁英数。旧QRは `JOIN_KEY_INVALID` になる。Events `joinkey_rotated`)
**adminValidateRoster** `{}` → `{ "problems":[ {"level":"error|warn","code","siteId":"…|null","userId":"…|null","message":"日本語"} ] }`
`code`: `SITE_NO_QA_MAIN`(error)/`SITE_MULTI_QA_MAIN`(error)/`SITE_NO_QA_SUB`(error)/`QA_MAIN_EQ_SUB`(error)/`ROLE_MISMATCH`(error:役割と担当の不整合=兼任)/`QA_NOT_QUALIFIED`(error)/`DUPLICATE_ASSIGNMENT`(warn)/`QA_OVERLOAD`(warn。`qaMaxSitesPerDay` 超過)/`SITE_NO_FLOORS`(error)。

### 5.5 エンドポイント早見表(43 action)

公開: `ping` `lookupInvite` `registerDevice`
セッション: `me` `setLang` `changePin` `logoutDevice` `getBootstrap`
記録: `listRecords` `getRecord` `createRecord` `saveDraft` `submitRecord` `claimReview` `releaseClaim` `takeoverReview` `saveQaDraft` `submitVerdict` `recordPrimeSign` `stopPour` `addNote`
写真: `uploadPhotoChunk` `deletePhoto` `getPhotoThumbs` `getPhoto`
PDF: `generateReport` `listReports`
参加: `requestJoin` `listJoinRequests` `decideJoin` `revokeMembership`
名簿: `listAssignments` `listAbsences`
管理: `adminListUsers` `adminIssueInvite` `adminUnlockUser` `adminSetUserStatus` `adminRevokeDevice` `adminSetAbsence` `adminCancelAbsence` `adminGetJoinInfo` `adminRotateJoinKey` `adminValidateRoster`

**★(clientId必須)**: `changePin` `createRecord` `saveDraft` `submitRecord` `claimReview` `releaseClaim` `takeoverReview` `saveQaDraft` `submitVerdict` `recordPrimeSign` `stopPour` `addNote` `deletePhoto` `generateReport` `requestJoin` `decideJoin` `revokeMembership` `adminSetAbsence` `adminRotateJoinKey`
**PIN必須**: `submitRecord` `submitVerdict`(okのみ) `recordPrimeSign` + `changePin`(現PIN)

---

## 6. ステータス遷移と時間ルール

### 6.1 状態
`none`(記録なし=仮想)→ `draft`(入力中)→ `submitted`(確認待ち)→ `qa_ok`(QA合格・元請待ち)→ `approved`(打設可。**出来形の記録では「出来形確認済」と表示する**。状態の値はどちらも `approved`。§6.8)。差し戻しは `fix`(是正中)。**これ以外のstatusを作らない**。「確認中」は status ではなく `claimedBy` で表す。「打設停止」は `stopped=TRUE` + `fix` で表す。

### 6.2 遷移表(これ以外の遷移はサーバーが拒否)

| # | from | to | action | 実行者 | 条件 | PIN | 主な副作用 |
|---|---|---|---|---|---|---|---|
| T1 | none | draft | createRecord | 職長(担当現場) | 現場active、スロット(現場・階・工区・ロット・段階)未使用、段階が有効(`enabledStages` に含まれ、有効項目が1件以上) | 不要 | Records+RecordItems生成、Events `record_created` |
| T2 | draft / fix | 同じ | saveDraft | 職長(自班/自分) | 形式検査のみ | 不要 | `updatedAt`・`version`更新 |
| T3 | draft | submitted | submitRecord | 職長(自班/自分) | §5.3.1 提出検査を全て満たす、`round`一致 | **要** | `firstSubmittedAt`/`submittedAt/By`、Notes追記(職長コメント)、Events `submitted` |
| T4 | submitted | submitted | claimReview | 担当QA / 責任者 | 未claim、`round`一致。**先着のみ** | 不要 | `claimedBy/At`、Events `claimed` |
| T5 | submitted | qa_ok | submitVerdict(ok) | claim者 | 判定検査 OK、`round`一致 | **要** | `qaVerdict=ok`、Notes追記(管理者コメント)、Events `verdict_ok` |
| T6 | submitted | fix | submitVerdict(minor/major) | claim者 | 判定検査 OK、`round`一致 | 不要 | `major`(majorのみTRUE)、`claim*`を空に、Notes追記、Events `verdict_*`、majorは責任者へ即時通知 |
| T8 | fix | submitted | submitRecord | 職長(自班/自分) | T3と同じ検査 | **要** | `round+1`、QA列・判定列・`claim*`・`stopped*`・`prime*` を空に、`escNotified=0`、Events `resubmitted` |
| T9 | qa_ok | approved | recordPrimeSign | 担当QA / 責任者 | 3者サイン検査(職長提出・QA合格・元請担当者名) | **要** | `prime*`記録、Events `prime_signed` |
| T10 | submitted / qa_ok / approved | fix | stopPour | その現場の担当者(職長は班不問) / 責任者 | 理由必須。**`stage=pre_pour` の記録のみ**(出来形は不可。§6.8) | 不要 | `stopped=TRUE`、署名無効化(`prime*`・判定列・`claim*`を空に)、Events `stopped`、責任者・担当QAへ通知 |

- `approved` は終端。`approved→fix` は T10(停止)のみ。`submitted→draft`(取り下げ)・`qa_ok→submitted` などは存在しない(提出後の職長編集不可を守るため。P-05と同系)。
- **3者サイン** = ①職長の提出(T3/T8のPIN)、②QAの合格(T5のPIN)、③元請サイン記録(T9のPIN、元請担当者名+方法)。T9は①②③の充足をサーバーが検査する。重大(`major`)・`minor`判定は `fix` に落ちるため打設可にならない。
- 重大不適合=打設不可: `qaVerdict=major` の記録は `fix`。是正→再提出→再度の合格→元請サインを経ないと `approved` にならない。`stopped=TRUE` も同様(T8で解除)。
- T10 で `fix` に戻した記録の再提出時は、停止中だった事実を Notes/Events(`stopped`)が保持する。
- 再検査(別レコード): `approved` になった記録について、打設延期等で再度検査が必要なとき、職長が `createRecord` で `reinspectOf=元recordId` を指定して新規レコードを作る(`round=1`から。P-31)。**元記録が `approved` でない(`draft`/`submitted`/`fix`/`qa_ok`)場合は `STATE_CONFLICT`**(是正は同一レコードの `round+1` で行う)。`fix` の是正再提出は **同一レコードの `round+1`**(別レコードにしない)。
- 段階(`stage`)ごとに別レコード(版1.9: `pre_pour` と `post_demold`。P-10)。両段階とも T1〜T9 は同じで、違いは §6.8。

### 6.3 ステータスごとの編集可否まとめ

| status | 職長の編集(saveDraft/写真/コメント) | QAの入力 | 備考 |
|---|---|---|---|
| draft | 可 | 不可 | |
| submitted | **不可** | claim者のみ(`saveQaDraft`・QA写真) | |
| fix | 可(是正) | 不可 | QAの指示(`qa*`・`qaComment`)を職長が閲覧 |
| qa_ok | **不可** | 元請サイン証跡写真(`side=prime`)・`addNote(manager)` | |
| approved | **不可** | `addNote(manager)` のみ | |

### 6.4 エスカレーション(30分 / 60分)
- 対象: `status=submitted` かつ `claimedBy` が空の記録。起点は直近の `submittedAt`。**段階を問わず同じ規則で働く**(版1.9: 出来形の記録にも適用する。提出後の無応答を見るだけで打設に関係せず、実装の変更は不要。§6.8)。
- `escLevel(record, now)`:
  - `ref = (claimedAt があれば claimedAt、なければ now)`、`m = floor((ref - submittedAt) / 60秒)`。
  - `status≠submitted` → 0。`m >= escalationMin2(60)` → 2、`m >= escalationMin1(30)` → 1、それ以外 0。
  - claim された時点で段階が **凍結**される(以後増えない)。claim後の無操作は §6.5 の引き継ぎルールで扱う。
- `RecordSummary.escLevel` は読み取り時にサーバーが計算して返す(クライアントは再計算せず表示のみ)。
- 通知送信: 時間トリガー `escalationTick`(5分ごと)が `submitted` 未claimの記録を走査。`escLevel > escNotified` なら、未送信の段階を **小さい順に全て**(例 0→2 なら30分分と60分分)実行して `escNotified = escLevel` に更新(重複送信しない)。Events `escalate_30` / `escalate_60`(detail `{to,mailed}`)。
  - 段階1(30分): その現場の `qa_sub`(不在でない者)へ。有効な `qa_sub` が全員不在なら責任者へ。
  - 段階2(60分): 全ての `lead`(`status=active`)へ。
- 不在登録: 主担当QAが不在登録中でも、記録は先着の担当QA(代行者を含む)が claim できる(両者とも常時 claim 可)。不在は「通知先の選び方」と `decideJoin` の許可(§4.1)、画面の「代行中」表示にのみ使う。

### 6.5 時間ルール(v1は全て警告・フラグのみ。操作を拒否しない。P-06)
`pourDate = pourPlannedAt のJST日付`。`stage=pre_pour` かつ `pourPlannedAt` ありのとき `computeTiming(record)` は:

| 値 | 計算 |
|---|---|
| selfDeadlineAt | `(pourDate - 1日) の selfDeadlineHour(15):00 JST` |
| qaOpenAt | `(pourDate - 1日) の qaOpenHour(16):00 JST` |
| qaDeadlineAt | `pourPlannedAt - qaLeadMinutes(120)分` |
| selfLate | `firstSubmittedAt > selfDeadlineAt`(未提出なら `now > selfDeadlineAt`) |
| qaLate | 判定済み: `qaVerdictAt > qaDeadlineAt` / 未判定: `now > qaDeadlineAt` |

`pourPlannedAt` なし・他段階では4つの時刻は `null`、`selfLate`/`qaLate` は `false`。**出来形(`post_demold`)はこの「他段階」にあたり、時間ルールは一切適用しない**(版1.9。実装の変更は不要。§6.8)。`submitRecord` の `warnings` に `SELF_LATE`(`selfLate`)、`submitVerdict` の `warnings` に `QA_BEFORE_OPEN`(`now < qaOpenAt`)と `QA_LATE`(`now > qaDeadlineAt`)を入れる。画面は期限超過を警告色で表示する。

- 引き継ぎ可能時刻: `takeoverReview`(担当QAによる)は `max(claimedAt, qaDraftAt) + claimTakeoverMin(30分)` 以降、または claim 者が当日不在登録中。責任者は常時可。
- 重大不適合の報告(30分以内): `verdict=major` の保存と同時に責任者へ即時通知(§6.6)することでこの要件を満たす(P-25。責任者の確認ボタンは作らない)。
- 保管10年: 運用目標。アプリは削除しない(P-18)。

### 6.6 通知(v1はアプリ内表示+メール。Web Pushはv2。P-09)
- **アプリ内**: 前景で `Config.pollIntervalSec` ごとに `listRecords`(`since`)と `listJoinRequests` をポーリング。QA/責任者のボード(S09)に「確認待ち(提出順)」「エスカレーション表示(30分超過/60分超過)」「重大不適合」「参加申請」を出す。タブのバッジに件数。
- **メール**(`Users.email` があり `Config.mailEnabled=TRUE` のときのみ。`MailApp`。件名 `[型枠検査] {種別} {現場名} {階}`、本文は日本語・`appBaseUrl/#/record/{recordId}` へのリンクのみ(`requestJoin` は `appBaseUrl/#/joins`)。個人情報・PIN等を含めない。`{階}` は記録に紐づく通知のみ(`requestJoin` は記録がないので `[型枠検査] 参加申請 {現場名}`)。**`stage=post_demold` の記録に紐づく通知は、件名の末尾に半角スペース+`出来形` を付ける**(版1.9。例 `[型枠検査] 提出 A現場(仮) 2F 出来形`)。打設前は付けない(従来どおり)。**`{種別}` の語は下表の「種別」列の文字列に固定**(`backend/Notify.gs` の `subject_`・`Records.gs`・`Membership.gs` の実装と一致。mock・テストも同じ語を使う):

| 契機 | 種別(件名の `{種別}`) | 宛先 |
|---|---|---|
| submitRecord(初回・再提出とも) | `提出` | 主担当QA(不在なら有効な代行者)。責任者には送らない |
| escalate_30 | `30分経過` | 代行者 |
| escalate_60 | `60分経過` | 責任者 |
| verdict=major | `重大な不適合` | 責任者全員+その現場の担当QA(実行者除く) |
| stopPour | `打設停止` | 責任者全員+その現場の担当QA(実行者除く)。打設前の記録のみ(出来形では起きない。§6.8) |
| requestJoin | `参加申請` | 主担当QA(不在なら有効な代行者) |

- 種別は上の6語のみ。**差し戻し(`minor`)・合格・打設可(`approved`)・再提出の区別ではメールを送らない**(再提出も `提出`。職長宛のメールは無いため)。語を足す・変えるときは本表を先に直す。

- 職長へはメールしない(状況はアプリのポーリングで見る)。メール送信失敗は本処理を失敗させない(Events detail に `mailed:false`)。

### 6.7 トリガー(`setupTriggers()` をエディタから手動実行して設置)
- `escalationTick`: 5分ごと。
- `dailyMaintenance`: 毎日 03:00 JST。`Idem` の30日超行の削除、期限切れ `Invites` の `expiresAt` 超過行へ `usedAt=expired` を記入。端末の定期整理はしない(登録上限超過時のみ自動整理 §2.5。P-34)。

### 6.7a GASの起動待ち対策(keepWarm。版1.10。ユーザー決定 2026-10-17)

GAS Webアプリは、しばらく使われないと最初の1回が遅い(起動待ち)。**時間主導トリガーで軽い関数を定期的に動かし、起動待ちを減らす**。効果は保証されない(下の「効果の確認」)。

- **GASエディタ専用の関数**(Webアプリの action ではない。**`ACTIONS` に登録しない**。action数は43のまま。契約・mock の変更なし。`backend/Schema.gs` に `setupTriggers` と並べて置く):
  - `installKeepWarmTrigger()`: 時間主導トリガーを1本設置する。ハンドラは `keepWarm`。**何度実行しても1本だけ**(先に `keepWarm` のトリガーだけを全て削除してから作る。`escalationTick`・`dailyMaintenance` のトリガーには触れない)。間隔は `Config.keepWarmMinutes`(§2.14)。値が無い・不正なら 5。`ScriptApp` の `everyMinutes` は 1/5/10/15/30 しか受けないため、**5/10/15/30 のどれかに丸める**(1・範囲外・数でない値は 5。丸めたときは `Logger` に理由を出す)。戻り値は `'OK: keepWarm を{n}分ごとに設置しました'` の形の文字列。
  - `removeKeepWarmTrigger()`: `keepWarm` のトリガーだけを全て削除する(戻り値に削除した本数)。
  - `keepWarm()`: トリガーの本体。**軽量・副作用なし**: 参照キャッシュ対象シート(`Config`/`Items`/`Sites`。§2.15)を通常の読み取り関数で1回読むだけ(スクリプトの起動とスプレッドシートへの接続を済ませる)。**シート・Drive・Properties・メールへ書かない。ロックを取らない。Events・Idem を書かない。`Users`/`Devices`/`Assignments`/`Memberships`/`Absences` を読まない。値をログに出さない**。例外はすべて握りつぶす(失敗通知メールを増やさない)。通常のリクエストの処理・ロックに影響しない。
- `setupTriggers()` は `escalationTick` と `dailyMaintenance` のトリガーだけを入れ替える(`keepWarm` のトリガーは消えない)。コードの貼り替え(デプロイ)でもトリガーは消えない。トリガーは実行したユーザー(スクリプトの所有者)のもの。
- **名前について(2026-10-17 決定)**: 末尾 `_` の関数はトリガーの実行先にできない恐れがあるため、本体の名前は `keepWarm`(末尾 `_` なし)とする。`keepWarm` は ACTIONS に登録せず(action数43のまま)、GAS エディタの実行候補にも表示されるが、**誰がエディタから実行しても、参照キャッシュ対象シートを読むだけで何も書かないため無害**である。
- **制約**: 時間主導トリガーは1分に1回まで。Apps Script には1日あたりのトリガー実行時間の上限がある(個人アカウントは約90分/日、Workspace は約6時間/日が目安。公式の Quotas で確認すること)。既定の5分ごとは 1日288回 × 約1〜2秒 = 約5〜10分/日で、`escalationTick`(5分ごと)と合わせても余裕があるが、間隔を詰める場合は実行時間の合計を確認する。そのため 1分ごとは使わない(§2.14)。
- **インストール運用**: ユーザー(責任者)が GAS エディタで `installKeepWarmTrigger` を **1回だけ実行**する(初回は承認画面が出ることがある)。実行手順・間隔の変え方(`Config.keepWarmMinutes` を直して再実行)・やめ方(`removeKeepWarmTrigger`)・設置の確認方法(エディタの『トリガー』画面に `keepWarm` が1本)・効果の測り方・上限の注意を `docs/OPERATIONS.md` に書く(バックエンド担当)。
- **効果の確認(P-46)**: 効くかどうかは環境しだい(トリガーの実行環境と Webアプリの実行環境が同じである保証はない)。**設置の前後で、しばらく使わなかった後の最初の操作の往復時間(S21 通信診断の `rt`)を比べる**。差が出なければ `removeKeepWarmTrigger()` で外す。
- **範囲外**: 認証・認可に関わるシート(`Users`/`Devices`/`Assignments` 等)のサーバー側キャッシュ(§2.15 の決定のまま。『認可は常に最新のシートで判定する』と衝突するため)。GAS以外のサーバーへの移行。

### 6.8 段階(stage)による違い(版1.9。ユーザー決定 2026-10-14)

使う段階は `pre_pour`(打設前)と `post_demold`(出来形)の2つ(§0.2)。**出来形検査は打設前検査と同じ仕組みを再利用する**(流れ: 職長の自主検査 → 品質管理者の検査 → 元請に提出)。違いは下の表だけで、**表に無いことは両段階で完全に同じ**: 状態(`none`/`draft`/`submitted`/`fix`/`qa_ok`/`approved`)と遷移 T1〜T9、PIN再入力の3操作、差し戻し(`minor`/`major`)、提出後の職長編集不可、claim・引き継ぎ、職長コメントと管理者コメントの分離、元請サイン記録(3者サイン)、写真・図面、権限、エスカレーション。

| 項目 | 打設前 `pre_pour` | 出来形 `post_demold` |
|---|---|---|
| 項目(§2.6) | `stage=pre_pour` の有効項目(版1.9: 28) | `stage=post_demold` の有効項目(版1.9: 8) |
| 記録の単位(§2.7) | (現場,階,工区,ロット,段階)で1件 | 同じ。同じ現場・階・工区・ロットの打設前の記録とは別の行(状態・項目・版は互いに影響しない) |
| 打設予定日時 `pourPlannedAt` | 提出時必須(P-06) | **使わない**。常に空(指定されても保存しない)。S05〜S08・PDFに欄を出さない。`POUR_PLAN_REQUIRED` も出ない |
| 時間ルール(§6.5: 自主検査の締切・QA開始・QA期限、`SELF_LATE`/`QA_BEFORE_OPEN`/`QA_LATE`) | 適用 | **適用しない**(`computeTiming` は全て `null`/`false`、`warnings` なし。既存の「`pourPlannedAt` なし・他段階は null」の規則のとおりで、実装の変更は要らない) |
| エスカレーション 30/60分(§6.4) | 適用 | **適用する**(提出後に誰も確認しない時間を見るだけで、打設に関係しないため。実装の変更は要らない) |
| 打設を止める `stopPour`(T10) | できる | **できない**(`STATE_CONFLICT`。`actions` に出ない。他班の `masked` の行の `actions` も `[]`)。メール「打設停止」も起きない |
| 最終状態 `approved` の表示名 | 打設可 | **出来形確認済**(状態の値・遷移・PINは同じ) |
| 重大な不適合(`major`) | 打設不可(`fix` に差し戻し) | `fix` に差し戻し(承認に進めない)。画面に「打設」の語を出さない |
| 画面・PDFに出さない語 | — | 「打設可」「打設を止める」「打設停止」「打設予定日時」(§9.4 の上書きキーで語を差し替える) |
| PDF(§10) | 見出し「型枠工事 打設前検査記録」。ファイル名に「打設前」 | 見出し「型枠工事 出来形検査記録」。ファイル名に「出来形」。打設予定日時の行なし。`approved` のステータスは「出来形確認済」 |
| メール件名(§6.6) | 従来どおり | 末尾に ` 出来形` |

- **決め方(最小変更)**: 時間ルールとエスカレーションは、現行実装のまま成り立つ側を選んだ(時間ルールは `pourPlannedAt` が無いので自然に外れ、エスカレーションは段階を見ていない)。エスカレーションを出来形から外すには `escLevel`・`escalationTick`・画面に段階条件を足す必要があり、変更が大きくなる。
- 出来形の `approved` を取り消す操作は無い(`stopPour` が使えないため)。誤って承認した場合は `reinspectOf` で再検査の記録を作る(P-31)。取消が要るかは §14.2 の13。
- 出来形の作成条件に、同じスロットの打設前の状態は含めない(順序を縛らない)。
- `during_pour`(打設中・管理項目表⑯)は保留。列挙値は残すが `enabledStages` に入れず、項目も作らない。

---

## 7. 写真

**1項目に複数枚登録可。上限は `Config.photoMaxPerItem`(既定5。項目×sideごと)で、責任者が変更可。**

### 7.1 撮影(本番はアプリ内カメラのみ)
- `navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })` で全画面カメラ(M2)を表示し、シャッターで `<video>` のフレームを `<canvas>` に描画して撮影する。**`<input type="file">` や `capture` 属性は使わない**(端末ギャラリーの流用・加工を防ぐ)。
- カメラが使えない/権限拒否のときは撮影不可の案内(`err.camera_denied`)を表示。**代替としてギャラリー選択は提供しない**。ただし自動テスト用に、`frontend/config.js` の `ALLOW_FILE_PHOTO`(既定 `false`)が `true` のビルドでのみファイル選択を許す。E2EテストはChromiumの `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream` を使いカメラ経路を通す。
- 撮影枚数: 項目×side あたり `photoMaxPerItem`(5)枚まで。
- **例外(版1.6): 図面(§7.7)は参考資料のため、ファイル選択 `<input type="file" accept="image/*">` での取り込み(撮影・アルバム・スクリーンショット)を常に許す**(`ALLOW_FILE_PHOTO` に依らない)。この例外は図面だけで、検査写真(`kind=photo`)は従来どおりアプリ内カメラのみ。

### 7.2 スタンプ(画素に焼き込み)
- 内容(**`stampText` と完全に同じ文字列**): `{現場名} {階}{工区があれば「・」+工区} ・ {検査者名} ・ {YYYY-MM-DD HH:mm}`
  例 `A現場(仮) 2F ・ 田中 ・ 2026-10-07 09:58`。検査者=撮影時にログイン中のユーザーの `name`。時刻=端末時刻のJST表示(`meta.serverTime` との差 `skewMs` を補正した値を使ってよい。補正した場合は補正後を `takenAt` とスタンプの両方に使う)。
- 描画: 画像下端に高さ `max(28px, 画像高さ×0.08)` の黒(不透明度62%)の帯、白の太字 sans-serif で文字を描く。文字が画像幅に収まらないときは「 ・ {検査者名}」の手前で2行に折り返す(帯の高さを2行分に増やす)。
- スタンプを描いた後でJPEG化する(後から消せない)。

### 7.3 圧縮とアップロード方式(GAS制限対策)
1. 撮影フレームを長辺 `photoMaxEdge`(1280px)以下に縮小(元が小さければそのまま)。
2. スタンプを描画。
3. JPEG化 `quality = photoJpegQuality`(0.72)。サイズが **400,000バイトを超える**場合は品質を `0.6 → 0.5` の順に下げて再エンコード、それでも超えるなら寸法を0.85倍にして0.6から再試行(最大4回)。最終的に `photoMaxBytes`(600,000)を超えたらエラー(`err.photo_too_large`)として撮り直しを促す。
4. サムネ: スタンプ後の画像を長辺 `photoThumbEdge`(320px)・品質0.6でJPEG化(目安≤30KB。60KBを超えたら品質を下げる)。
5. `sha256` = `crypto.subtle.digest('SHA-256', 本体バイト列)` の16進(HTTPS/localhost必須)。
6. 本体をbase64化(長さ `L`)。**モードの決め方(版1.4)**: `L ≤ config.photoSingleMaxChars` なら **必ず単発**(`total=1`、`index=0`、`data`=本体全体、`thumb` を同じリクエストに入れる)。`L` がそれを超える場合、または `bootstrap` の `config` に `photoSingleMaxChars` が無い(旧サーバー)場合だけ **分割**: `photoChunkChars`(90,000文字。4の倍数)ごとに分割(`total = ceil(L/90000)`、最大12。超えるなら `err.photo_too_large`)し、サムネは1個のbase64文字列で `index=0` のチャンクに付ける。モードは **outbox行の送信直前、未送信(`nextIndex=0`)のとき** に最新の `bootstrap.config` で決め直してよい(行の `photo.total` を更新する)。分割に入った後(`nextIndex>0`)は変えない。初期設定(`photoMaxBytes=600,000`)では `L≤800,000` のため常に単発になる(版1.5: 分割の1チャンクを大きくして単発に近づける案は採らない。分割はCacheServiceの1値100KB制限のため `photoChunkChars=90000` のまま。理由は §2.14)。**この判定は `photo.js` の純関数 `planUpload(b64, cfg, lockedTotal)` → `{single:bool, total:int, chunks:string[], tooLarge:bool}` として確定(テストが直接呼ぶ)**: `cfg` は `bootstrap.config`、`lockedTotal` は分割に入った後(`nextIndex>0`)の固定 `total`(未送信なら `null`)。単発のとき `single=true,total=1,chunks=[b64]`。分割のとき `chunks` は `photoChunkChars` ごと。`total>12` なら `tooLarge=true`(`err.photo_too_large`)。
7. 送信: **単発** = 1枚1リクエスト(タイムアウト60秒。通信失敗・タイムアウトは同じリクエスト(同じ `photoId`)をそのまま再送=冪等。サーバー側で前のリクエストがまだ処理中でも二重にならない §5.4.4)。**分割** = 従来どおり **index昇順・1チャンクずつ・直列**(各チャンクのタイムアウト60秒、通信失敗は同じチャンクを再送。途中経過 `nextIndex` はIndexedDBに保存し、アプリ再起動後も続きから再開。`CHUNK_MISSING` が返ったら `nextIndex=0` から全送信し直す)。**写真の行どうしの並行送信**は §8.4(1端末で最大 `config.photoParallel` 件)。
- 撮影した瞬間に本体・サムネ・メタをIndexedDB `photoBlobs` に保存し、`outbox` にアップロード操作を積む(§8)。画面にはローカルのサムネを即時表示(アップロード中バッジ)。
- サーバー: **単発**はCacheServiceを使わず、1リクエスト内で検証→Drive保存→(ロック内で)`Photos` 追記→応答。**分割**は、チャンクを `CacheService`(キー `pc:{photoId}:{index}`、TTL 21600秒)に保存し、サムネは `pt:{photoId}`。最終チャンクで全て揃っていれば連結→base64デコード→検証(§5.4.4)→Drive保存→`Photos` 追記→キャッシュ削除。どちらも **重い処理はロックの外**(§5.4.4)。Driveの現場・階・日付フォルダの「探して無ければ作る」は、並行リクエストで同名フォルダが重複しないよう `LockService.getUserLock()` で短時間(最大10秒待ち・フォルダ特定の間だけ)直列化する。ユーザーロックが取れなくても処理は続行してよく、重複フォルダができた場合は **作成日時が最古のもの** を以後の特定に使う(写真は `driveFileId` で参照するので影響しない)。ユーザーロックを持ったまま、スクリプトロックを取らない。(推奨・契約外: 特定したフォルダIDを `CacheService` に短期保存して再探索を省いてよい。そのフォルダがゴミ箱/削除済みで書込みに失敗したら、キャッシュを捨てて1回だけ探し直す。)

### 7.4 Driveフォルダ構造
ルート = `Config.driveRootFolderId`(`setupSheets()` が `RCCREATE 型枠検査` という名前で作成)。

```
{ルート}/
  photos/{siteId}_{現場名}/{階}/{YYYY-MM-DD}/{recordId}_{itemId|prime}_{side}_{photoId}.jpg
  thumbs/{photoId}.jpg
  reports/{siteId}_{現場名}/{subject}_{段階名}_v{version}_{YYYYMMDD-HHmm}.pdf   (subject と段階名は §10.2a。禁止文字は Util.sanitizeName で置換)
```
- フォルダ名は `\ / : * ? " < > |` を `_` に置換し前後空白を除き最大60文字。現場名が後で変わっても `siteId` 接頭辞でフォルダを特定する(`Sites.driveFolderId` に現場フォルダIDを保存。階・日付フォルダは「名前で探して無ければ作る」)。
- 日付フォルダ = `takenAt`(検証後)のJST日付。工区はフォルダに含めない(ファイル名の `recordId` で特定)。
- 写真・サムネはオーナー(スクリプト実行者)のDriveに非公開で置く。アプリからは `getPhotoThumbs`/`getPhoto` 経由でのみ見せる。PDFのみ共有設定(§10)。

### 7.5 撮影時刻の検証
サーバーは `takenAt` が `now + 5分` より未来、または `now - 14日` より過去なら、`takenAt = now`(サーバー時刻)に置換して `Photos.clockSuspect=TRUE` にする(エラーにはしない)。

### 7.6 表示とキャッシュ
- 一覧・詳細のサムネは `getPhotoThumbs`(1回20枚まで)で取得し、IndexedDB `photoCache` に保存(LRU 300枚)。未送信の写真は `photoBlobs` のローカルサムネを使う。
- 拡大表示は `getPhoto`(本体)を都度取得し、`photoCache` に最大30枚保持。拡大画面にスタンプ文字列(`stampText`)を文字としても表示する。
- 写真ルール: 職長の提出(S06/S07)では、NG項目は写真と備考が必須、重点項目(`key`)は `ok` でも写真必須(§5.3.1)。**QA側(S10)は写真任意**(NGは備考と重さが必須。写真が無くても判定できる)。**送信前チェックはクライアントも同じ `rule` 名で行う**(提出ボタンの前に赤枠表示)。

### 7.7 図面(確認箇所の書き込み)(版1.6。ユーザー決定)
**目的**: どこを確認したかを、管理者・元請に図面上で示す。職長・管理者が図面の画像を取り込み、確認した項目の番号を任意の位置に書き込む。元請提出PDFの2ページ目に付ける(§10.2c)。

**1. 取り込み(登録方法)**
- A: 図面を撮影する、またはアルバムから選ぶ。A': PDF図面を画面に出して撮ったスクリーンショットをアルバムから選ぶ。どちらも `<input type="file" accept="image/*">` の1つのボタン「図面を追加」で行う(端末が撮影/アルバムの選択肢を出す)。
- **PDFファイルの直接取り込みは v1 対象外**(pdf.js等の追加が必要なため。P-40)。HEIC等はブラウザが読めない場合 `err.drawing_unreadable` を表示し、「スクリーンショットかカメラで撮り直す」旨を案内する。
- 1つの記録(×side)に **最大5枚**(基本は1枚)。登録できるのは、その side の写真を追加できる状態のとき(§4.1 `uploadPhotoChunk`)。

**2. 書き込みエディタ(M10。全画面)**
- 図面を画面幅に合わせて表示。倍率ボタン(×1/×2/×3)で拡大し、拡大中は指でスクロールして移動する(ピンチ操作は要求しない)。「回転」(90度)ボタンで向きを直せる。
- 上部に **項目の番号ボタンの列**(その side の項目。番号は画面の項目番号と同じ。§下の「番号」)。番号ボタンを選ぶと「その項目を置くモード」になり、図面をタップした位置に **印(番号の文字)** が置かれる。何度でも置ける。
- **番号を選んだときの表示(版1.6.1)**: 番号ボタンを選ぶと、エディタ上部に **その項目の内容**(`No.{N}`・項目文(言語に合わせた `textJa`/`textId`)・重点は★)を表示する(どの項目を置こうとしているかを確認できる)。
- **印の文字(label。版1.6.1 で規則を変更)**: 項目番号 N について
  - `measure = none`(測定点がない項目)は、**何個置いても `N` のまま**(枝番は付けない)。例 `①`。
  - `measure ≠ none`(測定点を追加できる項目)は、**入力済みの測定点ごと**に `N-k`(k=その項目の測定点の番号。1始まり)。測定点はその side の入力(`side=self` は職長の `values`、`side=qa` は管理者の `values`。S06/S10 で入力中の値を含む)の並び順で、k番目の値が `N-k`。例: 項目④の測定値が `+2, -3`(mm) なら `④-1`(+2mm)、`④-2`(-3mm)。
  - 測定項目の番号を選ぶと、**測定点の選択チップ**(`④-1 +2mm`、`④-2 -3mm`。置き済みの点は印を付けて表示)が出る。チップを選んでから図面をタップすると、その測定点の印が置かれる。**1つの測定点につき印は1つ**(置き済みの点を選んで別の場所をタップすると、その印が移動する)。**測定点が1つも入力されていない測定項目(測定点を追加せずに OK した場合など)は、測定なしの項目と同じ扱いで、枝番なしの `N` を何個でも置ける**(版1.6.2。`drawing.no_points` の「置けない」表示は廃止)。測定点が1つ以上入力されている項目は、上記のとおり測定点チップから選んで置く(`N-k`)。
  - 印を削除しても他の印の文字は変わらない(`label` は測定点の番号に固定。付け替えない)。測定点の値を後から削除・並べ替えても、すでに置いた印の `label` は変えない(登録済みの図面の印は焼き込み済み)。
  - 表示は N が 1〜20 のとき丸数字(①〜⑳)、21以上は通常の数字。枝番は `-k` を後ろに付ける(例 `④-1`、`21-2`)。**保存する `label` も同じ文字列**。
- **測定点の番号表示(版1.6.1)**: S06/S10/S08 の項目内の測定値のチップに、測定点の番号を付けて表示する(`①+2mm`、`②-3mm`。丸数字は 1〜20、21以上は通常の数字)。この番号が図面の枝番 `N-k` の k と一致する。
- **印の見た目**: 番号の文字だけを大きめの太字で描く。**番号を囲む枠(楕円・四角・白い塗り)は描かない**。可読性のため文字の縁に細い白の縁取りを付けてよい(枠ではない)。色は side で固定: 職長=濃いピンク `#d6249f`、管理者=青 `#1565c0`。大きさは画像の長辺の約3%(最小24px)。
- 印をタップすると選択でき、「この印を削除」で消せる。「ひとつ戻す」で直前に置いた印を取り消す。印を置いていなくても登録できる(`markers=[]`)。
- 「登録」: 印を **画像に焼き込んだJPEG** を作り、検査写真と同じ経路(outbox の `uploadPhotoChunk`。§8)で送る。`markers` も同時に送る(再編集の元データ・PDFの凡例用)。元の画像(印なし)は保存しない(**編集のやり直しは「図面を削除して取り込み直す」**)。

**3. 画質と容量**
- 取り込んだ画像を長辺 **1800px 以下**に縮小(小さければそのまま)。JPEG品質 0.8 から、`photoMaxBytes`(600,000)を超える間は 0.7 → 0.6 → 0.5 と下げ、それでも超えるなら寸法を0.85倍にして再試行(最大4回)。最終的に超えたら `err.photo_too_large`。**再試行の順序(確定)**: ①寸法×1で品質 0.8 → 0.7 → 0.6 → 0.5 の順に試す。②すべて超えたら寸法を 0.85 倍ずつ縮め(最大4回)、各回は品質 0.6 で試す。合計最大8回。スタンプ帯は **焼き込まない**(図面を隠さないため。`stampText` は文字としてのみ保存し表示する)。
- サムネは §7.3 の4と同じ(長辺320px)。`sha256`・単発送信(`total=1`)も §7.3 と同じ。

**4. 表示**
- S06/S10/S08 の「図面」欄にサムネを並べ、タップで M3(拡大。印が焼き込まれているのでそのまま見える)。自分が登録した図面は、編集可能な間だけ削除できる(§5.4.4 `deletePhoto`。送信中は削除×を無効にする点も検査写真と同じ)。
- **番号**: 画面の項目番号(S06/S10/S08 の「番号」)=**その記録の項目**を `seq` 昇順に並べた1始まりの添字(版1.9: 段階の違う項目は数えない)。現行の項目マスタは全項目が `audience=both` のため職長・管理者・PDFで同じ番号になる。将来 `audience` が分かれる場合は SPEC変更要望とする(P-40)。

---

## 8. オフライン・再送・競合・下書き

### 8.1 原則
- **ローカルファースト**: 入力は常に端末(IndexedDB)に即時保存し、バックグラウンドでoutboxから送信する。圏外でも入力・撮影ができる。
- 送信は **冪等キー(`clientId`)** で二重送信を防ぐ(§5.2)。同じ操作は何度送っても結果は1回分。
- キューに入れてよい操作(Q): `createRecord` `saveDraft` `saveQaDraft` `uploadPhotoChunk` `deletePhoto` `addNote` `stopPour`。
- **オンライン限定**(Qでない): `submitRecord` `submitVerdict` `recordPrimeSign`(PIN平文をキューに残さないため。P-05)、`claimReview` `releaseClaim` `takeoverReview`(先着判定はサーバーでしか決まらない)、`requestJoin` `decideJoin` `revokeMembership`、`generateReport`、`admin*`、`changePin`、参照系全て。圏外では該当ボタンを無効化し、理由(`msg.offline_required`)を表示する。
- `stopPour` はQだが高優先: outboxの先頭に割り込み、圏外では「送信待ちです。至急電話で連絡してください」(`msg.stop_queued_call`)を強調表示する。
- **先出し(版1.10。§8.11)**: Q のうち画面を先に更新してよいのは `saveDraft` `saveQaDraft` `addNote` `uploadPhotoChunk` `deletePhoto`(と `setLang`)だけ。`createRecord` と `stopPour` はQだが先出しにせず、オンラインでは応答を待つ(§8.11.2 の B)。

### 8.2 IndexedDB スキーマ(DB名 `katawaku`、バージョン1)

| ストア | キー | 内容 |
|---|---|---|
| `kv` | `k` | `{k,v}`: `deviceToken` / `deviceId` / `me`(Me) / `lang` / `bootstrap`(`{sites,items,itemsHash,config,fetchedAt}`)/ `lastSyncAt` / `skewMs`(サーバー時刻−端末時刻) |
| `records` | `recordId`(index: `siteId`) | `{recordId,siteId,summary,detail|null,fetchedAt}`(サーバー応答のキャッシュ) |
| `drafts` | `recordId` | 端末の作業コピー: `{recordId,siteId,baseRound,baseStatus,header:{lot,zone,pourPlannedAt},items:{[itemId]:{result,severity,values,note}},qaItems:{…同形},qaComment,dirty,updatedAt}` |
| `outbox` | `seq`(autoIncrement。index: `status`,`recordId`) | `{seq,clientId,action,params,priority:0|1,recordId,status,blockReason:'auth'|'locked'|'outdated'|'record'|null,tries,nextTryAt,createdAt,lastError:{code,message}|null,photo:{photoId,total,nextIndex}|null}` |
| `photoBlobs` | `photoId` | `{photoId,recordId,itemId,side,full:Blob,thumb:Blob,meta,uploadState}`(アップロード完了で本体を削除し `photoCache` へサムネを移す) |
| `photoCache` | `photoId` | `{photoId,thumb:Blob,full:Blob|null,lastUsedAt}`(LRU) |

版1.6.4: `photoBlobs`/`photoCache` の Blob 値は IndexedDB へ **`{__ab:ArrayBuffer,__type}` に変換して保存し、読み出し時に Blob へ戻す**(アプリ内の値は従来どおり Blob)。理由: iOS WebKit で Blob を直接保存すると "Error preparing Blob/File data to be stored in object store" で失敗するため。旧形式(Blob直接)の既存行も読める。

端末データはユーザー単位ではなくDB単位。そのため **端末のユーザー切替**(S01で `kv.me.userId` と異なるユーザーで `registerDevice` に成功したとき)は次のとおり扱う。同一ユーザーの再登録(§3.7)では何も消さない。
- **`records` / `bootstrap`(`kv`)/ `photoCache` は、outbox の有無に関わらず必ず消去する**(前のユーザーの記録・写真が新しいユーザーに見えないようにする)。`drafts` と `photoBlobs` も、未送信が無くなった時点(下記「送信してから切替」の完了後、または破棄)で消去する。
- 未送信のoutboxが1件でもあるときは、`registerDevice` を呼ぶ前に確認ダイアログを出す。選択肢は次の2つだけ(ダイアログを閉じれば切替を中止し、何も消さない)。
  1. **送信してから切替**: 旧ユーザーの `deviceToken` が有効に残っていてオンラインのときだけ選べる(トークン失効後・圏外では選べない)。outboxが0件になるまで送信してから切替に進む。`failed`/`blocked` が残って0件にならない場合は切替に進まない(S20で対処するか「破棄して切替」)。
  2. **破棄して切替**: outbox・`drafts`・`photoBlobs` を含む全ストアを消去する。**消去は新ユーザーの `registerDevice` が成功した後**に行う(PIN誤り等で登録に失敗したときは何も消さず、旧ユーザーのデータを残す)。
- 消去が終わってから新ユーザーの `deviceToken`/`deviceId`/`me` を保存し、その後に送信ループを再開する。**旧ユーザーのoutbox行を新ユーザーの `deviceToken` で送ってはならない**(行は必ず先に送信済みか消去済みになっている)。

### 8.3 outboxの操作
- 1つのユーザー操作 = 1行。`clientId` は行の作成時に生成して **行に保存**(再送でも同じ値)。`params` は §5.4 の `params` そのもの。
- 写真: 1枚 = 1行(`action=uploadPhotoChunk`、`params` はメタのみ、`photo={photoId,total,nextIndex}` で進捗を保持。本体は `photoBlobs`)。`photo.total=1` は単発モード(§7.3。`nextIndex` は0のまま成功で行ごと削除)、`total>1` は分割モード。冪等性は `photoId`(分割の途中チャンクは `(photoId,index)`)。**写真の削除(版1.4.2)**: その写真の行が `pending`(未着手)ならローカル削除(行と `photoBlobs` の破棄)を即時に行ってよい。`sending`(送信中。分割の途中も含む)の間は **削除ボタンを無効**にし、送信完了(サーバーに載った後)に削除を受け付けて `deletePhoto` を積む(サーバーに載る途中の写真を消して孤児・不整合を作らないため)。`failed`/`blocked` の行は従来どおり S20 の「破棄」で扱う。
- `status`: `pending`(送信待ち)/ `sending`(送信中)/ `failed`(確定失敗。ユーザー対応待ち)/ `blocked`(前段の失敗や認証待ちで保留。理由は行の `blockReason`: `auth`/`locked`/`outdated`/`record`)。成功した行は削除する。
- **saveDraftの統合**: 同一 `recordId` の `pending`(`sending` でない)な `saveDraft` が既にあれば、新しい変更を `params.items`/`params.header` にマージして1行にまとめ、**`clientId` を新しく採番**(内容が変わるため)。`saveQaDraft` も同様。
- 優先度: `priority=1`(`stopPour`)を先頭に。同優先度は `seq` 昇順(FIFO)。**同一 `recordId` の操作の順序保証は §8.4 の「送信可否規則」** に従う(`createRecord` → 写真/`saveDraft` の順を保つ。写真の行どうしは順不同・並行可)。
- **不変条件(統合と送信の競合。必ず守る)**:
  1. **送信直前に行を読み直す**: 送信ループは「`pending` → `sending` へ更新する」のと同じトランザクションで行を読み直し、その時点の `params`・`clientId`(統合後のもの)を送る。ループが行を選んだ後に統合が起きても、古い内容や古い `clientId` を送らない。
  2. **`sending` の行には統合しない**: 送信中(`sending`)の行へは変更をマージせず、新しい `pending` 行(新しい `clientId`)として積む。つまり**送信中に入った変更は次回の送信分に回る**。
  3. 成功時に削除するのは **送った行(`seq`)だけ**。送信中に積まれた同じ `recordId` の別行・統合済みの変更を消さない。
  4. 統合(§8.3)は読み取り→マージ→書き込みを1つのトランザクションで行い、2回の変更が互いを上書きしない(後の変更が先の変更を失わせない)。
  5. **送信行の選択は `pending` → `sending` へ更新するのと同じトランザクション**で、その時点の行集合に対して §8.4 の送信可否規則(a)〜(d)を再評価して行う(複数の送信スロットが同じ行・同じ `photoId`・規則違反の行を同時に取らない)。選択後に他の行が追加・統合されても、選んだ行の内容は不変条件1のとおり読み直す。
  6. 応答でローカル `records` キャッシュを更新するとき、**並行して返った古い応答で新しい応答の内容を巻き戻さない**(同じ記録のキャッシュは `version` が大きい方を残す)。 **応答に `record` がある場合の採否規則は §5.1a、反映直後の `getRecord` の省略は §8.11.8**。

### 8.4 送信ループ(スケジューラは1本。送信中の要求は複数可)
起動時・`online`イベント・`visibilitychange`(前景化)・操作追加時・30秒ごと・**送信中の要求が1件終わるたび**に実行する。スケジューラ(行を選ぶ処理)は同時に1本だけ動き、選んだ行の送信要求は下の規則の範囲で **同時に複数** 走ってよい。

0. **並行数** `P` = サーバーが `int` として返した `bootstrap.config.photoParallel` を **クライアントが1〜6に収めた値**(6超は6)。キーが無い(旧サーバー)・`null`・0以下は `P=1`(従来どおり直列)。小数の丸めは規定しない(サーバーは整数しか返さない)。§2.14・§5.4.2 も同じ解釈。
1. **送信可否規則**: `status=pending` かつ `nextTryAt <= now` の行を `priority` 降順 → `seq` 昇順に見て、空きがある限り、次の **(a)〜(d)をすべて満たす行** を `sending` にして送る(`deviceToken` と `clientId` を付ける)。写真の行 = `action=uploadPhotoChunk`、非写真の行 = それ以外。`stopPour` の行は (b)(c) の判定で「同じ記録の他の行」として数えず、他の行の完了も待たない(異常時の停止を最優先にする。§8.1)。
   - (a) **非写真の行は全体で同時に1件まで**(直列)。
   - (b) **写真の行は全体で同時に `P` 件まで**。写真の行が `backoff` 待ち(`pending` で `nextTryAt` 未到来)でも、他の写真の行を止めない。
   - (c) **同じ `recordId` の順序保証**(`seq` の小さい行を「先行」と呼ぶ。先行の行が `pending`/`sending`/`failed`/`blocked` のいずれかで残っている間は「未完了」。成功して削除された行だけが「完了」):
     1. **写真の行は、先行する未完了の非写真の行(`createRecord`・`saveDraft`・`saveQaDraft`・`deletePhoto`・`addNote` 等)が1件でもあるうちは送らない。**(記録が先にサーバーに作られ、`side` 別の編集可能状態になってから写真が届く)
     2. **非写真の行は、先行する未完了の写真の行が1件でもあるうちは送らない。**(写真の行が全て完了してから `saveDraft` 等を送る。`submitRecord` はキューに入らないが同じ理由で §8.6 により、その記録の写真の行が全て完了するまで呼ばない。サーバーの提出検査 `PHOTO_REQUIRED` を通すため)
     3. 非写真の行は、先行する未完了の非写真の行があるうちは送らない(従来のFIFO)。
     4. 写真の行どうしに順序は無い(`seq` に関わらず同時に送ってよい)。
   - (d) **同じ `photoId` の行は同時に1件だけ**(その `photoId` の行が `sending` なら選ばない。「再送」操作で同じ `photoId` の行が重複した場合も同じ)。
   - (e) **失敗の影響範囲**: 写真の行が(再試行待ち・確定失敗のいずれでも)止まっても、**他の写真の行は止めない**。止まった写真の行は (c)-2 により同じ記録の **後続の非写真の行** を待たせる(確定失敗のときは下の表のとおりそれらを `blocked`)。非写真の行が確定失敗したときは従来どおり同じ記録の後続の行(写真の行を含む)を `blocked` にする。**ただし `stopPour` の行は、他の行の確定失敗(写真・非写真とも)の波及で `blocked` にしない**(異常時の停止は常に送る)。`stopPour` 自身が確定失敗したときの扱いは従来どおり(その行を `failed` にし、同一 `recordId` の後続行を `blocked`)。他の記録の行は常に続行。
2. 成功 → その行(送った `seq` だけ)を削除。応答でローカル `records` キャッシュを更新(**応答に `record` があれば、行を削除する前にそれを §5.1a の版規則で反映する。`uploadPhotoChunk` の完了後は `getRecord` を呼ばない**。`record` が無い応答(旧サーバー等)のときだけ従来どおり `getRecord`)。続けて 1 に戻って空いたスロットを埋める。
3. 通信失敗(fetch例外・タイムアウト)・`LOCK_TIMEOUT`・`INTERNAL`・`DRIVE_ERROR` → その行だけ `pending` に戻し `tries+1`、`nextTryAt = now + [2,5,15,30,60,60…]秒`。**連続3回の通信失敗**(並行して送っている全要求を通算して数える。応答が1つでも成功したら0に戻す)でオフライン表示(ヘッダのインジケータ)にして、新しい送信を始めず `online` イベント/30秒まで待つ(送信中の要求は完了またはタイムアウトまで待つ)。
4. 確定エラー → 下表。

| エラー | 扱い |
|---|---|
| `UNAUTHENTICATED` / `DEVICE_REVOKED` | 全行を `blocked` にしてキュー停止(送信中の要求の結果は捨てず、確定エラーなら同じ扱い)、`deviceToken` を消去してS01へ。同一ユーザーで再登録できたら `pending` に戻して再開 |
| `USER_LOCKED` | キュー停止(`blocked`)。`me` ポーリングで `active` になったら `pending` に戻す |
| `USER_DISABLED` | キュー停止。S01へ(再登録不可の旨を表示) |
| `CLIENT_OUTDATED` | キュー停止(`blocked`・`blockReason='outdated'`)。更新バナーと「更新」ボタン(Service Worker更新)を表示。更新後のリロードで自動再開(§8.10) |
| `CHUNK_MISSING` | (分割モードのみ)写真行の `nextIndex=0` に戻し即再送 |
| `RECORD_LOCKED` / `STATE_CONFLICT` / `FORBIDDEN_*` / `NOT_FOUND` / `VALIDATION_FAILED` / `ALREADY_EXISTS` / `PHOTO_*` / `NOT_CLAIMER` / `NOT_CLAIMED` / `IDEMPOTENCY_CONFLICT` / `BAD_REQUEST` | その行を `failed` にし、**非写真の行なら** 同一 `recordId` の後続行(写真の行を含む。ただし `stopPour` の行は除く)を、**写真の行なら** 同一 `recordId` の後続の **非写真の行だけ**(`stopPour` の行は除く)を `blocked`(`blockReason='record'`)にする(他の写真の行・他の記録の行は続行)。S20で内容とエラーを表示し「破棄」(行と、その行専用のローカル写真を削除し、記録をサーバーから再取得)か「再送」(原因が解消した場合)を選ばせる。**自動では破棄しない**(入力を黙って失わない)。「破棄」「再送」で `failed` が解消したら、その行が原因で `blocked` にした行は `pending` に戻す |

### 8.5 滞留の上限
- outboxの行が作成(端末への保存)から30日(`Idem`保持期間)を超えたら、`status=failed`・`lastError={code:'EXPIRED',message:'expired'}` にして「期限切れ」(`outbox.expired`)を表示する。`EXPIRED` は端末内だけの印で、§5.3 のAPIエラーコードではない(`err.*` 辞書には入れず `outbox.expired` を使う)。起動時・送信ループ実行時・S20表示時に `pending`/`blocked` の行を判定する。
- **期限切れの行は自動送信も手動再送(「再送」「今すぐ送信」)もしない。できる操作は「破棄」のみ**(S20)。送るとサーバーの冪等キーが失効していて二重処理の恐れがあるため。利用者は S20 で保存内容(`params`・写真)を確認し、必要なら記録を取得し直して**新しく作成・入力し直す**。破棄は §8.4 の確定エラーと同じ後始末(その行専用のローカル写真の削除、記録のサーバーからの再取得)を行う。
- `failed`/`blocked` が1件でもあれば、ヘッダのoutboxインジケータを警告色にし、S20へ誘導する。

### 8.6 提出前の同期保証
`submitRecord` の前に、その `recordId` の `outbox` 行が0件であること(全て送信済み)をクライアントが確認する。**0件には `sending`(並行送信中の写真の行を含む)・`failed`・`blocked` が残っていないことを含む**。残っていれば送信ループを即時実行して完了を待ち、終わるまで「提出する」ボタンを無効化し「送信中(残りN件)」を表示する。圏外ならボタン無効+`msg.offline_required`。

### 8.7 競合処理
| 場面 | 振る舞い |
|---|---|
| 2人のQAが同時に「確認中」 | サーバーのロック内で先着のみ成功。後着は `ALREADY_CLAIMED`(`claimedByName` を `error.data` で受け取り)→ 画面に「{名前}が確認中」を出し、記録を再取得して表示を更新。**DoD: 同時操作** |
| 同じ記録を班の2人が同時に編集 | `saveDraft` は項目×列の後勝ち。ポーリングで他端末の変更を取り込み、ローカルに未送信(dirty)の項目は端末側を優先して表示、dirtyでない項目はサーバー値で更新 |
| 他の人が提出して記録がロックされた後に自分のsaveDraftが届く | `RECORD_LOCKED` → `failed`(上表)。自分の未送信入力は S20 で内容を確認できる |
| ポーリングで自分の編集中記録の `status` が変わった | 編集画面に「状態が変わりました(更新してください)」バナーを出し、保存済み分を残して詳細画面へ誘導 |
| QAが判定する直前に職長が `stopPour`・他QAが `takeoverReview` | `STATE_CONFLICT`/`NOT_CLAIMER` → 記録を再取得して画面を更新 |

### 8.8 下書き
- 下書きは **現場ごと**に保持・表示する。S04(現場の階・スロット一覧)に「下書きあり」(`drafts` に `dirty=true` があるか `status=draft`)を出し、他現場の下書きは混ぜない。
- 編集画面(S06)の上部には常に **現場名・階・工区・ロット** を固定表示する。確認画面(S07)にも現場・階・工区・ロット・段階(打設前のときは打設予定日時も)を表示する。
- 入力の保存: 変更のたび(デバウンス500ms)と `visibilitychange`/`pagehide` で `drafts` に保存し、outboxへ `saveDraft` を積む(統合 §8.3)。アプリを閉じても復元できる。
- サーバーの値で `drafts` を置き換える条件: その記録のoutbox行が0件のときのみ(未送信変更があるときは §8.7 のマージ)。

### 8.9 キャッシュとポーリング
- 起動時・前景化時・`pollIntervalSec`(60秒)ごとに、オンラインなら `listRecords`(`since`)で差分取得、QA/責任者は `listJoinRequests`、`me`(ロック状態)も確認。`getBootstrap` は起動時と前景化時(5分以上経過時)に取得し、`itemsHash` が変われば項目マスタを更新。
- 圏外では IndexedDB のキャッシュ(`bootstrap`・`records`・`photoCache`)で一覧・詳細を表示し、「最終更新 hh:mm」を出す。
- **サーバーに無い記録の整理(版1.8.2)**: 起動時の全件取得(`since`なし)を最後まで取れたとき、その結果に無い記録を端末の `records` から消す(サーバーで削除・非表示になった記録が端末に残るのを防ぐ)。**outbox に未送信の操作がある記録・下書きがある記録は消さない**。全件取得が途中で終わった(`nextCursor` が残る)ときは消さない。
- 経過時間表示(「◯分前」・エスカレーション判定表示)は `skewMs` を補正した現在時刻で計算する。

### 8.10 Service Worker・PWA
- `sw.js`: アプリシェル(index.html・JS・CSS・i18n・manifest・アイコン)は **`install` 時の precache(版1.6.3: 各ファイルを `fetch(new Request(url,{cache:'reload'}))` で取得して `cache.put`。ブラウザのHTTPキャッシュを使わない。1つでも失敗したらinstall失敗)による事前キャッシュ(precache)だけ**で持つ(キャッシュ名 `katawaku-shell-{SW_VERSION}`)。**シェルの更新は `SW_VERSION` を上げたときだけ**(新しいキャッシュ名で再 precache し、`activate` で旧キャッシュを削除)。**同一 `SW_VERSION` の間は、シェルのファイルを実行時に取得・上書きしない**(バックグラウンド更新で JS/CSS/i18n が部分的に新旧混在になるのを防ぐ)。唯一の例外として、**ナビゲーション(HTML への遷移)だけ stale-while-revalidate**(キャッシュを返しつつ裏で取得して更新)。**API(`API_URL`)へのリクエストは一切キャッシュせず素通し**。
- 新しいSWが `waiting` になったら更新バナー「更新があります」(`msg.update_available`)を出し、タップで `skipWaiting` → リロード。
- **`CLIENT_OUTDATED` を受けたとき**(§8.4): 更新バナーに「更新」ボタンを出す(押すと SW の更新確認→`skipWaiting`→リロード)。送信は止めたまま(outbox 行は `status=blocked`・`blockReason='outdated'`)。**更新後のリロードで `appVersion` が `minClientVersion` 以上になったら、`blockReason='outdated'` の行を自動で `pending` に戻して送信を再開する**(利用者の操作は不要。同一ユーザーのまま。`auth`/`locked` の保留は別条件で解除)。更新後も `CLIENT_OUTDATED` が続くなら保留のまま更新ボタンを出し続ける。
- `manifest.webmanifest`: `name="型枠検査"`、`short_name="型枠検査"`、`display="standalone"`、`start_url="./"`、`scope="./"`、`theme_color`/`background_color`、192/512pxアイコン(仮アイコン可。P-21)。
- ホーム画面追加を案内する(iOS Safariは非インストール時にサイトデータが7日で消えることがあるため、トークン消失時は再登録で復帰できる旨も案内。P-34)。

### 8.11 先出し(楽観的UI)と送信状態の可視化(版1.10。ユーザー決定 2026-10-17)

背景: 操作のたびに スマホ→GAS→スプレッドシート の往復(1回 1.3〜2.8 秒。休止後の最初はさらに遅い)があり、応答を待ってから画面を変えていた。待ち時間を **(a) 先出しできる操作は待たない (b) 待つ操作は『待っている』ことを見せ、待ち時間そのものを応答の `record`(§5.1a)で短くする** の2本立てで減らす。現状の調査は付録A。

#### 8.11.1 原則
1. 先出しにするのは **失敗しても困らない操作だけ**: 冪等で、確定(状態の遷移)を伴わず、先着の取り合いも PIN も無い操作。
2. 先出しした操作は、**端末に保存してから**(IndexedDB。§8.2)画面を切り替える。保存に失敗したら先出しにせず、エラーを表示する。送信は outbox が裏で行う(§8.4)。
3. **『表示されている=サーバーに保存済み』と誤解させない**: 未送信のものは見た目で区別し(§8.11.5)、記録の画面に保存状態を常に出す(§8.11.6)。
4. 待つ操作(PIN・先着・状態の取り合い・参加・端末登録・ログイン)は **先出ししない**。サーバーが拒否したら従来どおりエラーを表示し、画面は進まない。
5. 認可はサーバーで検査する(先出しでも変わらない)。先出しは見た目だけで、サーバーが拒否すれば §8.11.4 の失敗の扱いになる。

#### 8.11.2 操作の分類(正本。全43 actionを1回ずつ載せる。U-CLASS-01 が検査する)

| 分類 | action | 画面の動き | 理由 |
|---|---|---|---|
| A 先出し | `saveDraft` `saveQaDraft` | 入力は即座に端末へ保存して画面に反映(従来どおり。§8.8)。サーバーへは裏で(統合 §8.3) | 冪等・部分更新・後勝ち。状態を確定しない |
| A 先出し | `addNote` | 押した瞬間に入力欄を空にし、『送信待ちのコメント』として一覧に出す(§8.11.3)。応答を待たない | 追記専用・冪等(`clientId`)。失敗しても本文は outbox に残る |
| A 先出し | `uploadPhotoChunk`(写真・図面) | 撮影(取り込み)後すぐ端末内のサムネを出し、送信は裏(§8.11.5) | `photoId` で冪等。提出前に全件の完了を確認する(§8.6) |
| A 先出し | `deletePhoto` | 押した瞬間に写真を消す(送信済みの写真は非表示にし、削除は裏で送る)。失敗したら元に戻す(§8.11.4) | 論理削除で冪等。撮影者本人のみ |
| A 先出し | `setLang` | 即座に言語を切り替える(従来どおり。失敗は無視) | 本人の表示設定 |
| B 待つ(PIN) | `submitRecord` `submitVerdict` `recordPrimeSign` `changePin` | PIN入力→『送信中…』を出して応答を待つ。成功したら応答の `record` で次の画面を描く。`submitVerdict` の `minor`/`major` はPINなしで確認ダイアログのあと、同じく待つ | 確定・電子サインの代わり。PIN誤り・ロックはその場で見せる |
| B 待つ(先着・状態) | `claimReview` `releaseClaim` `takeoverReview` `stopPour` `createRecord` | 『送信中…』を出して応答を待つ。拒否(`ALREADY_CLAIMED` `STATE_CONFLICT` `RECORD_LOCKED` `ALREADY_EXISTS` 等)はそのまま表示 | 先着・状態の取り合い・停止の確定。`createRecord` は同じ場所の記録の先着(P-47)。圏外の `stopPour`・`createRecord` だけは従来どおりキューに積む(§8.1) |
| B 待つ(参加・端末・ログイン) | `lookupInvite` `registerDevice` `logoutDevice` `requestJoin` `decideJoin` `revokeMembership` | 同上 | 認証・参加の確定 |
| B 待つ(管理・出力) | `generateReport` `adminIssueInvite` `adminUnlockUser` `adminSetUserStatus` `adminRevokeDevice` `adminSetAbsence` `adminCancelAbsence` `adminGetJoinInfo` `adminRotateJoinKey` `adminValidateRoster` | 同上(`generateReport` は最大120秒) | 責任者の管理操作・PDF。結果が画面の内容そのもの |
| C 参照 | `ping` `me` `getBootstrap` `listRecords` `getRecord` `getPhotoThumbs` `getPhoto` `listReports` `listJoinRequests` `listAssignments` `listAbsences` `adminListUsers` | 先出しの対象外(書き込みではない)。キャッシュで先に描く規則は §8.11.9 | — |

- 分類の追加・変更は、本表を先に直す(実装が表と食い違うときは実装の誤り)。A に入れる条件は §8.11.1 の1。

#### 8.11.3 先出しの具体的な動き
- **回答・実測・項目コメント・QA入力・総合コメント**(`saveDraft`/`saveQaDraft`): 現行どおり。変更のたび端末に保存(デバウンス500ms)→outboxへ。画面は一切待たない。版1.10 で足すのは、失敗時の導線(§8.11.4)と保存状態の表示(§8.11.6)。
- **コメント追記**(S08。`addNote`):
  1. 『追加』を押すと、本文を outbox に積み(`recordId` 付き)、入力欄を即座に空にし、『送信待ちのコメント』枠(確定済みのコメント一覧の上)に 本文・状態(送信待ち/送信中/失敗)・時刻(端末時刻)を出す。押した直後から次のコメントを書ける(本文が空のときは押せない)。
  2. 成功: 応答の `record` を反映(確定済みコメントに本文が現れる)→ outbox行を削除 → 『送信待ち』のカードが消える。**この順序**にして、反映前の一瞬にコメントが消えて見えないようにする。`getRecord` は呼ばない。
  3. 失敗(確定エラー): 同じカードを赤にして『送信できませんでした』+理由(`err.<CODE>`)+ [再送][破棄]。『破棄』は **本文を入力欄に戻す**(入力を黙って失わない)。
  4. 送信待ちのコメントには種類(職長/管理者)の表示を付けない(種類はサーバーが役割から決める。§5.4.3)。
- **写真・図面**: §8.11.5。
- **写真の削除**(`deletePhoto`): 送信済みの写真を消すと、即座に非表示にし(`deletedPhotos`)、`deletePhoto` を積む。失敗したら元に戻す(§8.11.4)。未送信(`pending`)の写真は従来どおりローカルで即削除、`sending` 中は削除ボタン無効(§8.3)。

#### 8.11.4 先出しが失敗したとき(巻き戻し・再試行・破棄)
一時的な失敗(通信失敗・`LOCK_TIMEOUT` `INTERNAL` `DRIVE_ERROR`)は従来どおり自動で再試行する(§8.4。バックオフ)。**確定エラー**(§8.4 の表)になった行は `failed`/`blocked` で残り、**黙って捨てない**。操作ごとの画面の動きと導線:

| 操作 | 画面の巻き戻し | 導線 |
|---|---|---|
| `saveDraft` `saveQaDraft` | **巻き戻さない**(入力は端末の作業コピーに残す) | 記録の画面(S06/S08/S10)の上部に赤いバナー『送信できなかった入力があります』+[内容を見る(S20)][再送][破棄]。『破棄』は確認ダイアログのあと作業コピーを捨て、サーバーの値で再表示する(従来の S20 の『破棄』と同じ)。`RECORD_LOCKED` `STATE_CONFLICT` のときは『他の人が先に状態を変えました。入力は端末に残っています』(`outbox.locked_hint`)を添える |
| `addNote` | カードを赤に | [再送][破棄=本文を入力欄へ戻す] |
| `uploadPhotoChunk` | サムネに『失敗』(赤) | サムネをタップ→[再送][破棄=その写真を消す]。S20 にも出る |
| `deletePhoto` | **元に戻す**: `deletedPhotos` の印を外して写真を再表示し、トースト『削除できませんでした』(`msg.delete_failed`) | S20 から [再送][破棄](破棄しても写真は表示されたまま) |
| `setLang` | なし(失敗は無視) | — |

- 再送は同じ `clientId`(内容を変えない限り。§5.2)。S20 の『再送』『破棄』『今すぐ送信』の動作は従来どおり(§8.4・§8.5。期限切れは『破棄』のみ)。
- 1つの記録に `failed`/`blocked` が残っている間、その記録の画面は上のバナーを出し続ける。後続の行は §8.4 の規則どおり `blocked`。
- 上のボタンはすべてタップ領域44px以上(§9.1)。

#### 8.11.5 写真ごとの送信状態(検査写真・図面とも)
- **撮影直後**: 『使う』を押した時点で、IndexedDB への保存完了を待たずに、メモリ上のサムネを画面に出す(目標: 300ms以内)。保存に失敗したときはそのサムネを赤の『保存できません。撮り直してください』(`photo.save_failed`)にし、送信行を積まない。
- シャッターを押してから『使う』が出るまでの処理(縮小・スタンプ・圧縮・ハッシュ。§7.3)の間は、『処理中…』(`photo.processing`)を出し、シャッターを無効にする。
- サムネに **状態ラベル** を常に出す(色だけに頼らず文字とアイコンを付ける):

| 状態 | 条件(outbox行) | 表示(ja) | 見た目 |
|---|---|---|---|
| `queued` 送信待ち | `pending`(`tries=0`) | 送信待ち | グレー。点線の枠。サムネを少し薄く |
| `queued` 再試行 | `pending` で `tries>=1` | 送信待ち(再試行{n}回目) | グレー+注意アイコン |
| `sending` 送信中 | `sending` | 送信中 | 青。スピナー |
| `failed` 失敗 | `failed` または `blocked` | 失敗 | 赤。実線の枠。タップで [再送][破棄] |
| `saved` 完了 | 行が無い(サーバーの一覧に載った) | 保存済み ✓ を約2秒出して消す | 緑。**以後は何も付けない**(ラベルの無い写真=サーバーに保存済み) |

- 端末に本体が残っていて送信行が無い写真(`uploadState='uploaded'`)は `saved` として扱う。
- 圏外のとき `queued` のラベルに『圏外のため送信待ち』(`photo.st.offline`)を添える。
- 状態を決める **純関数 `KW.outbox.photoState(row)`**(`outbox.js`。テストが直接呼ぶ。U-OUTBOX-05): 引数は写真の outbox 行(無ければ `null`)。`'queued'|'sending'|'failed'|'saved'` を返す(上表の条件どおり。`blocked` は `failed`、`null` は `saved`)。
- **提出は写真の送信完了まで押せない**(現行の §8.6・FE-03 の修正の趣旨を維持): S07 は、無効のボタンの下に『写真の送信が終わるまでお待ちください』(`msg.wait_photos`)と『写真 {done}/{total} 送信済み』(`scr.S07.photo_progress`)を出す。失敗があれば『写真の送信に失敗が{n}件あります』(`scr.S07.photo_failed`)+S20への導線も出す(失敗が残る限り提出できない。再送または破棄で解消する)。

#### 8.11.6 記録の保存状態の表示(S06/S08/S10 共通)
記録の画面の上部(ヘッダ直下)に、その `recordId` の outbox 行から作る1行を出す(共通部品 `C.saveState`)。

| 条件 | 表示(ja) | 色 |
|---|---|---|
| 行が0件 | 送信済み ✓ | 緑(控えめ) |
| `sending` あり・`failed`/`blocked` なし | 送信中… {n}件 | 青 |
| `pending` のみ(オンライン) | 送信待ち {n}件 | グレー |
| `pending` のみ(圏外) | 圏外のため端末に保存中({n}件)。電波が戻ると自動で送ります | 黄 |
| `failed`/`blocked` あり | 送信できていない操作が{m}件あります [確認する] | 赤 |

- 件数と種別を決める **純関数 `KW.outbox.saveStateOf(rows, online)`**(`outbox.js`。テストが直接呼ぶ。U-OUTBOX-06): `rows` はその記録の outbox 行。`{ kind:'synced'|'sending'|'queued'|'offline'|'failed', n:全行数, m:failed+blocked の数 }` を返す(上表の優先順: `failed` > `sending` > `offline`(圏外で `pending`) > `queued` > `synced`)。
- S04 の記録の行にも、outbox 行がある記録には『未送信』バッジ(`badge.unsent`)を出す(『下書きあり』とは別)。

#### 8.11.7 未送信バッジ(ヘッダ)の強化
- 既存のヘッダの『未送信 {n}』(`outbox.badge`。押すと S20)を次のとおり目立たせる: n=0 は従来どおり控えめ。**n≥1 は黄色の塗り**。**`failed`/`blocked` が1件でもあれば赤の塗りにして『未送信 {n} ・要対応 {m}』**(`outbox.badge_bad`)。圏外で n≥1 のとき、`aria-label` に『圏外のため送信待ち』を含める。タップ領域は従来どおり44px以上。
- `failed`/`blocked` がある間は、ヘッダの下(打設停止の送信待ちバナーと同じ場所)に **画面を問わず出るバナー**『送信できていない操作があります』(`outbox.problem_banner`)+[確認する(S20)] を出す。閉じられない。解消すると消える。アプリを開いたとき・前景に戻ったときも、該当する間は最初から出ている。

#### 8.11.8 待つ操作の進行中表示と、getRecord を省く規則
1. 待つ操作(B)のボタンは、押した直後に **無効化+ラベルを『送信中…』(`act.sending`)に差し替え+スピナー** にする(`C.guard` の標準動作にする)。PIN入力モーダル(M1)の『OK』も同じ。PIN送信中の『キャンセル』は無効(従来どおり)。
2. 応答が **8秒** を超えたら、ボタンの下に『通信に時間がかかっています。そのままお待ちください』(`msg.slow_wait`)を出す(GASの起動待ちのとき)。30秒でタイムアウト(§1.4)=通信エラー。PIN付きの操作の再試行は §3.8 のとおり(同じ `clientId`・同じPIN)。
3. 成功したら **応答の `record`(§5.1a)で次の画面を描く**(`getRecord` を呼ばない):
   - 応答の `record` は、まず `records` キャッシュに反映する(§5.1a の3)。
   - 反映した直後(キャッシュの `fetchedAt` から **15秒以内**)に開く記録の画面(S06/S07/S08/S10)は、`getRecord` を呼ばずキャッシュの詳細で描く(`KW.data.loadDetail(recordId, {maxAgeMs})`。15秒を超えた/詳細が無い/応答に `record` が無かったときは従来どおり `getRecord`)。
   - `claimReview`/`takeoverReview` の成功のあと、同じ画面を描き直すために `getRecord` を呼ばない(応答が既に RecordDetail)。
   - 写真の送信完了(§8.4 の2)でも `getRecord` を呼ばない(応答の `record` を反映する)。
4. 拒否(`ALREADY_CLAIMED` `STATE_CONFLICT` `RECORD_LOCKED` `NOT_CLAIMER` 等)は従来どおり: エラーを表示し、記録を `getRecord` で取り直して画面を更新する(§8.7)。PIN誤り(`PIN_INVALID`)はPINモーダル内に『あと{remaining}回』を出し、ロック(`USER_LOCKED`)は S02 へ(従来どおり)。**これらを先出しには戻さない**。
5. 圏外のとき、オンライン限定の操作は従来どおり無効+`msg.offline_required`(§8.1)。

#### 8.11.9 読み取り側の待ち短縮(仮置き P-45。ユーザー未確認。確認が取れるまで実装・テストとも対象外)
書き込みではなく『起動する・開く』ときの待ちを減らす案。**2026-10-17 の承認範囲(REQUIREMENTS §15 の1〜6)には明記が無い**ため、メインがユーザーに確認してから着手する(§14.2 の14)。承認されたら本節を『仮置き』から外す。
1. 起動時の `me` と `getBootstrap` は **並列に呼ぶ**(いまは直列で、両方の応答までホームが出ない。付録A-1)。どちらかが認証系エラー(§8.4 の表)ならその処理に従う。
2. 端末に `deviceToken` と、保存済みの `me`・`bootstrap` があるとき、**ネットワークの応答を待たずにホームを描く**(スプラッシュを出さない)。応答が来たら差し替える。認証系エラー(`UNAUTHENTICATED` `DEVICE_REVOKED` `USER_DISABLED` `USER_LOCKED` `CLIENT_OUTDATED`)が返ったときは従来どおり S01/S02 へ遷移する(端末内の自分のデータが一瞬見えるだけで、サーバーの認可は変わらない)。
3. 記録の画面(S06/S07/S08/S10)を開くとき、`records` に詳細のキャッシュがあれば **先にそれで描き**、裏で `getRecord` を呼んで、`version` が大きければ差し替える(同じか小さければ何もしない。編集中の入力欄は作り直さない)。画面の上部に小さく『最新を確認中…』(`msg.checking_latest`)を出す。判定・提出・確認中にするなどの操作は、これまでどおりサーバーが最終判定する(古い画面で押しても `STATE_CONFLICT` 等で拒否される)。詳細が無いときだけスケルトン。

---

## 9. 画面一覧・表示制御・i18n

### 9.1 共通レイアウトと原則
- スマホ縦(**375px幅で崩れない**)。本文は最大幅560pxで中央寄せ、左右16pxの余白、**横スクロール禁止**(`document.scrollingElement.scrollWidth <= clientWidth`)。**タップ領域は最小44×44px。対象は全ての操作要素**(ボタン・リンク・タブに加え、ヘッダの outbox バッジ・接続インジケータが操作を持つ場合のそれ・言語ボタン・チップ/バッジのタップ・一覧の行・テキストリンク・チェック/ラジオを含み、例外を作らない。見た目が小さい場合は余白(padding)で当たり判定を広げる)。入力欄のフォントは16px以上(iOSの自動ズーム防止)。
- ヘッダ(固定): アプリ名。**現場に関する画面では現場名を固定表示**。**S06/S07/S08/S10/S12/S13 は、読み込み中・通信エラー・記録が取得できない状態でも現場名を表示する**(キャッシュ `bootstrap`/`records`、ルートの `siteId`、S13 は `n` から引く)。それでも現場名が分からないときは `siteId` を出さず「現場不明」(`app.site_unknown`。ja「現場不明」/ id は暫定訳)を表示する。右側に 接続インジケータ(オンライン/オフライン)・outboxバッジ(未送信件数。`failed`/`blocked` があれば警告色。タップでS20)・言語ボタン(`日本語`⇄`Indonesia`)。
- 下部タブ(固定、`env(safe-area-inset-bottom)` 考慮): 職長=`現場`/`履歴`/`設定`、QA=`ボード`/`履歴`/`担当表`/`設定`、責任者=`ボード`/`履歴`/`担当表`/`管理`/`設定`。サブ画面(編集・確認・詳細・管理サブ)ではタブを隠し「戻る」を出す。
- ライト/ダーク: `prefers-color-scheme` に追従(色はCSS変数)。外部CDN・Webフォント不使用(§1.2)。
- **待ち・未送信の見える化(版1.10。§8.11)**: 待つ操作は押した瞬間にボタンを無効にして『送信中…』(`act.sending`)を出し、先出しした操作は保存状態行と写真ごとの状態で『まだ届いていない』ことを見せる。ヘッダの未送信バッジは n≥1 で黄色、失敗・保留があれば赤で『要対応』(§8.11.7)。
- ルーティング: ハッシュルーティング(`#/…`)。画面遷移でスクロールを先頭へ。
- **表示制御の原則**: 記録に対するボタン・入力の有効/無効は **`RecordSummary.actions`/`RecordDetail.actions` に含まれるaction名のみ**で決める。フロントに役割や担当の判定ロジックを書かない(最終判定は常にサーバー)。役割(`Me.role`)はナビゲーションの出し分け(どのタブ・どの管理メニューを出すか)にのみ使う。
- 表示テキストは全て `t(key)`(§9.4)。サーバーからの文字(氏名・現場名・項目文・コメント)は **必ずエスケープして `textContent` で描画**(`innerHTML` に生文字を入れない)。

### 9.2 画面一覧

画面IDは `S00`〜`S20`。**`S15` は欠番**(PDFはモーダル M6 に統合)。

| ID | ルート | 対象 | 使うaction | 表示 | 操作・制御 |
|---|---|---|---|---|---|
| S00 | (起動) | 全員 | `me`,`getBootstrap` | スプラッシュ | トークン無→S01、`locked`→S02、それ以外→ホーム(職長S03/他S09)。保留の参加QR(`pendingJoin`)があればS13へ |
| S01 | `#/register` | 未登録端末 | `lookupInvite`,`registerDevice` | ①招待コード(6桁)欄と「次へ」。②「○○さんですね」と確認し、③**会社名欄**(初期値=名簿の会社名。初回は必須)とPIN4桁(新規)を入力して「登録する」。氏名リストは出さない。「コードが違う/期限切れ」は責任者に再発行を依頼する案内 | 登録成功で `deviceToken` 保存→S00。エラーは `err.<CODE>`。`RATE_LIMITED` は待つ案内、`USER_LOCKED`→S02 |
| S02 | `#/locked` | ロック中 | `me`(60秒ごと) | 「ロックされています。責任者に解除を依頼してください」 | 解除されたら自動で復帰。「この端末をログアウト」(`logoutDevice`) |
| S03 | `#/`(職長) | 職長 | `getBootstrap`,`listRecords`,`listJoinRequests` | 担当現場カード(現場名、未着手/是正中/確認待ちの階数。**版1.9: `enabledStages` が複数のときは段階ごとの行にする**(`打設前 未着手 a / 是正中 b / 確認待ち c` と `出来形 …`。階数は段階ごとに数える)。有効な段階が1つだけのときは従来どおり段階名なしの1行)、申請中の現場(`承認待ち`)、「QRで現場に参加」 | カード→S04。参加ボタン→S13。担当現場が0なら案内文 |
| S04 | `#/site/:siteId` | 全員 | `listRecords`(siteId) | 現場名固定。**階ごと**に記録スロット(ロット・工区・段階・ステータス・作成者名)。**版1.9: 階のカードは段階ごとに分ける**(見出し=段階名 `stage.*` と、その段階の代表ステータスのチップ。代表ステータスは従来の階ごとの規則を、その段階の記録だけに適用する。記録の無い段階は「未着手」)。1つの階の「打設前」と「出来形」の状態が並んで見える。各記録の行にも段階名を出す。主担当/代行者名(不在なら「代行中」)。ローカル下書きバッジ | 職長: 各階に「新しい記録」(→S05。S05 で段階を選べる。S04 から `?stage=` を渡して事前選択してもよい)。自班の記録→S06(編集可なら)/S08。**他班(`masked`)は「他班が入力中」で開けない(S06/S08へは遷移しない)。ただし行の `actions` に `stopPour` が含まれるときは、その行に「打設を止める」ボタンだけを出し、M4(理由必須)から `stopPour` を送れる(打設前の記録のみ。出来形では `actions` に出ない)。記録の内容は表示しない(現場・階・ロット・班名・ステータスのみ)**。QA/責任者: 記録→S08(`submitted`でclaim可ならS10への導線も) |
| S05 | `#/site/:siteId/new` | 職長 | `createRecord` | 階(select)、工区(`zones`があれば select)、打設ロット(必須テキスト)、段階(**版1.9: 「打設前」「出来形」から選ぶ**。選択肢は `config.enabledStages` に含まれ、かつ `getBootstrap.items` にその段階の項目が1件以上ある段階。既定は打設前。選択肢が1つだけなら選択欄を出さず固定表示。出来形を選ぶと説明 `scr.S05.stage_hint_post_demold` を出す。出来形では、同じ階・工区の打設前の記録の打設箇所(ロット)を候補に出してよい(推奨。入力の手間を減らすだけで、APIと一意制約は変えない))、打設予定日時(`datetime-local`。**打設前のときだけ**表示し、提出時必須。出来形では欄も `scr.S05.plan_hint` も出さない)、再検査のとき元記録の表示(段階は元記録の段階に固定) | 「作成して入力へ」→`createRecord`(Q。`stage` は選んだ段階。出来形では `pourPlannedAt` を送らない。オフラインで作る仮の記録の項目は `getBootstrap.items` を **選んだ段階で絞って** 作る)→S06。同じ階・工区・ロットでも段階が違えば別の記録なので `ALREADY_EXISTS` にならない。`ALREADY_EXISTS` なら既存記録へ誘導(`mine`ならS06、他班なら案内のみ) |
| S06 | `#/record/:id/edit` | 職長 | `getRecord`,`saveDraft`,`uploadPhotoChunk`,`deletePhoto`,`addNote` | **固定ヘッダ=現場名・階・工区・ロット・段階**(打設予定日時の入力欄は打設前だけ。版1.9)、進捗バー(入力済み/総数)、ステータス、`fix` のとき赤バナー(QA総合コメント・停止理由)、項目を `seq` 昇順にグループ見出し付きで列挙(`groupKey` が変わるたびに見出し。§2.6.1a)。各項目: 番号・項目文・「写真必須」バッジ・OK/NG/該当なし・実測入力(`measure≠none`: 値のチップ+「測定点を追加」、許容と「許容超え」表示)・コメント欄(職長)・写真(撮影ボタン・サムネ・削除×。**送信中(outbox が `sending`)の写真は削除×を無効**。§8.3)・`fix` では管理者コメント(別枠・読み取り専用)・違反の赤枠とメッセージ。**項目リストの下に「図面」欄(版1.6。§7.7。「図面を追加」ボタン・サムネ・削除×。`side=self`。任意)** | 入力は即ローカル保存(§8.8)。`actions` に `saveDraft` が無ければ全て無効+読み取り専用バナー。撮影は M2。「確認へ進む」で事前検証(§5.3.1と同rule)→違反があれば赤枠・先頭へスクロール、無ければS07 |
| S07 | `#/record/:id/confirm` | 職長 | `submitRecord` | 「この現場・階で間違いありませんか」+ **現場名・階・工区・ロット・段階(打設前のときは打設予定日時も)** を大きく、OK/NG/該当なし件数、NG項目と備考の一覧、未送信件数 | 「提出する」→PIN入力 M1 →`submitRecord`。無効条件: 圏外/outboxに未送信/事前検証違反。成功→S08(`SELF_LATE` は警告表示)。手書きサインは廃止しPIN再入力を電子サインとする(P-04) |
| S08 | `#/record/:id` | 全員(権限内) | `getRecord`,`stopPour`,`addNote`,`generateReport`,`listReports` | 現場・階・工区・ロット・段階、ステータスチップ(大。**`approved` の表示名は段階で決まる**: 打設前=打設可、出来形=出来形確認済。§6.8)、停止/重大/エスカレーションのバナー、**3者サイン欄**(職長/QA/元請。済=氏名+日時、未=「未」)、期限(`timing`、超過は警告色。出来形では全て `null` なので欄ごと出さない)、項目の読み取り一覧(職長結果・QA結果・実測・職長コメントと管理者コメントを**別枠**・写真)、コメント追記ログ(Notes)、履歴(Events。`ev.<kind>`でラベル化) | ボタンは `actions` で出し分け: 「続きを入力/是正して再提出」(`saveDraft`)→S06、「確認する」(`claimReview`)→S10、「確認画面へ」(自分がclaim者=`saveQaDraft`)→S10、「元請サインを記録」(`recordPrimeSign`)→M5(語は段階で変わる)、「打設を止める」(`stopPour`)→M4(`actions` に `stopPour` がある=打設前の記録のみ。出来形には出ない)、「元請提出用PDF」(`generateReport`)→M6、コメント追記(`addNote`) |
| S09 | `#/`(QA/責任者) | QA・責任者 | `listRecords`,`listJoinRequests`,`decideJoin`,`listAbsences` | 見出し=役割と氏名。①参加申請(自分が承認できるもの=`canDecide`)②確認待ち(提出順。経過時間・エスカレーション表示・確認中の人。②③④の各行に段階名)③重大不適合・打設停止中④元請待ち(`qa_ok`)⑤現場×階の状況グリッド(**版1.9: 1つの階のセルに段階ごとのチップを並べる**。段階名つきで `打設前 確認待ち` / `出来形 未着手` のように出す。段階内の代表ステータスは S04 と同じ規則)。責任者はロック中ユーザー件数(→S16)も | 申請の「承認」→M9(班名・役)→`decideJoin`、「却下」。確認待ち→S10(`claimReview`が`actions`にあれば「確認する」)。`escLevel`=1:「30分超過」、2:「60分超過」(警告色) |
| S10 | `#/record/:id/review` | QA・責任者 | `getRecord`,`claimReview`,`releaseClaim`,`takeoverReview`,`saveQaDraft`,`uploadPhotoChunk`,`submitVerdict`,`addNote` | 現場・階・工区・ロット・段階、職長提出者・経過時間。項目ごとに 職長の結果・コメント・写真(読み取り)+QA入力(OK/NG/該当なし、NGなら重さ=軽微/重大、実測、コメント(管理者)、写真(**任意**。撮影・サムネ・削除×。**送信中の写真は削除×を無効**。§8.3))。**項目リストの下に「図面」欄(版1.6。§7.7。職長の図面は読み取り、管理者は「図面を追加」・サムネ・削除×。`side=qa`。任意)**。総合コメント。「提案: 合格/軽微/重大」(**画面側の補助表示のみ**。QA入力のNG有無・重さから計算。自動確定しない) | 未claimなら「確認中にする(先着)」(`claimReview`)。他人がclaim中なら「{名前}が確認中」+(`takeoverReview`が`actions`にあれば)「引き継ぐ」。QA入力は `saveQaDraft` が `actions` にあるときのみ有効。判定ボタン「合格」「軽微な不適合」「重大な不適合」は事前検証(§5.3.1の判定検査)を通るものだけ有効、違反理由を表示(**版1.11.1: 管理者が許容超の値に OK を付けた項目はコメントが必須**。§9.2b)。「合格」→M1(PIN)→`submitVerdict(ok)`。`minor`/`major` はPINなしで確認ダイアログ→送信(`major` の確認文は、出来形では「打設」の語を含まない `scr.S10.confirm_major@post_demold`)。「確認を中止」(`releaseClaim`)。QAの下書きはoutbox経由で保存 |
| S11 | `#/history` | 全員 | `listRecords` | 現場・状態フィルタ。更新の新しい順に 現場・階・ロット・段階・ステータス・最終更新・作成者・NG件数 | 行→S08。`masked`(他班)は行自体は開けない。`actions` に `stopPour` があれば S04 と同様に「打設を止める」ボタンだけ出す(M4。内容はマスクのまま) |
| S12 | `#/roster` | QA・責任者 | `listAssignments`,`listAbsences`,`adminValidateRoster`(責任者) | 現場ごとの 主担当・代行者・職長(班)・期間、不在中マーク。責任者は名簿チェック結果(error/warn) | 表示のみ。「担当表の編集はスプレッドシートで行います」の案内(P-16)。責任者→S17 |
| S13 | `#/join?site=&k=&n=` | 職長 | `requestJoin` | 「『{n}』に参加申請しますか」。承認後に有効になる旨 | 「申請する」→`requestJoin`→「承認待ち」表示。未登録端末は `pendingJoin` を保存しS01→登録後ここへ戻る。アプリ内読み取り(`BarcodeDetector`対応端末)と、URL/合言葉の貼り付け入力の両方を用意。標準カメラでQRを読んでURLを開く方法も案内(P-27) |
| S14 | `#/joins` | QA・責任者 | `listJoinRequests`,`decideJoin`,`revokeMembership` | 全申請(状態別)。承認済みの取消(理由必須) | S09の参加申請から「すべて見る」で遷移 |
| S16 | `#/admin/users` | 責任者 | `adminListUsers`,`adminIssueInvite`,`adminUnlockUser`,`adminSetUserStatus`,`adminRevokeDevice` | ユーザー一覧(役割・状態チップ・`locked`を強調・最終ログイン)。ユーザーごとに端末一覧 | 「招待コードを発行」(`first`/`pinReset`)→M8(コード・期限を1回だけ表示、再表示不可)。「ロック解除」。「無効化/有効化」。端末の「登録解除」(確認ダイアログ) |
| S17 | `#/admin/absences` | 責任者 | `listAbsences`,`adminSetAbsence`,`adminCancelAbsence` | 不在一覧、追加フォーム(ユーザー・期間・理由) | 追加/取消 |
| S18 | `#/admin/qr` | 責任者 | `adminGetJoinInfo`,`adminRotateJoinKey` | 現場ごとにQRコード(`joinUrl`から端末内で生成。外部サービス不使用)、現場名、有効な合言葉 | 「印刷」(印刷用CSS)、「合言葉を更新」(確認ダイアログ。旧QRは無効になる) |
| S21 | `#/perf` | 全員 | (なし。端末の記録 `KW.perf` のみ) | 通信診断(§1.9)。操作ごとの集計・直近の通信・診断結果のコピー・記録の消去 | 設定(S19)の「通信診断」から開く。戻るは S19 |
| S19 | `#/settings` | 全員 | `setLang`,`changePin`,`logoutDevice`,`me` | 氏名・役割、言語切替(日本語/インドネシア語。インドネシア語は暫定訳の注記)、PIN変更(現在PIN・新PIN2回)、端末情報(端末名・アプリ版・最終同期)、ログアウト | ログアウト前に未送信outboxの警告。責任者は管理メニューへの導線 |
| S20 | `#/outbox` | 全員 | (ローカル) | 未送信操作の一覧(対象記録・操作名・状態・エラー理由 `err.<CODE>`)、写真の進捗 | 「今すぐ送信」「破棄」「再送」(§8.4)。`failed` は赤。**期限切れ(`EXPIRED`。§8.5)の行は「破棄」のみ** |

モーダル/オーバーレイ:

| ID | 内容 |
|---|---|
| M1 | PIN入力(4桁・数字キーボード・`type=password`)。誤り→「あと{remaining}回」。`USER_LOCKED`→S02。送信中はボタン無効 |
| M2 | アプリ内カメラ(全画面。シャッター・撮り直し・使う・枚数表示・スタンプのプレビュー。§7.1) |
| M3 | 写真拡大(`getPhoto`、スタンプ文字列、閉じる) |
| M4 | 打設停止(**打設前の記録だけ**。出来形からは開かない。理由必須テキスト、大きい赤ボタン。圏外では「送信待ちになります。至急電話で連絡」)。`masked`(他班)の記録から開いたときは、現場・階・ロット・班名だけを表示し、記録の内容は出さない |
| M5 | 元請サイン記録(担当者名・方法 paper/pdf/onsite・証跡写真(任意)→PIN入力M1→`recordPrimeSign`)。説明文の語は段階で変わる(出来形は「出来形確認済」。`scr.M5.desc@post_demold`) |
| M6 | 元請提出用PDF(`generateReport`の進捗→版・URL・「共有」(`navigator.share`、無ければリンクコピー)・「開く」・過去版一覧) |
| M7 | 汎用確認ダイアログ |
| M8 | 招待コード表示(コード・有効期限・「再表示できません」) |
| M9 | 参加承認(班名の入力=必須・既定は「{氏名}班」、役=職長/副職長) |
| M10 | 図面の書き込みエディタ(版1.6。全画面。画像の選択→番号ボタン列・倍率・回転・印の置換/削除・ひとつ戻す・「登録」。§7.7) |

### 9.2a 版1.10 による画面の追加・変更(先出しと送信状態の可視化。§8.11)

上の表(§9.2)と食い違うときは、本節が優先する。画面IDと action の対応は変えない。

| 画面/部品 | 変更 |
|---|---|
| 共通(ヘッダ・バナー) | 未送信バッジを n≥1 で黄色、`failed`/`blocked` があれば赤『未送信 {n} ・要対応 {m}』。`failed`/`blocked` の間は画面を問わず出るバナー(§8.11.7) |
| 共通部品 `C.guard` | 待つ操作のボタンは、押した直後に『送信中…』+スピナー、8秒超で『通信に時間がかかっています…』(§8.11.8) |
| 共通部品 `C.saveState` | S06/S08/S10 のヘッダ直下に記録の保存状態を1行(§8.11.6) |
| S04 | outbox 行がある記録の行に『未送信』バッジ(`badge.unsent`) |
| S05 | 『作成して入力へ』は『送信中…』を出して応答を待つ(先出しにしない。P-47)。成功したら応答の RecordDetail で S06 を描く |
| S06 | 写真・図面のサムネに送信状態ラベル(§8.11.5)。撮影後の『処理中…』。保存状態行。`saveDraft` の確定失敗で赤バナー(§8.11.4)。『確認へ進む』は従来どおり |
| S07 | 提出ボタン: 無効の間は『送信中(残りN件)』に加え『写真の送信が終わるまでお待ちください』と『写真 {done}/{total} 送信済み』(失敗があれば件数とS20への導線)。押した後は『送信中…』。成功したら応答の `record` で S08 を描く(`getRecord` を呼ばない) |
| S08 | コメント追記は先出し(『送信待ちのコメント』枠。§8.11.3)。保存状態行。確定失敗の導線(§8.11.4)。`stopPour`・`recordPrimeSign` 成功後は応答の `record` で描き直す |
| S10 | 保存状態行・失敗バナー・写真の状態ラベル。『確認中にする』『引き継ぐ』『確認を中止』『合格』『軽微』『重大』は押した後『送信中…』。`claimReview`/`takeoverReview` 成功後に `getRecord` を呼ばない。判定の成功後は応答の `record` で S08 を描く |
| S20 | 先頭に『要対応 {m}件』のサマリ(`failed`/`blocked` がある間)。各行の状態・理由・[再送][破棄] は従来どおり。写真の行の状態表示は §8.11.5 の語に揃える |
| M1 | 『OK』は押した後『送信中…』+スピナー、8秒超で『通信に時間がかかっています…』。PIN誤りはモーダル内に残す(従来どおり) |
| M2 | シャッター後に『処理中…』(§8.11.5) |
| M4 / M5 / M6 / M9 | 確定ボタンは押した後『送信中…』(M6 は生成中の表示が既にある) |

### 9.2b 管理者の許容超 OK とコメント必須(S10。版1.11.1。ユーザー決定 2026-10-20)
サーバー側の規則は §5.3.1 の `QA_OVER_TOL_COMMENT_REQUIRED`。画面は**同じ rule 名で事前検証**し、送信前に分かるようにする(CLAUDE.md §4・§9.4 の `rule.<RULE>`)。

1. **判定の関数**: `frontend/js/validate.js` の `itemViolations(items,'qa')`(`validateVerdict` が使う)に、§5.3.1 の4条件(`audience`・`result==='ok'`・`def.tol` が有限で >0・`qa.values` に `|v|>def.tol`)と `qa.note` の trim 後が空であることを足して `{rule:'QA_OVER_TOL_COMMENT_REQUIRED', itemId}` を返す。職長側(`side='self'`)の `MEASURE_OVER_TOL_OK` は変えない。**QA側(`side='qa'`)では `MEASURE_OVER_TOL_OK` を返さない**。画面の「許容超か」の判定(S10 の `lbl.over_tol` フラグ)にも同じ >0 の定義を使う。
2. **OK を押したとき・値を入れたとき**(S10 の項目ごと。管理者の入力欄): 項目が「`qa.result==='ok'` かつ許容超の値あり」の間、コメント欄の**直上**にヒント `scr.S10.over_tol_hint`(警告の見た目。`C.msg('warn', …)`)を出す。コメント欄の `placeholder` は `scr.S10.over_tol_note_ph` に切り替える。コメントが空(trim後)のあいだは、コメント欄に**必須エラーの赤枠**(既存の必須入力の赤枠と同じ見た目)と `aria-invalid="true"` を付ける。コメントが入ったら赤枠を外す(ヒントは許容超の `ok` のあいだ出し続けてよい)。値を直して許容内になった・結果を `ng`/`na` に変えた・OK を外したときは、再計算してヒント・赤枠・必須を消す。
3. **OK ボタン自体は押せる**(押せなくしない。画面で止めるのは下の判定ボタン)。`saveQaDraft` による下書き保存は、コメントが空でも従来どおり行う(待たない=§8.11)。
4. **判定ボタン**: 事前検証(`validateVerdict`)に `QA_OVER_TOL_COMMENT_REQUIRED` が含まれるあいだ、**「合格」「軽微な不適合」「重大な不適合」の3つとも無効**にして、既存の仕組みで理由 `rule.QA_OVER_TOL_COMMENT_REQUIRED` を各ボタンの下に表示する(§5.3.1: 総合判定に依らず検査するため)。「やること」の一覧(`scr.S10.todo_title`)にも、項目番号つき(`scr.S10.todo_items`)で出る(既存の rule × 項目番号の表示にそのまま乗る)。
5. **サーバーが拒否したとき**(別端末の編集・古いコピーなど): `violations` の `rule` を `rule.<RULE>` で表示する既存の処理(S10 の `serverViol`)のまま。新しい rule 名の辞書キーがあれば足りる。
6. **他の画面は変更なし**: S06/S07(職長)は許容超に OK を付けても従来どおり `MEASURE_OVER_TOL_OK` で提出できない。S08(閲覧)・M1(PIN)・S20 は変更なし。
7. 画面に出る結果の語は現行の `result.ok`(= `OK`)のまま変えない(辞書に新しい語を足さない)。

### 9.3 画面ごとの空状態・エラー表示
- 一覧が空: `scr.<ID>.empty` の文言。通信エラー: 画面上部にバナー(`err.network`)+キャッシュ表示。サーバーエラー: `err.<CODE>`(§5.3の全コードに辞書キー必須)。`VALIDATION_FAILED` は `rule.<RULE>` を該当項目の下に表示。
- 読み込み中はスケルトンまたはスピナー。操作ボタンは二重押下防止(送信中は無効)。 **待つ操作の進行中表示(『送信中…』と8秒後の `msg.slow_wait`)は §8.11.8**。

### 9.4 i18n(日本語/インドネシア語)
- 言語キーは `ja` / `id`。辞書は **`frontend/i18n.js` の1か所**(`window.I18N = { ja:{…}, id:{…} }`、キーはフラットなドット区切り)。HTML・他のJSに日本語/インドネシア語の文字列を直書きしない(`tests` が検査)。
- API: `t(key, params?)`。`{name}` 形式のプレースホルダ置換。フォールバック順は 現在の言語 → `ja` → キー文字列。複数形の特別扱いはしない(文言側で数を含める)。
- キーの系統(全て ja/id の両方に必ず存在):

| 接頭辞 | 内容 | 例 |
|---|---|---|
| `app.*` | アプリ名・共通語 | `app.name` |
| `nav.*` | タブ・戻る | `nav.home`,`nav.board`,`nav.history`,`nav.roster`,`nav.admin`,`nav.settings`,`nav.back` |
| `role.*` | 役割 | `role.foreman`=職長/Mandor、`role.qa`=品質管理者/Pengawas mutu、`role.lead`=管理責任者/Penanggung jawab |
| `assign.*` | 担当の役 | `assign.qa_main`,`assign.qa_sub`,`assign.foreman`,`assign.subforeman` |
| `st.*` | ステータス | `st.none`=未着手、`st.draft`=入力中、`st.submitted`=確認待ち、`st.fix`=是正中、`st.qa_ok`=元請待ち、`st.approved`=打設可(idはプロトタイプの訳を流用)。**出来形の記録の `approved` だけ `st.approved@post_demold`=出来形確認済**(下の「段階別の上書きキー」) |
| `badge.*` | 補助バッジ | `badge.stopped`=打設停止中、`badge.major`=重大不適合、`badge.draft_local`=下書きあり、`badge.masked`=他班が入力中 |
| `stage.*` | 段階(版1.9) | `stage.pre_pour`=打設前/Sebelum pengecoran、`stage.post_demold`=出来形/Hasil pekerjaan(値を「脱型後出来形」から変更)。`during_pour`・`demold`・`cleanup` の語は辞書に残す(使わない)。一覧・ボード・履歴・詳細のチップに `t('stage.'+stage)` を出す |
| `result.*` / `sev.*` / `verdict.*` | 結果・重さ・判定 | `result.ok`,`result.ng`,`result.na` / `sev.minor`,`sev.major` / `verdict.ok`=合格、`verdict.minor`=軽微な不適合、`verdict.major`=重大な不適合 |
| `method.*` | 元請サイン方法 | `method.paper`,`method.pdf`,`method.onsite` |
| `ev.*` | 履歴ラベル(Events.kind と1対1) | `ev.submitted`,`ev.verdict_major`,… |
| `esc.*` | エスカレーション | `esc.1`=30分超過、`esc.2`=60分超過 |
| `act.*` | ボタン | `act.submit`,`act.claim`,`act.approve`,`act.reject`,`act.stop`,`act.retry`,`act.discard`… |
| `scr.S##.*` | 画面固有 | `scr.S06.progress`,`scr.S07.confirm_q` … |
| `msg.*` | メッセージ | `msg.offline_required`,`msg.stop_queued_call`,`msg.update_available`,`msg.pin_remaining` |
| `err.<CODE>` | §5.3の全エラーコード+`err.network`,`err.camera_denied`,`err.photo_too_large` | |
| `rule.<RULE>` | §5.3.1の全rule | `rule.PHOTO_REQUIRED` |
| `photo.*` `outbox.*` `admin.*` `pin.*` `time.*` | 各機能の文言 | `time.min_ago`=「{n}分前」 |
| `drawing.*` | 図面(§7.7)の文言(版1.6) | `drawing.add`=図面を追加、`drawing.title`=図面、`drawing.pick_item`=番号を選んでタップ、`drawing.delete_mark`、`drawing.undo`、`drawing.save`、`drawing.zoom`、`drawing.rotate`、`drawing.hint`(=確認した箇所の番号を図面に書き込みます)。`err.drawing_unreadable` も追加 |

- **段階別の上書きキー(版1.9)**: 出来形の記録だけ語を変えたいときは、基キーに `@<stage>` を付けた上書きキーを辞書に置く(ja/id の両方)。API `ts(key, stage, params?)`: `stage` が空でなく `<key>@<stage>` が辞書にあればそれ、無ければ `t(key, params)`。ステータスチップ・ボタン・トースト・履歴ラベル・確認文で `approved` や元請サインの語を出すときは、その記録の `stage` を渡す。上書きキーは当面 `@post_demold` だけ:

| 基キー(現行の ja) | `@post_demold` の ja | id(暫定訳) |
|---|---|---|
| `st.approved`(打設可) | 出来形確認済 | Hasil pekerjaan terkonfirmasi |
| `ev.prime_signed`(元請サインを記録。打設可) | 元請サインを記録。出来形確認済 | Tanda tangan kontraktor dicatat. Hasil pekerjaan terkonfirmasi |
| `act.prime_sign`(元請サインを記録(打設可にする)) | 元請サインを記録(出来形確認済にする) | Catat tanda tangan kontraktor (hasil pekerjaan terkonfirmasi) |
| `msg.prime_signed`(元請サインを記録しました。打設可です) | 元請サインを記録しました。出来形確認済です | Tanda tangan kontraktor dicatat. Hasil pekerjaan terkonfirmasi |
| `scr.M5.desc`(…PIN確認で打設可になります。) | 元請の確認を受けた内容を記録します。PIN確認で出来形確認済になります。 | Catat hasil konfirmasi kontraktor. Dengan PIN, status menjadi hasil pekerjaan terkonfirmasi. |
| `scr.S10.confirm_major`(…打設はできません。…) | 重大な不適合として差し戻します。よろしいですか | Dikembalikan sebagai ketidaksesuaian berat. Lanjutkan? |
| `scr.S09.major`(重大不適合・打設停止中) | 重大不適合 | Ketidaksesuaian berat |

- 版1.9 で足す通常のキー: `scr.S05.stage_hint_post_demold`=「出来形検査は、脱型・解体のあとに行う検査です。打設予定日時は要りません」/ id「Pemeriksaan hasil pekerjaan dilakukan setelah bongkar bekisting. Rencana waktu pengecoran tidak diperlukan」。段階名の表示は既存の `stage.*`、ステータスは `st.*`、`lbl.stage` を使う(段階とステータスを並べる表示は `t('stage.x')` と `t('st.y')` をつなげて作る)。
- **版1.11.1 で足すキー**(ja/id の両方。インドネシア語は暫定訳 P-22。`@` を含まない通常のキー。§9.2b):

| キー | ja | id(暫定) |
|---|---|---|
| `rule.QA_OVER_TOL_COMMENT_REQUIRED` | 許容を超えた値にOKを付けるには、コメントを書いてください | Untuk OK pada nilai di luar toleransi, tulis komentar |
| `scr.S10.over_tol_hint` | 許容を超えた値があります。OKにする場合は、理由を管理者のコメントに書いてください(必須) | Ada nilai di luar toleransi. Jika diberi OK, wajib tulis alasannya di komentar pengawas |
| `scr.S10.over_tol_note_ph` | 理由・確認した内容を書いてください(必須) | Tulis alasan / hasil pengecekan (wajib) |

  既存の `rule.MEASURE_OVER_TOL_OK`(許容を超えているためOKにできません)は職長側の提出用として残す。`rule.*` は §5.3.1 の全 rule を網羅する不変条件(U-I18N-01)なので、`rule.QA_OVER_TOL_COMMENT_REQUIRED` が無いとテストが落ちる。
- **版1.10 で足すキー**(ja/id の両方。インドネシア語は暫定訳 P-22。既存の `photo.uploading`(送信中)・`act.resend`・`act.discard`・`outbox.badge`・`outbox.st.*` は残して使う。`@` を含まない通常のキー):

| キー | ja | id(暫定) |
|---|---|---|
| `act.sending` | 送信中… | Mengirim… |
| `msg.slow_wait` | 通信に時間がかかっています。そのままお待ちください | Koneksi lambat. Mohon tunggu |
| `msg.wait_photos` | 写真の送信が終わるまでお待ちください | Tunggu sampai pengiriman foto selesai |
| `msg.delete_failed` | 削除できませんでした | Gagal menghapus |
| `msg.checking_latest` | 最新を確認中… | Memeriksa data terbaru… |
| `scr.S07.photo_progress` | 写真 {done}/{total} 送信済み | Foto terkirim {done}/{total} |
| `scr.S07.photo_failed` | 写真の送信に失敗が{n}件あります | {n} foto gagal terkirim |
| `photo.processing` | 処理中… | Memproses… |
| `photo.save_failed` | 保存できません。撮り直してください | Gagal menyimpan. Ambil ulang |
| `photo.st.queued` | 送信待ち | Menunggu |
| `photo.st.retry` | 送信待ち(再試行{n}回目) | Menunggu (percobaan ke-{n}) |
| `photo.st.sending` | 送信中 | Mengirim |
| `photo.st.failed` | 失敗 | Gagal |
| `photo.st.saved` | 保存済み | Tersimpan |
| `photo.st.offline` | 圏外のため送信待ち | Menunggu (tidak ada sinyal) |
| `save.synced` | 送信済み | Terkirim |
| `save.sending` | 送信中… {n}件 | Mengirim… {n} |
| `save.queued` | 送信待ち {n}件 | Menunggu {n} |
| `save.offline` | 圏外のため端末に保存中({n}件)。電波が戻ると自動で送ります | Tidak ada sinyal: tersimpan di perangkat ({n}). Dikirim otomatis saat sinyal kembali |
| `save.failed` | 送信できていない操作が{m}件あります | {m} operasi belum terkirim |
| `save.check` | 確認する | Periksa |
| `outbox.badge_bad` | 未送信 {n} ・要対応 {m} | Tertunda {n} · perlu tindakan {m} |
| `outbox.problem_banner` | 送信できていない操作があります | Ada operasi yang belum terkirim |
| `outbox.problem_input` | 送信できなかった入力があります | Ada input yang gagal terkirim |
| `outbox.locked_hint` | 他の人が先に状態を変えました。入力は端末に残っています | Orang lain sudah mengubah status. Input tetap tersimpan di perangkat |
| `outbox.need_action` | 要対応 {m}件 | Perlu tindakan {m} |
| `note.pending_title` | 送信待ちのコメント | Komentar menunggu kirim |
| `note.failed` | 送信できませんでした | Gagal dikirim |
| `note.discard_restore` | 破棄(本文を入力欄に戻す) | Buang (kembalikan teks ke kolom) |
| `badge.unsent` | 未送信 | Belum terkirim |

(`msg.checking_latest` は仮置き P-45 の承認後に使う。承認前は辞書に置いてよいが使わない。)

- 項目マスタ・グループ名は辞書ではなくマスタ列を使う: `lang==='id' ? textId : textJa`、`groupJa/groupId`。
- 言語の決定: ログイン後は `Me.lang`、未ログインは `kv.lang`、なければ `navigator.language` が `id` で始まれば `id`、それ以外 `ja`。ヘッダの言語ボタンで即時切替(再描画)し、`kv.lang` に保存、オンラインなら `setLang`(失敗しても無視)。
- 日時表示は言語に依らず `MM/DD HH:mm`(JST固定)。経過は `time.min_ago`/`time.hour_ago`。
- **インドネシア語は暫定訳**(P-22)。辞書に `meta.idProvisional=true` を置き、設定画面に注記を出す。prototype の `L.id`(現行の暫定訳)を土台にキー名だけ新体系へ移す。
- インドネシア語は日本語より長くなる(目安+30%)ため、固定幅・`white-space:nowrap`・省略(`…`)で意味が欠けないこと。ボタン・チップは折り返し可、`min-width:0`。**日本語/インドネシア語の両方で375px幅の全画面を検査する**(§12 E-07/E-08)。
- 辞書の不変条件(テストで検査): `Object.keys(ja)` と `Object.keys(id)` が完全一致/値が空でない/コードが参照する `t('…')` のキーが全て存在/`err.*` は §5.3 の全コード、`rule.*` は §5.3.1 の全rule、`ev.*` は §2.11 の全kind、`st.*` は6値。**版1.9**: `@` を含むキー(段階別の上書きキー)は、この網羅検査の数え上げから除く。ただし `@<stage>` キーは基キーが存在し、ja/id の両方にあること。

---

## 10. 元請向けPDF

### 10.1 目的と流れ
元請はアカウントを持たず、**閲覧専用のPDF**を受け取るだけ。QA(または責任者)が `generateReport` でPDFを生成し、共有リンクまたはファイルとして元請へ渡す(LINE・メール等はスマホの共有機能)。元請の電子サイン/押印の受け入れ可否・独自書式は未確定(要件§3。P-11)のため、v1は以下の自社書式。

- 生成可能: status∈{`qa_ok`(元請の確認・サイン待ち。署名欄は空欄を印刷)、`approved`(3者サイン済み)}。`qa_ok` で渡したPDFに元請が署名(紙/PDF)→QAが `recordPrimeSign` で記録(`method`・担当者名・任意で署名済み書類の写真を `side=prime` で保存)→`approved`。承認後に最終版PDFを再生成して保管する(版が増える。**自動生成はしない**。S08/S09の導線で促す)。

### 10.2 内容(日本語のみ。A4縦、余白12mm)
0. **件名 `subject`**(§10.2a)。PDFの1ページ目の見出し(タイトルの直下)に大きく表示し、HTMLの `<title>` にも同じ文字列を入れる。
1. タイトル「型枠工事 {段階名}検査記録」。**段階名**(日本語のみ): `pre_pour`=「打設前」、`post_demold`=「出来形」(例「型枠工事 出来形検査記録」)。
2. 基本情報: 件名、現場名、元請会社名(`primeContractor`)、**職長の会社名(記録の `ownerCompany`。空なら作成者の現在の `company`、それも空なら項目ごと出さない。版1.7/1.8)**、階・工区・打設ロット、段階、打設予定日時(**打設前のみ**。出来形は行ごと出さない)、記録ID、ステータス(生成時点。**表示名は段階で決まる**: `qa_ok`=「元請待ち」、`approved` は打設前=「打設可」・出来形=「出来形確認済」。§6.8)、提出ラウンド数、生成日時、版(`v{n}`)。
3. **3者サイン欄**: 職長(**会社名**・氏名・提出日時・「PIN認証による電子サイン」)/ 品質管理者(**会社名**・氏名・判定日時・判定=合格)/ 元請(`approved` は 担当者名・方法・記録者・日時、`qa_ok` は「氏名 ______ 日付 ______ 署名・押印」の空欄)。停止履歴があれば注記。
4. 結果サマリ: 職長・管理者それぞれの OK / NG / 該当なし 件数。
5. 項目表: `No.` | 項目(`textJa`、重点は★)| 職長結果 | 管理者結果 | 実測(設計値との差。許容超の目印と要約つき。**§10.2d**)| 職長コメント | 管理者コメント。NG行は薄い赤背景。**職長コメントと管理者コメントは別の列**。**全列とも折り返して全文を出す**(切れない)。列幅・行の高さは §10.2b-A(版1.11.0 で改訂)。
5a. **確認箇所(図面)**(版1.6。§10.2c。**版1.11.0: 凡例の表を項目ごとのグループにし、実測値・許容超の印・要約を出す**): 項目表の直後、NG・是正の経過の前。登録された図面を1枚=1ページで載せる(概ね2ページ目)。無ければこの節ごと出さない。
6. NG・是正の経過: 判定イベント(`verdict_*`)を時系列に(日時・判定者・判定・総合コメント・NG項目)、提出回数、停止の理由・日時。
7. 写真: **1ページ最大4枚**、1枚=1行ブロック(左に写真、右に情報欄)。レイアウトは §10.2b-B(版1.5.3。従来の「1行4枚のサムネ格子」は廃止)。並びは項目順、最大60枚(超える場合はNG項目の写真を優先し、残りは「他N枚は電子記録で閲覧可」と注記)。
8. フッタ(全ページ): 記録ID・「電子記録ハッシュ(SHA-256): {64桁}」。**ページ番号は出さない**(版1.10.1: 従来の記載にあった「ページ番号」は HTML方式でも実装されておらず、Googleドキュメント方式でも DocumentApp に挿入手段が無いため、仕様から外した。フッタを全ページに出せるのは doc 方式。HTML方式は末尾に1回=§10.5.6)。ハッシュ = 記録スナップショット(`recordId`,`round`,項目結果一式,署名3者の氏名・日時,判定イベント一覧)の canonicalJSON のSHA-256。

### 10.2a 件名(subject)とファイル名(版1.5.2。ユーザー決定)
- `subject = {現場名} {階}` + (`zone` が空でなければ ` {工区}`) + ` {打設箇所(lot)}`。**半角スペース1つ区切り**。各要素は記録の値をそのまま使う(前後空白は除く)。
  - 例: 現場「A現場(仮)」・階「基礎」・工区なし・lot「L2」→ `A現場(仮) 基礎 L2` / 現場「B現場(仮)」・階「1F」・工区「東工区」・lot「L1」→ `B現場(仮) 1F 東工区 L1`。
- **PDFファイル名** = `{subject}_{段階名}_v{version}_{YYYYMMDD-HHmm}.pdf`(日時はJST・生成時刻。**版1.9: 段階名=「打設前」または「出来形」を subject の次に入れる**。同じ現場・階・工区・ロットの打設前と出来形のPDFを名前で区別するため。`subject` 自体は変えない。版1.9 より前に作ったPDFの名前は変わらない)。`subject` 部分に `Util.sanitizeName`(§7.4 のフォルダ名と同じ置換: `\ / : * ? " < > |` を `_`、前後空白除去、最大60文字)を適用する。従来の `{recordId}_v...` 形式は廃止(`recordId` はPDF本文・フッタに残る)。同名ファイルがあっても別ファイルとして保存する(`version` と生成時刻で通常は重ならない)。保存先フォルダは変更なし。
  - 例(版1.9): `A現場(仮) 基礎 L2_打設前_v1_20261014-0930.pdf` / `A現場(仮) 基礎 L2_出来形_v1_20261020-1500.pdf`。
- `Reports` の列・`Report` 応答(§5.1)・API契約は変更なし(`subject` は応答に含めない。PDF名とPDF本文のみ)。

### 10.2b レイアウト詳細(版1.5.3。ユーザー決定。項目5・7の具体化。API契約・列名は変更なし)
**共通(GAS変換の制約)**: GASの HTML→PDF 変換は flex / grid の対応が弱いので、**レイアウトは `<table>` とインラインの固定サイズ(mm / px)だけで組む**。`display:flex`・`display:grid`・`position` による配置・CSS変数・`calc()` は使わない。`table-layout:fixed` と `<colgroup>` の幅(mm)で列を固定する。

**A. 項目表(§10.2 項目5。版1.11.0 で改訂。従来の「折り返さない・行の高さ固定・管理者コメントは切れる」は廃止)**
- 表全体に `table-layout:fixed`。列幅は `<colgroup>` で固定(**合計=186mm。名目値**。doc 方式の実効値は ×184/186=§10.5.2)。列(名目mm): `No.` **8** | `項目` **40** | `職長結果` **14** | `管理者結果` **18** | `実測` **46** | `職長コメント` **30** | `管理者コメント` **30**(旧 8/62/14/18/24/30/30)。見出しの列名は `No.` / `項目` / `職長結果` / `管理者結果` / `実測(設計値との差)` / `職長コメント` / `管理者コメント`。
- **全セルを折り返す**(`white-space:normal`、`overflow:visible`)。行の高さは**最低 6mm**(`height:6mm` は最小値扱い。内容に応じて伸びる)。`white-space:nowrap`・`overflow:hidden`・`text-overflow` は使わない。`項目`・`職長コメント`・`管理者コメント` は `word-break:break-all`、**`実測` は `word-break:normal`**(値 `+3` `-5` の途中で切らず、読点「、」のあとで折り返す)。
- 管理者コメントは全文が出るので、従来の注記「管理者コメントの全文は写真ページおよび電子記録で確認できます」は**廃止**(出さない)。▲の注記は §10.2d-8(条件つき)。
- 「実測」列の中身は **§10.2d**(職長・管理者を別々に、値の並び・許容超の ▲・要約)。実測が無い項目は空欄。
- NG行の薄い赤背景は行(`<tr>`)の `background` で指定(継続)。行の途中での改ページ防止(`page-break-inside:avoid`)は付けてよいが、GAS変換が無視しても可(強制しない)。

**B. 写真ページ(§10.2 項目7)**
- **1ページに最大4枚**。1枚につき1つの `<table>`(ブロック)を縦に並べる。ブロックの高さは固定(約 **62mm**。`height:62mm`、4枚+余白で A4 の本文領域に収まる)、`page-break-inside:avoid`。**4枚ごとに `page-break-after:always`**(4の倍数枚目のブロックに付与。最後のブロックには付けない)。
- ブロックは2セル: **左=写真**(幅約45%、`photoThumb` を `<img>` で拡大表示。`width` と `max-height` をmmで固定、`object-fit` は使わない=縦横比は元画像のまま収める)、**右=情報欄**(下記)。
- 情報欄の内容(上から):
  1. 項目No.と項目文(`textJa`)
  2. 職長の結果 と 管理者の結果(OK/NG/該当なし。**NGは赤**)と、重さ(NG時の `selfSeverity` / `qaSeverity` = 軽微 minor / 重大 major)
  3. 実測(`selfValues` / `qaValues` に有効値がある側だけ。**§10.2d の書式で職長・管理者を別々に**: 値の並び・許容超の ▲・要約の2行。ラベルは `実測(職長):` / `実測(管理者):`。項目表と同じ内容・同じ記号。従来の `実測: -3, 1 / 許容±3` 形式は廃止)
  4. 職長コメント(全文)
  5. 管理者コメント(全文。職長コメントと別行・別欄)
  6. 撮影者区分(職長 / 管理者 / 元請サイン証跡)
  7. スタンプ文字(`stampText`)
- **項目に紐づかない写真**(元請サイン証跡、`itemId` なし)は、情報欄に**撮影者区分とスタンプ文字のみ**を出す(項目No.・結果・コメント欄は作らない)。
- 情報欄が62mmに収まらない長文は枠内で切れてよい(`overflow:hidden`)。全文は電子記録で確認できる。
- 写真の並び順・最大60枚・NG項目優先・「他N枚は電子記録で閲覧可」の注記は従来どおり(変更なし)。
- **画質の注意**: 写真は `photoThumb`(長辺 `photoThumbEdge`=320px、§7.3)を拡大して表示するため、**拡大すると粗くなる**。v1は容量(Drive取得量・PDFサイズ・タイムアウト120秒)を優先して許容する。改善が必要なら将来 `Config.photoThumbEdge` を上げる(例 480〜640。`photoThumbMaxChars` とサムネ目安も併せて見直す)。本版では値を変えない。

### 10.2c 確認箇所(図面)ページ(版1.6。ユーザー決定: 元請提出用PDFの2枚目に付ける)
- **対象**: `kind=drawing` の未削除の図面。`takenAt` 昇順、最大6枚(超える分は「他N枚は電子記録で閲覧可」の注記)。0枚ならこの節を出さない(見出しも出さない)。
- **1枚につき1ページ**。各図面の先頭に `page-break-before:always`(**図面ごとに必ず改ページ**。つまり1枚目は項目表の次のページ=概ね2ページ目から始まる)。
- 構成(上から。レイアウトは table と固定mmのみ。§10.2b 共通):
  1. 見出し「確認箇所(図面)」+ 登録者区分と氏名(`職長: {氏名}` / `管理者: {氏名}`)・登録日時・`stampText` は出さず氏名と日時のみ。
  2. **図面画像**: **本体(`driveFileId`)** を `data:image/jpeg;base64,…` で埋め込む(サムネは粗いので使わない)。縦横比を保つ(引き伸ばさない): 横長(幅≧高さ)は `width:186mm`、縦長は `height:170mm`。ただし横長で高さが170mmを超える場合は `height:170mm`。`width`/`height` は `Photos.width/height` から決める。画像を読めない場合は画像の代わりに「画像を読み込めませんでした」。
  3. **凡例の表(版1.11.0 で改訂。項目ごとにグループ化。従来は印1個=1行で、同じ項目の `⑦-1`〜`⑦-8` が並び、許容が表になかった)**:
     - **列**(6列。名目mm): `番号` **24** | `項目` **76** | `実測値` **28** | `許容超` **24** | `職長` **17** | `管理者` **17**(合計186。旧 24/82/24/28/28 の5列)。見出し行(列名)は背景 `#EEEEEE`・太字。行は**折り返しあり・最低高 6mm**(旧: 固定高さ・折り返しなし)。凡例が長いと次のページへ流れてよい(図面画像は1ページ目に収まる)。
     - **並び**: 項目番号 N の昇順 → 項目の中では印の `label` の枝番 k の昇順(枝番なし `N` は k=0 として先頭)。1つの `label` につき1行(同じ項目の同じ `label` の重複は1行。従来どおり)。
     - **グループ**: `N-k`(枝番つき)の印が**1つ以上ある項目**は、その項目の番号行の前に **見出し行**を1行置く: 番号列=`No.{N}`、項目列=1段落目 `{★}{textJa}`(太字)+ 2段落目 **要約**(`summaryText`。§10.2d-4。系列は下記。系列に有効値が無ければ2段落目は出さない)、実測値列・許容超列=空、職長列・管理者列=その項目の結果(従来の結果の表記。NGは赤・太字、重さは括弧)。見出し行は背景 `#EEEEEE`。その下に**番号行**(印1個=1行): 番号列=`label`、項目列=空、実測値列=値、許容超列=`▲` か空、職長列・管理者列=空。
     - **`N` だけの項目**(`N-k` の印が無い項目)は見出し行を作らず **1行**: 番号列=`label`(例 `⑤`)、項目列=`No.{N} {★}{textJa}`、実測値列・許容超列=空、職長列・管理者列=結果。同じ項目に `N` と `N-k` の印が両方あるときは見出し行を作り、`N` の行は値が空の番号行になる。
     - **実測値の系列 S**(項目ごとに1つ): **図面を書いた側**(`Photos.side`。職長=`selfValues`、管理者=`qaValues`)に有効値(§10.2d-1)が1つでもあればその側、無ければもう一方の側。番号行の値は `S[k-1]`(k番目。有効値でなければ空)を **符号付き+単位**(§10.2d-2 の `text` に `unit` を付ける。例 `-1mm` `+2mm` `0mm`)で出す。**従来(版1.6.5)の「要素ごとに他方の値で補う」は廃止**(図面の `N-k` は図面を書いた側の測定点で決まるので、差が出るのは図面を書いたあとにその側の値を消した場合だけ)。要約は系列S全体(図面に印を置いていない測定点も含む。その項目のばらつきを見るため)。
     - **許容超**(§10.2d-1): 番号行の値が許容超なら、実測値列の文字を太字・`#CC0000`、許容超列に `▲`(太字・`#CC0000`)。許容なし・値なし・許容内の行は許容超列を空にする。
     - 印が0個なら凡例の代わりに「印の書き込みなし」(従来どおり)。
- 図面の画素には、すでに印が焼き込まれている(§7.7)。PDF生成側で印を描き足さない。
- `Report` 応答・API契約・列名は変更なし。ハッシュ(§10.2 の8)の元データにも図面は含めない(従来どおり)。

### 10.2d 実測の表示規則(版1.11.0。ユーザー依頼 2026-10-20。**HTML方式・doc方式で同じ内容**。項目表 §10.2b-A・写真ブロック §10.2b-B・図面の凡例 §10.2c が共通で使う)
**背景**: 実PDFで、項目表の実測が1行固定のため `-5, -5, -2, -5, 3, -1, 5` と長いと切れる/図面の表は同じ項目の測定点が番号ごとに並んで許容内か・ばらつきが分からない/写真ページの `実測: -3, 1 / 許容±3` が簡素、の3点が読み手に不親切だった。
**原則**: ①**判定は人が行う**(CLAUDE.md §3)。許容を超えた値に付ける `▲`・「許容超」は**機械的な目安**で、「不合格」「NG」「不適合」とは書かない。結果(合/NG)・NG行の背景・結果サマリの件数・`MEASURE_OVER_TOL_OK` などの検査・判定イベントには**一切影響しない**。②PDFの文言は**日本語固定**(§9.4 の i18n の対象外。PDFは元請向け。変更なし)。③データ・API・列名・ハッシュ(§10.2 の8)は変えない。表示だけを変える。

**1. 用語(有効値・許容・許容超)**
- **対象の系列**: RecordItems の `selfValues`(職長。ラベル `職長`)と `qaValues`(管理者。ラベル `管理者`)。**職長と管理者は別の系列として扱い、混ぜない**(合算した要約も作らない)。値は「設計値との差(符号付き。単位は `snapshot.unit`、空なら `mm`)」(§2.8)。
- **有効値**: 配列の要素のうち、`null`・空文字・数値にできないもの・有限でないものを除いたもの(`"3"` のような数字の文字列は数値にする)。通常、無効な要素は入らない(入力検証 §5.4.3)。**有効値が0個の側は「実測なし」**。
- **許容 `tol`**: `Number(snapshot.tol)` が有限で **0 より大きい**ときだけ「許容あり」。それ以外(空・`null`・`0`・負・数値でない。例: 「設計かぶり厚以上」のような下限だけの基準=i59)は **「許容なし」**。
- **許容超**: 許容ありで **`|値| > tol`**(厳密に大きい)。**`|値| = tol` は許容内**(境界は許容内。例 許容±5 に対し `-5`・`+5` は許容内、`+5.5` は許容超)。小数は丸めずそのまま比較する。
- 項目の段階(`stage`)・`measure` の値(`none`/`optional`/`required`)・結果(`selfResult`/`qaResult`、`na` を含む)では出し分けない。**打設前(`pre_pour`)も出来形(`post_demold`。例 i56 はらみ ±10、i57 段差 ±3)も同じ規則を適用する**。`measure=none` の項目でも有効値があれば出す(値があるのに隠さない)。

**2. 値の書式**
- `text`: 値 v を `String(Number(v))` にし、**正は先頭に `+`、負は `-`(半角ハイフン)、0(`-0` を含む)は `0`**。例 `+3` `-5` `0` `+2.5` `-0.5`。
- **許容超の値は `▲` を先頭に付ける**: `▲+6`、`▲-6`。(`▲`=U+25B2。日本語フォントにある字。)
- **並び順は入力順**(=測定点番号 k=1,2,…。§7.7。図面の枝番 `N-k` と同じ並び)。並べ替えない。区切りは読点 `、`(全角)。

**3. 要約 `summaryText`(その側の有効値の数 n、最小・最大、許容)**
- 作り方: `n={n}` に続けて、**n≥2 のときだけ** `最小{min}/最大{max}`(`min`/`max` は有効値の最小・最大を上の `text` の書式で)、**許容ありのとき** `許容±{tol}{unit}` を、**スペース1つで `n=` と続け、残りは `/` でつなぐ**。許容超の値が1つ以上あれば、末尾に **スペース+`▲許容超{k}件`**(k=許容超の個数)。
- 例(許容±5mm): 値が `-5,-5,-2,-5,3,-1,5,-5` → `n=8 最小-5/最大+5/許容±5mm`(許容超なし)。値が `-6,0,5.5,2` → `n=4 最小-6/最大+5.5/許容±5mm ▲許容超2件`。値が `4`(許容±3)→ `n=1 許容±3mm ▲許容超1件`。許容なしで `2,-1,0` → `n=3 最小-1/最大+2`。許容なしで値1つ `2` → `n=1`。
- 要約は**許容の有無に関わらず出す**(ばらつきの把握のため)。ただし許容なしの側には `許容±`・`▲`・許容超の件数を出さない。

**4. 共通の純関数(`Report.gs`。doc 方式も同じ関数を呼ぶ=表記を二重定義しない。§10.5.1)**
- `measureView_(row, side)`: `side` は `'self'` または `'qa'`。有効値が0個なら **`null`**。そうでなければ次を返す:
  `{ side, label:'職長'|'管理者', n, values:[{ v:Number, text:String, over:Boolean }], min:Number, max:Number, minText, maxText, tol:Number|null, unit:String, overCount:Number, valuesText:String, summaryText:String }`。
  `valuesText` = `values` を `(over?'▲':'')+text` にして `、` で連結した文字列。`summaryText` は上の3。`tol` は許容なしなら `null`。
- 従来の `measureText_(row, side)`(`値, 値 / 許容±N`)は**廃止**し、Report.gs・ReportDoc.gs の全ての呼び出し(項目表・写真ブロック・図面の凡例)をこの関数に置き換える。
- 単一の値の関数 `measureCell_(raw, tol)`(`measureView_` も内部でこれを使う): `raw` が有効値なら `{ v:Number, text:String, over:Boolean }`(`text` は上の2の書式で `▲` なし)、無効なら `null`。**図面の凡例の番号行**(§10.2c-3)は、系列Sの配列の k 番目(添字 k-1)を `measureCell_` に渡し、`text`+単位と `over` で値・許容超を出す(配列の添字を詰めない=印の `N-k` と測定点 k が一致する)。見出し行の要約は系列S全体の `measureView_` 相当(`summaryText`)。

**5. 出す/出さない**
| 状況 | 項目表の実測セル | 写真ブロック | 図面の凡例 |
|---|---|---|---|
| 両側とも有効値なし | **空欄**(「-」や「未入力」は出さない。測定を求めない項目と区別が付かないため) | 実測の行を作らない | 値は空・許容超は空・見出し行の要約なし |
| 片側だけ有効値あり | その側だけ(ラベルつき) | その側だけ | 系列S(上記) |
| 許容なし・値あり | 値と `n=` の要約(最小/最大)。▲・許容は出さない | 同左 | 値は出す。▲は出さない |
| 値なし・許容あり | 空欄(許容だけを単独で出さない。項目文に `(±3mm)` 等が入っている項目はそのまま見える) | 実測の行を作らない | 同上 |

**6. 見た目**
- **項目表(§10.2b-A の実測列)・写真ブロック**: 有効値のある側ごとに **2段落**(HTML は2つの `<div>`、doc は2つの段落): ①`{接頭辞}{valuesText}` ②`summaryText`。接頭辞は項目表=`職長: ` / `管理者: `、写真ブロック=`実測(職長): ` / `実測(管理者): `(ラベル部分 `#555555`)。**職長の2段落→管理者の2段落**の順。①のうち**許容超の値(`▲` を含む部分)だけ太字・`#CC0000`**。②は `#444444`、②の末尾の `▲許容超{k}件` の部分だけ太字・`#CC0000`。文字サイズは表の本文と同じ(HTML 10px / doc 7.5pt)。
- **HTML方式のマークアップ(テストで観測する形)**: 許容超の値と `▲許容超{k}件` は `<span class="over" style="font-weight:bold;color:#cc0000">…</span>` で囲む(`class` と同じ内容のインライン style の両方。GAS変換はクラスを無視することがあるため)。それ以外の値・要約・ラベルの色は上記のとおりインライン style。値と値の間の `、` は `over` の外。
- **色だけに頼らない**: 白黒印刷でも許容超が分かるよう `▲` を必ず付ける(色・太字は補助)。
- 折り返しは値の途中で切らない(HTML は `word-break:normal`)。長い系列(最大10個)は2行になってよい。
- doc 方式の色・太字は「セルの文字列全体を `setText` してから、許容超の部分の範囲だけを指定する」(§10.5.3 の「セル内の文字」の作り方と `ReportDoc.gs` の既存の範囲指定のやり方。`appendText` の連結で書式を付けない=隣接する同書式の Text が結合されて範囲がずれるのを避ける)。

**7. 出来形検査(`post_demold`)**: **同じ規則をそのまま適用する**(上の1のとおり。段階で分けない)。
**8. 注記**: 項目表の直後に1段落(HTML 8px / doc 6pt、`#444444`)`実測の ▲ は許容(±)を超えた値の目安です。合否は職長・管理者が判定した結果(合/NG)で、▲ だけでは決まりません。許容ちょうどは許容内として扱います。` を、**項目表のどこかの行に「許容あり」の実測(要約に `許容±` を含むもの)が1つでもあるときだけ**出す。無ければ出さない。従来の注記「管理者コメントの全文は…」は廃止(§10.2b-A)。
**9. 許容超でも結果が `ok` の行(版1.11.1 で確定)**: 行の背景を変えない(▲だけが読み手への目印。NG の赤背景 `#fde8e8` は付けない)。職長の `selfResult=ok` は §5.3.1 の `MEASURE_OVER_TOL_OK` で提出できないため、実際に現れるのは**管理者の `qaResult=ok` の行**(ユーザー決定 2026-10-20: 管理者は許容超に `ok` を付けられる)。管理者の許容超 `ok` は項目コメント `qaNote` が必須(§5.3.1 `QA_OVER_TOL_COMMENT_REQUIRED`)なので、その行の「管理者コメント」列(§10.2b-A)には必ず理由が出る。PDF の表示規則は変えない(▲と管理者コメントで足りる)。

### 10.3 生成方法(GAS)
1. 記録の詳細・Notes・判定Events・写真メタをシートから取得(権限は `generateReport` の `authorize`)。
2. **生成方式は Config `reportEngine`(§10.5.1)で決まる**。`doc` のときは §10.5 の方法で PDF を作り、例外ならこの手順2〜4(HTML方式)に切り替える(§10.5.8)。以下 2〜4 は HTML方式。インラインCSSのみのHTML文字列を組み立てる(**レイアウトは table と固定サイズのみ。§10.2b**。`<title>` に `subject`(HTMLエスケープ)。外部リソース不可。日本語フォントはPDF変換側の既定を使用。**HTML方式は `@page{size:A4}` を無視してレターサイズになる(版1.10.1 の実機確認)ため、用紙を指定できる Google ドキュメント方式を §10.5 に追加した**。P-17)。
3. 写真サムネは Drive の `thumbFileId` からバイト列を取得して `data:image/jpeg;base64,…` として埋め込む(`kind=photo` のみ。図面は §10.2c で本体を埋め込む。写真ページの60枚上限・並びに図面を含めない)。
4. `HtmlService.createHtmlOutput(html).getBlob().getAs('application/pdf').setName(name)`。ファイル名 `{subject}_{段階名}_v{version}_{YYYYMMDD-HHmm}.pdf`(§10.2a)。
5. `reports/{siteId}_{現場名}/` に保存。`Config.pdfShareMode=anyone_with_link` なら `file.setSharing(ANYONE_WITH_LINK, VIEW)`、`private` なら共有しない(P-32)。`url = file.getUrl()`。
6. PDF本体の SHA-256 を計算し `Reports` に追記(`version` = その記録の既存最大+1)。Events `report_generated`。応答 `Report`(§5.1)。
7. タイムアウト目安120秒。写真が多い場合は上記60枚上限で抑える。

### 10.4 フロント側
M6 で生成中表示 → 完了後に版・URL・共有ボタン。`navigator.share({title,url})` が使えれば共有シート、なければリンクのコピー。URLは外部(Drive)なので新しいタブで開く(`rel="noopener"`)。

### 10.5 Googleドキュメント方式(`reportEngine=doc`)(版1.10.1。ユーザー了承 2026-10-17)

**背景**: 現行の `HtmlService.createHtmlOutput(html).getBlob().getAs('application/pdf')`(HTML方式)は、HTMLに書いた `@page{size:A4;margin:12mm}` を**無視**し、実機では**レターサイズ(215.9×279.4mm)**のPDFになることが確認された(§10.2 は「A4縦、余白12mm」)。HTML方式では用紙を指定できないため、**用紙サイズを明示できる方式を追加**する。現行のHTML方式は**残す**(切替とフォールバックの両方で使う)。

#### 10.5.1 切替(Config `reportEngine`)と全体の流れ
- Config `reportEngine`(str。`html` または `doc`。**既定 `html`**。§2.14)。値は `Cfg.get('reportEngine')` を `String().trim().toLowerCase()` した結果が `doc` のときだけ doc 方式、**それ以外(空・欠落・`html`・不正値・大文字違いを除く綴り違い)は全て `html`**。`generateReport` の呼び出しごとに読む(参照キャッシュの TTL は §2.15 のとおり最大60秒)。**サーバー専用で `bootstrap.config` に含めない**(`keepWarmMinutes` と同じ)。
- 既定を `doc` に変えるかは**ユーザーが実機で見た目を確認してから**(§10.6)。既定の変更は別の版で行い、本版では `html` のまま。
- `act_generateReport` の流れ(§10.3 の手順 2〜4 を次に置き換える。他の手順・権限・版・ファイル名・保存先・`Reports` 追記・Events・応答は**現行のまま**):
  1. エンジンを決める(上の規則)。
  2. `doc` なら `buildReportPdfBlobDoc_(...)`(§10.5.2〜10.5.6)を `try` で呼ぶ。**例外が出たらフォールバック**(§10.5.8)。`html` なら現行どおり `buildReportHtml_` → `HtmlService...getAs('application/pdf')`。
  3. どちらの方式でも、得た PDF blob に `setName(name)` する(名前は §10.2a)。以降(`bytes`・フォルダ・`createFile`・共有・`sha256`)は現行と同じ。
- 実装の分け方(推奨): `Report.gs` の肥大化を避けるため、doc 方式は新ファイル `backend/ReportDoc.gs` に置く(CLAUDE.md §4「1ファイルを肥大化させない」)。`buildReportHtml_` と共有する部品(`reportSubject_`・`STAGE_LABEL_`・`statusLabel_`・`measureView_`(版1.11.0。旧 `measureText_` の置き換え。§10.2d-4)・`reportSnapshotHash_`・`dtShort_`・結果ラベルの表記)は `Report.gs` のものを**そのまま呼ぶ**(表記を二重定義しない)。

#### 10.5.2 文書の用紙・余白・フォント(定数。コードの先頭に名前付きで置く)
| 定数 | 値 | 備考 |
|---|---|---|
| `PAGE_W_PT` / `PAGE_H_PT` | **595.28 / 841.89** | A4縦。`body.setPageWidth()` / `setPageHeight()` で設定(幅<高さ=縦) |
| `MARGIN_PT` | **34.02**(=12mm) | `body.setMarginTop/Bottom/Left/Right(34.02)` |
| 本文領域の幅(名目) | 527.24pt(=186mm) | 余白引き後の幅。**表の列幅の合計はこの値ではなく実効値(次の行)にする** |
| `TABLE_W_MM`(表の実効幅。版1.10.2) | **184mm(=521.57pt)** | 全ての表の列幅の合計。**名目の列幅(本書の各表の mm)に `184/186` を掛けた値**を `setColumnWidth` に渡す。根拠: 実PDF(2026-10-19)で名目186mmの表が右余白へ約2mm(約6pt)はみ出した。Googleドキュメントは列幅の外側に罫線とセル余白ぶんが付くため。値は定数1か所(`REPORT_DOC_TABLE_W_MM`)で、実機確認で調整する(設計担当が決める) |
| `FONT` | `Noto Sans JP` | 文書全体(本文・表・ヘッダ見出し・フッタ)。最後に `body.editAsText().setFontFamily(FONT)`、フッタにも同様 |
| 本文 / 表 / 注記 / フッタ / h1 / h2 の文字サイズ | **7.5 / 7.5 / 6 / 6 / 12 / 9 pt** | HTML方式の 10/10/8/8/16/12px に対応(px×0.75) |
| 文字色 | 本文 `#111111`、補助ラベル(`職長:` 等) `#555555`、NG `#CC0000`(太字)、注記 `#444444` | |
| 罫線 | 太さ **0.75pt**、色 `#666666`(表ごとに `setBorderWidth` / `setBorderColor`) | 見出し行の背景 `#EEEEEE`、NG行の背景 `#FDE8E8`(行の全セル) |
| セル余白 | 上下 2pt、左右 3pt(`setPaddingTop/Bottom/Left/Right`) | 写真ブロックだけ上下 3pt |
- **mm→pt の換算は 1mm = 72/25.4 pt**(186mm=527.24pt、184mm=521.57pt、62mm=175.75pt)。表の列幅は `table.setColumnWidth(i, pt)`。**以降の節に書く列幅(mm)は名目値**で、実際に設定する値は `名目mm × 184/186`(下 §10.5.3〜10.5.5。合計は 184mm=521.57pt、±0.5)。行の最低高(6mm・62mm・36pt など)と文字サイズ・余白は縮めない。
- **フォントが使えない場合**: `setFontFamily('Noto Sans JP')` は未知の名前でも例外にならず、Google ドキュメントが代替フォントに置き換える(日本語は表示される想定だが**未確認**)。コードでフォントの有無は判定しない。**文字化け(□や?)が出たら**、`FONT` を `Noto Serif JP` → `M PLUS 1p` → `Sawarabi Gothic` の順に試す(設計担当が §10.6 の結果を受けて決める。バックエンド担当が勝手に変えない)。1か所の定数だけで変えられる作りにする。
- 一時ドキュメントは `DocumentApp.create(title)`。`title` = `'_tmp_report_' + recordId + '_' + stamp`(`stamp` はファイル名と同じ `YYYYMMDD-HHmm`)。共有しない。マイドライブ直下に作られる(移動しない)。

#### 10.5.3 1ページ目以降(§10.2 の項目 0〜6 に相当)の構造
上から順に `body.appendParagraph` / `body.appendTable`(最初の空段落は見出しに再利用して空行を残さない)。表は `appendTable(cells)` で作り、`setColumnWidth` / 罫線 / 背景 / 余白を設定する。**セル内の文字は最初の空段落を再利用**し、2行目以降だけ `cell.appendParagraph()`(空段落を余らせない)。
1. h1: `subject`(§10.2a)。12pt 太字。
2. 段落: `型枠工事 {段階名}検査記録`。
3. **基本情報表**(4列。列幅 **30 / 63 / 30 / 63 mm**(名目。実効は ×184/186))。行の構成・出す/出さない条件・文言は `buildReportHtml_` と**同一**(現場名/元請会社名、職長の会社名/職長(会社名が空なら行ごと出さない)、階・工区・打設箇所/段階、打設予定日時/記録ID(**出来形は「打設予定日時」を出さず、`記録ID` の行は 2列目に記録ID、3・4列目は空セル**。HTML方式の colspan=3 の代わり。セルの結合は使わない)、ステータス/提出ラウンド、生成日時/版)。ラベル列(1・3列目)は背景 `#EEEEEE`・太字。
4. h2「サイン欄(3者)」+ **サイン表**(3列 名目 **62 / 62 / 62 mm**、2行: 見出し行 `職長`/`品質管理者`/`元請`、本文行)。本文行は最低高 **36pt**(`TableRow.setMinimumHeight`)。セルの中身(行ごとに段落): 職長=氏名/会社名/提出日時/`PIN認証による電子サイン`(未提出は `未`)、品質管理者=氏名/会社名/判定日時/`判定: 合格`(合格でなければ `未`)、元請=署名済みは担当者名/方法/`記録者: …`/日時、未署名は `氏名 ______________ 日付 ______________` と `署名・押印` の2段落。HTML方式の `<br>` 区切りと同じ並び。
5. 打設停止履歴の段落(あるときだけ。HTML方式と同文)。
6. h2「結果サマリ」+ 表(4列 名目 **30 / 52 / 52 / 52 mm**。`(空) | 合 | NG | 該当なし` / `職長 | n | n | n` / `管理者 | n | n | n`。集計の規則は HTML方式の `cnt` と同じ)。
7. h2「項目表」+ **項目表**(7列 名目 **8 / 40 / 14 / 18 / 46 / 30 / 30 mm**(版1.11.0。旧 8/62/14/18/24/30/30)。見出し `No.|項目|職長結果|管理者結果|実測(設計値との差)|職長コメント|管理者コメント`)。各行の最低高 **6mm**(17.0pt)。NG行(`selfResult` または `qaResult` が `ng`)は全セルの背景 `#FDE8E8`。セルの内容(`★`・`合/NG/該当なし`・重大/軽微の括弧)は HTML方式と同じ。**実測セルは §10.2d の書式**(有効値のある側ごとに2段落。許容超の部分だけ `setText` 後の範囲指定で太字・`#CC0000`。要約の `▲許容超n件` も同様)。実測が無ければ空セル(空段落1つ)。**職長コメントと管理者コメントは別の列**(§10.2 の5)で、どちらも全文。
   - **HTML方式との違い(許容)**: Google ドキュメントの表は「折り返さない・高さ固定・はみ出しを隠す」を指定できないので、**全ての列で折り返しが起きうる**(行の高さは内容に応じて伸びる)。文字を勝手に切り詰めない(情報を落とさない)。そのため項目表が長くなり、1ページ目に収まらず**次のページへ流れてよい**(下の 10.5.7)。**版1.11.0 で HTML方式も全列折り返し(§10.2b-A)にしたので、この点の HTML方式との差はなくなった**。
8. 注記段落(6pt、`#444444`): **§10.2d-8 の文を、条件つきで**(許容ありの実測が1つでもあるときだけ)。版1.11.0 で従来の注記 `管理者コメントの全文は写真ページおよび電子記録で確認できます。` は**廃止**(管理者コメントは項目表に全文が出る)。
9. **確認箇所(図面)**(§10.2c。図面があるときだけ。最大6枚、超過は「他N枚は電子記録で閲覧可」): 図面1枚ごとに `body.appendPageBreak()` → §10.5.4。
10. h2「NG・是正の経過」と段落群(HTML方式と同文。`判定履歴なし` / 判定ごとの1段落 / `提出回数: n`)。
11. `body.appendPageBreak()` → h2「写真」→ §10.5.5。
- **全ての h2 見出し**(確認箇所(図面)/サイン欄(3者)/結果サマリ/項目表/NG・是正の経過/写真)に **`paragraph.setKeepWithNext(true)`**(版1.10.2。見出しだけがページ末に孤立し、表が次のページへ流れるのを防ぐ)。書式は h2 の共通定数 1か所にまとめる。h1 や注記段落には付けない。
- 改ページは `appendPageBreak()`(= 直前の段落の後に改ページ文字を入れる)。**HTML方式で `page-break-before:always` が付いていた箇所(図面ごと・「写真」見出しの前)と同じ位置**にだけ入れる。

#### 10.5.4 確認箇所(図面)の1ページ(§10.2c の再現)
- h2「確認箇所(図面)」、段落 `{職長|管理者}: {氏名} / {登録日時}`。
- **画像**: 図面**本体**(`Photos.driveFileId`)を `DriveApp.getFileById(id).getBlob()` で取り、1行1列の表(罫線なし `setBorderWidth(0)`、**列幅 184mm=521.57pt**。**セル余白は上下左右とも0**=枠いっぱいの画像を列幅に収めるため)のセルの最初の段落に `paragraph.appendInlineImage(blob)` で挿入し中央寄せ。**大きさは「枠に収める」**: 枠=幅 **184mm(521.57pt)× 高さ 約168.2mm(476.71pt)**(名目 186×170mm に 184/186 を掛けた値。縦横比は名目と同じ)。画像の実寸 `img.getWidth()/getHeight()`(挿入直後の値。比率の取得に使う。`Photos.width/height` が正のときはそちらを優先)から `scale = min(枠幅/幅, 枠高/高)` を求め `setWidth`/`setHeight`(縦横比を保ち、引き伸ばして枠いっぱいになるのは HTML方式と同じ)。
- 画像が読めない(例外・比率が取れない)ときは、画像の代わりに `画像を読み込めませんでした` の段落(この場合は**フォールバックしない**。ページ全体は出す)。
- 印が0個なら `印の書き込みなし`、あれば**凡例の表**(**6列** 名目 **24 / 76 / 28 / 24 / 17 / 17 mm**(版1.11.0。旧5列 24/82/24/28/28)、見出し `番号|項目|実測値|許容超|職長|管理者`、各行の最低高 6mm)。**見出し行・番号行・1行形式の項目の作り方、系列S、許容超の印は §10.2c-3 と §10.2d に同じ**(結果のNGは赤・太字)。**セルの結合は使わない**ので、項目ごとの見出し行は「番号列=`No.N`、項目列=項目文+要約の2段落、実測値列・許容超列は空セル、職長列・管理者列=結果」の通常の6セルで作り、背景 `#EEEEEE` を全セルに付ける。番号行の `▲` と許容超の値は太字・`#CC0000`。
- 印は画像に焼き込み済み。描き足さない。

#### 10.5.5 写真ページ(§10.2b-B の再現。1ページ最大4枚)
- 対象・順序・上限は HTML方式と同じ(図面を除く `kind=photo` を、NG項目の写真を先にして、最大60枚。超過は表の後に段落 `他{N}枚は電子記録で閲覧可`)。
- **1枚=1つの表**(2列×1行)。列幅 名目 **83mm / 103mm** の ×184/186 = **約82.11mm(232.75pt)/ 約101.89mm(288.83pt)**(合計184mm)。行の**最低高 62mm(175.75pt)**(`setMinimumHeight`)。罫線は項目表と同じ。セルの垂直位置: 左=中央、右=上。
- **左セル(写真)**: サムネ(`Photos.thumbFileId`)の blob を `paragraph.appendInlineImage(blob)`、段落は中央寄せ・段落前後の間隔 0・行間 1.0。**大きさは枠に収める**: 枠=**幅 約79.14mm(224.33pt)× 高さ 約57.38mm(162.64pt)**(名目 80×58mm に 184/186 を掛けた値。縦横比維持。左列 82.11mm から左右余白 3pt×2 を引いた約80.0mm に収まる。縦長は高さ上限、横長は幅が先に効く)。比率は図面と同じ求め方。読めないときは何も入れない(空のセル。HTML方式と同じ)。
- **右セル(情報欄)**: 段落を上から。HTML方式 §10.2b-B の1〜7と同じ内容・同じ順(項目No.と項目文(太字、★付き)/ `職長: {結果} / 管理者: {結果}`(`職長:` `管理者:` のラベルは `#555555`、NGは `#CC0000` 太字+重さ)/ **実測**(有効値のある側だけ。**§10.2d の書式**: `実測(職長): {値}` と要約の2段落、続けて `実測(管理者): …` と要約の2段落。許容超の部分は太字・`#CC0000`。版1.11.0)/ `職長コメント: {全文}` / `管理者コメント: {全文}`(別段落)/ `撮影: {職長|管理者|元請サイン証跡}` / スタンプ文字(6pt `#444444`))。**項目に紐づかない写真は 撮影者区分とスタンプ文字の2段落のみ**(§10.2b)。情報欄が長くても行は伸びてよい(HTML方式の「切れる」との違い。ただし 62mm を超える長文は4枚が1ページに収まらなくなる恐れがある=§10.5.7)。
- **ブロックの間隔と改ページ**: 各表の直後に、フォント 3pt・段落前後 0 の空段落を1つ(`appendParagraph('')`。表が連続すると結合されるのを避ける)。**4の倍数枚目(4・8・12…)のブロックの後は、その空段落の代わりに `body.appendPageBreak()`**。ただし**最後の写真のブロックの後には改ページを入れない**。
- **余白の見積り(根拠)**: 本文領域の高さ = 841.89 − 2×34.02 = 773.85pt。4ブロック 4×175.75=703.0pt + 間隔 3×約5pt + 見出し(1ページ目のみ)約16pt ≒ 734pt で、フッタ(下余白内)を引いても収まる見込み(**実機未確認**)。収まらず写真ページが5ページ目にはみ出す場合に備え、**予備の値**を決めておく: ブロック最低高 **60mm(170.08pt)**、画像の高さ上限 **55mm(155.91pt)**。この予備値への変更は、§10.6 の実機確認の結果を受けて**設計担当が SPEC に反映してから**実装する(バックエンド担当は報告のみ)。

#### 10.5.6 フッタとページ番号
- `doc.addFooter()` に1段落: `記録ID: {recordId} / 電子記録ハッシュ(SHA-256): {64桁}`(6pt、`#444444`)。ハッシュは `reportSnapshotHash_` で HTML方式と**同じ値**。
- **ページ番号は出さない**。Apps Script の DocumentApp には「ページ番号」フィールドを挿入する手段が無い(`FooterSection` に自動番号の API が無い)ため。フッタは**全ページに出る**(HTML方式は末尾に1回だけだったので、この点は doc 方式のほうが §10.2 の8に近い)。HTML方式も実際にはページ番号を出していない(§10.2 の8の「ページ番号」は未実装。版1.10.1 で明記)。
- HTML方式の末尾の `<div class="foot">`(記録ID・ハッシュ)に相当する本文末尾の段落は、doc 方式では**作らない**(フッタと二重になるため)。

#### 10.5.7 HTML方式との出力の差(許容する差)
| 項目 | HTML方式 | doc 方式 | 判定 |
|---|---|---|---|
| 用紙 | レター(215.9×279.4mm)になってしまう | **A4縦 210×297mm・余白12mm** | doc が正。この差が導入の目的 |
| 項目表の折り返し(版1.11.0 で差を無くした) | **全列で折り返す**(§10.2b-A)。行は最低6mmで内容に応じて伸びる | 同じ(全列で折り返しうる) | **差なし**。1ページ目から溢れても次ページへ流れる(表の見出し行は次ページで繰り返さない。DocumentApp にその指定が無い) |
| 1ページ目の溢れ | 自然に次ページへ | 同じ | 同じ。写真・図面の見出しは必ず新しいページから始まる |
| 写真・図面の大きさ | 横長は幅指定、縦長は高さ指定(枠は別) | 全て「枠に収める」(約79.1×57.4mm、図面は約184×168.2mm。名目 80×58 / 186×170 の 184/186 倍) | **許容**(横長4:3の写真は 約76.5×57.4mm とわずかに小さい) |
| 情報欄が長い | 62mm枠で切れる | 行が伸びる(5ページ目にはみ出す恐れ) | 許容。極端な長文は §10.6 で確認 |
| フォント | PDF変換側の既定(環境依存) | `Noto Sans JP`(代替あり) | 許容。文字化けは不可 |
| フッタ | 末尾に1回 | 全ページ | doc が望ましい |
| ページ番号 | なし | なし | 同じ(出さない) |
| 内容・文言・並び・NGの赤・別欄 | — | 同一 | **差を出さない** |
| PDFの `sha256` | 生成ごとに異なる | 同じ | 変わらない |
- **変えないもの**: PDFファイル名(§10.2a)、保存先(`reports/{siteId}_{現場名}/`)、共有設定(`pdfShareMode`)、`Reports` の列と追記内容、版、`Report` 応答、メール添付(`Reports.driveFileId` のファイル。現行と同じ)、`report_generated` の発行(`detail` は §10.5.8 のとおり**キーを足すだけ**)。

#### 10.5.8 変換と後始末、失敗時のフォールバック(必須)
- **変換**: 文書を組み立て終えたら `doc.saveAndClose()` → `DriveApp.getFileById(docId).getAs('application/pdf')`(Document 本体ではなく **Drive のファイル経由**で変換する。用紙設定は文書の設定が使われる)。得た blob に `setName(name)`。
- **一時文書の削除**: 成功・失敗を問わず `finally` で `DriveApp.getFileById(docId).setTrashed(true)`(ゴミ箱へ。完全削除はしない。ゴミ箱の保持は Google の既定)。削除に失敗しても例外にせず `Logger` に出すだけ。ゴミ箱に入った文書は他の人に共有されない。一時文書の作成・ゴミ箱入れは Drive の書込みなので、`driveLog` には `create` / `trash` として出る(PDF の保存と同じ `lockHeld` の扱いにする。変えない)。
- **フォールバック**: doc 方式の組み立て・変換のどこかで**例外**が出たとき(承認未了=`Authorization is required`、権限エラー、Drive/Docs のクォータ、変換失敗、表・画像の挿入エラー、§10.5.9 の時間超過など)、**その場で HTML方式に切り替えて PDF を必ず作る**。
  1. 一時文書があればゴミ箱へ。
  2. `Logger.log('generateReport: reportEngine=doc に失敗したため html で生成します: ' + 理由)`(理由=例外メッセージ。秘密情報を含めない)。
  3. HTML方式で生成(以降は現行どおり。**`Reports` 行・名前・保存先・共有・メール添付は通常と同じ**)。HTML方式も失敗したら従来どおり `DRIVE_ERROR`。
  4. **フォールバックの記録(既存の列を増やさない)**:
     - Events `report_generated` の `detail`(JSON。§2.11)に**キーを足す**: 常に `engine`(`'doc'` または `'html'` = **実際に使った方式**)。フォールバックしたときは加えて `fallbackFrom:'doc'` と `fallbackReason`(例外メッセージの先頭200文字。PIN・トークン等を含めない)。例: `{reportId, version, engine:'html', fallbackFrom:'doc', fallbackReason:'Authorization is required to perform that action.'}`。通常の html なら `{reportId, version, engine:'html'}`、doc 成功なら `{reportId, version, engine:'doc'}`。
     - 生成した PDF の Drive ファイルの**説明(`file.setDescription`)**に `engine=doc` / `engine=html` / `engine=html (fallback from doc: {理由の先頭100文字})` を入れる(Drive の「詳細」で見える。失敗しても例外にしない)。
  - 次は**フォールバックしない**: 権限・状態のエラー(`REPORT_NOT_ALLOWED` ほか `ApiError`)、個々の画像の読み込み失敗(§10.5.4/10.5.5。空欄・代替文で続行)。
  - フォールバックしたことは**クライアントには返さない**(応答 `Report` は同じ。画面の変更なし)。確認は Events と Drive の説明で行う(§10.6)。
- **時間の上限**: doc 方式の組み立て開始から **80秒**(`Util.now()` で計る。表・写真1枚ごとの区切りで確認)を超えたら内部の例外(メッセージ `REPORT_DOC_TIMEOUT`。API のエラーコードではない)を投げてフォールバックする。クライアントのタイムアウトは120秒(§1.4)。写真の多い記録の所要時間は**未計測**(§12.7 の REAL-PDF-04 で測る)。

#### 10.5.9 権限(GASのスコープ)と承認
- `DocumentApp` には `https://www.googleapis.com/auth/documents` が要る。`backend/appsscript.json` は `oauthScopes` を**明示している**ので、**このスコープの追記が必要**(§1.3)。バックエンド担当が `appsscript.json` に追記し、`docs/DEPLOY.md` の3-4(スコープ一覧の説明)にも書き足す。`drive`(既に有り)で一時文書のPDF変換・ゴミ箱入れはできる。
- 追記したマニフェストを GAS に貼り替えただけでは**承認されない**。承認が済むまで `DocumentApp` の呼び出しは「承認が必要」の例外になる(→ §10.5.8 により**HTML方式で生成される**ので、画面は止まらない)。
- **ユーザー(スクリプトの所有者)の手順**(`docs/DEPLOY.md` と `docs/OPERATIONS.md` に書く):
  1. `appsscript.json` を `backend/appsscript.json` の内容に置き換え、`ReportDoc.gs` ほかを貼り替える(DEPLOY.md の手順)。
  2. GAS エディタで関数 **`checkReportEngine`** を選んで「実行」する。初回は承認画面が出る(「権限を確認」→ アカウント選択 →「詳細」→「(安全ではないページ)に移動」→ ドキュメントの作成・編集の権限を許可)。実行ログに `OK: doc 方式の変換に成功しました(A4 595.28×841.89pt)` と出れば成功。
  3. 「デプロイ」→「デプロイを管理」→ 鉛筆 → 新バージョン → デプロイ(Webアプリの実行ユーザーの承認を更新するため)。
  4. 上記が済んでから Config `reportEngine=doc` を Claude に依頼して設定する(§10.6)。
- **`checkReportEngine()`**(GASエディタ専用。action ではない。`ACTIONS` に登録しない=action数43のまま。`ReportDoc.gs` に置く): 1ページだけの試験文書(見出し1行・2×2の表・日本語の文)を §10.5.2 の用紙設定で作り、§10.5.8 の変換と後始末まで行って、`'OK: doc 方式の変換に成功しました(A4 595.28×841.89pt)'` を返す。失敗したら例外メッセージをそのまま返す(握りつぶさない)。シート・Config・Events・Reports・Properties には**書かない**(Drive では一時文書の作成とゴミ箱入れだけ)。

### 10.6 実機確認の手順(`docs/OPERATIONS.md` に項目として書く。実装担当が書く。版1.10.1)
見た目(レイアウトの崩れ)は実GASでしか確認できない(§12.7)。ユーザー(責任者)が1件の記録で次を行う。

1. **前提**: §10.5.9 の手順1〜3が済んでいる(`checkReportEngine` が OK)。
2. **記録を用意**: 打設前でも出来形でもよい。`qa_ok` または `approved` で、**写真5枚以上(4枚+1枚)、NG項目が1つ以上、図面1枚、職長コメントと管理者コメントが入った記録**。
3. **doc 方式で生成**: Claude に Config `reportEngine` を `doc` にするよう依頼(約1分で反映)。アプリのその記録の画面(S08)で PDF を生成する。
4. **用紙を見る**: Drive の `reports/{現場}/` の PDF を開き、**ファイルのプロパティで A4(210×297mm)**になっていること(PDFビューアの「ドキュメントのプロパティ」、またはChromeで開いて印刷画面の用紙サイズ)。レター(8.5×11インチ)なら失敗。
5. **見た目のチェック表**(全部に○を付ける。×は内容を設計担当へ):
   - 文字化け(□・?・抜け)がない。日本語、★、`±`、`〜`、丸数字、`≦` などが出ている
   - 写真ページで**1ページに4枚**入り、5枚目が次のページの先頭になる。5ページ目へはみ出す、**白紙ページ**がない
   - 写真の縦横比が崩れていない(引き伸ばされていない)。縦長が枠からはみ出さない
   - 1ページ目: 件名・基本情報・サイン欄(3者)・結果サマリ・項目表が出ている。項目表が長くて次のページへ流れても表が崩れていない
   - NG行が薄い赤、NGの文字が赤。職長コメントと管理者コメントが別の列・別の行
   - 図面のページ: 図面が1ページに収まり、凡例の表が下に出ている。**項目ごとにまとまり(グレーの見出し行に項目名と要約)、番号行に実測値、許容超の行に赤い `▲` が出ている**(版1.11.0)
   - **項目表の実測**: 値が切れずに全部読める(10個でも折り返して全部出る)。職長・管理者が別々の行で、許容超の値が赤太字+`▲`、下の行に `n=… 最小/最大/許容±…` がある。管理者コメントが切れずに全文出ている(版1.11.0)
   - フッタに記録IDとハッシュが全ページにある(ページ番号は出ない=仕様)
   - 生成にかかった時間(押してから完了まで)を書き留める(60秒を超えるときは報告)
6. **フォールバックしていないことの確認**: Drive でその PDF の「詳細」の説明が `engine=doc` であること(`engine=html (fallback from doc: …)` なら doc が失敗している。理由を設計担当へ)。または Events シートの `report_generated` の `detail` に `"engine":"doc"` があること。
7. **比較**: `reportEngine` を `html` に戻して同じ記録で生成し、HTML方式(レターサイズ)との違いを見る。
8. **判断**: 見た目がよければユーザーが「既定を `doc` にする」と指示する(= SPEC の既定の変更。別の版)。よくなければ `reportEngine` を `html` のままにし、× の内容を設計担当へ(レイアウト値の調整は設計担当が SPEC を直してから実装)。
9. **元に戻す**: いつでも Config `reportEngine` を `html`(または行を空)にすれば現行の方式に戻る(約1分で反映)。ゴミ箱に残る一時文書は Google の既定で自動削除される。


---

## 11. モックサーバー(`mock/`)が満たすべき振る舞い

### 11.1 位置づけ
- モックは **本物のGASと同一のAPI契約**(本書 §1.5〜§6)を提供するNodeサーバー。依存パッケージなし(Node 22標準のみ)。フロント開発・E2E・契約テストの相手になる。`node mock/server.js [--port 8787] [--latency 0] [--persist]`(環境変数 `MOCK_PORT` / `MOCK_LATENCY_MS` / `MOCK_REDIRECT=1` も可)。
- 契約テストは **同じテストを mock(8787)・GAS互換ハーネス `backend/harness`(8788)・実GAS(手動。`API_URL`指定)** に対して実行できること。差異が出たら本書を正としてどちらかを直す。

### 11.2 HTTP仕様(GAS同等)
- `POST /api`: `Content-Type: text/plain;charset=utf-8` の本文JSONを処理。応答は `Content-Type: application/json;charset=utf-8`、**常にHTTP 200**、`Access-Control-Allow-Origin: *`。
- `GET /api?action=ping`: §1.5。それ以外のGETは `BAD_REQUEST`。
- **`OPTIONS` は 405 を返し CORS ヘッダを付けない**(プリフライトが必要なリクエスト=`application/json` などをフロントが送ると、ブラウザで失敗する。GASと同じ)。
- `MOCK_REDIRECT=1`: `POST /api` に 302 を返し `Location` を `/api-echo/{一時ID}` にし、そこをGETで取ると同じ応答本文を返す(GASの302挙動の再現。フロントの `redirect:'follow'` 検証用。既定は無効)。
- `GET /files/reports/{name}`: 生成したPDFを配信(`Content-Type: application/pdf`)。
- 遅延注入 `--latency N`(各リクエストの先頭でNミリ秒待つ)。

### 11.3 ロジック(§1.6のdispatcher順を同一に実装)
- 全43 actionを実装し、権限(§4。`authorize` と同名関数)・検証(§5.3.1)・状態遷移(§6)・エラーコード/`error.data`(§5.3)を本書通りに返す。
- **段階(版1.9。§6.8)**: `createRecord` は `enabledStages` に無い値・その段階の有効項目0件で `STAGE_NOT_ENABLED`、`pourPlannedAt` は `pre_pour` のみ保存。`stopPour` と `allowedActions` の `stopPour` は `stage=pre_pour` のみ(出来形は `STATE_CONFLICT`)。`computeTiming` は `post_demold` で全て `null`/`false`(`warnings` なし)。エスカレーションは段階を見ない。メール件名は出来形のとき末尾に ` 出来形`。PDFは段階名・ステータス表示名・打設予定日時の有無が §10 のとおり。
- **ロック**: 更新系は1本のFIFOミューテックスで直列化し、「冪等キー確認→authorize→PIN→更新→Events→Idem保存」を原子的に行う(同時claimで先着のみ成功する)。`--latency` は直列化の前に適用する(並行到着を再現)。**例外 `uploadPhotoChunk`(版1.4)**: 認証・検証・仮想Drive保存はミューテックスの **外**、再認証〜既存行確認〜上限確認〜Photos追記〜touchだけをミューテックスの **内** で行い(§5.4.4)、ミューテックスの前後で必ずイベントループに制御を返す(`await`)こと(別リクエストが間に割り込める。`/__mock/interleave` もこの境界で適用する)。仮想Driveに作ったファイルは、ロック内で `Photos` 行にならなかった場合に削除(ゴミ箱扱い)する。
- **冪等キー**: §5.2 通り(`replayed:true`、`IDEMPOTENCY_CONFLICT`、RecordDetail系の再構築)。
- **更新後の記録(版1.10。§5.1a)**: §5.1a の表の action は、本処理のあと `getRecord` と同じ関数で `record` を作って返す。`Idem` には従来の形で保存し、再生時に最新のDetailへ差し替える。`Config` の初期値に `keepWarmMinutes=5` を含め(`bootstrap.config` には出さない)、状態ダンプにも出す。`installKeepWarmTrigger` 等のGASエディタ専用関数はモックの対象外。
- **PIN/トークン**: §3 通り。`pinHash`/`tokenHash` は同アルゴリズムで保持(ペッパー=`mock-pepper`)。状態ダンプ(`/__mock/state`)に `pinHash`/`pinSalt`/`tokenHash`/招待`codeHash` を出さない。
- **時計**: すべての時刻・期限・エスカレーションはモックの仮想時計 `now()` を使う(初期値=起動時の実時刻。`/__mock/clock` で変更)。`meta.serverTime` も仮想時計。
- **エスカレーション**: `escalationTick` を **各リクエスト処理の直前に遅延実行**し、`/__mock/tick` でも実行可。送信メールは送らず記録だけ(`/__mock/mails`)。
- **写真**: 単発(`total=1`)はキャッシュを使わず、1リクエストで §5.4.4 の検証→「仮想Drive」(メモリのMap。パスは§7.4の構造)に保存→ロック内で Photos 追記。分割は、チャンクをメモリのキャッシュ(仮想時計で6時間TTL。`/__mock/evictChunks` で全消去)に保存し、最終チャンクで検証→仮想Driveに保存。仮想Driveの作成・削除は `lockHeld` 付きで履歴に残す(`/__mock/driveLog`)。`/__mock/drive` は **削除(ゴミ箱)されていない** ファイルの一覧。`getPhotoThumbs`/`getPhoto` は保存したバイト列を `data:` URLで返す。参照シートのキャッシュ(§2.15)はモックでは実装しなくてよい(常に最新を返すのは契約に適合する)。
- **PDF**: 手書きの最小PDF(ASCIIのみ。`MOCK REPORT {recordId} v{n} {status} stage={stage}` の行を含む(版1.9: 末尾に段階を付ける)、先頭 `%PDF-`)を生成し `/files/reports/{名前}` で配信(`{名前}` は §10.2a のファイル名。日本語を含むので `url` は `encodeURIComponent` した形、配信側は復号して照合)、`Reports` に追記、`url` は `http://{host}/files/reports/{名前}`。`sha256` は実バイト列のハッシュ。
- **PDFの生成方式(版1.10.1)**: mock は Config `reportEngine` を**読まず、常に今の最小PDFを返す**(用紙・レイアウトは検証対象外=§12.7)。ただし Config の初期値に `reportEngine=html` の行は持つ(spec-sync の `configKeys` と一致させるため。`getBootstrap.config` には含めない)。`/__mock/patch` で `Config.reportEngine` を書けること。
- **メール**: 送らず `mails` 配列に `{to,subject,body,at}` を追記(§6.6の宛先規則通り)。
- **Idem/Events/Notes**: 追記専用の挙動(更新・削除しない)を本物と同じに。

### 11.4 テスト用コントロール(`/__mock/*`。mock と harness が実装。実GASには存在しない。契約外なのでフロントは絶対に呼ばない)
全て `POST`(JSON本文)、応答は `{ "ok": true, "data": {…} }`。

| パス | 本文 | 内容 |
|---|---|---|
| `/__mock/reset` | `{ "now"?:"dt", "variant"?:"default|invited" }` | 全状態をシードに初期化し仮想時計を `now`(省略=実時刻)に設定。`variant=invited` は `u_sugiant` を `invited`(PIN無し)にし、招待コード `123456`(72時間有効)を用意 |
| `/__mock/clock` | `{ "set":"dt" }` または `{ "advanceMin":n }` | 仮想時計の変更 |
| `/__mock/tick` | `{}` | `escalationTick` を即時実行 |
| `/__mock/issueDevice` | `{ "userId" }` | PIN検証なしで端末を発行し `{deviceId,deviceToken}` を返す(テストの高速化用) |
| `/__mock/fail` | `{ "next":n, "mode":"http500|network|timeout|error", "code"?:"INTERNAL", "match"?:"action名", "after"?:true }` | 次のn件(`match` 指定時はそのactionのみ)の処理を失敗させる。`network`=接続を切断、`timeout`=応答しない(10秒)、`error`=`code` のエラー応答、`http500`=HTTP 500。**`after:true` は「処理(状態更新・冪等キー保存)を完了した後に」応答を返さず切断する**(応答喪失の再現。再送で二重実行にならないことの検証用。省略時は処理前に失敗させる) |
| `/__mock/evictChunks` | `{}` | 写真チャンクのキャッシュを全消去(`CHUNK_MISSING` 再現) |
| `/__mock/patch` | `{ "sheet":"Users", "key":"u_tanaka", "set":{…}, "keepCache"?:true }` または `{ "sheet":"Assignments", "insert":{…}, "keepCache"?:true }` | **スプレッドシート直接編集の再現**(Users/Sites/Assignments/Items/Config/Absences/**Devices** のみ可。列名・型はSCHEMA準拠で検証。`Devices` は端末の `status` 等を `set` する用途。`tokenHash` は指定不可)。**既定では参照シートのキャッシュ(§2.15)を破棄する**(テストを決定的にするため)。`keepCache:true` のときだけ破棄せず、「直接編集がキャッシュ期限(60秒)まで反映されない」状況を再現する(harnessのみ有効。モックは無視) |
| `/__mock/state` | `{ "sheet"?:"Records" }` | 状態ダンプ(秘密列を除く)。`sheet` 省略で全シートの行数 |
| `/__mock/mails` | `{}` | 記録したメール一覧 |
| `/__mock/drive` | `{}` | 仮想Driveのパス一覧 |
| `/__mock/meta` | `{}` | `{ actions:[…], errorCodes:[…], violationRules:[…], configKeys:[…], schema:{sheet:[columns]}, itemsSeedHash }`(spec-syncテスト用) |
| `/__mock/driveLog` | `{}` | 仮想Driveの書込履歴 `{ "log":[{ "op":"create|trash", "path", "fileId", "lockHeld":bool, "at":"dt" }] }`(reset で空に戻る)。`lockHeld` はその操作の時点で **スクリプトロック(モックは更新系ミューテックス)を保持していたか**。`/__mock/drive` は `create` から `trash` 済みを除いたもの |
| `/__mock/interleave` | `{ "action":"uploadPhotoChunk", "next":1, "patches":[ <patch本文> ] }` | 次のn件の該当リクエストについて、**ロック外処理(Drive保存)の完了後・ロック取得の直前**に `patches` を順に適用する(別リクエストが間に割り込んだ状態の再現)。`patches` の各要素は `/__mock/patch` と同形式で、加えて `{ "sheet":"Records","key":"r_…","set":{…} }` と `{ "sheet":"Photos","insert":{…SCHEMA準拠の全必須列…} }` も許可する。許可シートは `Records`/`Photos`/`Users`/`Assignments`/`Devices`(`Devices` は `status=revoked` への変更でロック内の再認証 `DEVICE_REVOKED` を再現できる)適用でキャッシュは破棄しない |
| `/__mock/cacheStats` | `{}` | 参照シートキャッシュ(§2.15)の状態 `{ "enabled":bool, "entries":[{ "key", "expiresAt" }], "hits":int, "misses":int, "skippedTooLarge":int }`。モックは `enabled:false` 固定(他は0/空)。harnessはCacheServiceの1値上限(100KB=102,400バイト)とTTL(仮想時計)をGASと同じに実装する |
| `/__mock/docShim` | `{ "failMode"?:"none|create|image|convert|slow", "reset"?:true }`(**harness専用**。mock は `{ok:false}` を返してよい) | `DocumentApp` の代役(shim)の制御と観測(版1.10.1。§12.3 C-REP-02〜05)。`failMode`: `none`(既定)/ `create`(`DocumentApp.create` が例外)/ `image`(`appendInlineImage` が例外)/ `convert`(Drive 経由の PDF 変換が例外)/ `slow`(文書の組み立て中に仮想時計を90秒進める=時間上限のフォールバックの再現)。`reset:true` で観測値を空に戻す(`/__mock/reset` でも戻る)。応答 `data`: `{ "counts":{ "created":n, "converted":n, "trashed":n }, "lastDoc":null または { "title", "pageWidth", "pageHeight", "margins":{"top","bottom","left","right"}, "fontFamily", "text":"本文の全文を連結した文字列", "pageBreaks":n, "images":[{ "w", "h", "inTableIndex":n|-1 }], "tables":[{ "rows", "cols", "colWidths":[pt…], "minRowHeights":[pt…], "borderWidth", "cellBackgrounds":[[色または null…]…] }], "footerText", "trashed":bool, "paragraphs":[{ "text", "keepWithNext":bool }…](版1.10.2。本文の段落ごとの観測。C-REP-03 の keepWithNext 用。表のセル内の段落は含めない)、**(版1.11.0。C-REP-08・C-DRAW-07 用)** `tables[i].cellTexts`:[[string…]…](行×列。セル内の複数段落は改行 `\n` で連結。空セルは `""`)、`coloredTexts`:{ "#CC0000":[string…], … }(文字色を付けた範囲の文字列を色ごとに。本文・表のセル内の両方)、`boldTexts`:[string…](太字にした範囲の文字列。本文・表のセル内の両方。段落全体を太字にしたものは段落の文字列全体) } }`。`lastDoc` は直近に**変換まで進んだ**文書。HtmlService 側の観測 `state.lastHtml` は reset で `null` に戻す(エンジン切替の検証用) |

### 11.5 シードデータ(`/__mock/reset` の既定。時刻は reset 時の `now` を基準にした相対値)
元請アカウントは作らない(元請はPDFのみ)。値は **全てテストが前提にする確定値**。

**Users**(全員 `active`、`failedCount=0`。PINはモック専用のテスト値で、**本番のSeed.gsには入れない**)

| userId | name | role | PIN | lang | qaQualified | email |
|---|---|---|---|---|---|---|
| u_tanaka | 田中 | foreman | 1111 | ja | FALSE | |
| u_sugiant | スギアント | foreman | 2222 | id | FALSE | |
| u_sato | 佐藤 | qa | 3333 | ja | TRUE | sato@example.test |
| u_suzuki | 鈴木 | qa | 4444 | ja | TRUE | suzuki@example.test |
| u_lead | 責任者 | lead | 9999 | ja | TRUE | lead@example.test |

**Sites**(全て `active`)

| siteId | name | floors | zones | primeContractor | joinKey |
|---|---|---|---|---|---|
| s_a | A現場(仮) | 1F,2F,3F | | ○○建設(仮) | joinkeyaaaaaaaa1 |
| s_b | B現場(仮) | 1F,2F | | ○○建設(仮) | joinkeybbbbbbbb1 |
| s_c | C現場(仮) | 1F,2F | 東,西 | △△組(仮) | joinkeycccccccc1 |

**Assignments**(全て `active=TRUE`、`validFrom=2026-01-01`、`validTo` 空)

| 現場 | qa_main | qa_sub | foreman(班) |
|---|---|---|---|
| s_a | u_sato | u_suzuki | u_tanaka(田中班) |
| s_b | u_sato | u_suzuki | u_tanaka(田中班)、u_sugiant(スギアント班) |
| s_c | u_suzuki | u_lead | u_sugiant(スギアント班) |

(Memberships は上記職長3行を `approved` で用意。承認者は各現場の `qa_main`。)
→ 見える現場: 田中=s_a,s_b / スギアント=s_b,s_c / 佐藤=s_a,s_b(**s_c は担当外**)/ 鈴木=s_c(主)・s_a,s_b(代行)/ 責任者=全て。

**Records**(`stage=pre_pour`、`lot=L1`、項目は i1〜i16 の16項目(**版1.9より前に作られた記録として扱い、i58〜i69 は持たない。シードの記録は変えない**)。`pourPlannedAt`=reset時の翌日09:00 JST。ID は右列)

| recordId | 現場/階(工区) | status | 作成者 | 内容 |
|---|---|---|---|---|
| r_seeda10000000000 | s_a / 1F | approved | 田中 | 職長・QAとも全項目ok、重点項目に写真、QA合格(佐藤)、元請サイン済(`signerName=山田`、`method=paper`)。`round=1` |
| r_seeda20000000000 | s_a / 2F | submitted | 田中 | `submittedAt`=now−40分(**escLevel=1**)。i9=ng(備考「控えが1箇所不足」・写真あり)、他ok、重点項目に写真。未claim |
| r_seeda30000000000 | s_a / 3F | draft | 田中 | i1〜i3のみ回答(ok、i2・i3は写真あり) |
| r_seedb10000000000 | s_b / 1F | fix | 田中 | `round=1`。QA(佐藤)が `minor`:i10=ng/minor(管理者コメント「緊結が甘い」・写真あり)、総合コメント「端太材の緊結をやり直してください」 |
| r_seedb20000000000 | s_b / 2F | draft | スギアント | i1のみok(田中からは `masked` に見える) |
| r_seedc10000000000 | s_c / 1F(東) | qa_ok | スギアント | QA合格(鈴木)。元請サイン未 |
| r_seedc20000000000 | s_c / 2F(西) | submitted | スギアント | `submittedAt`=now−70分(**escLevel=2**)。全ok。未claim |

- 写真はテスト用の小さなJPEG(`tests/fixtures/sample.jpg`。5KB未満、有効なJPEG)を全て共有してよい。
- `escNotified` は全て0(`/__mock/tick` で `escalate_30`/`escalate_60` が生成される)。
- 不在登録なし。Config は §2.14 の既定(`enabledStages` は `pre_pour,post_demold`)。Items は §2.6.1・§2.6.1a(i1〜i69の69行。36有効(打設前28+出来形8)+33無効)。**シードに出来形(`post_demold`)の記録は入れない**(既存テストの件数を変えないため。出来形のテストは `createRecord` で作る)。Notes/Events はこの状態を説明する最小限(各記録の `record_created`・提出・判定等)を整合するように用意。

---

## 12. テスト観点(完了の定義 CLAUDE.md §5 をテストケースに落とす)

### 12.1 テストの層と実行
- 契約テスト(`tests/contract/*.test.js`、`node --test`、Node 22のグローバル `fetch`): 相手は `API_URL`(既定 `http://127.0.0.1:8787/api` = mock、`http://127.0.0.1:8788/api` = harness)。`/__mock/*` を使うテストは `@mock-only`(実GASではスキップ)。
- ユニットテスト(`tests/unit/*.test.js`): フロントの純関数(`validate.js`・outboxの統合/バックオフ/送信可否規則・`time.js`・単発/分割の選択とチャンク分割・スタンプ文字列・i18n)とmock/harness共通の純関数(canonicalJSON・ハッシュ)。
- E2E(`tests/e2e/*.spec.js`。**`playwright` 本体(`chromium` API)+ `node:test`(`node --test`)で実行し、`@playwright/test` と `playwright.config.js` は使わない**。`tests/package.json` の devDependency は `playwright` のみ。**ブラウザ未導入環境では `npx playwright install chromium` が必要**(環境メモ))。静的サーバー(`tests/helpers/static-server.js`)で `frontend/` を配り、`config.js` の `API_URL` をmock(またはharness)へ向ける。Chromium起動引数 `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream`、モバイル(375×667、`isMobile`、`hasTouch`)、ロケールja-JP/id-IDの両方。**コンソールエラー・未処理例外・失敗リクエスト(想定外)があれば全テストで失敗**とする共通フィクスチャ。
- 構文: `tests/check-syntax.js` が `backend/*.gs`(一時`.js`コピー)・`frontend/**/*.js`・`mock/**/*.js`・`tests/**/*.js` に `node --check`。
- **SPEC同期** `tests/spec-sync.test.js`: SPEC.md から §5.5の action名・§5.3のエラーコード・§5.3.1のrule・§2.14のConfigキー・§2の全シート列名・§2.6.1・§2.6.1aの項目を抽出し、`/__mock/meta`、`backend/Schema.gs`+`Seed.gs`+`Code.gs`(vmで評価)、`frontend/i18n.js` のキー(`err.*`/`rule.*`/`ev.*`/`st.*`)と一致することを検査する(= 「実装がSPECと一致」)。
- 実行: `node tests/run-all.js`(構文→unit→mock起動→contract(mock)→harness起動→contract(harness)→E2E(mock)→E2E(harness)。いずれか失敗で非0)。

### 12.2 完了の定義 → テスト対応表

| DoD(CLAUDE.md §5) | テストID |
|---|---|
| 職長が他現場を見られない | C-PERM-01, C-PERM-02, E-02 |
| QAが担当外を判定できない | C-PERM-03, E-06 |
| 職長が提出後に編集できない | C-PERM-05, E-04 |
| 職長コメントが管理者操作で消えない | C-PERM-06 |
| 5回誤りでロック、ロック中は操作不可、責任者のみ解除 | C-AUTH-04, C-PIN-01, C-PIN-04, E-09 |
| 反応速度の改善(版1.10。先出し・応答の `record`・未送信の見える化・起動待ち対策) | C-RESP-01〜05, C-KEEP-01〜02, U-OUTBOX-05〜06, U-CLASS-01, U-RESP-01, E-23〜E-28(E-29 は P-45 承認後)、PERF-04〜05 |
| 元請PDFが A4 縦・余白12mm で作れる(Googleドキュメント方式)/ 方式の切替・失敗時に html へ自動で切り替わる(版1.10.1) | C-REP-02〜06、(実機)REAL-PDF-01〜05 |
| 圏外で入力→復帰で自動送信、二重送信されない | C-IDEM-01〜04, U-OUTBOX-*, E-05 |
| 2人のQAが同時に確認中→先着のみ | C-CONC-01, E-06 |
| スマホ幅375pxで崩れない、ja/idで欠けがない | E-07, E-08, U-I18N-01 |
| スタンプ付き写真、職長のNGは写真と備考必須(QA側は写真任意) | C-STATE-05, C-PHOTO-*, U-PHOTO-*, E-03 |
| コンソールエラー0、`node --check`、テスト全通過 | 共通フィクスチャ, `check-syntax.js`, `run-all.js` |
| 写真送信の高速化(単発・並行・ロック範囲・参照キャッシュ。版1.4) | C-PHOTO-01,03,07〜12, C-CONC-04,05, C-CACHE-01,02, U-PHOTO-03, U-OUTBOX-04, E-13 |
| 写真送信・応答時間の性能目標(版1.5。**自動テストではなく手動確認**) | §12.6(実GASで手動。`run-all.js` の対象外) |
| 段階(打設前/出来形)をまたいだ記録の分離、出来形に打設可/打設を止める操作が出ない、項目の絞り込み、`enabledStages` 既定(版1.9) | C-STAGE-01〜06, C-ITEM-01〜03, U-SEED-01, U-I18N-01, E-15 |
| 元請PDFの実測が切れず読める(項目表の折り返し・要約・許容超の ▲・図面の項目グループ・写真ブロック)。判定は人(▲は目安のみ)(版1.11.0) | U-MEAS-01, C-REP-01(②改訂), C-REP-07, C-REP-08, C-DRAW-07、(実機)REAL-PDF-06 |
| 管理者は許容超の実測値に OK を付けられる。ただし管理者コメントが必須(職長側は変えない)(版1.11.1) | C-VERD-01, C-VERD-02, C-VERD-03, U-VALID-01, U-I18N-01, E-30、C-REP-07(データ改訂) |
| 実装がSPECと一致 | `spec-sync.test.js` |

### 12.3 契約テスト(C-)

**封筒・共通**
- C-ENV-01: 未知action・`v`不一致・不正JSON・`params` の未知キー(例 `role`)→ `BAD_REQUEST`。★で `clientId` 欠落 → `BAD_REQUEST`。
- C-ENV-02: 全応答に `ok`・`meta.serverTime`・`meta.apiVersion=1`。失敗は `error.code` が §5.3 の既知コード。常にHTTP 200。(mock-only) `OPTIONS /api` が 405 でCORSヘッダなし。
- C-ENV-03: `ping` が GET/POST 両方で成功。`appVersion` が `minClientVersion` 未満なら `CLIENT_OUTDATED`(`ping`/`me` を除く)。
- C-ENV-04(検査順序 §4.2): 同時に複数の不備がある要求は最初の段のエラーを返す。契約外キー+役割違反(職長の `claimReview` に未知キー)→`BAD_REQUEST`。役割違反+範囲違反→`FORBIDDEN_ROLE`。範囲違反+状態違反(担当外現場の `draft` 記録への `claimReview`)→`FORBIDDEN_SITE`。班違反+状態違反(他班の `submitted` 記録への `saveDraft`)→`FORBIDDEN_TEAM`。

**認証・PIN**
- C-AUTH-01: `listLoginUsers` は存在しない(`UNKNOWN_ACTION`)。`lookupInvite` は `name,company,purpose` 以外のキー(`userId`・`role`・`status` 等)を返さず、無効(`disabled`/`locked`)ユーザーのコードは `INVITE_INVALID`。
- C-AUTH-02: `registerDevice`(田中の招待コード+PIN 1111)で token 取得→`me` が田中・`role=foreman`。token改ざん→`UNAUTHENTICATED`。`adminRevokeDevice` 後→`DEVICE_REVOKED`。
- C-AUTH-03: 招待コードなし→`VALIDATION_FAILED`、誤りコード→`INVITE_INVALID`、`lookupInvite` 正コード→本人の `name,company`(コードは未使用のまま)、正しい `123456`+新PIN→`registerDevice` 成功(`status=active`)、再使用→`INVITE_INVALID`、追加端末は `pinReset` コードで登録可(`userId` をリクエストに含めても無視)、氏名+PINだけの登録はできない。(mock-only)時計+73時間→`INVITE_EXPIRED`。
- C-AUTH-04(ロック): 稼働中ユーザーが `changePin` 等の stepUp で誤PINを5回 → 1〜4回目 `PIN_INVALID`(`remaining` が4,3,2,1)、5回目 `USER_LOCKED`。正しいPINでも `USER_LOCKED`。既存端末のtokenでも `listRecords` が `USER_LOCKED`、`me` は `status=locked` を返す。
- C-AUTH-06(総当たり対策): 一致しない招待コードを `lookupInvite` で `inviteFailMax`(10)回続けると、次は正しいコードでも `RATE_LIMITED`。`inviteFailWindowMin` 経過後(mockは時計を進める)は再び使える。`failedCount` は増えない。
- C-AUTH-08(会社名の入力・記録への反映・版1.8): `purpose=first` で会社名なし(名簿も空)→`VALIDATION_FAILED`(path=`company`)でコードは消費されない。41文字→`VALIDATION_FAILED`。会社名つきで登録でき、`Users.company` に空白整形のうえ保存され `Me.company` に出る。記録の `ownerCompany` は作成時の `Users.company` の写しで、後で名簿が変わっても変わらない(新しい記録は新しい会社名)。`RecordSummary/Detail.ownerCompany` に出る。PDFの職長の会社名・職長サイン欄は `ownerCompany` を使う。
- C-AUTH-07(会社名): Users の `company` が `lookupInvite` と `adminListUsers` に出る。PDFの職長サイン欄・基本情報に出る(空なら出さない)。
- C-AUTH-05: 状態ダンプ・全応答に `pinHash`/`pinSalt`/`tokenHash`/PIN平文/招待コード平文が含まれない。(mock-only)`Idem.responseJson`・`Events.detail` にも含まれない。
- C-PIN-01: 田中が下書き完了の記録で `submitRecord` を `pin` なし→`PIN_REQUIRED`(カウント不変)、誤PIN×5→`USER_LOCKED`、責任者が `adminUnlockUser` → 田中の操作が復帰し `failedCount=0`。
- C-PIN-02: PIN必須でないaction(`saveDraft` 等)に `pin` を付けても無視され誤りカウントが増えない。`submitVerdict(minor)` はPINなしで成功、`submitVerdict(ok)` はPINなしで `PIN_REQUIRED`。`recordPrimeSign` はPINなしで `PIN_REQUIRED`。
- C-PIN-03: 権限がない操作(佐藤がs_cの記録を `submitVerdict(ok)`、誤PIN付き)は `FORBIDDEN_SITE` でPIN誤りカウントが増えない。入力検証エラー(提出検査違反)でも増えない。
- C-PIN-04: 責任者以外(QA含む)の `adminUnlockUser`/`adminIssueInvite`/`adminRevokeDevice` は `FORBIDDEN_ROLE`。`locked` でないユーザーの解除は `STATE_CONFLICT`。
- C-PIN-05: `changePin`(現PIN誤り→`PIN_INVALID`/正→成功、新PINで再登録可、旧PINは不可)。

**権限**
- C-PERM-01: 田中の `listRecords` は s_a,s_b のみ。`siteId=s_c` 指定→`FORBIDDEN_SITE`。s_c の記録の `getRecord`→`FORBIDDEN_SITE`。`getBootstrap.sites` は s_a,s_b のみ。
- C-PERM-02: 田中から s_b/2F(スギアント班)は `masked:true` で最小キーのみ。`getRecord`→`FORBIDDEN_TEAM`。その記録の写真ID→`getPhotoThumbs` の `missing`。田中が同スロットを `createRecord`→`ALREADY_EXISTS`(`mine:false`)。
- C-PERM-03: 佐藤(s_c担当外)が s_c の submitted 記録に `claimReview`/`submitVerdict`/`recordPrimeSign`/`generateReport` → すべて `FORBIDDEN_SITE`。責任者は同記録を `claimReview` 可(最終代行)。
- C-PERM-04: 職長の `claimReview`/`submitVerdict`/`recordPrimeSign`/`generateReport`/`listAssignments` → `FORBIDDEN_ROLE`。QA/責任者の `createRecord`/`saveDraft`/`submitRecord`/`requestJoin` → `FORBIDDEN_ROLE`。
- C-PERM-05: 提出後(submitted/qa_ok/approved)の田中の `saveDraft`・`uploadPhotoChunk(self)`・`addNote`・`deletePhoto` → `RECORD_LOCKED`。`fix` では全て成功。
- C-PERM-06(コメント保全): QAが `saveQaDraft`/`submitVerdict`/`addNote(manager)` を行っても `self.note`(職長コメント)は不変。QAが職長列に相当するキーを送る → `VALIDATION_FAILED`(`FIELD_INVALID`)。Notes の既存行(職長・管理者とも)は判定・再提出を経ても本文・件数が減らない(件数は単調増加、既存 `noteId` の `text` 不変)。`fix` の再提出で QA列は空になるが Notes と `verdict_*` Events に前回分が残る。
- C-PERM-07: `admin*` は職長・QAで `FORBIDDEN_ROLE`。
- C-PERM-08: 同班の別職長は自班記録を編集可、他班は不可(`FORBIDDEN_TEAM`)。`team` が空の職長は本人記録のみ。(`/__mock/patch` で用意)
- C-PERM-09: `requestJoin`: 誤 `joinKey`→`JOIN_KEY_INVALID`、正→pending、再申請→`JOIN_PENDING`。`decideJoin`: 主担当(佐藤)は可、代行者(鈴木)は主担当在席中 `FORBIDDEN_ROLE`、`adminSetAbsence`(佐藤)後は鈴木可、責任者は常に可。承認で Assignments に有効行ができ、その現場が見える。`revokeMembership` 後は見えなくなる。`adminRotateJoinKey` 後は旧キーが `JOIN_KEY_INVALID`。
- C-PERM-10: 無効な担当(`active=FALSE`/期間外/役割不整合(例 QAのUserに `foreman` 担当を `patch`))は権限を与えない(兼任なしの強制)。

**状態遷移**
- C-STATE-01(正常系): 田中 `createRecord`→`saveDraft`→写真→`submitRecord`(PIN)→佐藤 `claimReview`→`saveQaDraft`→`submitVerdict(ok,PIN)`→`recordPrimeSign`(PIN)→`approved`。各段で status・`round`・`signatures`・`actions` が §6 通り。Events の `kind` 列が期待順。
- C-STATE-02(軽微): `minor`→`fix`、`claimedBy` 空、田中が是正→`submitRecord`→`round=2`、QA列・判定列が空、`submitted`。
- C-STATE-03(重大): `major`→`fix`・`major=TRUE`。再提出→再合格→`recordPrimeSign` までは `approved` にならない。`major` 時に責任者宛メールが記録される(mock-only)。
- C-STATE-04(不正遷移): submittedへの `submitRecord`、draftへの `claimReview`/`submitVerdict`/`recordPrimeSign`、submittedへの `recordPrimeSign`、`round` 不一致 → `STATE_CONFLICT`/`RECORD_LOCKED`(`error.data.status`)。
- C-STATE-05(提出検査。職長 `submitRecord` のみ。`PHOTO_REQUIRED` はここだけで検査する): 未回答・NGの写真/備考欠落・重点項目okの写真欠落・許容超えok・`pourPlannedAt` なし → `VALIDATION_FAILED` で **violationsが全て列挙**(`ANSWER_MISSING`,`PHOTO_REQUIRED`,`NOTE_REQUIRED`,`MEASURE_OVER_TOL_OK`,`POUR_PLAN_REQUIRED`,`MEASURE_REQUIRED`)。データ駆動(`tests/fixtures/validation-cases.json`。ユニットと共用)。
- C-STATE-06(判定検査): `ok` でQAにNGあり→`VERDICT_OK_WITH_NG`、`minor` でNGなし→`VERDICT_NEEDS_NG`、`major` で重大項目なし→`VERDICT_MAJOR_NEEDS_MAJOR_ITEM`、`minor` に重大項目→`VERDICT_MINOR_HAS_MAJOR_ITEM`、`minor/major` でコメントなし(`comment` 未指定かつ保存済み `qaComment` も空)→`COMMENT_REQUIRED`、`saveQaDraft` で `comment` を保存済みなら `submitVerdict` で `comment` 未指定でも成功し、`qaComment` と Notes にその値が入る、QA未回答→`ANSWER_MISSING`、QAのNGで備考/重さ欠落→`NOTE_REQUIRED`/`SEVERITY_REQUIRED`(**写真が無くても通る**。QA側で `PHOTO_REQUIRED` は返らない。NGでも `key` 項目のokでも `side=qa` の写真0枚で `submitVerdict` が成功することを必ず確認する。版1.5.1)。
- C-VERD-01(版1.11.1。管理者の許容超 `ok`=コメント必須。§5.3.1。mock・backend harness の両方。データ駆動で `tests/fixtures/validation-cases.json` にも同じケースを置く): `pre_pour` の `submitted` 記録を佐藤が `claimReview`。i4(許容5)に `qaValues=[6]`・`qaResult=ok` を `saveQaDraft` する。①`qaNote` なし(キー無し)・`""`・半角空白のみ・全角空白のみ(`\u3000`)・改行のみ → `submitVerdict(ok, PIN)` が `VALIDATION_FAILED` で `violations` に `{rule:"QA_OVER_TOL_COMMENT_REQUIRED", itemId:"i4"}` を含み、**`MEASURE_OVER_TOL_OK` を含まない**。status は `submitted` のまま・`qaVerdict` 空・PIN誤りカウント不変・Events に `verdict_*` なし。②`qaNote="図面で確認済み"` を `saveQaDraft` → 同じ `submitVerdict(ok)` が成功(`qa_ok`)。`Records` の i4 の `qaNote` が保存され、Notes に `kind=manager, source=verdict` で追記され、**職長の `foremanNote`・`selfValues`・`selfResult` は不変**(C-PERM-06 と同じ確認)。③`verdict=minor` でも、別項目(i9)を `ng`+備考+重さ `minor` にして総合コメントも入れた状態で、i4 が `ok`+`[6]`+`qaNote` 空なら `QA_OVER_TOL_COMMENT_REQUIRED`(総合判定に依らない)。`qaNote` を入れると成功(`fix`)。④許容超の `ok` が2項目(i4・i5)でどちらも `qaNote` 空 → `violations` に両方の `itemId` が列挙される(最初の1件で止めない)。他の違反(例 `ANSWER_MISSING`)とも同時に列挙される。⑤総合コメント(`comment`)を入れても代用にならない(`qaNote` 空のままなら拒否)。
- C-VERD-02(版1.11.1。対象外の確認。C-VERD-01 と同じ記録・データ駆動): いずれも `QA_OVER_TOL_COMMENT_REQUIRED` が**出ない**こと(`qaNote` 空で `submitVerdict(ok)` が成功、または別の違反だけが出る): ①境界 i4 `qaValues=[5,-5]`・`ok` ②許容なし(i8 など `tol` なし)`qaValues=[99]`・`ok` ③`tol` が 0・負・数値でない項目(テスト用に `snapshot.tol` を差し替えるか単体で。i59 のような下限だけの基準も)に大きな値 ④`qaValues` が空で `selfValues=[6]`(職長は `ng`)の項目に `qaResult=ok`(管理者の値が無いので対象外) ⑤`qaResult=na` で `qaValues=[6]` ⑥`qaResult=ng` で `qaValues=[6]`・`qaNote` 空 → `NOTE_REQUIRED`(と `SEVERITY_REQUIRED`)だけが出て、`QA_OVER_TOL_COMMENT_REQUIRED` は**出ない**(重ねて出さない)。`qaNote`+重さを入れれば成功 ⑦`qaValues=[-5.5]`(許容5)・`ok` は対象(小数も丸めない)、`[5.0]` は対象外 ⑧`audience=foreman` のみの項目(テストでは差し替え)は管理者の検査対象外。
- C-VERD-03(版1.11.1。変えていないことの確認): ①職長の `submitRecord` で `selfValues=[6]`(許容5)・`selfResult=ok` → 従来どおり `MEASURE_OVER_TOL_OK`(C-STATE-05 のまま。`QA_OVER_TOL_COMMENT_REQUIRED` は出ない)。②`saveQaDraft` は、許容超の `ok`+`qaNote` 空でも成功する(検査しない)。③`MEASURE_REQUIRED`(`measure=required` で点数不足)・`NOTE_REQUIRED`・`SEVERITY_REQUIRED`・`VERDICT_*`・`COMMENT_REQUIRED` は従来どおり。④拒否された `submitVerdict` のあと、`qaNote` を `saveQaDraft` で直し**別の `clientId`** で `submitVerdict` を送ると成功する(`clientId` の扱いは既存の冪等規則のまま。新規則は何も足さない)。⑤`err.*`/`rule.*` 辞書の網羅(U-I18N-01)に新 rule が含まれる。
- C-STATE-07(打設停止。`stage=pre_pour` の記録): `approved` を田中(他班の職長でも同現場なら可)が `stopPour`→`fix`・`stopped=TRUE`・署名無効(`prime`/判定が空)。**他班の職長(`masked` の記録)の `listRecords` 行は `actions=["stopPour"]` で、`stopPour` は成功し応答 `record` は masked 形、同じ職長の `getRecord` は `FORBIDDEN_TEAM` のまま**。他現場の職長は `FORBIDDEN_SITE`、`draft` へは `STATE_CONFLICT`、理由なし→`REASON_REQUIRED`。停止後に是正・再提出・再合格・元請サインを経て初めて `approved`。
- C-STATE-08(スロット): 同一(現場,階,工区,ロット,段階)の2件目→`ALREADY_EXISTS`。`approved` 記録には `reinspectOf` 付きでのみ追加可。`reinspectOf` の元記録が `approved` でなければ(例 `fix`/`qa_ok`)`STATE_CONFLICT`(`error.data` は元記録の `status`/`round`)。未有効段階(`during_pour`、または `patch` で `enabledStages` から外した段階)→`STAGE_NOT_ENABLED`。閉鎖現場→`SITE_CLOSED`。同じ階・工区・ロットでも段階が違えば別スロット(C-STAGE-01)。
- C-STATE-09(3者サイン): `signerName` 空→`PRIME_SIGNER_REQUIRED`。`qa_ok` 以外では `STATE_CONFLICT`。`approved` 後は `signatures` の3者が揃って返る。

**同時操作**
- C-CONC-01: 佐藤と鈴木が同時(`Promise.all`、`--latency` 付き)に同じ submitted 記録へ `claimReview` → ちょうど1件成功、他方 `ALREADY_CLAIMED`(`claimedBy` が成功者)。20回繰り返して常に1:1。
- C-CONC-02(引き継ぎ): claim中の記録を、鈴木が30分未満で `takeoverReview`→`TAKEOVER_NOT_ALLOWED`(`availableAt`)。(mock-only)時計+31分→成功。責任者は即時可。claim者が不在登録中なら即時可。
- C-CONC-03: 同一記録の `saveDraft`(同班2人)が交互に届いても項目×列の後勝ちで欠落しない。
- C-CONC-04(ロック分離): 同一記録に対し `uploadPhotoChunk` 単発3本と `saveDraft` 1本を `Promise.all`(`--latency` 付き)→ 全て成功し、写真3行・`saveDraft` の項目が欠落せず、`Records.version` が開始値+4(更新の取りこぼしなし)。
- C-CONC-05: (mock-only)別の記録への `claimReview` と `uploadPhotoChunk` 単発を同時に送っても双方成功し、`claimReview` の先着規則(C-CONC-01)は崩れない。

**冪等**
- C-IDEM-01: 同じ `clientId`+同内容で `submitRecord`/`submitVerdict`/`recordPrimeSign` を2回 → 2回目 `meta.replayed=true`・同一 `data`・Events の件数は1回分・`round` 不変。 (版1.10の読み替え: 2回目の `data` は **`record` を除いて同一**で、`record` は最新のRecordDetail(`record.version` は1回目以上)。`record` を載せない action は従来どおり完全一致)
- C-IDEM-02: 同じ `clientId` で内容違い → `IDEMPOTENCY_CONFLICT`。別ユーザーが同じ `clientId` → `IDEMPOTENCY_CONFLICT`。
- C-IDEM-03: `createRecord`/`claimReview` の再送が成功(再構築。§5.2)。`saveDraft`・`addNote` の再送でNotes/項目が重複しない。
- C-IDEM-04: 検証エラーで失敗した `clientId` は保存されず、直した内容で同じ `clientId` を再送すると成功。
- C-IDEM-05: (mock-only)`/__mock/fail`(`mode:"network"`,`after:true`)で応答喪失を1回起こし、同じ `clientId` で再送 → 2回目は `replayed:true` で成功し、状態・Events・Notesが二重にならない。
**応答の更新後の記録(版1.10。§5.1a)**
- C-RESP-01(返す形): 田中の `submitRecord`(PIN)、佐藤の `submitVerdict`(`ok`(PIN)・`minor`・`major` それぞれ別の記録で)、`recordPrimeSign`(PIN)、`stopPour`(打設前)の `data.record` が **RecordDetail**(`items` `notes` `events` `signatures` `timing` `actions` `version` を持つ)。`getRecord` を直後に呼んだ結果と、`events`・`notes` を含めて(`version` も)一致する。見え方は `getRecord` と同じ規則: 職長の `submitRecord` の `record.items[].qa` は `null`(`submitted` の間)、QAの `submitVerdict` の `record` は QA の見え方。他班の職長が `stopPour` した応答の `record` は masked 形(`items` を含まない最小キー)。`saveDraft` `saveQaDraft` `releaseClaim` の `record` は従来どおり RecordSummary(`items` を含まない)。
- C-RESP-02(`addNote`・写真): `addNote` の応答に `note` と `record` があり、`record.notes` にその `noteId` が含まれ、`record.version` が呼出し前の `getRecord.version` より1大きい。`uploadPhotoChunk`(単発)の `complete:true` の応答に `record` があり、対象項目の `self.photos` に新しい `photoId` が載り `version` が1大きい。同じ `photoId` の再送(既存行の冪等成功)にも `record` が付く。分割の途中チャンク(`complete:false`)には `record` が付かない。
- C-RESP-03(重さ): どの `record` にも `dataUrl`・`thumb` というキーが無く、base64 の本体を含まない(`PhotoMeta` のみ)。エラー応答には `record` が付かない。
- C-RESP-04(version): 同じ記録に `saveDraft` → `addNote` → `uploadPhotoChunk` → `submitRecord` を順に行うと、各応答の `record`(Detail の応答)の `version` が単調に増える。`uploadPhotoChunk` 単発3本を `Promise.all` で送った場合、各応答の `record.version` は「その写真の追加直後の版」以上で、最終的な `getRecord.version` = 開始 + 3、**3本のうち `version` が最大の応答の `record` には3枚とも載っている**(遅れて届く応答に古い状態があっても、クライアントが `version` で採否を決められる)。
- C-RESP-05(冪等再生): `submitRecord`(PIN)を同じ `clientId` で再送 → `meta.replayed=true`・`record` は RecordDetail・`record` を除く `data`(`warnings`)は初回と同一・`record.version` は初回以上・Events の件数は1回分。`addNote` の再送も同様で Notes は重複しない。(mock-only/harness)`Idem.responseJson` に `items` を含む RecordDetail が保存されておらず、45,000文字以内。
- C-KEEP-01(harness-only。GASエディタ専用の関数。§6.7a): ①`ACTIONS` のキー数は43のままで、`installKeepWarmTrigger`・`removeKeepWarmTrigger`・`keepWarm` を含まない。HTTP でこれらを `action` に送ると `BAD_REQUEST`。②`installKeepWarmTrigger()` を2回実行しても、ハンドラ `keepWarm` の時間主導トリガーは1本で間隔は5分。`Config.keepWarmMinutes` を 10 にして実行すると10分。1・7・数でない値・欠落のときは5(`1` のときは `Logger` に理由が出る)。③`removeKeepWarmTrigger()` で `keepWarm` のトリガーが0本になり、`escalationTick`・`dailyMaintenance` のトリガーは残る。`setupTriggers()` を実行しても `keepWarm` のトリガーは消えない。④`keepWarmMinutes` の行が無い既存の Config に対し `setupSheets()` が1行だけ追記し、既存の行・値を変えない。
- C-KEEP-02(harness-only): `keepWarm()` の実行の前後で、全シートのセルの内容・Drive のファイル・ScriptProperties・送信メール・`Events`・`Idem` が完全に同じ(書き込み0回)。ロックを取らない。`Users`/`Devices`/`Assignments`/`Memberships`/`Absences` を読まない(shims の読み取り記録で確認)。読み込みを失敗させても例外を投げない。

**写真**
- C-PHOTO-01(単発): `total=1,index=0`(`data`=本体全体、`thumb` 同梱)の **1回の** `uploadPhotoChunk` で `complete:true`+`received:[0]`+`PhotoMeta`、`getPhotoThumbs`/`getPhoto` が返る(`getPhoto` のバイト列のSHA-256が申告値と一致)。同じ内容の再送 → 成功・`Photos` 重複行なし・仮想Driveの有効ファイルは本体1+サムネ1のまま。`data` が `photoChunkChars`(90,000)を超える(例 400,000文字)単発も成功。**分割(後方互換)**: 3チャンク(`total=3`)でも従来どおり最終で `complete:true`、全チャンク再送も成功。`getBootstrap.config` に `photoSingleMaxChars=1200000`・`photoParallel=3` が含まれる。
- C-PHOTO-02: 欠けチャンク→`CHUNK_MISSING`(`missing`)。(mock-only)`/__mock/evictChunks` 後の最終チャンク→`CHUNK_MISSING`→0から再送で成功。
- C-PHOTO-03: SHA不一致/JPEGでない/サムネ欠落/`bytes` とデコード後長さの不一致→`PHOTO_INVALID`、600,000バイト超(`bytes` 申告も実長も)→`PHOTO_TOO_LARGE`、6枚目→`PHOTO_LIMIT`。**単発の上限超過**: `data` が `photoSingleMaxChars+4` 文字(有効なbase64)→ `PHOTO_INVALID` で、`Photos` に行が増えず `/__mock/driveLog` に `create` が無い。分割モードで1チャンクが `photoChunkChars` 超 → `PHOTO_INVALID`。`total=1,index=1` / `total=13` → `VALIDATION_FAILED`(`FIELD_INVALID`)。
- C-PHOTO-04: 権限(`side` 別。職長はqa/prime不可、QAは未claimでqa不可、primeはqa_okのみ)。提出後の職長の撮影は `RECORD_LOCKED`。
- C-PHOTO-05: `deletePhoto` は撮影者本人・同ラウンドのみ。再提出後に前ラウンドの写真は消せない。論理削除後は `PhotoMeta` に出ず提出検査の枚数にも数えない。削除済みの `photoId` への再度の `deletePhoto`(別 `clientId`)は `NOT_FOUND`。
- C-PHOTO-06: (mock-only)未来の `takenAt` は `clockSuspect` が立つ。Driveパスが §7.4 の構造(現場/階/日付)。
- C-PHOTO-MULTI-01(1項目に複数枚): 同じ項目×sideに別 `photoId` で `photoMaxPerItem`(5)枚まで順に(単発で)登録でき、`RecordDetail` の当該項目に5枚とも `PhotoMeta` として出る。6枚目は `PHOTO_LIMIT`(`max=5`)。1枚を `deletePhoto` すると未削除が4枚になり、再度1枚追加できる。他の項目×sideの枚数は影響を受けない。
- C-PHOTO-07: (mock-only)単発は `/__mock/evictChunks` の影響を受けず成功する(Cache不使用)。分割は従来どおり `CHUNK_MISSING`。
- C-PHOTO-08(並行・上限): 同じ項目×sideに4枚ある状態で、別 `photoId` の単発3枚を `Promise.all` で送る → **ちょうど1枚成功・2枚 `PHOTO_LIMIT`**(未削除5枚を超えない)。別項目の3枚の `Promise.all` は全て成功し `Photos` は3行増える。どちらも終了後、有効な仮想Drive本体ファイル数 = `Photos` の未削除行数(孤児なし。サムネも同様)。
- C-PHOTO-09(並行再送の冪等): 同一 `photoId`・同一内容の単発を `Promise.all` で3本 → 全て `complete:true` で同じ `photo`、`Photos` は1行、有効な仮想Driveファイルは本体1+サムネ1(余分は削除済み)。**他ユーザー**(同じ記録を編集できる同班の別職長など)が、既存の `photoId` で同じ内容(`recordId/itemId/side/sha256` 一致)を送っても `PHOTO_INVALID`(`takenBy` 不一致。成功応答を得られず、`Photos` も増えない)。同一ユーザーで `sha256` だけ違う再送も `PHOTO_INVALID`。
- C-PHOTO-10: (mock-only・`/__mock/interleave`)ロック外処理とロック取得の間に状態が変わった場合の後始末。いずれも `/__mock/driveLog` で、そのリクエストが作った本体・サムネが `create` の後に `trash` され、`/__mock/drive` に増分が無いこと:
  a) 記録を `submitted` に変更 → `RECORD_LOCKED`。b) 同項目の `Photos` を4→5枚にする行を挿入 → `PHOTO_LIMIT`。c) 同じ `photoId`(別 `driveFileId`、同じ `recordId/itemId/side/sha256`)の `Photos` 行を挿入 → `complete:true` で挿入済みの `photo` を返す・`Photos` は1行・挿入済み行のファイルは削除されない。d) c) で `sha256` だけ違う行 → `PHOTO_INVALID`。e) 当該ユーザーの `Users.status` を `disabled` に変更 → `USER_DISABLED`。
- C-PHOTO-11: 正常な単発・分割(最終チャンク)の Drive 書込み(`driveLog` の `create`)は全て `lockHeld=false`(重い処理はロックの外)。(harnessでは実際のスクリプトロックの保持状態、mockでは更新系ミューテックスの保持状態で判定)
- C-PHOTO-12(touch): 写真の追加後、`listRecords`(`since`=追加前の`serverTime`の5秒前)にその記録が現れ、`RecordDetail` の `version` が1増える。`Events` は増えない。

**時間ルール・通知**
- C-TIME-01: シードの a2(40分)=`escLevel` 1、c2(70分)=2。(mock-only)時計を進めると 0→1→2。claimされた時点で凍結。
- C-TIME-02: (mock-only)`/__mock/tick` で a2 に `escalate_30`(宛先=代行者=鈴木)、c2 に `escalate_30`→`escalate_60`(宛先=責任者)が1回ずつ。再度 tick しても増えない。メールは `/__mock/mails` に宛先規則通り記録(§6.6)。再提出で `escNotified` が0に戻る。
- C-TIME-03: `timing` の値(§6.5の式)。前日15:00超過の提出で `warnings` に `SELF_LATE`、16:00前の判定で `QA_BEFORE_OPEN`、打設2時間前超過で `QA_LATE`(いずれも成功する)。
- C-TIME-04: 不在登録中の主担当の現場では `listAssignments.absentToday=true`、`Site.qa.mainAbsent=true`。

**マスタ・名簿・PDF**
- C-ITEM-01: `getBootstrap.items`=§2.6.1・§2.6.1a の有効36項目(打設前28=i1〜i16+i58〜i69、出来形8=i50〜i57。`seq` 昇順、`itemsHash` あり。無効の i17〜i49 は含まれない)。(mock-only)`patch` で `Config.enabledStages` を `pre_pour` にすると28項目になり出来形の項目が消える(`pre_pour,post_demold` に戻すと36)。(mock-only)`patch` で i48 を `active=TRUE` にすると、`enabledStages` に `post_demold` がある間は `getBootstrap.items` と **以後に作る出来形の記録**に含まれ(打設前の記録には含まれない)、既存記録の項目は変わらない(スナップショット)。(mock-only)`patch` で i17 を `active=TRUE` にすると新規の打設前記録に含まれ、既存記録の項目は変わらない。`audience=qa` の項目は職長の提出検査対象外。
- C-ITEM-02(版1.9。Items の形): `SEED_ITEMS` は69行で `itemId`・`seq` に重複がない。i50〜i57 は `stage=post_demold`・`active=TRUE`・`audience=both`・`key=FALSE`、i56 は `tol=10`、i57 は `tol=3`(ともに `measure=optional`・`minMeasures=0`)、他の6項目は `tol` なし・`measure=none`。i58〜i69 は `stage=pre_pour`・`active=TRUE`・`audience=both`・`key=FALSE` で §2.6.1a の表と完全一致(`tol` は i58=3、i61=5、i62=5、i63=5、i64=50、i66=5、i67=5。他は空)。i1〜i49 は版1.8.2 と同一(`active` は i1〜i16 だけ TRUE、i48・i49 は `post_demold` で FALSE)。各段階の有効項目を `seq` 昇順に並べたとき、同じ `groupKey` が連続している(打設前=prep,dim,tie,embed,safe,ctl_base,ctl_open,ctl_support,ctl_embed,ctl_clean / 出来形=demold_check,dim)。`during_pour`・`demold`・`cleanup` の項目は無い。
- C-ITEM-03(版1.9。既存シートへの追加。harness単体): Items が i1〜i49 だけのシートに対し `addMissingSeedItems()` を実行すると、i50〜i69 だけが末尾に追加され、既存の行(値を書き換えた行を含む)は一字も変わらない。もう一度実行すると0件追加。Items が空のシートでの `setupSheets()` は69行を入れる。
- C-STAGE-01(版1.9。段階をまたいだ記録の分離): 同じ(現場,階,工区,ロット)で `pre_pour` と `post_demold` を続けて `createRecord` → 両方成功(`ALREADY_EXISTS` にならない)で別の `recordId`。それぞれの `stage`・`round`・`status`・`version`・項目が独立で、片方の `saveDraft`/`submitRecord`/判定/差し戻し/`approved` がもう片方の `status`・`version`・項目を変えない。同じ段階の2件目は `ALREADY_EXISTS`(`mine` も段階ごとに判定)。`reinspectOf` は同じ段階の `approved` 記録だけ指定でき、別の段階の記録を指すと `VALIDATION_FAILED`(`FIELD_INVALID`、path=`reinspectOf`)。他班の職長から見た出来形の記録は `masked`(最小キー+`stage`)で、`getRecord` は `FORBIDDEN_TEAM`(打設前と同じ)。`listRecords` の各行に `stage` が出る。
- C-STAGE-02(版1.9。項目の絞り込み・有効な段階): 新規の打設前記録の `getRecord.items` は i1〜i16+i58〜i69 の28項目(`seq` 昇順)、新規の出来形記録は i50〜i57 の8項目で、互いの項目を含まない(i48・i49 も含まない)。`getBootstrap.items`(36項目)を記録の `stage` で絞った結果が、それぞれ `createRecord` で作られた記録の項目と一致する(フロントのオフライン仮項目の根拠)。`createRecord` の `stage` が `during_pour`/`demold`/`cleanup`/列挙外(例 `foo`)→ `STAGE_NOT_ENABLED`。(mock-only)`patch` で `enabledStages=pre_pour` → 出来形の `createRecord` が `STAGE_NOT_ENABLED`(既存の出来形記録の閲覧・提出・判定は影響なし)、`pre_pour,post_demold` に戻すと作成できる。(mock-only)出来形の有効項目を全て `active=FALSE` にすると出来形の `createRecord` は `STAGE_NOT_ENABLED`(項目0件の記録を作らせない)。`Config` の既定 `enabledStages` は `pre_pour,post_demold` で、`getBootstrap.config.enabledStages` もそれを返す。
- C-STAGE-03(版1.9。出来形に打設の操作が出ない): 出来形の記録は `submitted`/`qa_ok`/`approved` のどれでも、`actions` に `stopPour` を含まない(職長・同現場の他班の職長・QA・責任者のどれから見ても)。他班の職長から見た出来形の `masked` 行は `actions=[]`。出来形に `stopPour` を送ると `STATE_CONFLICT`(`error.data={status,round}`)で、状態・`stopped`・Events・Notes・メールが変わらない。打設前の記録の `stopPour` は C-STATE-07 のまま成功する。出来形の `pourPlannedAt` は常に `null`、`stopped` は常に `false`。
- C-STAGE-04(版1.9。出来形の流れは打設前と同じ仕組み): 出来形を `createRecord`(`pourPlannedAt` なし)→ `saveDraft`(8項目)→ `submitRecord`(PIN)が `POUR_PLAN_REQUIRED` なしで成功し `warnings` に `SELF_LATE` が出ない → 佐藤 `claimReview` → `submitVerdict(ok, PIN)` が `warnings` なし(仮想時計をいつにしても `QA_BEFORE_OPEN`/`QA_LATE` が出ない)→ `recordPrimeSign`(PIN)で `approved`。`signatures` の3者、Events の `kind` の並びが C-STATE-01 と同じ、`timing` の4つの時刻が `null` で `selfLate`/`qaLate` が `false`。`createRecord`/`saveDraft` で `pourPlannedAt` を渡しても保存されない(`null` のまま・エラーにならない)。`minor`→`fix`→再提出で `round=2`、`major` で `major=TRUE`、提出後の職長編集不可(`RECORD_LOCKED`)、他班の編集不可(`FORBIDDEN_TEAM`)、PIN誤り5回でロック、冪等キーの再送は、いずれも打設前と同じ結果。エスカレーション(§6.4)は出来形にも同じに働く(未claim で40分→`escLevel` 1、`/__mock/tick` で `escalate_30` が1回)。
- C-STAGE-05(版1.9。PDF): `qa_ok` の出来形の `generateReport`: ファイル名(復号後)が `{subject}_出来形_v1_{YYYYMMDD-HHmm}.pdf`、打設前の記録は `{subject}_打設前_v1_{YYYYMMDD-HHmm}.pdf`。(harness)生成HTMLの `<title>` は subject のまま、タイトルが「型枠工事 出来形検査記録」(打設前は「型枠工事 打設前検査記録」)で、出来形のHTMLに「打設可」「打設停止」「打設予定日時」が含まれない。`approved` の出来形のステータス欄は「出来形確認済」、打設前の `approved` は「打設可」(従来どおり)。
- C-STAGE-06(版1.9。メール件名): (mock-only)出来形の記録の `提出`/`30分経過`/`60分経過`/`重大な不適合` のメール件名は末尾が ` 出来形`(例 `[型枠検査] 提出 A現場(仮) 2F 出来形`)、打設前は従来どおり末尾に段階名が付かない。出来形では `打設停止` のメールは作られない。
- C-CACHE-01(キャッシュが権限を跨がない): 事前に `getBootstrap` などで参照キャッシュを温めた状態で、`/__mock/patch`(`keepCache:true`)により ①田中の `Users.status=disabled` → **直後の** 田中のtokenでの任意のaction(`me` 以外)が `USER_DISABLED` ②田中の s_a の `Assignments` を `active=FALSE` → **直後の** `listRecords(siteId=s_a)` が `FORBIDDEN_SITE`、`getBootstrap.sites` から s_a が消える ③佐藤の `Absences` を挿入 → **直後の** `listAssignments.absentToday=true`、鈴木が主担当の代行として `decideJoin` 可 ④`adminRevokeDevice` 直後に当該端末が `DEVICE_REVOKED` いずれも遅延が許されない。(mock/harness共通。モックは常に最新なので自明に通る)
- C-CACHE-02: (harness-only。`/__mock/cacheStats.enabled=true` のときだけ実行)①温めた後 `Config.photoMaxPerItem` を `keepCache:true` で変更 → 直後の `getBootstrap.config.photoMaxPerItem` は旧値(`hits` が増える)、`/__mock/clock` で+61秒後は新値 ②`keepCache` 無しの `patch` は直後に新値 ③`adminRotateJoinKey` の直後に旧 `joinKey` の `requestJoin` が `JOIN_KEY_INVALID`(`Sites` 破棄+`joinKey` 照合はキャッシュを使わない) ④`Config` に1行120,000文字の `description` を持つ行を `patch` で追加し、キャッシュ値が100KB(102,400バイト)を超える状態で `getBootstrap` が正常応答・`skippedTooLarge` が増え、`Items`/`Sites` のキャッシュは影響を受けない ⑤`Sites` を `keepCache:true` で `status=closed` に変更 → +61秒後は `createRecord` が `SITE_CLOSED`(60秒以内は成功/`SITE_CLOSED` のどちらも許す=assertしない)。
- C-ROSTER-01: `adminValidateRoster` はシードで `problems` にerrorなし。(mock-only)`patch` で `qa_sub` を外す→`SITE_NO_QA_SUB`、`qa_main==qa_sub`→`QA_MAIN_EQ_SUB`、職長のUserにQA担当→`ROLE_MISMATCH`。
- C-DRAW-01(登録): `self` の職長が `kind=drawing`・`itemId` 空・`markers`(2件)・`total=1` で `uploadPhotoChunk` → 成功。`PhotoMeta.kind="drawing"`・`markers` が往復で一致。`getRecord` の `drawings` に1件出て、どの項目の `photos`・`primePhotos` にも出ない。`itemId` に値あり/`side=prime`/`markers` が配列でない/要素の `x` が1.5/`label` が空/存在しない `itemId` → `VALIDATION_FAILED`(`FIELD_INVALID`、path=`markers`/`itemId`/`side`)。`kind="photo"` で `markers` に配列 → `FIELD_INVALID`。`kind` 省略は従来どおり検査写真(`itemId` 必須)。
- C-DRAW-02(上限・数え方): 同じ記録×sideに別 `photoId` で5枚まで成功、6枚目は `PHOTO_LIMIT`(`max=5`)。図面5枚でも項目の検査写真は `photoMaxPerItem`(5)枚まで別に登録できる。図面を1枚 `deletePhoto` すると再度1枚追加できる。同じ `photoId` の再送は冪等成功(行は増えない)。
- C-DRAW-03(権限・可視): 提出後(`submitted`)の職長の図面追加・削除は `RECORD_LOCKED`、`fix` では成功。QAは claim者(`submitted`)のときだけ `side=qa` の図面を追加でき、claim者でない・`qa_ok` 以降は拒否。職長の `getRecord`(`draft`/`submitted`)には `side=qa` の図面が含まれない(`fix`/`qa_ok`/`approved` では含まれる)。他班の職長の図面追加は `FORBIDDEN_TEAM`。
- C-DRAW-04(提出検査への影響なし): 図面だけがあり項目の写真が無い記録の `submitRecord` は従来どおり `PHOTO_REQUIRED`(図面は項目の写真に数えない)。図面が0枚でも提出・判定できる。
- C-DRAW-05(PDF): 図面を2枚(職長1・管理者1)登録した記録の `generateReport` の中身(ハーネスの `lastReportHtml`)に、図面ごとの `page-break-before:always`・見出し「確認箇所(図面)」・凡例の `④-1` 等の `label`・`No.` と項目文・横長画像の `width:186mm` が含まれ、`flex`/`grid`/`calc` を含まない。写真ページの枚数・並びに図面が含まれない。図面0枚のPDFには「確認箇所(図面)」が出ない。図面は項目表の後・「NG・是正の経過」の前。
- C-DRAW-06(列追加の移行): 旧形式のシート(`Photos` が `kind`,`markers` なし)に対し `setupSheets()` が不足列を末尾に補い、既存行(`kind` 空)は `photo` として扱われる。順序違い・余分な列はエラー(ハーネス単体)。
- C-REP-01: `qa_ok` で `generateReport`→`url`・`version=1`、再実行で2。`submitted` では `REPORT_NOT_ALLOWED`。(mock-only)取得したPDFが `%PDF-` で始まる。`approved` でも生成可。`listReports` が版降順。**(版1.5.2)PDFファイル名は `{subject}_v{n}_{YYYYMMDD-HHmm}.pdf`**: 工区なし(例 `A現場(仮) 基礎 L2`)・工区あり(例 `B現場(仮) 1F 東工区 L1`)で subject が §10.2a 通り(半角スペース区切り・工区が空なら詰める)、`url`(復号後)の名前に `recordId` が含まれない、禁止文字(例 現場名に `/`)は `_` に置換される。GAS互換ハーネスでは生成HTMLの `<title>` が subject と一致する。 **(版1.5.3)GAS互換ハーネスで生成したHTMLの確認(§10.2b)**: ①写真ブロック(`table`、固定高さ約62mm、`page-break-inside:avoid`)が4枚ごとに `page-break-after`(5枚以上の記録で、4・8枚目に付き、最後のブロックには付かない)、写真が4枚以下なら改ページなし。②項目表に `table-layout:fixed` があり、**(版1.11.0で改訂)全列が折り返し可**: 項目表(`class="items"`)の範囲に `white-space:nowrap`・`overflow:hidden` が**含まれない**。`<colgroup>` の幅が 8/40/14/18/46/30/30mm(合計186)、行の高さは `height:6mm`(最小値)。管理者コメントの長文(200文字)が項目表のセルに**全文**入っている(`…` による省略や切り詰めがない)。旧注記「管理者コメントの全文は…」が**ない**。③HTMLに `display:flex` / `display:grid` が含まれない。④項目に紐づかない写真(`side=prime`)のブロックは区分とスタンプのみ。⑤NGの結果が赤で出る。
- C-REP-02(harness-only。方式の切替。§10.5.1。`/__mock/patch` で Config を書く): ①`reportEngine` の行が無い/空/`html`/`HTML`/`xyz`/`docs` のとき**HTML方式**(`state.lastHtml` が更新され、`/__mock/docShim` の `counts.created=0`)。②`doc`・` Doc `・`DOC` のとき**doc方式**(`counts.created=1` かつ `lastHtml` は `null` のまま)。③どちらでも `url`・`version`・PDFが `%PDF-` で始まる・PDF名(§10.2a)・`Reports` の列と値の形・メール添付(`Reports.driveFileId` の同じファイル)が**同じ形**。④`getBootstrap.config` に `reportEngine` が**ない**。⑤C-REP-01(既定=html)は引き続き全項目を満たす。
- C-REP-03(harness-only。doc方式の中身。§10.5.2〜10.5.6。`reportEngine=doc`、写真(`kind=photo`)6枚(うち1枚は `side=prime` で項目なし)+図面1枚(印2個)+NG項目あり+職長コメントと管理者コメントあり、の `qa_ok` 記録): `/__mock/docShim` の `lastDoc` で次を確認。①**用紙**: `pageWidth=595.28`・`pageHeight=841.89`(±0.01)、四辺の余白 `34.02`(±0.05)。②`fontFamily` が `Noto Sans JP`。③**画像の数**: `images.length` = 写真6 + 図面1 = 7。写真の画像は幅 ≤ 224.33pt かつ 高さ ≤ 162.64pt(±0.5)で縦横比が元画像と±1%以内、図面は幅 ≤ 521.57pt かつ 高さ ≤ 476.71pt(±0.5)。④**改ページ数**: `pageBreaks` = 図面の枚数(1)+「写真」見出しの前(1)+ `floor((写真枚数−1)/4)`(=1)= **3**。写真4枚の記録では 図面の数+1、写真0枚でも 図面の数+1、写真5枚で+1、8枚で+1、9枚で+2。**最後の写真ブロックの後に改ページがない**(写真が4の倍数のときも)。⑤**表**: 写真ブロックの表の数 = 写真の枚数(6)、各表は2列・列幅 83×184/186 = 232.75pt / 103×184/186 = 288.83pt(±0.5。合計 521.57pt)・最低行高 175.75pt(±0.5。縮めない)。項目表は7列・列幅 **8/40/14/18/46/30/30mm**(版1.11.0。旧 8/62/14/18/24/30/30)の各値に 184/186 を掛けて pt 換算した値(±0.5)・最低行高 17.0pt。基本情報表は4列(30/63/30/63mm ×184/186)、サイン表は3列(62mm×3 ×184/186)、図面の凡例表は**6列**(**24/76/28/24/17/17mm** ×184/186。版1.11.0。旧5列 24/82/24/28/28)。**全ての表(基本情報・サイン・結果サマリ・項目・凡例・図面画像・写真ブロック)で列幅の合計 = 521.57pt(±0.5)**。**keepWithNext**: `lastDoc` で h2 見出し(図面があれば6種すべて)の段落の `keepWithNext=true`、h1・注記・本文段落は false(`lastDoc.paragraphs` の `text` と `keepWithNext` で見る)⑥**内容**: `text` に subject・段階名・職長コメント全文・管理者コメント全文・スタンプ文字が含まれ、職長コメントと管理者コメントは別のセル(別の列/別の段落)。項目に紐づかない写真(`side=prime`)のブロックのセルには項目No.・コメントのラベルが出ない。NG行の全セルの背景が `#FDE8E8`(`cellBackgrounds`)。⑦**フッタ**: `footerText` に記録IDと64桁のハッシュ(`reportSnapshotHash_` と同じ値)が含まれ、ページ番号がない。本文末尾に同じハッシュの段落が**ない**。⑧**後始末**: 変換後に一時文書が `trashed=true`、`counts.trashed=counts.created`、`/__mock/drive` に一時文書が残らない(`/__mock/driveLog` に `create` と `trash` が1組出る)。⑨`report_generated` の `detail.engine='doc'`・`fallbackFrom` なし。
- C-REP-04(harness-only。フォールバック。§10.5.8): `reportEngine=doc` で `failMode` を `create` / `image` / `convert` / `slow` の各場合に設定して `generateReport`: ①いずれも `ok:true` で、PDF(HTML方式)ができ、`Reports` に1行増え、PDF名・保存先・共有・メール添付が通常と同じ。②Events `report_generated` の `detail` が `engine='html'`・`fallbackFrom='doc'`・`fallbackReason`(空でない文字列、200文字以内)を持つ。③PDF の Drive ファイルの説明が `engine=html (fallback from doc: …)` で始まる(成功した doc 方式は `engine=doc`、通常の html は `engine=html`)。④`create` 以外では一時文書が作られていたら必ずゴミ箱に入っている(`counts.created=counts.trashed`)。⑤`Logger` に理由が出る(shim の `Logger` 記録で確認)。⑥`REPORT_NOT_ALLOWED`(`submitted` の記録)はフォールバックせずそのエラーのまま、`counts.created=0`。⑦HTML方式も失敗させた場合(Drive 保存の失敗)は従来どおり `DRIVE_ERROR`。
- C-REP-05(harness-only。ACTIONS と編集関数): ①`ACTIONS` のキー数は43のままで `checkReportEngine` を含まない。HTTP でこれを `action` に送ると `BAD_REQUEST`。②`checkReportEngine()` を呼ぶと文字列 `OK: doc 方式の変換に成功しました(A4 595.28×841.89pt)` を返し、`lastDoc` の用紙が A4、一時文書はゴミ箱、全シートの内容・Events・Reports・ScriptProperties は変わらない。`failMode=convert` のときは例外(メッセージを握りつぶさない)。
- C-REP-06(ユニット/静的検査。`tests/unit`): ①`backend/appsscript.json` の `oauthScopes` に `https://www.googleapis.com/auth/documents` が含まれ、既存の4つ(spreadsheets / drive / script.scriptapp / script.send_mail)も残っている。②`setupSheets()` が `reportEngine` の行が無い既存の Config に**1行だけ**追記し(値 `html`、type `str`)、既存の行・値を変えない。③spec-sync: §2.14 の Config キー(`reportEngine` を含む)と mock の `configKeys` が一致。
- C-REP-07(版1.11.0。実測の表示=HTML方式。§10.2d・§10.2b-A/B。**harness**(`/__mock/lastReportHtml`)。**データ**: `pre_pour` の `qa_ok` 記録。`saveDraft`/`saveQaDraft` で次の値を入れる(`itemId` は seed。項目番号 N は `getRecord` の項目の並びの1始まりで求める): i4(許容5)職長 `[-5,-5,-2,-5,3,-1,5,-5]` / i6(許容2)職長 `[1,-3,2,-2.5]`(職長の結果は **`ng`**・備考・重さ `minor`・写真あり。許容超の `ok` は §5.3.1 で提出できないため)かつ管理者 `[2,3]` / i5(許容5)職長 `[1,2]`・管理者 `[7]`(職長・管理者とも結果 `ok`。**管理者の許容超の `ok` は `qaNote` が非空なら通る**=§5.3.1 版1.11.1) / i8(許容なし)職長 `[2,-1,0]` / i7(許容5)は値なし。管理者の結果は全項目 `ok`(判定 `ok` で `qa_ok`)。**管理者の値が許容超の i5(`[7]`)・i6(`[2,3]`)は `saveQaDraft` で `qaNote` に非空の文(例 `図面で確認済み`)を入れる**(版1.11.1: 入れないと `submitVerdict` が §5.3.1 の `QA_OVER_TOL_COMMENT_REQUIRED` で拒否される)。i6 と i8 に `kind=photo` の写真を1枚ずつ付ける): ①**項目表の実測セルの文字列**(タグを除いたテキスト): i4=`職長: -5、-5、-2、-5、+3、-1、+5、-5` と `n=8 最小-5/最大+5/許容±5mm`(**境界の ±5 は許容内**=`▲` なし)。i6=`職長: +1、▲-3、+2、▲-2.5` と `n=4 最小-3/最大+2/許容±2mm ▲許容超2件`(` `=半角スペース1つ)、続けて `管理者: +2、▲+3` と `n=2 最小+2/最大+3/許容±2mm ▲許容超1件`(**職長の2行→管理者の2行の順。混ぜた要約がない**)。i5=`職長: +1、+2` と `n=2 最小+1/最大+2/許容±5mm`、続けて `管理者: ▲+7` と `n=1 許容±5mm ▲許容超1件`。i8=`職長: +2、-1、0` と `n=3 最小-1/最大+2`(**`許容`・`▲` を含まない**)。i7(値なし)のセルは**空**。②**マークアップ**: i6 の `▲-3`・`▲-2.5`・`▲+3`、i5 の `▲+7` と要約の `▲許容超2件`/`▲許容超1件` が `class="over"` かつ `font-weight:bold;color:#cc0000` の `<span>` の中にあり、`+1`・`+2` と i4 の値は `over` の外。③**旧形式の廃止**: HTML に ` / 許容±` と値の ` | ` 連結が出ない。④**注記**: `実測の ▲ は許容(±)を超えた値の目安です` を含む段落が項目表の直後に1つ。全項目の許容ありの実測を空にした記録(i8 だけ値あり)では**この注記が出ない**。⑤**判定への非影響**: **i5 の行(許容超の `▲+7` があるが職長・管理者とも `ok`)に NG の赤背景 `#fde8e8` が付かない**(i6 の行は職長 `ng` なので赤で正しい)。結果サマリの件数は実測の有無で変わらない。実測セル・注記に `不合格`・`不適合` の語がない。⑥**写真ブロック**(§10.2b-B の3): i6 の写真の情報欄に `実測(職長): +1、▲-3、+2、▲-2.5`・その要約・`実測(管理者): …`・その要約が同じ書式で出る。i8 の写真は `実測(職長): +2、-1、0` と `n=3 最小-1/最大+2`。旧形式 `実測: ` で始まる行がない。値のない項目の写真に `実測` が出ない。⑦**出来形(`post_demold`)にも同じ規則**: `post_demold` の記録で i56(許容10)職長 `[-10,11,4]` → `-10、▲+11、+4` と `n=3 最小-10/最大+11/許容±10mm ▲許容超1件`、i57(許容3)職長 `[3,-3]` → `+3、-3` と `n=2 最小-3/最大+3/許容±3mm`。⑧**レイアウト制約**: `display:flex`/`display:grid`/`calc(` を含まない(§10.2b 共通)。
- C-REP-08(版1.11.0。実測の表示=doc方式。**harness-only**。`reportEngine=doc`。C-REP-07 と**同じデータ**。`lastDoc` の追加観測=§11.4): ①項目表(7列)の `cellTexts` の実測列(5列目): C-REP-07 ① と**同じ文字列**(段落の区切りは `\n`。i7 は `""`)。②`coloredTexts['#CC0000']` に `▲-3`・`▲-2.5`・`▲+3`・`▲+7`・`▲許容超2件`・`▲許容超1件` が含まれ、`+1`・`+2`・`-5` など許容内の値は含まれない。`boldTexts` にも同じ文字列が含まれる(許容超の部分だけが太字)。③項目表の直後の本文段落に C-REP-07 ④ と同じ注記(注記が出ない記録では出ない)。旧注記 `管理者コメントの全文は` が本文に**ない**。④管理者コメント(200文字)が項目表の `cellTexts` に**全文**ある。⑤i6 の写真ブロックの右セルの `cellTexts` に `実測(職長): +1、▲-3、+2、▲-2.5` と要約・`実測(管理者): …` と要約が出る。⑥`post_demold` でも C-REP-07 ⑦ と同じ文字列。⑦NG行以外の背景が変わらない(**i5 の行(`▲+7` あり・`ok`)は背景 `null`**)。⑧C-REP-03 のその他の項目(列幅・改ページ・keepWithNext)は新しい幅で通る。
- C-DRAW-07(版1.11.0。図面の凡例=項目ごとのグループ。HTML方式は `/__mock/lastReportHtml`、doc方式は C-REP-08 と同じ `lastDoc`。doc は harness-only): **データ**: C-REP-07 のデータに、職長の図面を1枚(`kind=drawing`)追加し `markers` を次の10個とする: i4 の `N-1`・`N-2`、i6 の `N-1`・`N-2`・`N-3`・`N-4`、i8 の `N`(丸数字は §7.7。N は i4/i6/i8 の項目番号)。①**列**(6列): 見出し `番号|項目|実測値|許容超|職長|管理者`。doc は列幅 24/76/28/24/17/17mm ×184/186(合計521.57pt±0.5)。②**行の構成**(doc は `cellTexts` の行=見出し1+i4 グループ3(見出し行+2行)+i6 グループ5(見出し行+4行)+i8 の1行形式 1 = **10行**、HTML も同じ行構成): i4 の見出し行=番号列 `No.{N}`・項目列に項目文と要約 `n=8 最小-5/最大+5/許容±5mm`・実測値列と許容超列は空・職長列 `合` など。番号行=`{N}-1` の行は実測値 `-5mm`、`{N}-2` は `-5mm`、許容超列は空。i6 の見出し行の要約=`n=4 最小-3/最大+2/許容±2mm ▲許容超2件`(職長の系列。図面を書いた側=職長が優先され、管理者の `[2,3]` は出ない)、番号行の値=`+1mm`・`-3mm`・`+2mm`・`-2.5mm` で、`-3mm` と `-2.5mm` の行の許容超列に `▲`、他は空。i8 は見出し行がなく1行(番号列=印の文字、項目列=`No.{N} {項目文}`、実測値列・許容超列は空)。③**許容超の装飾**: `-3mm`・`-2.5mm`・許容超列の `▲` が太字・`#CC0000`(HTML は `class="over"`、doc は `coloredTexts`/`boldTexts`)。許容内の行・i4 の行は装飾なし。④見出し行の全セルの背景が `#EEEEEE`(doc は `cellBackgrounds`)。⑤**管理者の図面**: 管理者が書いた図面(`side=qa`、i6 の `N-1`,`N-2`)では系列Sが管理者の `[2,3]` になり、要約が `n=2 最小+2/最大+3/許容±2mm ▲許容超1件`、番号行の値が `+2mm`・`+3mm`(後者に `▲`)。⑥**印が0個**の図面は凡例の代わりに `印の書き込みなし`。⑦既存の C-DRAW-05(図面ごとの改ページ・見出し・順序)は通る。
- U-MEAS-01(版1.11.0。ユニット。`measureView_`=§10.2d-4。`tests/unit`。Report.gs を `vm` で評価するか、純関数を別ファイルに置くなら ReportDoc.gs も同じ関数を呼ぶこと。関数は `Math`/`Number`/`String` 以外のグローバルに依存しない): 入力 `row={ selfValues, qaValues, snapshot:{tol,unit} }` に対し期待(`valuesText` / `summaryText` / `overCount` / `n`): ①許容5・`[-5,-5,-2,-5,3,-1,5,-5]` → `-5、-5、-2、-5、+3、-1、+5、-5` / `n=8 最小-5/最大+5/許容±5mm` / 0 / 8(**境界は許容内**)。②許容5・`[-6,0,5.5,2]` → `▲-6、0、▲+5.5、+2` / `n=4 最小-6/最大+5.5/許容±5mm ▲許容超2件` / 2。③許容3・`[-3,1]` → `-3、+1` / `n=2 最小-3/最大+1/許容±3mm` / 0。④許容3・`[4]` → `▲+4` / `n=1 許容±3mm ▲許容超1件` / 1(n=1 は最小/最大を出さない)。⑤`tol:null`・`[2,-1,0]` → `+2、-1、0` / `n=3 最小-1/最大+2`(`▲`・`許容` を含まない)。⑥`tol` が `0`・`''`・`-1`・`'abc'`・欠落 → ⑤と同じ(許容なし)。`tol:2.5`・`[2.5,2.6]` → `+2.5、▲+2.6` / `n=2 最小+2.5/最大+2.6/許容±2.5mm ▲許容超1件`。⑦`tol:'5'`(数字の文字列)は許容5。⑧`[]`・`null`・`undefined`・`[null,'']`・`[NaN]` → **`null`**(その側は何も出さない)。⑨`['3','-2.5']` → `+3、-2.5`。`['x',2]` → `+2` / `n=1`(無効な要素は数えない)。⑩`[-0,0]` → `0、0` / `n=2 最小0/最大0`。⑪`unit:''`/欠落 → `mm`、`unit:'cm'` → `許容±5cm`。⑫`side:'self'` は `selfValues`・ラベル `職長`、`side:'qa'` は `qaValues`・ラベル `管理者`(同じ row で互いに影響しない)。⑬`values[i].over` と `overCount` が一致し、`values` は入力順(並べ替えない)。⑭呼ぶ前後で `row` を変更しない(副作用なし)。⑮`measureCell_(-3,2)` → `{v:-3,text:"-3",over:true}`、`measureCell_(2,2)` → `over:false`(境界)、`measureCell_("",2)`・`measureCell_(null,2)`・`measureCell_("x",2)` → `null`、`measureCell_(4,null)` → `over:false`。
- C-ADMIN-01: `adminIssueInvite`(first/pinReset の整合・古いコードの失効)、`adminSetUserStatus(disabled)`→そのユーザーの全actionが `USER_DISABLED`、自分自身は変更不可、`adminSetAbsence`/`adminCancelAbsence`、`adminGetJoinInfo` の `joinUrl` 形式。

### 12.4 ユニットテスト(U-)
- U-VALID-01: `frontend/js/validate.js` が `tests/fixtures/validation-cases.json` の全ケースで §5.3.1 と同じ rule・itemId を返す(契約テストと同じデータ)。**版1.9**: `stage=post_demold` で `pourPlannedAt` なしのケースは `POUR_PLAN_REQUIRED` を返さず、`stage=pre_pour` では返す。**版1.11.1**: 同じデータに C-VERD-01/02 のケース(QA側。`side=qa`)を含め、`QA_OVER_TOL_COMMENT_REQUIRED` の有無・`itemId`・**QA側で `MEASURE_OVER_TOL_OK` が返らないこと**・職長側(`side=self`)の `MEASURE_OVER_TOL_OK` が従来どおりであることを検査する。
- U-OUTBOX-01: 同一recordIdの `saveDraft` 統合で `clientId` が新規採番され内容がマージされる。`sending` 中の行は統合せず、その間の変更は別の `pending` 行(次回送信分)になる。送信直前の再読込で、統合後の `params`・新しい `clientId` が送られる(§8.4 の不変条件)。
- U-OUTBOX-02: 順序(同一record内FIFO・`stopPour` 優先)、バックオフ列(2,5,15,30,60,60…秒)、確定エラーで後続行が `blocked`、`CHUNK_MISSING` で `nextIndex=0`、認証エラーで全停止→同一ユーザー再登録で再開。
- U-OUTBOX-03: 作成から30日超の行が `failed`(`lastError.code='EXPIRED'`)になり、送信ループは送らず、S20 は「破棄」のみ出す(「再送」「今すぐ送信」を出さない・呼んでも送信しない)。29日の行は通常どおり送る。
- U-OUTBOX-04(送信可否規則 §8.4。フロントは `outbox.js` に純関数 `selectSendable(rows, {now, photoParallel})`(送る行の `seq` 配列を返す。**契約として確定。テストが直接呼ぶ**)を置く。`claimSendable`・`normParallel` などの内部関数は実装の自由でSPEC外(テストは依存しない)。データ駆動 `tests/fixtures/outbox-schedule-cases.json`): ①写真の行3件(先行の非写真の行なし)で `photoParallel=3` → 3件、`=2` → 2件、`=9` → 6件を上限、設定なし/`null`/0以下 → 1件(入力は整数のみ。小数・文字列の丸めは検査しない) ②同じ記録に先行する `createRecord`(`pending`/`sending`/`failed`/`blocked`)があるうちは写真の行を選ばない(完了して行が消えたら選ぶ) ③`seq` が 写真A・写真B・`saveDraft`・写真C の順 → A,B は同時に選ばれ、`saveDraft` は A,B が両方消えるまで選ばれず(`sending` 中・`failed` でも)、C は `saveDraft` が消えるまで選ばれない ④別の記録の `saveDraft` 2件 → 同時に1件だけ ⑤別の記録の写真の行と非写真の行は同時に選べる ⑥同じ `photoId` の行が2件 → 1件だけ ⑦写真Aが `failed` でも同じ記録の写真B,Cは選ばれ続け、後続の `saveDraft` は選ばれない(確定失敗の通知で `blocked`)。非写真の行が `failed` なら同じ記録の後続の写真の行も `blocked` ⑧`stopPour` は写真の行の完了を待たず最優先で選ばれる。写真の行・非写真の行(`saveDraft` 等)が `failed` になっても、同じ記録の `pending` の `stopPour` は `blocked` にならず選ばれる(`stopPour` 自身が `failed` のときだけ後続が `blocked`) ⑨写真の行が backoff 待ちでも他の写真の行は選ばれる ⑩連続通信失敗カウントは並行する要求を通算し、成功1件でリセット(3回でオフライン)。
- U-OUTBOX-05(写真の送信状態。§8.11.5): `KW.outbox.photoState(row)` が データ駆動(`tests/fixtures/photo-state-cases.json`)で、`null`→`saved`、`pending`(`tries=0`)→`queued`、`pending`(`tries=2`)→`queued`、`sending`→`sending`、`failed`→`failed`、`failed`(`lastError.code='EXPIRED'`)→`failed`、`blocked`(`blockReason='record'`)→`failed`。
- U-OUTBOX-06(保存状態。§8.11.6): `KW.outbox.saveStateOf(rows, online)` が、0件→`synced`、`sending` あり→`sending`、`pending` のみ+オンライン→`queued`、`pending` のみ+圏外→`offline`、`failed` または `blocked` あり→`failed`(`sending` と混在しても `failed`)を返し、`n`=全行数・`m`=`failed`+`blocked` の数になる。
- U-CLASS-01(操作の分類。§8.11.2): SPEC の §8.11.2 の表(`#### 8.11.2` から次の `####` まで)にバッククォートで書かれた action 名の集合が、§5.5 の43 action と完全に一致し、同じ名前が2回出ない。`spec-sync.test.js` に加える。
- U-RESP-01(応答の反映。§5.1a の3): `KW.data.putDetail` に、`version` が小さい詳細→捨てて既存を残す/同じ→反映/大きい→反映、を渡す。`masked` 形は既存の詳細を上書きしない。`drafts`・`outbox`・`photoBlobs` は変わらない。応答に `record` が無い(または `items` が無い)ときは `getRecord` にフォールバックする(`loadDetail` のモック呼び出しで確認)。反映から15秒以内の `loadDetail(recordId, {maxAgeMs:15000})` は API を呼ばず、16秒後は呼ぶ。

- U-PHOTO-01: base64分割(分割モードに入ったときのみ): 連結=元、各チャンク≤90,000文字かつ4の倍数、`total=ceil(len/90000)`、最大12(超えたら `err.photo_too_large`)。
- U-PHOTO-02: `stampText` 生成が §7.2 通り(工区あり/なし、JST固定、`skewMs` 補正)。圧縮の段階的再エンコード(400KB超→0.6→0.5→0.85倍)。
- U-PHOTO-03(モード選択。対象は `planUpload`): `L ≤ photoSingleMaxChars` → `total=1`(`photoMaxBytes` 600,000 の最大 `L=800,000` も単発)。`L > photoSingleMaxChars` → 分割。`config` に `photoSingleMaxChars` が無い → 常に分割(旧サーバー互換)。送信直前(`nextIndex=0`)に config を見て決め直せるが、`nextIndex>0` では変えない。
- U-TIME-01: JST整形が端末TZ(UTC/America/Los_Angeles/Asia/Jakarta)に依らず同一。
- U-I18N-01: ja/idのキー集合が一致・値が空でない・コード内の `t('…')` の参照キーが全て存在・`err.*`/`rule.*`/`ev.*`/`st.*` が網羅。HTML/JSに日本語リテラルが無い(`i18n.js`・コメント除く)。**版1.9**: 段階別の上書きキー(`<基キー>@<stage>`。§9.4)は網羅検査の数え上げから除き、基キーがあること・ja/id の両方にあることだけを検査する。`ts(key,stage)` は上書きキーがあればそれ、無ければ基キーを返す(`stage` が空・未知でも基キー)。
- U-HASH-01: PINハッシュ・招待ハッシュ・`paramsHash`・`canonicalJSON` が `tests/fixtures/hash-vectors.json`(テスト担当がNodeで生成して固定)と mock・harness の双方で一致。
- U-SEED-01: `Seed.gs` の `SEED_ITEMS`・mockのシード・SPEC §2.6.1・§2.6.1a が完全一致(`tests/fixtures/seed-items.json` を基準。i1〜i69の69行)。

### 12.5 E2Eテスト(E-。Playwright、375×667、ja/id)
- E-01 登録: S01で田中を選びPIN→ホーム。リロードしてもPIN不要。誤PIN×5で S02。責任者が解除(別コンテキスト)→復帰。`invited` の氏名では招待コード欄が出る。
- E-02 職長フロー: 現場A→2F→記録作成(ロット入力)→打設前の新規記録の28項目入力(i1〜i16+i58〜i69。OK/NG/該当なし、実測、コメント)→NGと重点項目で写真撮影(fakeカメラ)→違反が赤枠で出てから修正→確認画面(現場・階・工区・ロット表示)→PIN→「確認待ち」。田中のホームに s_c が出ない。他班の記録が「他班が入力中」で無効。
- E-03 QAフロー: 佐藤がボードで確認待ち(提出順・エスカレーション表示)→「確認中にする」→全項目入力(NGは備考・重さが必須、写真は任意=写真なしでも判定できる)→「合格」ボタンの有効条件→PIN→`qa_ok`→元請PDF生成(M6)→元請サイン記録(M5, PIN)→`approved`(打設可)。3者サイン欄が全て済。
- E-04 差し戻し: 軽微な不適合→`fix`→職長は是正コメントを見て編集可→再提出(PIN)→`round2`。提出後の画面は読み取り専用(編集ボタンなし)。
- E-05 オフライン(圏外で下書き・撮影 → 復帰で自動送信 → オンラインで提出(PIN)): `context.setOffline(true)` で下書き入力・撮影 → outboxバッジ件数・「圏外」表示・提出ボタン無効(`msg.offline_required`。圏外では提出できない) → 復帰で自動送信されバッジが0に → サーバー側に二重なし(`/__mock/state` の件数) → **オンラインになってから提出(PIN入力 M1)して `submitted`**。`/__mock/fail`(after:true)で応答喪失を起こしても二重にならない。リロードしても下書きとoutboxが残る。
- E-06 同時操作: 2つのブラウザコンテキストで佐藤・鈴木が同時に「確認中にする」→片方のみ成功、他方に「◯◯が確認中」。佐藤で s_c の記録を開いても確認ボタンが出ない(権限なし)。
- E-07 レイアウト: 全画面(S00〜S20、M1〜M9)を ja/id × 375px で巡回し、横スクロールなし(`scrollWidth<=clientWidth`)・ボタンが画面外に出ない・**全ての操作要素(バッジ・言語ボタン・リンク含む)のタップ領域が44×44px以上**。S06/S07/S08/S10/S12/S13 は読み込み中・エラー表示でも現場名(取得不可なら「現場不明」。`siteId` は出さない)が出ている。
- E-08 i18n: 言語切替で全画面の文字が切り替わり、キー文字列(`scr.`/`err.` などのプレフィックス)が画面に露出しない。項目文・グループ名がマスタの `textId/groupId` になる。
- E-09 ロック: 5回誤りでロック画面、ロック中は全操作不可、責任者(S16)で解除。
- E-10 参加: 職長がQR(URL)から参加申請→「承認待ち」→主担当QAが承認(班名入力)→職長の現場一覧に出る。旧QR(合言葉更新後)では申請できない。
- E-11 打設停止: `approved` の記録で職長が「打設を止める」(理由)→`fix`・停止バナー・責任者のボードに表示。出来形の記録(`approved` を含む)の画面には「打設を止める」ボタンが出ない(E-15)。
- E-12 管理: 責任者が招待コード発行(コードは1回だけ表示)・端末登録解除(解除された端末はS01へ)・不在登録・QR表示/合言葉更新。
- E-14 図面の書き込み(版1.6): 職長でS06を開き「図面を追加」→ファイル選択(テスト用の図面画像)→M10で項目番号④(測定項目)を選び図面上を2回タップ → 印が `④-1`・`④-2`、番号①(測定なし)を1回置くと `①`、2回置くと `①-1`・`①-2` に付け替わる。「ひとつ戻す」「この印を削除」で枝番が連番に戻る。印の周りに枠(楕円・白い塗り)の要素・描画が無いことを確認(試作用に `data-testid` を持つ印要素、またはエクスポートした画像の画素検査で、印の周囲が元画像のまま=白い塗りが無い)。「登録」→outboxバッジ→S06の「図面」欄にサムネ→mockの `getRecord.drawings` が1件・`markers` が2件以上。提出済みにすると「図面を追加」「削除×」が無効。管理者(S10)でも追加でき、職長のS06(`submitted`)には出ない。ja/id両方で表示が崩れない(文言は辞書経由)。
- E-13 写真の単発・並行送信(mockを `--latency 300` で起動): オンラインで5枚を続けて撮影(別項目)→ Playwright のリクエスト監視で ①各 `photoId` につき `uploadPhotoChunk` が **ちょうど1回**(`total=1`) ②同時に進行する `uploadPhotoChunk` の最大が 2 以上かつ `photoParallel`(3)以下 ③全て完了後にoutboxバッジ0、サーバーの `Photos` が5行・仮想Driveの有効ファイルが本体5+サムネ5。さらに写真送信中は「提出する」が無効で「送信中(残りN件)」が出て、全完了後に提出でき `PHOTO_REQUIRED` にならない(§8.6)。写真の1枚が確定失敗(`/__mock/fail` の `mode:"error",code:"PHOTO_INVALID",match:"uploadPhotoChunk"`)しても他の4枚は送られ、S20 に失敗1件が出る。
- E-15 出来形検査(版1.9。ja/id、375px): 職長でS04を開くと各階のカードに「打設前」「出来形」の段が並び、記録の無い段階は「未着手」。S05で段階を「出来形」にすると打設予定日時の欄とヒントが消え、「打設前」に戻すと出る。同じ階・工区・ロットで打設前と出来形をそれぞれ作成でき(2件目で `ALREADY_EXISTS` にならない)、S06 に出来形の8項目(No.1〜8)、打設前の新規記録に28項目(No.17〜28 が i58〜i69。グループ見出しが二重に出ない)が出る。出来形を入力→提出(PIN)→QA(S10。ヘッダに段階)が合格(PIN)→元請サイン記録(M5。説明文・ボタンの語が「出来形確認済」)→S08/S04/S09/S11 のステータスが「出来形確認済」になる(打設前の `approved` は「打設可」のまま)。出来形の画面(S04〜S08・S10・S11・M4/M5・S09・PDFのM6)のどこにも「打設可」「打設を止める」「打設停止」「打設予定日時」が出ない(打設前の記録には従来どおり出る)。S09 のグリッドは階ごとに段階別のチップ、S03 の現場カードは段階ごとの件数行。他班の職長から見た出来形の行に「打設を止める」ボタンが出ない。

- E-23 先出し(待たない。mock を `--latency 2000` で起動。版1.10): ①田中が S06 で項目の回答・実測・コメントを入力 → 画面(ボタンの選択・進捗バー・入力欄)が **300ms以内**に反映される(サーバー応答を待たない)。保存状態行は『送信待ち/送信中… → 送信済み ✓』と変わる。②`fix` の記録の S08 でコメントを追記して『追加』 → **500ms以内**に入力欄が空になり『送信待ちのコメント』に本文が出る。約2秒後に確定コメントに入れ替わってカードが消え、この間 `getRecord` の呼び出しが **0回**(Playwright のリクエスト監視)。③『追加』の直後に続けて別のコメントも追記できる。④ja/id、375pxで崩れない。
- E-24 先出しの失敗(ロールバックと導線。版1.10): ①`/__mock/fail`(`mode:"error"`,`code:"RECORD_LOCKED"`,`match:"addNote"`,`next:1`)で追記が失敗 → カードが赤『送信できませんでした』+[再送][破棄]。『再送』で成功しカードが消える。もう一度失敗させて『破棄』 → 本文が入力欄に戻り outbox は0件。②`saveDraft` を同様に失敗(`RECORD_LOCKED`)→ S06 の上部に赤バナー『送信できなかった入力があります』+『他の人が先に状態を変えました。入力は端末に残っています』、入力値は画面に残る。『破棄』→確認ダイアログ→サーバーの値で再表示。③送信済みの写真を削除して `deletePhoto` を失敗させる → 写真が再表示され『削除できませんでした』が出る。④いずれの失敗のときも、ヘッダのバッジが赤『未送信 {n} ・要対応 {m}』、画面を問わず出るバナー『送信できていない操作があります』が出て、[確認する]で S20 へ行ける。解消するとバナーが消える。
- E-25 PIN・先着の操作は先出しされない(mock を `--latency 2000` で起動。版1.10): ①提出(S07→M1)・合格(S10→M1)・元請サイン(M5→M1): PINを入れて『OK』 → 応答まで画面が遷移しない(S07/S10/M5 のまま)。『OK』は『送信中…』+スピナーで無効、『キャンセル』も無効。応答後に応答の `record` で S08 が描かれ、**その間の `getRecord` 呼び出しは0回**。②`--latency 9000` で『通信に時間がかかっています。そのままお待ちください』が出る。③誤PIN → M1 に『あと{n}回』が出て画面は進まない。5回誤り → S02。④2つのブラウザコンテキストで佐藤・鈴木が同時に『確認中にする』 → 後着に『{名前}が確認中』が出る。後着の画面が一度でも『自分が確認中』にならない(先出しの痕跡がない)。`claimReview` の成功のあと `getRecord` は呼ばれない。⑤`STATE_CONFLICT`/`RECORD_LOCKED` の拒否はエラー表示となり、画面は進まず、記録は取り直される。
- E-26 写真の状態表示(mock を `--latency 1500` で起動。版1.10): 5枚を続けて撮影(別項目) → ①『使う』から **300ms以内**にサムネが出る。②各サムネに状態ラベルが付き、同時送信数(`photoParallel`)ぶんが『送信中』、残りが『送信待ち』になる。③完了した写真は『保存済み ✓』を約2秒出して消える(以後ラベルなし)。全完了で保存状態行が『送信済み ✓』。④完了のたびの `getRecord` は **0回**(§8.4・§8.11.8)。各 `photoId` の `uploadPhotoChunk` はちょうど1回(E-13 と同じ)。⑤`/__mock/fail`(`mode:"error"`,`code:"PHOTO_INVALID"`,`match:"uploadPhotoChunk"`,`next:1`)で1枚が『失敗』(赤)になり、タップ→[再送][破棄]。失敗が残る間 S07 の提出ボタンは無効で、『写真の送信が終わるまでお待ちください』『写真 n/5 送信済み』『写真の送信に失敗が1件あります』が出る。再送して全て完了すると提出できる(`PHOTO_REQUIRED` にならない。§8.6)。⑥圏外(`context.setOffline(true)`)では『圏外のため送信待ち』が出て、復帰で自動送信される。⑦図面も同じ状態ラベルになる。
- E-27 未送信の可視化(版1.10): 圏外で下書きを入力 → ヘッダのバッジが黄色『未送信 {n}』、保存状態行『圏外のため端末に保存中({n}件)…』。復帰して自動送信 → バッジが 0 になり『送信済み ✓』。S04 の該当の記録の行に『未送信』バッジが付き、送信後に消える。375px・ja/id で横スクロールなし、バッジ・[再送][破棄]・[確認する]のタップ領域が44px以上(E-07 の巡回にも含める)。
- E-28 getRecord を省く(版1.10): 提出(S07)・合格/軽微/重大(S10)・元請サイン(M5)・打設停止(M4)・確認中にする(S10)の成功直後(15秒以内)に開く S08/S10 の描画のために `getRecord` が呼ばれない(リクエスト監視)。描かれた内容は `getRecord` の結果と一致する。Playwright の `route` で応答から `record` を取り除いた場合は、従来どおり `getRecord` で取り直して同じ画面になる(後方互換)。
- E-29 読み取り側の待ち短縮(仮置き P-45 の承認後のみ): 起動で `me` と `getBootstrap` が同時に送られる。`deviceToken` とキャッシュがある端末は、応答を待たずにホームが描かれる(`--latency 2000` で 500ms以内)。応答が `UNAUTHENTICATED`/`USER_LOCKED` ならS01/S02 へ遷移する。キャッシュのある記録の S08/S10 は先に描かれ、裏の `getRecord` で `version` が大きければ差し替わる。**承認までは実装・実行しない**。
- E-30 管理者の許容超 OK とコメント必須(版1.11.1。§9.2b。mock。ja と id、375px): 職長が i4(許容5)に実測 `3` を入れて提出 → 佐藤が S10 で確認中にし、i4 の管理者の実測に `6` を入れて `OK` を押す → ①コメント欄の直上にヒント(ja: `許容を超えた値があります。OKにする場合は、理由を管理者のコメントに書いてください(必須)`)が出て、コメント欄が赤枠(`aria-invalid="true"`)で `placeholder` が `理由・確認した内容を書いてください(必須)`。②「合格」「軽微な不適合」「重大な不適合」の3つが無効で、各ボタンの下と「やること」に `許容を超えた値にOKを付けるには、コメントを書いてください`(項目番号つき)。この間に `submitVerdict` のリクエストが出ない(Playwright のリクエスト監視)。③`saveQaDraft` は送られる(コメント空でも下書きは保存される)。④コメントに空白だけを入れても同じ。⑤コメントに文を入れる → ヒントの赤枠が消え、「合格」が有効 → PIN → 成功して S08 に遷移し、管理者コメントが表示され、職長のコメントは変わらない。⑥実測を `5` に直す(または結果を `NG` に変える)とヒントが消え、コメント無しで「合格」が有効(NG にしたときは備考と重さが要る)。⑦キー文字列(`rule.`/`scr.`)が画面に露出せず、id でも同じ流れ(辞書キーが ja/id で揃う)。⑧職長の S06 では、許容超に OK を付けて提出すると従来どおり `許容を超えているためOKにできません` が出る。⑨全画面の横スクロールなし(E-07)。

### 12.6 性能の受け入れ基準(版1.5。実GASでの目標。手動確認項目)

自動テストにはしない(`run-all.js`・mock・harness は対象外。通信と GAS の実行時間は環境で変わるため)。**本番相当のデプロイ(実GAS + 実スマホ)でバックエンド/フロント担当(または責任者)が手動で測り、結果を日付つきで `docs/OPERATIONS.md` の「性能確認」欄に残す**(バックエンド担当)。

| # | 項目 | 目標(各3回測って中央値) | 測り方 |
|---|---|---|---|
| PERF-01 | `GET {API_URL}?action=ping` | 約1.5秒以内 | 2回目以降(ウォーム状態)。ブラウザの開発者ツールのネットワーク時間、または端末のクライアント側タイマー |
| PERF-02 | 写真1枚(約300KB)の送信(`uploadPhotoChunk` 1回) | 約10秒以内(撮影確定〜サーバー応答までではなく、リクエスト送信〜応答) | `total=1` の1リクエストで完了していること(ネットワークタブで同じ `photoId` のリクエストが1回) |
| PERF-03 | 写真10枚(各約300KB、別項目)の送信完了 | 約40秒以内(3並列=`photoParallel` 既定) | 10枚撮影してから outbox バッジが0になるまで。同時に進行するリクエストが最大3であること |
| PERF-04 | 先出し操作の画面反映(版1.10) | 300ms以内(各3回測って中央値) | 実機で、回答の入力・コメント追記の『追加』・写真の『使う』を押してから、画面が変わるまで。サーバー応答は待たない。端末の動画撮影または開発者ツールの Performance で測る |
| PERF-05 | 待つ操作の『押してから次の画面が描かれるまで』(版1.10) | 往復1回分+描画(`getRecord` の追加往復が0) | 提出・合格・元請サイン・確認中にする。ネットワークタブで `getRecord` が追加で呼ばれていないこと。S21 通信診断の `rt` の1回分に近いこと。結果を日付つきで `docs/OPERATIONS.md` の『性能確認』欄に残す |

- 前提: モバイル回線またはWi-Fiで通常の電波状態。GASのコールドスタート直後の1回目は除く(別途「初回は遅い」ことを許容)。
- 目標を満たさないとき: ①ネットワークタブで同一 `photoId` の複数リクエスト(分割になっていないか)・並列数を確認 ②Apps Script の実行ログで `uploadPhotoChunk` の所要時間を確認し、§2.16(重複読込・全件読込)と §1.6 の7(`uploadPhotoChunk` のロック範囲)の実装漏れを探す ③それでも届かなければ実測値を添えて設計担当へ「SPEC変更要望」(目標値や方式の見直し)。**目標未達は不具合ではなく、原因が実装漏れか目標の見直しかを分類する**(CLAUDE.md §5 の5)。
- 数値は目安(「約」)。10〜20%程度の超過は、再測定のうえ許容するかを責任者が判断する。

### 12.7 実GASでの見た目の確認(版1.10.1。**手動**。自動テストにしない)
harness の `DocumentApp` の代役(shim)は、**値(用紙・余白・画像の数・改ページ数・列幅)と処理の流れ**しか検証できない。**見た目(文字化け、行の折り返しによる崩れ、4枚が実際に1ページに収まるか、白紙ページ)は実GASでしか確認できない**。手順は §10.6(`docs/OPERATIONS.md` に項目として書く)。ユーザー(責任者)が1件の記録で行う。

| # | 項目 | 合格の基準 | 見方 |
|---|---|---|---|
| REAL-PDF-01 | 用紙 | PDF のプロパティが **A4(210×297mm)**。レター(8.5×11インチ)でない。余白が約12mm | PDFビューアのドキュメントのプロパティ、または印刷画面の用紙サイズ |
| REAL-PDF-02 | 写真ページ | **1ページに4枚**。5枚目は次ページの先頭。5ページ目へのはみ出し・白紙ページなし。縦横比が崩れない | 写真5枚以上の記録で目視 |
| REAL-PDF-03 | 文字 | 文字化け(□・?)なし(日本語、★、±、丸数字)。NGが赤、職長/管理者コメントが別の列 | 目視。×ならフォント変更を設計担当へ(§10.5.2) |
| REAL-PDF-04 | 所要時間 | 押してから完了まで **60秒以内**(写真10枚前後の記録。60枚近い記録は参考値) | ストップウォッチ。80秒を超えるとフォールバックする(§10.5.8) |
| REAL-PDF-05 | 方式の確認 | Drive のファイルの説明が `engine=doc`(`engine=html (fallback…)` でない) | Drive の詳細、または Events の `detail` |
| REAL-PDF-06 | 実測の表示(版1.11.0。**html・doc の両方**で確認) | ①項目表の実測が切れない ②`▲` と要約 ③図面の凡例が項目ごとにまとまる ④許容ちょうどの値に `▲` が付かない ⑤`▲` と `許容超` の文字が日本語で化けない(`▲` が □ になるときは設計担当へ) ⑥許容超の行に NG の赤背景が付かない(合否は人の判定) | 許容を超える測定値と許容ちょうどの測定値を入れた記録(実測を8〜10個入れた項目を含む)で目視 |
- 合格しても**既定は変えない**。ユーザーが「既定を `doc` に」と指示したら、設計担当が §2.14 の既定と変更履歴を直す(別の版)。

---

## 13. ファイル配置と担当分割

### 13.1 配置(1エージェントが触るファイルは分ける。他担当のファイルは編集せず、必要な変更は報告に書く。CLAUDE.md §4)

```
katawaku-inspection/
├─ CLAUDE.md  REQUIREMENTS.md  SPEC.md         … 設計担当のみ SPEC.md を編集
├─ reference/                                   … 読み取り専用
├─ backend/                                     … 【バックエンド担当】
│   ├─ appsscript.json                          マニフェスト(§1.3)
│   ├─ Code.gs        doGet/doPost・封筒検査・dispatcher(§1.6)・エラー変換・ACTIONS表
│   ├─ Util.gs        now()/newId(prefix)/JST整形/canonicalJSON/SHA-256/HMAC/base64/入力検査ヘルパ
│   ├─ Schema.gs      SCHEMA(§2の全シート・列・型)・setupSheets()・setupSecrets()・setupTriggers()・installKeepWarmTrigger()・removeKeepWarmTrigger()・keepWarm()(版1.10。§6.7a。いずれも action ではない)
│   ├─ Repo.gs        シート読み書き(一括読み・型変換・参照シート(Config/Items/Sites)のみ60秒キャッシュ §2.15・追記専用の保護)
│   ├─ Seed.gs        SEED_ITEMS(§2.6.1)・初期Config(§2.14)
│   ├─ Auth.gs        registerDevice・PIN/招待・deviceToken・stepUp検証・ロック(§3)
│   ├─ Authz.gs       authorize()・siteAccess/isAbsent/effectiveQaMain/allowedActions/escLevel/computeTiming(§4.2,§6)
│   ├─ Idem.gs        冪等キー(§5.2)
│   ├─ Records.gs     記録系action(§5.4.3)・提出/判定検査(§5.3.1)・Notes/Events追記
│   ├─ Photos.gs      写真アップロード・Drive保存・サムネ(§5.4.4,§7)
│   ├─ Membership.gs  参加・名簿・不在(§5.4.6,§5.4.7の参照系)
│   ├─ Admin.gs       admin*・adminValidateRoster
│   ├─ Report.gs      PDF生成(§10。HTML方式・方式の切替とフォールバック)
│   ├─ ReportDoc.gs   PDF生成のGoogleドキュメント方式と `checkReportEngine`(§10.5。版1.10.1)
│   ├─ Notify.gs      メール・escalationTick・dailyMaintenance(§6.4,§6.6,§6.7)
│   └─ harness/       GAS互換ハーネス(Node)
│       ├─ server.js  vmで *.gs を読み込み、shimを注入して POST/GET /api と /__mock/*(§11.4)を port 8788 で提供
│       └─ shims.js   SpreadsheetApp/DriveApp/LockService(getScriptLock/getUserLock。`lockHeld` を `/__mock/driveLog` 用に記録)/CacheService(1値100KB制限・TTLは仮想時計)/PropertiesService/Utilities/ContentService/MailApp/HtmlService/Session のインメモリ実装(`HtmlService`のPDF変換はスタブ)
├─ frontend/                                    … 【フロント担当】(ビルド不要・外部CDN不使用)
│   ├─ index.html  manifest.webmanifest  sw.js  config.js  styles.css  i18n.js
│   ├─ icons/                                   仮アイコン(192/512px PNG)
│   ├─ vendor/qrcode.js                         QR生成(ライセンス明記の小さな自前/公開実装。端末内生成。外部通信なし)
│   └─ js/
│       ├─ app.js       起動(S00)・ルータ・タブ・グローバルエラー処理
│       ├─ api.js       fetch(text/plain, redirect:follow)・封筒・タイムアウト・エラー正規化
│       ├─ db.js        IndexedDB(§8.2)
│       ├─ outbox.js    キュー操作(統合・優先度・バックオフ・ブロック)
│       ├─ sync.js      送信ループ・ポーリング・キャッシュ更新(§8.4,§8.9)
│       ├─ validate.js  提出検査・判定検査の事前検証(§5.3.1と同rule)
│       ├─ photo.js     カメラ・スタンプ・圧縮・分割(§7)・図面の取り込みと縮小/再圧縮(§7.7。純関数 `fitDrawing`/`drawingLabels` もここ)
│       ├─ drawing.js   図面エディタ M10 の描画・印の操作(§7.7。DOM部分。`ui/` ではなく `js/` 直下でも `ui/` でもよいが1ファイルに分ける)
│       ├─ time.js      JST固定整形・skew補正・経過表示
│       └─ ui/          画面(s01.js … s20.js)・modals.js・components.js
├─ mock/                                        … 【モック担当】
│   ├─ server.js        HTTP(§11.2)
│   ├─ engine.js        全actionのロジック(§1.6〜§6。`authorize`等を同名で実装)
│   ├─ seed.js          §11.5 のシード
│   └─ pdfstub.js       最小PDF生成
├─ tests/                                       … 【テスト担当】
│   ├─ package.json  run-all.js  check-syntax.js  spec-sync.test.js
│   ├─ contract/*.test.js   unit/*.test.js   e2e/*.spec.js
│   ├─ helpers/             api client・clock・static-server・console guard
│   └─ fixtures/            sample.jpg  validation-cases.json  hash-vectors.json  seed-items.json
└─ docs/
    ├─ DEPLOY_GAS.md        【バックエンド】Apps Script作成・デプロイ(「自分として実行/全員」)・`setupSecrets`/`setupSheets`/`setupTriggers`・`appBaseUrl`設定・更新手順
    ├─ DEPLOY_PWA.md        【フロント】ホスティング手順(Cloudflare Pages想定)・`config.js` 設定・SW更新・ホーム画面追加の案内
    └─ OPERATIONS.md        【バックエンド】名簿運用(ユーザー追加→招待コード→端末登録、ロック解除、退職、紛失端末、QR印刷、月初の名簿見直し、`adminValidateRoster`)
```

### 13.2 担当ごとの責務と完了条件

| 担当 | 作るもの | 触ってよい場所 | 完了条件(共通: CLAUDE.md §5 + 下記) |
|---|---|---|---|
| バックエンド | `backend/`・`docs/DEPLOY_GAS.md`・`docs/OPERATIONS.md` | `backend/`,上記docs | harness経由で契約テスト全通過。`node --check`。**全ての時刻は `Util.now()`、乱数/ID は `Util.newId()` 経由**(`new Date()`/`Math.random` を他で直接使わない。harnessが時計を差し替えるため)。権限判定は `Authz.gs` の `authorize` のみ。シークレット・PIN平文をログ/シートに残さない。**読み込みは §2.16 に従う(リクエスト内メモ・必要な行/列だけ読む。可変データはリクエストをまたいでキャッシュしない)**。性能目標 §12.6 を実GASで手動確認し結果を `docs/OPERATIONS.md` に残す。**版1.9**: `Seed.gs` を69行・`enabledStages` 既定を `pre_pour,post_demold` にし、`addMissingSeedItems()`(§2.6.1b)と本番への反映手順を `docs/OPERATIONS.md` に書く |
| フロント | `frontend/`・`docs/DEPLOY_PWA.md` | `frontend/`,上記docs | mock相手にE2E全通過。権限判定をフロントに書かない(`actions` のみ)。直書き文字列なし。375pxで崩れない |
| モック | `mock/` | `mock/` | 契約テスト全通過。§11の全機能(`/__mock/*` 含む)。SPECとの同期テスト通過 |
| テスト | `tests/` | `tests/` | §12の全ケースを実装。`run-all.js` で一括実行できる。失敗時は原因がどの担当かわかる出力 |
| 設計 | `SPEC.md` | `SPEC.md` | 本書の保守。変更履歴の記録 |

版1.10 の責務(SPEC §5.1a / §6.7a / §8.11 / §9.2a / 付録A):
- バックエンド: ①`record` を載せる action(§5.1a)と `Idem` の再構築 ②`keepWarmMinutes`(Config・`setupSheets` の不足キー追記) ③`installKeepWarmTrigger` `removeKeepWarmTrigger` `keepWarm` ④`docs/OPERATIONS.md` に導入・解除手順 ⑤harness の `ScriptApp` の代役と C-RESP / C-KEEP。
- フロント: ①`KW.outbox.photoState` `saveStateOf` ②待つ操作の『送信中…』と8秒の案内 ③`loadDetail(recordId,{maxAgeMs})` と書き込み後の `getRecord` 廃止 ④保存状態行・写真ごとの状態・バッジ・全画面バナー・保留中のコメント欄・失敗時の再試行/破棄 ⑤新しい i18n キー(§9.4)。
- モック+テスト: ①`record` の返却と `Idem` の再生 ②Config 初期値 `keepWarmMinutes` ③C-RESP / C-KEEP / U-OUTBOX-05,06 / U-CLASS-01 / U-RESP-01 / E-23〜E-28 / PERF-04,05。E-29 は P-45 の承認後。

版1.10.1 の責務(SPEC §10.5・§10.6・§12.3 C-REP-02〜06・§12.7。元請PDFのGoogleドキュメント方式):
- バックエンド: ①`backend/ReportDoc.gs` 新設(§10.5.2〜10.5.6 の文書組み立て・`buildReportPdfBlobDoc_`・`checkReportEngine`)と `Report.gs` の方式切替・フォールバック・Events `detail` のキー追加・Drive ファイルの説明(§10.5.1・10.5.8。HTML方式のコードは変えない) ②`appsscript.json` に `documents` スコープ(§1.3・10.5.9)と `docs/DEPLOY.md` 3-4 の説明 ③Config `reportEngine`(`setupSheets` の不足キー追記。`bootstrap.config` に出さない) ④harness の `DocumentApp` 代役(shim。`DriveApp.getFileById(id).getAs/setTrashed/setDescription` を含む)と `/__mock/docShim` ⑤`docs/OPERATIONS.md` に §10.6 の手順(承認・切替・見た目の確認・元に戻す)。**実 GAS の `DocumentApp` の挙動で SPEC と食い違う点・未確認の点(§10.5 の「未確認」)は、推測で埋めず報告する**。
- モック+テスト: ①Config 初期値 `reportEngine=html`(mock は方式を読まない=§11.3) ②C-REP-02〜06(02〜05 は harness-only、06 は unit)。③E2E・フロントは変更なし。
- フロント: 変更なし(`generateReport` の請求・応答・画面は同じ)。

版1.11.0 の責務(SPEC §10.2d・§10.2b-A/B・§10.2c-3・§10.5.3〜10.5.5・§11.4・§12.3。元請PDFの実測の表現):
- バックエンド: ①`Report.gs` に純関数 `measureView_(row, side)`(§10.2d-4。`measureText_` は廃止して全呼び出しを置換)②HTML方式: 項目表の列幅 8/40/14/18/46/30/30mm・全セル折り返し可(`nowrap`/`overflow:hidden` を外す)・実測列は `word-break:normal`・旧注記の廃止と §10.2d-8 の注記・実測セルと写真ブロックの実測欄を §10.2d の書式(`class="over"` のマークアップ)・図面の凡例を6列の項目グループ(§10.2c-3)③doc方式(`ReportDoc.gs`): 同じ内容(列幅 ×184/186。セル結合なし。許容超は `setText` 後の範囲指定で太字・`#CC0000`)④harness の `DocumentApp` 代役に `tables[i].cellTexts`・`coloredTexts`・`boldTexts` の観測を追加(§11.4)⑤`docs/OPERATIONS.md` の §10.6 に実測の見た目の確認項目を追加(REAL-PDF-06)。**API・シート・列・ハッシュは変えない。SPECと食い違う点・実 GAS で確認できない点は推測で埋めず報告する**。
- モック+テスト: ①U-MEAS-01 ②C-REP-01 ②の改訂・C-REP-03 ⑤の列幅の改訂 ③C-REP-07・C-REP-08・C-DRAW-07(doc側は harness-only)。mock は PDF を作らないので変更なし(mock の `lastHtml` を使うテストは harness 側で実行)。
- フロント: 変更なし(PDF だけの変更。画面・i18n 辞書の追加なし。PDFは日本語固定)。

版1.11.1 の責務(SPEC §5.3.1・§5.4.3 `submitVerdict`/`saveQaDraft`・§9.2b・§9.4・§10.2d-9・§12.3 C-VERD-01〜03・C-REP-07・§12.4・§12.5 E-30。管理者の許容超 `ok` とコメント必須。action 名・列名・エラーコード・Config・シートは変更なし):
- バックエンド: ①`Records.gs` の `checkItems_('qa')` で `MEASURE_OVER_TOL_OK` を出さない(`'self'` は変更なし)②`checkItems_('qa')` に `QA_OVER_TOL_COMMENT_REQUIRED` を追加(§5.3.1 の4条件。`snap.tol>0` かつ `qaValues` の有効値に `|値|>tol`、`qaResult=ok`、`Util.blank(qaNote)`。有効値は §10.2d-1 と同じ=`Report.gs` の共通ヘルパを使えるなら使う)③`Code.gs` の rule 一覧に新 rule を追加(`spec-sync` が §5.3.1 と突き合わせる)④`saveQaDraft` は検査しない(変更なし)。
- モック+テスト: ①`mock/actions.js` の `itemViolations` を同様に(`who==='qa'` では `MEASURE_OVER_TOL_OK` を出さず、新 rule を出す)、`mock/engine.js` の `VIOLATION_RULES` に追加 ②C-VERD-01〜03・U-VALID-01 のケース追加(`tests/fixtures/validation-cases.json`)・U-I18N-01・E-30 ③既存テストの改訂: `tests/helpers/report-measure.js` と `tests/contract/report-measure.test.js`(管理者の許容超 `ok` が拒否される前提の箇所)、`backend/harness/test/measure.test.js` の「現行は拒否」コメントと該当ケース、C-REP-07 のデータ(許容超の i5・i6 の管理者 `qaNote` を入れる)。
- フロント: ①`frontend/js/validate.js`(§9.2b-1。`side='qa'` では `MEASURE_OVER_TOL_OK` を出さず新 rule を出す。職長側は変更なし)②`frontend/js/ui/s10.js`(§9.2b-2〜4: ヒント・赤枠・`placeholder`・判定ボタンの無効化と理由)③`frontend/i18n.js` に新キー3つ(§9.4 の版1.11.1 の表。ja/id)。`frontend/sw.js` の `SW_VERSION` を上げる(シェルのファイルを変えたので。sw.js の既存の注記どおり)。

### 13.3 契約変更の手順
1. 実装者が食い違い・不足を見つけたら、**実装を直す前に**設計担当(親エージェント)へ報告する(契約外のフィールド/エンドポイントを勝手に足さない)。
2. 設計担当が SPEC.md を直し、末尾「変更履歴」に1行追記する。
3. 各担当が最小差分で追随し、`spec-sync.test.js` が通ることを確認する。

### 13.4 進行順(CLAUDE.md §4)
1. SPEC(本書)→ 2. モック+契約テスト(モック担当とテスト担当が並行。完了条件=mockで契約テスト全通過)→ 3. バックエンド(+harness)とフロントを並行実装(バックエンドの完了条件=harnessで契約テスト全通過、フロントの完了条件=mockでE2E全通過)→ 4. 結合(E2EをharnessにもかけるUI×本実装)→ 5. レビュー。前段が終わるまで次に進まない。実GASでの契約テストは本番デプロイ前に手動で1回実施(`API_URL` を指定し、`/__mock/*` 依存テストは自動スキップ)。

### 13.5 環境メモ
Node v22.22.0(確認済み)。Playwright 1.56.0 のCLIは存在するが **ブラウザ未導入**(`~/.cache/ms-playwright` なし)→ テスト担当は `npx playwright install chromium` が必要(ネットワークは環境のプロキシ経由。失敗時は報告)。

---

## 14. 仮置き事項

### 14.1 一覧(`P-xx`。確定するまで本書の値で実装する。REQUIREMENTS.md §3 への追記は親エージェントが行う)

| ID | 内容 | 暫定の決め |
|---|---|---|
| P-01 | 静的PWAのホスティング先 | Cloudflare Pages(代替 GitHub Pages / Firebase Hosting)。差は `config.js` のみ |
| P-02 | PINハッシュ方式 | HMAC-SHA256(ペッパー=スクリプトプロパティ)+ユーザー別ソルト+5回ロック。4桁は総当たり可能なためペッパー秘匿が前提 |
| P-03 | 初回PINの設定方法 | 責任者が発行する6桁の招待コード(72時間有効)で、本人が初回にPINを決める。名簿(Users)は責任者がシートに行追加 |
| P-04 | 手書きサイン | 作らない。PIN再入力+氏名・日時の自動記録を「電子サイン」とする(prototypeの手書きサイン画面は廃止) |
| P-05 | オフラインでのPIN必須操作 | 提出・合格・元請サイン記録はオンライン限定(PIN平文をキューに残さないため)。下書き・写真・コメントはオフライン可 |
| P-06 | 時間ルール(前日15:00/16:00/打設2h前) | 警告・フラグのみで操作は拒否しない。提出時に `pourPlannedAt` は必須(打設前のみ。出来形には適用しない。§6.8) |
| P-07 | `minor` 判定の扱い | `minor`/`major` とも status は `fix`(差し戻し)。`major` は重大フラグ(`major=TRUE`)を立て責任者へ通知 |
| P-08 | 異常時の打設停止 | status を `fix`+`stopped=TRUE` に戻し、3者サインを無効化(statusを増やさない) |
| P-09 | 通知 | アプリ内(ポーリング)+メール(`Users.email` があるときのみ)。Web Push はv2。職長へメールしない |
| P-10 | 段階(`stage`) | **版1.9: `pre_pour`(打設前)と `post_demold`(出来形)の2つを使う**(`Config.enabledStages` の既定 `pre_pour,post_demold`。ユーザー決定 2026-10-14)。同じ現場・階・工区・ロットでも段階ごとに別の記録。`during_pour`(打設中・⑯)は保留(列挙値は残すが `enabledStages` に入れない)、`demold`・`cleanup` は未使用。段階による違いは §6.8 |
| P-11 | 元請サインの記録方法 | QA/責任者が担当者名+方法(paper/pdf/onsite)+任意で証跡写真を記録。元請の独自書式・電子サイン受入は未確定 |
| P-12 | QA欄の事前入力 | しない(職長の結果をコピーしない。形骸化防止)。QAが全項目を入力 |
| P-13 | 実測値 | 「設計値との差(mm)」の数値配列(最大10点)。`measure` は初期 `optional`(必須化はマスタ編集)。要件の「各面2箇所以上」は `minMeasures=2`+`measure=required` で運用化 |
| P-14 | 班スコープ | 職長は自班(`team` 一致)または自分の記録のみ詳細閲覧可。他班は `masked`(要約のみ)。`team` 空は本人のみ |
| P-15 | 責任者のQA兼務 | 責任者は `qa_sub` になれ、全現場でQA操作を最終代行できる(PIN必須。Eventsに残る)。職長との兼任は構造上不可 |
| P-16 | 名簿管理 | A案(スプレッドシート直接編集)。アプリで行うのは招待・ロック解除・端末解除・不在・QR・参加承認のみ。PC管理画面は後日 |
| P-17 | PDFの日本語描画と用紙 | `HtmlService`→PDF変換で試した結果、**用紙がレターサイズになる**ことが実機で確認された(版1.10.1)。Googleドキュメント(`DocumentApp`)でA4を明示して作る方式を `reportEngine=doc` として追加(§10.5。P-48)。HTML方式は残す |
| P-18 | 保管10年 | 自動削除なし。Events等の肥大化対策(年次アーカイブ)はv2 |
| P-19 | QAの担当過多(1人2〜3現場) | `adminValidateRoster` の警告のみ(`qaMaxSitesPerDay=3`) |
| P-20 | 写真の圧縮値 | 長辺1280px・JPEG品質0.72・サムネ320px・項目×sideあたり5枚まで・本体≤600KB |
| P-21 | PWAアイコン | 仮アイコン |
| P-22 | インドネシア語 | 暫定訳(prototypeの訳を流用+不足分は設計担当が補足)。ネイティブ確認が必要 |
| P-23 | 氏名一覧の公開 | **解消(版1.7)**: 他社の職長を招待するため `listLoginUsers` を廃止し、招待コード先入力(`lookupInvite`)に変更 |
| P-24 | 弱いPIN(0000等) | 拒否しない(4桁の制約上。ロックと端末登録制で緩和) |
| P-25 | 重大不適合の30分報告 | 判定時に責任者へ即時通知で充足。責任者の確認(ack)機能は作らない |
| P-26 | 項目マスタ | prototypeの16項目(active)+追加案15項目(i17〜i31)+元Excel突合で追加した18項目(i32〜i49)(計49行)。i17〜i49 の33項目は無効。**突合済**(`docs/item-reconciliation.md`)。i48・i49 は `stage=post_demold`(版1.9でも無効のまま)。**版1.9: 出来形8項目(i50〜i57)+打設前12項目(i58〜i69)を有効で追加(計69行、有効36)**。編集ルールは §2.6.2 |
| P-36 | 項目マスタの検証 | v1は責任者が編集後に目視確認(§2.6.2)。Items検証の管理者操作(`adminValidateItems` 等)は未定義。SPEC変更要望として §14.2 の10 |
| P-27 | QR参加 | QRはURL(`#/join?site&k&n`)。標準カメラで開く/アプリ内読み取り(`BarcodeDetector`対応端末)/URL貼り付けの3経路 |
| P-28 | 端末時計 | 写真スタンプ・`takenAt` は端末時刻(`skewMs`補正)。サーバーが範囲外を `clockSuspect` にする |
| P-29 | 放置された下書き | 自動削除しない |
| P-30 | 副職長 | 職長と同じ編集権限(同班)。権限差は設けない |
| P-31 | 再検査 | 是正は同一レコードの `round+1`。`approved` 後の再検査のみ `reinspectOf` 付き別レコード。元記録が `approved` でなければ `createRecord` は `STATE_CONFLICT` |
| P-32 | PDFの共有 | 「リンクを知っている全員が閲覧可」(`pdfShareMode`)。組織ポリシーで不可なら `private` に切替え、Driveから手動共有 |
| P-33 | 写真のDrive権限 | 非公開(オーナーのみ)。閲覧はアプリ経由のみ |
| P-34 | 端末上限と保持 | 1人3台まで(超過は最古を自動解除)。iOSはホーム画面追加を案内、トークン消失時は氏名+PINで再登録 |
| P-35 | `Idem`/`Events` の保持 | Idemは30日、Eventsは削除しない |
| P-37 | 写真送信の高速化パラメータ(版1.4。孤児ファイルの扱いは1.4.1で確定) | 単発モード上限 `photoSingleMaxChars=1,200,000`、並行数 `photoParallel=3`【確定】(実測: 1リクエストの固定処理が約6秒、サーバーは並行可、ロック直列化が律速)。Drive保存後にサーバー実行が強制終了(6分超など)した場合の孤児ファイルは救済しない(**自動掃除しない**=確定。ファイル名に `photoId` を含むので手動で特定できる)。**版1.5**: `photoChunkChars` は 90000 のまま(700000 等へは上げない。分割モードのCacheService 100KB制限のため。§2.14)。単発に寄せる効果は `photoSingleMaxChars`(≥ `photoMaxBytes` のbase64長)で実現済み |
| P-38 | 参照シートの読み取りキャッシュ(版1.4。1.5でTTL上限60秒固定を明記) | `Config`/`Items`/`Sites` のみ最大60秒。直接編集の反映は最大60秒遅れる(§2.15。**確定**)。権限判定に使うシートはキャッシュしない |
| P-39 | 性能の目標値と手動確認(版1.5) | ping 約1.5秒以内 / 写真1枚(約300KB)約10秒以内 / 写真10枚約40秒以内(3並列)。手動確認で自動テストにしない(§12.6)。1リクエスト内の読み込み最小化(§2.16)は設計担当の追加判断で、結果が素朴な実装と同じであることを条件に実装裁量。目標値は本番実測(1往復1.3〜2.8秒、写真1枚6秒/リクエスト)からの推定で、実機測定後に見直す可能性あり |
| P-40 | 図面(版1.6) | PDFファイルの直接取り込みは対象外(pdf.js追加が必要=CLAUDE.md §4の例外。ユーザー判断待ち)。元画像(印なし)は保存せず、やり直しは削除→取り込み直し。上限は記録×sideあたり5枚(固定)。項目番号は `seq` 昇順の添字(現行は全項目 both のため役割間で一致。将来分かれたらSPEC変更要望)。印の色は職長ピンク/管理者青(仮)。iPhoneのHEIC画像はブラウザが読めた場合のみ対応(未確認) |
| P-41 | 出来形検査の流れ(版1.9。REQUIREMENTS §14 の「Claudeの解釈。ユーザー未確認」を本書で確定した仮置き) | 最終状態の表示名は「出来形確認済」。`stopPour` は打設前のみ(出来形は `STATE_CONFLICT`)。時間ルール(§6.5)は出来形に適用しない・エスカレーション(§6.4)は適用する(現行実装のまま成り立つ側)。`pourPlannedAt` は出来形で使わない(指定されても保存しない)。出来形の取消手段は無い(誤承認は再検査 `reinspectOf`)。出来形の作成に打設前の承認を要件としない。メール件名の末尾に「出来形」。PDF名に段階名(打設前の新規PDFの名前も変わる)。詳細は §6.8、確認事項は §14.2 の13 |
| P-42 | 追加項目 i50〜i69 の決め方(版1.9) | `key` は全て FALSE(責任者が後で決める)。`textJa` に基準を文中で入れた(i50〜i57。PDFの項目列では切れる)。i59(設計かぶり厚以上)は片側基準のため `tol` なし・`measure=none`。i58/i2・i62/i6・i67/i14・i68/i16 は有効項目同士で意味が重なりうるが、ユーザー指示どおり別項目で追加。`seq` は itemId の数字・末尾追加・同じ `groupKey` を連続(§2.6.1a)。`textId` は暫定訳(P-22) |
| P-43 | 先出しの対象(版1.10。ユーザー承認 2026-10-17 の方針1・2の具体化) | §8.11.2 の分類表が正本。先出しは `saveDraft` `saveQaDraft` `addNote` `uploadPhotoChunk` `deletePhoto` `setLang` だけ。PIN・先着・状態の取り合い・参加・端末登録・ログイン・管理操作は待つ(進行中表示つき)。失敗時は巻き戻さず残す(`deletePhoto` だけ元に戻す)。分類の追加は表を先に直す |
| P-44 | 書き込み応答の `record`(版1.10。方針3) | §5.1a。`submitRecord` `submitVerdict` `recordPrimeSign` `stopPour` は RecordDetail に広げ、`addNote` `uploadPhotoChunk`(完了時)には追加。`saveDraft` `saveQaDraft` `releaseClaim` は広げない(高頻度・裏の操作で、読み込みを増やすと次の送信が遅れるため)。`Idem` には従来の形で保存し、再生時に最新のDetailへ差し替える。`uploadPhotoChunk` の `record` はロック解放後に作る。反映直後15秒は `getRecord` を省く(§8.11.8)。**応答サイズ・サーバー時間への影響は未測定**(実GASで PERF-05 を測って見直す) |
| P-45 | 読み取り側の待ち短縮(版1.10。**ユーザー未確認・実装保留**) | §8.11.9 の3案: ①起動時の `me`/`getBootstrap` を並列に ②キャッシュがあればホームを応答前に描く ③記録の画面をキャッシュで先に描き裏で `getRecord`。承認範囲(方針1〜6)に明記が無く、体感の改善は大きいと見込まれる。確認が取れるまで実装・テストとも対象外 |
| P-46 | keepWarm の効果と名前(版1.10。方針5) | 既定5分(`Config.keepWarmMinutes`)。**効果は未検証**(トリガーと Webアプリの実行環境が同じ保証がない)。設置前後の `rt` で比べ、効かなければ外す。本体の名前は末尾 `_` なしの `keepWarm`(2026-10-17 決定)。1日の実行時間上限(個人約90分/Workspace約6時間)に注意 |
| P-47 | `createRecord` は先出しにしない(版1.10。**ユーザー未確認**) | 同じ場所(現場・階・工区・ロット・段階)の記録の先着があり(`ALREADY_EXISTS`)、後続の写真・下書きが `createRecord` の成功に依存する(§8.4 の送信可否規則)ため、オンラインでは応答を待つ(『送信中…』)。圏外は従来どおり端末に仮の記録を作ってキューに積む。先出しにすると入力後に失敗して失われるリスクが出る |
| P-48 | 元請PDFの生成方式(版1.10.1。ユーザー了承 2026-10-17 の方針。**既定の変更は未決**) | 実機で HTML方式がレターサイズになる(`@page` が無視される)ため、Googleドキュメント方式(`reportEngine=doc`)を追加。**既定は `html` のまま**。ユーザーが §10.6 で見た目を確認して良ければ既定を `doc` に変える(別の版)。doc 方式の失敗時は自動で `html`。フォント `Noto Sans JP`、写真ページ 4枚/ページの収まり、所要時間は**実機未確認**(§10.5 の予備値・§12.7) |
| P-49 | 元請PDFの実測の見せ方の細部(版1.11.0。ユーザー依頼 2026-10-20 の方向+設計判断。**細部はユーザー未確認**) | ①許容超は 値の絶対値>許容(境界は許容内)・許容は0より大きい数のときだけ「あり」(§10.2d-1)②表示は「▲+値」(赤太字)と要約 `n=… 最小/最大/許容±…`、許容超が1件以上なら `▲許容超n件`(§10.2d-2〜3)③職長と管理者は別の系列で混ぜない(§10.2d-1)④実測が無い項目は空欄・許容が無い項目は値と最小/最大だけ(§10.2d-5)⑤出来形にも同じ規則(§10.2d-7)⑥項目表は全列折り返し・実測列を24→46mm・旧注記は廃止(§10.2b-A)⑦図面の凡例は項目ごとの見出し行+番号行・6列・系列Sは図面を書いた側(§10.2c-3)。 | 本書の値で実装する。ユーザーが見て直すなら設計担当が SPEC を直してから実装 |

### 14.2 ユーザー確認が必要な事項(最後にまとめて報告するもの)
1. **P-03 初回PIN設定の招待コード方式**で良いか(氏名選択だけでPINを設定できる案は、先に名前を選んだ他人に乗っ取られるため不採用)。
2. **P-04 手書きサイン廃止**(PIN再入力を電子サインとする)で良いか。
3. **P-05 提出・合格・元請サインのオンライン限定**で良いか(圏外では下書きと写真のみ)。
4. **P-07 / P-08**: 軽微な不適合も差し戻し(`fix`)にする点、異常時の打設停止で3者サインをやり直す点。
5. **P-11 元請サインの記録方法**と、元請がPDF/電子サイン/独自書式を受け入れるか。
6. **P-12 QA欄の事前入力なし**(QAの入力負担が増える)。
7. **P-15 責任者が代行者・最終代行を兼ねる**点。
8. **P-23 氏名一覧が未認証で見える**点、**P-32 PDFリンク共有**(組織のGoogle共有ポリシー)。
9. 現場名・管理者・職長・代行者の初期データ、インドネシア語の訳確認(P-22。i32〜i69 の訳を含む)。元資料xlsxとの項目突合(P-26)は済。
10. **SPEC変更要望(Items検証)**: 名簿の `adminValidateRoster` と同様の、責任者向け Items 整合チェック(例 `adminValidateItems`。`itemId`/`seq` の重複・`tol` と `measure` の整合・enum値・`groupKey` ごとのグループ名一致)が無い。v1は目視確認(§2.6.2)。追加するなら action 追加(43→44)・§4.1・§5.4.7・S12 相当の画面・C-ITEM テストが必要。要否の判断を求める。
11. **版1.4の確認(1.4.1で①②は確定済み。参考として残す)**: ①P-38 直接編集の反映が最大60秒遅れる運用(責任者への周知)で良いか ②P-37 実行強制終了時の孤児ファイルを自動掃除しない扱いで良いか ③参照キャッシュの対象に `Sites` を含めたが、`joinKey` を扱う `requestJoin`/`adminGetJoinInfo`/`adminRotateJoinKey` は `Sites` をキャッシュなしで読む(設計担当の追加判断)。
12. **版1.5の確認**: ①性能目標(§12.6 / P-39)の数値で良いか。実機で測って乖離すれば見直す ②`Config`/`Items`/`Sites` のキャッシュTTLは60秒のまま(依頼にあった「5分まで」は採らず、直接編集の反映遅れを最大60秒に留めた)。延ばしたい場合は §2.15-10 のとおり本書を先に直す ③`photoChunkChars` を 700000 にする案は、分割モードのCache 100KB制限のため採用しなかった(§2.14)。
13. **版1.9の確認**(ユーザー未確認の設計判断): ①出来形検査の流れ(REQUIREMENTS §14 の「Claudeの解釈」)を本書で確定した: 時間ルール(締切)は出来形に適用しない・エスカレーション30/60分は適用する・メール件名の末尾に「出来形」を付ける。②出来形の `approved`(出来形確認済)を取り消す操作が無い(`stopPour` が出来形で使えないため)。誤承認は再検査(`reinspectOf`)で対応する。取消が要るか。③出来形の作成条件に「同じスロットの打設前が `approved`」を入れていない(順序を縛らない)。入れるか。④打設前の追加12項目の `tol`/`measure`: i59(鉄筋かぶり「設計かぶり厚以上」)は下限だけの基準で `tol(±)` に表せないため `tol` なし・`measure=none`。i63「直下段差5mm以内」は `tol=5`(±扱い)。片側基準(以上/以下)を表す列が要るか(Items の列追加=SPEC変更要望)。⑤有効な既存項目と意味が重なる組: i58↔i2(墨)、i62↔i6(開口。許容が ±5mm と ±2mm で違う)、i67↔i14(打込み金物)、i68↔i16(型枠内の清掃)。ユーザー指示どおり別項目で追加したが、現場で重複して聞かれる。統合する(既存を無効化して新IDに寄せる)か。⑥出来形 i50〜i57 の `textJa` は「項目名(確認内容)/基準:…」と基準を文中に入れた。元請PDFの項目列は約62mmで切れるため、基準がPDFの表で見えないのを許容するか(基準を別列にする案は Items の列追加=SPEC変更要望)。⑦PDFファイル名に段階名を入れたことで、打設前の新規PDFの名前も変わる(出来形だけに限ることもできる)。⑧i50〜i57 の `note` に「管理項目表⑰〜㉓」と書いたが、i50〜i55 と⑰〜㉒ の1対1の対応は、ユーザー指定の並びからの推定(個別の番号は書かず範囲で書いた)。⑨インドネシア語は全て暫定訳(P-22)。
14. **版1.10の確認**(ユーザー未確認の設計判断。2026-10-17 の承認範囲は REQUIREMENTS §15 の1〜6):
   ①**読み取り側の待ち短縮(P-45。§8.11.9)を進めるか**。起動時の `me`/`getBootstrap` の並列化、キャッシュがあれば応答前にホームを描く、記録の画面をキャッシュで先に描く、の3つ。承認範囲に明記が無いため実装を止めている。体感の改善は大きいと見込まれる(いまは『開く』のたびに1往復待つ)。
   ②**`createRecord`(新しい記録の作成)を先出しにするか(P-47)**。いまはオンラインでは応答を待つ。先出しにすると『作成して入力へ』が即座に進むが、同じ場所の記録が先に作られていた場合、入力したあとで失敗する。
   ③**`stopPour`(打設停止)をオンラインでも待つ扱いにした**(確実に届いたことを見せるため。圏外はキューに積む従来の動作)。先出しにしてよいか。
   ④**keepWarm(§6.7a)**: 効果は実測でしか分からない(P-46)。GoogleアカウントがWorkspaceか個人かで実行時間の上限が違う。5分ごとで良いか。
   ⑤**画面の強さ**: 『保存済み ✓』を約2秒出して消す、`failed`/`blocked` の間は全画面共通の赤バナーを出し続ける、送信待ち/失敗のサムネは点線/赤枠にする、コメントの『破棄』は本文を入力欄に戻す、で良いか。
   ⑥**8秒で『通信に時間がかかっています』を出す**閾値(GASの起動待ちは数秒〜10秒超のことがある)。
   ⑦インドネシア語の新しい文言はすべて暫定訳(P-22)。
   ⑧**実測は未取得**(通信診断の結果待ち)。本版の効果の大きさは、S21 の `rt`/`srv` で見て優先順位を見直す。応答に `record` を載せるとサーバー側の読み込みは増えるため、`totalMs` の増分と、省けた往復(1.3〜2.8秒)を比べる(PERF-05)。
15. **版1.10.1の確認**(元請PDFのGoogleドキュメント方式。方針はユーザー了承済み。以下は設計判断): ①**GASの承認作業**(§10.5.9): `appsscript.json` を貼り替え → エディタで `checkReportEngine` を1回実行して承認 → 新バージョンでデプロイ。Workspace の管理者設定でドキュメントの権限が制限されていると承認できないことがある(その場合は `doc` が使えず HTML方式のまま)。②**実機確認**(§10.6・§12.7): A4・写真4枚/ページ・文字化けなし・所要時間。写真4枚が1ページに収まるかは理論値(§10.5.5)で、**収まらなければ予備の値(ブロック60mm・画像高55mm)に設計担当が直す**。③**ページ番号は出さない**(§10.2 の8から削除。従来の HTML方式も出していなかった)。フッタ(記録ID+ハッシュ)は doc 方式では全ページ。④**HTML方式との違いを許容**: 項目表が折り返す・1ページ目から溢れうる・写真の枠がわずかに違う(§10.5.7)。⑤一時ドキュメントはマイドライブ直下に作り、すぐゴミ箱へ入れる(ゴミ箱の保持は Google の既定)。検査記録の内容を含む文書が短時間だけ所有者のDriveに存在する。⑥フォールバックは画面に出さない。Drive ファイルの説明と Events の `detail` で分かる(§10.5.8)。⑦**既定を `doc` に変える**のはユーザーの指示後(P-48)。
16. **版1.11.0の確認**(元請PDFの実測の表現。方向はユーザー依頼どおり、細部は設計判断。P-49): ①**許容超の扱い**: 「許容超」は目安の印(▲)だけで、判定・NG行の背景・サマリ・提出可否には一切影響しない。管理者(QA)が許容超の値に `ok` を付けられるかは、版1.11.1 でユーザーが決定した(コメント必須つきで許可。§5.3.1・本節の17)。②**要約に出す項目**: n・最小・最大・許容(平均は出さない)。平均や「許容に対する余裕」を足すか。③**実測が無い項目は空欄**(「-」「未入力」を出さない)。出す方がよいか。④**許容なしの項目**(下限だけの基準など)は値と最小/最大だけ出し、▲は出さない。⑤**項目表の列幅**: 実測を24→46mm にし、項目を62→40mm に縮めた。項目文が3行になる項目が出る(行が伸びて項目表が長くなる)。⑥**旧注記**「管理者コメントの全文は写真ページ…」は、全文が項目表に出るので廃止。⑦**図面の凡例の長さ**: 項目ごとの見出し行が増えるので、凡例が次のページへ流れる(図面の画像は1ページ目のまま)。⑧**▲ の文字**: Googleドキュメント(Noto Sans JP 想定)とHTML変換のフォントに含まれる想定だが**実機未確認**(REAL-PDF-06)。□ になるなら `△` か `※` に変える。⑨**図面の系列**は図面を書いた側に統一(従来の「要素ごとに他方で補う」は廃止)。
17. **版1.11.1の確認**(管理者の許容超 `ok` とコメント必須。方針はユーザー決定 2026-10-20「管理者が許容を超えた実測値に『合』を付けられる。ただし許容を超えた場合は管理者のコメントを必須にする」。以下は設計担当の**解釈**で、念のための確認): ①**職長側は変えない**(職長は許容超に `ok` を付けて提出できないまま。ユーザーが指定したのは管理者側だけ)。職長にも許したいなら別の依頼。②**必須のコメントは項目ごとの管理者コメント(`qaNote`)**。総合コメントでは代用できない。③**総合判定が軽微・重大でも**、`ok` のまま残る許容超の項目にはコメントが要る。④**管理者の `qaValues` が許容超のときだけ**対象。管理者が値を入れず、職長の値だけが許容超の項目に `ok` を付けても、コメントは要らない(職長の値を見て管理者が合にするのは従来どおり)。この場合にもコメントを要るようにするか。⑤**内容の質は検査しない**(空白だけは不可。1文字でも通る)。⑥**新しいエラーコードは作らず**、`VALIDATION_FAILED` の `violations[].rule=QA_OVER_TOL_COMMENT_REQUIRED` にした。⑦**画面の語**は `OK`(現行の `result.ok`)のまま。⑧インドネシア語の新しい3文言は暫定訳(P-22)。⑨許容の定義は PDF(§10.2d-1)と同じ(0より大きい数のときだけ。境界は許容内)。

### 14.3 設計上の差分メモ(prototype・要件との整合)
- 判定値: prototype の `critical` は本書の `major`(CLAUDE.md §3の `ok/minor/major`)。項目結果は `ok/ng/na`(要件の合/NG/該当なし)。NGの重さ(`minor`/`major`)は QA が項目ごとに付ける。
- prototype の「デモ用ユーザー切替」「データ初期化」「手書きサイン」「`<input capture>`撮影」「Google Fonts」は新アプリに持ち込まない。
- prototype の「QAの結果を職長の結果で事前入力」は採用しない(P-12)。
- 役割名(表示): 職長/品質管理者/管理責任者(要件の「管理部門責任者」)。値は `foreman`/`qa`/`lead`。

---

## 付録A. 操作ごとの待ち時間の現状(版1.10.0 調査。`frontend/js` のコード読み取りによる。実測ではない)

目的: どの操作が、どこで通信の応答を待って画面を止めているかを一覧にし、先出し(§8.11)の対象と改善を決める根拠にする。「1往復」は GAS で1回 1.3〜2.8 秒(§1.4)、休止後の最初はさらに遅い。ファイル名・関数名は調査時点(build 28)のもの。実測は S21 通信診断(§1.9)で取る。

凡例(先出し): **可**=失敗しても困らず先出しできる(§8.11.2 の A)/ **不可**=待つ(B)/ **—**=書き込みでない。

| # | 操作 | 呼ぶ action | 現状: 応答待ちで止まっている箇所 | 先出し | 理由 | 版1.10 の扱い |
|---|---|---|---|---|---|---|
| 1 | アプリ起動(端末登録済み・オンライン) | `me` → `getBootstrap`(直列) | `app.js` の `boot()` が `me` の応答を待ち、`startSession()` が `getBootstrap(true)` の応答を待ってから最初の画面を描く。『読み込み中』のまま2往復分 | — | 書き込みでない | P-45(§8.11.9)の並列化・キャッシュ先出し(**要確認・保留**) |
| 2 | 招待コードの確認(S01『次へ』) | `lookupInvite` | `s01.js`: ボタンを無効にするだけで進行中の表示なし。1往復 | 不可 | 認証(コードの検証・総当たり対策) | B: 『送信中…』(§8.11.8) |
| 3 | 端末登録(S01『登録する』) | `registerDevice` → `getBootstrap` | `s01.js` が応答を待ち、成功後 `app.afterRegister` → `startSession()` が `getBootstrap(true)` を待ってから画面遷移。初回は合計3往復(lookup・register・bootstrap) | 不可 | PIN設定・招待コードの消費 | B: 『送信中…』。初回だけのため往復は減らさない |
| 4 | ホーム・現場・履歴の表示(S03/S04/S11/S09) | (キャッシュ) | 待たない(`records` キャッシュで描き、`listRecords` 等は裏) | — | — | 変更なし |
| 5 | 記録を開く(S06/S07/S08/S10) | `getRecord` | `data.js` の `loadDetail()`: オンラインなら **キャッシュに詳細があっても** `getRecord` の応答まで描かない(スケルトン)。1往復 | — | 書き込みでない | 書き込み直後は省く(15秒。§8.11.8)。一般化は P-45 |
| 6 | 新しい記録を作る(S05) | `createRecord` | `s05.js`: 端末に仮の詳細を保存したあと `runQueued()` が `flush()` の応答を待つ(1往復)。拒否なら仮記録を消してエラー表示 | 不可 | 同じ場所の記録の先着(`ALREADY_EXISTS`) | B(P-47)。応答の Detail で S06 を描く |
| 7 | 回答・実測・項目コメント(職長 S06) | `saveDraft` | 待たない(500msで端末に保存→outboxへ。`s06.js` の `doSave`)。**失敗時の画面の導線が無い**(S20 のみ) | 可(既に先出し) | 冪等・後勝ち | A: 失敗バナー・保存状態行を追加(§8.11.4・6) |
| 8 | QA入力・総合コメント(S10) | `saveQaDraft` | 待たない(`s10.js`)。失敗時の導線は同じく無い | 可(既に先出し) | 同上 | 同上 |
| 9 | 写真・図面を撮る/取り込む(S06/S10/M10) | `uploadPhotoChunk` | 『使う』で端末に保存→サムネ即表示(待たない)。送信は裏で並列(`photoParallel`)。**表示は『送信中』の1種類だけ**(待ち/送信中/失敗の区別なし)。送信完了のたびに `sync.js` の `finishPhoto()` が `getRecord` を1回呼び、終わるまで送信スロットを占有する(写真1枚あたり1往復の無駄) | 可(既に先出し) | `photoId` で冪等 | A: 4状態表示(§8.11.5)。応答の `record` で `getRecord` を廃止(§5.1a) |
| 10 | 証跡写真(元請サイン M5) | `uploadPhotoChunk`(prime) | `modals.js` の `primeSign`: 撮影後 `sync.flush()` の完了を待ってから証跡を確定(サムネも送信完了後に出る) | 可 | 元請サイン前に確実に載せたい | 撮影直後にサムネと状態を出す。『サイン記録』を押せるのは送信完了後(現行維持) |
| 11 | 写真の削除 | `deletePhoto` | 送信済みは `deletedPhotos` の印で即非表示→outbox(待たない)。**失敗時に元に戻らない** | 可 | 論理削除・冪等 | A: 失敗時は元に戻す(§8.11.4) |
| 12 | コメント追記(S08) | `addNote` | `s08.js`: `runQueued()` が `flush()` を待ち(1往復)、続けて `reload()`=`getRecord`(1往復)。**2往復あとに入力欄が空になる** | 可 | 追記専用・冪等 | A: 先出し(§8.11.3)+応答の `record` |
| 13 | 提出(S07 → M1) | `submitRecord`(PIN) | `modals.js` の `pinFlow`: 応答まで『OK』を無効にするだけ(進行中表示なし)。成功後 `mergeSummary`(要約のみ反映)→S08 が `getRecord` を待つ。**2往復分** | 不可 | PIN・提出は確定 | B: 進行中表示。応答の Detail で S08 を描く(`getRecord` 廃止) |
| 14 | 確認中にする(S10) | `claimReview` | `s10.js`: ボタン無効のみ。応答は既に RecordDetail なのに、`putDetail` のあと `reload()` が `getRecord` をもう一度待つ(**無駄な1往復**) | 不可 | 先着 | B: 再取得を省く |
| 15 | 引き継ぐ(S10) | `takeoverReview` | 同上 | 不可 | 先着 | 同上 |
| 16 | 確認を中止(S10) | `releaseClaim` | `flushSave()` のあと応答待ち→ホームへ | 不可 | 状態の取り合い | B: 進行中表示 |
| 17 | 合格(PIN)/軽微/重大(S10) | `submitVerdict` | まず `flushSave()` と `sync.flush()`(outbox全体)を待つ→M1(PIN)または確認ダイアログ→応答待ち→要約のみ反映→S08 が `getRecord` を待つ | 不可 | 判定・PIN・差し戻し | B: 応答の Detail(`getRecord` 廃止) |
| 18 | 元請サイン記録(M5 → M1) | `recordPrimeSign`(PIN) | 証跡写真があれば `flush()` を待つ→M1→応答待ち→`reload()`=`getRecord` | 不可 | PIN・確定 | B: 応答の Detail |
| 19 | 打設停止(M4) | `stopPour` | オンラインでは `runQueued()` が `flush()` を待ち、成功後 `reload()`=`getRecord`。圏外はキューに積む | 不可 | 状態の確定・安全(確実に届いたことを見せる) | B: 応答の Detail。圏外のキューは従来どおり |
| 20 | 参加申請・承認・却下・取消(S13/S09/S14) | `requestJoin` `decideJoin` `revokeMembership` | 応答待ち→一覧を `listJoinRequests` で取り直す | 不可 | 参加の確定・先着 | B: 進行中表示のみ |
| 21 | 元請提出用PDFの生成(M6) | `generateReport` | スピナーあり。最大120秒待つ | 不可 | 出力 | 変更なし |
| 22 | 管理(招待・ロック解除・停止・端末解除・不在・合言葉)(S16〜S18) | `admin*` | 応答待ち→一覧を取り直す | 不可 | 責任者の管理 | B: 進行中表示のみ |
| 23 | PIN変更・ログアウト(S19) | `changePin` `logoutDevice` | 応答待ち | 不可 | PIN・端末 | B |
| 24 | 言語の切替 | `setLang` | 待たない(裏で送信。失敗は無視) | 可 | 本人の表示設定 | 変更なし |
| 25 | 定期の更新(60秒ごと・前景化) | `me` `listRecords` `getBootstrap` `listJoinRequests` | 裏で実行(画面は止まらない) | — | — | 変更なし |

要点: ①**画面が止まる主因は『書き込みの応答を待つ → 続けて getRecord を待つ』の2往復**(#12・#13・#17・#18・#19)と、**『開くたびに getRecord を待つ』1往復**(#5)、**『起動時に me → getBootstrap を直列で待つ』2往復**(#1)。②既に先出しの操作(#7・#8・#9・#11)は待たないが、**失敗したときの画面の導線と、送信状態の見え方が足りない**。③写真は完了のたびの `getRecord` が送信スロットを占有している(#9)。④待つ操作はボタンが無効になるだけで『待っている』ことが見えない(#2・#3・#13〜#20)。

---

## 変更履歴

| 日付 | 版 | 変更内容 |
|---|---|---|
| 2026-10-07 | 1.0 | 初版(設計担当)。全14節。43 action・16シート・画面S00〜S20/M1〜M9・仮置きP-01〜P-35 |
| 2026-10-07 | 1.1 | レビュー反映(決定12件。既存の列名・action名・エラーコードは変更なし)。①§5.4.3 `submitVerdict`・§5.3.1 `COMMENT_REQUIRED`・§12.3 C-STATE-06: `comment` 未指定なら `saveQaDraft` 保存済み `qaComment` を使い、両方空で `minor`/`major` なら `COMMENT_REQUIRED`。②§6.6 メール件名の `{種別}` を実装どおりの6語(提出/30分経過/60分経過/重大な不適合/打設停止/参加申請)に固定。③§5.4.4 `deletePhoto`・§4.1・§12.3 C-PHOTO-05: 削除済み写真は `NOT_FOUND`。④§5.4.3 `createRecord`・§6.2・§14.1 P-31・§12.3 C-STATE-08: `reinspectOf` の元記録が `approved` でなければ `STATE_CONFLICT`。⑤§1.6 の6・7、§4.2、§12.3 C-ENV-04: 検査順序を 認証→`BAD_REQUEST`(契約外キー)→`FORBIDDEN_ROLE`→範囲(現場→班)→状態→個別条件に明記(§4.2 の項番は1〜6から1〜7に変更)。⑥§4.1・§5.1 masked形・§5.4.3 `stopPour`・§9.2 S04/S11/M4・§12.3 C-STATE-07: 他班(`masked`)の記録から `stopPour` だけ到達可(理由必須。内容はマスクのまま、masked形の `actions` は `["stopPour"]` になり得る)。⑦§5.2・§8.5・§9.2 S20・§12.4 U-OUTBOX-03: 30日超のoutbox行は自動送信も再送もせず「破棄」のみ(`lastError.code='EXPIRED'` は端末内の印)。⑧§8.2: ユーザー切替時は `records`/`bootstrap`/`photoCache` を必ず消去、未送信があれば「送信してから切替(オンライン時のみ)」「破棄して切替」の2択、破棄の消去は `registerDevice` 成功後。⑨§12.5 E-05 の文言修正、§12.1・§13.1 の Playwright は `playwright` 本体+`node:test`(`@playwright/test`・`playwright.config.js` を使わない)。⑩§8.10: シェルは precache のみ・`SW_VERSION` 更新で更新・同一バージョン内の実行時上書きなし(ナビゲーションのみ stale-while-revalidate)、`CLIENT_OUTDATED` 時の更新ボタンと更新後の `blocked('outdated')` 自動解除(§8.2 outbox に `blockReason` を明記、§8.4)。⑪§8.3: 送信ループの不変条件(送信直前に行を読み直す/送信中の統合は次回送信分/成功時は送った行だけ削除)、§12.4 U-OUTBOX-01。⑫§9.1・§12.5 E-07: S06/S07/S08/S10/S12/S13 は読み込み中・エラー時も現場名(不明なら `siteId` でなく「現場不明」=`app.site_unknown`)、タップ領域44px以上は全操作要素(バッジ・言語ボタン・リンク含む)。 |
| 2026-10-07 | 1.2 | 項目マスタの元Excel突合を反映(ユーザー決定8件。既存の列名・action名・エラーコードは変更なし)。①§2.6.1・§11.5・§12.3 C-ITEM-01・§12.4 U-SEED-01: SEED_ITEMS を i1〜i49 の49行に(active は i1〜i16 のみ。i32〜i49 の18項目を `active=FALSE` で追加、全項目 `audience=both`、i45=「型枠の締付け状況(固め)」`group=tie`、i48・i49=`stage=post_demold`で v1 は作成不可と明記。i4・i7・統合粒度は変更なし)。②§2.6.2 新設: 項目マスタ編集ルール(責任者のみ編集・新IDで追加+旧ID無効化・新規記録から反映・編集後検証・id訳はP-22)。③§7 冒頭: 1項目に複数枚登録可(`photoMaxPerItem`)を明記。④§14.1 P-26 更新(突合済)・P-36 追加、§14.2 の9更新・10 追加(Items検証のSPEC変更要望)。全数/抽出の列は追加しない。 |
| 2026-10-07 | 1.3 | 最初の責任者の作成手段を追加(既存の列名・action名・エラーコードは変更なし。action数は43のまま)。①§3.6.1 新設: GASエディタ専用関数 `setupFirstLead(name, loginId?)`(責任者のみ作成・二重作成禁止・招待コード6桁/72時間・Webのactionにしない)。②§0.5: 招待コード平文をログに出さない規則の唯一の例外として、`setupFirstLead` の `Logger` 表示を明記。 |
| 2026-10-08 | 1.4 | 写真送信の高速化(本番実測: 写真1枚≒35秒。固定処理時間とスクリプトロックによる直列化が原因)。既存の列名・action名・エラーコード・action数(43)は変更なし。①§5.4.4・§7.3・§5.2・§5.3・§1.4・§1.6: `uploadPhotoChunk` に **単発モード**(`total=1,index=0`。`data` 上限=新Config `photoSingleMaxChars`(既定1,200,000)。Cache不使用・1リクエストで検証〜Drive保存〜`Photos` 追記まで完了。`thumb` 同梱)を追加。分割(`total>1`、上限 `photoChunkChars`)は後方互換で残す。クライアントは base64長 ≤ `photoSingleMaxChars` なら必ず単発、超過または config に無い旧サーバーのときだけ分割。②§2.14・§5.4.2・§8.4・§8.3・§8.6: 新Config `photoParallel`(既定3、1〜6)。outbox は写真の行を最大 `photoParallel` 件同時送信し、順序保証を「送信可否規則」(非写真の行は直列、記録内の先行未完了の非写真の行→写真の行、写真の行→後続の非写真の行(`submitRecord` の前提 §8.6)、同一 `photoId` は1件、写真の行の失敗は他の写真の行を止めない)として明文化。③§1.4・§1.6の7・§5.4.4: `uploadPhotoChunk` のみロック範囲を縮小(認証・検証・デコード・ハッシュ・Drive保存はロック外、ロック内は再認証・状態/上限確認・`Photos` 追記・touch)。ロック内で失敗した場合と冪等成功時は先に作ったDriveファイルをゴミ箱へ。同一 `photoId` の並行再送はロック内で既存行を再確認して1行に。`PHOTO_INVALID` の意味を拡張(上限超過・`bytes` 不一致・既存 `photoId` と不整合)。④§2.15 新設・§1.4・§2・§2.6.2: `Config`/`Items`/`Sites` のみ60秒の読み取りキャッシュ可(権限判定に使うシートは不可・書込時に破棄・直接編集は最大60秒遅れ・100KB超は通常読み込みにフォールバック)。⑤§11.3・§11.4・§13.1: モックのロック範囲、`/__mock/driveLog`・`/__mock/interleave`・`/__mock/cacheStats` の追加、`/__mock/patch` の `keepCache`。⑥§12: C-PHOTO-01/03 更新、C-PHOTO-07〜12・C-CONC-04,05・C-CACHE-01,02・U-PHOTO-03・U-OUTBOX-04・E-13 を追加、§12.2 に対応行。⑦§14: P-37・P-38、§14.2 の11。 |
| 2026-10-08 | 1.4.1 | 1.4 への実装担当の指摘への決定(既存の列名・action名・エラーコード・action数は変更なし)。①§8.4-0・§2.14・§5.4.2: `photoParallel` の解釈を統一(四捨五入して1〜6に収める。null/空/非数/0以下は1)。②§7.3・§12.4 U-PHOTO-03・U-OUTBOX-04: フロントの契約関数名を確定(`photo.js` の `planUpload(b64,cfg,lockedTotal)`→`{single,total,chunks,tooLarge}`、`outbox.js` の `selectSendable(rows,{now,photoParallel})`)。`claimSendable`/`normParallel` 等はSPEC外。③§12.3: C-PHOTO-MULTI-01(1項目に複数枚)を追加。④§5.4.4 ロック内手順2・§5.3 `PHOTO_INVALID`・§12.3 C-PHOTO-09: 既存 `photoId` の冪等成功の条件に **`takenBy` が認証済みユーザーと同一** を追加(`recordId/itemId/side/sha256` の4項目と合わせて5条件。他ユーザーの `photoId` では成功も存在も示さず `PHOTO_INVALID`)。⑤§2.15: 書込み前に読んだ古い値がキャッシュに最大60秒残る競合は許容と明記。⑥§14 P-37(孤児ファイルは自動掃除しない)・P-38(直接編集は最大60秒遅れ)を確定、§14.2 の11を更新。 |
| 2026-10-08 | 1.4.2 | レビュー指摘への修正(既存の列名・action名・エラーコード・action数は変更なし)。①§8.4(e)・確定エラー表・§12.4 U-OUTBOX-04 ⑧: `stopPour` の行は他の行の確定失敗の波及で `blocked` にしない(`stopPour` 自身の確定失敗は従来どおり)。②§8.3・§9 S06/S10: 送信中(`sending`)の写真は削除ボタンを無効にし、送信完了後に `deletePhoto` を積む。`pending` の写真のローカル削除は即時可。③§2.14・§5.4.2・§8.4-0: `photoParallel` は「サーバーが `int` で返した値をクライアントが1〜6に収める(null/欠落/0以下は1)」に整理し、小数の四捨五入の記述を削除。U-OUTBOX-04 ①は整数入力のみ検査(丸めケースを削除)。④§2.14・§5.4.4: サーバー専用Config `photoThumbMaxChars`(既定100000。公開Configに入れない)を追加し、`thumb` が超えたら `PHOTO_INVALID`。⑤§2.15-8: `Sites.status` 閉鎖の直接編集後、最大60秒 `createRecord` が通りうることを許容と明記。 |
| 2026-10-08 | 1.4.3 | §11.4: `/__mock/patch` の許可シートに `Devices` を追加(`tokenHash` は指定不可)。`/__mock/interleave` の許可シートを `Records`/`Photos`/`Users`/`Assignments`/`Devices` と明記(ロック内の再認証 `DEVICE_REVOKED` のテスト用)。 |
| 2026-10-10 | 1.5.0 | 写真送信のさらなる高速化の確認と固定処理の削減(本番実測: 1往復≒1.3〜2.8秒、本文400KBでも約1.6秒、4件同時でも全体約3.2秒、写真300KBを90KB×5分割で約35秒=1回約6秒)。既存の列名・action名・エラーコード・action数(43)・Config キーは変更なし。**依頼のうち単発送信(`total=1`)、`uploadPhotoChunk` の最大3並列(`photoParallel`)、ロック範囲の縮小(Drive書込みはロック外)、`Config`/`Items`/`Sites` の60秒キャッシュは、版1.4〜1.4.3で既に記載済みのため再記述せず整合のみ確認**(本番が旧実装のまま分割送信になっている可能性が高い。実装の反映状況の確認が必要)。①§2.14: `photoChunkChars` は 90000 のまま(700000 へ上げない。分割モードは CacheService の1値100KB制限があるため。単発の上限 `photoSingleMaxChars=1200000` は `photoMaxBytes` のbase64長800,000以上で整合済みと明記)。②§2.16 新設・§1.4・§13.2: 1リクエスト内の同一シート再読込禁止(リクエスト内メモ)、ロック取得後は読み直し、端末認証などで必要な行/列だけ読む、可変データのリクエストまたぎキャッシュ禁止(結果は素朴な実装と同一)。③§2.15-10: キャッシュTTL上限を60秒固定と明記(5分は採らない)。④§12.6 新設・§12.2: 性能の受け入れ基準 PERF-01〜03(ping 約1.5秒、写真1枚約10秒、10枚約40秒・3並列)を手動確認項目として追加。⑤§7.3・§14 P-37/P-38/P-39・§14.2 の12: 整合。 |
| 2026-10-10 | 1.5.1 | ユーザー決定: 管理者(QA)側の確認では写真は不要(任意)。写真必須は職長の自己点検(`submitRecord`)のみ。既存の列名・action名・エラーコード・action数(43)は変更なし。①§5.3.1: `PHOTO_REQUIRED` を職長提出時のみ(`selfResult=ng`、または `key` の `ok`)に限定し、`submitVerdict` では出さない(`NOTE_REQUIRED`/`SEVERITY_REQUIRED` は従来どおり必須)。QA側の写真の撮影・添付・削除は任意で可能。②§9.1(写真ルール)・§9.2 S10・§12.2 要件対応表・§12.3 C-STATE-05/C-STATE-06・§12 E-03: 整合。 |
| 2026-10-10 | 1.5.2 | ユーザー決定: 元請提出用PDFの件名を「現場名 階 工区 打設箇所」にする。既存の列名・action名・エラーコード・action数(43)・API契約は変更なし。§10.2a 新設(`subject`=`{現場名} {階}[ {工区}] {lot}`、PDF名=`{subject}_v{version}_{YYYYMMDD-HHmm}.pdf`、`{recordId}_v...` は廃止)、§10.2(件名を表示)・§10.3(`<title>`・ファイル名)・§7.4(reports のパス)・§11.3(モックのPDF名)・§12.3 C-REP-01 に整合。 |
| 2026-10-10 | 1.5.3 | ユーザー決定: 元請提出PDFのレイアウト。項目表は折り返しなし・行高さ固定(職長コメント列のみ折り返し可、管理者コメントは固定高さで全文は写真ページ・電子記録)、写真は1ページ最大4枚の「左=写真/右=情報欄」ブロック(約62mm、4枚ごと改ページ)に変更(サムネ格子は廃止)。GAS変換のためtable+固定サイズのみで組む。拡大による粗さを注意書き(将来 `photoThumbEdge` を上げる余地)。API契約・列名・action数(43)は変更なし。§10.2・§10.2b新設・§10.3・§12.3 C-REP-01。 |
| 2026-10-10 | 1.6.0 | ユーザー決定: 図面(確認箇所の書き込み)機能。職長・管理者が図面画像(撮影/アルバム/PDFのスクリーンショット)を取り込み、確認した項目番号を任意の位置に書き込み(測定項目は `④-1`,`④-2` と枝番)、元請提出PDFの2ページ目に付ける。番号を囲む枠は描かない。PDFファイルの直接取り込みは対象外(P-40)。①§0.2 `photoKind` 追加。②§2.9 `Photos` に `kind`,`markers` 列(末尾追加)、§2.9a 既存シートへの列追加(`setupSheets` が不足列を補う)。③§5.1 `PhotoMeta` に `kind`,`markers`、`RecordDetail.drawings`(職長の `draft`/`submitted` では `side=qa` を含めない)。④§5.4.4 `uploadPhotoChunk` に `kind`,`markers`(検証・上限=記録×sideあたり5枚・検査写真の枚数と別勘定)。action数(43)・エラーコードは変更なし。⑤§7.1 図面だけファイル選択を常に許可、§7.7 新設(登録方法・M10・印の規則・画質・表示)。⑥§9.2 S06/S10 に図面欄、M10 追加、§9.4 `drawing.*`。⑦§10.2 項目5a・§10.2c 新設・§10.3。⑧§12.3 C-DRAW-01〜06、§12.5 E-14、§13.1、§14.1 P-40。⑨実装担当の指摘への確定: 画像の再圧縮順序(§7.7-3)、`markers` 非配列は `FIELD_INVALID`・`authorize` が先(§5.4.4)。 |
| 2026-10-10 | 1.6.1 | ユーザー決定: 図面の印の規則変更。①番号を選ぶと項目内容を表示。②枝番 `N-k` は測定点がある項目だけ(測定なしの項目は何個置いても `N`)。③測定点に番号を付け(項目内のチップに `①+2mm`)、図面では測定項目を選ぶと入力済みの測定点(`④-1`,`④-2`…)をチップで選んで配置(1測定点につき印1つ)。API契約・列名は変更なし(§7.7-2 のみ)。 |
| 2026-10-10 | 1.6.2 | ユーザー決定: 測定点を追加できる項目でも、測定点を入力していない(追加せずにOKした)場合は、図面に枝番なしの `N`(例 `④`)を何個でも置ける。測定点が入力されている項目は従来どおり `N-k`。§7.7-2。 |
| 2026-10-10 | 1.6.3 | 不具合対応: 短時間に複数回更新すると、precache がHTTPキャッシュ(GitHub Pages は約10分)から古いファイルを取り込み、新旧のJSが混在して画面でエラーになる。§8.10: precache は `cache:'reload'` で取得する。API契約は変更なし。 |
| 2026-10-10 | 1.6.4 | 不具合対応: iPhone で図面(写真)保存時に IndexedDB が Blob 保存に失敗しエラーになる。§8.2: Blob は ArrayBuffer+type で保存し読み出し時に Blob へ戻す。API契約は変更なし。 |
| 2026-10-10 | 1.6.5 | ユーザー要望: 元請PDFの図面ページの凡例に測定値を載せる。§10.2c-3: 凡例を label 単位の行にし、`実測値` 列(`④-1 … -1mm`)を追加。API契約・列名は変更なし(backend/Report.gs のみ)。 |
| 2026-10-12 | 1.7.0 | ユーザー決定(他社の職長も招待するため): ①端末登録を **招待コード先入力**に変更(`listLoginUsers` 廃止→公開action `lookupInvite` 追加。`registerDevice` は `userId` を受け取らず `inviteCode`+`pin`。追加端末(氏名+PINのみ)は廃止し、責任者発行の `pinReset` コードに統一。総当たり対策=サーバー全体の失敗回数制限 `RATE_LIMITED`、Config `inviteFailMax`/`inviteFailWindowMin`、発行時にコード重複を避ける)。②Users に **`company`(会社名)** を追加(末尾列)。`adminListUsers`・`Membership.userCompany`・PDF(基本情報・職長/品質管理者サイン欄)に表示。③責任者の追加端末用に GASエディタ専用 `issueLeadCode`(§3.6.1)。action数は43のまま(1削除・1追加)。P-23 解消 |
| 2026-10-12 | 1.8.0 | ユーザー要望: 職長が端末登録のときに会社名も入力できるようにし、検査記録に反映する。①`registerDevice` に任意 `company`(≤40文字)を追加。`purpose=first` では会社名を必須(名簿に会社名があれば省略可)。入力値は `Users.company` に保存。②`Me.company` を追加。③Records に **`ownerCompany`**(作成時の会社名の写し。末尾列)を追加し、`RecordSummary/Detail.ownerCompany` に出す。PDFの職長の会社名・職長サイン欄は `ownerCompany`(空なら現在の `company`)。④S01 の確認画面に会社名欄。action数は43のまま。 |
| 2026-10-12 | 1.8.1 | ユーザー要望(反応が遅い): 遅さの原因を数字で見るための計測を追加。①§1.5/§1.9: 全応答の `meta.timing`(処理時間の内訳)②`js/perf.js` と画面 S21 通信診断(設定から開く)③契約テスト C-ENV-02 に `meta.timing` の検査を追加、E-21 を追加。API・シート・既存の画面の動作は変更なし(action数43のまま)。 |
| 2026-10-12 | 1.8.2 | 責任者のスマホにテスト現場の記録が残った不具合の修正。§8.9: 全件取得の結果に無い記録を端末から消す(未送信・下書きのある記録は残す)。API・シート・エラーコードは変更なし。 |
| 2026-10-14 | 1.9.0 | ユーザー決定(2026-10-14): 出来形検査(`stage=post_demold`)を打設前検査と並べて使う。既存の列名・action名・エラーコード・action数(43)は変更なし(追加のみ)。①§0.2・§2.7・§2.14・§6.8新設・§14 P-10/P-41: 使う段階は `pre_pour` と `post_demold`(`Config.enabledStages` 既定 `pre_pour,post_demold`)。`during_pour`(⑯)は保留。同じ現場・階・工区・ロットでも段階ごとに別の記録(一意制約は元から段階を含む)。出来形は打設前と同じ流れ・状態遷移・PIN・差し戻し・コメント分離・元請サインを再利用し、違いは ⓐ`approved` の表示名=「出来形確認済」(§9.4 の `@post_demold` 上書きキー) ⓑ`stopPour`・打設に関する語を出さない(`stopPour` は `pre_pour` のみ。出来形は `STATE_CONFLICT`、`actions` に出ない)。時間ルール(§6.5)は出来形に適用しない(既存の「他段階は null」のまま)、エスカレーション(§6.4)は適用(変更なし)。`pourPlannedAt` は出来形で使わない(指定されても保存しない)。②§2.6.1・§2.6.1a・§2.6.1b・§11.5・§14 P-26/P-42: Items を i1〜i69 の69行に(出来形 i50〜i57 と打設前 i58〜i69 の20項目を `active=TRUE`・`key=FALSE` で追加。有効36項目=打設前28+出来形8。i1〜i49 は変更なし)。新グループ `demold_check`・`ctl_*`、`seq` の方針(itemId番号・末尾追加・同じ `groupKey` を連続)。`setupSheets()` は既存シートへ追加しないため、GASエディタ専用の `addMissingSeedItems()` を新設(actionではない)。③§5.4.3 `createRecord`: `stage` は `enabledStages` に無い値・有効項目0件で `STAGE_NOT_ENABLED`、`pourPlannedAt` は打設前のみ保存。④§9.2・§9.4: S03/S04/S05/S09 に段階の表示と段階の選択、S10/S11 に段階名、`stage.post_demold`=出来形。⑤§10・§7.4: PDFファイル名に段階名(`{subject}_{段階名}_v...`。打設前の新規PDFの名前も変わる)、出来形は打設予定日時の行なし・ステータス「出来形確認済」。⑥§6.6: 出来形のメール件名の末尾に ` 出来形`。⑦§12: C-STAGE-01〜06・C-ITEM-02,03・E-15 を追加、C-ITEM-01/C-STATE-07,08/U-SEED-01/U-I18N-01/U-VALID-01/E-02/E-11 を更新。⑧§14.2 の13(版1.9の確認事項)。 |
| 2026-10-17 | 1.10.0 | ユーザー決定(2026-10-17。REQUIREMENTS §15): 「ログイン、写真登録、コメント登録など、操作の後に画面が切り替わるまでの待ち時間をなるべく無くしたい」。原因は操作のたびの スマホ→GAS→スプレッドシート の往復と、応答を待ってから画面を更新していること(実測は未取得=通信診断の結果待ち)。**既存の列名・action名・エラーコード・action数(43)は変更なし(追加のみ)**。①§8.11 新設・§8.1・§9.2a・§9.1・§9.4: **先出し(楽観的UI)の分類**(§8.11.2。全43 actionをA先出し/B待つ/C参照に分類。先出しは `saveDraft` `saveQaDraft` `addNote` `uploadPhotoChunk` `deletePhoto` `setLang` だけ。PIN・先着・状態・参加・端末登録・ログインは待つ)、先出しの失敗時の巻き戻し・再試行・破棄の導線(§8.11.4)、待つ操作の『送信中…』+8秒の『時間がかかっています』(§8.11.8)。②§5.1a 新設・§5.2・§5.4・§1.6: **書き込み応答の `record`**(`submitRecord` `submitVerdict` `recordPrimeSign` `stopPour` を RecordDetail に広げ、`addNote` と `uploadPhotoChunk`(完了時)に `record` を追加。`saveDraft` 系は広げない)で `getRecord` の再取得をなくす。`Records.version` による採否規則、`Idem` は従来の形で保存し再生時に最新のDetailへ差し替え、反映直後15秒は `getRecord` を省く。サムネ・写真本体は含めない。③§8.11.5〜7・§8.4・§9.2a: **写真ごとの状態表示**(送信待ち/送信中/失敗/完了)、記録の保存状態行、ヘッダの未送信バッジの強化(n≥1黄・要対応赤)と全画面の失敗バナー。提出は写真の送信完了まで押せない(§8.6・FE-03 の趣旨を維持)。純関数 `KW.outbox.photoState`・`saveStateOf`。④§6.7a 新設・§2.14・§13.1: **GASの起動待ち対策**=GASエディタ専用の `installKeepWarmTrigger()`/`removeKeepWarmTrigger()`/トリガー本体 `keepWarm()`(末尾 `_` の関数はトリガーの実行先にできない恐れがあるため、名前は `_` なし。エディタの実行候補に出ても、読み取りのみで誰が実行しても無害。actionではない。`ACTIONS` に登録せず43のまま)、Config `keepWarmMinutes`(既定5。5/10/15/30)。書き込みなし。インストール運用は `docs/OPERATIONS.md`。⑤§11.3・§12・§13.2: mock の `record`、C-RESP-01〜05・C-KEEP-01,02・U-OUTBOX-05,06・U-CLASS-01・U-RESP-01・E-23〜E-29・PERF-04,05 を追加、C-IDEM-01 を読み替え。⑥付録A 新設: 操作ごとの待ち時間の現状(frontend のコード調査)。⑦§14 P-43〜P-47(P-45 読み取り側の待ち短縮と P-47 `createRecord` の扱いは**ユーザー未確認**)、§14.2 の14。**対象外**: 認証・認可に関わる参照(Users/Devices/Assignments 等)のサーバー側キャッシュ(§2.15 の決定のまま)、GAS以外のサーバーへの移行。 |
| 2026-10-17 | 1.10.1 | ユーザー了承(2026-10-17): 元請PDFがレターサイズになる(HTML方式は `@page{size:A4}` を無視)ため、用紙を明示できるGoogleドキュメント方式を追加。既存の列名・action名・エラーコード・action数(43)・API契約は変更なし(Config キー追加のみ)。①§10.5 新設(`reportEngine=doc`: A4縦 595.28×841.89pt・余白34.02pt、`Noto Sans JP`、表の列幅、写真の枠に収めた挿入、4枚/ページの改ページ、全ページのフッタ、ページ番号なし、HTML方式との許容差、失敗時の `html` へのフォールバックと記録(Events `detail` のキー追加・Drive ファイルの説明)、80秒の時間上限、`documents` スコープと承認手順、エディタ専用 `checkReportEngine`)②§10.6 実機確認の手順 ③§10.2 の8: ページ番号を仕様から外す ④§10.3: 方式の選択 ⑤§1.3: oauthScopes に `documents` ⑥§2.14: `reportEngine`(既定 `html`。サーバー専用)⑦§5.4.5・§11.3・§11.4(`/__mock/docShim`)・§12.2・§12.3(C-REP-02〜06)・§12.7(REAL-PDF-01〜05)・§13.1/13.2・§14(P-17更新・P-48・14.2の15)。 |
| 2026-10-19 | 1.10.2 | 実PDF(doc 方式)で表が右余白へ約2mmはみ出したため、実装(`backend/ReportDoc.gs`)に合わせて SPEC を修正。API契約・列名・action・エラーコード・Config は変更なし。①§10.5.2: 表の実効幅 `TABLE_W_MM=184mm`(名目186mmの184/186倍。罫線・セル余白が列幅の外に付くため)を追加し、本文幅の記述を「名目」に改めた ②§10.5.3〜10.5.5: 列幅は名目値を明記し実効=×184/186。写真枠 80×58→約79.14×57.38mm(224.33×162.64pt)、図面枠 186×170→184×約168.17mm(521.57×476.71pt)、写真ブロックの列幅 83/103→232.75/288.83pt、図面画像のセル余白0 ③§10.5.3: 全 h2 見出しに `setKeepWithNext(true)`(「写真」見出し前の改ページは従来どおり) ④§10.5.7 の大きさの差の表記 ⑤§12.3 C-REP-03 ③⑤ の期待値(列幅合計521.57pt・写真ブロック232.75/288.83pt・画像上限・keepWithNext)と §11.4 `/__mock/docShim` の `lastDoc.paragraphs`(keepWithNext の観測)を追加。 |
| 2026-10-20 | 1.11.0 | ユーザー依頼(2026-10-20): 検査記録PDFの実測の表現を、読み手が分かりやすいように改善。既存の列名・action名・エラーコード・action数(43)・Config・ハッシュは変更なし(PDFの表示のみ)。①**§10.2d 新設**(実測の表示規則): 有効値・許容(>0のとき)・許容超(値の絶対値>許容。境界は許容内)・値の書式(符号つき、許容超は `▲`)・要約 `n=… 最小/最大/許容±…` と `▲許容超n件`・職長/管理者は別系列・出す/出さない表・見た目と HTML の `class="over"`・出来形にも同じ規則・注記(許容ありの実測があるときだけ)。許容超は**目安**で判定ではない(CLAUDE.md §3。結果・背景・サマリに影響しない)。純関数 `measureView_` を新設し `measureText_` を廃止。②**§10.2b-A 項目表**: 全列折り返し可・行は最低6mm・列幅 8/62/14/18/24/30/30 → **8/40/14/18/46/30/30**・実測列の書式を §10.2d に・旧注記(管理者コメントの全文は…)を廃止。③**§10.2b-B 写真ブロック**の実測を §10.2d の書式(`実測(職長):`/`実測(管理者):`+要約)に。④**§10.2c-3 図面の凡例**: 印1個=1行・5列から、**項目ごとのグループ(見出し行=項目名+要約、番号行=値と許容超の `▲`)・6列 24/76/28/24/17/17**(`N` だけの項目は1行)に。系列は図面を書いた側(要素ごとの補完は廃止)。⑤**§10.5**(doc方式): 1.の共有関数、項目表・凡例・写真の同内容、注記、セル結合なし、HTML方式との差(項目表の折り返し)を解消。⑥**§11.4** `/__mock/docShim` の `lastDoc` に `tables[i].cellTexts`・`coloredTexts`・`boldTexts` を追加。⑦**§12**: C-REP-01 ②・C-REP-03 ⑤を改訂、U-MEAS-01・C-REP-07・C-REP-08・C-DRAW-07 を追加、§12.2 に対応行、REAL-PDF-06 と §10.6 の確認項目。⑧§13.2 の版1.11.0 の責務、§14 P-49、§14.2 の16。REQUIREMENTS.md §17 を追加。 |
| 2026-10-20 | 1.11.1 | ユーザー決定(2026-10-20): 「管理者(QA)が許容を超えた実測値に『合』を付けられるようにする。ただし許容を超えた場合は管理者のコメントを必須にする」。**職長側は変更しない**(許容超の `ok` は `MEASURE_OVER_TOL_OK` のまま)。既存の列名・action名・エラーコード・action数(43)・Config・シートは変更なし(violations の rule を1つ追加)。①**§5.3.1**: `MEASURE_OVER_TOL_OK` を「職長提出のみ」に限定し、新 rule `QA_OVER_TOL_COMMENT_REQUIRED`(管理者の `qaResult=ok` で `qaValues` に許容超 `|値|>tol`(tol>0)があるのに `qaNote` が空)を追加。QA判定の検査ルールの「測定・許容超過は職長側と同じルール」を撤回し、4条件・見る列(`qaValues`/`qaNote` のみ。職長の値・コメントは見ない)・コメントの出どころ(`saveQaDraft` 保存済み)・`ng`/`na` は従来どおり・総合判定に依らない・`saveQaDraft` では検査しない・通ったあとの Notes を明記。新しいエラーコードは作らず `VALIDATION_FAILED` + `violations` にした。②**§5.4.3** `submitVerdict`/`saveQaDraft` に注記。③**§9.2b 新設・§9.2 S10 の行**: 許容超の OK でコメント必須を送信前に示す画面の挙動(ヒント・赤枠・`placeholder`・判定ボタン3つの無効化と理由・OK ボタンは押せる・職長側は変更なし)。④**§9.4**: 新キー `rule.QA_OVER_TOL_COMMENT_REQUIRED`・`scr.S10.over_tol_hint`・`scr.S10.over_tol_note_ph`(ja/id。id は暫定)。⑤**§10.2d-9**: 「管理者の `ok` に許容超を許すか未確認」を確定に書き換え(許容超の `ok` 行は赤背景にしない=従来どおり、▲は出る、管理者コメント列に理由が出る)。**矛盾の解消**: §10.2d-9 と §12.3 C-REP-07 の「管理者側に検査なし」、§14.2 の16 ①、§5.3.1 の「QAも職長と同じ許容超ルール」が実装(管理者側も拒否)と食い違っていたのを、本決定で揃えた。⑥**§12**: C-VERD-01〜03・E-30 を追加、U-VALID-01 に QA 側のケース、C-REP-07 のデータ(許容超の管理者値に `qaNote` を入れる)、§12.2 に対応行。⑦§13.2 の版1.11.1 の責務、§14.2 の17(解釈の確認)。REQUIREMENTS.md §18 を追加し §17 の該当を確定に更新。 |
