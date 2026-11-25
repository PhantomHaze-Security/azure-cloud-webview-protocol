# HazeGate (azure-cloud-webview-protocol)

HazeGate is the cloud Web View protocol of [PhantomHaze](https://github.com/PhantomHaze-Security/PhantomHaze). This
repository is the Azure Function behind it:

1. PhantomHaze sends the function the address of a page.
2. The function downloads the page, finds the stylesheets and scripts it uses (`<link rel="stylesheet">`,
   `<script src>`, preloads, CSS `@import`s and the static imports of JavaScript modules), downloads them too, and sends
   everything back in one answer.
3. PhantomHaze draws the page with its HTMLRenderer engine (HTML Renderer, with its own CSS cascade and the Jint
   JavaScript engine). Images and the page's own requests (`fetch`, `XMLHttpRequest`, form submissions) also go through
   the function, so the sites you visit only ever see Azure, never your PC.

It is a Node.js 22 function using the [v4 programming model](https://learn.microsoft.com/azure/azure-functions/functions-reference-node)
and runs on the Consumption plan (Windows or Linux).

## Setting it up

### 1. Deploy the function

Nothing to do by hand: every push to `main` runs the GitHub Actions workflow in
`.github/workflows/main_website-fetcher.yml`, which installs the dependencies, runs the tests and deploys the function
to the Function App **website-fetcher**. Open the **Actions** tab of this repository to watch it; the deploy takes a few
minutes. If the tests fail, nothing is deployed.

### 2. Copy the function's address into PhantomHaze

1. Sign in to [Azure Portal](https://portal.azure.com).
2. Search for **website-fetcher** at the top (or open **Function App** and click it).
3. On its **Overview** page, the **Functions** tab lists **hazegate** (if it is not there yet, wait for the deploy to
   finish and refresh). Click **hazegate**.
4. Click **Get function URL** at the top, and copy the **default (Function key)** URL. It looks like
   `https://website-fetcher.azurewebsites.net/api/hazegate?code=...` (newer apps have a longer address, such as
   `https://website-fetcher-abc123.eastus-01.azurewebsites.net/...`; copy it exactly as shown).
5. In PhantomHaze, open **Settings → General**, paste the URL into **HazeGate function**, click **Test**, choose
   **HazeGate** as the **Web View protocol**, and click **Save**.

The part after `?code=` is the function key, which keeps other people from using your function. PhantomHaze stores it
encrypted for your Windows account and sends it in a header, never in addresses. If the key ever leaks, open the
function's **Function Keys** page in Azure Portal, renew the `default` key, and paste the new URL into PhantomHaze.

### 3. (Optional) Keep an eye on usage and cost

The Consumption plan is billed per execution and per GB-second, with a monthly free grant (1 million executions and
400,000 GB-s). Opening a page usually takes one execution for the page (with its stylesheets and scripts) plus one per
image or script request. **Monitor → Metrics** on the Function App shows the number of executions; **Cost Management**
in Azure Portal shows what it costs. To stop HazeGate completely, click **Stop** on the Function App's Overview page.

## The HazeGate protocol (version 1)

All requests go to the function's address and need the function key, either in the `x-functions-key` header (what
PhantomHaze does) or as `?code=`.

### `GET`: status check

Answers `{"service": "HazeGate", "version": "1.0.0", "protocol": 1}`. PhantomHaze's **Test** button uses it.

### `POST`: download

The request is a JSON object:

| Field | Meaning |
| --- | --- |
| `v` | Protocol version: `1`. |
| `mode` | `"page"` (a page the user opens) or `"resource"` (an image, a script, a `fetch()` request...). |
| `url` | The absolute `http://` or `https://` address. |
| `method` | `GET` (default) or `POST` for pages; also `HEAD`, `PUT`, `PATCH`, `DELETE`, `OPTIONS` for resources. |
| `body` | The request body, Base64 (form submissions, `fetch()` bodies). |
| `contentType` | The body's `Content-Type`. |
| `cookie` | The `Cookie` header for this address (PhantomHaze keeps the cookies; the function keeps nothing). |
| `referrer` | The page the request comes from (sent as `Referer` the way browsers do by default). |
| `userAgent`, `acceptLanguage`, `accept` | Sent to the site as these headers. |
| `headers` | Other headers a page script set (unsafe ones are left out). |
| `bundle` | `true` in page mode: also download the page's stylesheets and scripts. |
| `maxBytes` | The largest answer the caller accepts (at most 16 MB). |

The answer (HTTP 200) is a JSON object, compressed with gzip when the request accepts it:

| Field | Meaning |
| --- | --- |
| `url`, `status`, `statusText`, `contentType` | The site's answer for `url`. **Redirects are not followed**: the caller checks the next address first (PhantomHaze checks it against extensions' `web.block` rules). |
| `location` | The absolute redirect target for 301, 302, 303, 307 and 308 answers. |
| `setCookies` | The site's `Set-Cookie` headers. |
| `headers` | The other response headers, as `[name, value]` pairs. |
| `text` or `body` | The body: `text` when it is valid UTF-8, otherwise `body` in Base64. |
| `resources` | Page mode with `bundle`: the stylesheets and scripts, each with `url` (as referenced), `finalUrl` and `redirects` (stylesheets and scripts may redirect), `status`, `contentType`, `text` or `body`, or `error`. They are downloaded without cookies. |

When the site cannot be reached, or the address is not allowed, the function answers with an HTTP error and
`{"error": "..."}`, a message PhantomHaze shows as it is.

## Safety

- **Private networks are off limits.** Every address a host name resolves to is checked, and the connection is made
  to the checked address itself (no DNS rebinding). Loopback, private, link-local (including the
  `169.254.169.254` metadata endpoint), carrier-grade NAT, multicast and reserved ranges, Azure's `168.63.129.16`, and
  IPv6 addresses that carry any of them are refused, for every request and every redirect.
- **Only web ports.** Ports browsers refuse (mail, SSH, FTP...) are refused.
- **Limits.** A page can be at most 16 MB, each stylesheet or script 8 MB, and the stylesheets and scripts of a page
  together 24 MB (at most 60 of them, 25 seconds). Requests time out after 20 to 30 seconds.
- **Privacy.** The function keeps nothing between requests: no cookies, no cache. It only logs the host name, status
  and duration of each request, never the full address.

## Working on it

- `npm test` runs the tests (Node's built-in test runner; no internet needed).
- To run the function on your PC, install [Azure Functions Core Tools](https://learn.microsoft.com/azure/azure-functions/functions-run-local),
  create a `local.settings.json` with `{"IsEncrypted": false, "Values": {"FUNCTIONS_WORKER_RUNTIME": "node",
  "AzureWebJobsStorage": ""}}`, and run `npm start`. The function is then at `http://localhost:7071/api/hazegate`
  (no key needed locally), which PhantomHaze accepts as a HazeGate address too.

| File | What it does |
| --- | --- |
| `src/functions/hazegate.js` | Registers the HTTP function (`/api/hazegate`, function key required). |
| `src/lib/handler.js` | The protocol: checks requests, downloads, builds the answer. |
| `src/lib/fetcher.js` | Safe downloading: address checks, DNS pinning, limits, decompression. |
| `src/lib/addresses.js` | Which IP addresses and ports are allowed. |
| `src/lib/discover.js` | Finds the stylesheets and scripts of a page. |
