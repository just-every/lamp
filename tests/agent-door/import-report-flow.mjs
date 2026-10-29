import assert from 'node:assert/strict';
import { load } from '../operator-readiness/runtime.mjs';

/** The retained report resource reads the native import without new effects. */
export async function assertNativeImportReport(db, result, ownerId) {
  const { createStatuspageImportService } = await load('src/core/features/statuspage-import/service.ts');
  const reportReader = createStatuspageImportService(db, {
    async inviteSubscriber() { throw new Error('A report read must not invite subscribers'); },
    async publicDataChanged() { throw new Error('A report read must not publish'); },
  });
  const retained = await reportReader.readAgentReport(result.job.id, ownerId);
  assert.deepEqual(retained.report, result.report, 'Agent import resources use the native retained report');
  assert.equal(retained.job.state, 'completed');
  await assert.rejects(reportReader.readAgentReport(result.job.id, 'missing-native-person'), /Import not found/);
  await assert.rejects(reportReader.readAgentReport('missing-native-job', ownerId), /Import not found/);
}
