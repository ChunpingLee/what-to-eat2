async function deployRules(manager, envId, collections) {
  await Promise.all(collections.map(({ name }) => manager.database.createCollectionIfNotExists(name)))
  await Promise.all(collections.map(({ name, aclTag, rule }) => manager.commonService().call({
    Action: 'ModifySafeRule',
    Param: { CollectionName: name, EnvId: envId, AclTag: aclTag, Rule: JSON.stringify(rule) },
  })))
}

module.exports = { deployRules }
