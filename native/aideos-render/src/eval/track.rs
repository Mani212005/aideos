//! File Description: Keyframe track evaluation for the Render IR: the project's easing curves (the same cubic beziers as `applySvgEasing` in src/dl/scene/svgAnimation.ts), the monotone cubic `spline` the scene camera uses (src/dl/scene/cameraTrack.ts with src/dl/motion/spline.ts), and the 4-decimal quantization the scene compiler applies to element state. Every value is a pure function of the keyframes and the frame number.
//! Inputs and outputs: keyframes, a frame number and the film length -> one f64 value.
//! Used by: crate::eval (camera, node tracks, element tracks, end card and caption timing).

use aideos_render_ir::types::{Ease, Keyframe};

/// Below this difference two keyframe values count as a hold, as in cameraTrack.ts.
const HOLD_EPSILON: f64 = 1e-6;

/// Solves a CSS cubic-bezier easing curve for y at x with the same fixed iterations as svgAnimation.ts.
fn cubic_bezier(x1: f64, y1: f64, x2: f64, y2: f64, x: f64) -> f64 {
    if x <= 0.0 {
        return 0.0;
    }
    if x >= 1.0 {
        return 1.0;
    }
    let curve_x = |t: f64| {
        let mt = 1.0 - t;
        3.0 * mt * mt * t * x1 + 3.0 * mt * t * t * x2 + t * t * t
    };
    let curve_y = |t: f64| {
        let mt = 1.0 - t;
        3.0 * mt * mt * t * y1 + 3.0 * mt * t * t * y2 + t * t * t
    };
    let curve_dx = |t: f64| {
        let mt = 1.0 - t;
        3.0 * mt * mt * x1 + 6.0 * mt * t * (x2 - x1) + 3.0 * t * t * (1.0 - x2)
    };
    // Newton-Raphson first, then bisection, exactly as the TypeScript twin does.
    let mut t = x;
    for _ in 0..8 {
        let error = curve_x(t) - x;
        if error.abs() < 1e-7 {
            return curve_y(t);
        }
        let dx = curve_dx(t);
        if dx.abs() < 1e-7 {
            break;
        }
        t -= error / dx;
    }
    let (mut lo, mut hi) = (0.0, 1.0);
    t = x;
    for _ in 0..32 {
        let value = curve_x(t);
        if (value - x).abs() < 1e-7 {
            break;
        }
        if value > x {
            hi = t;
        } else {
            lo = t;
        }
        t = (lo + hi) / 2.0;
    }
    curve_y(t)
}

/// The project's ease-out-expo curve, cubic-bezier(0.16, 1, 0.3, 1), clamped to [0, 1].
pub fn ease_expo_out(t: f64) -> f64 {
    cubic_bezier(0.16, 1.0, 0.3, 1.0, t.clamp(0.0, 1.0))
}

/// Maps progress in [0, 1] through a named easing; `spline` is not a progress curve and reads as linear here.
pub fn apply_ease(ease: Ease, t: f64) -> f64 {
    let t = t.clamp(0.0, 1.0);
    match ease {
        Ease::Linear | Ease::Spline => t,
        Ease::Hold => {
            if t >= 1.0 {
                1.0
            } else {
                0.0
            }
        }
        Ease::ExpoIn => cubic_bezier(0.7, 0.0, 0.84, 0.0, t),
        Ease::ExpoInOut => cubic_bezier(0.87, 0.0, 0.13, 1.0, t),
        Ease::ExpoOut => cubic_bezier(0.16, 1.0, 0.3, 1.0, t),
    }
}

/// Rounds to 4 decimal places and turns -0 into 0, like `quantize` in svgAnimation.ts.
pub fn quantize(value: f64) -> f64 {
    let rounded = (value * 1e4).round() / 1e4;
    if rounded == 0.0 {
        0.0
    } else {
        rounded
    }
}

/// One knot of the monotone spline: normalized time and value.
#[derive(Debug, Clone, Copy)]
struct Knot {
    t: f64,
    val: f64,
}

