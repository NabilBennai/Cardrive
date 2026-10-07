export function calculateSuspensionForceN(
  suspensionLengthM: number,
  restLengthM: number,
  springRateNPerM: number,
  damperNsPerM: number,
  velocityAlongDownMps: number,
  maximumForceN: number,
): number {
  const compressionM = Math.max(0, restLengthM - suspensionLengthM);
  return Math.max(0, Math.min(maximumForceN,
    springRateNPerM * compressionM + damperNsPerM * velocityAlongDownMps,
  ));
}

export function maximumLongitudinalForceN(lateralForceN: number, frictionLimitN: number): number {
  return Math.sqrt(Math.max(0, frictionLimitN ** 2 - lateralForceN ** 2));
}

export function interpolateTorqueNm(rpm: number, curve: ReadonlyArray<{ rpm: number; torqueNm: number }>): number {
  if (rpm <= curve[0].rpm) return curve[0].torqueNm;
  for (let index = 1; index < curve.length; index += 1) {
    const lower = curve[index - 1];
    const upper = curve[index];
    if (rpm <= upper.rpm) {
      const progress = (rpm - lower.rpm) / (upper.rpm - lower.rpm);
      return lower.torqueNm + (upper.torqueNm - lower.torqueNm) * progress;
    }
  }
  return curve[curve.length - 1].torqueNm;
}
