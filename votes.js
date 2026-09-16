// Vote state and the pure functions every frame uses. Nothing here talks to
// Lume: every function takes a vote (or null) and returns a new one, so a
// device that applies the same messages in any order lands on the same state.
// Votes carry player ids only; names come from Lume's member list when drawn.
;(function () {
  const LIMITS = {
    question: 200,
    option: 60,
    minOptions: 2,
    maxOptions: 6,
  }

  const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)
  const isText = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max
  const isTime = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0
  const isPlayerId = (v) => typeof v === 'string' && v.length > 0 && v.length <= 64

  function randomId() {
    const bytes = new Uint8Array(12)
    crypto.getRandomValues(bytes)
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  }

  function parseBallots(v, optionCount) {
    if (!isObject(v)) return null
    const out = {}
    for (const [voter, b] of Object.entries(v)) {
      if (!isPlayerId(voter) || !isObject(b) || !isTime(b.at)) return null
      if (!Number.isInteger(b.option) || b.option < 0 || b.option >= optionCount) return null
      out[voter] = { option: b.option, at: b.at }
    }
    return out
  }

  /** a vote off the network, cleaned, or null if anything is off */
  function parseVote(v) {
    if (!isObject(v)) return null
    if (typeof v.id !== 'string' || v.id.length === 0 || v.id.length > 64) return null
    if (!isText(v.question, LIMITS.question)) return null
    if (!Array.isArray(v.options) || v.options.length < LIMITS.minOptions || v.options.length > LIMITS.maxOptions) {
      return null
    }
    if (!v.options.every((o) => isText(o, LIMITS.option))) return null
    if (typeof v.anonymous !== 'boolean' || !isTime(v.startedAt)) return null
    if (v.status !== 'open' && v.status !== 'ended') return null
    if (!isPlayerId(v.starter)) return null
    const ballots = parseBallots(v.ballots, v.options.length)
    if (!ballots) return null
    if (v.status === 'ended' ? !isPlayerId(v.endedBy) : v.endedBy !== null) return null
    return {
      id: v.id,
      question: v.question,
      options: [...v.options],
      anonymous: v.anonymous,
      starter: v.starter,
      startedAt: v.startedAt,
      status: v.status,
      ballots,
      endedBy: v.endedBy,
    }
  }

  /**
   * A new open vote from the start form, or a string saying what's wrong.
   * Blank option rows are dropped.
   */
  function createVote(input, starterId, now) {
    const question = String(input.question || '').trim()
    const options = (input.options || []).map((o) => String(o).trim()).filter((o) => o.length > 0)
    if (!question) return 'Ask a question.'
    if (question.length > LIMITS.question) return `Keep the question under ${LIMITS.question} characters.`
    if (options.length < LIMITS.minOptions) return `Give at least ${LIMITS.minOptions} options.`
    if (options.length > LIMITS.maxOptions) return `Give at most ${LIMITS.maxOptions} options.`
    if (options.some((o) => o.length > LIMITS.option)) return `Keep each option under ${LIMITS.option} characters.`
    return {
      id: randomId(),
      question,
      options,
      anonymous: !!input.anonymous,
      starter: starterId,
      startedAt: now,
      status: 'open',
      ballots: {},
      endedBy: null,
    }
  }

  /** every device settles on the same vote when two start at once */
  const startsFirst = (a, b) => a.startedAt < b.startedAt || (a.startedAt === b.startedAt && a.id < b.id)

  /** per voter, the ballot cast last */
  function mergeBallots(a, b) {
    const out = { ...a }
    for (const [voter, ballot] of Object.entries(b)) {
      if (!out[voter] || ballot.at > out[voter].at) out[voter] = ballot
    }
    return out
  }

  /**
   * Two copies of "the current vote" combined. Same vote: ballots unioned,
   * ended if either copy is. Different votes: open beats ended, the earlier
   * of two open votes wins, the later of two ended votes stays.
   */
  function merge(mine, theirs) {
    if (!theirs) return mine
    if (!mine) return theirs
    if (mine.id === theirs.id) {
      const ended = mine.status === 'ended' ? mine : theirs.status === 'ended' ? theirs : null
      return {
        ...mine,
        ballots: mergeBallots(mine.ballots, theirs.ballots),
        status: ended ? 'ended' : 'open',
        endedBy: ended ? ended.endedBy : null,
      }
    }
    if (mine.status !== theirs.status) return mine.status === 'open' ? mine : theirs
    if (mine.status === 'open') return startsFirst(mine, theirs) ? mine : theirs
    return mine.startedAt >= theirs.startedAt ? mine : theirs
  }

  /** a ballot for the open vote; stale or malformed ones leave it unchanged */
  function applyBallot(vote, voterId, args) {
    if (!vote || vote.status !== 'open' || !isObject(args) || args.voteId !== vote.id) return vote
    if (!isPlayerId(voterId) || !isTime(args.at)) return vote
    if (!Number.isInteger(args.option) || args.option < 0 || args.option >= vote.options.length) return vote
    const current = vote.ballots[voterId]
    if (current && current.at >= args.at) return vote
    return { ...vote, ballots: { ...vote.ballots, [voterId]: { option: args.option, at: args.at } } }
  }

  /** the starter or the DM may end a vote */
  const canEnd = (vote, playerId, role) => !!vote && vote.status === 'open' && (vote.starter === playerId || role === 'dm')

  /** per option: how many picked it, and who (empty for an anonymous vote), as player ids */
  function tally(vote) {
    const rows = vote.options.map((label) => ({ label, count: 0, voters: [] }))
    for (const [voter, ballot] of Object.entries(vote.ballots)) {
      const row = rows[ballot.option]
      if (!row) continue
      row.count += 1
      if (!vote.anonymous) row.voters.push(voter)
    }
    return rows
  }

  window.PartyVotes = {
    LIMITS,
    parseVote,
    createVote,
    merge,
    applyBallot,
    canEnd,
    tally,
  }
})()
