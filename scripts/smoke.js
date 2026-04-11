const http = require('http');
const { URL } = require('url');

const SERVICE_URL = process.env.SMOKE_URL || 'http://localhost:3000/offers';
const url = new URL(SERVICE_URL);

const options = {
  hostname: url.hostname,
  port: url.port || 80,
  path: url.pathname + url.search,
  method: 'GET',
  timeout: 5000
};

const req = http.request(options, function (res) {
  if (res.statusCode === 200) {
    console.log('Smoke test ok:', SERVICE_URL);
    process.exit(0);
  }

  console.error('Smoke test failed: expected 200 but got ' + res.statusCode);
  process.exit(1);
});

req.on('timeout', function () {
  console.error('Smoke test timeout (5s)');
  req.destroy();
  process.exit(1);
});

req.on('error', function (err) {
  console.error('Smoke test error:', err.message || err.code, err);
  process.exit(1);
});

req.end();
