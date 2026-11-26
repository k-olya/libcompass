import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  Circle, PlanarCurve, SpatialCurve, SpatialSurface, Face, Solid, Sketch,
  circle, planarCurve, spatialCurve, spatialSurface, face, solid, polyline, svgPath,
  sketch, rectangle, measure, annotate, chamfer, round, searchBoundaries,
  Plane, SpatialLine, Edge, RuledSurface, TrimmedSurface, SurfaceRegion, XY,
} from 'libcompass';

const sameMesh = (a,b) => assert.deepEqual(a.triangulate(),b.triangulate());
const box = () => sketch().add(rectangle({ width: 4, height: 4 })).extrude(4);

test('sketch constructors accept a Plane or Face directly with the same placement as options', () => {
  const plane = new Plane({ a: [2, 3, 4], b: [2, 4, 4], c: [2, 3, 5] });
  const face = box().surfaces[1];
  for (const make of [sketch, value => new Sketch(value)]) {
    for (const placement of [plane, face]) {
      const direct = make(placement), wrapped = make({ plane: placement });
      assert.equal(direct.plane, placement instanceof Face ? placement.plane : placement);
      assert.equal(direct.plane, wrapped.plane);
      assert.deepEqual(direct.elements, []);
      sameMesh(direct.add(circle(1)).extrude(2), wrapped.add(circle(1)).extrude(2));
    }
    assert.notEqual(make().plane, make({}).plane);
    assert.throws(() => make({ plane: {} }), TypeError);
  }
});

test('approved constructor shorthands and constructors accept direct values and preserve options', () => {
  for (const make of [circle, value => new Circle(value)]) {
    assert.deepEqual(make(2).sample(), make({radius:2}).sample());
    assert.deepEqual(make({radius:2,center:{x:3,y:4}}).center,{x:3,y:4});
  }
  const at2 = t => ({x:2*t,y:t*t}), at3 = t => ({position:[2*t,0,t*t]});
  for (const make of [planarCurve, value => new PlanarCurve(value)]) assert.deepEqual(make(at2).sample(),make({at:at2}).sample());
  for (const make of [spatialCurve, value => new SpatialCurve(value)]) assert.deepEqual(make(at3).sample(),make({at:at3}).sample());
  const atSurface = (u,v) => ({position:[u,v,u*v]});
  for (const make of [spatialSurface, value => new SpatialSurface(value)]) {
    assert.deepEqual(make(atSurface).at(0.3,0.7),make({at:atSurface}).at(0.3,0.7));
    sameMesh(make(atSurface),make({at:atSurface}));
  }
  const source = box(), outer = Object.freeze([...source.surfaces[0].outer]);
  for (const make of [face, value => new Face(value)]) {
    sameMesh(make(outer),make({outer}));
    assert.equal(make(outer).outer[0],outer[0]);
  }
  const surfaces = Object.freeze([...source.surfaces]);
  for (const make of [solid, value => new Solid(value)]) {
    sameMesh(make(surfaces),make({surfaces}));
    assert.deepEqual(make(surfaces).boundaries,source.boundaries);
    assert.equal(make([]).surfaces.length,0);
  }
  const points = Object.freeze([{x:0,y:0},{x:2,y:0},{x:2,y:2}].map(Object.freeze));
  assert.deepEqual(polyline(points),polyline({points}));
  assert.equal(polyline(points).length,2);assert.equal(polyline({points,loop:true}).length,3);
  assert.throws(()=>svgPath('M0 0L1 1'),/requires browser SVG path geometry APIs/);
});

