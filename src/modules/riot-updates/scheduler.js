import { getDueInspectionSlots } from './calendar.js';
import { reconcileStaleRiotPublications } from './publisher.js';
import { getRiotSchedulerPlan, runRiotInspection } from './service.js';

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
      const now = Date.now();
      if (now - lastRecoveryAt >= RECOVERY_INTERVAL_MS) {
        lastRecoveryAt = now;
        await reconcileStaleRiotPublications(context);
      }
      const plan = await getRiotSchedulerPlan(context);
      if (!plan.settings.scheduler.enabled) return;
      const slots = getDueInspectionSlots({
        settings: plan.settings,
        state: plan.state,
        monitorWindows: plan.monitorWindows,
        now: new Date(),
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
