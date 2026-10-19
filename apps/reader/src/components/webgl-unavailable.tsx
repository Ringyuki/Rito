export function WebGlUnavailable() {
  return (
    <main
      data-testid="reader-webgl-unavailable"
      role="alert"
      className="flex h-dvh w-dvw items-center justify-center bg-background p-6 text-foreground"
    >
      <div className="max-w-lg rounded-xl border border-destructive/50 bg-destructive/10 p-6">
        <h1 className="text-lg font-semibold text-destructive">
          This browser can&apos;t draw the reader
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Rito draws its pages with WebGL 2, and this browser isn&apos;t providing it. That usually
          means the browser&apos;s hardware acceleration is turned off, or it doesn&apos;t use this
          computer&apos;s graphics card.
        </p>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>
            Turn on hardware acceleration — in Chrome or Edge, Settings → System → Use graphics
            acceleration when available — then restart the browser and reload this page.
          </li>
          <li>Or open the reader in another browser, or on another device.</li>
        </ul>
      </div>
    </main>
  );
}
