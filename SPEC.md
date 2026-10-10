# SPEC.md — 型枠検査記録アプリ(RCCREATE)仕様書

- 版: 1.5.1 / 作成日: 2026-10-07(最終改訂 2026-10-10) / 作成: 設計担当
- 正本の位置づけ: 本書は **API契約・シート定義・画面一覧・権限表** の正本(CLAUDE.md §1)。実装と食い違ったら実装より先に本書を直し、末尾「変更履歴」に1行書く。
- 読者: バックエンド担当(`backend/`)、フロント担当(`frontend/`)、モック担当(`mock/`)、テスト担当(`tests/`)。**本書だけを見て並行実装して食い違わない**ことを目標に、値・列名・コードは全て確定値で書く。
- 決められなかった点は「§14 仮置き事項」に `P-xx` で列挙し、本文中でも `(仮置き P-xx)` と明記する。ユーザー確認が必要なものは §14.2 にまとめた。
- 本書の「必ず」「してはならない」は規範。「推奨」は実装者裁量。

---

## 0. 共通規約(全担当が従う)

### 0.1 確定している変更不可の決定(CLAUDE.md §2 の再掲。ここから逸脱しない)
参加はQR→主担当QA承認 / 個人スマホ・氏名+4桁PIN・端末登録 / PIN再入力は QA「合格」「打設可」と職長「提出」のみ / 保存先はSheets+Drive / 元請はアカウントなしPDFのみ / ja・id切替 / 兼任なし / 職長コメントと管理者コメントは別フィールド・上書き禁止 / 提出後は職長編集不可(差し戻し時のみ可) / 重大不適合=打設不可・3者サインが揃うまで打設可にならない / 役割はサーバー名簿で決まる / 合否は人が決める。

### 0.2 列挙値(これ以外を作らない)

| 名前 | 値 |
|---|---|
| `role`(ユーザー役割。1ユーザー1役割) | `foreman`(職長) / `qa`(品質管理者) / `lead`(管理部門責任者) |
| `userStatus` | `invited`(PIN未設定) / `active` / `locked` / `disabled`(退職・停止) |
| `assignRole`(担当表の役) | `qa_main` / `qa_sub` / `foreman` / `subforeman` |
| `membershipStatus` | `pending` / `approved` / `rejected` / `revoked` |
| `deviceStatus` | `active` / `revoked` |
| `stage`(検査段階) | `pre_pour`(打設前) / `during_pour`(打設中巡回) / `demold`(脱型承認) / `post_demold`(脱型後出来形) / `cleanup`(解体後片付け) |
| `status`(記録ステータス。CLAUDE.md §3 の値のみ) | `none` / `draft` / `submitted` / `fix` / `qa_ok` / `approved`。**`none` は「記録行が未作成」の仮想値で、Records.status には保存しない** |
| `result`(項目の結果) | `ok` / `ng` / `na` |
| `severity`(NG項目の重さ) | `minor` / `major` |
| `verdict`(品質管理者の判定) | `ok` / `minor` / `major` |
| `side`(写真・入力の主体) | `self`(職長) / `qa`(品質管理者) / `prime`(元請サイン証跡) |
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
oauthScopes: spreadsheets, drive, script.scriptapp, script.send_mail, script.external_request(不要なら除外)
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
| 認証されないGET/POSTが誰でも打てる | トークン検査をdispatcher冒頭で行う。公開actionは `ping`/`listLoginUsers`/`registerDevice` のみ。 |
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

**GET**: `GET {API_URL}?action=ping` のみ。`{ "ok": true, "data": { "apiVersion": 1, "schemaVersion": "1", "serverTime": "..." }, "meta": {...} }`。それ以外のGETは `BAD_REQUEST`。

### 1.6 リクエスト処理順(dispatcher。バックエンドとモックで同一)

1. JSON解析・封筒検査(`v`/`action`/型)。失敗 → `BAD_REQUEST`。
2. `CLIENT_OUTDATED` 検査(`ping`/`me`以外)。
3. 公開actionなら §3 の処理へ(端末認証なし)。
4. 端末認証: `deviceToken` から `deviceId` を取り出し、`Devices` 行を引き `tokenHash` と定数時間比較。無い/不一致 → `UNAUTHENTICATED`。`status=revoked` → `DEVICE_REVOKED`。
5. ユーザー状態: `disabled` → `USER_DISABLED`、`locked` で `me`/`logoutDevice` 以外 → `USER_LOCKED`。
6. **参照系**: `params` の契約外キー検査(§5.4。表に無いキー → `BAD_REQUEST`)→ `authorize()`(§4.2)→実行→応答(ロックなし)。
7. **更新系**: `params` の契約外キー検査(`BAD_REQUEST`。ロック取得前)→ スクリプトロック取得 → (a) 冪等キー検索(あれば保存済み応答を `replayed:true` で返す) → (b) `authorize()` 再評価(ロック内で最新状態)+入力検証 → (c) PIN必須なら検証(§3.4。権限・状態・入力検証に通った後) → (d) 本処理 → (e) Events追記 → (f) 冪等キー保存 → ロック解放。
   - **例外 `uploadPhotoChunk`(版1.4。冪等キー対象外のため上の(a)(f)は無い。処理全体をロックで覆わない)**: ①契約外キー検査(`BAD_REQUEST`) → ②【ロック外】手順4・5と `authorize()`(一次判定。早期失敗のため。確定判定は⑤) → ③【ロック外】入力検証・(分割モードの中間チャンクはここでCache保存して応答し終了)・組立・デコード・JPEG/SHA-256検査・Drive保存 → ④スクリプトロック取得(取れなければ `LOCK_TIMEOUT`) → ⑤【ロック内】手順4・5 と `authorize()` を **最新のシートで再評価**(失敗ならそのエラー)→ 既存 `Photos` 行の確認 → 項目あたり上限確認 → `Photos` 追記・記録の `touch` → ロック解放 → ⑥③で作ったDriveファイルは、⑤で `Photos` 行にならなかった全経路(エラー・例外・`LOCK_TIMEOUT`・既存行ありの冪等成功)でゴミ箱へ。詳細は §5.4.4。
8. 例外は `INTERNAL`(再試行可)。スタックトレース・内部パスを応答に含めない。

---

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
| seq | int | 必 | 表示順(昇順) |
| stage | enum(stage) | 必 | この項目を使う段階 |
| audience | enum(both,foreman,qa) | 必 | `both`=職長・QA両方が入力、`foreman`=職長のみ、`qa`=QAのみ |
| groupKey | str | 必 | グループ識別子(例 `prep`) |
| groupJa / groupId | str | 必 | グループ名(ja / id)。同一 `groupKey` の行は同じ値を入れる |
| textJa / textId | str | 必 | 項目文(ja / id)。idは暫定訳(P-22) |
| key | bool | 必 | 重点項目(`ok` でも写真必須) |
| tol | num | | 許容(±mm)。空=許容なし |
| measure | enum(none,optional,required) | 必 | 実測値入力。`tol` がある項目は `optional` 以上 |
| minMeasures | int | 必 | `measure=required` のとき必要な最少測定点数(寸法は2。要件§5「各面2箇所以上」) |
| unit | str | | 既定 `mm` |
| active | bool | 必 | `FALSE` は新規記録に使わない(既存記録は影響なし) |
| note | str | | 運用メモ |

**記録作成時にスナップショット**: `createRecord` 時点の `active=TRUE` かつ `stage` 一致の項目を、`audience` に関わらず全て `RecordItems` に行として固定し(`snapshot` JSON)、以後マスタが変わっても既存記録の項目は変わらない。

#### 2.6.1 初期値(`SEED_ITEMS`。i1〜i49の49行 = 16項目 `active=TRUE` + 追加案33項目 `active=FALSE`)

共通: `stage=pre_pour` / `audience=both` / `unit=mm` / `minMeasures`: `tol`のある項目は `2`、他は `0` / `measure`: `tol`のある項目は `optional`、他は `none`(プロトタイプと同じ挙動。必須化は運用でシート編集)。**例外: i48・i49 のみ `stage=post_demold`**(下記)。i1〜i16 は変更しない。グループ名: `prep`=準備・墨 / Persiapan dan marking、`dim`=寸法・精度 / Dimensi dan akurasi、`tie`=締付け・支保工 / Pengencangan dan penyangga、`embed`=埋込み・設備 / Benda tertanam dan MEP、`safe`=安全・清掃 / Keselamatan dan kebersihan。

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

共通は上記と同じ(`audience=both`・`unit=mm`・`tol` のある項目は `measure=optional`/`minMeasures=2`、他は `none`/`0`)。**元Excelの職長用/管理者用の別は付けない(全項目 `both`)**。全数/抽出の列は作らない(寸法の代表実測は `measure`/`minMeasures` と運用で表す)。`textId` は暫定訳(P-22。ネイティブ確認)。`note` は i48・i49 のみ(下記)で他は空。

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

- 正確な全列値(JSON)は `docs/new-items.json`(16列: itemId〜note)。`tests/fixtures/seed-items.json`・`Seed.gs`・`mock/seed.js` は i1〜i31 の後ろに i32〜i49 をこの値で追加する(計49行)。
- **i45**: 元Excel管理者用⑧「固め状況」は「型枠の締付け」の意味(ユーザー決定)。打設時の締固め(バイブレータ)ではない。`group=tie`。
- **i48・i49(出来形)**: 打設後の確認のため `stage=post_demold`(脱型後の検査)。`Config.enabledStages` が v1 では `pre_pour` のみ(P-10)なので `createRecord` で作成できず、**責任者が `active=TRUE` にしても打設前の画面・記録(スナップショット・`getBootstrap.items`)には出ない**。脱型後検査を有効にする段階(v2)で初めて使われる。
- 統合の粒度は変えない(i6=開口の建入れ・高さ、i16=清掃、i17=かぶり厚さは原紙の複数行を1項目にまとめたまま。i4・i7 の文言も変更しない)。

#### 2.6.2 項目マスタ編集ルール(運用。P-26・P-36)

Items の変更は **責任者だけ** がスプレッドシートで行う(§2 の「直接編集してよいシート」の運用ルール)。

1. **編集権限**: スプレッドシートの共有設定で責任者のみ(編集者)とする。**QA・職長にはスプレッドシート自体を共有しない**(アプリ経由のみ。サーバー側の権限判定とは別の運用上の防御)。
2. **IDの意味は変えない**: 既存 `itemId` の `textJa/textId/tol/key/measure/stage/audience` の意味が変わる変更はせず、**新しい `itemId`(末尾の次番号)で行を追加し、旧IDを `active=FALSE` にする**(§2.6 の `itemId` 説明どおり)。誤字訂正など意味が変わらない修正のみ同じ行を直してよい。`active` の切替・`seq` の変更は可。
3. **反映範囲**: 変更は **以後に新規作成される記録から** 反映される。既存記録は作成時のスナップショット(§2.6)で不変(`active` を下げても既存記録は影響なし)。
4. **編集後の検証**: 名簿の `adminValidateRoster`(§5.4.7)と同様に責任者が管理者操作で行える Items 検証が望ましい。**現行SPECには Items の整合チェックが無い**ため、v1 は編集後に責任者が目視確認する(`itemId` の重複なし・`seq` の重複なし・`tol` があれば `measure` が `optional` 以上・`stage` が §0.2 の値・`groupKey` ごとに `groupJa/groupId` 同一・`audience`/`measure` が §0.2 の値)。自動化は **SPEC変更要望として §14.2 の10に記載**(P-36)。
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
| stage | enum(stage) | 必 | v1は `pre_pour` のみ作成可(`Config.enabledStages`。P-10) |
| status | enum(draft,submitted,fix,qa_ok,approved) | 必 | `none`は保存しない |
| round | int | 必 | 提出ラウンド。作成時1、`fix→submitted` の再提出で+1 |
| reinspectOf | id | | 再検査の元記録(`approved`だった記録)。通常は空 |
| ownerUserId | id | 必 | 作成した職長 |
| team | str | | 作成時の作成者の班(Assignments.team)。空可 |
| pourPlannedAt | dt | | 打設予定日時(提出時必須。P-06) |
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
| stopped | bool | 必 | 打設停止中か(既定FALSE。§6.3) |
| stoppedBy / stoppedAt / stopReason | id/dt/str | | |
| escNotified | int | 必 | 通知済みエスカレーション段階 0/1/2(提出ごとに0へ戻す) |
| createdAt / updatedAt | dt | 必 | |
| version | int | 必 | 更新ごとに+1(UIの更新検知用。楽観ロックには使わない) |

一意制約: 同一 `(siteId,floor,zone,lot,stage)` に対し `reinspectOf` が空の記録は1件まで。2件目の作成は `ALREADY_EXISTS`。`approved` 済みスロットを再検査するときだけ `reinspectOf=その記録` で追加作成でき、その記録は元記録が `approved` であること(P-31)。

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
| photoMaxEdge | `1280` | 本体の長辺px上限 |
| photoJpegQuality | `0.72` | |
| photoThumbEdge | `320` | サムネ長辺px |
| photoThumbMaxChars | `100000` | サムネ `thumb`(base64)の最大文字数。超えると `PHOTO_INVALID`(§5.4.4)。**サーバー専用で公開Config(`getBootstrap.config`)には入れない**。サムネ目安(≤30KB、§7.3)の約3倍の余裕 |
| photoMaxPerItem | `5` | 項目×side あたりの写真上限 |
| photoChunkChars | `90000` | **分割モード(`total>1`)** の1チャンクあたりbase64文字数上限(4の倍数)。単発モードには適用しない。**版1.5で決定: 既定を 700000 等へ上げない(90000のまま)**。分割モードは途中チャンクを CacheService に保存し、CacheService は1値100KB(=102,400バイト)までのため(§1.4)、90000を超えるとCache保存が失敗して分割モードが壊れる。「実質常に1回で送る」は `photoSingleMaxChars` で実現する(下の行。`photoMaxBytes` のbase64長 800,000 文字 ≤ 1,200,000 なので初期設定は常に単発になり、分割は `photoMaxBytes` を大きく上げた場合と旧クライアント・旧サーバー互換の経路だけで使う)。責任者が値を変更する場合は 100KB 未満(推奨は90000以下)に保つこと |
| photoMaxBytes | `600000` | 本体の最大バイト数 |
| photoSingleMaxChars | `1200000` | **単発モード(`total=1`)** の `data`(base64全体)の最大文字数(4の倍数)。`photoMaxBytes`(600000)のbase64(800000文字)を十分に含む値。責任者が `photoMaxBytes` を上げるときは `ceil(photoMaxBytes/3)*4` 以上に合わせる(下回っても動作する。クライアントが分割にフォールバックするだけ)。**版1.5で整合を確認**: 既定の `photoMaxBytes=600000` → base64長は `ceil(600000/3)*4=800000` 文字 ≤ `photoSingleMaxChars=1200000`(余裕150%)。リクエスト本文は `data`+`thumb`(≤`photoThumbMaxChars` 100,000)+メタで約0.9MB以下。本文サイズは遅さの原因ではない(実測: 400KB本文でも約1.6秒)ので上限は変えない |
| photoParallel | `3` | 1端末から同時に送ってよい写真アップロード(`uploadPhotoChunk` の行)の最大数。サーバーは `Config` の `int` 変換(`parseInt`)で整数として返す(空・非数のセルは既定値3が返る)。クライアントはその値を §8.4-0 の規則で1〜6に収める。§8.4 |
| enabledStages | `pre_pour` | カンマ区切り。作成可能な段階 |
| pollIntervalSec | `60` | クライアントのポーリング間隔 |
| driveRootFolderId | (setupで作成) | |
| pdfShareMode | `anyone_with_link` | または `private`(P-32) |
| mailEnabled | `TRUE` | |
| appBaseUrl | (要設定) | メール内リンク用 |
| retentionYears | `10` | 保管年数(表示・運用用。自動削除はしない P-18) |

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
- 本人確認は「氏名(=userId)選択 + 4桁PIN」で **端末登録**し、以後は端末に保存した `deviceToken` のみで認証する(PIN不要)。PINは「職長の提出」「QA/責任者の合格(`verdict=ok`)」「元請サイン記録(打設可)」でのみ再入力する(§3.4)。
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
| `recordPrimeSign` | 常に必須(=打設可の確定) |

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

