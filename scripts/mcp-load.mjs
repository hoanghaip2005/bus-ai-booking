const endpoint = process.env.MCP_EDGE_URL ?? 'http://127.0.0.1:8080/mcp';
const requestCount = 20;
const concurrency = 4;
const durations = [];

for (let offset = 0; offset < requestCount; offset += concurrency) {
  await Promise.all(
    Array.from({ length: Math.min(concurrency, requestCount - offset) }, async (_, index) => {
      const startedAt = performance.now();
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: offset + index + 1,
          method: 'resources/list',
          params: {},
        }),
        signal: AbortSignal.timeout(5_000),
      });
      const body = await response.text();
      if (!response.ok || !body.includes('bus://system/health')) {
        throw new Error(`MCP load request failed with HTTP ${response.status}.`);
      }
      durations.push(performance.now() - startedAt);
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 100));
}

durations.sort((left, right) => left - right);
const p95 = durations[Math.ceil(durations.length * 0.95) - 1] ?? 0;
if (p95 > 2_000) throw new Error(`MCP resource-list p95 ${Math.round(p95)}ms exceeded 2000ms.`);
console.log(
  `MCP bounded load passed: ${durations.length} requests, concurrency ${concurrency}, p95 ${Math.round(p95)}ms.`,
);
