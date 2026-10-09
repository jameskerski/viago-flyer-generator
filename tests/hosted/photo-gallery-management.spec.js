import { test, expect } from '@playwright/test';
import { normalizeGalleryName } from '../../hosted/platform/photo-gallery-management.mjs';

test('gallery names are public-facing and normalized', () => {
  expect(normalizeGalleryName('  Stage   & Speakers  ')).toBe('Stage & Speakers');
  expect(() => normalizeGalleryName('')).toThrow('gallery_name_required');
  expect(() => normalizeGalleryName('_INTERNAL')).toThrow('reserved_gallery_name');
  expect(() => normalizeGalleryName('VIP/Dinner')).toThrow('invalid_gallery_name');
});
