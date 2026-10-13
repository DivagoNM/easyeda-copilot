import assert from 'node:assert/strict';
import test from 'node:test';
import { previewRotationRadians } from '../src/eda/pcb-preview-rotation.ts';

test('preview keeps radians through 3.2.149 and normalizes later editor versions', () => {
    for (const degrees of [0, 45, 90, 180, -90]) {
        const radians = degrees * Math.PI / 180;
        for (const version of [[3, 1, 999], [3, 2, 148], [3, 2, 149]])
            assert.equal(previewRotationRadians(radians, version), radians);
        for (const version of [[3, 2, 150], [3, 3, 0], [4, 0, 0]])
            assert.equal(previewRotationRadians(degrees, version), radians);
    }
});
