interface StartupErrorProps {
  readonly error: unknown;
}

export function StartupError({ error }: StartupErrorProps) {
  const detail = error instanceof Error ? error.message : String(error);
  return (
    <main
      data-testid="reader-startup-error"
      role="alert"
      className="flex h-dvh w-dvw items-center justify-center bg-background p-6 text-foreground"
    >
      <div className="max-w-lg rounded-xl border border-destructive/50 bg-destructive/10 p-6">
        <h1 className="text-lg font-semibold text-destructive">Rito Reader failed to start</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Required deterministic fallback fonts could not be loaded. No book was opened without
          them.
        </p>
        <p className="mt-3 break-words font-mono text-xs text-destructive">{detail}</p>
      </div>
    </main>
  );
}
