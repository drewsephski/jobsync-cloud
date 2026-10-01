// Existing domain tests explicitly enroll their isolated identities in a trial.
// Verification and expired-account denial are exercised by billing tests.
export function trialFields() {
  return {
    emailVerifiedAt: new Date(),
    trialStartedAt: new Date(),
    trialEndsAt: new Date(Date.now() + 14 * 86400_000),
  }
}
