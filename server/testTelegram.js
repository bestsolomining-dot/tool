// test-telegram.js
import 'dotenv/config';

async function testTelegram() {
  const botToken = process.env.TELEGRAM_MINE_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_GROUP_ID;
  
  console.log('=== Telegram Test ===');
  console.log(`Bot Token: ${botToken ? '✓ Present (length: ' + botToken.length + ')' : '✗ Missing'}`);
  console.log(`Chat ID: ${chatId ? '✓ Present (length: ' + chatId.length + ')' : '✗ Missing'}`);
  
  if (!botToken || !chatId) {
    console.log('❌ Missing credentials. Check .env file');
    return;
  }
  
  try {
    // Test bot token
    console.log('\n1. Testing bot token...');
    const meRes = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
    const meData = await meRes.json();
    
    if (!meData.ok) {
      console.log(`❌ Bot token invalid: ${meData.description}`);
      return;
    }
    console.log(`✅ Bot connected: @${meData.result.username}`);
    
    // Test send message
    console.log('\n2. Testing send message...');
    const msg = `🔍 <b>Telegram Test</b>\n━━━━━━━━━━━━━━━━━━\nBot is working! ✅\nTime: ${new Date().toLocaleString()}\n━━━━━━━━━━━━━━━━━━`;
    
    const sendRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: msg,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      })
    });
    
    const sendData = await sendRes.json();
    
    if (!sendData.ok) {
      console.log(`❌ Failed to send: ${sendData.description}`);
      console.log('   Tip: Make sure you started a chat with the bot first');
      return;
    }
    
    console.log('✅ Test message sent successfully!');
    console.log(`   Chat ID: ${sendData.result.chat.id}`);
    console.log(`   Message ID: ${sendData.result.message_id}`);
    
  } catch (err) {
    console.error('❌ Error:', err.message);
  }
}

testTelegram();