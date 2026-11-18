import fs from 'node:fs'
export function windowsExports(file) {
  const data = fs.readFileSync(file)
  if (data.toString('ascii', 0, 2) !== 'MZ') throw new Error(`无效PE文件：${file}`)
  const pe = data.readUInt32LE(0x3c)
  if (data.toString('ascii', pe, pe + 4) !== 'PE\0\0' || data.readUInt16LE(pe + 4) !== 0x8664) throw new Error(`不是Windows x64组件：${file}`)
  const optional = pe + 24
  if (data.readUInt16LE(optional) !== 0x20b) throw new Error('不支持的PE格式')
  const count = data.readUInt16LE(pe + 6)
  const sections = optional + data.readUInt16LE(pe + 20)
  const ranges = []
  for (let i = 0; i < count; i++) {
    const offset = sections + i * 40
    const size = data.readUInt32LE(offset + 16), raw = data.readUInt32LE(offset + 20)
    if (raw + size > data.length) throw new Error(`组件下载不完整：${file}`)
    ranges.push({ address: data.readUInt32LE(offset + 12), size: Math.max(size, data.readUInt32LE(offset + 8)), raw })
  }
  const locate = address => { const range = ranges.find(range => address >= range.address && address < range.address + range.size); if (!range) throw new Error('无效PE地址'); return range.raw + address - range.address }
  const directory = locate(data.readUInt32LE(optional + 112))
  const names = locate(data.readUInt32LE(directory + 32))
  return Array.from({ length: data.readUInt32LE(directory + 24) }, (_, i) => { const start = locate(data.readUInt32LE(names + i * 4)); return data.toString('ascii', start, data.indexOf(0, start)) })
}
