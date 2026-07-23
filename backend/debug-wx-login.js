require('dotenv/config');
const axios = require('axios');

async function testWxLogin() {
  try {
    console.log('AppID:', process.env.WX_APP_ID);
    console.log('AppSecret:', process.env.WX_APP_SECRET ? 'configured' : 'not configured');
    
    const res = await axios.get('https://api.weixin.qq.com/sns/jscode2session', {
      params: {
        appid: process.env.WX_APP_ID || 'wx60a0c04ff6885b0d',
        secret: process.env.WX_APP_SECRET || 'a5e00859fc7e3fa6b5a14d22c64cd4d7',
        js_code: 'test-code',
        grant_type: 'authorization_code',
      },
      timeout: 8000,
    });
    
    console.log('Response status:', res.status);
    console.log('Response data:', JSON.stringify(res.data));
    
    if (res.data.errcode) {
      console.log('Has errcode, throwing error');
      throw new Error(`微信登录失败: ${res.data.errcode} ${res.data.errmsg}`);
    }
    
    return res.data;
  } catch (e) {
    console.log('Error type:', Object.prototype.toString.call(e));
    console.log('Error message:', e.message);
    console.log('Error code:', e.code);
    console.log('Error response:', e.response ? JSON.stringify(e.response.data) : 'none');
    console.log('Error config:', e.config ? JSON.stringify(e.config) : 'none');
    throw e;
  }
}

testWxLogin();