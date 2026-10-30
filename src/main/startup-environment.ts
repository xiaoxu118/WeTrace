import { spawn } from 'node:child_process'

export function cleanMacLaunchEnvironment(source: NodeJS.ProcessEnv, platform = process.platform): NodeJS.ProcessEnv {
  const environment = { ...source }
  if (platform === 'darwin') for (const name of Object.keys(environment)) if (name.startsWith('DYLD_')) delete environment[name]
  return environment
}

// Covers direct launches of the packaged app as well as the npm launch scripts.
export async function relaunchWithoutLibraryOverrides(): Promise<boolean> {
  if (process.platform !== 'darwin' || !Object.keys(process.env).some(name => name.startsWith('DYLD_'))) return false
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, process.argv.slice(1), { env: cleanMacLaunchEnvironment(process.env), detached: true, stdio: 'ignore' })
    child.once('error', reject)
    child.once('spawn', () => { child.unref(); resolve() })
  })
  return true
}