### 3.6 端末登録フロー(`registerDevice`)
UI: S01。`listLoginUsers` で氏名一覧(`userId,name,status`)を取得 → 氏名を選ぶ → PIN4桁を入力。`status=invited` の氏名では「招待コード(6桁)」欄も表示。「PINを忘れた/再設定」リンクで招待コード欄を出す。

| ケース | 入力 | サーバー処理 |
|---|---|---|
| A 初回(`invited`) | `userId`, `pin`(新規に決める), `inviteCode` | 招待コード検証 → `pinSalt/pinHash` 設定 → `status=active` → 端末登録 |
| B 追加端末(機種変更等。`active`) | `userId`, `pin`(既存) | PIN検証(誤りカウント対象)→ 端末登録 |
| C PIN再設定(`active`) | `userId`, `pin`(新PIN), `inviteCode`(purpose=pinReset) | 招待コード検証 → PIN差し替え → 端末登録。他端末は有効のまま |

- `status=invited` で `inviteCode` なし → `INVITE_REQUIRED`。
- 招待コード: 責任者が `adminIssueInvite` で発行(§5.4)。有効期限 `Config.inviteTtlHours`(72時間)。ユーザーごとに未使用の最新1件のみ有効(新規発行で旧コードは即失効)。誤りは §3.4 のカウンタに加算(`INVITE_INVALID` + `remaining`)。期限切れ → `INVITE_EXPIRED`。使用後 `usedAt` を記録。
- 端末登録時 `Users.lastLoginAt` 更新、Events `device_registered`。`maxDevicesPerUser` 超過時は §2.5 の自動整理。
- `registerDevice` は冪等キーを使わない(応答にトークン平文が入るためIdemに保存しない)。応答喪失時の再実行は端末が1つ増えるだけで害はない(古い行は自動整理)。
- ユーザーの新規追加は **Usersシートに行を追加**(`userId,name,role,status=invited,lang,qaQualified,failedCount=0,createdAt,updatedAt`)→ 責任者がアプリで招待コードを発行 → 本人へ口頭/対面で伝える(P-03)。
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
| listLoginUsers | 公 | 公 | 公 | status が disabled 以外のユーザーの `userId,name,nameKana,status` のみ(役割は返さない。P-23) |
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
| stopPour | ○ | ○ | ○ | **その現場に有効な担当(職長は班を問わず)** または責任者。status∈{submitted,qa_ok,approved}。異常時は誰でも止められる。**他班(`masked`)の記録からも実行できる**(理由必須。内容は引き続きマスクのまま。応答・`actions` も masked 形) |
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
- 職長は **他現場**の記録を一覧・詳細・写真・PDFで見られない。他班の記録は `masked`(詳細・写真・コメントは見えない)。**唯一の例外として、同じ現場に有効な担当がある職長は、`masked` の記録に対して `stopPour` だけ実行できる**(`actions` に `stopPour` が入る。それ以外の action は不可)。
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
6. 状態条件: §6 の遷移表の「from」に合わない → 編集系は `RECORD_LOCKED`、遷移系は `STATE_CONFLICT`(`error.data={status,round}`)。`params.round` を取るactionは現在の `round` と不一致でも `STATE_CONFLICT`。
7. 個別条件: claim済み→`ALREADY_CLAIMED` / claim者でない→`NOT_CLAIMER`(未claimなら `NOT_CLAIMED`)/ 引き継ぎ不可→`TAKEOVER_NOT_ALLOWED` / `decideJoin` の不在条件 / `deletePhoto` の条件(他人の写真→`FORBIDDEN_TEAM`、別ラウンド・編集不可の状態→`RECORD_LOCKED`)。

補助関数(同ファイルに置き、モックも同名で実装):
- `isAbsent(userId, date)`: 有効な(`cancelledAt`空)Absencesに `dateFrom<=date<=dateTo` がある。
- `effectiveQaMain(siteId)`: `qa_main` が不在なら有効な `qa_sub`(不在でない者)を「代行中」として扱う(表示と `decideJoin` の許可に使う)。
- `canEditRecord(actor, record)`: 職長で `FORBIDDEN_TEAM` でなく status∈{draft,fix}。
- `allowedActions(actor, record) -> string[]`: 記録に対して `authorize` が ok になる action 名の配列。対象は `saveDraft, submitRecord, claimReview, releaseClaim, takeoverReview, saveQaDraft, submitVerdict, recordPrimeSign, stopPour, addNote, uploadPhotoChunk, generateReport`。**`RecordSummary.actions` と `RecordDetail.actions` にそのまま返す**。PIN・入力検証など入力に依存する条件は含めない(権限と状態だけ)。`masked` の記録の `actions` は `stopPour` だけ(§5.1)。
- `escLevel(record, now)`(§6.4)、`computeTiming(record)`(§6.5)。

---

## 5. API契約

### 5.1 共通オブジェクト(レスポンスの型。フィールド追加・名前変更は SPEC を先に直す)

`null` は「値なし」。配列は空でも必ずキーを返す。日時は `dt`、日付は `date`(§0.4)。

**UserBrief** `{ "userId": "u_sato", "name": "佐藤" }`

**Me** `{ "userId", "name", "role": "foreman|qa|lead", "status": "active|locked", "lang": "ja|id", "email": "str|null" }`

**Site**(`getBootstrap.sites[]`)
```json
{ "siteId":"s_a", "name":"A現場(仮)", "status":"active", "floors":["1F","2F","3F"], "zones":[],
  "primeContractor":"○○建設(仮)",
  "qa": { "main": {"userId":"u_sato","name":"佐藤"}, "mainAbsent": false, "subs":[{"userId":"u_suzuki","name":"鈴木"}] },
  "myAssignRole": "foreman|subforeman|qa_main|qa_sub|null", "myTeam": "田中班" }
```
(責任者は全現場。`myAssignRole`/`myTeam` は該当なしなら `null`。`qa.main` は有効な `qa_main` が無ければ `null`。)

**Item**(`getBootstrap.items[]`。`active=TRUE` かつ `Config.enabledStages` の段階のみ)
`{ "itemId","seq","stage","audience","groupKey","groupJa","groupId","textJa","textId","key":false,"tol":5|null,"measure":"none|optional|required","minMeasures":0,"unit":"mm" }`

**RecordSummary**
```json
{ "recordId":"r_8k2m4n6p8q0s2u4w", "siteId":"s_a", "floor":"2F", "zone":"", "lot":"L1", "stage":"pre_pour",
  "status":"submitted", "round":1, "reinspectOf":null,
  "ownerUserId":"u_tanaka", "ownerName":"田中", "team":"田中班",
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
- **masked 形**(職長が他班の記録を一覧したとき): `{recordId,siteId,floor,zone,lot,stage,status,team,updatedAt,version,"masked":true,"actions":[]}` のみ。それ以外のキーは含めない。**`actions` は `stopPour` が許される(同現場の有効な担当、かつ `status∈{submitted,qa_ok,approved}`)ときだけ `["stopPour"]`、それ以外は `[]`**(他のaction名は入れない)。`stopPour` の応答の `record` も、呼出者が他班の職長ならこの masked 形で返す。

**ItemEntry**(`RecordDetail.items[]`)
```json
{ "itemId":"i9",
  "def": { "seq":9,"stage":"pre_pour","audience":"both","groupKey":"tie","groupJa":"締付け・支保工","groupId":"Pengencangan dan penyangga","textJa":"…","textId":"…","key":true,"tol":null,"measure":"none","minMeasures":0,"unit":"mm" },
  "self": { "result":"ng", "severity":null, "values":[], "note":"控えが1箇所不足", "updatedAt":"…", "photos":[ <PhotoMeta> ] },
  "qa":   { "result":null, "severity":null, "values":[], "note":"", "updatedAt":null, "photos":[] } }
```
`result`/`severity` 未入力は `null`、`note` 未入力は `""`、`values` 未入力は `[]`。**職長に対しては、status が `draft`/`submitted` のとき `qa` を `null` で返す**(QAの下書きを見せない)。`fix`/`qa_ok`/`approved` では `qa` を返す(是正指示の確認用)。

**PhotoMeta** `{ "photoId","itemId":"i9|null","side":"self|qa|prime","round":1,"takenBy":"u_tanaka","takenByName":"田中","takenAt":"…","width":1280,"height":960,"bytes":214532,"stampText":"A現場(仮) 2F ・ 田中 ・ 2026-10-07 09:58" }`(削除済みは含めない)

**Note** `{ "noteId","itemId":"str|null","kind":"foreman|manager","authorUserId","authorName","authorRole","round","text","source":"submit|verdict|addNote","createdAt" }`

**EventView** `{ "eventId","at","kind","actorUserId","actorName","fromStatus":"str|null","toStatus":"str|null","round":1,"detail":{} }`(`detail` は Events.detail から **`items` キーを除いたもの**)

**RecordDetail** = RecordSummary(masked=false)のキー全て +
```json
{ "items":[ <ItemEntry> ], "primePhotos":[ <PhotoMeta> ], "notes":[ <Note> ], "events":[ <EventView> ],
  "qaComment":"", "stopInfo": { "by":"u_tanaka","byName":"田中","at":"…","reason":"…" },
  "signatures": {
    "foreman": { "userId","name","at" },
    "qa":      { "userId","name","at","verdict":"ok" },
    "prime":   { "recordedBy","recordedByName","signerName","method","at" } },
  "timing": { "selfDeadlineAt":"…|null","qaOpenAt":"…|null","qaDeadlineAt":"…|null","selfLate":false,"qaLate":false } }
```
- `notes` と `events` は時刻昇順。`events` は直近100件。`stopInfo`/`signatures.*` は無ければ `null`。`signatures.foreman`=直近の提出、`signatures.qa`=`qaVerdict=ok` のときのみ、`signatures.prime`=元請サイン記録済みのときのみ。`qaComment` は職長にも `fix`/`qa_ok`/`approved` では返す(`draft`/`submitted` では `""`)。
- 項目は `def.seq` 昇順。`audience=qa` の項目は職長には返さない(`self` 入力不要)。

**Membership** `{ "membershipId","siteId","siteName","userId","userName","status","requestedAt","decidedBy":"str|null","decidedByName":"str|null","decidedAt":"dt|null","assignRole":"str|null","team":"str|null","note":"str|null","canDecide":false }`

**Assignment** `{ "assignId","siteId","siteName","userId","userName","assignRole","team","validFrom","validTo":"date|null","active":true,"effective":true,"absentToday":false }`

**Absence** `{ "absenceId","userId","userName","dateFrom","dateTo","reason","registeredBy","registeredByName","createdAt" }`

**Report** `{ "reportId","recordId","version":1,"recordStatus":"qa_ok|approved","url":"https://drive.google.com/file/d/…/view","sha256":"…","generatedBy","generatedByName","generatedAt" }`

**ItemPatch**(`saveDraft`/`saveQaDraft` の `items[]`): `{ "itemId":"i4", "result":"ok|ng|na|null", "severity":"minor|major|null", "values":[2,-1], "note":"…" }`。`itemId` 以外は任意で、**指定したキーだけ更新**(`null` で消去、`values:[]` で消去)。未知のキー・未知の `itemId`・範囲外(`values` は有限数・最大10件、`note` ≤1000文字)は `VALIDATION_FAILED`(`FIELD_INVALID`)。職長は `audience=qa` の項目、QAは `audience=foreman` の項目を書けない。

### 5.2 冪等キー(clientId)の扱い

- **★** 付きaction(§5.4)は `clientId` 必須(無い→`BAD_REQUEST`)。クライアントは「ユーザーの1操作」につき1つ生成し、**同じ操作の再送は必ず同じ `clientId`**。内容を変えて送り直すときは新しい `clientId`。
- サーバー(ロック内): `Idem` に `clientId` があれば:
  - `userId` と `action` と `paramsHash` が一致 → 保存済み `responseJson` を **`meta.replayed=true`** で返す(本処理・Eventsを再実行しない)。
  - 一致しない → `IDEMPOTENCY_CONFLICT`。
  - `paramsHash = hex(SHA-256(canonicalJSON({action, params})))`。canonicalJSON=キーを再帰的に辞書順に並べた最小JSON。`pin`・`clientId` は含めない。
- **成功応答のみ保存**。失敗(エラー)は保存しない(修正後に同じ `clientId` で再送できるようにするため。ただし同じ `clientId` を内容違いで使えない=上記)。
- `RecordDetail` を返す `createRecord` / `claimReview` / `takeoverReview` は `responseJson` を空で保存し、再生時は現在状態から再構築する: `createRecord`=記録が存在し `ownerUserId` が同一なら成功(現在の詳細)/ `claimReview`・`takeoverReview`=現在 `claimedBy` が同一ユーザーかつ `round` 一致なら成功、そうでなければ `ALREADY_CLAIMED` か `STATE_CONFLICT`。
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
| INVITE_INVALID | 招待コード誤り/該当なし | × | `{remaining}` |
| INVITE_EXPIRED | 招待コード期限切れ | × | |
| FORBIDDEN_ROLE | 役割が許されない | × | |
| FORBIDDEN_SITE | その現場に担当がない | × | |
| FORBIDDEN_TEAM | 他班の記録/他人の写真 | × | |
| NOT_FOUND | 対象IDなし(権限がなく存在を隠す場合も含む) | × | |
| VALIDATION_FAILED | 入力不備 | × | `{violations:[{rule,itemId?,path?}]}`(§5.3.1) |
| STATE_CONFLICT | 遷移できない状態/`round`不一致 | × | `{status,round}` |
| RECORD_LOCKED | 編集不可の状態(提出後等) | × | `{status}` |
| ALREADY_EXISTS | 同一スロットの記録が既にある | × | `{recordId,mine}` |
| ALREADY_CLAIMED | 先に確認中にされた | × | `{claimedBy,claimedByName,claimedAt}` |
| NOT_CLAIMER | claim者ではない | × | `{claimedBy,claimedByName}` |
| NOT_CLAIMED | 未claimで操作しようとした | × | |
| TAKEOVER_NOT_ALLOWED | 引き継ぎ条件未達 | × | `{availableAt}` |
| STAGE_NOT_ENABLED | 未有効の段階 | × | |
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
| MEASURE_OVER_TOL_OK | `|値|の最大 > tol` なのに `ok` | `itemId` |
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
- `tol` があり `selfValues` に値があり `max(abs)>tol` で `selfResult=ok` → `MEASURE_OVER_TOL_OK`(`ng` にするか値を直す)。
- `stage=pre_pour` は `pourPlannedAt` 必須(`POUR_PLAN_REQUIRED`。P-06)。

検査ルール(QA判定 `submitVerdict`):
- 対象=`audience∈{both,qa}` の全項目に `qaResult` が必要(`ANSWER_MISSING`)。**QA欄の事前入力はしない**(P-12)。
- `qaResult=ng` → `qaNote`非空(`NOTE_REQUIRED`)・`qaSeverity` 必須(`SEVERITY_REQUIRED`)。**QA側は写真を必須にしない**(版1.5.1。ユーザー決定: 管理者の確認では写真は任意。`PHOTO_REQUIRED` を出さない。`qaResult=ng` でも `key` 項目の `qaResult=ok` でも、side=qa の写真が0枚で通る)。QA側でも写真の撮影・添付・削除(`uploadPhotoChunk` の `side=qa`、`deletePhoto`)は従来どおり可能(任意)。測定・許容超過は職長側と同じルール(`qaValues` で判定)。
- 写真必須は職長の自己点検(`submitRecord`)のみ。
- 判定の整合: `ok` ⇒ QA入力に `ng` なし(`VERDICT_OK_WITH_NG`)/ `minor` ⇒ `ng` ≥1 かつ `severity=major` なし / `major` ⇒ `severity=major` の `ng` ≥1 / `minor`・`major` ⇒ 総合コメント必須(`comment` があればそれ、未指定なら `saveQaDraft` 保存済みの `qaComment`。両方空なら `COMMENT_REQUIRED`)。
- 合否は人が決める: サーバーは上記の **整合性検査のみ**行い、判定を自動決定しない。UIの「提案」表示は画面側の補助(§9)。

### 5.4 action 一覧(リクエストの `params` とレスポンスの `data`)

**契約外のキー禁止**: `params` に表に無いキーがあれば `BAD_REQUEST`(役割・ユーザーIDなどを偽装して送る余地を作らない)。`params` の必須キー欠落・型違反は `VALIDATION_FAILED`(`FIELD_INVALID`、`path` にキー名)。

表の記号: **★**=`clientId`必須 / **PIN**=封筒`pin`必須 / **Q**=オフラインキュー対象(§8)。エラーは「共通エラー」(UNAUTHENTICATED, DEVICE_REVOKED, USER_LOCKED, USER_DISABLED, FORBIDDEN_ROLE, BAD_REQUEST, CLIENT_OUTDATED, LOCK_TIMEOUT, INTERNAL)に加えて個別に列挙したもの。

#### 5.4.1 公開

**ping**(GET/POST) params `{}` → `{ "apiVersion":1, "schemaVersion":"1", "serverTime":"…" }`

**listLoginUsers** params `{}` → `{ "users":[ {"userId","name","nameKana":"","status":"invited|active|locked"} ] }`(`disabled` は除外、`nameKana`→`name`順)

**registerDevice** params `{ "userId", "pin", "inviteCode"?, "deviceLabel"?, "platform"?, "appVersion"? }` → `{ "deviceId", "deviceToken", "user": <Me> }`
エラー: `VALIDATION_FAILED`(pin形式)/ `NOT_FOUND`(userIdなし)/ `USER_DISABLED` / `USER_LOCKED` / `INVITE_REQUIRED` / `INVITE_INVALID` / `INVITE_EXPIRED` / `PIN_INVALID` / `USER_LOCKED`。
例:
```json
// request
{"v":1,"action":"registerDevice","appVersion":"1.0.0","params":{"userId":"u_tanaka","pin":"1111","deviceLabel":"Pixel 7","platform":"android"}}
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

