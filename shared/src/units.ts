/**
 * Unit conversions between the operator's units and the register encodings.
 *
 * The Swing panels were labelled in microseconds, nanoseconds and hertz while the
 * registers take sample counts and 25 ns time bins. The conversions were scattered
 * inline through the `Adjust*` classes (`jSpinner4.getValue() * 1000`, a bare
 * `40000000 / 10` for the trigger mask); they are named and tested here.
 */

/** Detector sampling clock. One sample is one 25 ns time bin. */
export const SAMPLE_RATE_HZ = 40_000_000;
export const NS_PER_SAMPLE = 1_000_000_000 / SAMPLE_RATE_HZ; // 25 ns

/** Microseconds to samples: 1 µs = 40 samples at 40 MHz. */
export const usToSamples = (us: number): number => Math.round(us * (SAMPLE_RATE_HZ / 1_000_000));
export const samplesToUs = (s: number): number => s / (SAMPLE_RATE_HZ / 1_000_000);

/** Nanoseconds to 25 ns time bins. */
export const nsToTbins = (ns: number): number => Math.round(ns / NS_PER_SAMPLE);
export const tbinsToNs = (t: number): number => t * NS_PER_SAMPLE;

/**
 * Trigger frequency to the trigger mask period, in clock ticks.
 * The Java wrote this as `40000000 / 10` for its 10 Hz default.
 */
export const hzToTrgMask = (hz: number): number =>
  hz <= 0 ? 0 : Math.round(SAMPLE_RATE_HZ / hz);
export const trgMaskToHz = (mask: number): number => (mask <= 0 ? 0 : SAMPLE_RATE_HZ / mask);

/** Milliseconds to the millisecond-resolution fields of the muon-veto register. */
export const msToTicks = (ms: number): number => Math.round(ms);

/** Clamp a value into an inclusive range, reporting whether it had to move. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
