import { request } from 'undici';

const BASE_URL = process.env.TEST_API_URL || 'http://localhost:3000/api/v2';

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
        message: `🚀 <b>[New Rental] (Test)</b>\n\n` +
                 `<b>Rig:</b> Test-Rig-99\n` +
                 `<b>Algo:</b> SHA256\n` +
                 `<b>Current Avg:</b> 500.00 MH/s\n` +
                 `<b>Efficiency:</b> 98.5%\n` +
                 `<b>Paid:</b> 0.00123456 BTC\n` +
                 `<b>Remaining:</b> 2.50h\n` +
                 `<b>Target to 100%:</b> 512.45 MH/s\n` +
                 `<b>Account:</b> BT`
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