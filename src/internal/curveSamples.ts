/** Parameters travel with evaluated point identities without changing public point shapes. */
const parameters = new WeakMap<object, WeakMap<object, number>>();

/** Normalized-parameter roundoff through composed charts, trims and reversals. */
export const sampleParameterTolerance = 4096 * Number.EPSILON;

export function rememberSample<T extends object>(curve: object, point: T, t: number): T {
  let samples = parameters.get(curve);
  if (!samples) parameters.set(curve, samples = new WeakMap());
  samples.set(point, t);
  return point;
}

export function sampleParameter(curve: object, point: object, i: number, count: number): number | undefined {
  return i === 0 ? 0 : i === count - 1 ? 1 : parameters.get(curve)?.get(point);
}

/** Always call sample(), including overrides; never guess t from sample order or arc length. */
export function parameterizedSamples<T extends object>(curve: { sample(options?: { resolution?: number }): T[] }, options: { resolution?: number } = {}): { t: number; point: T }[] {
  const points = curve.sample(options);
  if (points.length < 2) throw new RangeError('Curve sampling must include both endpoints');
  const result = points.map((point, i) => {
    const t = sampleParameter(curve, point, i, points.length);
    if (t === undefined || !Number.isFinite(t)) {
      throw new RangeError('Parameterized sampling needs sample() overrides to return points created by this.at(t)');
    }
    return { t, point };
  });
  if (result.some(({ t }, i) => i > 0 && t <= result[i - 1].t)) throw new RangeError('Curve samples must have increasing parameters');
  return result;
}
