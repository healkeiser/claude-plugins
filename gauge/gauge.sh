#!/bin/bash
# Counts characters, not bytes, so the card's right edge lines up.
export LC_ALL=C.UTF-8
shopt -s extglob
# Every fork costs 15-30 ms under Git Bash, so the script runs one jq and two git
# calls and does everything else in builtins. Helpers return through REPLY
# (printf -v) instead of $(...), which would fork a subshell per call.

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

GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RED=$'\033[31m'; RESET=$'\033[0m'; BOLD=$'\033[1m'
ACCENT=$'\033[38;2;217;119;87m'   # Claude orange, as in the mods
DIM=$'\033[38;5;245m'             # labels and secondary text
EDGE=$'\033[38;5;240m'            # card border
# 256-color heat ramp, green -> yellow -> orange -> red: one step per 10% so the
# bar has ten states instead of three. GREY is "not used yet", not chrome.
RAMP=(46 82 118 154 190 226 220 214 208 196); GREY=$'\033[38;5;239m'
printf -v NOW '%(%s)T' -1

# epoch -> countdown ("2h 13m", "3d 4h", "now"). ASCII only, so printf can pad it.
countdown() {
  local left=$(( $1 - NOW ))
  if [ "$left" -le 0 ]; then REPLY='now'
  elif [ "$left" -ge 86400 ]; then printf -v REPLY '%dd %dh' $((left / 86400)) $((left % 86400 / 3600))
  elif [ "$left" -ge 3600 ]; then printf -v REPLY '%dh %02dm' $((left / 3600)) $((left % 3600 / 60))
  else printf -v REPLY '%dm' $((left / 60)); fi
}
# epoch -> wall-clock reset ("14:32", or "Thu 09:15" when over a day out)
clock_at() {
  if [ $(( $1 - NOW )) -ge 86400 ]; then printf -v REPLY '%(%a %H:%M)T' "$1"; else printf -v REPLY '%(%H:%M)T' "$1"; fi
}
# pace <used_pct> <resets_at> <window_secs> -> burn rate vs. the clock, e.g. "1.4×".
# 1.0× = exactly on track to finish the window at 100%; >1 projects an overrun.
# Silent in the first 5% of a window, where the ratio is noise.
pace() {
  local left=$(( $2 - NOW )) elapsed tenths color=$DIM
  elapsed=$(( $3 - left ))
  REPLY=''
  [ "$elapsed" -lt $(( $3 / 20 )) ] && return
  # used / (elapsed / window * 100), in tenths, rounded half up. Color the number
  # shown, not the unrounded one, so 1.0x never alarms.
  tenths=$(( ($1 * $3 * 10 + elapsed * 50) / (elapsed * 100) ))
  if [ "$tenths" -ge 15 ]; then color=$RED; elif [ "$tenths" -gt 10 ]; then color=$YELLOW; fi
  printf -v REPLY '%s%d.%d×%s' "$color" $((tenths / 10)) $((tenths % 10)) "$RESET"
}
# heat <pct> -> the ramp color for that level
heat() {
  local i=$(( $1 / 10 )); [ "$i" -gt 9 ] && i=9
  printf -v REPLY '\033[38;5;%sm' "${RAMP[i]}"
}
# bar <pct> -> thin gradient bar: each lit cell carries its own heat, so the
# rightmost lit cell is the severity.
bar() {
  local filled=$(( $1 / 10 )) i out=""
  for ((i = 0; i < 10; i++)); do
    if [ "$i" -lt "$filled" ]; then out+=$'\033[38;5;'"${RAMP[i]}"'m━'
    else out+="${GREY}─"; fi
  done
  REPLY="$out$RESET"
}
# 13700 -> 13.7k, 39 -> 39, 1500000 -> 1.5M
fmt_k() {
  local t
  if [ "$1" -ge 1000000 ]; then t=$(( ($1 + 50000) / 100000 )); printf -v REPLY '%d.%dM' $((t / 10)) $((t % 10))
  elif [ "$1" -ge 1000 ]; then t=$(( ($1 + 50) / 100 )); printf -v REPLY '%d.%dk' $((t / 10)) $((t % 10))
  else REPLY=$1; fi
}
# width <text> -> cells on screen: colour codes and link wrappers take none.
width() {
  local plain=${1//$'\033['*([0-9;])m/}
  plain=${plain//$'\033]8;;'*([!$'\007'])$'\007'/}
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
printf -v HEAD '%s%s%s%s %s·%s \033]8;;file:///%s\007%s\033]8;;\007' \
  "$ACCENT" "$BOLD" "$MODEL" "$RESET" "$DIM" "$RESET" "${URI_PATH// /%20}" "$NAME"
# -C: the session's folder, not wherever the status line was started.
# --no-optional-locks: never take index.lock, which the git commands Claude runs
# meanwhile would fail on.
if ST=$(git -C "$DIR" --no-optional-locks status --porcelain=v2 --branch 2>/dev/null); then
  REMOTE=$(git -C "$DIR" remote get-url origin 2>/dev/null)
  REMOTE=${REMOTE%.git}
  # scp-style "git@host:owner/repo" -> "https://host/owner/repo"
  [[ $REMOTE =~ ^[^@/]+@([^:/]+):(.+)$ ]] && REMOTE="https://${BASH_REMATCH[1]}/${BASH_REMATCH[2]}"
  [ -n "$REMOTE" ] && printf -v HEAD '%s \033]8;;%s\007%s↗%s\033]8;;\007' "$HEAD" "$REMOTE" "$DIM" "$RESET"
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
  HEAD+=" ${DIM}·${RESET} ${GREEN}${BRANCH}${RESET}"
  DIFF=""
  [ "$ADD" -gt 0 ] && DIFF+=" ${GREEN}+$ADD"; [ "$MOD" -gt 0 ] && DIFF+=" ${YELLOW}~$MOD"; [ "$DEL" -gt 0 ] && DIFF+=" ${RED}-$DEL"
  [ -n "$DIFF" ] && HEAD+="${DIFF}${RESET}"
fi

###### Rows: context, then the 5-hour and 7-day limits

# row <label> <pct> <detail> -> "lbl  bar  pct%   detail" with fixed columns.
# The percentage takes the heat of the decile it is *in*, one step past the last
# lit cell, so 95% reads red, not orange.
row() {
  local b
  bar "$2"; b=$REPLY; heat "$2"
  printf -v REPLY '%s%-3s%s  %s  %s%3d%%%s   %s' "$DIM" "$1" "$RESET" "$b" "$REPLY" "$2" "$RESET" "$3"
}
# rate_row <label> <pct> <resets_at> <window_secs> -> countdown, wall clock, pace.
# Countdown and clock are padded ("6d 22h", "Thu 12:52" are the longest) so the
# pace lands in the same column on every row.
rate_row() {
  local detail="" p cd
  if [ -n "$3" ]; then
    pace "$2" "$3" "$4"; p=$REPLY
    countdown "$3"; cd=$REPLY
    clock_at "$3"
    printf -v detail '%s↻ %-7s  %-9s%s  %s' "$DIM" "$cd" "$REPLY" "$RESET" "$p"
  fi
  row "$1" "$2" "$detail"
}

MINS=$((DURATION_MS / 60000)); SECS=$(((DURATION_MS % 60000) / 1000))
fmt_k "$TOK_IN"; IN=$REPLY; fmt_k "$TOK_OUT"; OUT=$REPLY
printf -v DUR '%dm %02ds' "$MINS" "$SECS"
# Two spaces stand where the rate rows draw "↻ ", so the columns line up.
printf -v CTX_DETAIL '%s  %-7s%s  %s↑ %s%s %s↓ %s%s' "$DIM" "$DUR" "$RESET" \
  "$GREEN" "$IN" "$RESET" "$YELLOW" "$OUT" "$RESET"
row ctx "$PCT" "$CTX_DETAIL"; ROWS=("$REPLY")
[ -n "$RATE_5H" ] && { rate_row 5h "$RATE_5H" "$RESET_5H" 18000; ROWS+=("$REPLY"); }
[ -n "$RATE_7D" ] && { rate_row 7d "$RATE_7D" "$RESET_7D" 604800; ROWS+=("$REPLY"); }

###### Card: as wide as its widest row, the header set into the top edge

width "$HEAD"; HEAD_W=$REPLY
INNER=$(( HEAD_W + 2 ))
for r in "${ROWS[@]}"; do width "$r"; [ "$REPLY" -gt "$INNER" ] && INNER=$REPLY; done

line $(( INNER - HEAD_W - 1 ))
printf '%s╭─%s %s %s%s╮%s\n' "$EDGE" "$RESET" "$HEAD" "$EDGE" "$REPLY" "$RESET"
for r in "${ROWS[@]}"; do
  width "$r"
  printf '%s│%s %s%*s %s│%s\n' "$EDGE" "$RESET" "$r" $(( INNER - REPLY )) '' "$EDGE" "$RESET"
done
line $(( INNER + 2 ))
printf '%s╰%s╯%s\n' "$EDGE" "$REPLY" "$RESET"
exit 0
