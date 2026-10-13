/*
 * A single lane for all outbound provider traffic in this process.
 *
 * Seed generation runs in the background per upload, so several schemas can be
 * generating at once, each firing its own batches. Nothing coordinated them:
 * three uploads meant three concurrent streams of calls, which is what trips a
 * per-minute rate limit even though any one stream is politely paced.
 *
 * Funnelling every call through one queue makes the spacing global rather than
 * per-caller, so the pacing actually holds no matter how many jobs are running.
 */

const MIN_REQUEST_GAP_MS = (() => {
  const parsed = Number.parseInt(process.env.AI_MIN_REQUEST_GAP_MS, 10);

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 1200;
})();

let chain = Promise.resolve();
let lastStartedAt = 0;

// Set when the provider reports a rate limit. Every queued call waits until this
// passes, so one 429 slows the whole process down instead of each caller
// discovering the limit separately.
let cooldownUntil = 0;

function sleep(ms) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

/*
 * Tell the queue the provider asked everyone to back off.
 *
 * Called on a 429 with the wait the provider asked for. Extending an existing
 * cooldown rather than replacing it means a later, shorter 429 cannot shorten a
 * longer pause already in effect.
 */
function applyCooldown(waitMs) {
  if (!Number.isFinite(waitMs) || waitMs <= 0) return;

  cooldownUntil = Math.max(cooldownUntil, Date.now() + waitMs);
}

function getCooldownRemainingMs() {
  return Math.max(0, cooldownUntil - Date.now());
}

/*
 * Run a provider call in the queue.
 *
 * Calls run one at a time, separated by at least MIN_REQUEST_GAP_MS and delayed
 * further while a cooldown is active. The chain is advanced with a catch so a
 * rejected call does not break the lane for everything queued behind it.
 */
function enqueue(task) {
  const result = chain.then(async () => {
    const cooldown = getCooldownRemainingMs();
    if (cooldown > 0) await sleep(cooldown);

    const sinceLast = Date.now() - lastStartedAt;
    if (sinceLast < MIN_REQUEST_GAP_MS) {
      await sleep(MIN_REQUEST_GAP_MS - sinceLast);
    }

    lastStartedAt = Date.now();

    return task();
  });

  chain = result.then(
    () => undefined,
    () => undefined
  );

  return result;
}

module.exports = {
  enqueue,
  applyCooldown,
  getCooldownRemainingMs,
  MIN_REQUEST_GAP_MS
};
