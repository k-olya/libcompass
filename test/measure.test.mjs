import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { measure, sketch, rectangle, lineSegment, circle, planarCurve, spatialCurve, spatialCurveFromPlanar, edge, plane, line, node, memo, spatialLine, solid, XY, ZX, Z, setTriangulationResolution, TRIANGULATION_RESOLUTION } from 'libcompass';

const capture = object => { const logs = []; const result = measure({ object, log: data => logs.push(data) }); assert.deepEqual(logs, [result]); return result; };
const close = (a, b, tolerance = 1e-8) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
const box = () => sketch().add(rectangle({ corner1: {x: 0, y: 0}, corner2: {x: 2, y: 3} })).extrude({length: 4});

test('measure returns and logs one snapshot, with exact segment/edge bounds and summed lengths', () => {
  const segment = lineSegment({start: {x: -1, y: -2}, end: {x: 2, y: 2}});
  const first = capture(segment);
  assert.deepEqual(first, {boundingBox: {min: [-1,-2,0], max: [2,2,0], size: [3,4,0]}, length: 5});
  const spatial = edge({start: {position: [2,2,0]}, end: {position: [2,2,12]}});
  const combined = capture([segment, spatial]);
  close(combined.length, 17); assert.deepEqual(combined.boundingBox.size, [3,4,12]);
  close(capture(spatialCurve({at:t=>({position:[3*t,4*t,12*t]})})).length,13);
  const spy = mock.method(console, 'log', () => {});
  try { const result = measure({object: segment}); assert.equal(spy.mock.callCount(), 1); assert.equal(spy.mock.calls[0].arguments[0], result); }
  finally { spy.mock.restore(); }
});

test('sketch bounds use its placement and include finite construction points, excluding infinite lines', () => {
  const s = sketch({plane: ZX.displace({vector: [4,5,6]})}).add(rectangle({corner1: {x:-2,y:-3},corner2:{x:2,y:3}}));
  s.add({x:0,y:10}, line({point:{x:100,y:100},direction:[1,0]}));
  assert.deepEqual(capture(s), {boundingBox: {min:[1,5,4],max:[14,5,8],size:[13,0,4]}});
  assert.deepEqual(capture([{x:-1,y:2},{position:[3,4,5]}]).boundingBox, {min:[-1,2,0],max:[3,4,5],size:[4,2,5]});
  assert.deepEqual(capture(sketch()), {boundingBox:null});
});

test('curves respect sample overrides, and finer resolution improves polyline measurements', () => {
  let calls = 0;
  const curve = planarCurve({at: t => ({x:t,y:4*Math.sin(2*Math.PI*t)**2})});
  curve.sample = () => { calls++; return [0,.25,.5,.75,1].map(t=>curve.at(t)); };
  const lifted = spatialCurveFromPlanar({curve,plane:ZX});
  const data = capture([curve, lifted]);
  assert.equal(calls, 2); close(data.length, 8*Math.hypot(.25,4));
  assert.deepEqual(data.boundingBox, {min:[0,0,0],max:[4,4,1],size:[4,4,1]});
  const previous = TRIANGULATION_RESOLUTION;
  try {
    const c = circle({center:{x:0,y:0},radius:2});
    setTriangulationResolution(.1); const coarse = capture(c);
    setTriangulationResolution(.001); const fine = capture(c);
    assert.ok(Math.abs(fine.length-4*Math.PI)<Math.abs(coarse.length-4*Math.PI));
    assert.deepEqual(fine.boundingBox, {min:[-2,-2,0],max:[2,2,0],size:[4,4,0]});
  } finally {setTriangulationResolution(previous);}
});

test('surfaces measure triangle area; solids measure own volume, excluding children and caches', () => {
  const part = box(), cached = part.triangulate();
  const child = box().displace({vector:[100,100,100]}); part.add(child);
  const data = capture(part);
  close(data.volume, 24); assert.equal(data.surfaceArea, undefined);
  assert.deepEqual(data.boundingBox, {min:[0,0,0],max:[2,3,4],size:[2,3,4]});
  assert.equal(part.triangulate(), cached); assert.deepEqual(part.children,[child]);
  close(capture(part.surfaces).surfaceArea, 52);
  const displaced = part.displace({vector:[10000,-10000,50000]});
  close(capture(displaced).volume,24);
  close(capture([part, displaced]).volume,48);
  assert.equal(capture([part,part]).volume,48, 'Repeated solids are counted independently');
  assert.deepEqual(capture(solid({surfaces:[]})),{boundingBox:null,volume:0});
});

test('curved surfaces and a hollow solid measure at the configured tessellation resolution', () => {
  const previous = TRIANGULATION_RESOLUTION;
  try {
    setTriangulationResolution(.001);
    const part = sketch().add(circle({center:{x:0,y:0},radius:3}),circle({center:{x:0,y:0},radius:1})).extrude({length:2});
    const data = capture(part), area = capture(part.surfaces);
    close(data.volume,16*Math.PI,.03); close(area.surfaceArea,32*Math.PI,.04);
    assert.deepEqual(data.boundingBox, {min:[-3,-3,0],max:[3,3,2],size:[6,6,2]});
  } finally {setTriangulationResolution(previous);}
});

test('unsupported, infinite, mixed and empty input is rejected without output', () => {
  let logs = 0; const run = object => measure({object, log:()=>logs++});
  for(const object of [plane(),XY,line({point:{x:0,y:0},direction:[1,0]}),Z,spatialLine({direction:[1,0,0]}),node(),memo(),{},null,undefined,[box(),circle({center:{x:0,y:0},radius:1})],[[box()]]]) assert.throws(()=>run(object),TypeError);
  assert.throws(()=>run([]),RangeError);
  assert.throws(()=>run({x:Infinity,y:0}),RangeError);
  assert.throws(()=>measure({object:box(),log:123}),TypeError);
  assert.equal(logs,0);
});
