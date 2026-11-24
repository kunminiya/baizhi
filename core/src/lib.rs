use wasm_bindgen::prelude::*;
mod time;
mod todos;

#[wasm_bindgen]
#[derive(Default)]
pub struct Edge {
    top: f64,
    sampled: f64,
    speed: f64,
    x: f64,
    v: f64,
    frame: f64,
}

#[wasm_bindgen]
impl Edge {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self::default()
    }

    pub fn sample_origin(&mut self, top: f64, now: f64) {
        self.top = top;
        self.sampled = now;
    }

    pub fn scroll(&mut self, top: f64, extent: f64, now: f64, dragging: bool) -> i32 {
        let dt = now - self.sampled;
        if dt > 0.0 && dt < 120.0 {
            self.speed = (top - self.top) / dt * 1000.0;
        }
        self.sample_origin(top, now);
        if !dragging {
            if top <= 0.5 && self.speed < -180.0 {
                return 1;
            }
            if top >= extent.max(0.0) - 0.5 && self.speed > 180.0 {
                return -1;
            }
        }
        0
    }

    pub fn start(&mut self, direction: i32, now: f64) -> f64 {
        self.x = f64::from(direction) * (self.speed.abs() * 0.07).clamp(24.0, 35.0);
        self.v = self.x * 10.0;
        self.frame = now;
        self.x
    }

    pub fn step(&mut self, now: f64) -> f64 {
        let dt = (now - self.frame).min(32.0) / 1000.0;
        self.frame = now;
        self.v += (-self.x * 145.0 - self.v * 20.0) * dt;
        self.x += self.v * dt;
        self.x
    }

    pub fn settled(&self) -> bool {
        self.x.abs() < 0.12 && self.v.abs() < 0.12
    }
}

// NaN means this move belongs to the native scroller.
#[wasm_bindgen]
pub fn drag(dy: f64, top: f64, extent: f64, active: bool) -> f64 {
    if active || (top <= 0.5 && dy > 0.0) || (top >= extent - 0.5 && dy < 0.0) {
        (dy * 0.18).clamp(-22.0, 22.0)
    } else {
        f64::NAN
    }
}

#[inline]
fn smooth(t: f64) -> f64 {
    let x = t.clamp(0.0, 1.0);
    x * x * (3.0 - 2.0 * x)
}

#[inline]
fn compute_reel(top: f64, h: f64, horizon: f64, row: f64, row_height: f64, done: bool) -> [f64; 6] {
    let mid = row + row_height * 0.5;
    let rise = ((horizon - mid) / (horizon - top)).clamp(0.0, 1.0);
    let soft = smooth(rise * rise * (1.15 - 0.15 * rise));
    let below = smooth((mid - horizon) / (h * 0.2));
    let opacity = (1.0 - soft * 0.92 - below * 0.1) * if done { 0.9 } else { 1.0 };
    [
        -soft * 18.0,
        -soft * 220.0 - below * 16.0,
        soft * 58.0 - below * 10.0,
        1.0 - soft * 0.58 - below * 0.05,
        ((soft - 0.45) * 3.4).max(0.0),
        opacity.clamp(0.04, 1.0),
    ]
}

#[wasm_bindgen]
pub fn reel(top: f64, height: f64, row: f64, row_height: f64, done: bool) -> Box<[f64]> {
    let h = height.max(1.0);
    let horizon = top + h * 0.82;
    Box::new(compute_reel(top, h, horizon, row, row_height, done))
}

/// Batch-compute reel transforms for all visible rows in a single Wasm call.
/// `inputs`: flat `[row_top, row_height, done_flag (0/1), ...]` (stride 3).
/// `out`: flat `[y, z, rot_x, scale, blur, opacity, ...]` (stride 6).
#[wasm_bindgen]
pub fn reel_batch(top: f64, height: f64, inputs: &[f64], out: &mut [f64]) {
    let h = height.max(1.0);
    let horizon = top + h * 0.82;
    let count = (inputs.len() / 3).min(out.len() / 6);
    for i in 0..count {
        let base_in = i * 3;
        let base_out = i * 6;
        let vals = compute_reel(
            top,
            h,
            horizon,
            inputs[base_in],
            inputs[base_in + 1],
            inputs[base_in + 2] != 0.0,
        );
        out[base_out..base_out + 6].copy_from_slice(&vals);
    }
}
