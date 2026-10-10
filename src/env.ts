try {
  process.loadEnvFile();
} catch {
  // No .env file; rely on the ambient environment.
}
