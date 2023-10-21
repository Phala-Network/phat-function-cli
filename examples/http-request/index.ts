import '@phala/pink-env'

export default function main() {
  /*
    The `pink.httpRequest()` allows for you to make a single HTTP request from your function to an HTTP endpoint.
    You will have to define your args:
    - `url: string` – The URL to send the request to.
    - `method: string` – The HTTP method to use for the request (e.g. GET, POST, PUT). Defaults to GET.
    - `headers: Headers` – An map-like object containing the headers to send with the request.
    - `body: Uint8Array | string` – The body of the request, either as a Uint8Array or a string.
    - `returnTextBody: boolean` – A flag indicating whether the response body should be returned as a string (true) or a Uint8Array (false).
    Returned is the `Object` response from the HTTP request containing the following fields:
    - `{number} statusCode` - The HTTP status code of the response.
    - `{string} reasonPhrase` - The reason phrase of the response.
    - `{Headers} headers` - An object containing the headers of the response.
    - `{(Uint8Array|string)} body` - The response body, either as a `Uint8Array` or a string depending on the value of `args.returnTextBody`.
  */
  const response = pink.httpRequest({
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
  })
  return response.body
}
