use wasm_bindgen::prelude::*;

const HKT_OFFSET_SECS: i64 = 8 * 3600;
const SECS_PER_DAY: i64 = 86_400;

/// Howard Hinnant's civil-from-days algorithm: converts days since 1970-01-01 to (year, month, day).
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365; // [0, 399]
    let y = (yoe as i64) + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32; // [1, 31]
    let m = (if mp < 10 { mp + 3 } else { mp - 9 }) as u32; // [1, 12]
    let y = y + if m <= 2 { 1 } else { 0 };
    (y, m, d)
}

/// Pure Rust UTC+8 (Asia/Hong_Kong, no DST) date/time formatting — zero JS interop.
#[wasm_bindgen]
pub fn stamp(ms: f64, now: f64) -> String {
    if !ms.is_finite() || !now.is_finite() {
        return String::new();
    }
    let ms_sec = (ms / 1000.0).floor() as i64 + HKT_OFFSET_SECS;
    let now_sec = (now / 1000.0).floor() as i64 + HKT_OFFSET_SECS;

    let ms_day = ms_sec.div_euclid(SECS_PER_DAY);
    let now_day = now_sec.div_euclid(SECS_PER_DAY);
    let sod = ms_sec.rem_euclid(SECS_PER_DAY);
    let hour = (sod / 3600) as u32;
    let minute = ((sod % 3600) / 60) as u32;

    if ms_day == now_day {
        format!("今天 {hour:02}:{minute:02}")
    } else if ms_day == now_day - 1 {
        format!("昨天 {hour:02}:{minute:02}")
    } else {
        let (_, month, day) = civil_from_days(ms_day);
        format!("{month:02}-{day:02} {hour:02}:{minute:02}")
    }
}
