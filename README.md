# libcompass

The CAD library behind compassts, built from sketches, reusable boundary topology,
and a scene graph. Extrusions return solids with shared vertices, edges, and faces;
each solid is also a memoized node that can be added directly to a scene or
transform. Triangulation produces WebGL-compatible `Float32Array` XYZ triangle
positions. Applications provide their own UI, visualizer, exporters, or API.
The only runtime dependency is `gl-matrix`.

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
import { Circle, LineSegment, Plane, Sketch, extrude } from 'libcompass';

const sketch = new Sketch({ plane: new Plane() }); // Default plane is world XY.
const corners = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 6 }, { x: 0, y: 6 }];
sketch.add(...corners.map((point, i) => new LineSegment({ start: point, end: corners[(i + 1) % 4] })));
sketch.add(new Circle({ center: { x: 3, y: 3 }, radius: 1 }), new Circle({ center: { x: 7, y: 3 }, radius: 1 }));

const body = extrude({ sketch, direction: [0, 0, 8], circleSegments: 32 }); // Two through holes; 32 segments per circle.
const positions: Float32Array = body.triangulate();
// Equivalent: sketch.extrude({ direction: [0, 0, 8], circleSegments: 32 }).
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
| `new Circle({ center, radius })` | An analytic circle; `at(angle)` uses radians, `sample(segments)` returns a polygon. |
| `new Plane({ a, b, c })` | Three noncollinear world points, each a `Vertex` or `ReadonlyVec3`. Defaults to XY. |
| `new Sketch({ plane })` | Local 2D geometry on a world-space plane; `add(...elements)` returns the sketch. |
| `new Edge({ start, end })` | A boundary edge retaining its vertex objects. |
| `new Face({ outer, holes, edges })` | A planar face; holes and shared edges are optional. |
| `new Solid({ faces })` | A memoized scene node retaining shared face topology. |
| `new TransformMat4({ matrix })` | A memoized scene node applying a gl-matrix transformation. |

Constructors with arguments take a single named options object. `Plane` and
`Sketch` allow omitted options for their defaults; zero-argument constructors
such as `Node`, `Memo`, and `Transform` remain unchanged. Extrusion also takes
named options: `extrude({ sketch, direction, circleSegments })` or
`sketch.extrude({ direction, circleSegments })`. Omit `circleSegments` to use 64.
Utilities such as `functionalize` and `transformMat4` keep positional arguments.

Every class also has a lowercase constructor shorthand, exported from the root
and its class module: `node`, `memo`, `transform`, `transformMat4Node`, `line`,
`lineSegment`, `circle`, `plane`, `sketch`, `edge`, `face`, and `solid`. They return
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

`Solid.vertices`, `Solid.edges`, and `Solid.faces` expose the boundary
representation. Faces reference the same `Vertex` and `Edge` objects as the
solid and their neighboring faces. Edges are actual boundaries, not triangulation
diagonals. Normals and triangles point outward.

- `Vertex.position` holds world XYZ coordinates.
- `Edge.start` and `Edge.end` reference vertices; `edge.at(t)` evaluates a new vertex.
- `Face.outer` and `Face.holes` hold ordered boundary loops. `face.vertices` and
  `face.edges` flatten those loops, outer first. `face.plane` gives its local frame
  and normal. `face.triangulate()` tessellates the face, preserving its holes.

```ts
const top = body.faces.find((face) => face.plane.normal[2] > 0.99)!;
const nextSketch = Sketch.fromFace(top); // Includes outer boundary and both holes.
const extension = nextSketch.extrude({ direction: [0, 0, 2] });

const edge = top.edges[0];
const midpoint = top.plane.toLocal(edge.at(0.5));
const planeFromVertices = new Plane({ a: top.outer[0], b: top.outer[1], c: top.outer[2] });
```

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

Solid triangulation includes its own faces followed by child geometry and is
cached until `refresh()` is called. Treat cached arrays as read-only. Topology
properties describe the solid's own faces, excluding children.

Circles stay analytic in the drawing and become polygonal boundaries during
extrusion (64 segments by default). Curved faces, sketch intersections/booleans,
and constraints are not implemented. Open, branched, intersecting, overlapping, or
touching contours fail explicitly rather than producing an ambiguous solid.
Validation operates on the tessellated boundaries. The dependency-free planar
triangulator uses O(n³) work and O(n²) storage, intended for modest sketch sizes.

## Scene graph and utilities

`Node` groups child nodes, and `Solid` extends `Memo`, which extends `Node`.
`Memo` caches until `refresh()`;
geometry-producing node subclasses override `triangulateUncached()`. `Transform`
exposes XYZ `position`, `rotation` (radians, XYZ Euler order), and `scale` objects.
Sketches, planes, vertices, edges, and faces remain independent math objects.

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
