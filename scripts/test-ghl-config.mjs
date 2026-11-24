import assert from 'node:assert/strict';
import { ghlSetUp } from '../js/ghl-config.js';

const set = { ghlLocationId: 'loc', ghlPipelineId: 'pipe', ghlStageId: 'stage' };
// What an employee's browser holds: clients_visible() returns the key as null.
assert.equal(ghlSetUp({ ...set, ghlApiKey: null }), true);
assert.equal(ghlSetUp({ ...set, ghlLocationId: '' }), false);
assert.equal(ghlSetUp({ ...set, ghlPipelineId: null }), false);
assert.equal(ghlSetUp({ ...set, ghlStageId: '  ' }), false);
assert.equal(ghlSetUp({}), false);
assert.equal(ghlSetUp(undefined), false);
console.log('test-ghl-config: ok');
