/**
 * ZKTeco F09 PINs are numeric. Gym numbers like GYM0001 become PIN 1.
 * Leading zeros are stripped so the device and identity table use the same value.
 */
export function resolveBiometricPin(explicitPin?: string | null, memberNumber?: string | null): string | null {
  if (explicitPin) {
    const digits = String(explicitPin).replace(/\D/g, '');
    if (digits) {
      const normalized = parseInt(digits, 10);
      if (Number.isFinite(normalized) && normalized >= 0) {
        return String(normalized);
      }
    }
  }

  if (memberNumber) {
    const str = String(memberNumber);
    const isStaff = str.toUpperCase().startsWith('SAF');
    const digits = str.replace(/\D/g, '');
    if (digits) {
      const normalized = parseInt(digits, 10);
      if (Number.isFinite(normalized) && normalized >= 0) {
        const prefix = isStaff ? '2' : '1';
        return `${prefix}${String(normalized).padStart(4, '0')}`;
      }
    }
  }

  return null;
}

export function pinsConflict(left: string, right: string): boolean {
  if (left === right) return true;
  const a = resolveBiometricPin(left);
  const b = resolveBiometricPin(right);
  return a !== null && a === b;
}
