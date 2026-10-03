#!/usr/bin/env bash
# ============================================================================
# IT Asset Manager - Linux Hardware Scanner
# Reads hardware specifications and sends them to the IT Asset Server
# for approval-queue split (PC + individual connected monitors).
#
# Usage:
#   chmod +x asset-scanner.sh && ./asset-scanner.sh
#   ./asset-scanner.sh --name "Employee Name"
#   ./asset-scanner.sh --server http://192.168.10.194:3000
#   ./asset-scanner.sh --dry-run        # print JSON payload only (no send)
#
# Env overrides: IAM_SERVER, IAM_KEY, IAM_USER
# ============================================================================

SERVER_URL="${IAM_SERVER:-http://192.168.10.194:3000}"
SERVER_KEY="${IAM_KEY:-SET-AUTOMATICALLY-ON-DOWNLOAD}"
FALLBACK_URL="http://127.0.0.1:3000"
DRY_RUN=0
PARAM_NAME=""

usage() {
  cat <<'EOF'
IT Asset Manager - Linux Hardware Scanner
Usage: asset-scanner.sh [options]
  -n, --name <name>    Employee / full name (skips interactive prompt)
  -s, --server <url>   IT Asset server URL (default: http://192.168.10.194:3000)
  -k, --key <key>      Server key (X-IAM-Key header)
      --dry-run        Build and print JSON payload without sending it
  -h, --help           Show this help
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    -n|--name)   PARAM_NAME="${2-}"; shift 2 ;;
    -s|--server) SERVER_URL="${2-}"; shift 2 ;;
    -k|--key)    SERVER_KEY="${2-}"; shift 2 ;;
    --dry-run)   DRY_RUN=1; shift ;;
    -h|--help)   usage; exit 0 ;;
    *) echo "[ERROR] Unknown option: $1"; usage; exit 1 ;;
  esac
done

# Colors (only when attached to a terminal)
if [ -t 1 ]; then
  C_RED=$'\e[31m'; C_GREEN=$'\e[32m'; C_YELLOW=$'\e[33m'
  C_CYAN=$'\e[36m'; C_BOLD=$'\e[1m'; C_OFF=$'\e[0m'
else
  C_RED=''; C_GREEN=''; C_YELLOW=''; C_CYAN=''; C_BOLD=''; C_OFF=''
fi

step() { echo "${C_CYAN}$*${C_OFF}"; }
ok()   { echo "${C_GREEN}$*${C_OFF}"; }
warn() { echo "${C_YELLOW}$*${C_OFF}"; }
err()  { echo "${C_RED}$*${C_OFF}" >&2; }

echo "========================================================="
echo "  IT Asset Master - Hardware Scanner (Linux)"
echo "  Reading hardware specifications..."
echo "========================================================="
echo

# ----------------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------------
trim_str() { printf '%s' "$1" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'; }

# Reject placeholder / junk DMI values
is_junk() {
  local v
  v=$(trim_str "$1")
  case "$v" in
    ""|"To be filled by O.E.M."|"To Be Filled By O.E.M."|"Default string"|"Default String"| \
    "System Serial Number"|"System Product Name"|"System Manufacturer"|"Not Specified"|"INVALID"|"Invalid"|"None"|"N/A"|"n/a"|"0")
      return 0 ;;
    *) return 1 ;;
  esac
}

# Join stdin lines with " / " (same format the Windows scanner sends)
join_slash() {
  awk 'NF { if (seen) printf " / "; printf "%s", $0; seen = 1 } END { if (seen) printf "\n" }'
}

read_file() { # read_file <path> -> trimmed content ("" if unreadable)
  [ -r "$1" ] || return 0
  trim_str "$(sed 's/[[:space:]]\{1,\}/ /g' < "$1" 2>/dev/null)"
}

# Extract monitor name (EDID descriptor 0xFC) from a hex string on stdin
edid_name_from_hex() {
  awk '
    function hex2dec(h,   i, c, d, v) {
      v = 0; h = tolower(h)
      for (i = 1; i <= length(h); i++) {
        c = substr(h, i, 1); d = index("0123456789abcdef", c) - 1
        if (d < 0) return -1
        v = v * 16 + d
      }
      return v
    }
    {
      s = $0; gsub(/[ \t\r\n]/, "", s)
      if (length(s) < 144) next   # need bytes up to 72 to read first descriptor
      # Descriptor blocks at byte offsets 54, 72, 90, 108 (18 bytes each)
      for (off = 54; off <= 108; off += 18) {
        if (hex2dec(substr(s, (off + 3) * 2 + 1, 2)) == 252) {  # 0xFC = monitor name
          t = ""
          for (b = off + 5; b <= off + 17; b++) {
            c = hex2dec(substr(s, b * 2 + 1, 2))
            if (c == 0 || c == 10) break
            if (c >= 32 && c < 127) t = t sprintf("%c", c)
          }
          gsub(/^[ ]+|[ ]+$/, "", t)
          if (length(t) >= 2) { print t; exit }
        }
      }
    }'
}

