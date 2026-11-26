//! File Description: Deterministic scene-space particles and SkSL colour transitions for native frames.
//! Inputs and outputs: effect data and fractional frame time -> Skia canvas operations.
//! Used by: crate::raster::draw_frame_at.

use super::{ir_color, text::to_color};
use crate::renderer::RenderError;
use aideos_render_ir::types::{ParticleEmitter, Transition, TransitionDirection, TransitionKind};
use skia_safe::{Canvas, Data, Paint, Rect, RuntimeEffect};

thread_local! {
    /// The bounded built-in transition shader, compiled once for each rendering thread.
    static TRANSITION: Result<RuntimeEffect, String> = RuntimeEffect::make_for_shader(
        "uniform float4 colour; uniform float progress; uniform float width; uniform float wipe; uniform float outgoing; half4 main(float2 p) { if (progress <= 0.0) return half4(colour); if (progress >= 1.0) return half4(0); float a = wipe > 0.5 ? smoothstep(progress * (width + 2.0) - 1.0, progress * (width + 2.0) + 1.0, mix(p.x, width - p.x, outgoing)) : 1.0 - progress; return half4(colour * a); }", None);
}

/// Produces a stable uniform random value without mutable state or platform-specific RNGs.
fn random(seed: u32, index: u32) -> f64 {
    let mut x = seed.wrapping_add(index.wrapping_mul(0x9e37_79b9));
    x ^= x >> 16;
    x = x.wrapping_mul(0x7feb_352d);
    x ^= x >> 15;
    x = x.wrapping_mul(0x846c_a68b);
    x ^= x >> 16;
    f64::from(x) / f64::from(u32::MAX)
}

/// Draws each particle directly from its seed and age, so seeks and shutter samples are reproducible.
pub fn draw_particles(
    canvas: &Canvas,
    emitters: &[ParticleEmitter],
    time: f64,
) -> Result<(), RenderError> {
    if emitters.len() > 16 {
        return Err(RenderError::Unsupported(
            "at most 16 particle emitters are supported".into(),
        ));
    }
    for e in emitters {
        if !(1..=1000).contains(&e.count.0)
            || !(1..=26_000_000).contains(&e.lifetime_frames.0)
            || ![
                e.x,
                e.y,
                e.velocity_x,
                e.velocity_y,
                e.spread,
                e.gravity,
                e.radius,
            ]
            .iter()
            .all(|v| v.is_finite())
            || e.spread < 0.0
            || e.radius <= 0.0
        {
            return Err(RenderError::Unsupported("invalid particle emitter".into()));
        }
        let elapsed = time - f64::from(e.start_frame.0);
        if elapsed < 0.0 {
            continue;
        }
        let lifetime = f64::from(e.lifetime_frames.0);
        let mut paint = Paint::default();
        paint.set_anti_alias(true);
        paint.set_color(to_color(ir_color(&e.color)));
        for i in 0..e.count.0 {
            let first_birth = lifetime * f64::from(i) / f64::from(e.count.0);
            if elapsed < first_birth {
                continue;
            }
            let age = (elapsed - first_birth).rem_euclid(lifetime);
            let vx = e.velocity_x + e.spread * (2.0 * random(e.seed.0, i.wrapping_mul(2)) - 1.0);
            let vy = e.velocity_y
                + e.spread * (2.0 * random(e.seed.0, i.wrapping_mul(2).wrapping_add(1)) - 1.0);
            let x = e.x + vx * age;
            let y = e.y + vy * age + 0.5 * e.gravity * age * age;
            canvas.draw_circle((x as f32, y as f32), e.radius as f32, &paint);
        }
    }
    Ok(())
}

/// Paints a fade or left-to-right wipe over the stage using a compiled SkSL runtime effect.
pub fn draw_transition(
    canvas: &Canvas,
    transition: &Transition,
    time: f64,
    width: u32,
    height: u32,
) -> Result<(), RenderError> {
    if transition.duration_frames.0 == 0 {
        return Err(RenderError::Unsupported(
            "transition duration must be positive".into(),
        ));
    }
    let mut progress = ((time - f64::from(transition.start_frame.0))
        / f64::from(transition.duration_frames.0))
    .clamp(0.0, 1.0) as f32;
    if transition.direction == TransitionDirection::Out {
        progress = 1.0 - progress;
    }
    let colour = ir_color(&transition.color);
    let a = colour.a;
    let uniforms = [
        colour.r * a,
        colour.g * a,
        colour.b * a,
        a,
        progress,
        width as f32,
        if transition.kind == TransitionKind::Wipe {
            1.0
        } else {
            0.0
        },
        if transition.direction == TransitionDirection::Out {
            1.0
        } else {
            0.0
        },
    ];
    let bytes: Vec<u8> = uniforms.iter().flat_map(|v| v.to_ne_bytes()).collect();
    TRANSITION.with(|effect| {
        let effect = effect
            .as_ref()
            .map_err(|e| RenderError::Skia(format!("transition shader: {e}")))?;
        let shader = effect
            .make_shader(Data::new_copy(&bytes), &[], None)
            .ok_or_else(|| RenderError::Skia("cannot instantiate transition shader".into()))?;
        let mut paint = Paint::default();
        paint.set_shader(shader);
        canvas.draw_rect(
            Rect::from_xywh(0.0, 0.0, width as f32, height as f32),
            &paint,
        );
        Ok(())
    })
}
