# libcompass

The CAD library behind compassts, built from sketches, reusable boundary topology,
and a scene graph. Extrusions return solids with exact curves, edges, and surfaces;
each solid is also a memoized node that can be added directly to a scene or
transform. Triangulation produces WebGL-compatible `Float32Array` XYZ triangle
positions. Applications provide their own UI, visualizer, exporters, or API.
Runtime dependencies are `gl-matrix` for vector math and `earcut` for polygon triangulation.

```sh
npm ci
npm run build
npm test
```

`src/` contains library code, `test/` contains Node.js tests, and `dist/` contains
compiled ES modules, declarations, and source maps. Development requires Node.js
22 or later. Modules have no side effects and can be imported individually:
`libcompass/Sketch`, or `libcompass/src/Sketch.ts` for apps compiling source.
Public API declarations retain their TSDoc descriptions, parameters, examples,
and error conditions. Compassts uses this source to generate its documentation
browser and Monaco type environment. Rebuild the library after source changes
to keep the runtime in sync with those declarations.

Tests cover geometry validation, holes and nested profiles, outward winding and
watertight meshes, shared topology, scene composition, transforms, and explicit
cache invalidation.

## Sketch and extrude

```ts
import { Circle, Face, LineSegment, Plane, Sketch, extrude } from 'libcompass';

const sketch = new Sketch({ plane: new Plane() }); // Default plane is world XY.
const corners = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 6 }, { x: 0, y: 6 }];
sketch.add(...corners.map((point, i) => new LineSegment({ start: point, end: corners[(i + 1) % 4] })));
sketch.add(new Circle({ center: { x: 3, y: 3 }, radius: 1 }), new Circle({ center: { x: 7, y: 3 }, radius: 1 }));

const body = extrude({ sketch, length: 8 }); // Two exact circular through holes.
const positions: Float32Array = body.triangulate();
// Equivalent: sketch.extrude({ length: 8 }).
```

Sketches support multiple disconnected profiles, concave outlines, multiple holes,
and islands nested inside holes. Nesting determines material using even-odd fill;
contour winding and segment insertion order do not matter. Segment endpoints must
match exactly by XY coordinates, whether or not they are the same `Point` object.
Points and infinite lines are construction geometry and do not create boundaries.

| Object | Definition and evaluation |
| --- | --- |
| `Point` — `{ x, y }` | An interface for a sketch-local 2D point. |
| `Vertex` — `{ position: [x, y, z] }` | An interface for a shared world-space vertex. |
| `new Line({ point, direction })` | An infinite line with a `ReadonlyVec2` direction; `at(t)` returns `point + t * direction`. |
| `new LineSegment({ start, end })` | Two endpoints; `at(0)` and `at(1)` return their coordinates. |
| `new PlanarCurve({ at, tangent, start, end })` | An exact local XY curve on [0, 1], with optional tangent evaluator and shared endpoints. |
| `new Circle({ center, radius })` | An analytic `PlanarCurve`; `at(t)` traces one counterclockwise turn on [0, 1]. |
| `new Plane({ a, b, c })` | Three noncollinear world points, each a `Vertex` or `ReadonlyVec3`. Defaults to XY. |
| `new Sketch({ plane })` | Local 2D geometry on a world-space plane; `add(...elements)` returns the sketch. |
| `new Edge({ start, end })` | A boundary edge retaining its vertex objects. |
| `new Face({ outer, holes, plane })` | A planar surface with closed loops of edges and spatial curves; holes and an oriented plane are optional. |
| `new Solid({ surfaces })` | A memoized scene node retaining shared analytic topology. |
| `new SpatialCurve({ at, start, end })` | A world-space parametric curve on [0, 1], with optional shared endpoint objects. |
| `new SpatialSurface({ start, end, sides, reversed })` | An exact ruled patch between corresponding boundaries, or from a boundary to an apex vertex. |
| `new TransformMat4({ matrix })` | A memoized scene node applying a gl-matrix transformation. |

Constructors with arguments take a single named options object. `Plane` and
`Sketch` allow omitted options for their defaults; zero-argument constructors
such as `Node`, `Memo`, and `Transform` remain unchanged. Extrusion also takes
named options: `extrude({ sketch, length, axis?, angle? })` or
`sketch.extrude({ length, axis?, angle? })`. `axis` is a finite, nonzero world-space vector,
normalized internally without modifying it, and defaults to the sketch plane
normal. Displacement is `normalize(axis) * length`; negative
lengths extrude in the opposite direction. Length must be finite and nonzero,
and the axis must leave the sketch plane. Extrusion has no tessellation options.
Utilities such as `functionalize` and `transformMat4` keep positional arguments.

