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

const body = extrude({ sketch, direction: [0, 0, 8] }); // Two exact circular through holes.
const positions: Float32Array = body.triangulate();
// Equivalent: sketch.extrude({ direction: [0, 0, 8] }).
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
| `new Circle({ center, radius })` | An analytic circle; `at(angle)` uses radians, `sample()` derives a polygon from radius and the library resolution. |
| `new Plane({ a, b, c })` | Three noncollinear world points, each a `Vertex` or `ReadonlyVec3`. Defaults to XY. |
| `new Sketch({ plane })` | Local 2D geometry on a world-space plane; `add(...elements)` returns the sketch. |
| `new Edge({ start, end })` | A boundary edge retaining its vertex objects. |
| `new Face({ outer, holes, plane })` | A planar surface with closed loops of edges and spatial curves; holes and an oriented plane are optional. |
| `new Solid({ surfaces })` | A memoized scene node retaining shared analytic topology. |
| `new SpatialCurve({ at, start, end })` | A world-space parametric curve on [0, 1], with optional shared endpoint objects. |
| `new SpatialSurface({ start, end, sides, reversed })` | An exact ruled patch between corresponding open or closed boundaries. |
| `new TransformMat4({ matrix })` | A memoized scene node applying a gl-matrix transformation. |

Constructors with arguments take a single named options object. `Plane` and
`Sketch` allow omitted options for their defaults; zero-argument constructors
such as `Node`, `Memo`, and `Transform` remain unchanged. Extrusion also takes
named options: `extrude({ sketch, direction })` or
`sketch.extrude({ direction })`. Extrusion has no tessellation options.
Utilities such as `functionalize` and `transformMat4` keep positional arguments.

Every concrete class also has a lowercase constructor shorthand, exported from the root
and its class module: `node`, `memo`, `transform`, `transformMat4Node`, `line`,
`lineSegment`, `circle`, `plane`, `sketch`, `edge`, `face`, `solid`,
`spatialCurve`, and `spatialSurface`. They return
ordinary class instances and accept the same options and defaults. The name
`transformMat4Node` avoids a collision with the `transformMat4` utility.

```ts
import { circle, sketch } from 'libcompass';

const s = sketch().add(circle({ center: { x: 0, y: 0 }, radius: 5 }));
const body = s.extrude({ direction: [0, 0, 10] });
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

`SpatialBoundary` is the common interface implemented by edges and curves:
`start`, `end`, `at(t)`, `sample()`, and `isLoop()`. A loop has identical start and
end coordinates; no separate `Loop` class is needed. Curve `at(t)` accepts [0, 1],
returns shared endpoint objects at zero and one, and uses the evaluator's
parameterization. It is a circumference fraction for circular curves; procedural
curves need not have constant speed. `sample()` includes both endpoints, even
for a loop. `Circle.at(angle)` still takes radians and `Circle.sample()` omits the
repeated closing point.

`Surface.outer` and `Surface.holes` are ordered arrays of shared boundaries;
traversal direction is inferred from their connected endpoints. `boundaries`
flattens these loops, and `vertices` lists unique endpoint objects. A periodic
ruled wall uses its two circular rims as its outer and inner trims, without an
artificial seam. `SpatialSurface.at(u, v)` evaluates the exact ruled patch.

```ts
const top = body.surfaces.find((surface): surface is Face =>
  surface instanceof Face && surface.plane.normal[2] > 0.99
)!;
const nextSketch = Sketch.fromFace(top); // Keeps both holes as analytic circles.
const extension = nextSketch.extrude({ direction: [0, 0, 2] });
const blankOnTop = new Sketch({ plane: top });

const boundary = top.boundaries[0];
const midpoint = top.plane.toLocal(boundary.at(0.5));
```

Only `Face` can supply a sketch plane; `SpatialSurface` is rejected even if its
particular shape happens to be flat. `Sketch.fromFace` copies straight and circular
trims into sketch entities. Procedural trim curves cannot yet be copied to a
sketch; use the planar face as a blank sketch plane instead.

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

Circles stay analytic through extrusion. Segment loops and circle intersections
are validated directly, using even-odd nesting and scale-relative numeric
comparisons. There is no triangulation during solid construction.

`TRIANGULATION_RESOLUTION` is currently fixed library-wide at `0.001` model units:
the maximum circular chord deviation. Triangulation derives circle segment counts
from radius, samples shared boundaries together, and uses Earcut for planar caps.
Collinear boundary vertices are preserved to prevent cracks. Only the final
triangle output uses `Float32Array`; analytic coordinate evaluation uses JavaScript
numbers. Changing mesh density never changes the stored mathematical geometry.

Procedural curves use adaptive quarter-point error probes, which cannot guarantee
an error bound for arbitrary oscillations between probes. `SpatialSurface`
currently represents ruled patches, including cylindrical and oblique extrusion
walls; arbitrary doubly curved surfaces, sketch booleans, and constraints remain
outside the current API. Invalid trim intersections or triangulations fail
explicitly rather than producing partial meshes.

## Scene graph and utilities

`Node` groups child nodes, and `Solid` extends `Memo`, which extends `Node`.
`Memo` caches until `refresh()`;
geometry-producing node subclasses override `triangulateUncached()`. `Transform`
exposes XYZ `position`, `rotation` (radians, XYZ Euler order), and `scale` objects.
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