edid_name_from_file() { # $1 = path to EDID binary file
  od -An -v -tx1 "$1" 2>/dev/null | tr -d ' \n' | edid_name_from_hex
}

# ----------------------------------------------------------------------------
# [0/4] Employee name
# ----------------------------------------------------------------------------
USER_NAME="${IAM_USER:-${USER:-$(whoami 2>/dev/null || echo unknown)}}"
if [ -n "$PARAM_NAME" ]; then
  USER_NAME="$PARAM_NAME"
elif [ -z "${IAM_USER:-}" ]; then
  if [ -n "${DISPLAY:-}" ] || [ -n "${WAYLAND_DISPLAY:-}" ]; then
    if command -v zenity >/dev/null 2>&1; then
      _out=$(zenity --entry --title="IT Asset Inventory" \
        --text="Please enter your full name / employee name:" \
        --entry-text="$USER_NAME" 2>/dev/null)
      [ -n "$_out" ] && USER_NAME="$_out"
    elif command -v kdialog >/dev/null 2>&1; then
      _out=$(kdialog --title "IT Asset Inventory" \
        --inputbox "Please enter your full name / employee name:" "$USER_NAME" 2>/dev/null)
      [ -n "$_out" ] && USER_NAME="$_out"
    fi
  elif [ -t 0 ]; then
    printf 'Please enter your full name / employee name [%s]: ' "$USER_NAME"
    if read -r -t 30 _in && [ -n "$_in" ]; then USER_NAME="$_in"; fi
  fi
fi

# ----------------------------------------------------------------------------
# [1/4] System & Motherboard
# ----------------------------------------------------------------------------
COMP=$(hostname -s 2>/dev/null || hostname 2>/dev/null || echo "linux-host")
step "[1/5] Scanning System & Motherboard for $COMP ($USER_NAME)..."

# Model (DMI: vendor + product, without repeating brand like "HP HP ...")
DMI_VENDOR=$(read_file /sys/class/dmi/id/sys_vendor)
DMI_PRODUCT=$(read_file /sys/class/dmi/id/product_name)

MODEL=""
if ! is_junk "$DMI_PRODUCT"; then
  if ! is_junk "$DMI_VENDOR"; then
    _p=$(printf '%s' "$DMI_PRODUCT" | tr '[:upper:]' '[:lower:]')
    _v=$(printf '%s' "$DMI_VENDOR" | tr '[:upper:]' '[:lower:]')
    case "$_p" in
      "$_v"*) MODEL="$DMI_PRODUCT" ;;
      *)       MODEL="$DMI_VENDOR $DMI_PRODUCT" ;;
    esac
  else
    MODEL="$DMI_PRODUCT"
  fi
fi
[ -z "$MODEL" ] && MODEL="$COMP System"

# Serial number
SERIAL=""
for f in /sys/class/dmi/id/product_serial /sys/class/dmi/id/chassis_serial; do
  _v=$(read_file "$f")
  if ! is_junk "$_v"; then SERIAL="$_v"; break; fi
done
[ -z "$SERIAL" ] && SERIAL="Unknown"

# OS version
OS=$(grep -m1 '^PRETTY_NAME=' /etc/os-release 2>/dev/null | cut -d= -f2- | sed 's/^"//;s/"$//')
if [ -z "$OS" ]; then
  _os_name=$(grep -m1 '^NAME=' /etc/os-release 2>/dev/null | cut -d= -f2- | sed 's/^"//;s/"$//')
  _os_ver=$(grep -m1 '^VERSION_ID=' /etc/os-release 2>/dev/null | cut -d= -f2- | sed 's/^"//;s/"$//')
  OS=$(trim_str "$_os_name $_os_ver")
fi
[ -z "$OS" ] && OS=$(uname -sr)

