const PREFIX = "/covet";

function prefixOf(pathname) {
  return pathname === PREFIX || pathname.startsWith(PREFIX + "/") ? PREFIX : "";
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const prefix = prefixOf(url.pathname);

    if (prefix && url.pathname === prefix) {
      url.pathname = prefix + "/";
      return Response.redirect(url.toString(), 308);
    }

    if (!prefix) {
      return new Response("Not found.", { status: 404 });
    }

    const assetUrl = new URL(request.url);
    assetUrl.pathname = url.pathname.slice(prefix.length) || "/";
    const response = await env.ASSETS.fetch(new Request(assetUrl, request));
    const type = response.headers.get("content-type") || "";
    const headers = new Headers(response.headers);
    headers.set("X-Robots-Tag", "noindex, nofollow");
    if (!type.includes("text/html")) {
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }

    const html = await response.text();
    headers.delete("content-length");
    return new Response(html.replace("<head>", '<head><base href="' + prefix + '/">'), {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
};
