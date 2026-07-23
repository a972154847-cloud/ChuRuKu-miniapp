const https = require('https');

const req = https.get('https://api.weixin.qq.com', (res) => {
  console.log('Status:', res.statusCode);
  res.on('data', (chunk) => {
    console.log('Response:', chunk.toString());
  });
});

req.on('error', (e) => {
  console.log('Error:', e.message);
});

req.setTimeout(5000, () => {
  console.log('Timeout');
  req.destroy();
});

req.end();