const USE_CACHE = false;
const DEFAULT_PLAID_CONFIG = {
  url: "https://development.plaid.com",
  clientId: null,
  secret: null,
}
const DEFAULT_DATA = {
  // categories are separate so that they can be used between budgets
  categories: [],
  budgets: [
  ],
  // actions are separate so that they can be used between budgets
  actions: [],
  // plaid import options
  plaid: {
    cursor: null,
    transactionKeys: ['amount', 'date', 'account_name', 'name', 'merchant_name', 'pending', 'plaid_category']
  },
}

const DEFAULT_BUDGET = {
  name: null,
  categoryIds: [],
  actions: []
}

function test() {
  // const plaidTransactions = loadTransactions()
  // const transactions = plaidTransactions.map((t, i) => {
  //   const t2 = convertPlaidTransaction(t)
  //   t2.id = i
  // })
  // saveTransactions(transactions)
  // resetTestData()
  // testMe()
}

function convertPlaidTransaction(plaidTransaction) {
  const transaction = {
    id: null,
    date: plaidTransaction.date,
    name: plaidTransaction.name,
    amount: plaidTransaction.amount,
    source: 'plaid',
    data: {...plaidTransaction}
  }
  return transaction;
}

function fetchPlaidTransactions() {
  const userData = loadUser();
  const { url, clientId, secret, accessToken } = userData.plaid
  let cursor = userData.plaid.cursor
  const endpoint = `${url}/transactions/sync`
  // New transaction updates since "cursor"
  let added = [];
  let modified = [];
  // Removed transaction ids
  let removed = [];
  let hasMore = true;
  // Iterate through each page of new transaction updates for item
  while (hasMore) {
    const transactionSyncOptions = {
      client_id: clientId,
      secret: secret,
      access_token: accessToken,
      cursor: cursor,
      count: 500
    }
    const fetchOptions = {
      'method': 'post',
      'contentType': 'application/json',
      'payload': JSON.stringify(transactionSyncOptions)
    };
    const response = UrlFetchApp.fetch(endpoint, fetchOptions)
    const data = JSON.parse(response.getContentText());
    
    // Add this page of results
    added = added.concat(data.added);
    modified = modified.concat(data.modified);
    removed = removed.concat(data.removed);
    hasMore = data.has_more;

    // Update cursor to the next cursor
    cursor = data.next_cursor;
  }

  const removedIds = new Set([removed.map(t => t.transaction_id)])
  const modifiedMap = new Map(modified.map(t => [t.transaction_id, t]))
  // load existing
  // filter out removed ones
  // replace modified ones
  const transactions = loadTransactions()
  .filter(t => t.source !== 'plaid' || !removedIds.has(t.data?.transaction_id))
  .map(t => {
    if (t.source === 'plaid' && modifiedMap.get(t.transaction_id)) {
    const plaidTransaction = modifiedMap.get(t.transaction_id)
     return convertPlaidTransaction(plaidTransaction)
    }
    return t
  })
  // add new
  const transactionRepo = new InMemoryGenericRepository(transactions)
  added = added.map(t => convertPlaidTransaction(t))
  transactionRepo.createAll(added)
  saveTransactions(transactions)
  userData.plaid.cursor = cursor
  saveUser(userData)
  return added.length
}
function resetTestData() {
  CacheService.getUserCache().removeAll(['user', 'budgets','categories','transactions'])
  PropertiesService.getUserProperties().deleteAllProperties()
  const user = loadUser()

  let newBudget = {
    name: "Shared",
  }
  let newCategories = [
    {
      name: "Income",
      includes: [
        {
          name: "COMPANY"
        }
      ]
    },
    {
      name: "Electric/Gas",
      includes: [
        {
          name: "xcel"
        }
      ]
    }
  ]
  // save and link up categories and budgets
  const categories = loadCategories()
  const budgets = loadBudgets()
  const catRepo = new InMemoryGenericRepository(categories)
  const budgetRepo = new InMemoryGenericRepository(budgets)
  newCategories = newCategories.map(c => catRepo.createOne(c))
  newBudget.categoryIds = newCategories.map(c => c.id)
  newBudget = budgetRepo.createOne(newBudget)
  newBudget.name = 'Shared Expenses'
  newBudget = budgetRepo.updateOne(newBudget)
  newCategories[0].includes.push({ name: 'paypal', amount: '[^\\-]' })
  newCategories = catRepo.createOrUpdateAll(newCategories)
  // persist changes
  saveUser(user)
  saveCategories(categories)
  saveBudgets(budgets)
}

function displayData() {
  const user = loadUser()
  const categories = loadCategories()
  const budgets = loadBudgets()
  const transactions = loadTransactions()
  console.log(`User:`)
  console.log(JSON.stringify(user))
  console.log(`Budgets:`)
  console.log(JSON.stringify(budgets))
  console.log(`Categories:`)
  console.log(JSON.stringify(categories))
  console.log(`transactions:`)
  console.log(JSON.stringify(transactions.slice(0,4)))
}

function clearAllData() {
  return PropertiesService.getUserProperties().deleteAllProperties()
}

function loadValue(key, options = { defaultValue: null, useCache: true, mergeObject: null }) {
  const userCache = CacheService.getUserCache()
  const userProps = PropertiesService.getUserProperties()

  // if the cache has a value parse it out,
  // otherwise get from user properties
  // otherwise use default value
  let value = options.useCache ? userCache.get(key) : null
  if (value !== undefined && value !== null) {
    value = JSON.parse(value)
  } else {
    value = userProps.getProperty(key)
    if (value !== undefined && value !== null) {
      value = JSON.parse(value)
    } else {
      value = options.defaultValue
    }
  }
  const finalValue = options.mergeObject !== undefined && options.mergeObject !== null ? mergeDeep({}, options.mergeObject, value) : value
  if (options.useCache) {
    userCache.put(key, JSON.stringify(finalValue))
  }
  return finalValue
}

