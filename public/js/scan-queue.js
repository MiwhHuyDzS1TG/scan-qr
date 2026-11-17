import { uniqueId } from "./utils.js";

export class ScanQueue {
  constructor({ scan, onStart = () => {}, onMemberStart = () => {}, onResult = () => {}, onError = () => {}, onProgress = () => {}, onComplete = () => {} }) {
    this.scan = scan;
    this.handlers = { onStart, onMemberStart, onResult, onError, onProgress, onComplete };
    this.running = false;
    this.stopRequested = false;
  }

  requestStop() {
    if (!this.running) return false;
    this.stopRequested = true;
    return true;
  }

  async run(members, suppliedBatchId = uniqueId("batch")) {
    if (this.running) return { accepted: false, reason: "already_running" };
    this.running = true;
    this.stopRequested = false;
    const snapshot = members.map((member) => ({ id: member.id, alias: member.alias }));
    const startedAt = performance.now();
    const results = [];
    this.handlers.onStart({ batchId: suppliedBatchId, members: snapshot });

    try {
      for (let index = 0; index < snapshot.length; index += 1) {
        if (this.stopRequested) break;
        const member = snapshot[index];
        const requestId = uniqueId("request");
        this.handlers.onMemberStart({ member, index, total: snapshot.length, batchId: suppliedBatchId, requestId });
        try {
          const result = await this.scan(member.id, suppliedBatchId, requestId);
          results.push(result);
          this.handlers.onResult({ member, result, index, total: snapshot.length });
        } catch (error) {
          const result = {
            member_id: member.id,
            status: "unknown",
            verified_present: false,
            is_simulation: false,
            message: error.message || "Không nhận được kết quả có thể xác minh.",
            reason: "Request không hoàn tất. Không tự động thử lại.",
            requested_at: new Date().toISOString(),
            response_received_at: new Date().toISOString(),
            duration_ms: 0,
            batch_id: suppliedBatchId,
            request_id: requestId,
          };
          results.push(result);
          this.handlers.onError({ member, error, result, index, total: snapshot.length });
        }
        this.handlers.onProgress({ processed: results.length, total: snapshot.length, results });
      }
    } finally {
      const summary = {
        accepted: true,
        batchId: suppliedBatchId,
        results,
        stopped: this.stopRequested,
        skipped: snapshot.length - results.length,
        durationMs: Math.round(performance.now() - startedAt),
      };
      this.running = false;
      this.stopRequested = false;
      this.handlers.onComplete(summary);
      return summary;
    }
  }
}

