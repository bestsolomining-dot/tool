import crypto from 'crypto';

// Generate a random string of 64 bytes (512 bits) and convert it to a hexadecimal string.
// A length of 32 bytes (256 bits) is also commonly used and sufficient for most cases.
const jwtSecret = crypto.randomBytes(64).toString('hex');

console.log('Your new JWT_SECRET:');
console.log(jwtSecret);
