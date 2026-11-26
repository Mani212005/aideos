//! File Description: The public renderer: loads a Render IR and its package's assets once (SVG artwork parsed into the retained model, vendored fonts, caption phrases per format), checks what the IR loader cannot (asset files exist inside the package, declared element ids exist in the artwork, every SVG text resolves to a vendored font), then renders any frame of either format on Skia's CPU rasterizer, the deterministic reference, with Chrome's text contrast and gamma. A frame is a pure function of (IR, assets, format, frame number), so frames render in any order and a cold render is byte-identical to a warm one.
//! Inputs and outputs: an IR file or `RenderIr` plus the package directory -> `Renderer`; (format, frame) -> `RenderedFrame` (straight-alpha RGBA8) and its PNG bytes. A `stage3d` node (the Three stage, `aideos.render/2`) loads its mesh asset here and is drawn by the CPU rasterizer in `raster::stage3d`; an `image` node (a picture, `aideos.render/3`) has its image decoded here once, refused unless its bytes match the pinned sha256 and its size the declared one.
//! Used by: the `aideos-render` CLI (src/main.rs), tests/*.rs, and later the encode stage (R3) and the RenderJob runner.

use std::collections::BTreeMap;
use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use aideos_render_ir::mesh::decode_mesh;
use aideos_render_ir::types::{Asset, Node, RenderIr};
use aideos_render_ir::{load_from_path, LoadError};
use skia_safe::{
    surfaces, AlphaType, Canvas, ColorType, Data, Image, ImageInfo, PixelGeometry, Pixmap, SurfaceProps, SurfacePropsFlags,
};

use crate::eval::captions::build_phrases;
use crate::eval::Format;
use crate::raster::stage3d::Stage3dScene;
use crate::raster::text::{Fonts, TextSpec};
use crate::raster::{self, Loaded};
use crate::sha256::sha256_hex;
use crate::svg::{self, SvgDocument};

/// Why a film could not be loaded or a frame not rendered.
#[derive(Debug)]
pub enum RenderError {
    /// The IR document was refused by the loader.
    Ir(LoadError),
    /// An asset file is missing, unreadable or outside the package directory.
    Asset {
        id: String,
        path: String,
        reason: String,
    },
    /// An SVG asset uses something the renderer does not support, or does not match its IR declaration.
    Svg { id: String, message: String },
    /// A font asset could not be loaded, or SVG text names a font the IR does not vendor.
    Font(String),
    /// The requested format is not declared by the IR.
    FormatNotDeclared(Format),
    /// The frame number is not inside the film.
    FrameOutOfRange { frame: u32, duration_frames: u32 },
    /// Skia could not create a surface or encode the image.
    Skia(String),
    /// The IR is valid but uses something this renderer does not draw.
    Unsupported(String),
    /// The Three stage could not be loaded or drawn.
    Stage3d(String),
}

impl fmt::Display for RenderError {
    /// Writes a one-line description naming what failed.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            RenderError::Ir(e) => write!(f, "{e}"),
            RenderError::Asset { id, path, reason } => write!(f, "asset {id:?} ({path}): {reason}"),
            RenderError::Svg { id, message } => write!(f, "svg asset {id:?}: {message}"),
            RenderError::Font(m) => write!(f, "font: {m}"),
            RenderError::Unsupported(m) => write!(f, "not drawn natively yet: {m}"),
            RenderError::Stage3d(m) => write!(f, "stage3d: {m}"),
            RenderError::FormatNotDeclared(format) => {
                write!(f, "the Render IR declares no {} format", format.name())
            }
            RenderError::FrameOutOfRange {
                frame,
                duration_frames,
            } => {
                write!(
                    f,
                    "frame {frame} is outside the film (frames 0 to {})",
                    duration_frames.saturating_sub(1)
                )
            }
            RenderError::Skia(m) => write!(f, "skia: {m}"),
        }
    }
}

impl std::error::Error for RenderError {}

/// One rendered frame: straight-alpha RGBA, 8 bits per channel, rows top to bottom.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RenderedFrame {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

impl RenderedFrame {
    /// The image info of this frame's pixel layout.
    fn info(&self) -> ImageInfo {
        ImageInfo::new(
            (self.width as i32, self.height as i32),
            ColorType::RGBA8888,
            AlphaType::Unpremul,
            None,
        )
    }

