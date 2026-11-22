import assert from 'node:assert/strict';
import { test } from 'node:test';
import { svgPath } from 'libcompass';

test('SVG path validates input and reports the browser requirement without affecting Node imports', () => {
  for (const d of [undefined, null, 123, {}]) assert.throws(() => svgPath({ d }), /must be a string/);
  for (const d of ['', ' \n\t']) assert.throws(() => svgPath({ d }), /must not be empty/);
  for (const key of ['position', 'scale']) {
    assert.throws(() => svgPath({ d: 'M0 0L10 0', [key]: { x: NaN, y: 1 } }), RangeError);
    assert.throws(() => svgPath({ d: 'M0 0L10 0', [key]: { x: 1, y: Infinity } }), RangeError);
  }
  assert.throws(() => svgPath({ d: 'M0 0L10 0' }), /requires browser SVG path geometry APIs/);
});
