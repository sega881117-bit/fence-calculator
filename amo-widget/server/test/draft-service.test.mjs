import assert from 'node:assert/strict';
import { buildDraft } from '../src/draft-service.mjs';

const estimate = buildDraft('60 м евроштакетника 1,8 м, распашные ворота и калитка, Домодедово');
assert.equal(estimate.action, 'draft_estimate');
assert.equal(estimate.summary.total, '165 000 ₽');
assert.equal(estimate.safe, true);

const tooShort = buildDraft('29 м профлиста 2 м, распашные ворота и калитка');
assert.equal(tooShort.action, 'manual_review');

const missing = buildDraft('60 м профлиста');
assert.equal(missing.action, 'needs_clarification');

const defaults = buildDraft('70 вк, Люберцы');
assert.equal(defaults.action, 'draft_estimate');
assert.equal(defaults.summary.total, '185 000 ₽');

const doubleProfile = buildDraft('120м профлист двухстор. h=2м, ворота 5м, калитка, Домодедово');
assert.equal(doubleProfile.summary.total, '332 000 ₽');

const separateWicket = buildDraft('70 квадратных, штакетник 1.8, ворота и калитка отдельно');
assert.equal(separateWicket.summary.total, '190 500 ₽');
console.log('draft service: all tests passed');
