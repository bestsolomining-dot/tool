<?php
$api_key = 'fbf14acf7b8031a780c3695006ed1ebd0d37dcabdd251bd904b01f1dca73eade';
$api_secret = '28277fe1b248418e50912ac128924cdf031263f3de3734a89946615e64085376';
$mtime = explode(' ', microtime());
$nonce = $mtime[1] . substr($mtime[0], 2, 4);
$endpoint = '/whoami';
$sign_string = $api_key . $nonce . $endpoint;
$sign = hash_hmac('sha1', $sign_string, $api_secret);
$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, 'https://www.miningrigrentals.com/api/v2/whoami');
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    'x-api-key: ' . $api_key,
    'x-api-nonce: ' . $nonce,
    'x-api-sign: ' . $sign
]);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
$response = curl_exec($ch);
curl_close($ch);
echo $response;
?>