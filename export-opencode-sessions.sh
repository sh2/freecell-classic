#!/usr/bin/env bash
# export-opencode-sessions.sh — カレントプロジェクトの全セッションを export して zip 化
set -uo pipefail

command -v jq  >/dev/null || { echo "jq が必要です"; exit 1; }
command -v zip >/dev/null || { echo "zip が必要です"; exit 1; }

project="$(basename "$PWD")"
stamp="$(date +%Y%m%d-%H%M%S)"
outdir="${project}-opencode-export-${stamp}"
mkdir -p "$outdir"

# 1) セッション一覧（IDの対応表として zip にも同梱）
opencode session list --format json > "$outdir/session-list.json"

# ID一覧を取り出す（配列形式を想定、取れなければ .sessions にも対応）
mapfile -t ids < <(jq -r '
  if type == "array" then .[].id
  elif .sessions then .sessions[].id
  else empty end
' "$outdir/session-list.json")

if [ "${#ids[@]}" -eq 0 ]; then
  echo "セッションIDが取れませんでした。session-list.json の中身を確認してください"
  exit 1
fi
echo "対象セッション: ${#ids[@]} 件"

# 見出し代わりの manifest（id / title / 更新日時）
jq -r '
  (if type == "array" then . else .sessions end)[]
  | [.id, (.title // ""), ((.time.updated // .updated // "") | tostring)]
  | @tsv
' "$outdir/session-list.json" > "$outdir/manifest.tsv" || true

# 2) 1件ずつ export（失敗しても止めずに続行し、最後に集計）
ok=0; fail=0
for id in "${ids[@]}"; do
  echo "==> $id"
  if opencode export "$id" > "$outdir/${id}.json" 2> "$outdir/${id}.err" \
     && [ -s "$outdir/${id}.json" ] \
     && jq empty "$outdir/${id}.json" 2>/dev/null; then
    ok=$((ok + 1))
    rm -f "$outdir/${id}.err"
  else
    fail=$((fail + 1))
    echo "    失敗（${id}.err と出力を見てください）"
  fi
done

# 3) zip に固める
zip -r "${outdir}.zip" "$outdir" >/dev/null
echo "完了: 成功 ${ok} 件 / 失敗 ${fail} 件"
ls -lh "${outdir}.zip"

