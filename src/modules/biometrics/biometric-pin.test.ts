import { describe, expect, it } from 'vitest';
import { pinsConflict, resolveBiometricPin } from './biometric-pin';

describe('resolveBiometricPin', () => {
  it('uses an explicit numeric PIN', () => {
    expect(resolveBiometricPin('1001', 'GYM0002')).toBe('1001');
  });

  it('strips leading zeros from gym numbers', () => {
    expect(resolveBiometricPin(undefined, 'GYM0001')).toBe('1');
  });

  it('ignores non-numeric explicit PIN and falls back to gym number', () => {
    expect(resolveBiometricPin('abc', 'GYM0042')).toBe('42');
  });

  it('returns null when nothing numeric is available', () => {
    expect(resolveBiometricPin('abc', 'GYM')).toBeNull();
  });
});

describe('pinsConflict', () => {
  it('treats 0001 and 1 as the same device PIN', () => {
    expect(pinsConflict('0001', '1')).toBe(true);
  });

  it('does not treat 1 and 10 as the same PIN', () => {
    expect(pinsConflict('1', '10')).toBe(false);
  });
});