#### 5.4.3 記録

**listRecords** `{ "siteId"?, "statuses"?:["submitted","fix"], "since"?:"dt", "limit"?:100, "cursor"?:"str" }` → `{ "records":[<RecordSummary|masked>], "nextCursor":"str|null", "serverTime" }`
- 並び: `updatedAt` 降順、同値は `recordId` 昇順。`limit` 1〜200(既定100)。`cursor` は不透明文字列(実装は件数オフセット可)。`since`=`updatedAt > since`(厳密に大きい)。クライアントは前回応答の `serverTime` の5秒前を `since` に使い、重複はIDで排除する。
- `siteId` を指定して見えない現場なら `FORBIDDEN_SITE`。未指定は見える現場全部。
- エラー: `FORBIDDEN_SITE` / `VALIDATION_FAILED`。

**getRecord** `{ "recordId" }` → `{ "record":<RecordDetail> }`。エラー: `NOT_FOUND` / `FORBIDDEN_SITE` / `FORBIDDEN_TEAM`(masked対象の詳細要求)。

**createRecord** ★ Q `{ "recordId", "siteId", "floor", "zone"?:"", "lot", "stage":"pre_pour", "pourPlannedAt"?:"dt", "reinspectOf"?:"r_…" }` → `{ "record":<RecordDetail> }`(status=draft, round=1, `ownerUserId`=自分, `team`=自分の当該現場の班。項目行を作成時点の `active` 項目で生成)
エラー: `FORBIDDEN_SITE` / `SITE_CLOSED` / `STAGE_NOT_ENABLED` / `VALIDATION_FAILED`(`FIELD_INVALID`:floor/zone/lot/recordId形式) / `ALREADY_EXISTS`(`{recordId,mine}`。同一 `recordId` を同一ユーザーが再送した場合は冪等成功として扱う)/ **`STATE_CONFLICT`(`reinspectOf` を指定したが元記録の `status` が `approved` でない。`error.data={status,round}` は元記録の値。P-31)**。Events `record_created`。
例:
```json
{"v":1,"action":"createRecord","clientId":"c_0a1b2c3d4e5f6a7b8c9d","deviceToken":"…","appVersion":"1.0.0",
 "params":{"recordId":"r_8k2m4n6p8q0s2u4w","siteId":"s_a","floor":"2F","zone":"","lot":"L1","stage":"pre_pour","pourPlannedAt":"2026-10-08T09:00:00+09:00"}}
```

**saveDraft** ★ Q `{ "recordId", "header"?:{ "lot"?, "zone"?, "pourPlannedAt"?:"dt|null" }, "items"?:[<ItemPatch>] }` → `{ "record":<RecordSummary> }`
- status∈{draft,fix}・編集権限(§4.1)。**部分更新**(指定した項目・キーのみ)。`siteId/floor/stage/recordId` は変更不可(指定→`BAD_REQUEST`)。完全性は検査しない(形式のみ)。
- 同一項目への書込は後勝ち(項目×列単位)。`selfUpdatedAt` を更新、`Records.updatedAt`/`version` を+1。Eventsには記録しない。
- エラー: `NOT_FOUND` / `FORBIDDEN_SITE` / `FORBIDDEN_TEAM` / `RECORD_LOCKED`(`{status}`)/ `VALIDATION_FAILED`。
例(items は変更分だけ):
```json
"params":{"recordId":"r_8k2m4n6p8q0s2u4w","items":[
  {"itemId":"i4","result":"ok","values":[2,-1]},
  {"itemId":"i9","result":"ng","note":"控えが1箇所不足"}]}
```

**submitRecord** ★ PIN `{ "recordId", "round" }` → `{ "record":<RecordSummary>, "warnings":["SELF_LATE"?] }`
- status∈{draft,fix} かつ `round` 一致 → §5.3.1 の提出検査を **全て満たす**こと。成功: draft→submitted(初回)/ fix→submitted(再提出。`round+1`、`qa*` 列とQA判定列(`qaVerdict,qaVerdictBy,qaVerdictAt,qaComment,major`)・`claim*`・`stopped*`・`prime*` を空にし `escNotified=0`)。`submittedBy/At`=自分/今。初回は `firstSubmittedAt`。
- 職長の項目コメント(空でないもの)を Notes に `kind=foreman, source=submit` で追記(提出ごと)。Events `submitted`/`resubmitted`(detail に項目結果。`late`)。
- `warnings`: `SELF_LATE`(§6.5 の職長期限超過。提出は拒否しない)。
- エラー: `NOT_FOUND`/`FORBIDDEN_SITE`/`FORBIDDEN_TEAM`/`STATE_CONFLICT`/`VALIDATION_FAILED`(violations全列挙)/`PIN_REQUIRED`/`PIN_INVALID`/`USER_LOCKED`。
- クライアントは提出前に、その記録のoutboxが空(全て送信済み)であることを確認する(§8.6)。

**claimReview** ★ `{ "recordId", "round" }` → `{ "record":<RecordDetail> }`(「確認中」にする。status は `submitted` のまま。`claimedBy/At`=自分/今、`qaDraftAt`=今。先着のみ成功)
- エラー: `FORBIDDEN_SITE` / `STATE_CONFLICT`(submittedでない・round不一致)/ **`ALREADY_CLAIMED`**(`{claimedBy,claimedByName,claimedAt}`)。Events `claimed`。

**releaseClaim** ★ `{ "recordId" }` → `{ "record":<RecordSummary> }`(claim解除。QA下書きは残る)。claim者本人か責任者。エラー: `NOT_CLAIMED` / `NOT_CLAIMER` / `STATE_CONFLICT`。Events `claim_released`。

**takeoverReview** ★ `{ "recordId", "round" }` → `{ "record":<RecordDetail> }`(claimを自分に移す。QA下書きは残る)。条件は §4.1。エラー: `NOT_CLAIMED` / `TAKEOVER_NOT_ALLOWED`(`{availableAt}`)/ `STATE_CONFLICT`。Events `claim_taken_over`(detail `{from}`)。

**saveQaDraft** ★ Q `{ "recordId", "items"?:[<ItemPatch>], "comment"?:"str" }` → `{ "record":<RecordSummary> }`(status=submitted かつ claim者本人。`qa*` 列と `Records.qaComment` を更新。`qaDraftAt`=今)。エラー: `NOT_CLAIMER` / `NOT_CLAIMED` / `RECORD_LOCKED`(submittedでない)/ `VALIDATION_FAILED`。

**submitVerdict** ★ PIN(`verdict=ok`のみ) `{ "recordId", "round", "verdict":"ok|minor|major", "comment"?:"str" }`(総合コメントの決め方: **`comment` が未指定(キー無し/`null`)なら `saveQaDraft` で保存済みの `Records.qaComment` を使う**。指定されていればその値を使う。採用した値(空白のみは空とみなす)が空で `verdict` が `minor`/`major` なら `COMMENT_REQUIRED`。≤2000文字) → `{ "record":<RecordSummary>, "warnings":["QA_BEFORE_OPEN"?, "QA_LATE"?] }`
- claim者本人・status=submitted・`round`一致。§5.3.1 の判定検査を全て満たす。成功:
  - `ok` → status=`qa_ok`、`qaVerdict=ok`、`major=FALSE`。
  - `minor` → status=`fix`、`qaVerdict=minor`、`major=FALSE`。
  - `major` → status=`fix`、`qaVerdict=major`、`major=TRUE`(**重大不適合=打設不可**)。責任者へ即時通知(§6.6)。
  - 共通: `qaVerdictBy/At`=自分/今、`qaComment`=採用した総合コメント(上記。`comment` 指定があればその値、なければ保存済みの値)、`claimedBy/At` は `ok` では残し(判定者の記録)、`minor`/`major` では空にする。QAの項目コメント(空でないもの)と総合コメント(採用した値)を Notes に `kind=manager, source=verdict` で追記。Events `verdict_*`(detail に項目結果)。
- `warnings`: `QA_BEFORE_OPEN`(§6.5の検査開始前)/ `QA_LATE`(§6.5のQA期限超過)。いずれも拒否しない。
- エラー: `NOT_CLAIMER`/`NOT_CLAIMED`/`STATE_CONFLICT`/`VALIDATION_FAILED`/`PIN_REQUIRED`/`PIN_INVALID`/`USER_LOCKED`。

**recordPrimeSign** ★ PIN `{ "recordId", "signerName", "method":"paper|pdf|onsite", "evidencePhotoId"?:"p_…" }` → `{ "record":<RecordSummary> }`
- status=`qa_ok` のみ。**3者サイン検査**: 職長提出(`submittedAt`あり)・`qaVerdict=ok`・`signerName` 非空(≤40文字。`PRIME_SIGNER_REQUIRED`)が揃っていること。成功: status=`approved`(**打設可**)、`primeSignedBy/At/SignerName/Method` を記録。`evidencePhotoId` を渡す場合は同記録の `side=prime` の写真であること。Events `prime_signed`。
- エラー: `STATE_CONFLICT` / `VALIDATION_FAILED` / `PIN_*` / `FORBIDDEN_SITE`。

**stopPour** ★ Q(高優先) `{ "recordId", "reason":"≤200文字" }` → `{ "record":<RecordSummary> }`
- **異常時は誰でも止められる**: その現場の有効な担当者(職長は班を問わず)または責任者。status∈{submitted,qa_ok,approved} のとき → status=`fix`、`stopped=TRUE`、`stoppedBy/At/Reason`。**3者サインを無効化**(`prime*`・判定列・`claim*` を空に。履歴は Events/Notes に残る)。`draft`/`fix` の記録には不要(`STATE_CONFLICT`)。
- **他班(`masked`)の記録でも実行できる**(班スコープを適用しない §4.2)。ただし呼出者が他班の職長のとき、応答の `record` は masked 形(§5.1)で、停止理由・項目・コメント等は返さない。`getRecord` は従来どおり `FORBIDDEN_TEAM`。
- Events `stopped`(detail `{reason,previousStatus}`)。責任者・担当QAへ通知(§6.6)。再開は職長が是正→再提出→再度QA/元請の手順(§6.2 T8)。
- エラー: `STATE_CONFLICT` / `VALIDATION_FAILED`(`REASON_REQUIRED`)/ `FORBIDDEN_SITE`。

**addNote** ★ Q `{ "recordId", "itemId"?:"i9", "text":"1〜2000文字" }` → `{ "note":<Note> }`(職長なら `kind=foreman`、QA/責任者なら `kind=manager` をサーバーが役割から決める。**クライアントは kind を送れない**)。Notes に追記(更新・削除不可)、Events `note_added`。職長は status∈{draft,fix} の自班記録のみ(`RECORD_LOCKED`)。エラー: `NOT_FOUND` / `FORBIDDEN_*` / `RECORD_LOCKED` / `VALIDATION_FAILED`。

#### 5.4.4 写真(詳細は §7)

