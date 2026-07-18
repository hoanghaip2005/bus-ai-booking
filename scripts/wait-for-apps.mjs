const endpoints = [
  'http://127.0.0.1:8080/health',
  'http://127.0.0.1:4010/health/ready',
  'http://127.0.0.1:8080/gateway-health',
  'http://127.0.0.1:8080/catalog-health',
  'http://127.0.0.1:8080/seat-inventory-health',
  'http://127.0.0.1:8080/booking-health',
  'http://127.0.0.1:8080/payment-health',
  'http://127.0.0.1:8080/ticket-health',
  'http://127.0.0.1:8080/notification-health',
  'http://127.0.0.1:8080/identity-health',
  'http://127.0.0.1:8080/analytics-health',
  'http://127.0.0.1:8080/mcp-health',
];

const deadline = Date.now() + 90_000;

while (Date.now() < deadline) {
  const results = await Promise.all(
    endpoints.map(async (endpoint) => {
      try {
        const response = await fetch(endpoint, { signal: AbortSignal.timeout(2_000) });
        return [endpoint, response.ok];
      } catch {
        return [endpoint, false];
      }
    }),
  );
  const pending = results.filter(([, ready]) => !ready).map(([endpoint]) => endpoint);
  if (pending.length === 0) {
    console.log('All application endpoints are ready.');
    process.exit(0);
  }
  console.log(`Waiting for applications: ${pending.join(', ')}`);
  await new Promise((resolve) => setTimeout(resolve, 2_000));
}

console.error('Applications did not become ready within 90 seconds.');
process.exit(1);
