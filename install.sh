#!/bin/sh
# Links this folder into Premiere's CEP extensions dir. Unsigned panels need PlayerDebugMode.
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/Library/Application Support/Adobe/CEP/extensions/clean-cut"
mkdir -p "$(dirname "$DEST")"
ln -sfn "$DIR" "$DEST"
for v in 11 12; do defaults write com.adobe.CSXS.$v PlayerDebugMode 1; done
echo "Installed -> $DEST. Restart Premiere, then Window > Extensions > Clean Cut."
