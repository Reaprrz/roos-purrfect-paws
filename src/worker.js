// Cloudflare Worker entry point.
// Serves the site from /public and runs the owner edit panel's API routes.
// The route handlers live in /functions so the same code also works on Cloudflare Pages.
import * as settings from "../functions/api/settings.js";
import * as login from "../functions/api/login.js";
import * as upload from "../functions/api/upload.js";
import * as img from "../functions/api/img/[[path]].js";

const ROUTES = {
  "/api/settings": settings,
  "/api/login": login,
  "/api/upload": upload,
};

function pick(mod, method) {
  const name = "onRequest" + method.charAt(0) + method.slice(1).toLowerCase();
  return mod[name] || mod.onRequest;
}

function notAllowed() {
  return new Response(JSON.stringify({ error: "Method not allowed." }), {
    status: 405,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (path.startsWith("/api/img/")) {
      const handler = pick(img, request.method);
      if (!handler) return notAllowed();
      const parts = path.slice("/api/img/".length).split("/").map(decodeURIComponent);
      return handler({ request, env, ctx, params: { path: parts } });
    }

    const mod = ROUTES[path];
    if (mod) {
      const handler = pick(mod, request.method);
      if (!handler) return notAllowed();
      return handler({ request, env, ctx, params: {} });
    }

    if (path.startsWith("/api/")) {
      return new Response(JSON.stringify({ error: "Not found." }), {
        status: 404,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }

    // Everything else is the website itself.
    return env.ASSETS.fetch(request);
  },
};