    /// Encodes the frame as PNG with Skia's encoder (deterministic for the same pixels).
    pub fn encode_png(&self) -> Result<Vec<u8>, RenderError> {
        let info = self.info();
        let mut pixels = self.rgba.clone();
        let pixmap = Pixmap::new(&info, &mut pixels, self.width as usize * 4)
            .ok_or_else(|| RenderError::Skia("cannot wrap the frame's pixels".into()))?;
        let data = skia_safe::png_encoder::encode_pixmap(&pixmap, &Default::default())
            .ok_or_else(|| RenderError::Skia("PNG encoding failed".into()))?;
        Ok(data.as_bytes().to_vec())
    }
}

/// What renderers of one IR share instead of loading again (the video workers): the Three stage (its mesh and painted faces) and the decoded pictures.
#[derive(Clone, Default)]
pub struct SharedAssets {
    pub stage3d: Option<Arc<Stage3dScene>>,
    pub images: Option<Arc<BTreeMap<String, Image>>>,
}

/// A loaded film that renders frames.
pub struct Renderer {
    loaded: Loaded,
    package_dir: PathBuf,
}

/// Resolves a package-relative asset path, refusing one that leaves the package (including through a symlink).
fn resolve_asset(package: &Path, asset: &Asset) -> Result<PathBuf, RenderError> {
    let fail = |reason: String| RenderError::Asset {
        id: asset.id().to_string(),
        path: asset.path().to_string(),
        reason,
    };
    if !aideos_render_ir::is_safe_relative_path(asset.path()) {
        return Err(fail("the path is not a safe package-relative path".into()));
    }
    let joined = package.join(asset.path());
    let real = joined
        .canonicalize()
        .map_err(|e| fail(format!("cannot open {}: {e}", joined.display())))?;
    let root = package
        .canonicalize()
        .map_err(|e| fail(format!("cannot open the package directory: {e}")))?;
    if !real.starts_with(&root) {
        return Err(fail(
            "the file resolves outside the package directory".into(),
        ));
    }
    Ok(real)
}

/// Reads an asset file's bytes.
fn read_asset(package: &Path, asset: &Asset) -> Result<Vec<u8>, RenderError> {
    let path = resolve_asset(package, asset)?;
    std::fs::read(&path).map_err(|e| RenderError::Asset {
        id: asset.id().to_string(),
        path: asset.path().to_string(),
        reason: e.to_string(),
    })
}

/// The Three stage of an IR (at most one, at the top of the stage), loaded with its mesh file from the package.
fn load_stage3d(
    ir: &RenderIr,
    package_dir: &Path,
) -> Result<Option<Arc<Stage3dScene>>, RenderError> {
    let Some(Node::Stage3d(node)) = ir
        .stage
        .iter()
        .find(|n| matches!(n, Node::Stage3d(_)))
    else {
        return Ok(None);
    };
    let asset = ir
        .assets
        .iter()
        .find(|a| a.id() == node.mesh)
        .ok_or_else(|| {
            RenderError::Stage3d(format!(
                "{}: the mesh asset {:?} is not declared",
                node.id, node.mesh
            ))
        })?;
    let Asset::Mesh(mesh) = asset else {
        return Err(RenderError::Stage3d(format!(
            "{}: asset {:?} is not a mesh",
            node.id, node.mesh
        )));
    };
    let bytes = read_asset(package_dir, asset)?;
    let parts = decode_mesh(&bytes, mesh).map_err(|e| RenderError::Asset {
        id: mesh.id.clone(),
        path: mesh.path.clone(),
        reason: e.0,
    })?;
    let scene = Stage3dScene::load(node, parts).map_err(RenderError::Stage3d)?;
    Ok(Some(Arc::new(scene)))
}

