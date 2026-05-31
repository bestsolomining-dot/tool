import { request } from 'undici';

const BASE_URL = 'http://localhost:3000/api/v2';

async function runTests() {
  console.log('--- Starting Notification Integration Tests ---');
  console.log(`Targeting local server at: ${BASE_URL}`);

  // Test Telegram
  console.log('\n[1/1] Testing Telegram Notifier...');
  try {
    const tgRes = await request(`${BASE_URL}/notify/telegram`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        message: `🚀 <b>[Test] Integration Script</b>\nSuccessfully reached the local API.\n<i>Time: ${new Date().toLocaleTimeString()}</i>` 
      })
    });

    if (tgRes.statusCode !== 200) {
      const text = await tgRes.body.text();
      console.error(`Telegram test failed with status ${tgRes.statusCode}. Server returned: ${text.slice(0, 100)}...`);
    } else {
      const tgData = await tgRes.body.json();
      console.log('Telegram API Response:', JSON.stringify(tgData, null, 2));
    }
  } catch (e) {
    console.error('Telegram integration failed:', e.message);
  }
}

runTests();