`angle` is a wall draft angle in degrees, defaulting to zero, strictly between
`-90` and `90`. Positive angles expand material and shrink
holes; negative angles contract material and grow holes. This sign convention
also applies to negative lengths. A normal-axis extrusion offsets each wall by
`abs(length) * tan(degtorad(angleDEG))`, rather than scaling the whole profile. Oblique axes
also keep a constant wall angle, provided the angle permits forward-moving walls.

```ts
import { circle, sketch } from 'libcompass';

const coneSketch = sketch().add(circle({ center: { x: 0, y: 0 }, radius: 5 }));
const frustum = coneSketch.extrude({ length: 2, angle: -45 });
const cone = coneSketch.extrude({ length: 20, angle: -45 });
// The cone stops at height 5: a shared apex replaces the upper rim and cap.
```

The whole extrusion stops at the first boundary that converges to a point, so
disconnected profiles share the clamped length. Polygon corners remain sharp;
smooth curved joins are supported. Sharp joins involving curves, offset folds,
intersecting contours, or a collapse to a line need a future offset-trimming
operation and currently throw a descriptive `RangeError`.

Draft uses the generic `PlanarCurve.tangent(t)` unit tangent. By default it uses
finite differences of `at(t)`; pass an optional `tangent: t => [dx, dy]` evaluator
or override the method for exact derivatives. `Circle` provides its exact tangent.
The extrusion operation has no curve-type special cases. Source `sample()`
overrides are respected; default sampling can accept `{ resolution }` when draft
needs finer polylines. Generated curve equations remain separate from those
temporary analysis and tessellation samples.

CAD operation functions perform geometric work on math objects such as sketches,
solids, and curves. They live in `src/operations/`; for example, `extrude` is
available from the root or `libcompass/operations/extrude`. The previous
`libcompass/extrude` import remains an alias. Constructor shorthands create math
objects and stay beside their classes.

General utilities live in `src/util/`: `functionalize` works with arbitrary
methods, while `transformMat4` works with matrices and packed coordinate arrays.
Private geometry implementation helpers live in `src/internal/` and are not
exported from the root API. The docs browser groups public entries into Classes,
Shorthands, Operations, Defaults, and Util.

Public modeling angles use degrees: `extrude` and `Sketch.extrude` take `angle`,
and `Transform.rotation` stores XYZ Euler angles. Curve `at(t)` parameters stay
normalized to [0, 1]. Internal angular values use `DEG` or `RAD` suffixes.

Angle helpers are exported from the root and `libcompass/util/angles`: `PI`
equals `Math.PI`, `radtodeg(angleRAD)` converts to degrees, and `degtorad(angleDEG)`
converts to radians. Conversions preserve negative angles and multiple turns;
they do not wrap or clamp. For example, `degtorad(45)` equals `PI / 4`.

Every concrete class also has a lowercase constructor shorthand, exported from the root
and its class module: `node`, `memo`, `transform`, `transformMat4Node`, `line`,
`lineSegment`, `circle`, `plane`, `sketch`, `edge`, `face`, `solid`,
`planarCurve`, `spatialCurve`, and `spatialSurface`. They return
ordinary class instances and accept the same options and defaults. The name
`transformMat4Node` avoids a collision with the `transformMat4` utility.

```ts
import { circle, sketch } from 'libcompass';

const s = sketch().add(circle({ center: { x: 0, y: 0 }, radius: 5 }));
const body = s.extrude({ length: 10 });
```

`Point` and `Vertex` have no runtime constructors. Use plain object literals and
`import type { Point, Vertex } from 'libcompass'` for TypeScript annotations.
Geometry operations validate finite coordinates when consuming those objects.
Vertex objects and their position arrays are retained by reference; treat them
as immutable so shared topology remains consistent.

The first plane point is the origin; the first-to-second direction defines local
X, and the three-point orientation defines the normal. `plane.toWorld(point)`
returns a `Vertex`; `plane.toLocal(vertexOrVec3)` returns a `Point` and rejects
points off the plane. Extrusion vectors are in world coordinates and may be
oblique or point against the plane normal, but must have a nonzero normal component.

## Reuse the result

`Solid.surfaces` contains `Face` and `SpatialSurface` instances, both extending
`Surface`. `Solid.boundaries` contains unique `Edge` and `SpatialCurve` objects,
and `Solid.vertices` contains their unique topological endpoints. Neighboring
surfaces retain the same boundary objects. Sampling never adds facets or vertices
to this topology. A circular cylinder has three surfaces, two circular boundary
loops, and two topological vertices, regardless of triangulation density.