/// Decodes the image asset an image node draws, once at load: its bytes must be the pinned ones (sha256) and decode to exactly the declared size. The pixels are decoded eagerly with mipmaps, so no frame decodes or builds them again.
fn load_image(package_dir: &Path, asset: &Asset) -> Result<Image, RenderError> {
    let Asset::Image(a) = asset else {
        return Err(RenderError::Unsupported(format!("asset {:?} is not an image", asset.id())));
    };
    let fail = |reason: String| RenderError::Asset {
        id: a.id.clone(),
        path: a.path.clone(),
        reason,
    };
    let bytes = read_asset(package_dir, asset)?;
    if let Some(pin) = &a.sha256 {
        let actual = sha256_hex(&bytes);
        if &actual != pin {
            return Err(fail(format!("the file's sha256 is {actual}, not the pinned {pin}")));
        }
    }
    let encoded = Image::from_encoded(Data::new_copy(&bytes))
        .ok_or_else(|| fail("not a decodable image (PNG or JPEG)".into()))?;
    if encoded.width() != a.width.0 as i32 || encoded.height() != a.height.0 as i32 {
        return Err(fail(format!(
            "the image is {} x {} pixels, the IR declares {} x {}",
            encoded.width(),
            encoded.height(),
            a.width.0,
            a.height.0
        )));
    }
    // Decoded once into the frame surface's own layout (N32, premultiplied, no colour space, so no colour
    // conversion per draw), and marked opaque when every pixel is, so Skia blits it on its fast integer path.
    let (w, h) = (encoded.width(), encoded.height());
    let row = w as usize * 4;
    let premul = ImageInfo::new((w, h), ColorType::N32, AlphaType::Premul, None);
    let mut pixels = vec![0u8; row * h as usize];
    if !encoded.read_pixels(&premul, &mut pixels, row, (0, 0), skia_safe::image::CachingHint::Disallow) {
        return Err(fail("the image could not be decoded".into()));
    }
    let opaque = pixels.chunks_exact(4).all(|p| p[3] == 255);
    let info = if opaque { premul.with_alpha_type(AlphaType::Opaque) } else { premul };
    let raster = skia_safe::images::raster_from_data(&info, Data::new_copy(&pixels), row)
        .ok_or_else(|| fail("the decoded image could not be wrapped".into()))?;
    Ok(raster.with_default_mipmaps().unwrap_or(raster))
}

/// Visits every node of a tree, depth first.
fn walk<'a>(nodes: &'a [Node], out: &mut Vec<&'a Node>) {
    for n in nodes {
        out.push(n);
        if let Node::Group(g) = n {
            walk(&g.children, out);
        }
    }
}

impl Renderer {
    /// Loads an IR file; assets resolve against `package_dir`, or the IR file's own directory when None.
    pub fn open(
        ir_path: impl AsRef<Path>,
        package_dir: Option<&Path>,
    ) -> Result<Renderer, RenderError> {
        let ir_path = ir_path.as_ref();
        let ir = load_from_path(ir_path).map_err(RenderError::Ir)?;
        let package = match package_dir {
            Some(p) => p.to_path_buf(),
            None => ir_path
                .parent()
                .map_or_else(|| PathBuf::from("."), Path::to_path_buf),
        };
        Renderer::new(ir, &package)
    }

    /// Loads a validated IR's assets from the package directory and prepares every frame-independent input.
    pub fn new(ir: RenderIr, package_dir: &Path) -> Result<Renderer, RenderError> {
        Renderer::new_sharing(ir, package_dir, SharedAssets::default())
    }

    /// Opens an IR file like `open`, reusing the Three stage another renderer of the same IR already loaded (its mesh and its painted faces, from `stage3d_scene`), so worker threads paint each face program once.
    pub fn open_sharing(
        ir_path: impl AsRef<Path>,
        package_dir: Option<&Path>,
        stage: Option<Arc<Stage3dScene>>,
    ) -> Result<Renderer, RenderError> {
        Renderer::open_shared(ir_path, package_dir, SharedAssets { stage3d: stage, images: None })
    }

    /// Opens an IR file like `open`, reusing everything another renderer of the same IR already loaded (`shared_assets`): the Three stage and the decoded pictures, so worker threads decode each picture once and share its pixels.
    pub fn open_shared(
        ir_path: impl AsRef<Path>,
        package_dir: Option<&Path>,
        shared: SharedAssets,
    ) -> Result<Renderer, RenderError> {
        let ir_path = ir_path.as_ref();
        let ir = load_from_path(ir_path).map_err(RenderError::Ir)?;
        let package = match package_dir {
            Some(p) => p.to_path_buf(),
            None => ir_path
                .parent()
                .map_or_else(|| PathBuf::from("."), Path::to_path_buf),
        };
        Renderer::new_sharing(ir, &package, shared)
    }

