const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const CloudBase = require('@cloudbase/manager-node')

const envId = process.env.TCB_ENV_ID
if (!envId) throw new Error('TCB_ENV_ID is required')

const manager = new CloudBase({
  secretId: process.env.TENCENTCLOUD_SECRETID,
  secretKey: process.env.TENCENTCLOUD_SECRETKEY,
  envId,
})
const { collections } = JSON.parse(readFileSync(resolve(__dirname, 'database.rules.json'), 'utf8'))

Promise.all(collections.map(({ name, aclTag, rule }) => manager.commonService().call({
  Action: 'ModifySafeRule',
  Param: { CollectionName: name, EnvId: envId, AclTag: aclTag, Rule: JSON.stringify(rule) },
}))).catch(error => {
  console.error(error)
  process.exitCode = 1
})
