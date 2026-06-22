#!/usr/bin/env bash
set -euo pipefail

# Makes Raspberry Pi OS boot feel OEM by hiding default Pi branding
# and enabling Plymouth splash for a custom "s52 tech loading" theme.

BOOT_CONFIG="/boot/firmware/config.txt"
CMDLINE_CONFIG="/boot/firmware/cmdline.txt"
if [[ ! -f "${BOOT_CONFIG}" ]]; then
  BOOT_CONFIG="/boot/config.txt"
fi
if [[ ! -f "${CMDLINE_CONFIG}" ]]; then
  CMDLINE_CONFIG="/boot/cmdline.txt"
fi

BACKUP_DIR="/etc/s52-boot-branding-backup"
PLYMOUTH_THEME_DIR="/usr/share/plymouth/themes/s52-tech"
PLYMOUTH_THEME_NAME="s52-tech"

require_files() {
  if [[ ! -f "${BOOT_CONFIG}" || ! -f "${CMDLINE_CONFIG}" ]]; then
    echo "Could not find Raspberry Pi boot config files."
    exit 1
  fi
}

ensure_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    echo "Please run with sudo: sudo $0 $*"
    exit 1
  fi
}

backup_once() {
  mkdir -p "${BACKUP_DIR}"
  if [[ ! -f "${BACKUP_DIR}/config.txt.bak" ]]; then
    cp "${BOOT_CONFIG}" "${BACKUP_DIR}/config.txt.bak"
  fi
  if [[ ! -f "${BACKUP_DIR}/cmdline.txt.bak" ]]; then
    cp "${CMDLINE_CONFIG}" "${BACKUP_DIR}/cmdline.txt.bak"
  fi
}

set_config_option() {
  local key="$1"
  local value="$2"
  local file="$3"

  if grep -Eq "^[# ]*${key}=" "${file}"; then
    sed -Ei "s|^[# ]*${key}=.*|${key}=${value}|g" "${file}"
  else
    printf "\n%s=%s\n" "${key}" "${value}" >> "${file}"
  fi
}

create_plymouth_theme() {
  mkdir -p "${PLYMOUTH_THEME_DIR}"

  cat > "${PLYMOUTH_THEME_DIR}/${PLYMOUTH_THEME_NAME}.plymouth" <<EOF
[Plymouth Theme]
Name=S52 Tech
Description=Blank black splash — holds the screen during early boot until
 labwc/Chromium take over and the app's own BMW roundel starts spinning.
ModuleName=script

[script]
ImageDir=${PLYMOUTH_THEME_DIR}
ScriptFile=${PLYMOUTH_THEME_DIR}/${PLYMOUTH_THEME_NAME}.script
EOF

  # Intentionally blank: no logo, no text, no spinner. This theme exists only
  # to hold a black framebuffer during kernel/initramfs/systemd boot (hiding
  # Pi OS branding and console text) — the actual "loading" indicator the
  # user sees is the React BMW roundel (LogoIntro.jsx), which takes over the
  # instant labwc/Chromium map (plymouth quit --retain-splash bridges the gap).
  cat > "${PLYMOUTH_THEME_DIR}/${PLYMOUTH_THEME_NAME}.script" <<'EOF'
Window.SetBackgroundTopColor(0.0, 0.0, 0.0);
Window.SetBackgroundBottomColor(0.0, 0.0, 0.0);
EOF
}

normalize_cmdline() {
  local line
  line="$(tr -s ' ' < "${CMDLINE_CONFIG}" | sed -E 's/^ +| +$//g')"

  line="$(echo "${line}" | sed -E 's/ ?logo\.nologo//g')"
  line="$(echo "${line}" | sed -E 's/ ?quiet//g')"
  line="$(echo "${line}" | sed -E 's/ ?splash//g')"
  line="$(echo "${line}" | sed -E 's/ ?vt\.global_cursor_default=[^ ]+//g')"
  line="$(echo "${line}" | sed -E 's/ ?plymouth\.ignore-serial-consoles//g')"
  line="$(echo "${line}" | sed -E 's/ ?loglevel=[^ ]+//g')"

  line="$(echo "${line}" | tr -s ' ' | sed -E 's/^ +| +$//g')"
  line="${line} logo.nologo quiet splash plymouth.ignore-serial-consoles vt.global_cursor_default=0 loglevel=3"
  echo "${line}" > "${CMDLINE_CONFIG}"
}

apply_changes() {
  ensure_root "$@"
  require_files
  backup_once

  apt-get update -qq
  apt-get install -y -qq plymouth plymouth-themes

  set_config_option "disable_splash" "1" "${BOOT_CONFIG}"

  normalize_cmdline
  create_plymouth_theme

  plymouth-set-default-theme "${PLYMOUTH_THEME_NAME}" -R

  echo ""
  echo "Applied S52 boot branding settings."
  echo "Reboot to see changes: sudo reboot"
}

revert_changes() {
  ensure_root "$@"
  require_files

  if [[ ! -f "${BACKUP_DIR}/config.txt.bak" || ! -f "${BACKUP_DIR}/cmdline.txt.bak" ]]; then
    echo "No backup found in ${BACKUP_DIR}. Cannot safely revert."
    exit 1
  fi

  cp "${BACKUP_DIR}/config.txt.bak" "${BOOT_CONFIG}"
  cp "${BACKUP_DIR}/cmdline.txt.bak" "${CMDLINE_CONFIG}"

  if command -v plymouth-set-default-theme >/dev/null 2>&1; then
    plymouth-set-default-theme spinner -R || true
  fi

  rm -rf "${PLYMOUTH_THEME_DIR}"

  echo ""
  echo "Reverted boot branding files from backup."
  echo "Reboot to restore original behavior: sudo reboot"
}

status_changes() {
  require_files
  echo "Boot config file: ${BOOT_CONFIG}"
  echo "Cmdline file:     ${CMDLINE_CONFIG}"
  echo ""
  echo "disable_splash setting:"
  grep -E "^[# ]*disable_splash" "${BOOT_CONFIG}" || true
  echo ""
  echo "cmdline.txt:"
  cat "${CMDLINE_CONFIG}"
  echo ""
  if [[ -f "${PLYMOUTH_THEME_DIR}/${PLYMOUTH_THEME_NAME}.plymouth" ]]; then
    echo "Custom Plymouth theme exists: yes"
  else
    echo "Custom Plymouth theme exists: no"
  fi
  if [[ -f "${BACKUP_DIR}/config.txt.bak" && -f "${BACKUP_DIR}/cmdline.txt.bak" ]]; then
    echo "Backups exist: yes (${BACKUP_DIR})"
  else
    echo "Backups exist: no"
  fi
}

usage() {
  cat <<'EOF'
Usage:
  s52-boot-branding.sh apply    # Hide Pi branding, enable S52 splash
  s52-boot-branding.sh revert   # Restore files from backup
  s52-boot-branding.sh status   # Show current boot branding state
EOF
}

main() {
  case "${1:-}" in
    apply)
      apply_changes "$@"
      ;;
    revert)
      revert_changes "$@"
      ;;
    status)
      status_changes
      ;;
    *)
      usage
      exit 1
      ;;
  esac
}

main "$@"
