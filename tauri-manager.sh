#!/usr/bin/env bash

# ==============================================================================
# Script Name: tauri-manager.sh
# Description: Interactive CLI manager for NodeFable dev, tests and builds
#              (Tauri v2 desktop + Android, fully local Rust backend).
# Usage:       ./tauri-manager.sh            interactive menu (loops)
#              ./tauri-manager.sh <command>  run one command and exit
#              commands: dev debug run web test verify deb rpm appimage
#                        android android-x86 android-release android-dev
#                        emulator install phone icons clean data
# Notes:       No npm/Vite step: the editor in frontend/editor is served as-is
#              (tauri.conf.json → build.frontendDist).
#              Devtools exist only in dev/debug builds, so release bundles
#              ship without them.
#              Projects live in $DATA_DIR (override: NODEFABLE_DATA_DIR).
#              Android needs ~/Android/env.sh (JAVA_HOME = a full JDK with
#              javac, ANDROID_HOME, NDK_HOME).
# ==============================================================================

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

TAURI_DIR="src-tauri"
DATA_DIR="${NODEFABLE_DATA_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/nodefable/data}"
APK_DIR="$TAURI_DIR/gen/android/app/build/outputs/apk/universal"
APK_DEBUG="$APK_DIR/debug/app-universal-debug.apk"
APK_RELEASE="$APK_DIR/release/app-universal-release.apk"
AVD="${NODEFABLE_AVD:-cairn34}"

info() { echo "[INFO] $*"; }
err()  { echo "[ERROR] $*" >&2; }

# Tauri CLI as a cargo subcommand (cargo install tauri-cli --version "^2" --locked).
tauri() {
    if ! cargo tauri --version >/dev/null 2>&1; then
        err "tauri-cli missing. Install it with: cargo install tauri-cli --version \"^2\" --locked"
        return 1
    fi
    cargo tauri "$@"
}

android_env() {
    if [[ ! -f "$HOME/Android/env.sh" ]]; then
        err "~/Android/env.sh not found (JAVA_HOME, ANDROID_HOME, NDK_HOME; see AGENTS.md)."
        return 1
    fi
    # shellcheck disable=SC1091
    source "$HOME/Android/env.sh"
    if [[ ! -x "${JAVA_HOME:-}/bin/javac" ]]; then
        err "JAVA_HOME ($JAVA_HOME) has no javac: Gradle needs a full JDK, not a JRE."
        return 1
    fi
    if [[ ! -d "$TAURI_DIR/gen/android" ]]; then
        info "Android project missing, generating it (cargo tauri android init)..."
        tauri android init --ci
    fi
}

show_outputs() {
    echo "[OUTPUT] Artifacts in $TAURI_DIR/target/*/bundle:"
    find "$TAURI_DIR/target" -path '*/bundle/*' -type f \
        \( -name '*.deb' -o -name '*.rpm' -o -name '*.AppImage' \) \
        -printf '  %p (%s bytes)\n' 2>/dev/null || true
}

