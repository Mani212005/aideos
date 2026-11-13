//! File Description: The damped spring the kinetic captions use for the active word's settle (Remotion's `spring` with mass 1 from 0 to 1, no overshoot clamping), solved in closed form so any frame can be evaluated on its own.
//! Inputs and outputs: frames since the spring started, fps, damping and stiffness -> spring position (0 at rest start, settling to 1).
//! Used by: crate::eval::captions.

/// Position of a unit spring released from 0 at rest, `frames` frames after release.
pub fn spring(frames: f64, fps: f64, damping: f64, stiffness: f64) -> f64 {
    let t = frames.max(0.0) / fps;
    let omega0 = stiffness.sqrt();
    let zeta = damping / (2.0 * stiffness.sqrt());
    if zeta < 1.0 {
        // Underdamped: decaying oscillation round the target.
        let omega1 = omega0 * (1.0 - zeta * zeta).sqrt();
        let envelope = (-zeta * omega0 * t).exp();
        1.0 - envelope * ((zeta * omega0 / omega1) * (omega1 * t).sin() + (omega1 * t).cos())
    } else if zeta > 1.0 {
        // Overdamped: two decaying exponentials, no oscillation.
        let root = (zeta * zeta - 1.0).sqrt();
        let r1 = -omega0 * (zeta - root);
        let r2 = -omega0 * (zeta + root);
        let c2 = r1 / (r1 - r2);
        let c1 = 1.0 - c2;
        1.0 - (c1 * (r1 * t).exp() + c2 * (r2 * t).exp())
    } else {
        // Critically damped.
        1.0 - (1.0 + omega0 * t) * (-omega0 * t).exp()
    }
}
