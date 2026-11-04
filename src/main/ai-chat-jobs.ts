/** Requests are isolated by window and chat; cancelling one never cancels another. */
export class AiChatJobs {
  private owners = new Map<number, Map<string, { chat: string; controller: AbortController }>>()
  start(owner: number, request: string, chat: string): AbortController {
    const jobs = this.owners.get(owner) ?? new Map<string, { chat: string; controller: AbortController }>()
    if (jobs.has(request) || [...jobs.values()].some(job => job.chat === chat)) throw new Error('该对话已有回答正在生成')
    const controller = new AbortController()
    jobs.set(request, { chat, controller })
    this.owners.set(owner, jobs)
    return controller
  }
  cancel(owner: number, request: string): void { this.owners.get(owner)?.get(request)?.controller.abort() }
  finish(owner: number, request: string): void {
    const jobs = this.owners.get(owner)
    jobs?.delete(request)
    if (!jobs?.size) this.owners.delete(owner)
  }
  cancelOwner(owner: number): void {
    for (const job of this.owners.get(owner)?.values() ?? []) job.controller.abort()
    this.owners.delete(owner)
  }
}
