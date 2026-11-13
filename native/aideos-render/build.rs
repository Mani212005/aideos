//! File Description: Build script of the native renderer. Skia (through skia-bindings) links the system fontconfig with `-lfontconfig`, which needs the `libfontconfig.so` development symlink; a host that has only the runtime library (`libfontconfig.so.1`, no `libfontconfig1-dev` package) fails to link. This script finds the runtime library and points the linker at a symlink to it in OUT_DIR, so the crate builds on such a host without root.
//! Inputs and outputs: the target triple and the host's library directories -> `cargo:rustc-link-search` for a shim directory when one is needed, and a `cargo:warning` naming it.
//! Used by: cargo when building native/aideos-render (see docs/NATIVE_RENDERER.md, "Building").

use std::env;
use std::path::{Path, PathBuf};

/// Runs the fontconfig link shim on Linux targets; does nothing elsewhere.
fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    if env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("linux") {
        return;
    }
    let arch = env::var("CARGO_CFG_TARGET_ARCH").unwrap_or_default();
    let dirs = library_dirs(&arch);
    if dirs.iter().any(|d| d.join("libfontconfig.so").exists()) {
        return;
    }
    let Some(runtime) = dirs
        .iter()
        .map(|d| d.join("libfontconfig.so.1"))
        .find(|p| p.exists())
    else {
        // Neither the development symlink nor the runtime library: let the link fail with its own message.
        println!("cargo:warning=libfontconfig not found; install fontconfig (libfontconfig1-dev on Debian and Ubuntu)");
        return;
    };
    let shim = PathBuf::from(env::var("OUT_DIR").expect("cargo sets OUT_DIR")).join("link-shim");
    if let Err(e) = make_shim(&shim, &runtime) {
        println!(
            "cargo:warning=could not create the fontconfig link shim in {}: {e}",
            shim.display()
        );
        return;
    }
    println!("cargo:rustc-link-search=native={}", shim.display());
    println!("cargo:warning=linking fontconfig through {} (no libfontconfig.so development symlink on this host)", runtime.display());
}

/// The directories a Linux linker searches for system libraries of the given architecture.
fn library_dirs(arch: &str) -> Vec<PathBuf> {
    [
        format!("/usr/lib/{arch}-linux-gnu"),
        format!("/lib/{arch}-linux-gnu"),
        "/usr/lib64".to_string(),
        "/lib64".to_string(),
        "/usr/lib".to_string(),
        "/lib".to_string(),
    ]
    .into_iter()
    .map(PathBuf::from)
    .collect()
}

/// Creates `<shim>/libfontconfig.so` as a symlink to the runtime library, replacing a stale one.
fn make_shim(shim: &Path, runtime: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(shim)?;
    let link = shim.join("libfontconfig.so");
    if link.symlink_metadata().is_ok() {
        std::fs::remove_file(&link)?;
    }
    std::os::unix::fs::symlink(runtime, link)
}
