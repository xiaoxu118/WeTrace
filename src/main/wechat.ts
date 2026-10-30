import type { ReportParticipant } from '../shared/report-facts'
import type { ChatIndexSearchQuery, IndexedConversationQuery, ChatIndexSearchMatch, ChatIndexQuery, ChatIndexStatus } from '../shared/chat-index'
import type { ConversationIndexQuery, ConversationIndexSummary, SpeechStatsQuery, SpeechStatsResult } from '../shared/types'
import fs from 'node:fs'
import path from 'node:path'
import type {
  DetectResult,
  ReportMessagesQuery,
  ReportMessagesResult,
  SyncConversation,
  SyncMessage,
  SyncResult,
  WechatAccount,
} from '../shared/types'
import {
  clearLegacyDatabaseKeys,
  loadDatabaseKey,
  saveDatabaseKey,
  type StoredDatabaseKey,
} from './database-key-store'
import { captureAccountKey } from './key-capture'
import { sipEnabled } from './security'
import { loadImagePreview, runReportParticipantProfiles, runIndexSearch, runIndexedConversation, runWechatChatIndex, runWechatConversationSummary, runWechatSpeechQuery, runWechatReportMedia, runWechatReportQuery, runWechatSync, validateWechatDatabase } from './wechat-background'

export type { DetectResult, SyncConversation, SyncMessage, SyncResult, WechatAccount }

const DEFAULT_ROOT = path.join(
  process.env.HOME ?? '',
  'Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files'
)

export function listWechatAccounts(rootInput?: string): WechatAccount[] {
  const input = rootInput ?? DEFAULT_ROOT
  const root = path.basename(input).startsWith('wxid_')
    ? path.dirname(input)
    : input
  if (!fs.existsSync(root)) return []
  const dirs = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('wxid_'))
    .map((entry) => entry.name)

  const accounts: WechatAccount[] = []
  for (const dir of dirs) {
    const accountRoot = path.join(root, dir)
    if (!fs.existsSync(path.join(accountRoot, 'db_storage', 'session', 'session.db'))) continue
    accounts.push({ id: dir, wxid: dir.split('_').slice(0, 2).join('_'), root: accountRoot })
  }
  return accounts.sort((left, right) => left.id.localeCompare(right.id))
}

function pickAccount(root: string): WechatAccount | null {
  const accounts = listWechatAccounts(root)
  if (path.basename(root).startsWith('wxid_')) return accounts.find((account) => account.root === root) ?? null
  return accounts[0] ?? null
}

function requireAccount(rootInput?: string): WechatAccount {
  const root = rootInput ?? DEFAULT_ROOT
  const account = pickAccount(root)
  if (account) return account
  throw new Error(
    fs.existsSync(root) ? '已找到微信目录，但没有已登录账号的数据库' : '未找到微信数据目录'
  )
}

