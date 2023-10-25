import '@phala/pink-env'

export default function main() {
  /*
    You may need to call multiple APIs at once,
    this would require you to use the `pink.batchHttpRequest()` function to ensure
    you do not timeout (timeouts for Phat Contract is 10 seconds) on your response.
    The `args` and returned `Object` are the same as `pink.httpRequest()`,
    but instead you can create an array of HTTP requests within the function.
  */
  const responses = pink.batchHttpRequest([
    {
      url: 'https://httpbin.org/ip',
      method: 'GET',
      returnTextBody: true,
    },
    {
      url: 'https://api-mumbai.lens.dev/',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'phat-contract',
      },
      body: JSON.stringify({
        query: `query Profile {
            profile(request: { profileId: "0x01" }) {
                stats {
                    totalFollowers
                    totalFollowing
                    totalPosts
                    totalComments
                    totalMirrors
                    totalPublications
                    totalCollects
                }
            }
        }`
      }),
      returnTextBody: true,
    }
  ])
  return responses[0].body
}
