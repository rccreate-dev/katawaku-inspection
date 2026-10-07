# mock/ — GAS互換モックAPIサーバー

SPEC.md §11 の実装。本物のGAS(`backend/`)と同一のAPI契約(§1.5〜§6、43 action)・同一のHTTP挙動を提供する。
依存パッケージなし(Node 22 標準のみ)。フロント開発・E2E・契約テストの相手になる。

## 起動

```sh
node mock/server.js                       # http://localhost:8787/api
node mock/server.js --port 8787 --latency 200 --persist
MOCK_PORT=8787 MOCK_LATENCY_MS=200 MOCK_REDIRECT=1 node mock/server.js
```

| オプション / 環境変数 | 内容 |
|---|---|
| `--port N` / `MOCK_PORT` | 待受ポート(既定 8787) |
| `--latency N` / `MOCK_LATENCY_MS` | 各 `/api` リクエストの先頭で N ms 待つ(直列化の前。並行到着を再現) |
| `--persist` | 状態を `mock/.mock-state.json` に保存し、起動時に復元(既定は起動毎にシードで初期化) |
| `MOCK_REDIRECT=1` | `POST /api` に 302 を返し、`Location: /api-echo/{id}` を GET すると同じ本文を返す(GASの302再現。`fetch(..., {redirect:'follow'})` の検証用) |

起動直後はシード(§11.5)の状態。`POST /__mock/reset` でいつでも初期化できる。

## HTTP仕様(GAS同等)

- `POST /api` : `Content-Type: text/plain;charset=utf-8`、本文は封筒JSON(§1.5)。応答は **常にHTTP 200**・`application/json;charset=utf-8`・`Access-Control-Allow-Origin: *`。
- `GET /api?action=ping` のみ有効。他のGETは `BAD_REQUEST`(HTTP 200)。
- **`OPTIONS` は 405 でCORSヘッダなし**(`application/json` 等でプリフライトが必要な送り方をするとブラウザで失敗する)。
- `GET /files/reports/{name}` : 生成したPDF(`application/pdf`)。
- フロントは `frontend/config.js` の `API_URL` を `http://localhost:8787/api` にするだけで接続できる。

## テスト用コントロール `/__mock/*`(契約外。フロントのコードから絶対に呼ばない)

全て `POST`(JSON本文)。成功は `{ok:true,data}`、誤用は HTTP 400 `{ok:false,error:{code:"MOCK_ERROR",message}}`。

| パス | 本文 | data |
|---|---|---|
| `reset` | `{now?, variant?:"default"\|"invited"}` | `{now,variant}`。シード初期化+仮想時計設定+`fail` キュー破棄。`invited` は `u_sugiant` を未設定にし招待コード `123456`(72時間)を用意 |
| `clock` | `{set:dt}` / `{advanceMin:n}` | `{now}`。仮想時計(実時間とともに進み、`advanceMin` で加算される) |
| `tick` | `{}` | `{escalated:n}`。`escalationTick` を即時実行(各APIリクエストの直前にも自動実行) |
| `issueDevice` | `{userId}` | `{deviceId,deviceToken}`。PIN検証なしで端末発行 |
| `fail` | `{next:n, mode:"http500"\|"network"\|"timeout"\|"error", code?, match?, after?}` | 次のn件のAPI処理を失敗させる。`match`=action名。`network`=切断、`timeout`=10秒無応答のち切断、`error`=`code`のエラー応答、`http500`。`after:true` は処理を完了してから応答喪失(冪等キー検証用) |
| `evictChunks` | `{}` | 写真チャンクのキャッシュを全消去(`CHUNK_MISSING` 再現) |
| `patch` | `{sheet,key,set}` / `{sheet,insert}` | スプレッドシート直接編集の再現(Users/Sites/Assignments/Items/Config/Absences のみ。列名・型はSCHEMA準拠で検証。`pinSalt/pinHash/failedCount/lockedAt` は不可)。insert はIDや既定値を補完 |
| `state` | `{sheet?}` | `sheet` なし: `{counts:{シート名:行数}}` / あり: `{sheet,rows:[…]}`(`pinHash/pinSalt/tokenHash/codeHash` は出さない。json列は解析済みオブジェクト) |
| `mails` | `{}` | `{mails:[{to,subject,body,at,toUserId}]}` |
| `drive` | `{}` | `{paths:[…],files:[{path,bytes}]}`(仮想Drive。§7.4の構造) |
| `meta` | `{}` | `{actions,errorCodes,violationRules,configKeys,schema:{sheet:[列名]},itemsSeedHash}`(`itemsSeedHash`=`sha256(canonicalJSON(SEED_ITEMSの31行))`) |

## シード(§11.5)

| ユーザー | PIN |
|---|---|
| u_tanaka 田中(職長) | 1111 |
| u_sugiant スギアント(職長) | 2222 |
| u_sato 佐藤(QA) | 3333 |
| u_suzuki 鈴木(QA) | 4444 |
| u_lead 責任者 | 9999 |

現場 `s_a`/`s_b`/`s_c`(`s_c` は工区 東,西)、記録は `r_seeda10000000000`(approved)/`a2`(submitted・escLevel1)/`a3`(draft)/`b1`(fix)/`b2`(draft・スギアント班)/`c1`(qa_ok)/`c2`(submitted・escLevel2)。詳細は SPEC §11.5。参加用合言葉は `joinkeyaaaaaaaa1`(s_a)など。

## 実装メモ(SPECで曖昧だった点の仮置き)

- 仮想時計は `実時刻 + オフセット`(時間は流れる)。`reset` で `now` を渡すとその時刻から流れ始める。
- 更新系は同期処理=1本のミューテックスと等価。`--latency` はその前に適用。
- 状態ダンプの json 列(`Events.detail` など)は解析済みオブジェクトで返す(テストヘルパは文字列でも解析する)。
- `Invites.usedAt` に旧コード失効時は `superseded` を入れる(SPECの `expired` と同系)。
- 写真: `Photos.round` は撮影時の `Records.round`。QA写真・元請証跡写真は **現在のラウンドのもののみ** を `RecordDetail` に出し、判定の写真検査(side=qa)も現在ラウンドで数える。自己写真は全ラウンド通算。
- 写真アップロードで記録の `updatedAt`/`version` を更新する(一覧ポーリングで検知できるように)。
- `RecordSummary.qaCounts` は職長に対し `draft`/`submitted` では0で返す(QA下書きを見せない)。
- `uploadPhotoChunk` の `thumb` は index=0 で必須(無ければ即 `PHOTO_INVALID`)。`bytes` が上限超過なら先頭チャンクで `PHOTO_TOO_LARGE`。
- `reinspectOf` は元記録と同一スロットで `approved` のとき可。それ以外は `FIELD_INVALID`/`STATE_CONFLICT`。
- `adminSetUserStatus(active)` は `pinHash` があれば `active`、無ければ `invited`(`failedCount`/`lockedAt` も解除)。

## ファイル

- `server.js` HTTPとコントロール、`engine.js` 状態・`authorize`・ビュー・dispatcher、`actions.js` 全actionの処理、`seed.js` スキーマ・初期項目・Config、`pdfstub.js` 最小PDF、`util.js` 時刻/ハッシュ/ID。
