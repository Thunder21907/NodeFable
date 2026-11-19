#!/usr/bin/env bash
# ==============================================================================
# Script Name: tools/android-signing.sh
# Description: Wire release signing into the generated Android project
#              (src-tauri/gen/android/app/build.gradle.kts). Idempotent.
#              Reads ~/Android/keystore.properties at build time:
#                storeFile=/abs/path/to/keystore.jks
#                storePassword=…   keyAlias=…   keyPassword=…
#              Secrets never enter the repository.
# ==============================================================================
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

GRADLE="src-tauri/gen/android/app/build.gradle.kts"
PROPS="$HOME/Android/keystore.properties"
MARKER="// nodefable-signing"

[[ -f $GRADLE ]] || { echo "[ERROR] $GRADLE missing. Run: cargo tauri android init" >&2; exit 1; }
[[ -f $PROPS ]]  || { echo "[ERROR] $PROPS missing (storeFile, storePassword, keyAlias, keyPassword)." >&2; exit 1; }

if grep -q "$MARKER" "$GRADLE"; then
    echo "[INFO] Release signing already configured in $GRADLE"
    exit 0
fi

python3 - "$GRADLE" "$MARKER" <<'PY'
import sys
path, marker = sys.argv[1], sys.argv[2]
s = open(path).read()
signing = f"""    {marker}: release keys from ~/Android/keystore.properties (tools/android-signing.sh)
    signingConfigs {{
        create("release") {{
            val keystoreProperties = Properties().apply {{
                val f = file(System.getProperty("user.home") + "/Android/keystore.properties")
                if (f.exists()) f.inputStream().use {{ load(it) }}
            }}
            keystoreProperties.getProperty("storeFile")?.let {{ storeFile = file(it) }}
            storePassword = keystoreProperties.getProperty("storePassword")
            keyAlias = keystoreProperties.getProperty("keyAlias")
            keyPassword = keystoreProperties.getProperty("keyPassword")
        }}
    }}
"""
anchor = "    buildTypes {\n"
release = '        getByName("release") {\n'
assert s.count(anchor) == 1 and s.count(release) == 1, "unexpected build.gradle.kts layout"
s = s.replace(anchor, signing + anchor)
s = s.replace(release, release + f'            signingConfig = signingConfigs.getByName("release") {marker}\n')
open(path, "w").write(s)
PY
echo "[INFO] Release signing added to $GRADLE"
