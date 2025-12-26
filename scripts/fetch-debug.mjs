import fetch from 'node-fetch';

(async () => {
  try {
    const res = await fetch('http://localhost:5173/debug/webauthn-test');
    const body = await res.text();
    console.log('STATUS', res.status);
    console.log(body);
  } catch (err) {
    console.error('Fetch error', err);
    process.exit(1);
  }
})();