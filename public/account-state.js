export function isAccountSnapshotCurrent(requestRevision, currentRevision) {
  return Number(requestRevision) === Number(currentRevision);
}
