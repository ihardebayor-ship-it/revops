// Custom pages/_document.tsx — provided to work around a Next 15
// regression where the default Pages-Router /_error page (auto-rendered
// for /404 + /500 even in App-Router-only apps) crashes with
// "<Html> should not be imported outside of pages/_document". By
// providing our own _document, we satisfy the bundler's expected shape
// and the build worker stops crashing.
//
// We're App-Router-first; this file exists ONLY for the static error
// fallback. The real layout lives in src/app/layout.tsx.

import { Html, Head, Main, NextScript } from "next/document";

export default function Document() {
  return (
    <Html lang="en" className="dark">
      <Head />
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
