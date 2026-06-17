# 13. エクスポート / インポート

> 要件トレース: requirements.md「エクスポート / インポート」「受け入れ基準」
> 状態: ドラフト ／ 実装フェーズ: 5

設定画面の「データ」セクション（[08](./08-routing-views.md)）。`services/ExportService.ts` / `ImportService.ts`。

## 13.1 エクスポート（3 種）

| 種別 | 形式 |
|---|---|
| ① タスク | **JSON（正本・無損失）** ＋ Markdown チェックリスト（`- [ ]`/`- [x]`）＋ CSV |
| ② 設定 | JSON |
| ③ タスク＋設定 | JSON（正本・無損失） |

- **JSON が正本**：全種・無損失・再取り込み可（受け入れ基準）。
- Markdown / CSV は**派生**（人が読む/表計算向け、有損失でも可）。
- 受け渡し: **Blob ダウンロード ＋ `navigator.share`**。File System Access API は使わない。

### JSON 正本スキーマ（骨子）

バージョン付き・全フィールド・往復可能にする。

```ts
interface ExportFileV1 {
  format: 'todo-pwa-export';
  v: 1;
  kind: 'tasks' | 'settings' | 'tasks+settings';
  exportedAt: Millis;
  tasks?: Todo[];                 // 全フィールド（tombstone 含む）
  settings?: DeviceSettings;
}
```

> 設計判断: `tasks` は tombstone（`deleted`）や `version` も含めてそのまま出す。これにより JSON 往復が無損失になり、インポート時にマージエンジンへ素直に渡せる（受け入れ基準）。Markdown/CSV は表示用サブセットでよい。

## 13.2 インポート

`<input type="file">` で読み込む。

| 取り込み | 動作 |
|---|---|
| タスク | **マージエンジン経由で取り込む**（[04](./04-sync-engine.md)）。下記の no-base 解決 |
| 設定 | **このデバイスに適用**（上書き・確認あり） |

- タスクのインポートは「外部状態を 1 つの先端」として現在の状態に統合する。ただし**インポート JSON は共通履歴（LCA）を持たない**ため、3-way ではなく **no-base フォールバック**（[04 §4.5](./04-sync-engine.md) の `merge3NoBase`）になる:
  - **同 id**: recency で解決（`version` → 次点 `updatedAt` の大きい方を採用）。**フィールド単位競合や per-todo「同期できませんでした」は生じない**（黙って消えるのではなく、より新しい版を採る）。
  - **異 id**: 両立（無損失）。
- フィールド競合・per-todo 競合表示は、共通履歴を持つ**端末間同期**でのみ起きるもので、インポートには適用されない。
- 設定のインポートは端末ごと設定への適用。確認ダイアログを挟む。

## 13.3 関連する不変条件

- タスクの JSON エクスポート→インポートが**無損失で往復**する（同 id は recency 採用、異 id は両立）。インポートはマージエンジン経由（no-base 解決）で取り込む（受け入れ基準）。
- 設定は単独でエクスポート/インポート（適用）できる（受け入れ基準）。
- File System Access API 不使用。