# Each command runs in a subshell-safe function; failures return non-zero
# without killing the menu loop.
run_cmd() {
    case "$1" in
        dev)       info "Tauri dev (devtools on, Rust rebuilds on change)..."; tauri dev ;;
        debug)     info "Debug build (devtools on, no bundle)..."; tauri build --debug --no-bundle ;;
        run)
            local bin="$TAURI_DIR/target/release/nodefable"
            [[ -x $bin ]] || { err "No release binary at $bin. Run a build first (deb/rpm/appimage)."; return 1; }
            info "Running $bin"; "$bin" ;;
        web)
            # Legacy browser mode (Python/FastAPI) until it is removed.
            [[ -x ./run_dev.sh ]] || { err "run_dev.sh not found (Python backend removed?)."; return 1; }
            info "Legacy browser mode (Python backend) at http://localhost:8005/editor"; ./run_dev.sh ;;
        test)
            info "Frontend + runtime tests (node tests/run.js)..."; node tests/run.js
            info "Rust backend tests (cargo test)..."; cargo test --manifest-path "$TAURI_DIR/Cargo.toml" ;;
        verify)
            run_cmd test
            info "cargo clippy (warnings are errors)..."
            cargo clippy --manifest-path "$TAURI_DIR/Cargo.toml" --all-targets -- -D warnings ;;
        deb)       tauri build --bundles deb && show_outputs ;;
        rpm)       tauri build --bundles rpm && show_outputs ;;
        appimage)  NO_STRIP=true tauri build --bundles appimage && show_outputs ;;
        android)
            android_env
            tauri android build --debug --apk --target aarch64 && echo "[OUTPUT] $APK_DEBUG" ;;
        android-x86)
            android_env
            tauri android build --debug --apk --target x86_64 && echo "[OUTPUT] $APK_DEBUG (x86_64, for the emulator)" ;;
        android-release)
            android_env
            [[ -f $HOME/Android/keystore.properties ]] || { err "No ~/Android/keystore.properties (storeFile, storePassword, keyAlias, keyPassword)."; return 1; }
            grep -q "nodefable-signing" "$TAURI_DIR/gen/android/app/build.gradle.kts" || tools/android-signing.sh
            tauri android build --apk --target aarch64 && echo "[OUTPUT] $APK_RELEASE" ;;
        android-dev) android_env; tauri android dev ;;
        emulator)
            android_env
            info "Starting emulator '$AVD' (set NODEFABLE_AVD to change)..."
            nohup "$ANDROID_HOME/emulator/emulator" -avd "$AVD" >/dev/null 2>&1 &
            info "Emulator launching in the background (pid $!)." ;;
        install)
            android_env
            [[ -f $APK_DEBUG ]] || { err "No APK at $APK_DEBUG. Build it first."; return 1; }
            adb install -r "$APK_DEBUG" ;;
        phone)
            run_cmd android && run_cmd install ;;
        icons)
            info "Regenerating icons from frontend/editor/Assets/Logo/android-chrome-512x512.png..."
            tauri icon frontend/editor/Assets/Logo/android-chrome-512x512.png ;;
        clean)
            info "Removing cargo build output and Android build dirs..."
            cargo clean --manifest-path "$TAURI_DIR/Cargo.toml"
            rm -rf "$TAURI_DIR/gen/android/app/build" "$TAURI_DIR/gen/android/build" ;;
        data)
            info "Data folder: $DATA_DIR"
            mkdir -p "$DATA_DIR"
            xdg-open "$DATA_DIR" >/dev/null 2>&1 || err "Could not open it." ;;
        *) err "Unknown command: $1"; return 2 ;;
    esac
}

menu() {
    cat <<'EOF2'
==========================================
      NodeFable Build Manager
==========================================
 Develop / debug
   1) Tauri dev                 (devtools, desktop app)
   2) Debug build               (devtools, no bundle)
   3) Run last release binary
   4) Legacy browser mode       (Python backend)
 Test
   5) Tests                     (node tests + cargo test)
   6) Verify                    (tests + clippy -D warnings)
 Linux release (no devtools)
   7) .deb    8) .rpm    9) AppImage
 Android
  10) Build debug APK (aarch64, phone)
  11) Build debug APK (x86_64, emulator)
  12) Android dev (device/emulator)
  13) Start emulator
  14) Install APK via adb
  15) Update phone             (build debug APK + install)
 Misc
  16) Regenerate icons   17) Clean   18) Open data folder
 Android release
  19) Build signed release APK (aarch64)
   q) Quit
EOF2
}

interactive() {
    local choice cmd
    while true; do
        echo ""; menu
        read -rp "Choice: " choice
        case "$choice" in
            1) cmd=dev ;; 2) cmd=debug ;; 3) cmd=run ;; 4) cmd=web ;;
            5) cmd=test ;; 6) cmd=verify ;;
            7) cmd=deb ;; 8) cmd=rpm ;; 9) cmd=appimage ;;
            10) cmd=android ;; 11) cmd=android-x86 ;; 12) cmd=android-dev ;; 13) cmd=emulator ;;
            14) cmd=install ;; 15) cmd=phone ;;
            16) cmd=icons ;; 17) cmd=clean ;; 18) cmd=data ;; 19) cmd=android-release ;;
            q|Q) exit 0 ;;
            *) err "Invalid choice."; continue ;;
        esac
        if run_cmd "$cmd"; then echo "[SUCCESS] $cmd done."; else echo "[FAILED] $cmd exited with an error." >&2; fi
    done
}

if [[ $# -gt 0 ]]; then run_cmd "$1"; else interactive; fi