test('direct solid operations retain default settings and measurement logging', t => {
  const source = box(), cache = source.triangulate();
  sameMesh(chamfer(source),chamfer({solid:source}));
  sameMesh(round(source),round({solid:source}));
  assert.deepEqual(searchBoundaries(source),source.boundaries);
  assert.deepEqual(searchBoundaries(source),searchBoundaries({solid:source}));
  const group = annotate(source);
  assert.deepEqual(group.children,[source]);assert.equal(group.alpha,1);assert.match(group.name,/^mesh\d+$/);
  assert.equal(source.triangulate(),cache);
  const log=t.mock.method(console,'log',()=>{});
  assert.deepEqual(measure(source),measure({object:source}));
  assert.equal(log.mock.callCount(),2);
  assert.ok(Math.abs(measure(Object.freeze([source,source])).volume - 128) < 1e-10);
  assert.deepEqual(measure({x:3,y:4}).boundingBox.size,[0,0,0]);
  assert.deepEqual(measure({position:[1,2,3]}).boundingBox.min,[1,2,3]);
});

test('numeric round matches options and retains validation and source caches', () => {
  const source = box(), cache = source.triangulate();
  sameMesh(source.round(0.2), source.round({ radius: 0.2 }));
  for (const value of [0, -1, NaN, Infinity]) {
    assert.throws(() => source.round(value), RangeError);
  }
  assert.equal(source.triangulate(), cache);
});

test('direct sketch, containment, lifting and boolean methods match their options forms', () => {
  const s = sketch().add(circle(1));
  sameMesh(s.extrude(2),s.extrude({length:2}));
  sameMesh(s.extrude(-2),s.extrude({length:-2}));
  const path = spatialCurve(t=>({position:[0,0,2*t]}));
  sameMesh(s.extrudeAlongCurve(path),s.extrudeAlongCurve({curve:path}));
  const loop = circle(2);
  for (const point of [{x:0,y:0},{x:3,y:0},{x:2,y:0}]) assert.equal(loop.contains(point),loop.contains({point}));
  assert.deepEqual(SpatialCurve.fromPlanarCurve(loop).sample(),SpatialCurve.fromPlanarCurve({curve:loop}).sample());
  const plain = {at:t=>({x:t,y:0})};
  assert.deepEqual(SpatialCurve.fromPlanarCurve(plain).at(0.5).position,[0.5,0,0]);
  const source=box(),tool=box().displace([2,0,0]);
  sameMesh(source.intersect(tool),source.intersect({tool}));
  sameMesh(source.difference(tool),source.difference({tool}));
});

test('direct displacement works for arrays, typed vectors and every supported class without mutation', () => {
  const source = box(), edge = source.boundaries[0], lower=SpatialCurve.fromPlanarCurve(circle(1));
  const upper=SpatialCurve.fromPlanarCurve({curve:circle(1),plane:XY.displace([0,0,2])});
  const ruled = new RuledSurface({start:lower,end:upper});
  const trimmed = new TrimmedSurface({surface:ruled,at:(u,v)=>({x:u,y:v}),boundaryLoops:ruled.boundaryLoops,sides:ruled.sides});
  const uv = [{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}];
  const trims = uv.map((start,i) => {
    const end = uv[(i+1)%4];
    return { boundary: new Edge({ start: {position:[start.x,start.y,0]}, end: {position:[end.x,end.y,0]} }),
      at: t => ({x:start.x+(end.x-start.x)*t,y:start.y+(end.y-start.y)*t}) };
  });
  const region = new SurfaceRegion({surface:spatialSurface((u,v)=>({position:[u,v,0]})),
    regions:[{outer:trims}],boundaryLoops:[trims.map(trim=>trim.boundary)]});
  for (const object of [new Plane(), new SpatialLine({direction:[0,0,1]}), lower,
    new Edge({start:edge.start,end:edge.end}), source,...source.surfaces,ruled,trimmed,region,
    new SpatialSurface((u,v)=>({position:[u,v,u*v]}))]) {
    for (const vector of [Object.freeze([1,2,3]),new Float32Array([1,2,3])]) {
      const direct=object.displace(vector),options=object.displace({vector});
      assert.notEqual(direct,object);assert.equal(direct.constructor,object.constructor);
      if (typeof direct.triangulate==='function') sameMesh(direct,options);
      else if (typeof direct.at==='function') assert.deepEqual(direct.at(0.3),options.at(0.3));
      else assert.deepEqual(direct,options);
      assert.deepEqual(Array.from(vector),[1,2,3]);
    }
  }
});
