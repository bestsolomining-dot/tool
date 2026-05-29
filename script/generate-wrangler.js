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
  NICEHASH_ENVIRONMENT_PH: process.env.NICEHASH_ENVIRONMENT_PH,
  NICEHASH_ENVIRONMENT: process.env.NICEHASH_ENVIRONMENT || 'production',
  RIG_API_KEY_BT: process.env.RIG_API_KEY_BT,
  RIG_API_SECRET_BT: process.env.RIG_API_SECRET_BT,
  RIG_API_KEY_SL: process.env.RIG_API_KEY_SL,
  RIG_API_SECRET_SL: process.env.RIG_API_SECRET_SL,
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
