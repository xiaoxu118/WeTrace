import { windowsNativeResources } from '../src/main/native-resources.ts'
import { windowsExports } from './windows-pe.mjs'
try { const resources = windowsNativeResources(); for (const file of resources.libraries) windowsExports(file); console.log('Windows x64组件完整性、资源清单与SHA-256校验通过；此检查不代表真机ABI验收') }
catch (error) { console.error(error.message); process.exitCode=1 }
