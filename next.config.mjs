/** @type {import('next').NextConfig} */

import { createRequire } from "node:module";
const require_ = createRequire(import.meta.url);

/**
 * Cache headers for the static brand assets (WP-UI2 item 8). They are fingerprint-free static
 * files, so the browser must REVALIDATE them (must-revalidate, no immutable): a changed logo would
 * otherwise stay stale for a year. A day of freshness keeps repeat visits cheap without lying.
 */
const YEAR = 60 * 60 * 24 * 365;
const assetHeaders = [
  { key: "Cache-Control", value: `public, max-age=86400, stale-while-revalidate=${YEAR}, must-revalidate` },
];

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  eslint: { ignoreDuringBuilds: true },
  // Next 14.2: runs src/instrumentation.ts register() once at server boot —
  // eager env validation so a bad deployment fails loudly, not per-request.
  experimental: {
    instrumentationHook: true,
    // `sharp` is native (it needs child_process/detect-libc): bundling it breaks the
    // instrumentation compile with "Module not found: Can't resolve 'child_process'".
    // `nodemailer` (registration mail) is Node-only too: it needs stream/net/tls.
    // `imapflow` and `mailparser` («بريد يصير مهمة») are Node-only as well (net/tls/zlib/string_decoder, iconv-lite, libmime).
    serverComponentsExternalPackages: ["bcryptjs", "@prisma/client", "pg", "sharp", "nodemailer", "imapflow", "mailparser"],
  },
  /**
   * Native/server-only modules must stay OUTSIDE the webpack graph. `sharp` is a native
   * .node addon (it needs child_process + detect-libc); bundling it makes the
   * instrumentation compile fail with "Can't resolve 'child_process'" and every page 500s.
   * `pg-native` and `bcryptjs`"crypto" are optional peer requires — leave them external too.
   */
  webpack: (config, { isServer, nextRuntime, webpack: wp }) => {
    // Next's bundled webpack is initialised lazily; `wp` (the plugin arg) is the right handle.
    const compiledWebpack = require_("next/dist/compiled/webpack/webpack");
    compiledWebpack.init?.();
    const NormalModuleReplacementPlugin =
      (wp && wp.NormalModuleReplacementPlugin) || compiledWebpack.webpack.NormalModuleReplacementPlugin;
    // NOTE: the Edge pass reports isServer:true as well — `nextRuntime` is the only reliable
    // discriminator (webpack-config passes nextRuntime:"edge" for the edge-server compiler).
    const isEdge = nextRuntime === "edge";
    if (isServer && !isEdge) {
      // Anything native/Node-only stays a runtime `require` — never a webpack module. Without
      // this the instrumentation compile walks pg → pg-connection-string → fs and dies with
      // "Module not found: Can't resolve 'fs'", which 500s every page.
      config.externals = [
        ...(Array.isArray(config.externals) ? config.externals : [config.externals].filter(Boolean)),
        {
          sharp: "commonjs sharp",
          "pg-native": "commonjs pg-native",
          pg: "commonjs pg",
          "pg-connection-string": "commonjs pg-connection-string",
          bcryptjs: "commonjs bcryptjs",
          nodemailer: "commonjs nodemailer",
          imapflow: "commonjs imapflow",
          mailparser: "commonjs mailparser",
        },
      ];
    } else {
      // Next also compiles `instrumentation.ts` (and anything it imports) for the Edge pass.
      // The realtime/chat code is Node-only; `register()` returns before touching it unless
      // NEXT_RUNTIME is nodejs, so neutralising these modules there is safe — but webpack still
      // has to resolve them, and it rejects the `node:` scheme outright (UnhandledSchemeError).
      config.plugins.push(
        new NormalModuleReplacementPlugin(/^node:/, (resource) => {
          resource.request = resource.request.replace(/^node:/, "");
        }),
      );
      config.resolve.alias = {
        ...config.resolve.alias,
        pg: false,
        "pg-native": false,
        sharp: false,
        bcryptjs: false,
        // reached through instrumentation → realtime purge → registration → mail (Node-only)
        nodemailer: false,
        // reached through instrumentation → job runner → mail-to-task (the mailbox reader): Node-only
        imapflow: false,
        mailparser: false,
        fs: false,
        path: false,
        net: false,
        dns: false,
        "dns/promises": false,
        tls: false,
        crypto: false,
        child_process: false,
        os: false,
        // reached through instrumentation → job runner → reminders → notify → Web Push (`web-push`, `jws`): Node-only.
        // The Edge pass only (the browser bundle keeps its own fallbacks for these).
        ...(isEdge ? { stream: false, http: false, https: false, http2: false, zlib: false } : {}),
      };
    }
    return config;
  },
  async headers() {
    return [
      { source: "/brand/:path*", headers: assetHeaders },
      { source: "/icons/:path*", headers: assetHeaders },
      { source: "/fonts/:path*", headers: assetHeaders },
    ];
  },
};

export default nextConfig;