**uploadPhotoChunk** Q(`clientId`なし。冪等性は `photoId` 単位。§5.2)
params:
```json
{ "photoId":"p_1a2b3c4d5e6f7a8b", "recordId":"r_…", "itemId":"i9", "side":"self",
  "index":0, "total":1, "mime":"image/jpeg", "data":"<base64。単発=本体全体(≤photoSingleMaxChars)/分割=一部(≤photoChunkChars)>",
  "thumb":"<base64。index=0のときのみ必須>",
  "takenAt":"2026-10-07T09:58:12+09:00", "width":1280, "height":960,
  "bytes":214532, "sha256":"<本体全体のSHA-256 hex>", "stampText":"A現場(仮) 2F ・ 田中 ・ 2026-10-07 09:58" }
```
- **モード**(版1.4): **単発モード** = `total=1` かつ `index=0`。1リクエストで検証・組立・Drive保存・`Photos` 追記まで完了し `complete:true` を返す(CacheServiceを使わない)。`thumb` は同じリクエストに含める(`index===0` のとき必須、という従来の規則のまま)。**分割モード** = `total` 2〜12(後方互換。従来どおり)。`total=1` で `index≠0`、`index>=total`、`total` が1〜12の整数でない → `VALIDATION_FAILED`(`FIELD_INVALID`、`path`=`index`/`total`)。
- クライアントの選び方は §7.3(base64長 ≤ `photoSingleMaxChars` なら必ず単発。超える場合と旧サーバーのときだけ分割)。サーバーはどちらのモードも受理する(クライアントが選ぶ)。
- メタ(`takenAt`〜`stampText`)は **全リクエスト(全チャンク)に付ける**(サーバーはステートレスに検査できる)。分割モードのチャンクは **index昇順に1つずつ**送る。
- **応答**: 単発 → `{ "photoId", "received":[0], "complete":true, "photo":<PhotoMeta> }`。分割の途中チャンク → `{ "photoId", "received":[0,1], "complete":false }`(`received` はCacheに存在するindex昇順)。分割の最終チャンク(`index=total-1`)で全チャンクが揃っていれば組み立て → 以降は単発と同じ → `{ "photoId", "received":[0,1,2], "complete":true, "photo":<PhotoMeta> }`。
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
- 権限: §4.1(`side`別)。`itemId` は `side=prime` で空、それ以外は必須(記録の項目に存在し `audience` が合うこと)。
- エラー: `NOT_FOUND`/`FORBIDDEN_*`/`RECORD_LOCKED`/`NOT_CLAIMER`/`STATE_CONFLICT`(side=primeでqa_okでない)/`VALIDATION_FAILED`(`FIELD_INVALID`)/`PHOTO_*`/`CHUNK_MISSING`(分割のみ)/`LOCK_TIMEOUT`/`DRIVE_ERROR`。

**deletePhoto** ★ Q `{ "photoId" }` → `{ "photoId", "deleted":true }`(論理削除。撮影者本人・`photo.round == record.round`・そのsideが編集可能な間のみ。他ラウンドの写真は消せない)。**削除済みの写真は `NOT_FOUND`**(存在しない `photoId` と同じ扱い。権限判定より先に評価し、削除済みかどうかを他人に知らせない)。エラー: `NOT_FOUND` / `FORBIDDEN_TEAM` / `RECORD_LOCKED`。

**getPhotoThumbs** `{ "photoIds":[最大20] }` → `{ "photos":[ {"photoId","dataUrl":"data:image/jpeg;base64,…"} ], "missing":["p_…"] }`(権限のない/存在しないIDは `missing`)

**getPhoto** `{ "photoId" }` → `{ "photoId", "dataUrl":"data:image/jpeg;base64,…", "width", "height" }`(本体。1枚ずつ。タイムアウト60秒)。エラー: `NOT_FOUND`。

#### 5.4.5 元請向けPDF(詳細は §10)

**generateReport** ★ `{ "recordId" }` → `{ "report":<Report> }`(最大120秒。status∈{qa_ok,approved}。エラー: `REPORT_NOT_ALLOWED`(`{status}`)/ `DRIVE_ERROR` / `FORBIDDEN_SITE`)。Events `report_generated`。
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
**adminListUsers** `{}` → `{ "users":[ { "userId","name","role","status","lang","email","qaQualified","failedCount","lockedAt","lastLoginAt","devices":[{"deviceId","label","platform","status","registeredAt","lastSeenAt"}] } ] }`(`disabled` も含む。`pinHash/pinSalt` は絶対に返さない)
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

公開: `ping` `listLoginUsers` `registerDevice`
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
`none`(記録なし=仮想)→ `draft`(入力中)→ `submitted`(確認待ち)→ `qa_ok`(QA合格・元請待ち)→ `approved`(打設可)。差し戻しは `fix`(是正中)。**これ以外のstatusを作らない**。「確認中」は status ではなく `claimedBy` で表す。「打設停止」は `stopped=TRUE` + `fix` で表す。

### 6.2 遷移表(これ以外の遷移はサーバーが拒否)

| # | from | to | action | 実行者 | 条件 | PIN | 主な副作用 |
|---|---|---|---|---|---|---|---|
| T1 | none | draft | createRecord | 職長(担当現場) | 現場active、スロット未使用、段階が有効 | 不要 | Records+RecordItems生成、Events `record_created` |
| T2 | draft / fix | 同じ | saveDraft | 職長(自班/自分) | 形式検査のみ | 不要 | `updatedAt`・`version`更新 |
| T3 | draft | submitted | submitRecord | 職長(自班/自分) | §5.3.1 提出検査を全て満たす、`round`一致 | **要** | `firstSubmittedAt`/`submittedAt/By`、Notes追記(職長コメント)、Events `submitted` |
| T4 | submitted | submitted | claimReview | 担当QA / 責任者 | 未claim、`round`一致。**先着のみ** | 不要 | `claimedBy/At`、Events `claimed` |
| T5 | submitted | qa_ok | submitVerdict(ok) | claim者 | 判定検査 OK、`round`一致 | **要** | `qaVerdict=ok`、Notes追記(管理者コメント)、Events `verdict_ok` |
| T6 | submitted | fix | submitVerdict(minor/major) | claim者 | 判定検査 OK、`round`一致 | 不要 | `major`(majorのみTRUE)、`claim*`を空に、Notes追記、Events `verdict_*`、majorは責任者へ即時通知 |
| T8 | fix | submitted | submitRecord | 職長(自班/自分) | T3と同じ検査 | **要** | `round+1`、QA列・判定列・`claim*`・`stopped*`・`prime*` を空に、`escNotified=0`、Events `resubmitted` |
| T9 | qa_ok | approved | recordPrimeSign | 担当QA / 責任者 | 3者サイン検査(職長提出・QA合格・元請担当者名) | **要** | `prime*`記録、Events `prime_signed` |
| T10 | submitted / qa_ok / approved | fix | stopPour | その現場の担当者(職長は班不問) / 責任者 | 理由必須 | 不要 | `stopped=TRUE`、署名無効化(`prime*`・判定列・`claim*`を空に)、Events `stopped`、責任者・担当QAへ通知 |

- `approved` は終端。`approved→fix` は T10(停止)のみ。`submitted→draft`(取り下げ)・`qa_ok→submitted` などは存在しない(提出後の職長編集不可を守るため。P-05と同系)。
- **3者サイン** = ①職長の提出(T3/T8のPIN)、②QAの合格(T5のPIN)、③元請サイン記録(T9のPIN、元請担当者名+方法)。T9は①②③の充足をサーバーが検査する。重大(`major`)・`minor`判定は `fix` に落ちるため打設可にならない。
- 重大不適合=打設不可: `qaVerdict=major` の記録は `fix`。是正→再提出→再度の合格→元請サインを経ないと `approved` にならない。`stopped=TRUE` も同様(T8で解除)。
- T10 で `fix` に戻した記録の再提出時は、停止中だった事実を Notes/Events(`stopped`)が保持する。
- 再検査(別レコード): `approved` になった記録について、打設延期等で再度検査が必要なとき、職長が `createRecord` で `reinspectOf=元recordId` を指定して新規レコードを作る(`round=1`から。P-31)。**元記録が `approved` でない(`draft`/`submitted`/`fix`/`qa_ok`)場合は `STATE_CONFLICT`**(是正は同一レコードの `round+1` で行う)。`fix` の是正再提出は **同一レコードの `round+1`**(別レコードにしない)。
- 段階(`stage`)ごとに別レコード。v1は `pre_pour` のみ有効(P-10)。

### 6.3 ステータスごとの編集可否まとめ

| status | 職長の編集(saveDraft/写真/コメント) | QAの入力 | 備考 |
|---|---|---|---|
| draft | 可 | 不可 | |
| submitted | **不可** | claim者のみ(`saveQaDraft`・QA写真) | |
| fix | 可(是正) | 不可 | QAの指示(`qa*`・`qaComment`)を職長が閲覧 |
| qa_ok | **不可** | 元請サイン証跡写真(`side=prime`)・`addNote(manager)` | |
| approved | **不可** | `addNote(manager)` のみ | |

### 6.4 エスカレーション(30分 / 60分)
- 対象: `status=submitted` かつ `claimedBy` が空の記録。起点は直近の `submittedAt`。
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

`pourPlannedAt` なし・他段階では4つの時刻は `null`、`selfLate`/`qaLate` は `false`。`submitRecord` の `warnings` に `SELF_LATE`(`selfLate`)、`submitVerdict` の `warnings` に `QA_BEFORE_OPEN`(`now < qaOpenAt`)と `QA_LATE`(`now > qaDeadlineAt`)を入れる。画面は期限超過を警告色で表示する。

- 引き継ぎ可能時刻: `takeoverReview`(担当QAによる)は `max(claimedAt, qaDraftAt) + claimTakeoverMin(30分)` 以降、または claim 者が当日不在登録中。責任者は常時可。
- 重大不適合の報告(30分以内): `verdict=major` の保存と同時に責任者へ即時通知(§6.6)することでこの要件を満たす(P-25。責任者の確認ボタンは作らない)。
- 保管10年: 運用目標。アプリは削除しない(P-18)。

