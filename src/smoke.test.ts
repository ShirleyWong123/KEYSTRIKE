import { describe, expect, it } from 'vitest';
import { APP_NAME } from './main';

describe('application shell', () => {
  it('exposes the KEYSTRIKE product name', () => {
    expect(APP_NAME).toBe('KEYSTRIKE');
  });
});