# IP address (IPv4, excluding loopback & link-local)
IP=$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -v '^$' | grep -Ev '^(127\.|169\.254\.)' | join_slash)
if [ -z "$IP" ] && command -v ip >/dev/null 2>&1; then
  IP=$(ip -4 -o addr show scope global 2>/dev/null | awk '{ split($4, a, "/"); print a[1] }' | join_slash)
fi
[ -z "$IP" ] && IP="127.0.0.1"

# ----------------------------------------------------------------------------
# [2/4] CPU, RAM & Disks
# ----------------------------------------------------------------------------
step "[2/5] Scanning CPU, RAM & Disks..."

# CPU
CPU=""
if command -v lscpu >/dev/null 2>&1; then
  CPU=$(LC_ALL=C lscpu 2>/dev/null | awk -F: '/Model name:/{ sub(/^[ \t]+/, "", $2); print $2; exit }')
  [ -z "$CPU" ] && CPU=$(LC_ALL=C lscpu 2>/dev/null | awk -F: '/^Model:|^[ \t]*Hardware:/{ sub(/^[ \t]+/, "", $2); print $2; exit }')
fi
[ -z "$CPU" ] && CPU=$(awk -F': *' '/^model name/{ print $2; exit }' /proc/cpuinfo 2>/dev/null)
[ -z "$CPU" ] && CPU=$(awk -F': *' '/^(Processor|Hardware|model)/{ print $2; exit }' /proc/cpuinfo 2>/dev/null)
if [ -n "$CPU" ]; then
  CORES=$(grep -c '^processor' /proc/cpuinfo 2>/dev/null || echo 1)
  CPU="$CPU ($CORES Threads)"
else
  CPU="Standard CPU"
fi

# RAM
RAM=""
MEM_KB=$(awk '/^MemTotal:/{ print $2; exit }' /proc/meminfo 2>/dev/null)
if [ -n "$MEM_KB" ] && [ "$MEM_KB" -gt 0 ] 2>/dev/null; then
  RAM=$(awk -v k="$MEM_KB" 'BEGIN { g = int((k / 1048576) + 0.5); if (g < 1) g = 1; printf "%d GB", g }')
fi
[ -z "$RAM" ] && RAM="8 GB (Standard)"

# Physical disks
# USB sticks / card readers (e.g. the USB scanner kit itself) are not part of the computer
is_external_disk() { # /sys/block/<dev>
  [ "$(cat "$1/removable" 2>/dev/null)" = "1" ] && return 0
  case "$(readlink -f "$1" 2>/dev/null)" in */usb*) return 0 ;; esac
  return 1
}

STORAGE=""
for dev in /sys/block/*; do
  [ -e "$dev" ] || continue
  name=$(basename "$dev")
  case "$name" in
    loop*|ram*|zram*|fd*|sr*|md*|dm-*|nbd*|zram*) continue ;;
    sd*|hd*|vd*|xvd*|nvme*|mmcblk*) ;;
    *) continue ;;
  esac
  is_external_disk "$dev" && continue
  model=$(read_file "$dev/device/model")
  [ -z "$model" ] && model=$(read_file "$dev/device/name")
  [ -z "$model" ] && model="$name"
  sectors=$(cat "$dev/size" 2>/dev/null || echo 0)
  gb=$(( sectors / 2 / 1024 / 1024 ))
  [ "$gb" -lt 1 ] && gb=1
  item="$model (${gb}GB)"
  if [ -z "$STORAGE" ]; then STORAGE="$item"; else STORAGE="$STORAGE / $item"; fi
done
if [ -z "$STORAGE" ] && command -v lsblk >/dev/null 2>&1; then
  # KEY="value" pairs, because TRAN is empty for NVMe and would shift plain columns; skip USB / removable
  STORAGE=$(LC_ALL=C lsblk -dnbP -o SIZE,RM,TRAN,MODEL 2>/dev/null \
    | awk '{ s=$0; size=s; sub(/.*SIZE="/,"",size); sub(/".*/,"",size); rm=s; sub(/.*RM="/,"",rm); sub(/".*/,"",rm);
             tr=s; sub(/.*TRAN="/,"",tr); sub(/".*/,"",tr); md=s; sub(/.*MODEL="/,"",md); sub(/".*/,"",md);
             if (rm!="1" && tr!="usb" && md!="") print size, md }' | awk 'NF>1 { gb=int($1/1073741824); if(gb<1) gb=1; $1=""; sub(/^ /,""); printf "%s (%dGB)\n", $0, gb }' | join_slash)
