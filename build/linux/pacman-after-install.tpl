#!/bin/bash
# post_install of the pacman package. pacman's own hooks update the desktop and MIME
# databases and the icon cache, so this only adds the command.
ln -sf '/opt/${sanitizedProductName}/${executable}' '/usr/bin/${executable}'

# Arch kernels allow unprivileged user namespaces, so Chromium needs no setuid sandbox helper.
# Without them (e.g. a hardened kernel with them turned off), fall back to the setuid helper.
if ! { [[ -L /proc/self/ns/user ]] && unshare --user true; } 2>/dev/null; then
    chmod 4755 '/opt/${sanitizedProductName}/chrome-sandbox' || true
else
    chmod 0755 '/opt/${sanitizedProductName}/chrome-sandbox' || true
fi
