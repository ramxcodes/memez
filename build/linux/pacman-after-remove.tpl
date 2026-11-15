#!/bin/bash
# post_remove of the pacman package: remove the command post_install added.
if [ -L '/usr/bin/${executable}' ] && [ "$(readlink '/usr/bin/${executable}')" = '/opt/${sanitizedProductName}/${executable}' ]; then
    rm -f '/usr/bin/${executable}'
fi