    /// Loads a validated IR like `new`; `shared` holds what another renderer of the same IR loaded (the Three stage, the decoded pictures), used instead of loading it again.
    fn new_sharing(
        ir: RenderIr,
        package_dir: &Path,
        shared: SharedAssets,
    ) -> Result<Renderer, RenderError> {
        let mut svgs: BTreeMap<String, SvgDocument> = BTreeMap::new();
        let mut font_files = Vec::new();
        for asset in &ir.assets {
            match asset {
                Asset::Svg(a) => {
                    let bytes = read_asset(package_dir, asset)?;
                    let text = String::from_utf8(bytes).map_err(|_| RenderError::Svg {
                        id: a.id.clone(),
                        message: "not UTF-8 text".into(),
                    })?;
                    let doc = svg::parse(&text).map_err(|e| RenderError::Svg {
                        id: a.id.clone(),
                        message: e.0,
                    })?;
                    if let Some(missing) = a.element_ids.iter().find(|id| !doc.ids.contains(*id)) {
                        return Err(RenderError::Svg {
                            id: a.id.clone(),
                            message: format!(
                                "declares element {missing:?}, which the artwork does not contain"
                            ),
                        });
                    }
                    svgs.insert(a.id.clone(), doc);
                }
                Asset::Font(a) => {
                    font_files.push((
                        a.id.clone(),
                        a.family.clone(),
                        a.weight.0,
                        read_asset(package_dir, asset)?,
                    ));
                }
                // Images are decoded below for the image nodes that draw them; audio is not drawn; a mesh is read below, for the stage3d node that names it.
                Asset::Image(_) | Asset::Audio(_) | Asset::Mesh(_) => {}
            }
        }
        // Only the images an image node draws are decoded; an image asset nothing draws stays a declared file.
        let images = match shared.images {
            Some(images) => images,
            None => {
                let mut stage_nodes = Vec::new();
                walk(&ir.stage, &mut stage_nodes);
                let mut images: BTreeMap<String, Image> = BTreeMap::new();
                for node in stage_nodes {
                    let Node::Image(n) = node else { continue };
                    if images.contains_key(&n.asset) {
                        continue;
                    }
                    let asset = ir.assets.iter().find(|a| a.id() == n.asset).ok_or_else(|| {
                        RenderError::Unsupported(format!("image node {:?} names no asset", n.id))
                    })?;
                    images.insert(n.asset.clone(), load_image(package_dir, asset)?);
                }
                Arc::new(images)
            }
        };
        let fonts = Fonts::load(font_files).map_err(|e| RenderError::Font(e.0))?;
        for (id, doc) in &svgs {
            for (family, weight) in raster::svg::text_fonts(doc) {
                if fonts.resolve_family(&family, weight).is_none() {
                    return Err(RenderError::Font(format!(
                        "svg asset {id:?} sets text in {family:?}, which no font asset of the Render IR provides"
                    )));
                }
            }
        }
        check_glyph_tracks(&ir, &fonts)?;
        let phrases = caption_phrases(&ir, &fonts);
        let stage3d = match shared.stage3d {
            Some(scene) => Some(scene),
            None => load_stage3d(&ir, package_dir)?,
        };
        Ok(Renderer {
            loaded: Loaded {
                ir,
                svgs,
                images,
                fonts,
                phrases,
                stage3d,
            },
            package_dir: package_dir.to_path_buf(),
        })
    }

    /// What other renderers of the same IR can reuse (`open_shared`): the Three stage and the decoded pictures.
    pub fn shared_assets(&self) -> SharedAssets {
        SharedAssets {
            stage3d: self.loaded.stage3d.clone(),
            images: Some(self.loaded.images.clone()),
        }
    }

    /// The loaded Three stage, to hand to `open_sharing` so other renderers of the same IR reuse it.
    pub fn stage3d_scene(&self) -> Option<Arc<Stage3dScene>> {
        self.loaded.stage3d.clone()
    }

    /// The loaded IR.
    pub fn ir(&self) -> &RenderIr {
        &self.loaded.ir
    }

    /// The package directory assets were read from.
    pub fn package_dir(&self) -> &Path {
        &self.package_dir
    }

    /// The pixel size of a declared format.
    pub fn frame_size(&self, format: Format) -> Result<(u32, u32), RenderError> {
        format
            .pick(&self.loaded.ir.formats)
            .map(|s| (s.width.0, s.height.0))
            .ok_or(RenderError::FormatNotDeclared(format))
    }

    /// Checks a frame request against the film.
    fn check(&self, format: Format, frame: u32) -> Result<(u32, u32), RenderError> {
        let size = self.frame_size(format)?;
        let duration_frames = self.loaded.ir.film.duration_frames.0;
        if frame >= duration_frames {
            return Err(RenderError::FrameOutOfRange {
                frame,
                duration_frames,
            });
        }
        Ok(size)
    }

    /// Draws a frame onto any canvas of the format's size (a CPU raster or a GPU surface).
    pub fn draw(&self, canvas: &Canvas, format: Format, frame: u32) -> Result<(), RenderError> {
        let (w, h) = self.check(format, frame)?;
        raster::draw_frame(canvas, &self.loaded, format, frame, w, h)
    }

