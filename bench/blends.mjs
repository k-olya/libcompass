import { performance } from 'node:perf_hooks';

// Pass an absolute dist/index.js path to compare another checkout.
const { sketch, circle, rectangle, roundPolyline, setTriangulationResolution } = await import(process.argv[2] ?? new URL('../dist/index.js', import.meta.url));
setTriangulationResolution(0.001);
const cases = [
  ['box', () => sketch().add(rectangle({ width: 10, height: 10 })).extrude(10)],
  ['cylinder', () => sketch().add(circle(5)).extrude(10)],
  ['rounded rectangle', () => sketch().add(roundPolyline({ segments: rectangle({ width: 20, height: 12 }), radius: 2 })).extrude(10)],
];
const rows = [], median = values => [...values].sort((a, b) => a - b)[values.length >> 1];
for (const [shape, create] of cases) for (const operation of ['round', 'chamfer']) {
  const source = create(), build = [], render = [];
  let triangles;
  for (let iteration = 0; iteration < 4; iteration++) {
    const start = performance.now(), result = source[operation]();
    const built = performance.now(); triangles = result.triangulate().length / 9;
    const end = performance.now();
    if (iteration) { build.push(built - start); render.push(end - built); }
  }
  rows.push({ shape, operation, buildMs: +median(build).toFixed(1), renderMs: +median(render).toFixed(2), triangles });
}
console.table(rows);
