'use strict';

// The HazeGate function: https://<your-function-app>.azurewebsites.net/api/hazegate
// GET checks that the function works (PhantomHaze's Settings -> Test button); POST downloads a page or a part of one.
// Requests need the function key (authLevel "function"), which PhantomHaze sends in the x-functions-key header.

const { app } = require('@azure/functions');
const { handleRequest, toHttpResponse, MAX_REQUEST_BYTES } = require('../lib/handler');

app.http('hazegate', {
  methods: ['GET', 'POST'],
  authLevel: 'function',
  route: 'hazegate',
  handler: async (request, context) => {
    const started = Date.now();
    const declared = Number(request.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) {
      return toHttpResponse({ status: 413, json: { v: 1, error: 'The request is too large.' } }, null);
    }

    const body = request.method === 'POST' ? Buffer.from(await request.arrayBuffer()) : Buffer.alloc(0);
    let answer;
    try {
      answer = await handleRequest({ method: request.method, body });
    } catch (error) {
      context.error(`HazeGate failed: ${error && error.stack ? error.stack : error}`);
      answer = { status: 500, json: { v: 1, error: 'HazeGate failed while downloading the page.' } };
    }

    // Only the site's host name is logged, never the full address (it can contain personal data).
    context.log(`HazeGate ${request.method} ${answer.host || '-'} -> ${answer.status} in ${Date.now() - started} ms`);
    return toHttpResponse(answer, request.headers.get('accept-encoding'));
  },
});