    /// Renders a frame on Skia's CPU rasterizer, the deterministic reference.
    pub fn render_frame(&self, format: Format, frame: u32) -> Result<RenderedFrame, RenderError> {
        let (w, h) = self.check(format, frame)?;
        let info = ImageInfo::new_n32_premul((w as i32, h as i32), None);
        let mut surface = surfaces::raster(&info, None, Some(&frame_surface_props()))
            .ok_or_else(|| RenderError::Skia(format!("cannot create a {w}x{h} raster surface")))?;
        raster::draw_frame(surface.canvas(), &self.loaded, format, frame, w, h)?;
        read_rgba(&mut surface, w, h)
    }
}

/// Refuses a glyph track whose shaped index does not exist in every declared output format.
fn check_glyph_tracks(ir: &RenderIr, fonts: &Fonts) -> Result<(), RenderError> {
    let mut nodes = Vec::new();
    walk(&ir.overlay, &mut nodes);
    for node in nodes {
        let Node::Text(t) = node else { continue };
        let Some(tracks) = &t.glyph_tracks else { continue };
        if tracks.is_empty() { continue; }
        for format in [Format::Long, Format::Reel] {
            let Some(b) = format.pick(&t.placement) else { continue };
            let count = fonts.paragraph(&raster::text_spec(t, b.font_size), b.w as f32).glyph_count();
            if let Some(track) = tracks.iter().find(|track| track.glyph.0 as usize >= count) {
                return Err(RenderError::Unsupported(format!(
                    "text {:?} glyph {} is outside the {} shaped glyphs in {}", t.id, track.glyph.0, count, format.name()
                )));
            }
        }
    }
    Ok(())
}

/// Chrome's text contrast and gamma: Chromium builds Skia for Linux with `SK_GAMMA_CONTRAST=0.2` and
/// `SK_GAMMA_EXPONENT=1.2`, where Skia's own defaults (0.5 and sRGB) draw light text on a dark ground heavier than Chrome.
const TEXT_CONTRAST: f32 = 0.2;
const TEXT_GAMMA: f32 = 1.2;

/// The surface properties every frame surface is drawn with, so glyph masks get Chrome's contrast and gamma.
pub(crate) fn frame_surface_props() -> SurfaceProps {
    SurfaceProps::new_with_text_properties(SurfacePropsFlags::default(), PixelGeometry::Unknown, TEXT_CONTRAST, TEXT_GAMMA)
}

/// Reads a surface's pixels as straight-alpha RGBA8.
pub(crate) fn read_rgba(
    surface: &mut skia_safe::Surface,
    w: u32,
    h: u32,
) -> Result<RenderedFrame, RenderError> {
    let info = ImageInfo::new(
        (w as i32, h as i32),
        ColorType::RGBA8888,
        AlphaType::Unpremul,
        None,
    );
    let mut rgba = vec![0u8; w as usize * h as usize * 4];
    if !surface.read_pixels(&info, &mut rgba, w as usize * 4, (0, 0)) {
        return Err(RenderError::Skia("cannot read the frame's pixels".into()));
    }
    Ok(RenderedFrame {
        width: w,
        height: h,
        rgba,
    })
}

/// Splits every captions node into phrases once per declared format, measuring words with the vendored font.
fn caption_phrases(
    ir: &RenderIr,
    fonts: &Fonts,
) -> BTreeMap<(String, Format), Vec<crate::eval::captions::Phrase>> {
    let mut out = BTreeMap::new();
    let mut nodes = Vec::new();
    walk(&ir.overlay, &mut nodes);
    for node in nodes {
        let Node::Captions(c) = node else { continue };
        for format in [Format::Long, Format::Reel] {
            let (Some(size), Some(placement)) =
                (format.pick(&ir.formats), format.pick(&c.placement))
            else {
                continue;
            };
            let measure = |text: &str| {
                fonts.measure(&TextSpec {
                    text,
                    font: &c.font,
                    size: placement.font_size,
                    color: crate::svg::color::Rgba {
                        r: 1.0,
                        g: 1.0,
                        b: 1.0,
                        a: 1.0,
                    },
                    letter_spacing: 0.0,
                    line_height: None,
                    align: skia_safe::textlayout::TextAlign::Left,
                    shadows: Vec::new(),
                })
            };
            let phrases = build_phrases(
                &c.words,
                &placement.spans,
                ir.film.fps.0,
                f64::from(size.width.0),
                format,
                &measure,
            );
            out.insert((c.id.clone(), format), phrases);
        }
    }
    out
}
