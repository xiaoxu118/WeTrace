import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { StickerResolver, stickerUrl } from '../src/main/sticker-resolver.ts'
import { readImagePreview } from '../src/main/image-preview-cache.ts'
const directory = await mkdtemp(join(tmpdir(), 'wetrace-sticker-resolver-'))
const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')
const md5 = 'abcdef0123456789abcdef0123456789'
const url = 'https://emoji.qpic.cn/fictional.gif'
try {
 let requests = 0, lookups = 0
 const fakeFetch = async () => { requests++; return new Response(gif, { status:200 }) }
 const resolver = new StickerResolver(directory, fakeFetch)
 const [a,b] = await Promise.all([resolver.resolve('fake-account',md5,undefined,async()=>{lookups++;return url}),resolver.resolve('fake-account',md5,undefined,async()=>{lookups++;return url})])
 assert.ok(a.ok);assert.deepEqual(a,b);assert.equal(requests,1);assert.equal(lookups,1)
 assert.deepEqual(readImagePreview(a.source.split('/').pop()).data,gif)
 const offline = new StickerResolver(directory, async()=>{throw new Error('must not download')})
 assert.ok((await offline.resolve('fake-account',md5,undefined,async()=>{throw new Error('must not look up')})).ok)
 assert.ok((await resolver.resolve('other-fake-account',md5,url,async()=>undefined)).ok)
 assert.equal(requests,2,'账号缓存隔离')
 let fallbackCalls=0
 const fallback = new StickerResolver(directory,async location=>{fallbackCalls++;return location.includes('expired')?new Response('',{status:403}):new Response(gif,{status:200})})
 const recovered=await fallback.resolve('fallback',md5,'https://emoji.qpic.cn/expired',async()=>url)
 assert.ok(recovered.ok);assert.equal(fallbackCalls,2)
 const invalid=new StickerResolver(directory,async()=>new Response('<html>not an image</html>',{status:200}))
 assert.match((await invalid.resolve('bad-format',md5,url,async()=>undefined)).error,/不是支持的图片/)
 const redirect=new StickerResolver(directory,async()=>new Response(null,{status:302,headers:{location:'http://127.0.0.1/private'}}))
 assert.match((await redirect.resolve('bad-redirect',md5,url,async()=>undefined)).error,/不是支持的微信资源/)
 assert.throws(()=>stickerUrl('file:///etc/passwd'))
 assert.throws(()=>stickerUrl('https://emoji.qpic.cn.evil.invalid/file'))
 const expired = new StickerResolver(directory,async()=>new Response(null,{status:403}))
 assert.match((await expired.resolve('expired',md5,url,async()=>undefined)).error,/过期/)
 const tooLarge=new StickerResolver(directory,async()=>new Response(gif,{status:200,headers:{'content-length':String(21*1024*1024)}}))
 assert.match((await tooLarge.resolve('oversize',md5,url,async()=>undefined)).error,/20 MB/)
 const invalidHash=await resolver.resolve('bad','../../private',url,async()=>undefined)
 assert.equal(invalidHash.ok,false)
 console.log('表情包加载测试通过：MD5 地址查询、下载、并发去重、磁盘缓存、账号隔离、过期地址回退、无效格式/重定向/超大文件拒绝。')
} finally { await rm(directory,{recursive:true,force:true}) }
