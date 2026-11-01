#!/bin/bash
# Counts characters, not bytes, so the card's right edge lines up.
export LC_ALL=C.UTF-8
shopt -s extglob
# Every fork costs 15-30 ms under Git Bash, so the script runs one jq and two git
# calls and does everything else in builtins. Helpers return through REPLY
# (printf -v) instead of $(...), which would fork a subshell per call.
# Colours, glyphs and formats follow the mods' DESIGN.md.

# One jq for every field. \x1f separates them: a tab is IFS whitespace, so read
# would collapse empty fields and shift the rest. -j drops the trailing newline,
# which jq.exe writes as CRLF and would leave a \r on the last field.
IFS=$'\x1f' read -r MODEL DIR PCT DURATION_MS TOK_IN TOK_OUT RATE_5H RATE_7D RESET_5H RESET_7D < <(
  # Anything not a number reads as 0 (num) or as absent (opt): bash arithmetic
  # on a null, a float or a date string would abort the script.
  jq -j 'def num: if type == "number" then floor else 0 end;
    def opt: if type == "number" then floor else "" end;
    [ (.model.display_name // ""), (.workspace.current_dir // ""),
      (.context_window.used_percentage | num),
      (.cost.total_duration_ms | num),
      (.context_window.total_input_tokens | num),
      (.context_window.total_output_tokens | num),
      (.rate_limits.five_hour.used_percentage | opt),
      (.rate_limits.seven_day.used_percentage | opt),
      (.rate_limits.five_hour.resets_at | opt),
      (.rate_limits.seven_day.resets_at | opt)
    ] | map(tostring) | join("\u001f")' 2>/dev/null)
# Empty or unreadable input leaves every field empty: draw zeros, not errors.
PCT=${PCT:-0} DURATION_MS=${DURATION_MS:-0} TOK_IN=${TOK_IN:-0} TOK_OUT=${TOK_OUT:-0} DIR=${DIR:-$PWD}

# Colour roles as ANSI. success, warning and error are the terminal's own green,
# yellow and red, and chrome its bright black, so the terminal's palette decides
# how they read on a light or dark background; the accent is Claude's orange,
# a mid tone that reads on both. NO_COLOR (https://no-color.org) drops them all.
# The meters keep a 256-colour heat ramp, green -> yellow -> orange -> red, one
# step per 10%, so a bar has ten states instead of three. GREY is "not used yet".
# STATUSLINE_THEME=light swaps in darker steps, each at least 3:1 on white, and
# a track that stays faint there; auto reads COLORFGBG ("0;15" is light) if set.
THEME=${STATUSLINE_THEME:-auto}
[ "$THEME" = auto ] && case ${COLORFGBG:-} in *';7' | *';15') THEME=light ;; esac
if [ "$THEME" = light ]; then RAMP=(22 28 64 100 136 130 166 202 160 124) GREY=248
else RAMP=(46 82 118 154 190 226 220 214 208 196) GREY=239; fi
if [ -n "${NO_COLOR:-}" ]; then
  ACCENT='' SUCCESS='' WARNING='' ERROR='' CHROME='' BOLD='' RESET='' TRACK=''
  HEAT=('' '' '' '' '' '' '' '' '' '')
else
  ACCENT=$'\033[38;2;217;119;87m' SUCCESS=$'\033[32m' WARNING=$'\033[33m' ERROR=$'\033[31m'
  CHROME=$'\033[90m' BOLD=$'\033[1m' RESET=$'\033[0m' TRACK=$'\033[38;5;'"${GREY}m"
  HEAT=(); for c in "${RAMP[@]}"; do HEAT+=($'\033[38;5;'"${c}m"); done
fi
# ↗ with U+FE0E, so no terminal draws it as a two-cell emoji.
EXTERNAL=$'\xe2\x86\x97\xef\xb8\x8e'
# The terminal's width, when the caller passes one; the card fits inside it.
MAX=0
[[ ${COLUMNS:-} =~ ^[0-9]+$ ]] && MAX=$COLUMNS
printf -v NOW '%(%s)T' -1

# epoch -> time left, its two largest units ("4h 51m", "3d 22h", "25m", "now").
countdown() {
  local left=$(( $1 - NOW ))
  if [ "$left" -le 0 ]; then REPLY='now'
  elif [ "$left" -ge 86400 ]; then printf -v REPLY '%dd %dh' $((left / 86400)) $((left % 86400 / 3600))
  elif [ "$left" -ge 3600 ]; then printf -v REPLY '%dh %02dm' $((left / 3600)) $((left % 3600 / 60))
  else printf -v REPLY '%dm' $(( left / 60 > 0 ? left / 60 : 1 )); fi
}
# epoch -> wall-clock reset ("14:32", or "Thu 09:15" when over a day out)
clock_at() {
  if [ $(( $1 - NOW )) -ge 86400 ]; then printf -v REPLY '%(%a %H:%M)T' "$1"; else printf -v REPLY '%(%H:%M)T' "$1"; fi
}
# ms -> duration ("1.4s", "42s", "2m 05s", "3h 12m", "3d 4h")
duration() {
  local s=$(( $1 / 1000 ))
  if [ "$1" -lt 9950 ]; then local t=$(( ($1 + 50) / 100 )); printf -v REPLY '%d.%ds' $((t / 10)) $((t % 10))
  elif [ "$s" -lt 60 ]; then REPLY="${s}s"
  elif [ "$s" -lt 3600 ]; then printf -v REPLY '%dm %02ds' $((s / 60)) $((s % 60))
  elif [ "$s" -lt 86400 ]; then printf -v REPLY '%dh %02dm' $((s / 3600)) $((s % 3600 / 60))
  else printf -v REPLY '%dd %dh' $((s / 86400)) $((s % 86400 / 3600)); fi
}
# pace <used_pct> <resets_at> <window_secs> -> burn rate vs. the clock, e.g. "1.4×".
# 1.0× = exactly on track to finish the window at 100%; >1 projects an overrun.
# Silent in the first 5% of a window, where the ratio is noise.
pace() {
  local left=$(( $2 - NOW )) elapsed tenths color=$CHROME
  elapsed=$(( $3 - left ))
  REPLY=''
  [ "$elapsed" -lt $(( $3 / 20 )) ] && return
  # used / (elapsed / window * 100), in tenths, rounded half up. Color the number
  # shown, not the unrounded one, so 1.0x never alarms.
  tenths=$(( ($1 * $3 * 10 + elapsed * 50) / (elapsed * 100) ))
  if [ "$tenths" -ge 15 ]; then color=$ERROR; elif [ "$tenths" -gt 10 ]; then color=$WARNING; fi
  printf -v REPLY '%s%d.%d×%s' "$color" $((tenths / 10)) $((tenths % 10)) "$RESET"
}
# heat <pct> -> the ramp colour for that level
heat() {
  local i=$(( $1 / 10 )); [ "$i" -gt 9 ] && i=9
  REPLY=${HEAT[i]}
}
# bar <pct> -> thin gradient bar: each lit cell carries its own heat, so the
# rightmost lit cell is the severity; the unlit track in GREY.
bar() {
  local filled=$(( $1 / 10 )) i out=""
  for ((i = 0; i < 10; i++)); do
    if [ "$i" -lt "$filled" ]; then out+="${HEAT[i]}━"
    else out+="${TRACK}─"; fi
  done
  REPLY="$out$RESET"
}
# 950 -> 950, 13700 -> 13.7k, 640000 -> 640k, 1500000 -> 1.5M
fmt_k() {
  local t
  if [ "$1" -ge 999950 ]; then t=$(( ($1 + 50000) / 100000 )); printf -v REPLY '%d.%dM' $((t / 10)) $((t % 10))
  elif [ "$1" -ge 99950 ]; then REPLY="$(( ($1 + 500) / 1000 ))k"
  elif [ "$1" -ge 1000 ]; then t=$(( ($1 + 50) / 100 )); printf -v REPLY '%d.%dk' $((t / 10)) $((t % 10))
  else REPLY=$1; fi
}
# width <text> -> cells on screen: colour codes, link wrappers and U+FE0E take none.
width() {
  local plain=${1//$'\033['*([0-9;])m/}
  plain=${plain//$'\033]8;;'*([!$'\007'])$'\007'/}
  plain=${plain//$'\xef\xb8\x8e'/}
  REPLY=${#plain}
}
# line <n> -> n box-drawing dashes
line() {
  printf -v REPLY '%*s' $(( $1 > 0 ? $1 : 0 )) ''
  REPLY=${REPLY// /─}
}

###### Header: model, folder, repo link, branch and working-tree summary

NAME="${DIR##*[/\\]}"
URI_PATH="${DIR//\\//}"   # backslashes -> forward slashes for the file URI
URI_PATH=${URI_PATH#/}     # "/home/x" and "C:/x" both follow file:/// once
SEP=" ${CHROME}·${RESET} "
printf -v H_MODEL '%s%s%s%s' "$ACCENT" "$BOLD" "$MODEL" "$RESET"
H_FOLDER=$NAME
# NO_COLOR means no escapes at all, so no links either (and no ↗ without one).
[ -z "${NO_COLOR:-}" ] && printf -v H_FOLDER '\033]8;;file:///%s\007%s\033]8;;\007' "${URI_PATH// /%20}" "$NAME"
H_LINK='' H_BRANCH='' H_DIFF=''
# Git's answers are cached 5 s per folder: the status line refreshes often and
# git costs two forks. The file holds the time, 1 for a repo (0 not), the remote,
# then the status lines. An unwritable temp dir only means no cache.
CACHE="${TMPDIR:-/tmp}/claude-statusline-${DIR//[^A-Za-z0-9]/_}"
C=()
[ -r "$CACHE" ] && mapfile -t C < "$CACHE" 2>/dev/null
if [[ ${C[0]:-} =~ ^[0-9]+$ ]] && (( NOW >= C[0] && NOW - C[0] < 5 )); then
  IS_REPO=${C[1]} REMOTE=${C[2]}; printf -v ST '%s\n' "${C[@]:3}"
else
  # -C: the session's folder, not wherever the status line was started.
  # --no-optional-locks: never take index.lock, which the git commands Claude runs
  # meanwhile would fail on.
  IS_REPO=0 REMOTE=''
  ST=$(git -C "$DIR" --no-optional-locks status --porcelain=v2 --branch 2>/dev/null) &&
    { IS_REPO=1; REMOTE=$(git -C "$DIR" remote get-url origin 2>/dev/null); }
  { printf '%s\n%s\n%s\n%s\n' "$NOW" "$IS_REPO" "$REMOTE" "$ST" > "$CACHE"; } 2>/dev/null
fi
if [ "$IS_REPO" = 1 ]; then
  REMOTE=${REMOTE%.git}
  # scp-style "git@host:owner/repo" -> "https://host/owner/repo"
  [[ $REMOTE =~ ^[^@/]+@([^:/]+):(.+)$ ]] && REMOTE="https://${BASH_REMATCH[1]}/${BASH_REMATCH[2]}"
  [ -n "$REMOTE" ] && [ -z "${NO_COLOR:-}" ] && printf -v H_LINK ' \033]8;;%s\007%s%s%s\033]8;;\007' "$REMOTE" "$CHROME" "$EXTERNAL" "$RESET"
  # working-tree summary: +added ~modified -deleted (zeros omitted)
  BRANCH='' OID='' ADD=0 MOD=0 DEL=0
  while IFS= read -r l; do
    case $l in
      '# branch.oid '*) OID=${l#'# branch.oid '} ;;
      '# branch.head (detached)') BRANCH="(${OID:0:7})" ;;  # oid comes first
      '# branch.head '*) BRANCH=${l#'# branch.head '} ;;
      '? '*) ADD=$((ADD + 1)) ;;
      [12u]' '*)  # "1 XY ...": X is the index status, Y the worktree status
        X=${l:2:1} Y=${l:3:1}
        [ "$X" = A ] && ADD=$((ADD + 1))
        [[ $X == M || $Y == M ]] && MOD=$((MOD + 1))
        [[ $X == D || $Y == D ]] && DEL=$((DEL + 1)) ;;
    esac
  done <<<"$ST"
  # The branch in plain text: colour is kept for its changes.
  H_BRANCH="${SEP}${BRANCH}"
  [ "$ADD" -gt 0 ] && H_DIFF+=" ${SUCCESS}+$ADD"; [ "$MOD" -gt 0 ] && H_DIFF+=" ${WARNING}~$MOD"; [ "$DEL" -gt 0 ] && H_DIFF+=" ${ERROR}-$DEL"
  [ -n "$H_DIFF" ] && H_DIFF+="$RESET"
fi
# Narrower, the link and the changes go first, then the branch, then the folder.
HEADS=(
  "$H_MODEL$SEP$H_FOLDER$H_LINK$H_BRANCH$H_DIFF"
  "$H_MODEL$SEP$H_FOLDER$H_BRANCH"
  "$H_MODEL$SEP$H_FOLDER"
  "$H_MODEL"
)

###### Rows: context, then the 5-hour and 7-day limits

# row <label> <pct> <detail> -> "lbl  bar  pct%   detail" with fixed columns.
# The percentage takes the heat of its own value, so 95% reads red.
row() {
  local b
  bar "$2"; b=$REPLY; heat "$2"
  printf -v REPLY '%s%-3s%s  %s  %s%3d%%%s%s' "$CHROME" "$1" "$RESET" "$b" "$REPLY" "$2" "$RESET" "${3:+   $3}"
}
# rate_row <label> <pct> <resets_at> <window_secs> <form> -> countdown, then in
# the full form the wall clock and pace. Countdown and clock are padded ("6d 22h",
# "Thu 12:52" are the longest) so the pace lands in the same column on every row.
rate_row() {
  local detail="" p cd
  if [ -n "$3" ] && [ "$5" != bare ]; then
    countdown "$3"; cd=$REPLY
    if [ "$5" = full ]; then
      pace "$2" "$3" "$4"; p=$REPLY
      clock_at "$3"
      printf -v detail '%s↻ %-7s  %-9s%s  %s' "$CHROME" "$cd" "$REPLY" "$RESET" "$p"
    else
      printf -v detail '%s↻ %s%s' "$CHROME" "$cd" "$RESET"
    fi
  fi
  row "$1" "$2" "$detail"
}

fmt_k "$TOK_IN"; IN=$REPLY; fmt_k "$TOK_OUT"; OUT=$REPLY
duration "$DURATION_MS"; DUR=$REPLY
# rows <form> -> ROWS for the full, compact (no clock, pace or tokens) or bare
# (bar and percentage only) form.
rows() {
  local detail=''
  # Two spaces stand where the rate rows draw "↻ ", so the columns line up.
  if [ "$1" = full ]; then
    printf -v detail '  %s%-7s%s  %s↑%s %s %s↓%s %s' "$CHROME" "$DUR" "$RESET" "$CHROME" "$RESET" "$IN" "$CHROME" "$RESET" "$OUT"
  elif [ "$1" = compact ]; then
    printf -v detail '  %s%s%s' "$CHROME" "$DUR" "$RESET"
  fi
  row ctx "$PCT" "$detail"; ROWS=("$REPLY")
  [ -n "$RATE_5H" ] && { rate_row 5h "$RATE_5H" "$RESET_5H" 18000 "$1"; ROWS+=("$REPLY"); }
  [ -n "$RATE_7D" ] && { rate_row 7d "$RATE_7D" "$RESET_7D" 604800 "$1"; ROWS+=("$REPLY"); }
}

###### Card: as wide as its widest row, the header set into the top edge, and
###### within COLUMNS when the caller gives it

# widest -> the widest row's cells
widest() {
  local r w=0
  for r in "${ROWS[@]}"; do width "$r"; [ "$REPLY" -gt "$w" ] && w=$REPLY; done
  REPLY=$w
}
for FORM in full compact bare; do
  rows "$FORM"; widest; ROWS_W=$REPLY
  [ "$MAX" -eq 0 ] || [ $(( ROWS_W + 4 )) -le "$MAX" ] && break
done
for HEAD in "${HEADS[@]}"; do
  width "$HEAD"; HEAD_W=$REPLY
  # The card grows for the header only within the width it has.
  [ "$MAX" -eq 0 ] || [ $(( (HEAD_W + 2 > ROWS_W ? HEAD_W + 2 : ROWS_W) + 4 )) -le "$MAX" ] && break
done
INNER=$(( HEAD_W + 2 > ROWS_W ? HEAD_W + 2 : ROWS_W ))

# Too narrow for any card: the model and the context percentage on one line,
# the model cut to fit.
if [ "$MAX" -gt 0 ] && [ $(( INNER + 4 )) -gt "$MAX" ]; then
  heat "$PCT"; printf -v P '%s%d%%%s' "$REPLY" "$PCT" "$RESET"; width "$P"
  M=$(( MAX - REPLY - 1 ))
  if [ "$M" -gt 0 ] && [ -n "$MODEL" ]; then printf '%s%s%s %s\n' "$ACCENT" "${MODEL:0:M}" "$RESET" "$P"; else printf '%s\n' "$P"; fi
  exit 0
fi
line $(( INNER - HEAD_W - 1 ))
printf '%s╭─%s %s %s%s╮%s\n' "$CHROME" "$RESET" "$HEAD" "$CHROME" "$REPLY" "$RESET"
for r in "${ROWS[@]}"; do
  width "$r"
  printf '%s│%s %s%*s %s│%s\n' "$CHROME" "$RESET" "$r" $(( INNER - REPLY )) '' "$CHROME" "$RESET"
done
line $(( INNER + 2 ))
printf '%s╰%s╯%s\n' "$CHROME" "$REPLY" "$RESET"
exit 0
