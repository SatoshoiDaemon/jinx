import { deriveRiotMonitorWindows, getDueInspectionSlots } from './calendar.js';
import { reconcileStaleRiotPublications } from './publisher.js';
import { getRiotSchedulerPlan, runRiotInspection, syncOfficialRiotReleaseSchedule } from './service.js';

const CHECK_INTERVAL_MS = 30_000;
const RECOVERY_INTERVAL_MS = 60_000;

export function registerRiotScheduler(context) {
  let stopped = false;
  let checking = false;
  let lastRecoveryAt = 0;
  let timer;

  const tick = async () => {
    if (stopped || checking || !context.client.isReady?.()) return;
    checking = true;
    try {
      const nowMs = Date.now();
      if (nowMs - lastRecoveryAt >= RECOVERY_INTERVAL_MS) {
        lastRecoveryAt = nowMs;
        await reconcileStaleRiotPublications(context);
      }
      const now = new Date(nowMs);
      const plan = await getRiotSchedulerPlan(context, now);
      if (!plan.settings.scheduler.enabled) return;
      const scheduleSync = await syncOfficialRiotReleaseSchedule(context, { now, state: plan.state });
      plan.state = scheduleSync.state ?? plan.state;
      plan.monitorWindows = deriveRiotMonitorWindows(
        plan.articles,
        plan.settings,
        now,
        plan.state?.officialReleaseSchedule,
      );
      const slots = getDueInspectionSlots({
        settings: plan.settings,
        state: plan.state,
        monitorWindows: plan.monitorWindows,
        now,
      });
      if (!slots.length) return;
      const reason = slots.map((slot) => slot.kind).join('+');
      await runRiotInspection(context, { reason, publish: true, scheduledSlots: slots });
    } catch (error) {
      const record = {
        level: 'error',
        event: 'riot_scheduler_tick_failed',
        at: new Date().toISOString(),
        code: error?.code ?? error?.name ?? 'RIOT_SCHEDULER_ERROR',
      };
      if (typeof context.logger === 'function') context.logger(record);
      else console.error(JSON.stringify(record));
    } finally {
      checking = false;
    }
  };

  timer = setInterval(() => void tick(), CHECK_INTERVAL_MS);
  timer.unref?.();

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
