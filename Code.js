const PLAID_API_BASE_URL = "https://development.plaid.com"
const DEFAULT_PLAID_CONFIG = {
  url: PLAID_API_BASE_URL,
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
  console.log(JSON.stringify(loadUser()))
  // const plaidTransactions = loadTransactions()
  // const transactions = plaidTransactions.map((t, i) => {
  //   const t2 = convertPlaidTransaction(t)
  //   t2.id = i
  // })
  // saveTransactions(transactions)
  // resetTestData()
  // testMe()

  // console.log(fetchPlaidAccounts());
  clearTransactionsData()

  // fetchPlaidTransactions()
  // const transactions = loadTransactions()
  // console.log(transactions[0])
  // console.log(transactions.at(-1))
  // console.log(transactions.length)
  // console.log(Session.getActiveUser().getEmail())

}

function convertPlaidTransaction(plaidTransaction, plaidAccounts = []) {
  const transaction = {
    id: null,
    date: plaidTransaction.date,
    name: plaidTransaction.name,
    amount: plaidTransaction.amount,
    account: plaidAccounts.find(a => a.account_id === plaidTransaction.account_id)?.name ?? 'unknown',
    source: 'plaid',
    data: { ...plaidTransaction }
  }
  return transaction;
}

function fetchPlaidAccounts(clientId, secret, accessToken) {
  const endpoint = `${PLAID_API_BASE_URL}/accounts/get`
  const getAccountsOptions = {
    client_id: clientId,
    secret: secret,
    access_token: accessToken,
  }
  const fetchOptions = {
    'method': 'post',
    'contentType': 'application/json',
    'payload': JSON.stringify(getAccountsOptions)
  };
  const response = UrlFetchApp.fetch(endpoint, fetchOptions)
  const data = JSON.parse(response.getContentText());
  return data
}

function createLinkToken() {
  const user = loadUser()
  const { clientId, secret, ...rest } = user.plaid
  const createTokenOptions = {
    client_id: clientId,
    secret: secret,
    user: {
      "client_user_id": user.id,
    },
    client_name: "Expense Tracker App Script",
    products: ["transactions"],
    country_codes: ["US"],
    language: "en",
  }
  const fetchOptions = {
    'method': 'post',
    'contentType': 'application/json',
    'payload': JSON.stringify(createTokenOptions)
  };
  const response = UrlFetchApp.fetch(PLAID_API_BASE_URL + '/link/token/create', fetchOptions)
  const data = JSON.parse(response.getContentText());
  return data
}
/**
 * Exchange a Plaid public token for an access token and save it
 * @param {string} publicToken 
 */
function createAndSaveAccessToken(publicToken) {
  const user = loadUser()
  const { clientId, secret, ...rest } = user.plaid
  const linkData = exchangePublicToken(clientId, secret, publicToken)
  const linkObj = { name: `Link ${user.plaid.links.length + 1}`, link: linkData, cursor: null }
  user.plaid.links.push(linkObj)
  saveUser(user)
  return linkObj
}
/**
 * Exchange a Plaid public token for an access token
 * @param {string} clientId 
 * @param {string} secret 
 * @param {string} publicToken 
 */
function exchangePublicToken(clientId, secret, publicToken) {

  const exchangeOptions = {
    client_id: clientId,
    secret: secret,
    public_token: publicToken
  }
  const fetchOptions = {
    'method': 'post',
    'contentType': 'application/json',
    'payload': JSON.stringify(exchangeOptions)
  };
  /*
  Example response:
  {
    "access_token": "access-sandbox-de3ce8ef-33f8-452c-a685-8671031fc0f6",
    "item_id": "M5eVJqLnv3tbzdngLDp9FL5OlDNxlNhlE55op",
    "request_id": "Aim3b"
  }
  */
  const response = UrlFetchApp.fetch(PLAID_API_BASE_URL + '/item/public_token/exchange', fetchOptions)
  const data = JSON.parse(response.getContentText());
  return data
}

/**
 * An aggregate of plaid transaction changes
 * @typedef {{added: array, modified: array, removed: array, cursor: string}} TransactionChanges
 */
/**
 * 
 * @param {string} clientId plaid client id
 * @param {string} secret plaid secret
 * @param {string} accessToken plaid access token
 * @param {string} cursor plaid transactions cursor
 * @returns {TransactionChanges}
 */
