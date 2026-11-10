# solvehub-node

Node client for the [SolveHub](https://www.tiam.codes) CAPTCHA API — **one REST endpoint** for
Cloudflare Turnstile, Cloudflare Interstitial, DataDome, Akamai, PerimeterX / HUMAN, Imperva,
AWS WAF, Alibaba Cloud CAPTCHA 2.0, Arkose FunCaptcha and image-text OCR.

- **Zero dependencies.** Node 18+ only, for the built-in `fetch`.
- **Pay per solved task.** The price is frozen at creation and charged only when the task
  completes; failed or cancelled tasks are refunded.
- **Idempotent.** Every create request carries an `Idempotency-Key`, so a network timeout never
  turns into a duplicate charge.
- **Proxy aware.** Cookie-based challenges (DataDome, Akamai, PerimeterX, Imperva, AWS WAF) accept
  your own proxy and return cookies you reuse **with the same IP and User-Agent**.

## Install

```bash
npm install "github:seencxy/solvehub-node"
```

Or copy `index.js` into your project — it is a single ESM file.

## Quick start

```js
import { SolveHub } from 'solvehub-node';

const client = new SolveHub(process.env.SOLVEHUB_KEY);

const task = await client.solve('turnstile', {
  websiteURL: 'https://example.com/login',
  websiteKey: '0x4AAAAAAA_SITE_KEY',
});

console.log(task.solution.value); // the token you post back to the site
```

`solve()` creates the task, polls every 2–3 s with backoff and resolves once the task is `done`.
Use `createTask()` + `wait()` when you want to drive polling yourself.

## Cookie-based challenges

```js
const task = await client.solve(
  'datadome',
  { websiteURL: 'https://example.com', captchaUrl: 'https://example.com/captcha' },
  { proxy: 'http://user:pass@host:port' },
);

const cookies = task.solution.cookies;   // { datadome: '...' }
const userAgent = task.solution.userAgent;

// reuse BOTH, from the same IP, in your scraping session
```

## Webhooks instead of polling

```js
await client.setWebhook('https://your-app.example/solvehub', { secret: 'whsec_...' });
```

Deliveries are signed with **HMAC-SHA256** over the raw body:

```js
import { verifyWebhook } from 'solvehub-node';

app.post('/solvehub', express.raw({ type: '*/*' }), (req, res) => {
  if (!verifyWebhook(req.body, req.get('x-solvehub-signature'), process.env.WH_SECRET)) {
    return res.sendStatus(401);
  }
  const { id, status, solution } = JSON.parse(req.body.toString('utf8'));
  // ...
  res.sendStatus(204);
});
```

`verifyWebhook()` needs the **raw bytes** — do not re-serialise the JSON first.

## Concurrency

Every call is a plain `fetch`, so `Promise.all` with a small concurrency limit is enough:

```js
import pLimit from 'p-limit';
const limit = pLimit(8);
const results = await Promise.all(
  urls.map((url) =>
    limit(() => client.solve('turnstile', { websiteURL: url, websiteKey: SITE_KEY })),
  ),
);
```

## API surface

| Method | Endpoint | Notes |
| --- | --- | --- |
| `prices()` | `GET /v1/prices` | public price catalogue, no login needed |
| `createTask(type, task, { proxy })` | `POST /v1/tasks` | resolves with `queued` |
| `getTask(id)` | `GET /v1/tasks/{id}` | status + solution |
| `listTasks({ limit })` | `GET /v1/tasks` | most recent tasks |
| `cancelTask(id)` | `POST /v1/tasks/{id}/cancel` | refunds the reserved amount |
| `balance()` | `GET /v1/balance` | available and reserved balance |
| `setWebhook(url, { secret })` | `PUT /v1/webhook` | HTTPS callback |

`solve()` and `wait()` are conveniences on top of the above. A task that stays `uncertain`
(a challenge the solver could not judge) is **not** terminal: polling continues.

## Links

- Website and docs: <https://www.tiam.codes>
- API reference: <https://www.tiam.codes/docs>
- Python client: [solvehub-python](https://github.com/seencxy/solvehub-python)
- Cookie glossary: <https://seencxy.github.io/glossary/> — what `_abck`, `reese84`, `_px3` and `cf_clearance` each contain, and why they expire (English, 日本語, Bahasa Indonesia)

## Types

`types/index.d.ts` ships with the package; `SolveHub` accepts `{ baseUrl, timeout }` options.

## Licence

MIT — see [LICENSE](LICENSE).
