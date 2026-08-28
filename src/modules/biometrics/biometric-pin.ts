/**
 * ZKTeco F09 PINs are numeric. Gym numbers like GYM0001 become PIN 1.
 * Leading zeros are stripped so the device and identity table use the same value.
 */
export function resolveBiometricPin(explicitPin?: string | null, memberNumber?: string | null): string | null {
  for (const value of [explicitPin, memberNumber]) {
    const digits = String(value ?? '').replace(/\D/g, '');
    if (!digits) continue;
    const normalized = parseInt(digits, 10);
    if (!Number.isFinite(normalized) || normalized < 0) continue;
    return String(normalized);
  }
  return null;
}

export function pinsConflict(left: string, right: string): boolean {
  if (left === right) return true;
  const a = resolveBiometricPin(left);
  const b = resolveBiometricPin(right);
  return a !== null && a === b;
}
