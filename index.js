const {dirname} = require('path')
const through =  require('through2')
const resolveSwaps = require('./lib/resolve-swaps')
const debug = require('debug')('browserify-swap')
const viralify = require('viralify')
const bl = require('bl')
const findParentDir = require('find-parent-dir')

debug('start')

let cachedConfig

function viralifyDeps(root, packages) {
  debug('viralify root: %s, packages: %o', root, packages)
  viralify.sync(root, packages, 'browserify-swap', true)
  debug('viralify done')
}

function requireSwap(swapFileName) {
  return `module.exports = require('${swapFileName}');`
}

function swap(config, env, file) {
  if (!config) return

  const swaps = config[env]
  if (!swaps) return

  const matches = Object.keys(swaps)
    .filter(function (k) {
      // Remove leading and trailing '/'
      const s = k.replace(/^\/|\/$/g,'')
      const regex = new RegExp(s)
      return regex.test(file)
    })
    .map(k=>swaps[k])

  if (matches.length > 1) throw new Error(`more than one match for ${file}`)
  return matches[0]
}

module.exports = function browserifySwap(file) {
  const env = process.env.BROWSERIFYSWAP_ENV || 'default'
  let data = bl()
  let swapFile

  // no stubbing desired or we already determined that we can't find a swap config => just pipe it through
  if (cachedConfig === null) return through()

  if (cachedConfig !== undefined) {
    swapFile = swap(cachedConfig, env, file)
    if (!swapFile) return through()
  }
  return through(write, end)

  function write(d, enc, next) {
    data.append(d)
    next()
  }
  function end(cb) {
    const replace = () => {
      swapFile = swapFile.replace(/\\/g, '/')
      debug('replacing %s with %s', file, swapFile)
      this.push(requireSwap(swapFile))
      return cb()
    }

    // if config was cached we already resolved the swapFile if we got here
    if (swapFile) return replace()

    if (cachedConfig == undefined) {
      init(file, (err, swaps) =>{
        cachedConfig = swaps
        if (err) return cb(err)
        swapFile = swap(swaps, env, file)
        if (swapFile) return replace()
        this.push(data.slice())
        cb()
      })
    }
  }
}

function init(firstFile, cb) {
  debug('init, first fie is %s', firstFile)
  const dir = dirname(firstFile)
  findParentDir(dir, 'package.json', (err, root) => {
    if (err) return cb(err)
    root = root || process.env.BROWSERIFYSWAP_ROOT || process.cwd()
    debug('root is %s', root)
    resolveSwaps(root, (err, config) => {
      if (err) return cb(err)

      if (config && config.packages) viralifyDeps(root, config.packages)
      const swaps = config && config.swaps

      debug('replacements: %o', swaps)
      cb(null, swaps || null)
    })
  })
}
