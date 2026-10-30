// macOS resolves these before JS starts. Remove overrides in the parent process,
// rather than deleting process.env after Electron has already loaded ImageIO.
export function cleanElectronEnvironment(source = process.env, platform = process.platform) {
  const environment = { ...source }
  if (platform === 'darwin') {
    for (const name of Object.keys(environment)) {
      if (name.startsWith('DYLD_')) delete environment[name]
    }
  }
  return environment
}
