#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
PATH="$HOME/.cargo/bin:$HOME/.local/bin:$PATH"
export PATH
cargo build --locked --manifest-path core/Cargo.toml --target wasm32-unknown-unknown --release
wasm-bindgen --target web --no-typescript --out-dir src/generated core/target/wasm32-unknown-unknown/release/baizhi_core.wasm
