import type { FirmwareVerificationReport } from './types'

export function readVerificationReport(value: unknown): FirmwareVerificationReport | null {
  if (!value || typeof value !== 'object') return null
  const report = value as Record<string, unknown>
  if (typeof report.ok !== 'boolean' || typeof report.code !== 'number' ||
      typeof report.signature_checked !== 'boolean' || typeof report.flash_write !== 'boolean') return null
  return report as FirmwareVerificationReport
}

/** Keep version rejection as a failed overall check, even when the signature is valid. */
export function isSignedVersionRejection(report: FirmwareVerificationReport | null): boolean {
  return report?.ok === false && report.code === 14 && report.signature_checked === true &&
    report.flash_write === false && report.bytes_programmed === 0 && report.erased === false
}
