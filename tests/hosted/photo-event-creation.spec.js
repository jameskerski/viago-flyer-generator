import assert from 'node:assert/strict';
import test from 'node:test';
import { creationQualification, creationRequestHash, normalizeEventCreation } from '../../hosted/platform/photo-event-creation.mjs';

test('normalizes signature, trip, wellness, special and standalone event identities', () => {
  assert.deepEqual(normalizeEventCreation({ eventName: ' Elevate  Europe ', eventSeries: 'Elevate', region: 'Europe', eventYear: '2027', eventType: 'signature_event' }), {
    eventName: 'Elevate Europe', eventSeries: 'Elevate', region: 'Europe', eventYear: 2027, eventType: 'SIGNATURE_EVENT', startDate: '', endDate: '', location: '', artworkUrl: ''
  });
  for (const eventType of ['TRIP_INCENTIVE', 'WELLNESS_ESCAPE', 'SPECIAL_EVENT', 'OTHER']) {
    const result = normalizeEventCreation({ eventName: 'Standalone Experience', eventYear: 2028, eventType });
    assert.equal(result.eventSeries, ''); assert.equal(result.region, ''); assert.equal(result.eventType, eventType);
  }
});

test('rejects invalid identity, date order and missing signature series', () => {
  assert.throws(() => normalizeEventCreation({ eventName: '', eventYear: 2027, eventType: 'OTHER' }), /event_name_required/);
  assert.throws(() => normalizeEventCreation({ eventName: 'Elevate', eventYear: 2027, eventType: 'SIGNATURE_EVENT' }), /signature_series_required/);
  assert.throws(() => normalizeEventCreation({ eventName: 'Trip', eventYear: 2027, eventType: 'TRIP_INCENTIVE', startDate: '2027-05-03', endDate: '2027-05-02' }), /end_date_before_start_date/);
});

test('idempotency hash is deterministic and request-sensitive', async () => {
  const a = normalizeEventCreation({ eventName: 'Amplify', eventSeries: 'Amplify', eventYear: 2027, eventType: 'SIGNATURE_EVENT' });
  assert.equal(await creationRequestHash(a), await creationRequestHash(structuredClone(a)));
  assert.notEqual(await creationRequestHash(a), await creationRequestHash({ ...a, region: 'Europe' }));
});

test('production creation fails closed until every write boundary is configured', () => {
  assert.deepEqual(creationQualification({ }).enabled, false);
  assert.equal(creationQualification({ PHOTO_EVENT_PROVISION_ENDPOINT: 'https://script.google.com/macros/s/example/exec', PHOTO_STUDIO_SYNC_SECRET: 'x' }).enabled, true);
  assert.equal(creationQualification({ PHOTO_EVENT_PROVISION_ENDPOINT: 'https://script.google.com/macros/s/example/exec' }).enabled, false);
});