fi
[ -z "$STORAGE" ] && STORAGE="Internal Storage"

# Root disk free space (Linux counterpart of Windows C: space)
CSpace=""
DF_LINE=$(df -Pk / 2>/dev/null | awk 'NR==2 { print $2, $4 }')
if [ -n "$DF_LINE" ]; then
  CSpace=$(echo "$DF_LINE" | awk '{ printf "%d GB free of %d GB", $2/1048576, $1/1048576 }')
fi
[ -z "$CSpace" ] && CSpace="Unknown"

# GPU
GPU=""
if command -v lspci >/dev/null 2>&1; then
  GPU=$(LC_ALL=C lspci 2>/dev/null \
    | grep -iE 'vga compatible|3d controller|display controller' \
    | sed 's/^[0-9a-fA-F:.]\{1,\} [^:]*: //; s/[[:space:]]*(rev [0-9a-fx]\{1,\})[[:space:]]*$//' \
    | join_slash)
fi
[ -z "$GPU" ] && GPU="Standard Graphics"

# ----------------------------------------------------------------------------
# [3/4] Connected Monitors (EDID based -> auto-split into assets by server)
# ----------------------------------------------------------------------------
step "[3/5] Scanning Connected Monitors..."

MONITORS=""
# Tier 1: DRM sysfs EDID (works on X11, Wayland and headless sessions)
for edid_path in /sys/class/drm/card*-*/edid; do
  [ -e "$edid_path" ] || continue
  conn_dir=$(dirname "$edid_path")
  conn=$(basename "$conn_dir")

  # Skip internal laptop panels (part of the laptop, not a separate asset)
  case "$conn" in *eDP*|*LVDS*|*DSI*|*Writeback*) continue ;; esac

  status=$(cat "$conn_dir/status" 2>/dev/null)
  [ "$status" = "connected" ] || continue
  [ -s "$edid_path" ] || continue

  mon_name=$(edid_name_from_file "$edid_path")
  if [ -z "$mon_name" ]; then
    mon_name=$(LC_ALL=C sed -n 's/^ *(Monitor Name not specified)*/ /p' /dev/null)  # keep empty
  fi
  [ -z "$mon_name" ] && mon_name="$conn"

  if [ -z "$MONITORS" ]; then MONITORS="$mon_name"; else MONITORS="$MONITORS / $mon_name"; fi
done

