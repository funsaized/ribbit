import assert from 'node:assert/strict';
import { checkPicker } from '../src/picker/index.ts';

// Check the executable installed by CI, not a synthetic version string.
assert.deepEqual(await checkPicker(), { status: 'supported', version: '0.74.3', minimum: '0.74.3' });
console.log('CI picker: verified fzf 0.74.3');
