/*
 * One retry policy for every provider.
 *
 * This used to live inside groqProvider alone, which meant switching
 * AI_PROVIDER silently changed how the service behaved under load: Groq paced
 * itself and waited out rate limits, while OpenAI, Grok and Claude had no retry
 * at all and failed on the first 429. Gemini had its own separate retry that
 * never touched the shared queue, so concurrent uploads could still stack up.
 *
 * Provider choice should change who answers the prompt, not whether the service
 * survives a rate limit. Everything routes through here now.
 */

const {
  enqueue,
  applyCooldown
} = require('./requestQueue');

/*
 * Longest we will sit on a rate limit before giving up.
 *
 * Seed generation runs in the background with a five-minute client timeout, so
 * there is real room to wait one out - free tiers commonly ask for 30-60
 * seconds, and a low ceiling turns ordinary throttling into hard failures.
 * Interactive callers are protected by their own shorter timeouts.
 */
const MAX_RATE_LIMIT_WAIT_MS =
  Number.parseInt(process.env.AI_MAX_RATE_LIMIT_WAIT_MS, 10) || 90000;

const MAX_ATTEMPTS = (() => {
  const parsed = Number.parseInt(process.env.AI_MAX_ATTEMPTS, 10);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3;
})();

const INITIAL_BACKOFF_MS = 3000;

function sleep(ms) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

function formatSeconds(milliseconds) {
  const seconds = Math.round(milliseconds / 1000);

  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;

  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

/*
 * Read the provider's requested wait, or null when it did not give one.
 *
 * Retry-After is seconds in practice but often fractional ("7.5"), which
 * parseInt truncates - rounding down means retrying while still limited and
 * burning an attempt. The HTTP-date form is legal too and a few providers use
 * it, so it is handled rather than silently treated as "no header".
 */
function parseRetryAfterMs(headers) {
  const raw = headers?.['retry-after'] ?? headers?.['Retry-After'];

  if (raw === undefined || raw === null || raw === '') return null;

  const asSeconds = Number.parseFloat(raw);

  if (Number.isFinite(asSeconds) && asSeconds > 0) {
    return Math.ceil(asSeconds * 1000);
  }

  const asDate = Date.parse(raw);

  if (Number.isFinite(asDate)) {
    const delta = asDate - Date.now();

    return delta > 0 ? delta : null;
  }

  return null;
}

function buildRateLimitError(providerName, waitTime) {
  const error = new Error(
    `${providerName} rate limit reached. It asked to wait ${formatSeconds(waitTime)}, which exceeds the ${formatSeconds(MAX_RATE_LIMIT_WAIT_MS)} limit, so the request was not retried. Try again later, reduce request volume, or raise AI_MAX_RATE_LIMIT_WAIT_MS.`
  );

  error.statusCode = 429;
  error.retryAfterMs = waitTime;

  return error;
}

function isRetryableServerError(status) {
  return Number.isInteger(status) && status >= 500 && status <= 599;
}

/*
 * Run one provider HTTP call with shared queueing and retries.
 *
 * `request` is an async function performing the call - it is re-invoked on each
 * attempt rather than retried in place, so nothing from a failed attempt leaks
 * into the next one.
 *
 * Retries cover 429 (rate limited) and 5xx (the provider had a bad moment).
 * Everything else - a bad API key, a malformed prompt, a 400 - is thrown
 * immediately, because those do not get better by asking again.
 */
async function callProvider({ provider, request }) {
  const providerName = provider || 'AI provider';

  let backoff = INITIAL_BACKOFF_MS;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const attemptsLeft = MAX_ATTEMPTS - attempt;

    try {
      return await enqueue(request);
    } catch (error) {
      const status = error.response?.status;

      if (status === 429 && attemptsLeft > 0) {
        const requested = parseRetryAfterMs(error.response?.headers);
        const waitTime = requested ?? backoff;

        /*
         * A provider can ask for longer than the caller will stay connected.
         * Sleeping past that budget helps nobody - the HTTP response has
         * nowhere to go by the time it finishes. The cooldown is still
         * registered so other queued calls do not each spend a request
         * rediscovering the same limit.
         */
        if (waitTime > MAX_RATE_LIMIT_WAIT_MS) {
          applyCooldown(waitTime);
          throw buildRateLimitError(providerName, waitTime);
        }

        console.warn(
          `${providerName} rate limit hit. Waiting ${formatSeconds(waitTime)} before retry (${attemptsLeft} left).`
        );

        /*
         * Hold every queued call, not just this one - the limit is per account,
         * so a sibling firing during the backoff would only 429 too. The queue
         * itself waits the cooldown out before the next attempt starts, so
         * there is no separate sleep here.
         */
        applyCooldown(waitTime);

        // Only grow the backoff when the provider gave no instruction of its own.
        if (requested === null) backoff *= 2;

        continue;
      }

      if (isRetryableServerError(status) && attemptsLeft > 0) {
        console.warn(
          `${providerName} returned ${status}. Retrying in ${formatSeconds(backoff)} (${attemptsLeft} left).`
        );

        // Not a rate limit, so this one backs off alone rather than stalling
        // every other queued call.
        await sleep(backoff);
        backoff *= 2;

        continue;
      }

      throw error;
    }
  }

  // Unreachable: the final attempt either returns or throws above.
  throw new Error(`${providerName} request failed after ${MAX_ATTEMPTS} attempts.`);
}

module.exports = {
  callProvider,
  formatSeconds,
  parseRetryAfterMs,
  MAX_RATE_LIMIT_WAIT_MS,
  MAX_ATTEMPTS
};
