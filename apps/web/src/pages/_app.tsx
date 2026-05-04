// Custom pages/_app.tsx — pairs with pages/_document.tsx to satisfy
// Next 15's static-error-page generation. We're App-Router-first;
// pages/* exists ONLY for Next's internal /_error fallback.

import type { AppProps } from "next/app";

export default function App({ Component, pageProps }: AppProps) {
  return <Component {...pageProps} />;
}