function saveValue(key, value, options = { useCache: true }) {
  const userCache = CacheService.getUserCache()
  const userProps = PropertiesService.getUserProperties()
  const stringified = JSON.stringify(value)
  if (options.useCache) {
    userCache.put(key, stringified)
  }
  userProps.setProperty(key, stringified)
}

function loadUser() {
  const DEFAULT_USER = {
    plaid: {
      url: "https://development.plaid.com",
      clientId: null,
      secret: null,
      accessToken: null,
      cursor: null,
    }
  }
  return loadValue('user', { defaultValue: {}, mergeObject: DEFAULT_USER, useCache: USE_CACHE })
}

function loadCategories() {
  return loadValue('categories', { defaultValue: [], useCache: USE_CACHE})
}
function saveCategories(categories) {
  return saveValue('categories', categories, { useCache: USE_CACHE })
}

function loadTransactions(startDateIsoString, endDateIsoString) {
  const transactions = loadValue('transactions', { defaultValue: [], useCache: USE_CACHE})
  return transactions
}
function saveTransactions(transactions) {
  return saveValue('transactions', transactions, { useCache: USE_CACHE })
}

function loadBudgets() {
  return loadValue('budgets', { defaultValue: [], useCache: USE_CACHE})
}
function saveBudgets(budgets) {
  return saveValue('budgets', budgets, { useCache: USE_CACHE })
}

function saveUser(userData) {
  return saveValue('user', userData, { useCache: USE_CACHE })
}

function loadAllData() {
  return {
    user: loadUser(),
    budgets: loadBudgets(),
    categories: loadCategories()
  }
}

class IRepository {
  createOne(object) {
    new Error(`Unimplemented`)
  }
  createAll(objects) {
    return objects.map(o => this.createOne(o))
  }
  getOne(id) {
    new Error(`Unimplemented`)
  }
  getAll() {
    new Error(`Unimplemented`)
  }
  updateOne(object) {
    new Error(`Unimplemented`)
  }
  updateAll(objects) {
    return objects.map(o => this.updateOne(o))
  }
  deleteOne(id) {
    new Error(`Unimplemented`)
  }
  deleteAll(ids) {
    return ids.map(id => this.deleteOne(id))
  }

  getId(object) {
    return object.id
  }

  createOrUpdateOne(object) {
    if (this.getId(object) !== undefined) {
      return this.updateOne(object)
    } else {
      return this.createOne(object)
    }
  }
  createOrUpdateAll(objects) {
    return objects.map(o => this.createOrUpdateOne(o))
  }
}

class InMemoryGenericRepository extends IRepository {
  constructor(data) {
    super()
    this.data = data ?? [];
  }

  createOne(object) {
    object.id = Utilities.getUuid()
    this.data.push(object)
    return object
  }

  getOne(id) {
    const object = this.data.find(o => o.id === id)
    if (object === undefined) {
      new Error(`Object with id ${id} not found`)
    }
    return object
  }
  getAll() {
    return this.data ?? [];
  }
  updateOne(object) {
    const index = this.data.findIndex(o => o.id === object.id)
    if (index > -1) {
      this.data[index] = object
      return object
    }
    new Error(`Object with id ${object.id} not found`)
  }
  deleteOne(id) {
    const index = this.data.findIndex(c => c.id === id)
    if (index > -1) {
      this.data.splice(index, 1)
      return true
    }
    return false
  }
}

function budgetRepoCall(fnName, arg) {
  const budgets = loadBudgets()
  const budgetRepo = new InMemoryGenericRepository(budgets)
  const res = budgetRepo[fnName](arg)
  saveBudgets(budgets)
  return res
}

function categoryRepoCall(fnName, arg) {
  const categories = loadCategories()
  const catRepo = new InMemoryGenericRepository(categories)
  const res = catRepo[fnName](arg)
  saveCategories(categories)
  return res
}

function doGet() {
  // return HtmlService.createHtmlOutputFromFile('index');
  const output = HtmlService.createTemplateFromFile('index').evaluate();
  output.addMetaTag('viewport', 'width=device-width, initial-scale=1')
  return output;
}

function doPost(req) {
  return ContentService.createTextOutput(JSON.stringify(req))
    .setMimeType(ContentService.MimeType.JSON);

}

function include(filename) {
  return HtmlService.createTemplateFromFile(filename).evaluate().getContent();
}

/**
 * Simple object check.
 * @param item
 * @returns {boolean}
 */
function isObject_(item) {
  return (item && typeof item === 'object' && !Array.isArray(item));
}


// example mergeDeep({}, DEFAULT_BUDGET, budget)
/**
 * Deep merge two objects.
 * @param target
 * @param ...sources
 */
function mergeDeep(target, ...sources) {
  if (!sources.length) return target;
  const source = sources.shift();

  if (isObject_(target) && isObject_(source)) {
    for (const key in source) {
      if (isObject_(source[key])) {
        if (!target[key]) Object.assign(target, { [key]: {} });
        mergeDeep(target[key], source[key]);
      } else {
        Object.assign(target, { [key]: source[key] });
      }
    }
  }

  return mergeDeep(target, ...sources);
}
