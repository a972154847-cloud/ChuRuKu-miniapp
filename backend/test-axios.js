const axios = require('axios');

async function testWxLogin() {
  try {
    const res = await axios.get('https://api.weixin.qq.com/sns/jscode2session', {
      params: {
        appid: 'wx60a0c04ff6885b0d',
        secret: 'a5e00859fc7e3fa6b5a14d22c64cd4d7',
        js_code: 'test-code',
        grant_type: 'authorization_code',
      },
      timeout: 8000,
    });
    console.log('Success:', JSON.stringify(res.data));
  } catch (error) {
    console.log('Error:', error.message);
    console.log('Error code:', error.code);
    console.log('Response:', error.response ? JSON.stringify(error.response.data) : 'none');
  }
}

testWxLogin();