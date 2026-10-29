#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
package_nix="$script_dir/package.nix"
fake_hash="sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="

current="$(grep -oP 'outputHash = "\Ksha256-[^"]*' "$package_nix" || true)"
if [[ -z "$current" ]]; then
	echo "error: could not find an outputHash in $package_nix" >&2
	exit 1
fi

write_hash() {
	sed -i -E "s|outputHash = \"sha256-[^\"]*\";|outputHash = \"$1\";|" "$package_nix"
}

trap 'write_hash "$current"' EXIT

write_hash "$fake_hash"

echo "==> building .#torsel.deps to compute the hash (this runs bun install)..."
build_output="$(nix build .#torsel.deps --no-link 2>&1 || true)"

new_hash="$(printf '%s\n' "$build_output" | grep -oP 'got:\s+\Ksha256-\S*' || true)"
if [[ -z "$new_hash" ]]; then
	echo "$build_output" >&2
	echo "error: could not parse the new hash from the build output above" >&2
	exit 1
fi

trap - EXIT
write_hash "$new_hash"

if [[ "$new_hash" == "$current" ]]; then
	echo "==> deps outputHash already up to date: $new_hash"
else
	echo "==> deps outputHash updated"
	echo "    old: $current"
	echo "    new: $new_hash"
fi
