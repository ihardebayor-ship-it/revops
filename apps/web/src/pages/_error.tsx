// Custom pages/_error.tsx — Next 15 still generates /404 + /500 from
// Pages-Router defaults even in App-Router-only apps. The default tries
// to render <Html> outside pages/_document during static prerender and
// crashes the build. Providing our own _error.tsx (a plain component
// that doesn't import <Html>) takes over both /404 and /500 fallbacks.
//
// The real not-found.tsx + global-error.tsx in src/app handle the
// runtime experience for App-Router routes — this file is just the
// build-time shim.

type ErrorProps = { statusCode?: number };

function ErrorPage({ statusCode }: ErrorProps) {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#09090b",
        color: "#f4f4f5",
        fontFamily:
          'system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif',
      }}
    >
      <div style={{ textAlign: "center", padding: "2rem" }}>
        <p style={{ fontSize: "0.75rem", letterSpacing: "0.1em", color: "#71717a" }}>
          {statusCode ?? "ERROR"}
        </p>
        <h1 style={{ fontSize: "1.5rem", marginTop: "0.5rem" }}>
          {statusCode === 404 ? "Page not found" : "Something went wrong"}
        </h1>
        <a
          href="/"
          style={{
            display: "inline-block",
            marginTop: "1rem",
            padding: "0.5rem 1rem",
            backgroundColor: "#3b82f6",
            color: "#fff",
            borderRadius: "0.375rem",
            textDecoration: "none",
            fontSize: "0.875rem",
          }}
        >
          Go home
        </a>
      </div>
    </main>
  );
}

ErrorPage.getInitialProps = ({ res, err }: { res?: { statusCode?: number }; err?: { statusCode?: number } }) => {
  const statusCode = res?.statusCode ?? err?.statusCode ?? 404;
  return { statusCode };
};

export default ErrorPage;