### 6.6 通知(v1はアプリ内表示+メール。Web Pushはv2。P-09)
- **アプリ内**: 前景で `Config.pollIntervalSec` ごとに `listRecords`(`since`)と `listJoinRequests` をポーリング。QA/責任者のボード(S09)に「確認待ち(提出順)」「エスカレーション表示(30分超過/60分超過)」「重大不適合」「参加申請」を出す。タブのバッジに件数。
- **メール**(`Users.email` があり `Config.mailEnabled=TRUE` のときのみ。`MailApp`。件名 `[型枠検査] {種別} {現場名} {階}`、本文は日本語・`appBaseUrl/#/record/{recordId}` へのリンクのみ(`requestJoin` は `appBaseUrl/#/joins`)。個人情報・PIN等を含めない。`{階}` は記録に紐づく通知のみ(`requestJoin` は記録がないので `[型枠検査] 参加申請 {現場名}`)。**`{種別}` の語は下表の「種別」列の文字列に固定**(`backend/Notify.gs` の `subject_`・`Records.gs`・`Membership.gs` の実装と一致。mock・テストも同じ語を使う):

| 契機 | 種別(件名の `{種別}`) | 宛先 |
|---|---|---|
| submitRecord(初回・再提出とも) | `提出` | 主担当QA(不在なら有効な代行者)。責任者には送らない |
| escalate_30 | `30分経過` | 代行者 |
| escalate_60 | `60分経過` | 責任者 |
| verdict=major | `重大な不適合` | 責任者全員+その現場の担当QA(実行者除く) |
| stopPour | `打設停止` | 責任者全員+その現場の担当QA(実行者除く) |
| requestJoin | `参加申請` | 主担当QA(不在なら有効な代行者) |

- 種別は上の6語のみ。**差し戻し(`minor`)・合格・打設可(`approved`)・再提出の区別ではメールを送らない**(再提出も `提出`。職長宛のメールは無いため)。語を足す・変えるときは本表を先に直す。

- 職長へはメールしない(状況はアプリのポーリングで見る)。メール送信失敗は本処理を失敗させない(Events detail に `mailed:false`)。

### 6.7 トリガー(`setupTriggers()` をエディタから手動実行して設置)
- `escalationTick`: 5分ごと。
- `dailyMaintenance`: 毎日 03:00 JST。`Idem` の30日超行の削除、期限切れ `Invites` の `expiresAt` 超過行へ `usedAt=expired` を記入。端末の定期整理はしない(登録上限超過時のみ自動整理 §2.5。P-34)。

---

## 7. 写真

**1項目に複数枚登録可。上限は `Config.photoMaxPerItem`(既定5。項目×sideごと)で、責任者が変更可。**

### 7.1 撮影(本番はアプリ内カメラのみ)
- `navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })` で全画面カメラ(M2)を表示し、シャッターで `<video>` のフレームを `<canvas>` に描画して撮影する。**`<input type="file">` や `capture` 属性は使わない**(端末ギャラリーの流用・加工を防ぐ)。
- カメラが使えない/権限拒否のときは撮影不可の案内(`err.camera_denied`)を表示。**代替としてギャラリー選択は提供しない**。ただし自動テスト用に、`frontend/config.js` の `ALLOW_FILE_PHOTO`(既定 `false`)が `true` のビルドでのみファイル選択を許す。E2EテストはChromiumの `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream` を使いカメラ経路を通す。
- 撮影枚数: 項目×side あたり `photoMaxPerItem`(5)枚まで。

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
  reports/{siteId}_{現場名}/{recordId}_v{version}_{YYYYMMDD-HHmm}.pdf
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

---

## 8. オフライン・再送・競合・下書き

### 8.1 原則
- **ローカルファースト**: 入力は常に端末(IndexedDB)に即時保存し、バックグラウンドでoutboxから送信する。圏外でも入力・撮影ができる。
- 送信は **冪等キー(`clientId`)** で二重送信を防ぐ(§5.2)。同じ操作は何度送っても結果は1回分。
- キューに入れてよい操作(Q): `createRecord` `saveDraft` `saveQaDraft` `uploadPhotoChunk` `deletePhoto` `addNote` `stopPour`。
- **オンライン限定**(Qでない): `submitRecord` `submitVerdict` `recordPrimeSign`(PIN平文をキューに残さないため。P-05)、`claimReview` `releaseClaim` `takeoverReview`(先着判定はサーバーでしか決まらない)、`requestJoin` `decideJoin` `revokeMembership`、`generateReport`、`admin*`、`changePin`、参照系全て。圏外では該当ボタンを無効化し、理由(`msg.offline_required`)を表示する。
- `stopPour` はQだが高優先: outboxの先頭に割り込み、圏外では「送信待ちです。至急電話で連絡してください」(`msg.stop_queued_call`)を強調表示する。

### 8.2 IndexedDB スキーマ(DB名 `katawaku`、バージョン1)

| ストア | キー | 内容 |
|---|---|---|
| `kv` | `k` | `{k,v}`: `deviceToken` / `deviceId` / `me`(Me) / `lang` / `bootstrap`(`{sites,items,itemsHash,config,fetchedAt}`)/ `lastSyncAt` / `skewMs`(サーバー時刻−端末時刻) |
| `records` | `recordId`(index: `siteId`) | `{recordId,siteId,summary,detail|null,fetchedAt}`(サーバー応答のキャッシュ) |
| `drafts` | `recordId` | 端末の作業コピー: `{recordId,siteId,baseRound,baseStatus,header:{lot,zone,pourPlannedAt},items:{[itemId]:{result,severity,values,note}},qaItems:{…同形},qaComment,dirty,updatedAt}` |
| `outbox` | `seq`(autoIncrement。index: `status`,`recordId`) | `{seq,clientId,action,params,priority:0|1,recordId,status,blockReason:'auth'|'locked'|'outdated'|'record'|null,tries,nextTryAt,createdAt,lastError:{code,message}|null,photo:{photoId,total,nextIndex}|null}` |
| `photoBlobs` | `photoId` | `{photoId,recordId,itemId,side,full:Blob,thumb:Blob,meta,uploadState}`(アップロード完了で本体を削除し `photoCache` へサムネを移す) |
| `photoCache` | `photoId` | `{photoId,thumb:Blob,full:Blob|null,lastUsedAt}`(LRU) |

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
  6. 応答でローカル `records` キャッシュを更新するとき、**並行して返った古い応答で新しい応答の内容を巻き戻さない**(同じ記録のキャッシュは `version` が大きい方を残す)。

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
2. 成功 → その行(送った `seq` だけ)を削除。応答でローカル `records` キャッシュを更新。続けて 1 に戻って空いたスロットを埋める。
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
- 編集画面(S06)の上部には常に **現場名・階・工区・ロット** を固定表示する。確認画面(S07)にも現場・階・工区・ロット・打設予定日時を表示する。
- 入力の保存: 変更のたび(デバウンス500ms)と `visibilitychange`/`pagehide` で `drafts` に保存し、outboxへ `saveDraft` を積む(統合 §8.3)。アプリを閉じても復元できる。
- サーバーの値で `drafts` を置き換える条件: その記録のoutbox行が0件のときのみ(未送信変更があるときは §8.7 のマージ)。

### 8.9 キャッシュとポーリング
- 起動時・前景化時・`pollIntervalSec`(60秒)ごとに、オンラインなら `listRecords`(`since`)で差分取得、QA/責任者は `listJoinRequests`、`me`(ロック状態)も確認。`getBootstrap` は起動時と前景化時(5分以上経過時)に取得し、`itemsHash` が変われば項目マスタを更新。
- 圏外では IndexedDB のキャッシュ(`bootstrap`・`records`・`photoCache`)で一覧・詳細を表示し、「最終更新 hh:mm」を出す。
- 経過時間表示(「◯分前」・エスカレーション判定表示)は `skewMs` を補正した現在時刻で計算する。

### 8.10 Service Worker・PWA
- `sw.js`: アプリシェル(index.html・JS・CSS・i18n・manifest・アイコン)は **`install` 時の `cache.addAll` による事前キャッシュ(precache)だけ**で持つ(キャッシュ名 `katawaku-shell-{SW_VERSION}`)。**シェルの更新は `SW_VERSION` を上げたときだけ**(新しいキャッシュ名で再 precache し、`activate` で旧キャッシュを削除)。**同一 `SW_VERSION` の間は、シェルのファイルを実行時に取得・上書きしない**(バックグラウンド更新で JS/CSS/i18n が部分的に新旧混在になるのを防ぐ)。唯一の例外として、**ナビゲーション(HTML への遷移)だけ stale-while-revalidate**(キャッシュを返しつつ裏で取得して更新)。**API(`API_URL`)へのリクエストは一切キャッシュせず素通し**。
- 新しいSWが `waiting` になったら更新バナー「更新があります」(`msg.update_available`)を出し、タップで `skipWaiting` → リロード。
- **`CLIENT_OUTDATED` を受けたとき**(§8.4): 更新バナーに「更新」ボタンを出す(押すと SW の更新確認→`skipWaiting`→リロード)。送信は止めたまま(outbox 行は `status=blocked`・`blockReason='outdated'`)。**更新後のリロードで `appVersion` が `minClientVersion` 以上になったら、`blockReason='outdated'` の行を自動で `pending` に戻して送信を再開する**(利用者の操作は不要。同一ユーザーのまま。`auth`/`locked` の保留は別条件で解除)。更新後も `CLIENT_OUTDATED` が続くなら保留のまま更新ボタンを出し続ける。
- `manifest.webmanifest`: `name="型枠検査"`、`short_name="型枠検査"`、`display="standalone"`、`start_url="./"`、`scope="./"`、`theme_color`/`background_color`、192/512pxアイコン(仮アイコン可。P-21)。
- ホーム画面追加を案内する(iOS Safariは非インストール時にサイトデータが7日で消えることがあるため、トークン消失時は再登録で復帰できる旨も案内。P-34)。

---

## 9. 画面一覧・表示制御・i18n

### 9.1 共通レイアウトと原則
- スマホ縦(**375px幅で崩れない**)。本文は最大幅560pxで中央寄せ、左右16pxの余白、**横スクロール禁止**(`document.scrollingElement.scrollWidth <= clientWidth`)。**タップ領域は最小44×44px。対象は全ての操作要素**(ボタン・リンク・タブに加え、ヘッダの outbox バッジ・接続インジケータが操作を持つ場合のそれ・言語ボタン・チップ/バッジのタップ・一覧の行・テキストリンク・チェック/ラジオを含み、例外を作らない。見た目が小さい場合は余白(padding)で当たり判定を広げる)。入力欄のフォントは16px以上(iOSの自動ズーム防止)。
- ヘッダ(固定): アプリ名。**現場に関する画面では現場名を固定表示**。**S06/S07/S08/S10/S12/S13 は、読み込み中・通信エラー・記録が取得できない状態でも現場名を表示する**(キャッシュ `bootstrap`/`records`、ルートの `siteId`、S13 は `n` から引く)。それでも現場名が分からないときは `siteId` を出さず「現場不明」(`app.site_unknown`。ja「現場不明」/ id は暫定訳)を表示する。右側に 接続インジケータ(オンライン/オフライン)・outboxバッジ(未送信件数。`failed`/`blocked` があれば警告色。タップでS20)・言語ボタン(`日本語`⇄`Indonesia`)。
- 下部タブ(固定、`env(safe-area-inset-bottom)` 考慮): 職長=`現場`/`履歴`/`設定`、QA=`ボード`/`履歴`/`担当表`/`設定`、責任者=`ボード`/`履歴`/`担当表`/`管理`/`設定`。サブ画面(編集・確認・詳細・管理サブ)ではタブを隠し「戻る」を出す。
- ライト/ダーク: `prefers-color-scheme` に追従(色はCSS変数)。外部CDN・Webフォント不使用(§1.2)。
- ルーティング: ハッシュルーティング(`#/…`)。画面遷移でスクロールを先頭へ。
- **表示制御の原則**: 記録に対するボタン・入力の有効/無効は **`RecordSummary.actions`/`RecordDetail.actions` に含まれるaction名のみ**で決める。フロントに役割や担当の判定ロジックを書かない(最終判定は常にサーバー)。役割(`Me.role`)はナビゲーションの出し分け(どのタブ・どの管理メニューを出すか)にのみ使う。
- 表示テキストは全て `t(key)`(§9.4)。サーバーからの文字(氏名・現場名・項目文・コメント)は **必ずエスケープして `textContent` で描画**(`innerHTML` に生文字を入れない)。

### 9.2 画面一覧

画面IDは `S00`〜`S20`。**`S15` は欠番**(PDFはモーダル M6 に統合)。

| ID | ルート | 対象 | 使うaction | 表示 | 操作・制御 |
|---|---|---|---|---|---|
| S00 | (起動) | 全員 | `me`,`getBootstrap` | スプラッシュ | トークン無→S01、`locked`→S02、それ以外→ホーム(職長S03/他S09)。保留の参加QR(`pendingJoin`)があればS13へ |
| S01 | `#/register` | 未登録端末 | `listLoginUsers`,`registerDevice` | 氏名リスト(ボタン)、PIN4桁、`invited` の氏名には招待コード欄、「PINを忘れた/再設定」で招待コード欄表示 | 登録成功で `deviceToken` 保存→S00。エラーは `err.<CODE>`。`PIN_INVALID` は残り回数、`USER_LOCKED`→S02 |
| S02 | `#/locked` | ロック中 | `me`(60秒ごと) | 「ロックされています。責任者に解除を依頼してください」 | 解除されたら自動で復帰。「この端末をログアウト」(`logoutDevice`) |
| S03 | `#/`(職長) | 職長 | `getBootstrap`,`listRecords`,`listJoinRequests` | 担当現場カード(現場名、未着手/是正中/確認待ちの階数)、申請中の現場(`承認待ち`)、「QRで現場に参加」 | カード→S04。参加ボタン→S13。担当現場が0なら案内文 |
| S04 | `#/site/:siteId` | 全員 | `listRecords`(siteId) | 現場名固定。**階ごと**に記録スロット(ロット・工区・段階・ステータス・作成者名)。主担当/代行者名(不在なら「代行中」)。ローカル下書きバッジ | 職長: 各階に「新しい記録」(→S05)。自班の記録→S06(編集可なら)/S08。**他班(`masked`)は「他班が入力中」で開けない(S06/S08へは遷移しない)。ただし行の `actions` に `stopPour` が含まれるときは、その行に「打設を止める」ボタンだけを出し、M4(理由必須)から `stopPour` を送れる。記録の内容は表示しない(現場・階・ロット・班名・ステータスのみ)**。QA/責任者: 記録→S08(`submitted`でclaim可ならS10への導線も) |
| S05 | `#/site/:siteId/new` | 職長 | `createRecord` | 階(select)、工区(`zones`があれば select)、打設ロット(必須テキスト)、段階(v1は「打設前」固定表示)、打設予定日時(`datetime-local`、提出時必須)、再検査のとき元記録の表示 | 「作成して入力へ」→`createRecord`(Q)→S06。`ALREADY_EXISTS` なら既存記録へ誘導(`mine`ならS06、他班なら案内のみ) |
| S06 | `#/record/:id/edit` | 職長 | `getRecord`,`saveDraft`,`uploadPhotoChunk`,`deletePhoto`,`addNote` | **固定ヘッダ=現場名・階・工区・ロット・段階**、進捗バー(入力済み/総数)、ステータス、`fix` のとき赤バナー(QA総合コメント・停止理由)、項目をグループ見出し付きで列挙。各項目: 番号・項目文・「写真必須」バッジ・OK/NG/該当なし・実測入力(`measure≠none`: 値のチップ+「測定点を追加」、許容と「許容超え」表示)・コメント欄(職長)・写真(撮影ボタン・サムネ・削除×。**送信中(outbox が `sending`)の写真は削除×を無効**。§8.3)・`fix` では管理者コメント(別枠・読み取り専用)・違反の赤枠とメッセージ | 入力は即ローカル保存(§8.8)。`actions` に `saveDraft` が無ければ全て無効+読み取り専用バナー。撮影は M2。「確認へ進む」で事前検証(§5.3.1と同rule)→違反があれば赤枠・先頭へスクロール、無ければS07 |
| S07 | `#/record/:id/confirm` | 職長 | `submitRecord` | 「この現場・階で間違いありませんか」+ **現場名・階・工区・ロット・段階・打設予定日時** を大きく、OK/NG/該当なし件数、NG項目と備考の一覧、未送信件数 | 「提出する」→PIN入力 M1 →`submitRecord`。無効条件: 圏外/outboxに未送信/事前検証違反。成功→S08(`SELF_LATE` は警告表示)。手書きサインは廃止しPIN再入力を電子サインとする(P-04) |
| S08 | `#/record/:id` | 全員(権限内) | `getRecord`,`stopPour`,`addNote`,`generateReport`,`listReports` | 現場・階・工区・ロット・段階、ステータスチップ(大)、停止/重大/エスカレーションのバナー、**3者サイン欄**(職長/QA/元請。済=氏名+日時、未=「未」)、期限(`timing`、超過は警告色)、項目の読み取り一覧(職長結果・QA結果・実測・職長コメントと管理者コメントを**別枠**・写真)、コメント追記ログ(Notes)、履歴(Events。`ev.<kind>`でラベル化) | ボタンは `actions` で出し分け: 「続きを入力/是正して再提出」(`saveDraft`)→S06、「確認する」(`claimReview`)→S10、「確認画面へ」(自分がclaim者=`saveQaDraft`)→S10、「元請サインを記録」(`recordPrimeSign`)→M5、「打設を止める」(`stopPour`)→M4、「元請提出用PDF」(`generateReport`)→M6、コメント追記(`addNote`) |
| S09 | `#/`(QA/責任者) | QA・責任者 | `listRecords`,`listJoinRequests`,`decideJoin`,`listAbsences` | 見出し=役割と氏名。①参加申請(自分が承認できるもの=`canDecide`)②確認待ち(提出順。経過時間・エスカレーション表示・確認中の人)③重大不適合・打設停止中④元請待ち(`qa_ok`)⑤現場×階の状況グリッド。責任者はロック中ユーザー件数(→S16)も | 申請の「承認」→M9(班名・役)→`decideJoin`、「却下」。確認待ち→S10(`claimReview`が`actions`にあれば「確認する」)。`escLevel`=1:「30分超過」、2:「60分超過」(警告色) |
| S10 | `#/record/:id/review` | QA・責任者 | `getRecord`,`claimReview`,`releaseClaim`,`takeoverReview`,`saveQaDraft`,`uploadPhotoChunk`,`submitVerdict`,`addNote` | 現場・階・工区・ロット、職長提出者・経過時間。項目ごとに 職長の結果・コメント・写真(読み取り)+QA入力(OK/NG/該当なし、NGなら重さ=軽微/重大、実測、コメント(管理者)、写真(**任意**。撮影・サムネ・削除×。**送信中の写真は削除×を無効**。§8.3))。総合コメント。「提案: 合格/軽微/重大」(**画面側の補助表示のみ**。QA入力のNG有無・重さから計算。自動確定しない) | 未claimなら「確認中にする(先着)」(`claimReview`)。他人がclaim中なら「{名前}が確認中」+(`takeoverReview`が`actions`にあれば)「引き継ぐ」。QA入力は `saveQaDraft` が `actions` にあるときのみ有効。判定ボタン「合格」「軽微な不適合」「重大な不適合」は事前検証(§5.3.1の判定検査)を通るものだけ有効、違反理由を表示。「合格」→M1(PIN)→`submitVerdict(ok)`。`minor`/`major` はPINなしで確認ダイアログ→送信。「確認を中止」(`releaseClaim`)。QAの下書きはoutbox経由で保存 |
| S11 | `#/history` | 全員 | `listRecords` | 現場・状態フィルタ。更新の新しい順に 現場・階・ロット・ステータス・最終更新・作成者・NG件数 | 行→S08。`masked`(他班)は行自体は開けない。`actions` に `stopPour` があれば S04 と同様に「打設を止める」ボタンだけ出す(M4。内容はマスクのまま) |
| S12 | `#/roster` | QA・責任者 | `listAssignments`,`listAbsences`,`adminValidateRoster`(責任者) | 現場ごとの 主担当・代行者・職長(班)・期間、不在中マーク。責任者は名簿チェック結果(error/warn) | 表示のみ。「担当表の編集はスプレッドシートで行います」の案内(P-16)。責任者→S17 |
| S13 | `#/join?site=&k=&n=` | 職長 | `requestJoin` | 「『{n}』に参加申請しますか」。承認後に有効になる旨 | 「申請する」→`requestJoin`→「承認待ち」表示。未登録端末は `pendingJoin` を保存しS01→登録後ここへ戻る。アプリ内読み取り(`BarcodeDetector`対応端末)と、URL/合言葉の貼り付け入力の両方を用意。標準カメラでQRを読んでURLを開く方法も案内(P-27) |
| S14 | `#/joins` | QA・責任者 | `listJoinRequests`,`decideJoin`,`revokeMembership` | 全申請(状態別)。承認済みの取消(理由必須) | S09の参加申請から「すべて見る」で遷移 |
| S16 | `#/admin/users` | 責任者 | `adminListUsers`,`adminIssueInvite`,`adminUnlockUser`,`adminSetUserStatus`,`adminRevokeDevice` | ユーザー一覧(役割・状態チップ・`locked`を強調・最終ログイン)。ユーザーごとに端末一覧 | 「招待コードを発行」(`first`/`pinReset`)→M8(コード・期限を1回だけ表示、再表示不可)。「ロック解除」。「無効化/有効化」。端末の「登録解除」(確認ダイアログ) |
| S17 | `#/admin/absences` | 責任者 | `listAbsences`,`adminSetAbsence`,`adminCancelAbsence` | 不在一覧、追加フォーム(ユーザー・期間・理由) | 追加/取消 |
| S18 | `#/admin/qr` | 責任者 | `adminGetJoinInfo`,`adminRotateJoinKey` | 現場ごとにQRコード(`joinUrl`から端末内で生成。外部サービス不使用)、現場名、有効な合言葉 | 「印刷」(印刷用CSS)、「合言葉を更新」(確認ダイアログ。旧QRは無効になる) |
| S19 | `#/settings` | 全員 | `setLang`,`changePin`,`logoutDevice`,`me` | 氏名・役割、言語切替(日本語/インドネシア語。インドネシア語は暫定訳の注記)、PIN変更(現在PIN・新PIN2回)、端末情報(端末名・アプリ版・最終同期)、ログアウト | ログアウト前に未送信outboxの警告。責任者は管理メニューへの導線 |
| S20 | `#/outbox` | 全員 | (ローカル) | 未送信操作の一覧(対象記録・操作名・状態・エラー理由 `err.<CODE>`)、写真の進捗 | 「今すぐ送信」「破棄」「再送」(§8.4)。`failed` は赤。**期限切れ(`EXPIRED`。§8.5)の行は「破棄」のみ** |

モーダル/オーバーレイ:

| ID | 内容 |
|---|---|
| M1 | PIN入力(4桁・数字キーボード・`type=password`)。誤り→「あと{remaining}回」。`USER_LOCKED`→S02。送信中はボタン無効 |
| M2 | アプリ内カメラ(全画面。シャッター・撮り直し・使う・枚数表示・スタンプのプレビュー。§7.1) |
| M3 | 写真拡大(`getPhoto`、スタンプ文字列、閉じる) |
| M4 | 打設停止(理由必須テキスト、大きい赤ボタン。圏外では「送信待ちになります。至急電話で連絡」)。`masked`(他班)の記録から開いたときは、現場・階・ロット・班名だけを表示し、記録の内容は出さない |
| M5 | 元請サイン記録(担当者名・方法 paper/pdf/onsite・証跡写真(任意)→PIN入力M1→`recordPrimeSign`) |
| M6 | 元請提出用PDF(`generateReport`の進捗→版・URL・「共有」(`navigator.share`、無ければリンクコピー)・「開く」・過去版一覧) |
| M7 | 汎用確認ダイアログ |
| M8 | 招待コード表示(コード・有効期限・「再表示できません」) |
| M9 | 参加承認(班名の入力=必須・既定は「{氏名}班」、役=職長/副職長) |

### 9.3 画面ごとの空状態・エラー表示
- 一覧が空: `scr.<ID>.empty` の文言。通信エラー: 画面上部にバナー(`err.network`)+キャッシュ表示。サーバーエラー: `err.<CODE>`(§5.3の全コードに辞書キー必須)。`VALIDATION_FAILED` は `rule.<RULE>` を該当項目の下に表示。
- 読み込み中はスケルトンまたはスピナー。操作ボタンは二重押下防止(送信中は無効)。

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
| `st.*` | ステータス | `st.none`=未着手、`st.draft`=入力中、`st.submitted`=確認待ち、`st.fix`=是正中、`st.qa_ok`=元請待ち、`st.approved`=打設可(idはプロトタイプの訳を流用) |
| `badge.*` | 補助バッジ | `badge.stopped`=打設停止中、`badge.major`=重大不適合、`badge.draft_local`=下書きあり、`badge.masked`=他班が入力中 |
| `stage.*` | 段階 | `stage.pre_pour` … |
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

- 項目マスタ・グループ名は辞書ではなくマスタ列を使う: `lang==='id' ? textId : textJa`、`groupJa/groupId`。
- 言語の決定: ログイン後は `Me.lang`、未ログインは `kv.lang`、なければ `navigator.language` が `id` で始まれば `id`、それ以外 `ja`。ヘッダの言語ボタンで即時切替(再描画)し、`kv.lang` に保存、オンラインなら `setLang`(失敗しても無視)。
- 日時表示は言語に依らず `MM/DD HH:mm`(JST固定)。経過は `time.min_ago`/`time.hour_ago`。
- **インドネシア語は暫定訳**(P-22)。辞書に `meta.idProvisional=true` を置き、設定画面に注記を出す。prototype の `L.id`(現行の暫定訳)を土台にキー名だけ新体系へ移す。
- インドネシア語は日本語より長くなる(目安+30%)ため、固定幅・`white-space:nowrap`・省略(`…`)で意味が欠けないこと。ボタン・チップは折り返し可、`min-width:0`。**日本語/インドネシア語の両方で375px幅の全画面を検査する**(§12 E-07/E-08)。
- 辞書の不変条件(テストで検査): `Object.keys(ja)` と `Object.keys(id)` が完全一致/値が空でない/コードが参照する `t('…')` のキーが全て存在/`err.*` は §5.3 の全コード、`rule.*` は §5.3.1 の全rule、`ev.*` は §2.11 の全kind、`st.*` は6値。

---

## 10. 元請向けPDF

### 10.1 目的と流れ
元請はアカウントを持たず、**閲覧専用のPDF**を受け取るだけ。QA(または責任者)が `generateReport` でPDFを生成し、共有リンクまたはファイルとして元請へ渡す(LINE・メール等はスマホの共有機能)。元請の電子サイン/押印の受け入れ可否・独自書式は未確定(要件§3。P-11)のため、v1は以下の自社書式。

- 生成可能: status∈{`qa_ok`(元請の確認・サイン待ち。署名欄は空欄を印刷)、`approved`(3者サイン済み)}。`qa_ok` で渡したPDFに元請が署名(紙/PDF)→QAが `recordPrimeSign` で記録(`method`・担当者名・任意で署名済み書類の写真を `side=prime` で保存)→`approved`。承認後に最終版PDFを再生成して保管する(版が増える。**自動生成はしない**。S08/S09の導線で促す)。

### 10.2 内容(日本語のみ。A4縦、余白12mm)
1. タイトル「型枠工事 {段階名}検査記録」。
2. 基本情報: 現場名、元請会社名(`primeContractor`)、階・工区・打設ロット、段階、打設予定日時、記録ID、ステータス(生成時点)、提出ラウンド数、生成日時、版(`v{n}`)。
3. **3者サイン欄**: 職長(氏名・提出日時・「PIN認証による電子サイン」)/ 品質管理者(氏名・判定日時・判定=合格)/ 元請(`approved` は 担当者名・方法・記録者・日時、`qa_ok` は「氏名 ______ 日付 ______ 署名・押印」の空欄)。停止履歴があれば注記。
4. 結果サマリ: 職長・管理者それぞれの OK / NG / 該当なし 件数。
5. 項目表: `No.` | 項目(`textJa`、重点は★)| 職長結果 | 管理者結果 | 実測(差mm/許容)| 職長コメント | 管理者コメント。NG行は薄い赤背景。**職長コメントと管理者コメントは別の列**。
6. NG・是正の経過: 判定イベント(`verdict_*`)を時系列に(日時・判定者・判定・総合コメント・NG項目)、提出回数、停止の理由・日時。
7. 写真: 項目ごとにサムネ(長辺320px)をグリッド表示。キャプション=項目No.・撮影者区分(職長/管理者/元請サイン証跡)・`stampText`。最大60枚(超える場合はNG項目の写真を優先し、残りは「他N枚は電子記録で閲覧可」と注記)。
8. フッタ(全ページ): 記録ID・ページ番号・「電子記録ハッシュ(SHA-256): {64桁}」。ハッシュ = 記録スナップショット(`recordId`,`round`,項目結果一式,署名3者の氏名・日時,判定イベント一覧)の canonicalJSON のSHA-256。

### 10.3 生成方法(GAS)
1. 記録の詳細・Notes・判定Events・写真メタをシートから取得(権限は `generateReport` の `authorize`)。
2. インラインCSSのみのHTML文字列を組み立てる(外部リソース不可。日本語フォントはPDF変換側の既定を使用。レンダリング不良時は Google ドキュメントのテンプレートから書き出す方式に切替。P-17)。
3. 写真サムネは Drive の `thumbFileId` からバイト列を取得して `data:image/jpeg;base64,…` として埋め込む。
4. `HtmlService.createHtmlOutput(html).getBlob().getAs('application/pdf').setName(name)`。ファイル名 `{recordId}_v{version}_{YYYYMMDD-HHmm}.pdf`。
5. `reports/{siteId}_{現場名}/` に保存。`Config.pdfShareMode=anyone_with_link` なら `file.setSharing(ANYONE_WITH_LINK, VIEW)`、`private` なら共有しない(P-32)。`url = file.getUrl()`。
6. PDF本体の SHA-256 を計算し `Reports` に追記(`version` = その記録の既存最大+1)。Events `report_generated`。応答 `Report`(§5.1)。
7. タイムアウト目安120秒。写真が多い場合は上記60枚上限で抑える。

### 10.4 フロント側
M6 で生成中表示 → 完了後に版・URL・共有ボタン。`navigator.share({title,url})` が使えれば共有シート、なければリンクのコピー。URLは外部(Drive)なので新しいタブで開く(`rel="noopener"`)。

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
- **ロック**: 更新系は1本のFIFOミューテックスで直列化し、「冪等キー確認→authorize→PIN→更新→Events→Idem保存」を原子的に行う(同時claimで先着のみ成功する)。`--latency` は直列化の前に適用する(並行到着を再現)。**例外 `uploadPhotoChunk`(版1.4)**: 認証・検証・仮想Drive保存はミューテックスの **外**、再認証〜既存行確認〜上限確認〜Photos追記〜touchだけをミューテックスの **内** で行い(§5.4.4)、ミューテックスの前後で必ずイベントループに制御を返す(`await`)こと(別リクエストが間に割り込める。`/__mock/interleave` もこの境界で適用する)。仮想Driveに作ったファイルは、ロック内で `Photos` 行にならなかった場合に削除(ゴミ箱扱い)する。
- **冪等キー**: §5.2 通り(`replayed:true`、`IDEMPOTENCY_CONFLICT`、RecordDetail系の再構築)。
- **PIN/トークン**: §3 通り。`pinHash`/`tokenHash` は同アルゴリズムで保持(ペッパー=`mock-pepper`)。状態ダンプ(`/__mock/state`)に `pinHash`/`pinSalt`/`tokenHash`/招待`codeHash` を出さない。
- **時計**: すべての時刻・期限・エスカレーションはモックの仮想時計 `now()` を使う(初期値=起動時の実時刻。`/__mock/clock` で変更)。`meta.serverTime` も仮想時計。
- **エスカレーション**: `escalationTick` を **各リクエスト処理の直前に遅延実行**し、`/__mock/tick` でも実行可。送信メールは送らず記録だけ(`/__mock/mails`)。
- **写真**: 単発(`total=1`)はキャッシュを使わず、1リクエストで §5.4.4 の検証→「仮想Drive」(メモリのMap。パスは§7.4の構造)に保存→ロック内で Photos 追記。分割は、チャンクをメモリのキャッシュ(仮想時計で6時間TTL。`/__mock/evictChunks` で全消去)に保存し、最終チャンクで検証→仮想Driveに保存。仮想Driveの作成・削除は `lockHeld` 付きで履歴に残す(`/__mock/driveLog`)。`/__mock/drive` は **削除(ゴミ箱)されていない** ファイルの一覧。`getPhotoThumbs`/`getPhoto` は保存したバイト列を `data:` URLで返す。参照シートのキャッシュ(§2.15)はモックでは実装しなくてよい(常に最新を返すのは契約に適合する)。
- **PDF**: 手書きの最小PDF(ASCIIのみ。`MOCK REPORT {recordId} v{n} {status}` の行を含む、先頭 `%PDF-`)を生成し `/files/reports/{名前}` で配信、`Reports` に追記、`url` は `http://{host}/files/reports/{名前}`。`sha256` は実バイト列のハッシュ。
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

**Records**(`stage=pre_pour`、`lot=L1`、項目は16の `active` 項目。`pourPlannedAt`=reset時の翌日09:00 JST。ID は右列)

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
- 不在登録なし。Config は §2.14 の既定。Items は §2.6.1(i1〜i49の49行。16有効+33無効)。Notes/Events はこの状態を説明する最小限(各記録の `record_created`・提出・判定等)を整合するように用意。

---

## 12. テスト観点(完了の定義 CLAUDE.md §5 をテストケースに落とす)

### 12.1 テストの層と実行
- 契約テスト(`tests/contract/*.test.js`、`node --test`、Node 22のグローバル `fetch`): 相手は `API_URL`(既定 `http://127.0.0.1:8787/api` = mock、`http://127.0.0.1:8788/api` = harness)。`/__mock/*` を使うテストは `@mock-only`(実GASではスキップ)。
- ユニットテスト(`tests/unit/*.test.js`): フロントの純関数(`validate.js`・outboxの統合/バックオフ/送信可否規則・`time.js`・単発/分割の選択とチャンク分割・スタンプ文字列・i18n)とmock/harness共通の純関数(canonicalJSON・ハッシュ)。
- E2E(`tests/e2e/*.spec.js`。**`playwright` 本体(`chromium` API)+ `node:test`(`node --test`)で実行し、`@playwright/test` と `playwright.config.js` は使わない**。`tests/package.json` の devDependency は `playwright` のみ。**ブラウザ未導入環境では `npx playwright install chromium` が必要**(環境メモ))。静的サーバー(`tests/helpers/static-server.js`)で `frontend/` を配り、`config.js` の `API_URL` をmock(またはharness)へ向ける。Chromium起動引数 `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream`、モバイル(375×667、`isMobile`、`hasTouch`)、ロケールja-JP/id-IDの両方。**コンソールエラー・未処理例外・失敗リクエスト(想定外)があれば全テストで失敗**とする共通フィクスチャ。
- 構文: `tests/check-syntax.js` が `backend/*.gs`(一時`.js`コピー)・`frontend/**/*.js`・`mock/**/*.js`・`tests/**/*.js` に `node --check`。
- **SPEC同期** `tests/spec-sync.test.js`: SPEC.md から §5.5の action名・§5.3のエラーコード・§5.3.1のrule・§2.14のConfigキー・§2の全シート列名・§2.6.1の項目を抽出し、`/__mock/meta`、`backend/Schema.gs`+`Seed.gs`+`Code.gs`(vmで評価)、`frontend/i18n.js` のキー(`err.*`/`rule.*`/`ev.*`/`st.*`)と一致することを検査する(= 「実装がSPECと一致」)。
- 実行: `node tests/run-all.js`(構文→unit→mock起動→contract(mock)→harness起動→contract(harness)→E2E(mock)→E2E(harness)。いずれか失敗で非0)。

### 12.2 完了の定義 → テスト対応表

| DoD(CLAUDE.md §5) | テストID |
|---|---|
| 職長が他現場を見られない | C-PERM-01, C-PERM-02, E-02 |
| QAが担当外を判定できない | C-PERM-03, E-06 |
| 職長が提出後に編集できない | C-PERM-05, E-04 |
| 職長コメントが管理者操作で消えない | C-PERM-06 |
| 5回誤りでロック、ロック中は操作不可、責任者のみ解除 | C-AUTH-04, C-PIN-01, C-PIN-04, E-09 |
| 圏外で入力→復帰で自動送信、二重送信されない | C-IDEM-01〜04, U-OUTBOX-*, E-05 |
| 2人のQAが同時に確認中→先着のみ | C-CONC-01, E-06 |
| スマホ幅375pxで崩れない、ja/idで欠けがない | E-07, E-08, U-I18N-01 |
| スタンプ付き写真、職長のNGは写真と備考必須(QA側は写真任意) | C-STATE-05, C-PHOTO-*, U-PHOTO-*, E-03 |
| コンソールエラー0、`node --check`、テスト全通過 | 共通フィクスチャ, `check-syntax.js`, `run-all.js` |
| 写真送信の高速化(単発・並行・ロック範囲・参照キャッシュ。版1.4) | C-PHOTO-01,03,07〜12, C-CONC-04,05, C-CACHE-01,02, U-PHOTO-03, U-OUTBOX-04, E-13 |
| 写真送信・応答時間の性能目標(版1.5。**自動テストではなく手動確認**) | §12.6(実GASで手動。`run-all.js` の対象外) |
| 実装がSPECと一致 | `spec-sync.test.js` |

### 12.3 契約テスト(C-)

**封筒・共通**
- C-ENV-01: 未知action・`v`不一致・不正JSON・`params` の未知キー(例 `role`)→ `BAD_REQUEST`。★で `clientId` 欠落 → `BAD_REQUEST`。
- C-ENV-02: 全応答に `ok`・`meta.serverTime`・`meta.apiVersion=1`。失敗は `error.code` が §5.3 の既知コード。常にHTTP 200。(mock-only) `OPTIONS /api` が 405 でCORSヘッダなし。
- C-ENV-03: `ping` が GET/POST 両方で成功。`appVersion` が `minClientVersion` 未満なら `CLIENT_OUTDATED`(`ping`/`me` を除く)。
- C-ENV-04(検査順序 §4.2): 同時に複数の不備がある要求は最初の段のエラーを返す。契約外キー+役割違反(職長の `claimReview` に未知キー)→`BAD_REQUEST`。役割違反+範囲違反→`FORBIDDEN_ROLE`。範囲違反+状態違反(担当外現場の `draft` 記録への `claimReview`)→`FORBIDDEN_SITE`。班違反+状態違反(他班の `submitted` 記録への `saveDraft`)→`FORBIDDEN_TEAM`。

**認証・PIN**
- C-AUTH-01: `listLoginUsers` は `disabled` を含まず、`role` キーを含まない。
- C-AUTH-02: `registerDevice`(田中/1111)で token 取得→`me` が田中・`role=foreman`。token改ざん→`UNAUTHENTICATED`。`adminRevokeDevice` 後→`DEVICE_REVOKED`。
- C-AUTH-03: `invited` ユーザー: 招待コードなし→`INVITE_REQUIRED`、誤りコード→`INVITE_INVALID`(`remaining`)、正しい `123456`+新PIN→登録成功しそのPINで `registerDevice` 可、再使用→`INVITE_INVALID`。(mock-only)時計+73時間→`INVITE_EXPIRED`。
- C-AUTH-04(ロック): 誤PINで `registerDevice` を5回 → 1〜4回目 `PIN_INVALID`(`remaining` が4,3,2,1)、5回目 `USER_LOCKED`。正しいPINでも `USER_LOCKED`。既存端末のtokenでも `listRecords` が `USER_LOCKED`、`me` は `status=locked` を返す。
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
- C-STATE-07(打設停止): `approved` を田中(他班の職長でも同現場なら可)が `stopPour`→`fix`・`stopped=TRUE`・署名無効(`prime`/判定が空)。**他班の職長(`masked` の記録)の `listRecords` 行は `actions=["stopPour"]` で、`stopPour` は成功し応答 `record` は masked 形、同じ職長の `getRecord` は `FORBIDDEN_TEAM` のまま**。他現場の職長は `FORBIDDEN_SITE`、`draft` へは `STATE_CONFLICT`、理由なし→`REASON_REQUIRED`。停止後に是正・再提出・再合格・元請サインを経て初めて `approved`。
- C-STATE-08(スロット): 同一(現場,階,工区,ロット,段階)の2件目→`ALREADY_EXISTS`。`approved` 記録には `reinspectOf` 付きでのみ追加可。`reinspectOf` の元記録が `approved` でなければ(例 `fix`/`qa_ok`)`STATE_CONFLICT`(`error.data` は元記録の `status`/`round`)。未有効段階→`STAGE_NOT_ENABLED`。閉鎖現場→`SITE_CLOSED`。
- C-STATE-09(3者サイン): `signerName` 空→`PRIME_SIGNER_REQUIRED`。`qa_ok` 以外では `STATE_CONFLICT`。`approved` 後は `signatures` の3者が揃って返る。

**同時操作**
- C-CONC-01: 佐藤と鈴木が同時(`Promise.all`、`--latency` 付き)に同じ submitted 記録へ `claimReview` → ちょうど1件成功、他方 `ALREADY_CLAIMED`(`claimedBy` が成功者)。20回繰り返して常に1:1。
- C-CONC-02(引き継ぎ): claim中の記録を、鈴木が30分未満で `takeoverReview`→`TAKEOVER_NOT_ALLOWED`(`availableAt`)。(mock-only)時計+31分→成功。責任者は即時可。claim者が不在登録中なら即時可。
- C-CONC-03: 同一記録の `saveDraft`(同班2人)が交互に届いても項目×列の後勝ちで欠落しない。
- C-CONC-04(ロック分離): 同一記録に対し `uploadPhotoChunk` 単発3本と `saveDraft` 1本を `Promise.all`(`--latency` 付き)→ 全て成功し、写真3行・`saveDraft` の項目が欠落せず、`Records.version` が開始値+4(更新の取りこぼしなし)。
- C-CONC-05: (mock-only)別の記録への `claimReview` と `uploadPhotoChunk` 単発を同時に送っても双方成功し、`claimReview` の先着規則(C-CONC-01)は崩れない。

**冪等**
- C-IDEM-01: 同じ `clientId`+同内容で `submitRecord`/`submitVerdict`/`recordPrimeSign` を2回 → 2回目 `meta.replayed=true`・同一 `data`・Events の件数は1回分・`round` 不変。
- C-IDEM-02: 同じ `clientId` で内容違い → `IDEMPOTENCY_CONFLICT`。別ユーザーが同じ `clientId` → `IDEMPOTENCY_CONFLICT`。
- C-IDEM-03: `createRecord`/`claimReview` の再送が成功(再構築。§5.2)。`saveDraft`・`addNote` の再送でNotes/項目が重複しない。
- C-IDEM-04: 検証エラーで失敗した `clientId` は保存されず、直した内容で同じ `clientId` を再送すると成功。
- C-IDEM-05: (mock-only)`/__mock/fail`(`mode:"network"`,`after:true`)で応答喪失を1回起こし、同じ `clientId` で再送 → 2回目は `replayed:true` で成功し、状態・Events・Notesが二重にならない。

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
- C-ITEM-01: `getBootstrap.items`=§2.6.1の有効16項目(`itemsHash` あり。無効のi17〜i49は含まれない)。(mock-only)`patch` で i48 を `active=TRUE` にしても `stage=post_demold` のため `getBootstrap.items` にも新規記録にも含まれない。(mock-only)`patch` で i17 を `active=TRUE` にすると新規記録に含まれ、既存記録の項目は変わらない(スナップショット)。`audience=qa` の項目は職長の提出検査対象外。
- C-CACHE-01(キャッシュが権限を跨がない): 事前に `getBootstrap` などで参照キャッシュを温めた状態で、`/__mock/patch`(`keepCache:true`)により ①田中の `Users.status=disabled` → **直後の** 田中のtokenでの任意のaction(`me` 以外)が `USER_DISABLED` ②田中の s_a の `Assignments` を `active=FALSE` → **直後の** `listRecords(siteId=s_a)` が `FORBIDDEN_SITE`、`getBootstrap.sites` から s_a が消える ③佐藤の `Absences` を挿入 → **直後の** `listAssignments.absentToday=true`、鈴木が主担当の代行として `decideJoin` 可 ④`adminRevokeDevice` 直後に当該端末が `DEVICE_REVOKED` いずれも遅延が許されない。(mock/harness共通。モックは常に最新なので自明に通る)
- C-CACHE-02: (harness-only。`/__mock/cacheStats.enabled=true` のときだけ実行)①温めた後 `Config.photoMaxPerItem` を `keepCache:true` で変更 → 直後の `getBootstrap.config.photoMaxPerItem` は旧値(`hits` が増える)、`/__mock/clock` で+61秒後は新値 ②`keepCache` 無しの `patch` は直後に新値 ③`adminRotateJoinKey` の直後に旧 `joinKey` の `requestJoin` が `JOIN_KEY_INVALID`(`Sites` 破棄+`joinKey` 照合はキャッシュを使わない) ④`Config` に1行120,000文字の `description` を持つ行を `patch` で追加し、キャッシュ値が100KB(102,400バイト)を超える状態で `getBootstrap` が正常応答・`skippedTooLarge` が増え、`Items`/`Sites` のキャッシュは影響を受けない ⑤`Sites` を `keepCache:true` で `status=closed` に変更 → +61秒後は `createRecord` が `SITE_CLOSED`(60秒以内は成功/`SITE_CLOSED` のどちらも許す=assertしない)。
- C-ROSTER-01: `adminValidateRoster` はシードで `problems` にerrorなし。(mock-only)`patch` で `qa_sub` を外す→`SITE_NO_QA_SUB`、`qa_main==qa_sub`→`QA_MAIN_EQ_SUB`、職長のUserにQA担当→`ROLE_MISMATCH`。
- C-REP-01: `qa_ok` で `generateReport`→`url`・`version=1`、再実行で2。`submitted` では `REPORT_NOT_ALLOWED`。(mock-only)取得したPDFが `%PDF-` で始まる。`approved` でも生成可。`listReports` が版降順。
- C-ADMIN-01: `adminIssueInvite`(first/pinReset の整合・古いコードの失効)、`adminSetUserStatus(disabled)`→そのユーザーの全actionが `USER_DISABLED`、自分自身は変更不可、`adminSetAbsence`/`adminCancelAbsence`、`adminGetJoinInfo` の `joinUrl` 形式。

### 12.4 ユニットテスト(U-)
- U-VALID-01: `frontend/js/validate.js` が `tests/fixtures/validation-cases.json` の全ケースで §5.3.1 と同じ rule・itemId を返す(契約テストと同じデータ)。
- U-OUTBOX-01: 同一recordIdの `saveDraft` 統合で `clientId` が新規採番され内容がマージされる。`sending` 中の行は統合せず、その間の変更は別の `pending` 行(次回送信分)になる。送信直前の再読込で、統合後の `params`・新しい `clientId` が送られる(§8.4 の不変条件)。
- U-OUTBOX-02: 順序(同一record内FIFO・`stopPour` 優先)、バックオフ列(2,5,15,30,60,60…秒)、確定エラーで後続行が `blocked`、`CHUNK_MISSING` で `nextIndex=0`、認証エラーで全停止→同一ユーザー再登録で再開。
- U-OUTBOX-03: 作成から30日超の行が `failed`(`lastError.code='EXPIRED'`)になり、送信ループは送らず、S20 は「破棄」のみ出す(「再送」「今すぐ送信」を出さない・呼んでも送信しない)。29日の行は通常どおり送る。
- U-OUTBOX-04(送信可否規則 §8.4。フロントは `outbox.js` に純関数 `selectSendable(rows, {now, photoParallel})`(送る行の `seq` 配列を返す。**契約として確定。テストが直接呼ぶ**)を置く。`claimSendable`・`normParallel` などの内部関数は実装の自由でSPEC外(テストは依存しない)。データ駆動 `tests/fixtures/outbox-schedule-cases.json`): ①写真の行3件(先行の非写真の行なし)で `photoParallel=3` → 3件、`=2` → 2件、`=9` → 6件を上限、設定なし/`null`/0以下 → 1件(入力は整数のみ。小数・文字列の丸めは検査しない) ②同じ記録に先行する `createRecord`(`pending`/`sending`/`failed`/`blocked`)があるうちは写真の行を選ばない(完了して行が消えたら選ぶ) ③`seq` が 写真A・写真B・`saveDraft`・写真C の順 → A,B は同時に選ばれ、`saveDraft` は A,B が両方消えるまで選ばれず(`sending` 中・`failed` でも)、C は `saveDraft` が消えるまで選ばれない ④別の記録の `saveDraft` 2件 → 同時に1件だけ ⑤別の記録の写真の行と非写真の行は同時に選べる ⑥同じ `photoId` の行が2件 → 1件だけ ⑦写真Aが `failed` でも同じ記録の写真B,Cは選ばれ続け、後続の `saveDraft` は選ばれない(確定失敗の通知で `blocked`)。非写真の行が `failed` なら同じ記録の後続の写真の行も `blocked` ⑧`stopPour` は写真の行の完了を待たず最優先で選ばれる。写真の行・非写真の行(`saveDraft` 等)が `failed` になっても、同じ記録の `pending` の `stopPour` は `blocked` にならず選ばれる(`stopPour` 自身が `failed` のときだけ後続が `blocked`) ⑨写真の行が backoff 待ちでも他の写真の行は選ばれる ⑩連続通信失敗カウントは並行する要求を通算し、成功1件でリセット(3回でオフライン)。
- U-PHOTO-01: base64分割(分割モードに入ったときのみ): 連結=元、各チャンク≤90,000文字かつ4の倍数、`total=ceil(len/90000)`、最大12(超えたら `err.photo_too_large`)。
- U-PHOTO-02: `stampText` 生成が §7.2 通り(工区あり/なし、JST固定、`skewMs` 補正)。圧縮の段階的再エンコード(400KB超→0.6→0.5→0.85倍)。
- U-PHOTO-03(モード選択。対象は `planUpload`): `L ≤ photoSingleMaxChars` → `total=1`(`photoMaxBytes` 600,000 の最大 `L=800,000` も単発)。`L > photoSingleMaxChars` → 分割。`config` に `photoSingleMaxChars` が無い → 常に分割(旧サーバー互換)。送信直前(`nextIndex=0`)に config を見て決め直せるが、`nextIndex>0` では変えない。
- U-TIME-01: JST整形が端末TZ(UTC/America/Los_Angeles/Asia/Jakarta)に依らず同一。
- U-I18N-01: ja/idのキー集合が一致・値が空でない・コード内の `t('…')` の参照キーが全て存在・`err.*`/`rule.*`/`ev.*`/`st.*` が網羅。HTML/JSに日本語リテラルが無い(`i18n.js`・コメント除く)。
- U-HASH-01: PINハッシュ・招待ハッシュ・`paramsHash`・`canonicalJSON` が `tests/fixtures/hash-vectors.json`(テスト担当がNodeで生成して固定)と mock・harness の双方で一致。
- U-SEED-01: `Seed.gs` の `SEED_ITEMS`・mockのシード・SPEC §2.6.1 が完全一致(`tests/fixtures/seed-items.json` を基準。i1〜i49の49行)。

### 12.5 E2Eテスト(E-。Playwright、375×667、ja/id)
- E-01 登録: S01で田中を選びPIN→ホーム。リロードしてもPIN不要。誤PIN×5で S02。責任者が解除(別コンテキスト)→復帰。`invited` の氏名では招待コード欄が出る。
- E-02 職長フロー: 現場A→2F→記録作成(ロット入力)→16項目入力(OK/NG/該当なし、実測、コメント)→NGと重点項目で写真撮影(fakeカメラ)→違反が赤枠で出てから修正→確認画面(現場・階・工区・ロット表示)→PIN→「確認待ち」。田中のホームに s_c が出ない。他班の記録が「他班が入力中」で無効。
- E-03 QAフロー: 佐藤がボードで確認待ち(提出順・エスカレーション表示)→「確認中にする」→全項目入力(NGは備考・重さが必須、写真は任意=写真なしでも判定できる)→「合格」ボタンの有効条件→PIN→`qa_ok`→元請PDF生成(M6)→元請サイン記録(M5, PIN)→`approved`(打設可)。3者サイン欄が全て済。
- E-04 差し戻し: 軽微な不適合→`fix`→職長は是正コメントを見て編集可→再提出(PIN)→`round2`。提出後の画面は読み取り専用(編集ボタンなし)。
- E-05 オフライン(圏外で下書き・撮影 → 復帰で自動送信 → オンラインで提出(PIN)): `context.setOffline(true)` で下書き入力・撮影 → outboxバッジ件数・「圏外」表示・提出ボタン無効(`msg.offline_required`。圏外では提出できない) → 復帰で自動送信されバッジが0に → サーバー側に二重なし(`/__mock/state` の件数) → **オンラインになってから提出(PIN入力 M1)して `submitted`**。`/__mock/fail`(after:true)で応答喪失を起こしても二重にならない。リロードしても下書きとoutboxが残る。
- E-06 同時操作: 2つのブラウザコンテキストで佐藤・鈴木が同時に「確認中にする」→片方のみ成功、他方に「◯◯が確認中」。佐藤で s_c の記録を開いても確認ボタンが出ない(権限なし)。
- E-07 レイアウト: 全画面(S00〜S20、M1〜M9)を ja/id × 375px で巡回し、横スクロールなし(`scrollWidth<=clientWidth`)・ボタンが画面外に出ない・**全ての操作要素(バッジ・言語ボタン・リンク含む)のタップ領域が44×44px以上**。S06/S07/S08/S10/S12/S13 は読み込み中・エラー表示でも現場名(取得不可なら「現場不明」。`siteId` は出さない)が出ている。
- E-08 i18n: 言語切替で全画面の文字が切り替わり、キー文字列(`scr.`/`err.` などのプレフィックス)が画面に露出しない。項目文・グループ名がマスタの `textId/groupId` になる。
- E-09 ロック: 5回誤りでロック画面、ロック中は全操作不可、責任者(S16)で解除。
- E-10 参加: 職長がQR(URL)から参加申請→「承認待ち」→主担当QAが承認(班名入力)→職長の現場一覧に出る。旧QR(合言葉更新後)では申請できない。
- E-11 打設停止: `approved` の記録で職長が「打設を止める」(理由)→`fix`・停止バナー・責任者のボードに表示。
- E-12 管理: 責任者が招待コード発行(コードは1回だけ表示)・端末登録解除(解除された端末はS01へ)・不在登録・QR表示/合言葉更新。
- E-13 写真の単発・並行送信(mockを `--latency 300` で起動): オンラインで5枚を続けて撮影(別項目)→ Playwright のリクエスト監視で ①各 `photoId` につき `uploadPhotoChunk` が **ちょうど1回**(`total=1`) ②同時に進行する `uploadPhotoChunk` の最大が 2 以上かつ `photoParallel`(3)以下 ③全て完了後にoutboxバッジ0、サーバーの `Photos` が5行・仮想Driveの有効ファイルが本体5+サムネ5。さらに写真送信中は「提出する」が無効で「送信中(残りN件)」が出て、全完了後に提出でき `PHOTO_REQUIRED` にならない(§8.6)。写真の1枚が確定失敗(`/__mock/fail` の `mode:"error",code:"PHOTO_INVALID",match:"uploadPhotoChunk"`)しても他の4枚は送られ、S20 に失敗1件が出る。

### 12.6 性能の受け入れ基準(版1.5。実GASでの目標。手動確認項目)

自動テストにはしない(`run-all.js`・mock・harness は対象外。通信と GAS の実行時間は環境で変わるため)。**本番相当のデプロイ(実GAS + 実スマホ)でバックエンド/フロント担当(または責任者)が手動で測り、結果を日付つきで `docs/OPERATIONS.md` の「性能確認」欄に残す**(バックエンド担当)。

| # | 項目 | 目標(各3回測って中央値) | 測り方 |
|---|---|---|---|
| PERF-01 | `GET {API_URL}?action=ping` | 約1.5秒以内 | 2回目以降(ウォーム状態)。ブラウザの開発者ツールのネットワーク時間、または端末のクライアント側タイマー |
| PERF-02 | 写真1枚(約300KB)の送信(`uploadPhotoChunk` 1回) | 約10秒以内(撮影確定〜サーバー応答までではなく、リクエスト送信〜応答) | `total=1` の1リクエストで完了していること(ネットワークタブで同じ `photoId` のリクエストが1回) |
| PERF-03 | 写真10枚(各約300KB、別項目)の送信完了 | 約40秒以内(3並列=`photoParallel` 既定) | 10枚撮影してから outbox バッジが0になるまで。同時に進行するリクエストが最大3であること |

- 前提: モバイル回線またはWi-Fiで通常の電波状態。GASのコールドスタート直後の1回目は除く(別途「初回は遅い」ことを許容)。
- 目標を満たさないとき: ①ネットワークタブで同一 `photoId` の複数リクエスト(分割になっていないか)・並列数を確認 ②Apps Script の実行ログで `uploadPhotoChunk` の所要時間を確認し、§2.16(重複読込・全件読込)と §1.6 の7(`uploadPhotoChunk` のロック範囲)の実装漏れを探す ③それでも届かなければ実測値を添えて設計担当へ「SPEC変更要望」(目標値や方式の見直し)。**目標未達は不具合ではなく、原因が実装漏れか目標の見直しかを分類する**(CLAUDE.md §5 の5)。
- 数値は目安(「約」)。10〜20%程度の超過は、再測定のうえ許容するかを責任者が判断する。

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
│   ├─ Schema.gs      SCHEMA(§2の全シート・列・型)・setupSheets()・setupSecrets()・setupTriggers()
│   ├─ Repo.gs        シート読み書き(一括読み・型変換・参照シート(Config/Items/Sites)のみ60秒キャッシュ §2.15・追記専用の保護)
│   ├─ Seed.gs        SEED_ITEMS(§2.6.1)・初期Config(§2.14)
│   ├─ Auth.gs        registerDevice・PIN/招待・deviceToken・stepUp検証・ロック(§3)
│   ├─ Authz.gs       authorize()・siteAccess/isAbsent/effectiveQaMain/allowedActions/escLevel/computeTiming(§4.2,§6)
│   ├─ Idem.gs        冪等キー(§5.2)
│   ├─ Records.gs     記録系action(§5.4.3)・提出/判定検査(§5.3.1)・Notes/Events追記
│   ├─ Photos.gs      写真アップロード・Drive保存・サムネ(§5.4.4,§7)
│   ├─ Membership.gs  参加・名簿・不在(§5.4.6,§5.4.7の参照系)
│   ├─ Admin.gs       admin*・adminValidateRoster
│   ├─ Report.gs      PDF生成(§10)
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
│       ├─ photo.js     カメラ・スタンプ・圧縮・分割(§7)
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
| バックエンド | `backend/`・`docs/DEPLOY_GAS.md`・`docs/OPERATIONS.md` | `backend/`,上記docs | harness経由で契約テスト全通過。`node --check`。**全ての時刻は `Util.now()`、乱数/ID は `Util.newId()` 経由**(`new Date()`/`Math.random` を他で直接使わない。harnessが時計を差し替えるため)。権限判定は `Authz.gs` の `authorize` のみ。シークレット・PIN平文をログ/シートに残さない。**読み込みは §2.16 に従う(リクエスト内メモ・必要な行/列だけ読む。可変データはリクエストをまたいでキャッシュしない)**。性能目標 §12.6 を実GASで手動確認し結果を `docs/OPERATIONS.md` に残す |
| フロント | `frontend/`・`docs/DEPLOY_PWA.md` | `frontend/`,上記docs | mock相手にE2E全通過。権限判定をフロントに書かない(`actions` のみ)。直書き文字列なし。375pxで崩れない |
| モック | `mock/` | `mock/` | 契約テスト全通過。§11の全機能(`/__mock/*` 含む)。SPECとの同期テスト通過 |
| テスト | `tests/` | `tests/` | §12の全ケースを実装。`run-all.js` で一括実行できる。失敗時は原因がどの担当かわかる出力 |
| 設計 | `SPEC.md` | `SPEC.md` | 本書の保守。変更履歴の記録 |

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
| P-06 | 時間ルール(前日15:00/16:00/打設2h前) | 警告・フラグのみで操作は拒否しない。提出時に `pourPlannedAt` は必須 |
| P-07 | `minor` 判定の扱い | `minor`/`major` とも status は `fix`(差し戻し)。`major` は重大フラグ(`major=TRUE`)を立て責任者へ通知 |
| P-08 | 異常時の打設停止 | status を `fix`+`stopped=TRUE` に戻し、3者サインを無効化(statusを増やさない) |
| P-09 | 通知 | アプリ内(ポーリング)+メール(`Users.email` があるときのみ)。Web Push はv2。職長へメールしない |
| P-10 | 段階(`stage`) | v1は `pre_pour` のみ作成可(`Config.enabledStages`)。他段階は列・項目マスタの `stage` で拡張できる |
| P-11 | 元請サインの記録方法 | QA/責任者が担当者名+方法(paper/pdf/onsite)+任意で証跡写真を記録。元請の独自書式・電子サイン受入は未確定 |
| P-12 | QA欄の事前入力 | しない(職長の結果をコピーしない。形骸化防止)。QAが全項目を入力 |
| P-13 | 実測値 | 「設計値との差(mm)」の数値配列(最大10点)。`measure` は初期 `optional`(必須化はマスタ編集)。要件の「各面2箇所以上」は `minMeasures=2`+`measure=required` で運用化 |
| P-14 | 班スコープ | 職長は自班(`team` 一致)または自分の記録のみ詳細閲覧可。他班は `masked`(要約のみ)。`team` 空は本人のみ |
| P-15 | 責任者のQA兼務 | 責任者は `qa_sub` になれ、全現場でQA操作を最終代行できる(PIN必須。Eventsに残る)。職長との兼任は構造上不可 |
| P-16 | 名簿管理 | A案(スプレッドシート直接編集)。アプリで行うのは招待・ロック解除・端末解除・不在・QR・参加承認のみ。PC管理画面は後日 |
| P-17 | PDFの日本語描画 | `HtmlService`→PDF変換で試す。不良ならGoogleドキュメントのテンプレート書き出しに切替 |
| P-18 | 保管10年 | 自動削除なし。Events等の肥大化対策(年次アーカイブ)はv2 |
| P-19 | QAの担当過多(1人2〜3現場) | `adminValidateRoster` の警告のみ(`qaMaxSitesPerDay=3`) |
| P-20 | 写真の圧縮値 | 長辺1280px・JPEG品質0.72・サムネ320px・項目×sideあたり5枚まで・本体≤600KB |
| P-21 | PWAアイコン | 仮アイコン |
| P-22 | インドネシア語 | 暫定訳(prototypeの訳を流用+不足分は設計担当が補足)。ネイティブ確認が必要 |
| P-23 | `listLoginUsers` | 端末登録前に氏名一覧(役割は含めない)を未認証で返す。氏名が外部から見える点は許容(要確認) |
| P-24 | 弱いPIN(0000等) | 拒否しない(4桁の制約上。ロックと端末登録制で緩和) |
| P-25 | 重大不適合の30分報告 | 判定時に責任者へ即時通知で充足。責任者の確認(ack)機能は作らない |
| P-26 | 項目マスタ | prototypeの16項目(active)+追加案15項目(i17〜i31)+元Excel突合で追加した18項目(i32〜i49)(計49行)。i17〜i49 の33項目は無効。**突合済**(`docs/item-reconciliation.md`)。i48・i49 は `stage=post_demold`(v1では作成不可)。編集ルールは §2.6.2 |
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

### 14.2 ユーザー確認が必要な事項(最後にまとめて報告するもの)
1. **P-03 初回PIN設定の招待コード方式**で良いか(氏名選択だけでPINを設定できる案は、先に名前を選んだ他人に乗っ取られるため不採用)。
2. **P-04 手書きサイン廃止**(PIN再入力を電子サインとする)で良いか。
3. **P-05 提出・合格・元請サインのオンライン限定**で良いか(圏外では下書きと写真のみ)。
4. **P-07 / P-08**: 軽微な不適合も差し戻し(`fix`)にする点、異常時の打設停止で3者サインをやり直す点。
5. **P-11 元請サインの記録方法**と、元請がPDF/電子サイン/独自書式を受け入れるか。
6. **P-12 QA欄の事前入力なし**(QAの入力負担が増える)。
7. **P-15 責任者が代行者・最終代行を兼ねる**点。
8. **P-23 氏名一覧が未認証で見える**点、**P-32 PDFリンク共有**(組織のGoogle共有ポリシー)。
9. 現場名・管理者・職長・代行者の初期データ、インドネシア語の訳確認(P-22。i32〜i49 の訳を含む)。元資料xlsxとの項目突合(P-26)は済。
10. **SPEC変更要望(Items検証)**: 名簿の `adminValidateRoster` と同様の、責任者向け Items 整合チェック(例 `adminValidateItems`。`itemId`/`seq` の重複・`tol` と `measure` の整合・enum値・`groupKey` ごとのグループ名一致)が無い。v1は目視確認(§2.6.2)。追加するなら action 追加(43→44)・§4.1・§5.4.7・S12 相当の画面・C-ITEM テストが必要。要否の判断を求める。
11. **版1.4の確認(1.4.1で①②は確定済み。参考として残す)**: ①P-38 直接編集の反映が最大60秒遅れる運用(責任者への周知)で良いか ②P-37 実行強制終了時の孤児ファイルを自動掃除しない扱いで良いか ③参照キャッシュの対象に `Sites` を含めたが、`joinKey` を扱う `requestJoin`/`adminGetJoinInfo`/`adminRotateJoinKey` は `Sites` をキャッシュなしで読む(設計担当の追加判断)。
12. **版1.5の確認**: ①性能目標(§12.6 / P-39)の数値で良いか。実機で測って乖離すれば見直す ②`Config`/`Items`/`Sites` のキャッシュTTLは60秒のまま(依頼にあった「5分まで」は採らず、直接編集の反映遅れを最大60秒に留めた)。延ばしたい場合は §2.15-10 のとおり本書を先に直す ③`photoChunkChars` を 700000 にする案は、分割モードのCache 100KB制限のため採用しなかった(§2.14)。

### 14.3 設計上の差分メモ(prototype・要件との整合)
- 判定値: prototype の `critical` は本書の `major`(CLAUDE.md §3の `ok/minor/major`)。項目結果は `ok/ng/na`(要件の合/NG/該当なし)。NGの重さ(`minor`/`major`)は QA が項目ごとに付ける。
- prototype の「デモ用ユーザー切替」「データ初期化」「手書きサイン」「`<input capture>`撮影」「Google Fonts」は新アプリに持ち込まない。
- prototype の「QAの結果を職長の結果で事前入力」は採用しない(P-12)。
- 役割名(表示): 職長/品質管理者/管理責任者(要件の「管理部門責任者」)。値は `foreman`/`qa`/`lead`。

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