`PlanarCurve` evaluates local XY `Point` objects, while `SpatialCurve` evaluates
world-space `Vertex` objects. `Circle` extends `PlanarCurve`: `at(0)` is local +X,
`at(0.25)` is a quarter turn, and `at(1)` returns the same closing point as `at(0)`.
For angles in degrees, use `circle.at(angleDEG / 360)`; for radians, use
`circle.at(angleRAD / (2 * PI))`. Parameters outside
[0, 1] are rejected. `planarCurve({ at: t => ({ x: t, y: t * t }) })` creates a
general procedural planar curve without tessellation.

`SpatialCurve.fromPlanarCurve({ curve, plane })` places any `PlanarCurve` on a
world-space plane (XY by default), preserving its exact evaluator and normalized
parameterization. It also accepts plain objects implementing `at(t)` and replaces
`fromCircle({ circle, plane })`. The placement frame is copied; source evaluators
retain their captured geometry, which should be treated as immutable.
`planarCurve` and `plane` on the result expose the generic local definition and
placement. Spatial curves have no shape-specific properties or copying logic.
This conversion does not sample the curve.
`SketchElement` is `Point | Line | LineSegment | PlanarCurve`, including `Circle`
through inheritance. Extrusion accepts closed planar curves and assembles open
curves and line segments into closed, unbranched profiles. Construction points and
infinite lines do not contribute to profiles.

`PlanarLoop` is an interface with `area()` and `contains({ point })`, describing
a simple closed boundary and its strict interior. `PlanarCurve` provides these
methods for loops; calling them on an open curve throws. Composite profiles
implement the same interface. Reversing a loop's winding does not change its
positive area or containment.

Profile area, containment, nesting, and intersection checks use temporary sampled
polylines and ordinary polygon algorithms. The original curves are retained for
extrusion into exact `SpatialCurve` boundaries and `SpatialSurface` walls. Sample
points never become topological vertices or straight replacements for curves.
There are no curve-type intersection equations or circle-specific profile rules.
Analysis is approximate at the sampling resolution, so very narrow gaps, touches,
and other features smaller than that resolution may be classified differently.
Geometry captured by evaluators must remain immutable.

`SpatialBoundary` is the common interface implemented by edges and spatial curves:
`start`, `end`, `at(t)`, `sample()`, and `isLoop()`. A loop has identical start and
end coordinates; no separate `Loop` class is needed. Curve `at(t)` accepts [0, 1],
returns shared endpoint objects at zero and one, and uses the evaluator's
parameterization. It is a circumference fraction for circular curves; procedural
curves need not have constant speed. `sample()` includes both endpoints, even
for a loop. This closing-point convention applies to every curve, including
`PlanarCurve.sample()` and `Circle.sample()`: loops always repeat the closing point.
`sampleParameters({ resolution })` returns normalized parameters including zero
and one. All planar and spatial curves use the same adaptive midpoint algorithm:
start with `[0, 0.5, 1]`, then halve each interval until the distance between its
curve midpoint and chord midpoint is at most the resolution. `Circle` inherits
this sampler; it has no radius-based sampling override. Lifted curves delegate
to their planar definition. Straight edges sample only their endpoints.

`sample()` is the override point for oscillatory curves or specialized sampling.
It returns ordered points, including both endpoints and the repeated closing
point of a loop. The default maps `sampleParameters()` through `at(t)`; an
override can return its own samples without implementing parameter selection.
Lifted spatial curves delegate to the original curve's `sample()` override.

Profile analysis and tessellation both consume `sample()`. Tessellation pairs
rim polylines by sample order, inserting interpolated segment vertices as needed
to retain every supplied point and keep caps and walls watertight. For arbitrary
ruled patches this is an approximate sample-order correspondence; `at(u, v)`
retains its exact parameterization. Extrusion pairs translated copies of the same
samples. Consumers contain no curve-type special cases or independent deviation
tests.

```ts
import { Circle, Plane, SpatialCurve } from 'libcompass';

const local = new Circle({ center: { x: 0, y: 0 }, radius: 5 });
const quarterTurn = local.at(0.25);
const rim = SpatialCurve.fromPlanarCurve({ curve: local, plane: new Plane() });
const vertices = rim.sample(); // First and last vertices are the same loop endpoint.
```

`Surface.outer` and `Surface.holes` are ordered arrays of shared boundaries;
traversal direction is inferred from their connected endpoints. `boundaries`
flattens these loops, and `vertices` lists unique endpoint objects. A periodic
ruled wall uses its two circular rims as its outer and inner trims, without an
artificial seam. `SpatialSurface.at(u, v)` evaluates the exact ruled patch.

```ts
const top = body.surfaces.find((surface): surface is Face =>
  surface instanceof Face && surface.plane.normal[2] > 0.99
)!;
const nextSketch = Sketch.fromFace(top); // Empty sketch using the face's plane.
nextSketch.add(new Circle({ center: { x: 5, y: 3 }, radius: 0.5 }));
const extension = nextSketch.extrude({ length: 2 });
const blankOnTop = new Sketch({ plane: top });

const boundary = top.boundaries[0];
const midpoint = top.plane.toLocal(boundary.at(0.5));
```

