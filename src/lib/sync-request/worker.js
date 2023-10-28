const { request, ProxyAgent, setGlobalDispatcher } = require('undici')

if (process.env.http_proxy || process.env.https_proxy) {
  const proxyAgent = new ProxyAgent(process.env.http_proxy || process.env.https_proxy)
  setGlobalDispatcher(proxyAgent)
}

function init() {
  return async (options) => {
    try {
      const requestPromise = request(options.url, {
        method: options.method || 'GET',
        headers: options.headers,
        body: options.body,
      })
      const timeoutPromise = new Promise((resolve, reject) => {
        setTimeout(() => {
          reject(new Error('Timeout'))
        }, options.timeout * 1000)
      })
      const res = await Promise.race([requestPromise, timeoutPromise])
      return {
        statusCode: res.statusCode,
        reasonPhrase: `${res.statusCode}`,
        body: (await res.body.text()),
        headers: res.headers,
      }
    } catch (error) {
      return {
        statusCode: 524,
        reasonPhrase: 'IO Error',
        body: error.message,
        headers: {},
      }
    }
  }
}

module.exports = init