# Tier 2: X11 xrandr EDID blobs
if [ -z "$MONITORS" ] && command -v xrandr >/dev/null 2>&1; then
  _xrandr_hex=$(LC_ALL=C xrandr --props 2>/dev/null | awk '
    /^[^[:space:]]+ (connected|disconnected)/ { conn = $1; state = $2; next }
    state == "connected" && /^EDID:/ { collecting = 1; hex = ""; next }
    collecting && /^[ \t]+[0-9a-fA-F][0-9a-fA-F]/ { line = $0; gsub(/[ \t]/, "", line); hex = hex line; next }
    collecting { if (length(hex) > 0) print conn "\t" hex; collecting = 0 }
    END { if (collecting && length(hex) > 0) print conn "\t" hex }
  ')
  while IFS=$'\t' read -r conn hex; do
    [ -z "$hex" ] && continue
    mon_name=$(printf '%s' "$hex" | edid_name_from_hex)
    [ -z "$mon_name" ] && mon_name="$conn"
    if [ -z "$MONITORS" ]; then MONITORS="$mon_name"; else MONITORS="$MONITORS / $mon_name"; fi
  done <<< "$_xrandr_hex"
fi

[ -z "$MONITORS" ] && MONITORS="Default Display"
echo "      Detected monitors: $MONITORS"

# ----------------------------------------------------------------------------
# Build JSON payload (identical field names as the Windows scanner)
# ----------------------------------------------------------------------------
json_escape() {
  local s=${1-}
  s=${s//\\/\\\\}
  s=${s//\"/\\\"}
  s=${s//$'\t'/\\t}
  s=${s//$'\r'/\\r}
  s=${s//$'\n'/\\n}
  printf '%s' "$s"
}

# ----------------------------------------------------------------------------
# [4/5] Drive health (SMART) - uses smartctl (smartmontools) when available
# ----------------------------------------------------------------------------
step "[4/5] Checking drive health (SMART)..."

json_num() { # prints a JSON number or null
  case "${1-}" in ''|*[!0-9-]*) printf 'null' ;; *) printf '%s' "$1" ;; esac
}
json_bool() {
  case "${1-}" in true) printf 'true' ;; false) printf 'false' ;; *) printf 'null' ;; esac
}

SMARTCTL=""
if command -v smartctl >/dev/null 2>&1; then
  if [ "$(id -u)" = "0" ]; then
    SMARTCTL="smartctl"
  elif command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
    SMARTCTL="sudo -n smartctl"
  fi
fi

DISK_HEALTH_JSON=""
for dev in /sys/block/*; do
  [ -e "$dev" ] || continue
  name=$(basename "$dev")
  case "$name" in
    sd*|hd*|vd*|xvd*|nvme*n*) ;;
    *) continue ;;
  esac
  case "$name" in nvme*p*) continue ;; esac
  is_external_disk "$dev" && continue

  model=$(read_file "$dev/device/model"); [ -z "$model" ] && model="$name"
  serial=$(read_file "$dev/device/serial")
  sectors=$(cat "$dev/size" 2>/dev/null || echo 0)
  gb=$(( sectors / 2 / 1024 / 1024 ))
  rot=$(cat "$dev/queue/rotational" 2>/dev/null || echo "")
  case "$name" in
    nvme*) dtype="NVMe" ;;
    *) if [ "$rot" = "1" ]; then dtype="HDD"; elif [ "$rot" = "0" ]; then dtype="SSD"; else dtype=""; fi ;;
  esac

  smodel=""; passed=""; life=""; temp=""; hours=""; realloc=""; pending=""; uncorr=""; media=""; predict=""; status="Unknown"; note=""
  if [ -n "$SMARTCTL" ]; then
    out=$(LC_ALL=C $SMARTCTL -H -A -i "/dev/$name" 2>/dev/null)
    if [ -n "$out" ]; then
      eval "$(printf '%s\n' "$out" | awk '
        function first_num(s) { if (match(s, /[0-9]+/)) return substr(s, RSTART, RLENGTH); return "" }
        /^(Device Model|Model Number):/ { sub(/^[^:]*:[ \t]*/, ""); gsub(/'\''/, ""); print "smodel='\''" $0 "'\''" }
        /overall-health self-assessment test result:/ { print "passed=" ($NF == "PASSED" ? "true" : "false") }
        /SMART Health Status:/ { print "passed=" ($NF == "OK" ? "true" : "false") }
        /^Percentage Used:/ { gsub(/[^0-9]/, "", $3); if ($3 != "") print "life=" (100 - $3) }
        /^Temperature:/ { print "temp=" first_num($2) }
        /^Power On Hours:/ { v=$4; gsub(/[^0-9]/, "", v); print "hours=" v }
        /^Media and Data Integrity Errors:/ { v=$NF; gsub(/[^0-9]/, "", v); print "media=" v }
        $1 ~ /^[0-9]+$/ && NF >= 10 {
          id=$1; val=$4+0; raw=first_num($10)
          if ($9 != "-") print "predict=true"
          if (id == 5)   print "realloc=" raw
          if (id == 197) print "pending=" raw
          if (id == 198) print "uncorr=" raw
          if (id == 9)   print "hours=" raw
          if ((id == 194 || id == 190) && !t) { print "temp=" raw; t=1 }
          if (id == 231 || id == 169) { print "life=" val; l=1 }
          if ((id == 233 || id == 177) && !l) print "life=" val
        }
      ')"
      if [ "$passed" = "true" ]; then status="Healthy"; elif [ "$passed" = "false" ]; then status="Unhealthy"; fi
    else
      note="smartctl returned no data"
    fi
  else
    note="install smartmontools and run as root for SMART data"
  fi

  [ "$model" = "$name" ] && [ -n "$smodel" ] && model="$smodel"
  [ "$dtype" = "HDD" ] && life=""   # wear/life counters only apply to SSDs
  case "$life" in ''|*[!0-9]*) life="" ;; esac
  [ -n "$life" ] && [ "$life" -gt 100 ] && life=100

  echo "      - $model [$dtype]: $status${life:+ | life left: ${life}%}${temp:+ | ${temp} C}"
  [ "$predict" = "true" ] && warn "        SMART reports a failing attribute on $model!"

  obj=$(printf '{"model":"%s","serial":"%s","type":"%s","size_gb":%s,"health_status":"%s","smart_passed":%s,"health_percent":%s,"temperature_c":%s,"power_on_hours":%s,"reallocated_sectors":%s,"pending_sectors":%s,"uncorrectable_errors":%s,"media_errors":%s,"predict_failure":%s,"note":"%s"}' \
    "$(json_escape "$model")" "$(json_escape "$serial")" "$dtype" "$(json_num "$gb")" "$status" \
    "$(json_bool "$passed")" "$(json_num "$life")" "$(json_num "$temp")" "$(json_num "$hours")" \
    "$(json_num "$realloc")" "$(json_num "$pending")" "$(json_num "$uncorr")" "$(json_num "$media")" \
    "$(json_bool "$predict")" "$(json_escape "$note")")
  if [ -z "$DISK_HEALTH_JSON" ]; then DISK_HEALTH_JSON="$obj"; else DISK_HEALTH_JSON="$DISK_HEALTH_JSON,$obj"; fi