Only `Face` can supply a sketch plane; `SpatialSurface` is rejected even if its
particular shape happens to be flat. `Sketch.fromFace(face)` and
`new Sketch({ plane: face })` both create empty sketches sharing the face's plane.
Neither inspects, copies, or reconstructs the face's boundaries, including holes.

Geometry coordinates and topology are exposed as readonly TypeScript properties.
Create new objects for changes; don't mutate their underlying arrays. Extrusion
creates a snapshot of the sketch. A `Solid` extends `Memo`, so it is a scene graph
node that can be added directly to scenes and transforms:

```ts
import { Node, Transform } from 'libcompass';

const scene = new Node();
const transform = new Transform().add(body);
transform.position.x = 10;
scene.add(transform);
const scenePositions = scene.triangulate();
```

Solid triangulation includes its own surfaces followed by child geometry and is
cached until `refresh()` is called. Treat cached arrays as read-only. Topology
properties describe the solid's own surfaces, excluding children.

Planar curves retain their equations through extrusion. Profile validation and
even-odd nesting use sampled polylines, without shape checks in profile assembly. Mixed curves and straight edges share endpoint vertices and vertical
edges. There is no triangulation during solid construction.

`TRIANGULATION_RESOLUTION` is currently fixed library-wide at `0.001` model units:
the target midpoint-to-chord deviation. Triangulation samples shared boundaries
together and uses Earcut for planar caps.
Collinear boundary vertices are preserved to prevent cracks. Only the final
triangle output uses `Float32Array`; analytic coordinate evaluation uses JavaScript
numbers. Changing mesh density never changes the stored mathematical geometry.

Adaptive midpoint probes can miss oscillations between probes; they do not
provide a certified global error bound for arbitrary evaluators. `SpatialSurface`
currently represents ruled patches, including cylindrical, conical, and oblique extrusion
walls; arbitrary doubly curved surfaces, sketch booleans, and constraints remain
outside the current API. Invalid trim intersections or triangulations fail
explicitly rather than producing partial meshes.

## Default objects

Shared defaults live in `src/defaults/` and are exported from the root:

| Default | Value or local frame | Normal |
| --- | --- | --- |
| `X` | Unit vector `[1, 0, 0]` | — |
| `Y` | Unit vector `[0, 1, 0]` | — |
| `Z` | Unit vector `[0, 0, 1]` | — |
| `XY` | Plane at the world origin, local axes +X / +Y | +Z |
| `ZX` | Plane at the world origin, local axes +Z / +X | +Y |
| `YZ` | Plane at the world origin, local axes +Y / +Z | +X |

These are ready-to-use values, not factories or axis classes. Treat shared
planes and vectors as immutable. The vectors have gl-matrix's `ReadonlyVec3` type
and work as inputs to gl-matrix functions and extrusion axes.

```ts
import { XY, Z, circle, sketch, extrude } from 'libcompass';

const s = sketch({ plane: XY }).add(circle({ center: { x: 0, y: 0 }, radius: 2 }));
const body = extrude({ sketch: s, axis: Z, length: 1 }); // Extrude one unit along +Z.
```

Direct modules are `libcompass/defaults/axes` and `libcompass/defaults/planes`.

## Scene graph and utilities

`Node` groups child nodes, and `Solid` extends `Memo`, which extends `Node`.
`Memo` caches until `refresh()`;
geometry-producing node subclasses override `triangulateUncached()`. `Transform`
exposes XYZ `position`, `rotation` (degrees, XYZ Euler order), and `scale` objects.
Sketches, planes, vertices, edges, curves, and surfaces remain independent math objects.

Use `node.add(first, second)` to append children and `node.remove(first, second)`
to remove child objects by identity. Both methods return the node for chaining.
Removal deletes all occurrences of the supplied objects and ignores absent ones.
After changing children or transform properties, explicitly refresh affected
memoized nodes and cached ancestors before triangulating again. Refresh only
invalidates the receiving node's cache; it does not recompute geometry or refresh
ancestors or descendants.

```ts
transform.add(extension);
transform.refresh();
const updatedPositions = scene.triangulate();

scene.remove(transform).add(body, extension);
```

`transformMat4(points, matrix, start = 0, n = remainingPoints)` transforms XYZ
triplets in place and returns the same array. `functionalize(name)` produces
`(object, ...args) => object[name](...args)`, including for `Solid.triangulate()`.
Both utilities are available from the root or individual `libcompass/util/…` paths.
