import assert from 'node:assert/strict';

const edgeUrl = (process.env.EDGE_URL ?? 'http://127.0.0.1:8080').replace(/\/$/, '');
const instances = new Set();

for (let attempt = 0; attempt < 12; attempt += 1) {
  const response = await fetch(`${edgeUrl}/graphql`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      connection: 'close',
    },
    body: JSON.stringify({ query: '{ catalogHealth { status } }' }),
    signal: AbortSignal.timeout(5_000),
  });
  const responseText = await response.text();

  assert.equal(response.status, 200, `GraphQL load-balancer probe returned ${response.status}.`);
  let body;
  try {
    body = JSON.parse(responseText);
  } catch {
    assert.fail(
      `GraphQL load-balancer probe returned a non-JSON response: ${responseText.slice(0, 120)}`,
    );
  }
  assert.equal(
    body.data?.catalogHealth?.status,
    'UP',
    'A balanced Gateway response was not ready.',
  );
  assert.equal(
    response.headers.get('x-load-balancer'),
    'nginx-round-robin',
    'The request did not pass through the configured Nginx load balancer.',
  );

  const instance = response.headers.get('x-gateway-instance');
  assert(instance, 'The GraphQL Gateway did not identify its listener.');
  instances.add(instance);
}

assert(
  instances.size >= 2,
  `Expected traffic to reach at least two GraphQL Gateway listeners, observed: ${[
    ...instances,
  ].join(', ')}`,
);

console.log(
  `Nginx distributed GraphQL traffic across listeners: ${[...instances].sort().join(', ')}.`,
);
