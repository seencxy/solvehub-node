/**
 * SolveHub - Node client for the SolveHub CAPTCHA API.
 *
 * One REST endpoint for Cloudflare Turnstile / Interstitial, DataDome, Akamai,
 * PerimeterX (HUMAN), Imperva, AWS WAF, Alibaba Cloud CAPTCHA 2.0, Arkose
 * FunCaptcha and image-text OCR.
 *
 * Docs: https://www.tiam.codes
 * Licence: MIT
 *
 *   import { SolveHub } from 'solvehub-node';
 *   const client = new SolveHub(process.env.SOLVEHUB_KEY);
 *   const task = await client.solve('turnstile', { websiteURL, websiteKey });
 *   console.log(task.solution.value);
 *
 * Node 18+ only: it uses the built-in global fetch and node:crypto.
 */

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

export const VERSION = '0.1.0';

const DEFAULT_BASE_URL = 'https://api.tiam.codes';
const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_POLL_INTERVAL = 2500;

/** Challenge types accepted by POST /v1/tasks. */
export const TASK_TYPES = Object.freeze([
  'turnstile',
  'interstitial',
  'datadome',
  'akamai',
  'perimeterx',
  'imperva',
  'aws_waf',
  'alibaba',
  'funcaptcha',
  'image',
]);

export const PENDING_STATUSES = Object.freeze(['queued', 'processing']);
export const TERMINAL_STATUSES = Object.freeze(['done', 'failed', 'cancelled']);

export class SolveHubError extends Error {
  constructor(message, { status, payload, requestId } = {}) {
    super(message);
    this.name = 'SolveHubError';
    this.status = status;
    this.payload = payload ?? {};
    this.requestId = requestId;
  }
}

export class TaskTimeout extends SolveHubError {
  constructor(task, timeoutMs) {
    super(
      `task ${task?.id} still "${task?.status}" after ${Math.round(timeoutMs / 1000)}s; ` +
        'it may still complete - keep polling with getTask() or cancel it',
    );
    this.name = 'TaskTimeout';
    this.task = task;
  }
}

export class TaskFailed extends SolveHubError {
  constructor(task) {
    super(`task ${task?.id} ended as "${task?.status}": ${task?.error ?? 'no solution'}`);
    this.name = 'TaskFailed';
    this.task = task;
  }
}

/**
 * Verify an HMAC-SHA256 delivery signature.
 * `rawBody` must be the exact bytes received; the digest is compared in
 * constant time, so a wrong signature cannot be brute-forced by timing.
 */
export function verifyWebhook(rawBody, signature, secret) {
  if (!signature) return false;
  const expected = createHmac('sha256', String(secret)).update(rawBody).digest('hex');
  const given = String(signature).trim().toLowerCase().replace(/^sha256=/, '');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(given, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class SolveHub {
  /**
   * @param {string} apiKey console API key (sh_live_...)
   * @param {{baseUrl?: string, timeout?: number}} [options]
   */
  constructor(apiKey, { baseUrl = DEFAULT_BASE_URL, timeout = DEFAULT_TIMEOUT } = {}) {
    if (!apiKey) throw new TypeError('apiKey is required');
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.timeout = timeout;
  }

  // ------------------------------------------------------------------ HTTP
  async #request(method, path, { body, headers, query } = {}) {
    let url = this.baseUrl + path;
    if (query) {
      const qs = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null) qs.set(key, String(value));
      }
      const s = qs.toString();
      if (s) url += `?${s}`;
    }

    const hdrs = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: 'application/json',
      'User-Agent': `solvehub-node/${VERSION}`,
      ...headers,
    };
    let payloadBody;
    if (body !== undefined) {
      hdrs['Content-Type'] = 'application/json';
      payloadBody = JSON.stringify(body);
    }

    let res;
    try {
      res = await fetch(url, {
        method,
        headers: hdrs,
        body: payloadBody,
        signal: AbortSignal.timeout(this.timeout),
      });
    } catch (error) {
      throw new SolveHubError(`network error: ${error.message}`, {});
    }

    const text = await res.text();
    let payload = {};
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { message: text };
      }
    }

    if (!res.ok) {
      throw new SolveHubError(
        payload.message ?? payload.error ?? res.statusText,
        { status: res.status, payload, requestId: payload.requestId },
      );
    }
    return payload;
  }

  // ------------------------------------------------------------------ meta
  /** Public price catalogue. */
  prices() {
    return this.#request('GET', '/v1/prices');
  }

  /** Available and reserved balance. */
  balance() {
    return this.#request('GET', '/v1/balance');
  }

  // ------------------------------------------------------------------ tasks
  /**
   * Create a task. Resolves with the task in `queued`.
   * The price is frozen now, charged only on completion and refunded on
   * failure or cancellation.
   */
  createTask(type, task, { proxy, idempotencyKey } = {}) {
    if (!TASK_TYPES.includes(type)) {
      throw new TypeError(`unknown task type "${type}"; expected one of ${TASK_TYPES.join(', ')}`);
    }
    const body = { type, task: { ...task } };
    if (proxy) body.proxy = proxy;
    return this.#request('POST', '/v1/tasks', {
      body,
      headers: { 'Idempotency-Key': idempotencyKey ?? randomUUID() },
    });
  }

  /** Status and, once finished, the solution of one task. */
  getTask(taskId) {
    return this.#request('GET', `/v1/tasks/${encodeURIComponent(taskId)}`);
  }

  /** Most recent tasks, newest first. */
  listTasks({ limit = 50 } = {}) {
    return this.#request('GET', '/v1/tasks', { query: { limit } });
  }

  /** Cancel a queued task; the reserved amount is refunded. */
  cancelTask(taskId) {
    return this.#request('POST', `/v1/tasks/${encodeURIComponent(taskId)}/cancel`);
  }

  /**
   * Poll until the task reaches a terminal state and resolve with it.
   * `uncertain` is NOT terminal: polling continues, the task can still resolve.
   */
  async wait(taskId, { timeout = 300_000, interval = DEFAULT_POLL_INTERVAL } = {}) {
    const deadline = Date.now() + timeout;
    let delay = interval;
    let task;
    for (;;) {
      task = await this.getTask(taskId);
      if (task.status === 'done') return task;
      if (task.status === 'failed' || task.status === 'cancelled') throw new TaskFailed(task);
      const left = deadline - Date.now();
      if (left <= 0) throw new TaskTimeout(task, timeout);
      await sleep(Math.min(delay, left));
      delay = Math.min(delay * 1.5, 10_000);
    }
  }

  /** Create a task and wait for it in one call. */
  async solve(type, task, { proxy, timeout, interval } = {}) {
    const created = await this.createTask(type, task, { proxy });
    return this.wait(created.id, { timeout, interval });
  }

  // ------------------------------------------------------------------ webhook
  /** Register an HTTPS callback URL. Deliveries are signed (HMAC-SHA256). */
  setWebhook(url, { secret } = {}) {
    return this.#request('PUT', '/v1/webhook', { body: secret ? { url, secret } : { url } });
  }

  /** Current webhook configuration. */
  webhook() {
    return this.#request('GET', '/v1/webhook');
  }

  /** Recent delivery attempts, useful when debugging a callback. */
  webhookDeliveries({ limit = 50 } = {}) {
    return this.#request('GET', '/v1/webhook/deliveries', { query: { limit } });
  }
}

export default SolveHub;
