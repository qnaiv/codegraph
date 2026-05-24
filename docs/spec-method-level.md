# 仕様書: メソッドレベル展開

## 概要

クラスノードをダブルクリックすると、そのクラスが保持するメソッドをサブノードとして展開表示する。
メソッドノードには SOQL/DML エッジが接続され、SObject との関係をメソッド単位で把握できる。

---

## 1. インタラクション

### 1-1. 展開

- クラスノードを**ダブルクリック**する
- クラスノードの下にメソッドノード群が展開される
- クラスノード → メソッドノードの `has-method` エッジが描画される
- メソッドノード → SObject ノードの SOQL/DML エッジが描画される（既存データを流用）

### 1-2. 折りたたみ

- 展開中のクラスノードを再度ダブルクリックする
- メソッドノードとその関連エッジが非表示になる
- クラスノードは元の状態に戻る

### 1-3. フォーカスモードとの組み合わせ

- フォーカスモード中にクラスを展開した場合、メソッドノードもフォーカス対象ノードとして扱う
- メソッドノードをクリックするとそのメソッドを起点にフォーカスモードへ移行する
- `+N more` バッジの計算にメソッドノードも含める

---

## 2. メソッドノードの表示

```
┌─────────────────────────────┐
│ ⚡ getActiveAccounts         │  ← アノテーションアイコン + メソッド名
│ static · public · List<...> │  ← 修飾子 + 戻り値型
│ [1 SOQL] [0 DML]            │  ← SOQL/DML バッジ
└─────────────────────────────┘
```

- 背景色: 親クラスより暗い色（例: `#111d2e`）
- ボーダー: 親クラスと同系色・細め（`1px`）
- 幅: 親クラスノードより小さめ（`140px` 目安）

---

## 3. 新しいエッジ種別

| EdgeKind | 用途 | スタイル |
|---|---|---|
| `has-method` | クラス → メソッド | 薄いグレー実線、ラベルなし |

既存の `soql-references` / `dml-insert` / `dml-update` / `dml-delete` エッジはメソッドノードを source として使う（クラスノードとの重複は除去する）。

---

## 4. 内部状態モデル

### 4-1. ストア追加フィールド

```typescript
expandedClassIds: Set<string>;   // 展開中のクラスID集合
```

### 4-2. アクション

```typescript
toggleClassExpansion(classId: string): void;
```

### 4-3. ノード・エッジの合成ロジック（Canvas）

`expandedClassIds` に含まれるクラスに対して:
1. `classNode.methods` から `ApexMethodNode` リストを取得
2. 各メソッドを `method:ClassName.methodName` IDのノードとして追加
3. `cls:ClassName → method:ClassName.methodName` の `has-method` エッジを追加
4. 各メソッドの `soqlQueries` / `dmlOperations` から SObject エッジを追加
   - 既にクラスレベルで `soql-references` / `dml-*` エッジが存在する場合は、メソッド展開時にクラスレベルエッジを非表示にする（重複除去）

---

## 5. 変更対象ファイル

| ファイル | 変更内容 |
|---|---|
| `src/shared/types.ts` | `EdgeKind` に `has-method` を追加 |
| `src/webview/store/graphStore.ts` | `expandedClassIds`・`toggleClassExpansion` を追加 |
| `src/webview/components/canvas/CodeGraphCanvas.tsx` | 展開クラスのメソッドノード・エッジを合成するロジックを追加 |
| `src/webview/components/nodes/ApexMethodNode.tsx` | 新規: メソッドノードコンポーネント |
| `src/webview/components/edges/CodeGraphEdge.tsx` | `has-method` エッジスタイルを追加 |
| `src/webview/components/nodes/ApexClassNode.tsx` | 展開中の視覚的フィードバック（ヘッダー強調など）|

---

## 6. レイアウト

- メソッドノードは親クラスノードの直下に縦並びで配置する
- 初期位置: `{ x: classNode.x + offset, y: classNode.y + 120 + i * 60 }`
- ユーザーがドラッグで移動可能（`layoutState` に保存）
- 折りたたみ時に位置をリセット（次回展開時は再計算）

---

## 7. 実装フェーズ

### Phase A-1: メソッドノードの展開・折りたたみ
- `expandedClassIds` ストア追加
- `toggleClassExpansion` アクション
- Canvas でのメソッドノード・`has-method` エッジ合成
- `ApexMethodNode.tsx` コンポーネント新規作成
- ダブルクリックで展開/折りたたみ

### Phase A-2: メソッド → SObject エッジ
- 展開時にメソッドレベルの SOQL/DML エッジを描画
- クラスレベルの重複エッジを非表示化

### Phase A-3: フォーカスモードとの統合
- フォーカスモードの BFS にメソッドノードを含める
- メソッドノードクリックでフォーカス移行

---

## 8. 完了条件

- [ ] クラスノードをダブルクリックするとメソッドノードが展開される
- [ ] 再度ダブルクリックで折りたたまれる
- [ ] メソッドノードに名前・修飾子・アノテーション・SOQL/DML 数が表示される
- [ ] メソッド展開時に SOQL/DML → SObject エッジが描画される
- [ ] フォーカスモードでメソッドノードが対象に含まれる
- [ ] `npm run check` が全てグリーン
