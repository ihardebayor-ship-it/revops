export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-zinc-400">Configure how this workspace operates.</p>
      </header>
      <nav className="flex gap-1 border-b border-zinc-800 text-sm">
        <SettingsTab href="roles">Roles</SettingsTab>
        <SettingsTab href="commissions">Commissions</SettingsTab>
        <SettingsTab href="funnel">Funnel</SettingsTab>
        <SettingsTab href="dispositions">Dispositions</SettingsTab>
      </nav>
      <section>{children}</section>
    </div>
  );
}

function SettingsTab({ href, children }: { href: string; children: React.ReactNode }) {
  // Plain anchors so each tab triggers a server render — keeps the implementation
  // tiny in M1; client-side routing is a UI primitives task.
  return (
    <a
      href={href}
      className="border-b-2 border-transparent px-4 py-2 text-zinc-400 hover:border-zinc-600 hover:text-zinc-100"
    >
      {children}
    </a>
  );
}
