//! File Description: The optional GPU path (cargo feature `gpu`): draws the same frame as the CPU reference through Skia's Ganesh OpenGL backend on a headless, surfaceless EGL context (Mesa's EGL_PLATFORM_SURFACELESS_MESA, so no window or X server), then reads the pixels back. libEGL is loaded at run time, so a build with this feature still links and runs CPU renders on a host without a GPU driver. GPU output is for speed only and is not byte-compared: gates and goldens use the CPU raster.
//! Inputs and outputs: a `Renderer`, a format and a frame number -> a `RenderedFrame` read back from a GPU surface, or a `GpuError` naming the EGL or Skia step that failed.
//! Used by: the `aideos-render --gpu` CLI path and tests/gpu.rs.

use std::fmt;

use khronos_egl as egl;
use skia_safe::{gpu, AlphaType, ColorType, ImageInfo};

use crate::renderer::{read_rgba, RenderedFrame};
use crate::{Format, RenderError, Renderer};

/// Mesa's surfaceless EGL platform.
const PLATFORM_SURFACELESS_MESA: egl::Enum = 0x31DD;

/// Why the GPU path could not render.
#[derive(Debug)]
pub enum GpuError {
    /// An EGL or Skia GPU setup step failed.
    Setup(String),
    /// The frame request itself failed (format, frame range, surface).
    Render(RenderError),
}

impl fmt::Display for GpuError {
    /// Writes a one-line description.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            GpuError::Setup(m) => write!(f, "gpu setup: {m}"),
            GpuError::Render(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for GpuError {}

/// A current OpenGL context with a Skia GPU context on it.
pub struct GpuContext {
    // Kept alive for the context's lifetime; dropped after `direct`.
    _egl: egl::DynamicInstance<egl::EGL1_5>,
    direct: gpu::DirectContext,
}

impl GpuContext {
    /// Loads libEGL, creates a surfaceless desktop GL context, makes it current and wraps it for Skia.
    pub fn new() -> Result<GpuContext, GpuError> {
        let setup = |m: String| GpuError::Setup(m);
        // SAFETY: loads the system libEGL by its standard name; every call below goes through its checked API.
        let e = unsafe { egl::DynamicInstance::<egl::EGL1_5>::load_required() }
            .map_err(|err| setup(format!("cannot load libEGL: {err}")))?;
        // SAFETY: the default display handle and an attribute list terminated by ATTRIB_NONE.
        let display = unsafe {
            e.get_platform_display(
                PLATFORM_SURFACELESS_MESA,
                egl::DEFAULT_DISPLAY,
                &[egl::ATTRIB_NONE],
            )
        }
        .map_err(|err| setup(format!("no surfaceless EGL display: {err}")))?;
        e.initialize(display)
            .map_err(|err| setup(format!("eglInitialize: {err}")))?;
        e.bind_api(egl::OPENGL_API)
            .map_err(|err| setup(format!("eglBindAPI(OpenGL): {err}")))?;
        let config = e
            .choose_first_config(
                display,
                &[
                    egl::SURFACE_TYPE,
                    egl::PBUFFER_BIT,
                    egl::RENDERABLE_TYPE,
                    egl::OPENGL_BIT,
                    egl::NONE,
                ],
            )
            .map_err(|err| setup(format!("eglChooseConfig: {err}")))?
            .ok_or_else(|| setup("no EGL config renders OpenGL".into()))?;
        let context = e
            .create_context(display, config, None, &[egl::NONE])
            .map_err(|err| setup(format!("eglCreateContext: {err}")))?;
        e.make_current(display, None, None, Some(context))
            .map_err(|err| setup(format!("eglMakeCurrent: {err}")))?;
        let interface = gpu::gl::Interface::new_load_with(|name| {
            e.get_proc_address(name)
                .map_or(std::ptr::null(), |f| f as *const _)
        })
        .ok_or_else(|| setup("Skia cannot build a GL interface on this context".into()))?;
        let direct = gpu::direct_contexts::make_gl(interface, None)
            .ok_or_else(|| setup("Skia cannot create a GL context".into()))?;
        Ok(GpuContext { _egl: e, direct })
    }

    /// Renders one frame on a GPU surface and reads it back as straight-alpha RGBA.
    pub fn render_frame(
        &mut self,
        renderer: &Renderer,
        format: Format,
        frame: u32,
    ) -> Result<RenderedFrame, GpuError> {
        let (w, h) = renderer.frame_size(format).map_err(GpuError::Render)?;
        let info = ImageInfo::new(
            (w as i32, h as i32),
            ColorType::RGBA8888,
            AlphaType::Premul,
            None,
        );
        let mut surface = gpu::surfaces::render_target(
            &mut self.direct,
            gpu::Budgeted::Yes,
            &info,
            None,
            gpu::SurfaceOrigin::TopLeft,
            None,
            false,
            None,
        )
        .ok_or_else(|| GpuError::Setup(format!("cannot create a {w}x{h} GPU surface")))?;
        renderer
            .draw(surface.canvas(), format, frame)
            .map_err(GpuError::Render)?;
        // Reading the pixels back waits for the GPU, so the submit result needs no separate check.
        let _ = self.direct.flush_and_submit();
        read_rgba(&mut surface, w, h).map_err(GpuError::Render)
    }
}
