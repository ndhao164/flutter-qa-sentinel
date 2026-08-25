#!/bin/sh
exec node "$(dirname "$0")/fake-apple-tool.mjs" xcrun "$@"
