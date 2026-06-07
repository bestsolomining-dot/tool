import fs from 'fs'
import path from 'path'
import dotenv from 'dotenv'

const projectRoot = path.resolve()
dotenv.config({ path: path.join(projectRoot, '.env') })

const templatePath = path.join(projectRoot, 'wrangler.toml')
const outputPath = path.join(projectRoot, 'wrangler.generated.toml')

const template = fs.readFileSync(templatePath, 'utf8')

const vars = {
  NICEHASH_API_KEY: process.env.NICEHASH_API_KEY,
  NICEHASH_API_SECRET: process.env.NICEHASH_API_SECRET,
  NICEHASH_ORG_ID: process.env.NICEHASH_ORG_ID,

  NICEHASH_API_KEY_PH: process.env.NICEHASH_API_KEY_PH,
  NICEHASH_API_SECRET_PH: process.env.NICEHASH_API_SECRET_PH,
  NICEHASH_ORG_ID_PH: process.env.NICEHASH_ORG_ID_PH,

  NICEHASH_API_KEY_VN: process.env.NICEHASH_API_KEY_VN,
  NICEHASH_API_SECRET_VN: process.env.NICEHASH_API_SECRET_VN,
  NICEHASH_ORG_ID_VN: process.env.NICEHASH_ORG_ID_VN,

  NICEHASH_ENVIRONMENT_VN: process.env.NICEHASH_ENVIRONMENT_VN || 'production',
  NICEHASH_ENVIRONMENT_PH: process.env.NICEHASH_ENVIRONMENT_PH || 'production',
  NICEHASH_ENVIRONMENT: process.env.NICEHASH_ENVIRONMENT || 'production',

  MRR_KEY_RIG_BT: process.env.MRR_KEY_RIG_BT,
  MRR_SECRET_RIG_BT: process.env.MRR_SECRET_RIG_BT,

  MRR_KEY_RIG_SL: process.env.MRR_KEY_RIG_SL,
  MRR_SECRET_RIG_SL: process.env.MRR_SECRET_RIG_SL,

  MRR_KEY_RIG_LN: process.env.MRR_KEY_RIG_LN,
  MRR_SECRET_RIG_LN: process.env.MRR_SECRET_RIG_LN,

  MRR_KEY_RIG_LUCKY: process.env.MRR_KEY_RIG_LUCKY,
  MRR_SECRET_RIG_LUCKY: process.env.MRR_SECRET_RIG_LUCKY,

  MRR_NONCE_OVERRIDE_LUCKY: process.env.MRR_NONCE_OVERRIDE_LUCKY,
  MRR_NONCE_OVERRIDE_LN: process.env.MRR_NONCE_OVERRIDE_LN,
  MRR_NONCE_OVERRIDE_SL: process.env.MRR_NONCE_OVERRIDE_SL,
  MRR_NONCE_OVERRIDE_BT: process.env.MRR_NONCE_OVERRIDE_BT,

  MRR_DEFAULT_CLIENT: process.env.MRR_DEFAULT_CLIENT,
  NH_DEFAULT_CLIENT: process.env.NH_DEFAULT_CLIENT,
}

const missingKeys = Object.entries(vars)
  .filter(([_, value]) => typeof value === 'undefined' || value === '')
  .map(([key]) => key)

if (missingKeys.length > 0) {
  console.warn(`Warning: the following env vars are missing and will be omitted from generated worker bindings: ${missingKeys.join(', ')}`)
}

const varsSnippet = Object.entries(vars)
  .filter(([_, value]) => typeof value !== 'undefined' && value !== '')
  .map(([key, value]) => `${key} = ${JSON.stringify(value)}`)
  .join('\n')

const output = `${template}\n\n[vars]\n${varsSnippet}\n`
fs.writeFileSync(outputPath, output, 'utf8')
console.log(`Generated ${path.basename(outputPath)} from .env`)