async function validateAndMigrateKey(account: WechatAccount, stored: StoredDatabaseKey): Promise<void> {
  await validateWechatDatabase(account.root, stored.key)
  if (stored.legacy) {
    saveDatabaseKey(account.root, stored.key)
    clearLegacyDatabaseKeys()
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function detectWechat(rootInput?: string): Promise<DetectResult> {
  const root = rootInput ?? DEFAULT_ROOT
  const account = pickAccount(root)
  if (!account) {
    return {
      account: null,
      hasKey: false,
      keyCreatedAt: null,
      error: fs.existsSync(root)
        ? '已找到微信目录，但没有已登录账号的数据库'
        : '未找到微信数据目录',
    }
  }

  let stored: StoredDatabaseKey | null = null
  let hasKey = false
  let error: string | undefined
  try {
    stored = loadDatabaseKey(account.root)
    if (stored) {
      await validateAndMigrateKey(account, stored)
      hasKey = true
    }
  } catch (cause) {
    error = `已保存的数据库密钥无法解密当前微信数据，请重新获取密钥（${errorMessage(cause)}）`
  }

  return { account, hasKey, keyCreatedAt: stored?.createdAt ?? null, error }
}

export async function fetchKey(rootInput?: string, onReady?: () => void): Promise<{ messageDb: string }> {
  const account = requireAccount(rootInput)
  if (await sipEnabled()) {
    throw new Error('macOS 系统完整性保护（SIP）已开启，无法读取微信进程内存。请关闭 SIP 后重启再试。')
  }

  const result = await captureAccountKey(onReady)
  if (!result.success || !result.key) throw new Error(result.error ?? '未捕获到账号密钥')
  try {
    await validateWechatDatabase(account.root, result.key)
  } catch (error) {
    throw new Error(`捕获的原始密钥无法打开当前账号数据库，未保存该密钥（${errorMessage(error)}）`)
  }
  saveDatabaseKey(account.root, result.key)
  return { messageDb: path.join(account.root, 'db_storage', 'session', 'session.db') }
}

export async function syncWechat(options: { root?: string } = {}): Promise<SyncResult> {
  const account = requireAccount(options.root)
  const stored = loadDatabaseKey(account.root)
  if (!stored) throw new Error('尚未取得数据库密钥，请先获取密钥')
  return runWechatSync(account, stored.key)
}

export async function queryReportMessages(query: ReportMessagesQuery): Promise<ReportMessagesResult> {
  const account = requireAccount(query.root)
  const stored = loadDatabaseKey(account.root)
  if (!stored) throw new Error('尚未取得数据库密钥，请先获取密钥')
  return runWechatReportQuery(account, stored.key, {
    conversationId: query.conversationId,
    startDate: query.startDate,
    endDate: query.endDate,
    contentTypes: query.contentTypes,
    includeVoiceData: query.includeVoiceData,
    deferMedia: query.deferMedia,
    metadataOnly: query.metadataOnly,
    indexRevision: query.indexRevision,
    selectedMessages: query.selectedMessages,
  })
}

export async function querySpeechStats(query: SpeechStatsQuery): Promise<SpeechStatsResult> {
  const account = requireAccount(query.root)
  const stored = loadDatabaseKey(account.root)
  if (!stored) throw new Error('尚未取得数据库密钥，请先获取密钥')
  return runWechatSpeechQuery(account, stored.key, query)
}

export async function queryConversationSummary(query: ConversationIndexQuery): Promise<ConversationIndexSummary> {
  const account = requireAccount(query.root)
  const stored = loadDatabaseKey(account.root)
  if (!stored) throw new Error('尚未取得数据库密钥，请先获取密钥')
  return runWechatConversationSummary(account, stored.key, query)
}

export async function prepareReportMedia(root: string | undefined, conversationId: string, message: SyncMessage): Promise<SyncMessage> {
  if (!message.reportMedia || (message.messageType === 34 ? message.voice?.hex : message.image?.source)) return message
  const account = requireAccount(root)
  const stored = loadDatabaseKey(account.root)
  if (!stored) throw new Error('尚未取得数据库密钥')
  const prepared = await runWechatReportMedia(account, stored.key, conversationId, message)
  // Reuse prepared media when retrying the same loaded conversation.
  if (prepared.voice?.hex) message.voice = prepared.voice
  if (prepared.image?.source) message.image = prepared.image
  return prepared
}

export async function controlChatIndex(query: ChatIndexQuery): Promise<ChatIndexStatus> {
  const account = requireAccount(query.root)
  const stored = loadDatabaseKey(account.root)
  if (!stored) throw new Error('尚未取得数据库密钥，请先获取密钥')
  if (!['start', 'pause', 'rebuild', 'status', 'sync'].includes(query.action)) throw new Error('索引操作无效')
  return runWechatChatIndex(account, stored.key, query.action)
}

export async function searchChatIndex(query: ChatIndexSearchQuery): Promise<ChatIndexSearchMatch[]> {
  if (typeof query.keyword !== 'string' || query.keyword.trim().length > 200) throw new Error('搜索关键词过长')
  const account = requireAccount(query.root), stored = loadDatabaseKey(account.root)
  if (!stored) throw new Error('请先获取数据库密钥')
  return runIndexSearch(account, stored.key, query.keyword)
}
export async function getIndexedConversation(query: IndexedConversationQuery): Promise<SyncConversation> {
  if (typeof query.conversationId !== 'string' || query.at !== undefined && !Number.isFinite(query.at)) throw new Error('会话查询无效')
  if (query.limit !== undefined && (!Number.isSafeInteger(query.limit) || query.limit < 1)) throw new Error('消息条数无效')
  const account = requireAccount(query.root), stored = loadDatabaseKey(account.root)
  if (!stored) throw new Error('请先获取数据库密钥')
  return runIndexedConversation(account, stored.key, query.conversationId, query.at, query.limit, query.refresh)
}

export async function prepareReportParticipants(root: string | undefined, participants: ReportParticipant[]): Promise<ReportParticipant[]> {
  const account = requireAccount(root)
  const stored = loadDatabaseKey(account.root)
  if (!stored) return participants
  const profiles = await runReportParticipantProfiles(account, stored.key, participants)
  return Promise.all(profiles.map(async member => {
    const id = /^wetrace-media:\/\/preview\/([a-f\d]+)$/.exec(member.avatar ?? '')?.[1]
    if (!id) return { ...member, avatar: member.avatar?.startsWith('data:image/') ? member.avatar : undefined }
    const preview = await loadImagePreview(id)
    return { ...member, avatar: preview ? `data:${preview.mime};base64,${preview.data.toString('base64')}` : undefined }
  }))
}