done
[ -z "$SMARTCTL" ] && warn "      Tip: install smartmontools and run as root (sudo) for full drive health data."

PAYLOAD=$(printf '{"userName":"%s","computerName":"%s","model":"%s","serialNumber":"%s","os":"%s","ip":"%s","cpu":"%s","ram":"%s","storage":"%s","cSpace":"%s","gpu":"%s","monitors":"%s","diskHealth":[%s]}' \
  "$(json_escape "$USER_NAME")" \
  "$(json_escape "$COMP")" \
  "$(json_escape "$MODEL")" \
  "$(json_escape "$SERIAL")" \
  "$(json_escape "$OS")" \
  "$(json_escape "$IP")" \
  "$(json_escape "$CPU")" \
  "$(json_escape "$RAM")" \
  "$(json_escape "$STORAGE")" \
  "$(json_escape "$CSpace")" \
  "$(json_escape "$GPU")" \
  "$(json_escape "$MONITORS")" \
  "$DISK_HEALTH_JSON")

if [ "$DRY_RUN" = "1" ]; then
  echo
  echo "${C_BOLD}[DRY-RUN] JSON payload:${C_OFF}"
  echo "$PAYLOAD"
  exit 0
fi

# ----------------------------------------------------------------------------
# [4/4] Send to IT Asset Server
# ----------------------------------------------------------------------------
step "[5/5] Sending specifications to IT Asset Server ($SERVER_URL)..."

post_payload() { # $1 = base url
  local url="$1/api/assets/scan"
  if command -v curl >/dev/null 2>&1; then
    curl -sS -m 15 -X POST "$url" \
      -H "Content-Type: application/json; charset=utf-8" \
      -H "X-IAM-Key: $SERVER_KEY" \
      --data-binary "$PAYLOAD" 2>/dev/null
    return $?
  elif command -v wget >/dev/null 2>&1; then
    wget -qO- -T 15 \
      --header="Content-Type: application/json; charset=utf-8" \
      --header="X-IAM-Key: $SERVER_KEY" \
      --post-data="$PAYLOAD" "$url" 2>/dev/null
    return $?
  fi
  err "[ERROR] Neither curl nor wget is installed!"
  return 127
}

RESPONSE=$(post_payload "$SERVER_URL")
RC=$?
if [ $RC -ne 0 ] && [ "$SERVER_URL" = "http://192.168.10.194:3000" ]; then
  warn "[WARN] Main server unreachable, trying localhost ($FALLBACK_URL)..."
  RESPONSE=$(post_payload "$FALLBACK_URL")
  RC=$?
fi

echo "========================================================="
if [ $RC -eq 0 ] && printf '%s' "$RESPONSE" | grep -q '"success"[[:space:]]*:[[:space:]]*true'; then
  ITEMS=$(printf '%s' "$RESPONSE" | grep -o '"items_count"[[:space:]]*:[[:space:]]*[0-9]*' | grep -o '[0-9]*$')
  BATCH=$(printf '%s' "$RESPONSE" | grep -o '"batch_id"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/.*"batch_id"[[:space:]]*:[[:space:]]*"//; s/"$//')
  ok "[SUCCESS] Specifications successfully sent to server!"
  echo "${C_CYAN}Auto-split items: ${ITEMS:-?}${C_OFF}"
  [ -n "$BATCH" ] && echo "${C_CYAN}Batch: $BATCH${C_OFF}"
  ok "Admin can now review and assign property tag in dashboard."
  echo "========================================================="
  exit 0
else
  err "[ERROR] Failed to send data to the server."
  [ -n "$RESPONSE" ] && err "Server reply: $RESPONSE"
  err "Check server address (--server) and network connectivity."
  echo "========================================================="
  exit 1
fi