function fetchPlaidTransactions(clientId, secret, accessToken, cursor = null) {
  const endpoint = `${PLAID_API_BASE_URL}/transactions/sync`
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
  return {
    cursor,
    added,
    modified,
    removed,
  }
}
function fetchAndSavePlaidTransactions() {
  const userData = loadUser();
  const { clientId, secret } = userData.plaid
  const prevExistingTransactions = loadTransactions()
  const nonPlaidTransactions = prevExistingTransactions.filter(t => t.source !== 'plaid')
  let plaidTransactions = prevExistingTransactions.filter(t => t.source === 'plaid')
  const addedTransactions = []
  for (const link of userData.plaid.links) {
    const accessToken = link.link.access_token
    let cursor = link.cursor ?? null
    const { added, modified, removed, ...rest } = fetchPlaidTransactions(clientId, secret, accessToken, cursor)
    cursor = rest.cursor

    const plaidAccounts = fetchPlaidAccounts(clientId, secret, accessToken)?.accounts ?? []
    const removedIds = new Set([removed.map(t => t.transaction_id)])
    const modifiedMap = new Map(modified.map(t => [t.transaction_id, t]))
    // filter out removed transactions
    // update modified ones
    plaidTransactions = plaidTransactions.filter(t => !removedIds.has(t.data?.transaction_id))
      .map(t => {
        if (modifiedMap.get(t.transaction_id)) {
          const plaidTransaction = modifiedMap.get(t.transaction_id)
          return convertPlaidTransaction(plaidTransaction, plaidAccounts)
        }
        return t
      })
    addedTransactions.push(...added.map(t => convertPlaidTransaction(t, plaidAccounts)))
  }
  const allTransactions = [...nonPlaidTransactions, ...plaidTransactions]
  const transactionRepo = new InMemoryGenericRepository(allTransactions)
  transactionRepo.createAll(addedTransactions)
  saveTransactions(allTransactions)
  saveUser(user)
  return addedTransactions.length
}
function resetTestData() {
  CacheService.getUserCache().removeAll(['user', 'budgets', 'categories', 'transactions'])
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
  console.log(JSON.stringify(transactions.slice(0, 4)))
}


function clearTransactionsData() {
  saveTransactions([])
  const user = loadUser()
  delete user.plaid.cursor
  delete user.plaid.accessToken
  saveUser(user)
}

function clearAllData() {
  return PropertiesService.getUserProperties().deleteAllProperties()
}

function loadValue(key, options = { defaultValue: null }) {
  const userProps = PropertiesService.getUserProperties()
  let value = userProps.getProperty(key)
  if (value !== undefined && value !== null) {
    value = JSON.parse(value)
  } else {
    value = options.defaultValue
  }
  return value
}

function saveValue(key, value, options = {}) {
  const userProps = PropertiesService.getUserProperties()
  const stringified = JSON.stringify(value)
  userProps.setProperty(key, stringified)
}

function loadUser() {
  const DEFAULT_USER = {
    id: null,
    plaid: {
      clientId: null,
      secret: null,
      links: [],
    }
  }
  const value = loadValue('user', { defaultValue: {} })
  const finalValue = mergeDeep({}, DEFAULT_USER, value)
  if (!finalValue.id) {
    finalValue.id = Utilities.getUuid()
  }
  return finalValue
}

function loadCategories() {
  return loadValue('categories', { defaultValue: [], })
}
function saveCategories(categories) {
  return saveValue('categories', categories)
}
/**
 * Fetch new transactions from Plaid then return back transactions within the date range
 * @param {String} startDateIsoString Start date of returned transactions
 * @param {String} endDateIsoString End date of returned transactions
 */
function fetchAndLoadTransactions(startDateIsoString = undefined, endDateIsoString = undefined) {
  fetchAndSavePlaidTransactions()
  return loadTransactions(startDateIsoString, endDateIsoString)
}
/**
 * Load transactions within the date range
 * @param {String} startDateIsoString Start date of returned transactions
 * @param {String} endDateIsoString End date of returned transactions
 */
function loadTransactions(startDateIsoString = undefined, endDateIsoString = undefined) {
  let transactions = loadValue('transactions', { defaultValue: [], })
  if (startDateIsoString) {
    const startDate = new Date(startDateIsoString)
    transactions = transactions.filter(t => new Date(t.date) >= startDate)
  }
  if (endDateIsoString) {
    const endDate = new Date(endDateIsoString)
    transactions = transactions.filter(t => new Date(t.date) <= endDate)
  }
  return transactions
}
function saveTransactions(transactions) {
  return saveValue('transactions', transactions)
}

function loadBudgets() {
  return loadValue('budgets', { defaultValue: [], })
}
function saveBudgets(budgets) {
  return saveValue('budgets', budgets)
}

function saveUser(userData) {
  return saveValue('user', userData)
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
