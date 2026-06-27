function getAdapter(provider) {
  if (provider === 'onedrive') return require('./onedrive')
  if (provider === 'googledrive') return require('./googledrive')
  throw new Error(`Unknown cloud provider: ${provider}`)
}

module.exports = { getAdapter }