/// Evaluates the Fritsch-Carlson monotone cubic through sorted knots at normalized time t (motion/spline.ts).
fn monotone_spline(knots: &[Knot], t: f64) -> f64 {
    match knots.len() {
        0 => return 0.0,
        1 => return knots[0].val,
        _ => {}
    }
    let last = knots.len() - 1;
    if t <= knots[0].t {
        return knots[0].val;
    }
    if t >= knots[last].t {
        return knots[last].val;
    }
    let idx = (0..last)
        .find(|&i| t >= knots[i].t && t <= knots[i + 1].t)
        .unwrap_or(0);
    let width = |i: usize| (knots[i + 1].t - knots[i].t).max(1e-9);
    let slope = |i: usize| (knots[i + 1].val - knots[i].val) / width(i);
    // Zero at the ends and where the data holds or turns, else the weighted harmonic mean of the secants.
    let tangent = |i: usize| {
        if i == 0 || i == last {
            return 0.0;
        }
        let (d0, d1) = (slope(i - 1), slope(i));
        if d0 * d1 <= 0.0 {
            return 0.0;
        }
        let (h0, h1) = (width(i - 1), width(i));
        let (w0, w1) = (2.0 * h1 + h0, h1 + 2.0 * h0);
        (w0 + w1) / (w0 / d0 + w1 / d1)
    };
    let (k1, k2) = (knots[idx], knots[idx + 1]);
    let dt = width(idx);
    let u = ((t - k1.t) / dt).clamp(0.0, 1.0);
    let (u2, u3) = (u * u, u * u * u);
    (2.0 * u3 - 3.0 * u2 + 1.0) * k1.val
        + (u3 - 2.0 * u2 + u) * dt * tangent(idx)
        + (-2.0 * u3 + 3.0 * u2) * k2.val
        + (u3 - u2) * dt * tangent(idx + 1)
}

/// Builds the camera spline's knots: every keyframe at frame / (duration - 1), padded flat to both ends of the film.
fn spline_knots(keyframes: &[Keyframe], duration_frames: u32) -> Vec<Knot> {
    let span = f64::from(duration_frames.saturating_sub(1));
    let norm = |frame: u32| {
        if span > 0.0 {
            f64::from(frame) / span
        } else {
            0.0
        }
    };
    let mut knots: Vec<Knot> = keyframes
        .iter()
        .map(|k| Knot {
            t: norm(k.frame.0),
            val: k.value,
        })
        .collect();
    if let Some(first) = knots.first().copied() {
        if first.t > 0.0 {
            knots.insert(
                0,
                Knot {
                    t: 0.0,
                    val: first.val,
                },
            );
        }
    }
    if let Some(last) = knots.last().copied() {
        if last.t < 1.0 {
            knots.push(Knot {
                t: 1.0,
                val: last.val,
            });
        }
    }
    knots
}

/// The value of a track at a frame: hold the first value before it, the last after it, and ease each segment by its first keyframe.
pub fn sample(keyframes: &[Keyframe], frame: u32, duration_frames: u32) -> f64 {
    let (Some(first), Some(last)) = (keyframes.first(), keyframes.last()) else {
        return 0.0;
    };
    if keyframes.len() == 1 || frame <= first.frame.0 {
        return first.value;
    }
    if frame >= last.frame.0 {
        return last.value;
    }
    let next = keyframes
        .iter()
        .position(|k| k.frame.0 > frame)
        .unwrap_or(keyframes.len() - 1);
    let (k0, k1) = (&keyframes[next - 1], &keyframes[next]);
    // The loader guarantees an ease on every keyframe but the last; expoOut mirrors the TypeScript default.
    let ease = k0.ease.unwrap_or(Ease::ExpoOut);
    if ease == Ease::Spline {
        if (k0.value - k1.value).abs() < HOLD_EPSILON {
            return k0.value;
        }
        let span = f64::from(duration_frames.saturating_sub(1));
        let t = if span > 0.0 {
            f64::from(frame) / span
        } else {
            0.0
        };
        return monotone_spline(&spline_knots(keyframes, duration_frames), t);
    }
    let t = f64::from(frame - k0.frame.0) / f64::from(k1.frame.0 - k0.frame.0);
    k0.value + (k1.value - k0.value) * apply_ease(ease, t)
}
